// 人員出勤統計：從施工日誌的出工人員自動彙整，不需另外輸入。
// 共用給畫面上的「出勤統計」分頁，以及 PDF 報告的對應區塊。
const Attendance = (() => {
  function buildStats(logs) {
    const map = new Map();
    logs.forEach((log) => {
      (log.personnel || []).forEach((rawName) => {
        const name = (rawName || '').trim();
        if (!name) return;
        if (!map.has(name)) map.set(name, new Set());
        map.get(name).add(log.date);
      });
    });
    return Array.from(map.entries())
      .map(([name, datesSet]) => ({ name, dates: Array.from(datesSet).sort(), count: datesSet.size }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-Hant'));
  }

  // 同一份工地通常都在一年內，日期簡化成「月/日」比較好讀
  function shortDate(dateStr) {
    const parts = (dateStr || '').split('-');
    if (parts.length !== 3) return dateStr;
    return `${Number(parts[1])}/${Number(parts[2])}`;
  }

  // ---------- 畫面上的「出勤統計」分頁 ----------
  async function renderView(projectId) {
    const container = document.getElementById('attendance-table');
    const emptyEl = document.getElementById('attendance-empty');
    if (!container) return;
    const logs = await DB.getDailyLogs(projectId);
    const stats = buildStats(logs);

    container.innerHTML = '';
    emptyEl.classList.toggle('hidden', stats.length > 0);
    if (!stats.length) return;

    const header = document.createElement('div');
    header.className = 'attendance-row attendance-header';
    ['姓名', '出勤天數', '出勤日期'].forEach((text) => {
      const span = document.createElement('span');
      span.textContent = text;
      header.appendChild(span);
    });
    container.appendChild(header);

    stats.forEach((person) => {
      const row = document.createElement('div');
      row.className = 'attendance-row';

      const nameEl = document.createElement('span');
      nameEl.className = 'attendance-name';
      nameEl.textContent = person.name;

      const countEl = document.createElement('span');
      countEl.className = 'attendance-count';
      countEl.textContent = `${person.count} 天`;

      const datesEl = document.createElement('span');
      datesEl.className = 'attendance-dates';
      datesEl.textContent = person.dates.map(shortDate).join('、');

      row.appendChild(nameEl);
      row.appendChild(countEl);
      row.appendChild(datesEl);
      container.appendChild(row);
    });
  }

  return { buildStats, shortDate, renderView };
})();
