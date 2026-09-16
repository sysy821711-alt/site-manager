// App 殼層：畫面導覽、彈窗控制、跨模組串接
const App = (() => {
  const state = { view: 'projects', projectId: null, subtab: 'log' };
  let previouslyFocused = null;

  const VIEW_IDS = {
    projects: 'view-projects',
    gantt: 'view-gantt',
    settings: 'view-settings',
    detail: 'view-project-detail'
  };

  const VIEW_TITLES = { projects: '工地管理', gantt: '進度甘特圖', settings: '設定' };

  function statusLabel(status) {
    return { not_started: '未開始', in_progress: '進行中', done: '已完成' }[status] || status;
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function toast(msg, action) {
    const el = document.getElementById('toast');
    el.replaceChildren(document.createTextNode(msg));
    if (action && action.label && action.run) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'toast-action';
      button.textContent = action.label;
      button.addEventListener('click', async () => { clearTimeout(toastTimer); await action.run(); el.classList.add('hidden'); });
      el.appendChild(button);
    }
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2500);
  }

  // ---------- Modal helpers ----------
  function showModal(id) {
    previouslyFocused = document.activeElement;
    document.getElementById('modal-backdrop').classList.remove('hidden');
    const modal = document.getElementById(id);
    modal.classList.remove('hidden');
    requestAnimationFrame(() => {
      const focusable = modal.querySelector('input, select, textarea, button, [tabindex="0"]');
      if (focusable) focusable.focus();
    });
  }
  function hideModal(id) {
    document.getElementById(id).classList.add('hidden');
    const stillOpen = document.querySelector('.modal:not(.hidden)');
    document.getElementById('modal-backdrop').classList.toggle('hidden', !stillOpen);
    if (!stillOpen && previouslyFocused && previouslyFocused.focus) previouslyFocused.focus();
  }
  function bindBackdrop() {
    document.getElementById('modal-backdrop').addEventListener('click', () => {
      const open = document.querySelector('.modal:not(.hidden)');
      if (!open) return;
      if (open.id === 'photo-editor-modal') Photos.closeEditor();
      else hideModal(open.id);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const open = Array.from(document.querySelectorAll('.modal:not(.hidden)')).pop();
      if (!open) return;
      if (open.id === 'photo-editor-modal') Photos.closeEditor();
      else hideModal(open.id);
    });
  }

  // ---------- View switching ----------
  function showView(view) {
    state.view = view;
    Object.entries(VIEW_IDS).forEach(([key, id]) => {
      document.getElementById(id).classList.toggle('active', key === view);
    });
    document.getElementById('back-btn').classList.toggle('hidden', view !== 'detail');
    document.getElementById('bottom-nav').classList.toggle('hidden', view === 'detail');
    document.querySelectorAll('#bottom-nav .nav-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.view === view);
    });
    if (view !== 'detail') document.getElementById('header-title').textContent = VIEW_TITLES[view];
  }

  function goToProjectList() {
    showView('projects');
    Projects.renderList();
  }

  async function refreshCurrentView() {
    if (state.view === 'projects') await Projects.renderList();
    else if (state.view === 'gantt') await renderGanttOverview();
    else if (state.view === 'detail') await renderProjectDetail(state.projectId, { keepSubtab: true });
    else if (state.view === 'settings') await renderPersonnelManageList();
  }

  function notifyDataChanged() {
    Sync.scheduleSync();
    updatePendingLabel();
    updateStorageLabel();
  }

  // ---------- 甘特圖總覽（跨工地） ----------
  async function renderGanttOverview() {
    const projects = await DB.getProjects();
    const canvas = document.getElementById('gantt-canvas');
    const emptyEl = document.getElementById('gantt-empty');
    if (!projects.length) {
      emptyEl.classList.remove('hidden');
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      return;
    }
    emptyEl.classList.add('hidden');
    const dailyLogsByProject = {};
    for (const p of projects) dailyLogsByProject[p.id] = await DB.getDailyLogs(p.id);
    const rows = Gantt.buildRows(projects, dailyLogsByProject);
    Gantt.draw(canvas, rows, { width: canvas.parentElement.clientWidth - 4 });
  }

  // ---------- 工地詳細 ----------
  async function openProjectDetail(projectId) {
    state.projectId = projectId;
    state.subtab = 'log';
    showView('detail');
    await renderProjectDetail(projectId);
  }

  async function renderProjectDetail(projectId, opts = {}) {
    const project = await DB.getProject(projectId);
    if (!project) { goToProjectList(); return; }
    document.getElementById('detail-project-name').textContent = project.name;
    const badge = document.getElementById('detail-project-status');
    badge.textContent = statusLabel(project.status);
    badge.className = `status-badge status-${project.status}`;
    document.getElementById('header-title').textContent = project.name;

    const subtab = opts.keepSubtab ? state.subtab : 'log';
    setSubtab(subtab);
  }

  function setSubtab(subtab) {
    state.subtab = subtab;
    document.querySelectorAll('.subtab-btn').forEach((btn) => btn.classList.toggle('active', btn.dataset.subtab === subtab));
    document.querySelectorAll('.subtab-panel').forEach((panel) => panel.classList.toggle('active', panel.id === `subtab-${subtab}`));
    loadSubtabContent(subtab);
  }

  async function loadSubtabContent(subtab) {
    const projectId = state.projectId;
    if (subtab === 'log') await DailyLog.renderList(projectId);
    else if (subtab === 'gantt') await refreshDetailGantt();
    else if (subtab === 'attendance') await Attendance.renderView(projectId);
    else if (subtab === 'photos') await Photos.renderGrid(projectId);
    else if (subtab === 'todos') await Todos.renderList(projectId);
  }

  async function refreshDetailGantt() {
    if (state.view !== 'detail' || state.subtab !== 'gantt' || !state.projectId) return;
    const project = await DB.getProject(state.projectId);
    if (!project) return;
    const logs = await DB.getDailyLogs(project.id);
    const rows = Gantt.buildRows([project], { [project.id]: logs });
    const canvas = document.getElementById('detail-gantt-canvas');
    Gantt.draw(canvas, rows, { width: canvas.parentElement.clientWidth - 4, rowHeight: 48 });
    const row = rows[0];
    const statsEl = document.getElementById('detail-gantt-stats');
    statsEl.textContent = row.delayed ? '⚠ 進度落後於預排工期' : '目前進度正常';
    statsEl.classList.toggle('warning-text', row.delayed);
  }

  async function refreshDetailAttendance() {
    if (state.view !== 'detail' || state.subtab !== 'attendance' || !state.projectId) return;
    await Attendance.renderView(state.projectId);
  }

  // ---------- 設定／OneDrive 同步 ----------
  async function initSettingsUI() {
    const settings = await DB.getSettings();
    const companyInput = document.getElementById('settings-company');
    companyInput.value = settings.companyName || '';
    companyInput.addEventListener('change', async () => {
      await DB.updateSettings({ companyName: companyInput.value.trim() });
      notifyDataChanged();
    });

    document.getElementById('onedrive-login-btn').addEventListener('click', async () => {
      try {
        await Auth.login();
        await updateSyncUI();
        Sync.syncNow();
      } catch (err) {
        showSyncError(err.message || String(err));
      }
    });
    document.getElementById('onedrive-logout-btn').addEventListener('click', async () => {
      await Auth.logout();
      await updateSyncUI();
    });
    document.getElementById('sync-now-btn').addEventListener('click', () => Sync.syncNow());
    document.getElementById('backup-export-btn').addEventListener('click', exportBackup);
    document.getElementById('backup-import-input').addEventListener('change', importBackup);

    document.getElementById('personnel-add-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = document.getElementById('personnel-add-input');
      const name = input.value.trim();
      if (!name) return;
      await DB.rememberPersonnelNames([name]);
      input.value = '';
      await renderPersonnelManageList();
    });
    await renderPersonnelManageList();

    Sync.onStatusChange((status, err) => {
      const btn = document.getElementById('sync-now-btn');
      const errEl = document.getElementById('sync-error');
      btn.textContent = status === 'syncing' ? '同步中...' : '立即同步';
      btn.disabled = status === 'syncing';
      if (status === 'error') {
        errEl.textContent = '同步失敗：' + (err && err.message ? err.message : String(err));
        errEl.classList.remove('hidden');
      } else {
        errEl.classList.add('hidden');
      }
      if (status === 'success') {
        updateSyncTimeLabel();
        refreshCurrentView();
        toast('已完成同步');
      }
      updatePendingLabel();
    });

    await updateSyncUI();
    await updateStorageLabel();
    await updatePendingLabel();
  }

  async function renderPersonnelManageList() {
    const listEl = document.getElementById('personnel-manage-list');
    const emptyEl = document.getElementById('personnel-manage-empty');
    if (!listEl) return;
    const names = await DB.getPersonnelNames();
    emptyEl.classList.toggle('hidden', names.length > 0);
    listEl.innerHTML = '';
    names.forEach((name) => {
      const row = document.createElement('div');
      row.className = 'personnel-manage-row';

      const span = document.createElement('span');
      span.textContent = name;

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'icon-btn';
      editBtn.setAttribute('aria-label', `編輯 ${name}`);
      editBtn.textContent = '✎';
      editBtn.addEventListener('click', async () => {
        const next = prompt('編輯姓名', name);
        if (next == null) return;
        const trimmed = next.trim();
        if (!trimmed || trimmed === name) return;
        await DB.renamePersonnelName(name, trimmed);
        await renderPersonnelManageList();
        toast('已更新姓名');
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'icon-btn';
      deleteBtn.setAttribute('aria-label', `刪除 ${name}`);
      deleteBtn.textContent = '✕';
      deleteBtn.addEventListener('click', async () => {
        if (!confirm(`確定要從常用名單移除「${name}」嗎？（不會影響已存的施工日誌）`)) return;
        await DB.deletePersonnelName(name);
        await renderPersonnelManageList();
      });

      row.appendChild(span);
      row.appendChild(editBtn);
      row.appendChild(deleteBtn);
      listEl.appendChild(row);
    });
  }

  async function updatePendingLabel() {
    const el = document.getElementById('sync-pending');
    if (!el) return;
    const settings = await DB.getSettings();
    const since = settings.lastSyncAt || 0;
    const groups = await Promise.all([DB.getAllProjectsRaw(), DB.getAllDailyLogsRaw(), DB.getAllTodosRaw(), DB.getAllPhotosRaw()]);
    const count = groups.flat().filter((item) => (item.updatedAt || 0) > since || (item.blob && !item.uploadedOnce && !item.deletedAt)).length;
    el.textContent = Auth.getAccount() ? (count ? `尚有 ${count} 筆變更待同步` : '本機變更皆已同步') : '';
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return '未知';
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  async function updateStorageLabel() {
    const el = document.getElementById('storage-usage');
    if (!el) return;
    const info = await DB.getStorageInfo();
    el.textContent = info ? `已使用約 ${formatBytes(info.usage)}，可用配額 ${formatBytes(info.quota)}` : '此瀏覽器不提供儲存空間資訊';
  }

  async function exportBackup() {
    try {
      const data = await DB.exportBackup();
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `工地管理備份_${DB.toDateStr(new Date())}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('備份已匯出');
    } catch (err) { showSyncError('備份失敗：' + (err.message || String(err))); }
  }

  async function importBackup(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const count = await DB.importBackup(data);
      notifyDataChanged();
      await refreshCurrentView();
      toast(`已合併 ${count} 筆備份資料`);
    } catch (err) { showSyncError('匯入失敗：' + (err.message || String(err))); }
  }

  function showSyncError(msg) {
    const errEl = document.getElementById('sync-error');
    errEl.textContent = msg;
    errEl.classList.remove('hidden');
  }

  async function updateSyncUI() {
    const account = Auth.getAccount();
    const infoEl = document.getElementById('sync-account-info');
    const loginBtn = document.getElementById('onedrive-login-btn');
    const logoutBtn = document.getElementById('onedrive-logout-btn');
    const syncBtn = document.getElementById('sync-now-btn');
    if (!Auth.isConfigured()) {
      infoEl.textContent = '尚未設定 Azure App（見 README.md），OneDrive 同步功能暫不可用';
      loginBtn.classList.add('hidden');
      logoutBtn.classList.add('hidden');
      syncBtn.classList.add('hidden');
      return;
    }
    if (account) {
      infoEl.textContent = `已登入：${account.username || account.name || ''}`;
      loginBtn.classList.add('hidden');
      logoutBtn.classList.remove('hidden');
      syncBtn.classList.remove('hidden');
    } else {
      infoEl.textContent = '尚未登入';
      loginBtn.classList.remove('hidden');
      logoutBtn.classList.add('hidden');
      syncBtn.classList.add('hidden');
    }
    await updateSyncTimeLabel();
  }

  async function updateSyncTimeLabel() {
    const settings = await DB.getSettings();
    const el = document.getElementById('sync-last-time');
    el.textContent = settings.lastSyncAt ? `上次同步：${new Date(settings.lastSyncAt).toLocaleString('zh-TW')}` : '';
  }

  // ---------- PDF 報告匯出 ----------
  function bindReportButtons() {
    document.getElementById('export-full-report-btn').addEventListener('click', () => exportReport(false));
    document.getElementById('export-photo-report-btn').addEventListener('click', () => exportReport(true));
  }

  async function exportReport(photoOnly) {
    const statusEl = document.getElementById('report-status');
    const project = await DB.getProject(state.projectId);
    if (!project) return;
    statusEl.textContent = '報告產生中，請稍候...';
    try {
      let doc;
      if (photoOnly) {
        doc = await Report.generatePhotoOnly(project);
      } else {
        const opts = {
          includeLog: document.getElementById('report-include-log').checked,
          includeAttendance: document.getElementById('report-include-attendance').checked,
          includeGantt: document.getElementById('report-include-gantt').checked,
          includeTodos: document.getElementById('report-include-todos').checked,
          includePhotos: document.getElementById('report-include-photos').checked
        };
        doc = await Report.generate(project, opts);
      }
      const filename = `${project.name}_施工報告_${DB.toDateStr(new Date())}.pdf`;
      await Report.download(doc, filename);
      statusEl.textContent = '報告已產生並下載完成';
    } catch (err) {
      console.error('產生報告失敗', err);
      statusEl.textContent = '產生報告失敗：' + (err.message || String(err));
    }
  }

  // ---------- 導覽事件 ----------
  function bindNav() {
    document.querySelectorAll('#bottom-nav .nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        showView(btn.dataset.view);
        refreshCurrentView();
      });
    });
    document.getElementById('back-btn').addEventListener('click', goToProjectList);
    document.querySelectorAll('.subtab-btn').forEach((btn) => {
      btn.addEventListener('click', () => setSubtab(btn.dataset.subtab));
    });
    document.getElementById('edit-project-btn').addEventListener('click', async () => {
      const project = await DB.getProject(state.projectId);
      if (project) Projects.openForm(project);
    });
    document.getElementById('sync-status-btn').addEventListener('click', () => {
      showView('settings');
    });
    const onPhotoFilesChosen = async (e) => {
      await Photos.handleFiles(state.projectId, e.target.files);
      e.target.value = '';
      notifyDataChanged();
    };
    document.getElementById('photo-input').addEventListener('change', onPhotoFilesChosen);
    document.getElementById('photo-camera-input').addEventListener('change', onPhotoFilesChosen);
    document.getElementById('photo-editor-close-btn').addEventListener('click', () => Photos.closeEditor());
    document.getElementById('photo-editor-delete-btn').addEventListener('click', () => Photos.deleteCurrentPhoto());
  }

  // ---------- 初始化 ----------
  async function init() {
    Projects.bindEvents();
    DailyLog.bindEvents();
    Todos.bindEvents();
    Photos.bindPointerEvents();
    bindNav();
    bindBackdrop();
    bindReportButtons();

    await initSettingsUI();
    await Auth.init();
    await updateSyncUI();
    Sync.bindAutoSyncTriggers();
    if (Auth.getAccount()) Sync.syncNow();

    showView('projects');
    await Projects.renderList();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch((e) => console.error('Service worker 註冊失敗', e));
    }
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    showModal, hideModal, statusLabel, toast,
    openProjectDetail, goToProjectList, refreshCurrentView, notifyDataChanged, refreshDetailGantt, refreshDetailAttendance
  };
})();
