// OneDrive 同步：資料存在使用者自己 OneDrive 的 App 專屬資料夾（approot）。
// data.json 放 projects/dailyLogs/todos/照片metadata；photos/<id>.jpg 放照片原始檔（resumable upload）。
// 合併策略：全部比對 updatedAt，較新的贏（單人跨裝置使用，不做即時協同）。
const Sync = (() => {
  const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
  const APPROOT = `${GRAPH_BASE}/me/drive/special/approot`;
  let syncing = false;
  const listeners = [];

  function onStatusChange(cb) { listeners.push(cb); }
  function emitStatus(status, err) { listeners.forEach((cb) => cb(status, err)); }

  async function graphFetch(url, token, opts = {}) {
    return fetch(url, Object.assign({}, opts, {
      headers: Object.assign({ Authorization: `Bearer ${token}` }, opts.headers || {})
    }));
  }

  async function ensureFolder(token, name) {
    const res = await graphFetch(`${APPROOT}:/${encodeURIComponent(name)}`, token, { method: 'GET' });
    if (res.status === 404) {
      await graphFetch(`${APPROOT}/children`, token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'replace' })
      });
    }
  }

  async function uploadSmallFile(token, path, content, contentType) {
    const res = await graphFetch(`${APPROOT}:/${path}:/content`, token, {
      method: 'PUT',
      headers: { 'Content-Type': contentType || 'application/octet-stream' },
      body: content
    });
    if (!res.ok) throw new Error(`上傳 ${path} 失敗：HTTP ${res.status}`);
    return res.json();
  }

  async function downloadFile(token, path) {
    const res = await graphFetch(`${APPROOT}:/${path}:/content`, token, { method: 'GET' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`下載 ${path} 失敗：HTTP ${res.status}`);
    return res;
  }

  // 照片走 resumable upload session，處理 >4MB 檔案（Graph 簡單 PUT 上限 4MB）
  async function uploadLargeFile(token, path, blob) {
    const sessionRes = await graphFetch(`${APPROOT}:/${path}:/createUploadSession`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } })
    });
    if (!sessionRes.ok) throw new Error(`建立照片上傳工作階段失敗：HTTP ${sessionRes.status}`);
    const session = await sessionRes.json();
    const uploadUrl = session.uploadUrl;
    const chunkSize = 5 * 1024 * 1024;
    const total = blob.size;
    let start = 0;
    while (start < total) {
      const end = Math.min(start + chunkSize, total);
      const chunk = blob.slice(start, end);
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': String(end - start),
          'Content-Range': `bytes ${start}-${end - 1}/${total}`
        },
        body: chunk
      });
      if (!res.ok && res.status !== 202) throw new Error(`照片上傳失敗：HTTP ${res.status}`);
      start = end;
    }
  }

  async function pushData(token) {
    const [projects, dailyLogs, todos, photosRaw] = await Promise.all([
      DB.getAllProjectsRaw(), DB.getAllDailyLogsRaw(), DB.getAllTodosRaw(), DB.getAllPhotosRaw()
    ]);
    const photosMeta = photosRaw.map((p) => ({
      id: p.id,
      projectId: p.projectId,
      dailyLogId: p.dailyLogId || null,
      caption: p.caption || '',
      annotations: p.annotations || [],
      takenAt: p.takenAt,
      updatedAt: p.updatedAt,
      deletedAt: p.deletedAt || null
    }));
    const payload = { version: 1, exportedAt: Date.now(), projects, dailyLogs, todos, photos: photosMeta };
    await uploadSmallFile(token, 'data.json', JSON.stringify(payload), 'application/json');

    const settings = await DB.getSettings();
    const lastSync = settings.lastSyncAt || 0;
    for (const p of photosRaw) {
      if (p.deletedAt) continue;
      if (p.uploadedOnce && (p.updatedAt || 0) <= lastSync) continue;
      try {
        await uploadLargeFile(token, `photos/${p.id}.jpg`, p.blob);
        await DB.updatePhoto(p.id, { uploadedOnce: true });
      } catch (err) {
        console.error('上傳照片失敗', p.id, err);
      }
    }
  }

  async function pullData(token) {
    const res = await downloadFile(token, 'data.json');
    if (!res) return;
    const remote = await res.json();

    for (const p of (remote.projects || [])) await DB.mergeRecord('projects', p);
    for (const l of (remote.dailyLogs || [])) await DB.mergeRecord('dailyLogs', l);
    for (const t of (remote.todos || [])) await DB.mergeRecord('todos', t);

    for (const meta of (remote.photos || [])) {
      const local = await DB.getPhoto(meta.id);
      if (local && (local.updatedAt || 0) >= (meta.updatedAt || 0)) continue;
      let blob = local ? local.blob : null;
      if (!local || !blob) {
        try {
          const imgRes = await downloadFile(token, `photos/${meta.id}.jpg`);
          if (imgRes) blob = await imgRes.blob();
        } catch (err) {
          console.error('下載照片失敗', meta.id, err);
        }
      }
      if (!blob) continue;
      await DB.mergeRecord('photos', Object.assign({}, meta, { blob, uploadedOnce: true }));
    }
  }

  async function syncNow() {
    if (syncing) return;
    if (!Auth.getAccount()) return;
    syncing = true;
    emitStatus('syncing');
    try {
      const token = await Auth.getToken();
      await ensureFolder(token, 'photos');
      await pullData(token);
      await pushData(token);
      await DB.updateSettings({ lastSyncAt: Date.now() });
      emitStatus('success');
    } catch (err) {
      console.error('同步失敗', err);
      emitStatus('error', err);
    } finally {
      syncing = false;
    }
  }

  let debounceTimer = null;
  function scheduleSync(delayMs = 4000) {
    if (!Auth.getAccount()) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(syncNow, delayMs);
  }

  function bindAutoSyncTriggers() {
    window.addEventListener('online', () => syncNow());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') syncNow();
    });
  }

  return { syncNow, scheduleSync, bindAutoSyncTriggers, onStatusChange };
})();
