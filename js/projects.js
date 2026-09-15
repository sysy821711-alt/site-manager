// 專案總覽：工地清單、狀態篩選、新增/編輯/刪除工地表單
const Projects = (() => {
  let currentFilter = 'all';
  let editingId = null;

  async function renderList() {
    const listEl = document.getElementById('project-list');
    const emptyEl = document.getElementById('project-empty');
    const all = await DB.getProjects();
    emptyEl.classList.toggle('hidden', all.length > 0);
    const filtered = currentFilter === 'all' ? all : all.filter((p) => p.status === currentFilter);

    listEl.innerHTML = '';
    if (!filtered.length && all.length) {
      const note = document.createElement('p');
      note.className = 'text-muted filter-empty-note';
      note.textContent = '此狀態下沒有工地';
      listEl.appendChild(note);
    }

    for (const p of filtered) {
      const logs = await DB.getDailyLogs(p.id);
      const actualDates = new Set(logs.map((l) => l.date));
      const delayed = Gantt.isBehindSchedule({ project: p, actualDates });

      const card = document.createElement('div');
      card.className = 'project-card';
      const top = document.createElement('div');
      top.className = 'project-card-top';
      const h3 = document.createElement('h3');
      h3.textContent = p.name;
      const badge = document.createElement('span');
      badge.className = `status-badge status-${p.status}`;
      badge.textContent = App.statusLabel(p.status);
      top.appendChild(h3);
      top.appendChild(badge);
      card.appendChild(top);

      if (p.address) {
        const addr = document.createElement('p');
        addr.className = 'project-card-address';
        addr.textContent = p.address;
        card.appendChild(addr);
      }

      const meta = document.createElement('p');
      meta.className = 'project-card-meta';
      meta.textContent = `${p.plannedStart || '未定'} ~ ${p.plannedEnd || '未定'} · 實際到場 ${actualDates.size} 天`;
      if (delayed) {
        const tag = document.createElement('span');
        tag.className = 'delay-tag';
        tag.textContent = '進度落後';
        meta.appendChild(tag);
      }
      card.appendChild(meta);

      card.addEventListener('click', () => App.openProjectDetail(p.id));
      listEl.appendChild(card);
    }
  }

  function openForm(project) {
    editingId = project ? project.id : null;
    document.getElementById('project-form-title').textContent = project ? '編輯工地' : '新增工地';
    document.getElementById('project-name-input').value = project ? project.name : '';
    document.getElementById('project-address-input').value = project ? (project.address || '') : '';
    document.getElementById('project-status-input').value = project ? project.status : DB.STATUS.NOT_STARTED;
    document.getElementById('project-start-input').value = project ? (project.plannedStart || '') : '';
    document.getElementById('project-end-input').value = project ? (project.plannedEnd || '') : '';
    document.getElementById('project-note-input').value = project ? (project.note || '') : '';
    document.getElementById('project-delete-btn').classList.toggle('hidden', !project);
    App.showModal('project-form-modal');
  }

  async function handleFormSubmit(e) {
    e.preventDefault();
    const data = {
      name: document.getElementById('project-name-input').value.trim() || '未命名工地',
      address: document.getElementById('project-address-input').value.trim(),
      status: document.getElementById('project-status-input').value,
      plannedStart: document.getElementById('project-start-input').value || null,
      plannedEnd: document.getElementById('project-end-input').value || null,
      note: document.getElementById('project-note-input').value.trim()
    };
    if (editingId) {
      await DB.updateProject(editingId, data);
    } else {
      await DB.addProject(data);
    }
    App.hideModal('project-form-modal');
    App.notifyDataChanged();
    await App.refreshCurrentView();
  }

  async function handleDelete() {
    if (!editingId) return;
    if (!confirm('確定要刪除這個工地嗎？相關的日誌、照片、待辦都會一併刪除。')) return;
    await DB.deleteProject(editingId);
    App.hideModal('project-form-modal');
    App.notifyDataChanged();
    App.goToProjectList();
  }

  function setFilter(status) {
    currentFilter = status;
    document.querySelectorAll('#status-filter .filter-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.status === status);
    });
    renderList();
  }

  function bindEvents() {
    document.getElementById('project-form').addEventListener('submit', handleFormSubmit);
    document.getElementById('project-cancel-btn').addEventListener('click', () => App.hideModal('project-form-modal'));
    document.getElementById('project-delete-btn').addEventListener('click', handleDelete);
    document.getElementById('project-empty-add-btn').addEventListener('click', () => openForm(null));
    document.getElementById('add-project-btn').addEventListener('click', () => openForm(null));
    document.querySelectorAll('#status-filter .filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => setFilter(btn.dataset.status));
    });
  }

  return { renderList, openForm, bindEvents, getFilter: () => currentFilter };
})();
