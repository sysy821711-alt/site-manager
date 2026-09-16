// IndexedDB 存取層：工地 (projects)、施工日誌 (dailyLogs)、照片 (photos)、待辦 (todos)、設定 (settings)
// 照片用 Blob 直接存進 IndexedDB（比 localStorage 適合存大檔案）。
const DB = (() => {
  const DB_NAME = 'siteManagerDB';
  const DB_VERSION = 1;
  const STATUS = { NOT_STARTED: 'not_started', IN_PROGRESS: 'in_progress', DONE: 'done' };

  let dbPromise = null;

  function uid() {
    return globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function pad2(n) { return String(n).padStart(2, '0'); }
  function toDateStr(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('projects')) {
          db.createObjectStore('projects', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('dailyLogs')) {
          const store = db.createObjectStore('dailyLogs', { keyPath: 'id' });
          store.createIndex('projectId', 'projectId', { unique: false });
        }
        if (!db.objectStoreNames.contains('photos')) {
          const store = db.createObjectStore('photos', { keyPath: 'id' });
          store.createIndex('projectId', 'projectId', { unique: false });
        }
        if (!db.objectStoreNames.contains('todos')) {
          const store = db.createObjectStore('todos', { keyPath: 'id' });
          store.createIndex('projectId', 'projectId', { unique: false });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function promisifyRequest(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function store(storeName, mode) {
    const db = await openDB();
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  async function getAllRaw(storeName) {
    return promisifyRequest((await store(storeName, 'readonly')).getAll());
  }

  async function getByIndexRaw(storeName, indexName, value) {
    return promisifyRequest((await store(storeName, 'readonly')).index(indexName).getAll(value));
  }

  async function getById(storeName, id) {
    return promisifyRequest((await store(storeName, 'readonly')).get(id));
  }

  async function put(storeName, value) {
    try {
      await promisifyRequest((await store(storeName, 'readwrite')).put(value));
    } catch (err) {
      if (err && (err.name === 'QuotaExceededError' || err.name === 'UnknownError')) {
        throw new Error('裝置儲存空間不足，請先匯出備份並移除不需要的照片');
      }
      throw err;
    }
    return value;
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('資料庫交易已中止'));
    });
  }

  // ---------- Projects ----------
  async function getProjects() {
    const all = await getAllRaw('projects');
    return all.filter(p => !p.deletedAt).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  async function getProject(id) {
    return getById('projects', id);
  }

  async function addProject({ name, address, status, plannedStart, plannedEnd, note } = {}) {
    const now = Date.now();
    const project = {
      id: uid(),
      name: name || '未命名工地',
      address: address || '',
      status: status || STATUS.NOT_STARTED,
      plannedStart: plannedStart || null,
      plannedEnd: plannedEnd || null,
      note: note || '',
      createdAt: now,
      updatedAt: now
    };
    await put('projects', project);
    return project;
  }

  async function updateProject(id, patch) {
    const project = await getProject(id);
    if (!project) return null;
    const updated = Object.assign({}, project, patch, { updatedAt: Date.now() });
    await put('projects', updated);
    return updated;
  }

  async function deleteProject(id) {
    const db = await openDB();
    const tx = db.transaction(['projects', 'dailyLogs', 'photos', 'todos'], 'readwrite');
    const now = Date.now();
    const projectStore = tx.objectStore('projects');
    const project = await promisifyRequest(projectStore.get(id));
    if (!project) return false;
    projectStore.put(Object.assign({}, project, { deletedAt: now, cascadeDeletedAt: now, updatedAt: now }));
    for (const storeName of ['dailyLogs', 'photos', 'todos']) {
      const targetStore = tx.objectStore(storeName);
      const records = await promisifyRequest(targetStore.index('projectId').getAll(id));
      records.forEach((record) => targetStore.put(Object.assign({}, record, { deletedAt: now, cascadeDeletedAt: now, updatedAt: now })));
    }
    await txDone(tx);
    return true;
  }

  async function restoreProject(id) {
    const db = await openDB();
    const tx = db.transaction(['projects', 'dailyLogs', 'photos', 'todos'], 'readwrite');
    const now = Date.now();
    const projectStore = tx.objectStore('projects');
    const project = await promisifyRequest(projectStore.get(id));
    if (!project || !project.cascadeDeletedAt) return false;
    const cascadeDeletedAt = project.cascadeDeletedAt;
    const restoredProject = Object.assign({}, project, { updatedAt: now });
    delete restoredProject.deletedAt;
    delete restoredProject.cascadeDeletedAt;
    projectStore.put(restoredProject);
    for (const storeName of ['dailyLogs', 'photos', 'todos']) {
      const targetStore = tx.objectStore(storeName);
      const records = await promisifyRequest(targetStore.index('projectId').getAll(id));
      records.filter((record) => record.cascadeDeletedAt === cascadeDeletedAt).forEach((record) => {
        const restored = Object.assign({}, record, { updatedAt: now });
        delete restored.deletedAt;
        delete restored.cascadeDeletedAt;
        targetStore.put(restored);
      });
    }
    await txDone(tx);
    return true;
  }

  // ---------- Daily logs ----------
  async function getDailyLogs(projectId) {
    const logs = projectId ? await getByIndexRaw('dailyLogs', 'projectId', projectId) : await getAllRaw('dailyLogs');
    return logs.filter(l => !l.deletedAt).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }

  async function getDailyLog(id) {
    return getById('dailyLogs', id);
  }

  async function getDailyLogByDate(projectId, date) {
    const logs = await getByIndexRaw('dailyLogs', 'projectId', projectId);
    return logs.find(l => !l.deletedAt && l.date === date) || null;
  }

  async function addDailyLog({ projectId, date, personnel, weather, notes } = {}) {
    const now = Date.now();
    const log = {
      id: uid(),
      projectId,
      date: date || toDateStr(new Date()),
      personnel: Array.isArray(personnel) ? personnel : [],
      weather: weather || '',
      notes: notes || '',
      createdAt: now,
      updatedAt: now
    };
    await put('dailyLogs', log);
    return log;
  }

  async function updateDailyLog(id, patch) {
    const log = await getDailyLog(id);
    if (!log) return null;
    const updated = Object.assign({}, log, patch, { updatedAt: Date.now() });
    await put('dailyLogs', updated);
    return updated;
  }

  async function deleteDailyLog(id) {
    await updateDailyLog(id, { deletedAt: Date.now() });
  }

  // ---------- Photos ----------
  async function getPhotos(projectId) {
    const photos = projectId ? await getByIndexRaw('photos', 'projectId', projectId) : await getAllRaw('photos');
    return photos.filter(p => !p.deletedAt).sort((a, b) => (b.takenAt || 0) - (a.takenAt || 0));
  }

  async function getPhoto(id) {
    return getById('photos', id);
  }

  async function addPhoto({ projectId, dailyLogId, blob, caption } = {}) {
    const now = Date.now();
    const photo = {
      id: uid(),
      projectId,
      dailyLogId: dailyLogId || null,
      blob,
      caption: caption || '',
      annotations: [],
      takenAt: now,
      updatedAt: now
    };
    await put('photos', photo);
    return photo;
  }

  async function updatePhoto(id, patch) {
    const photo = await getPhoto(id);
    if (!photo) return null;
    const updated = Object.assign({}, photo, patch, { updatedAt: Date.now() });
    await put('photos', updated);
    return updated;
  }

  async function markPhotoUploaded(id) {
    const photo = await getPhoto(id);
    if (!photo) return null;
    const updated = Object.assign({}, photo, { uploadedOnce: true });
    await put('photos', updated);
    return updated;
  }

  async function deletePhoto(id) {
    await updatePhoto(id, { deletedAt: Date.now() });
  }

  async function addAnnotation(photoId, annotation) {
    const photo = await getPhoto(photoId);
    if (!photo) return null;
    const annotations = (photo.annotations || []).concat([Object.assign({ id: uid() }, annotation)]);
    return updatePhoto(photoId, { annotations });
  }

  async function updateAnnotation(photoId, annotationId, patch) {
    const photo = await getPhoto(photoId);
    if (!photo) return null;
    const annotations = (photo.annotations || []).map(a => a.id === annotationId ? Object.assign({}, a, patch) : a);
    return updatePhoto(photoId, { annotations });
  }

  async function deleteAnnotation(photoId, annotationId) {
    const photo = await getPhoto(photoId);
    if (!photo) return null;
    const annotations = (photo.annotations || []).filter(a => a.id !== annotationId);
    return updatePhoto(photoId, { annotations });
  }

  // ---------- Todos ----------
  async function getTodos(projectId) {
    const todos = projectId ? await getByIndexRaw('todos', 'projectId', projectId) : await getAllRaw('todos');
    // 未完成的排前面；有提醒日期的依日期由近到遠（含已逾期）排最前，其餘依建立時間新到舊
    return todos.filter(t => !t.deletedAt).sort((a, b) => {
      if (!!a.done !== !!b.done) return a.done ? 1 : -1;
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  async function getTodo(id) {
    return getById('todos', id);
  }

  async function addTodo({ projectId, text, photoId, dueDate } = {}) {
    const now = Date.now();
    const todo = {
      id: uid(),
      projectId,
      text: text || '',
      done: false,
      photoId: photoId || null,
      dueDate: dueDate || null,
      includeInReport: true,
      createdAt: now,
      updatedAt: now
    };
    await put('todos', todo);
    return todo;
  }

  async function updateTodo(id, patch) {
    const todo = await getTodo(id);
    if (!todo) return null;
    const updated = Object.assign({}, todo, patch, { updatedAt: Date.now() });
    await put('todos', updated);
    return updated;
  }

  async function deleteTodo(id) {
    await updateTodo(id, { deletedAt: Date.now() });
  }

  // ---------- Settings（單筆） ----------
  async function getSettings() {
    const s = await getById('settings', 'app');
    return s || { id: 'app', companyName: '', lastSyncAt: null };
  }

  async function updateSettings(patch) {
    const current = await getSettings();
    const updated = Object.assign({}, current, patch, { id: 'app' });
    await put('settings', updated);
    return updated;
  }

  // ---------- 出工人員記憶（跨工地共用，讓日誌表單能自動完成、避免同一人打成不同名字） ----------
  // 候選名單 = 手動記住的名字 ∪ 所有日誌裡實際出現過的名字（自動回溯歷史紀錄），
  // 再扣掉「已隱藏」的名字（刪除時用，確保真的不會再被建議，即使舊日誌裡還留著）。
  function sortNames(names) {
    return Array.from(names).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  }

  async function getPersonnelNames() {
    const s = await getSettings();
    const explicit = Array.isArray(s.personnelNames) ? s.personnelNames : [];
    const hidden = new Set(Array.isArray(s.hiddenPersonnelNames) ? s.hiddenPersonnelNames : []);
    const logs = await getAllDailyLogsRaw();
    const derived = new Set(explicit);
    logs.forEach((log) => {
      if (log.deletedAt) return;
      (log.personnel || []).forEach((raw) => {
        const name = (raw || '').trim();
        if (name) derived.add(name);
      });
    });
    hidden.forEach((name) => derived.delete(name));
    return sortNames(derived);
  }

  async function rememberPersonnelNames(names) {
    const s = await getSettings();
    const explicit = new Set(Array.isArray(s.personnelNames) ? s.personnelNames : []);
    const hidden = new Set(Array.isArray(s.hiddenPersonnelNames) ? s.hiddenPersonnelNames : []);
    let changed = false;
    (names || []).forEach((raw) => {
      const name = (raw || '').trim();
      if (!name) return;
      if (!explicit.has(name)) { explicit.add(name); changed = true; }
      if (hidden.has(name)) { hidden.delete(name); changed = true; } // 主動再次使用，優先於先前的隱藏
    });
    if (changed) {
      await updateSettings({ personnelNames: sortNames(explicit), hiddenPersonnelNames: Array.from(hidden) });
    }
    return getPersonnelNames();
  }

  async function deletePersonnelName(name) {
    const s = await getSettings();
    const explicit = (Array.isArray(s.personnelNames) ? s.personnelNames : []).filter((n) => n !== name);
    const hidden = new Set(Array.isArray(s.hiddenPersonnelNames) ? s.hiddenPersonnelNames : []);
    hidden.add(name);
    await updateSettings({ personnelNames: explicit, hiddenPersonnelNames: Array.from(hidden) });
    return getPersonnelNames();
  }

  async function renamePersonnelName(oldName, newName) {
    await deletePersonnelName(oldName); // 隱藏舊名字，避免又被歷史日誌撈回來
    const trimmed = (newName || '').trim();
    if (trimmed) await rememberPersonnelNames([trimmed]);
    return getPersonnelNames();
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  function dataUrlToBlob(dataUrl) {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
    const parts = dataUrl.split(',');
    const type = (parts[0].match(/^data:([^;]+)/) || [])[1] || 'application/octet-stream';
    const bytes = atob(parts[1] || '');
    const array = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i += 1) array[i] = bytes.charCodeAt(i);
    return new Blob([array], { type });
  }

  async function exportBackup() {
    const [projects, dailyLogs, todos, photos, settings] = await Promise.all([
      getAllProjectsRaw(), getAllDailyLogsRaw(), getAllTodosRaw(), getAllPhotosRaw(), getSettings()
    ]);
    const photosWithData = [];
    for (const photo of photos) {
      photosWithData.push(Object.assign({}, photo, { blob: undefined, dataUrl: await blobToDataUrl(photo.blob) }));
    }
    return { format: 'site-manager-backup', version: 1, exportedAt: Date.now(), projects, dailyLogs, todos, photos: photosWithData, settings };
  }

  function validateBackup(data) {
    if (!data || data.format !== 'site-manager-backup' || data.version !== 1) throw new Error('不是有效的工地管理備份檔');
    for (const key of ['projects', 'dailyLogs', 'todos', 'photos']) {
      if (!Array.isArray(data[key])) throw new Error(`備份缺少 ${key} 資料`);
      if (data[key].some((item) => !item || typeof item.id !== 'string')) throw new Error(`${key} 含有無效資料`);
    }
    return true;
  }

  async function importBackup(data) {
    validateBackup(data);
    let count = 0;
    for (const p of data.projects) { await mergeRecord('projects', p); count += 1; }
    for (const l of data.dailyLogs) { await mergeRecord('dailyLogs', l); count += 1; }
    for (const t of data.todos) { await mergeRecord('todos', t); count += 1; }
    for (const p of data.photos) {
      const blob = dataUrlToBlob(p.dataUrl);
      if (!blob) throw new Error(`照片 ${p.id} 缺少影像資料`);
      const clean = Object.assign({}, p, { blob, uploadedOnce: false });
      delete clean.dataUrl;
      await mergeRecord('photos', clean);
      count += 1;
    }
    if (data.settings && typeof data.settings === 'object') {
      await updateSettings({ companyName: String(data.settings.companyName || '') });
    }
    return count;
  }

  async function getStorageInfo() {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    return navigator.storage.estimate();
  }

  // ---------- 供同步使用：含已刪除項目的完整讀寫 ----------
  async function getAllProjectsRaw() { return getAllRaw('projects'); }
  async function getAllDailyLogsRaw() { return getAllRaw('dailyLogs'); }
  async function getAllTodosRaw() { return getAllRaw('todos'); }
  async function getAllPhotosRaw() { return getAllRaw('photos'); }

  // 依 updatedAt 做 last-write-wins 合併寫入；回傳是否真的寫入了（本機沒有或本機較舊）
  async function mergeRecord(storeName, incoming) {
    if (!incoming || !incoming.id) return false;
    const existing = await getById(storeName, incoming.id);
    if (existing && (existing.updatedAt || 0) >= (incoming.updatedAt || 0)) return false;
    await put(storeName, incoming);
    return true;
  }

  return {
    STATUS, uid, toDateStr,
    getProjects, getProject, addProject, updateProject, deleteProject, restoreProject,
    getDailyLogs, getDailyLog, getDailyLogByDate, addDailyLog, updateDailyLog, deleteDailyLog,
    getPhotos, getPhoto, addPhoto, updatePhoto, markPhotoUploaded, deletePhoto,
    addAnnotation, updateAnnotation, deleteAnnotation,
    getTodos, getTodo, addTodo, updateTodo, deleteTodo,
    getSettings, updateSettings, getPersonnelNames, rememberPersonnelNames, deletePersonnelName, renamePersonnelName, exportBackup, importBackup, validateBackup, getStorageInfo,
    getAllProjectsRaw, getAllDailyLogsRaw, getAllTodosRaw, getAllPhotosRaw, mergeRecord
  };
})();
