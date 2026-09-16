// 施工日誌：每個工地每天的出工人員、實際天氣、重要事項
const DailyLog = (() => {
  let currentProjectId = null;
  let editingId = null;

  async function renderList(projectId) {
    currentProjectId = projectId;
    const listEl = document.getElementById('log-list');
    const emptyEl = document.getElementById('log-empty');
    const logs = await DB.getDailyLogs(projectId);
    emptyEl.classList.toggle('hidden', logs.length > 0);
    listEl.innerHTML = '';

    logs.forEach((log) => {
      const card = document.createElement('div');
      card.className = 'log-card';

      const top = document.createElement('div');
      top.className = 'log-card-top';
      const dateEl = document.createElement('strong');
      dateEl.textContent = log.date;
      const weatherEl = document.createElement('span');
      weatherEl.className = 'text-muted';
      weatherEl.textContent = log.weather || '';
      top.appendChild(dateEl);
      top.appendChild(weatherEl);
      card.appendChild(top);

      const personnelEl = document.createElement('p');
      personnelEl.className = 'log-personnel';
      personnelEl.textContent = (log.personnel && log.personnel.length) ? log.personnel.join('、') : '（未記錄人員）';
      card.appendChild(personnelEl);

      if (log.notes) {
        const notesEl = document.createElement('p');
        notesEl.className = 'log-notes';
        notesEl.textContent = log.notes;
        card.appendChild(notesEl);
      }

      card.addEventListener('click', () => openForm(log));
      listEl.appendChild(card);
    });
  }

  function openForm(log) {
    editingId = log ? log.id : null;
    document.getElementById('log-form-title').textContent = log ? '編輯日誌' : '新增日誌';
    document.getElementById('log-date-input').value = log ? log.date : DB.toDateStr(new Date());
    document.getElementById('log-personnel-input').value = log ? (log.personnel || []).join(', ') : '';
    document.getElementById('log-weather-input').value = log ? (log.weather || '') : '';
    document.getElementById('log-notes-input').value = log ? (log.notes || '') : '';
    document.getElementById('log-delete-btn').classList.toggle('hidden', !log);
    App.showModal('log-form-modal');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const personnel = document.getElementById('log-personnel-input').value
      .split(',').map((s) => s.trim()).filter(Boolean);
    const data = {
      projectId: currentProjectId,
      date: document.getElementById('log-date-input').value || DB.toDateStr(new Date()),
      personnel,
      weather: document.getElementById('log-weather-input').value,
      notes: document.getElementById('log-notes-input').value.trim()
    };
    const sameDate = await DB.getDailyLogByDate(currentProjectId, data.date);
    if (sameDate && sameDate.id !== editingId) {
      App.toast('同一天已有施工日誌，請編輯既有紀錄');
      return;
    }
    if (editingId) {
      await DB.updateDailyLog(editingId, data);
    } else {
      await DB.addDailyLog(data);
    }
    App.hideModal('log-form-modal');
    App.notifyDataChanged();
    await renderList(currentProjectId);
    App.refreshDetailGantt();
    App.refreshDetailAttendance();
  }

  async function handleDelete() {
    if (!editingId) return;
    if (!confirm('確定要刪除這筆日誌嗎？')) return;
    await DB.deleteDailyLog(editingId);
    App.hideModal('log-form-modal');
    App.notifyDataChanged();
    await renderList(currentProjectId);
    App.refreshDetailGantt();
    App.refreshDetailAttendance();
  }

  function bindEvents() {
    document.getElementById('log-form').addEventListener('submit', handleSubmit);
    document.getElementById('log-cancel-btn').addEventListener('click', () => App.hideModal('log-form-modal'));
    document.getElementById('log-delete-btn').addEventListener('click', handleDelete);
    document.getElementById('add-log-btn').addEventListener('click', () => openForm(null));
  }

  return { renderList, openForm, bindEvents };
})();
