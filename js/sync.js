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

  // 把 Graph 回傳的錯誤內容（error.code / error.message）附進錯誤訊息，
  // 不然畫面上只會看到一個 HTTP 狀態碼，同樣的 400/403 可能是完全不同原因（設定問題 vs 帳號問題）。
  async function describeError(res) {
    try {
      const body = await res.clone().json();
      if (body && body.error) return `${res.status} ${body.error.code || ''}：${body.error.message || ''}`.trim();
    } catch (e) { /* 回應不是 JSON，就只顯示狀態碼 */ }
    return `HTTP ${res.status}`;
  }

  // 某些全新的 OneDrive 個人帳號從未用過「App 專屬資料夾」功能時，第一次直接用路徑
  // （special/approot:/xxx）操作其底下項目會回 400，要先對 special/approot 本身發一次
  // 不帶路徑的 GET，讓 Graph 把這個特殊資料夾建立/初始化出來，後續操作才會正常。
  async function ensureAppRoot(token) {
    const res = await graphFetch(APPROOT, token, { method: 'GET' });
    if (!res.ok) throw new Error(`初始化 OneDrive App 資料夾失敗：${await describeError(res)}`);
  }

  async function ensureFolder(token, name) {
    const res = await graphFetch(`${APPROOT}:/${encodeURIComponent(name)}`, token, { method: 'GET' });
    if (res.status === 404) {
      const createRes = await graphFetch(`${APPROOT}/children`, token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, folder: {}, '@microsoft.graph.conflictBehavior': 'replace' })
      });
      if (!createRes.ok) throw new Error(`建立雲端資料夾失敗：${await describeError(createRes)}`);
    } else if (!res.ok) {
      throw new Error(`檢查雲端資料夾失敗：${await describeError(res)}`);
    }
  }

  async function deleteFile(token, path) {
    const res = await graphFetch(`${APPROOT}:/${path}`, token, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`刪除 ${path} 失敗：${await describeError(res)}`);
  }

  async function uploadSmallFile(token, path, content, contentType) {
    const res = await graphFetch(`${APPROOT}:/${path}:/content`, token, {
      method: 'PUT',
      headers: { 'Content-Type': contentType || 'application/octet-stream' },
      body: content
    });
    if (!res.ok) throw new Error(`上傳 ${path} 失敗：${await describeError(res)}`);
    return res.json();
  }

  async function downloadFile(token, path) {
    let res;
    try {
      res = await graphFetch(`${APPROOT}:/${path}:/content`, token, { method: 'GET' });
    } catch (netErr) {
      // Graph 會把內容下載 302 轉址到別的網域；那個網域若不在 CSP connect-src 白名單，
      // fetch 只會丟出無資訊的 Failed to fetch，這裡補上是哪個檔案，方便判斷。
      throw new Error(`下載 ${path} 失敗：無法連線（${netErr.message}）`);
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`下載 ${path} 失敗：${await describeError(res)}`);
    return res;
  }

  // 照片走 resumable upload session，處理 >4MB 檔案（Graph 簡單 PUT 上限 4MB）
  async function uploadLargeFile(token, path, blob) {
    // 4MB 以下直接 PUT 到 graph.microsoft.com（CSP 已允許）。upload session 回傳的 uploadUrl
    // 網域依帳號類型不同，個人 OneDrive 的網域不在 CSP connect-src 白名單內，fetch 會直接 Failed to fetch。
    if (blob.size <= 4 * 1024 * 1024) {
      await uploadSmallFile(token, path, blob, 'image/jpeg');
      return;
    }
    const sessionRes = await graphFetch(`${APPROOT}:/${path}:/createUploadSession`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } })
    });
    if (!sessionRes.ok) throw new Error(`建立照片上傳工作階段失敗：${await describeError(sessionRes)}`);
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
      if (!res.ok && res.status !== 202) throw new Error(`照片上傳失敗：${await describeError(res)}`);
      start = end;
    }
  }

  async function pushData(token) {
    const [projects, dailyLogs, todos, photosRaw] = await Promise.all([
      DB.getAllProjectsRaw(), DB.getAllDailyLogsRaw(), DB.getAllTodosRaw(), DB.getAllPhotosRaw()
    ]);
    const failed = [];
    let firstError = '';
    for (const p of photosRaw) {
      try {
        if (p.deletedAt) {
          if (p.uploadedOnce) await deleteFile(token, `photos/${p.id}.jpg`);
        } else if (!p.uploadedOnce) {
          await uploadLargeFile(token, `photos/${p.id}.jpg`, p.blob);
          await DB.markPhotoUploaded(p.id);
        }
      } catch (err) {
        console.error('同步照片失敗', p.id, err);
        failed.push(p.id);
        if (!firstError) firstError = err && err.message ? err.message : String(err);
      }
    }
    if (failed.length) throw new Error(`${failed.length} 張照片同步失敗（${firstError}），稍後將自動重試`);

    const latestPhotos = await DB.getAllPhotosRaw();
    const photosMeta = latestPhotos.map((p) => ({
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
  }

  async function pullData(token) {
    const res = await downloadFile(token, 'data.json');
    if (!res) return;
    const remote = await res.json();
    if (!remote || remote.version !== 1 || !Array.isArray(remote.projects) || !Array.isArray(remote.dailyLogs) || !Array.isArray(remote.todos) || !Array.isArray(remote.photos)) {
      throw new Error('OneDrive 上的同步資料格式不正確');
    }

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
    if (syncing) return false;
    if (!Auth.getAccount()) return false;
    syncing = true;
    emitStatus('syncing');
    try {
      const token = await Auth.getToken();
      await ensureAppRoot(token);
      // 預先建立 photos 資料夾只是順便，不是必要條件：Graph 上傳檔案（PUT / createUploadSession）
      // 會自動建立缺少的上層資料夾。個人 OneDrive 帳號建立資料夾偶爾會回 400 invalidRequest，
      // 這裡失敗不該擋住整個同步；真正的問題會在後面上傳步驟以完整錯誤訊息顯示。
      try {
        await ensureFolder(token, 'photos');
      } catch (folderErr) {
        console.warn('預先建立 photos 資料夾失敗，改由上傳時自動建立', folderErr);
      }
      await pullData(token);
      await pushData(token);
      await DB.updateSettings({ lastSyncAt: Date.now() });
      emitStatus('success');
      return true;
    } catch (err) {
      console.error('同步失敗', err);
      emitStatus('error', err);
      return false;
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
