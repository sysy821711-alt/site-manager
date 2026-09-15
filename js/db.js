// IndexedDB 存取層：工地 (projects)、施工日誌 (dailyLogs)、照片 (photos)、待辦 (todos)、設定 (settings)
// 照片用 Blob 直接存進 IndexedDB（比 localStorage 適合存大檔案）。
const DB = (() => {
  const DB_NAME = 'siteManagerDB';
  const DB_VERSION = 1;
  const STATUS = { NOT_STARTED: 'not_started', IN_PROGRESS: 'in_progress', DONE: 'done' };

  let dbPromise = null;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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
    await promisifyRequest((await store(storeName, 'readwrite')).put(value));
    return value;
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
    await updateProject(id, { deletedAt: Date.now() });
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
    return todos.filter(t => !t.deletedAt).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  async function getTodo(id) {
    return getById('todos', id);
  }

  async function addTodo({ projectId, text, photoId } = {}) {
    const now = Date.now();
    const todo = {
      id: uid(),
      projectId,
      text: text || '',
      done: false,
      photoId: photoId || null,
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
    getProjects, getProject, addProject, updateProject, deleteProject,
    getDailyLogs, getDailyLog, getDailyLogByDate, addDailyLog, updateDailyLog, deleteDailyLog,
    getPhotos, getPhoto, addPhoto, updatePhoto, deletePhoto,
    addAnnotation, updateAnnotation, deleteAnnotation,
    getTodos, getTodo, addTodo, updateTodo, deleteTodo,
    getSettings, updateSettings,
    getAllProjectsRaw, getAllDailyLogsRaw, getAllTodosRaw, getAllPhotosRaw, mergeRecord
  };
})();
