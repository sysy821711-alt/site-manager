// 施工日誌：每個工地每天的出工人員、實際天氣、重要事項
const DailyLog = (() => {
  let currentProjectId = null;
  let editingId = null;
  let personnelTags = [];
  let knownPersonnelNames = [];

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

  // ---------- 出工人員 tag input（記憶輸入：從 datalist 選或打完按 Enter，統一存成陣列） ----------
  function renderPersonnelTags() {
    const container = document.getElementById('log-personnel-tags');
    const input = document.getElementById('log-personnel-tag-input');
    container.querySelectorAll('.tag-pill').forEach((el) => el.remove());
    personnelTags.forEach((name) => {
      const pill = document.createElement('span');
      pill.className = 'tag-pill';
      const text = document.createElement('span');
      text.textContent = name;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'tag-pill-remove';
      removeBtn.setAttribute('aria-label', `移除 ${name}`);
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => {
        personnelTags = personnelTags.filter((n) => n !== name);
        renderPersonnelTags();
      });
      pill.appendChild(text);
      pill.appendChild(removeBtn);
      container.insertBefore(pill, input);
    });
  }

  function commitPersonnelTag(rawValue) {
    const input = document.getElementById('log-personnel-tag-input');
    const value = (rawValue != null ? rawValue : input.value).trim();
    input.value = '';
    if (!value || personnelTags.includes(value)) return;
    personnelTags.push(value);
    renderPersonnelTags();
  }

  let personnelTagInputBound = false;
  function bindPersonnelTagInput() {
    const input = document.getElementById('log-personnel-tag-input');
    if (personnelTagInputBound) return;
    personnelTagInputBound = true;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        commitPersonnelTag();
      } else if (e.key === 'Backspace' && !input.value && personnelTags.length) {
        personnelTags.pop();
        renderPersonnelTags();
      }
    });
    // 從 datalist 點選建議名字時，值會直接變成完全相符 → 立刻收成一個 tag，不用再按 Enter
    input.addEventListener('input', () => {
      const val = input.value.trim();
      if (val && knownPersonnelNames.includes(val)) commitPersonnelTag(val);
    });
    input.addEventListener('blur', () => commitPersonnelTag());
  }

  async function openForm(log) {
    editingId = log ? log.id : null;
    document.getElementById('log-form-title').textContent = log ? '編輯日誌' : '新增日誌';
    document.getElementById('log-date-input').value = log ? log.date : DB.toDateStr(new Date());
    document.getElementById('log-weather-input').value = log ? (log.weather || '') : '';
    document.getElementById('log-notes-input').value = log ? (log.notes || '') : '';
    document.getElementById('log-delete-btn').classList.toggle('hidden', !log);

    personnelTags = log ? (log.personnel || []).slice() : [];
    document.getElementById('log-personnel-tag-input').value = '';
    renderPersonnelTags();

    knownPersonnelNames = await DB.getPersonnelNames();
    const datalist = document.getElementById('personnel-suggestions');
    datalist.innerHTML = '';
    knownPersonnelNames.forEach((name) => {
      const opt = document.createElement('option');
      opt.value = name;
      datalist.appendChild(opt);
    });
    bindPersonnelTagInput();

    App.showModal('log-form-modal');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    commitPersonnelTag();
    const personnel = personnelTags.slice();
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
    if (personnel.length) await DB.rememberPersonnelNames(personnel);
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
