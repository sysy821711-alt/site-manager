// 甘特圖：因為使用者是單一工種，不拆工項，每個工地畫一列，
// 淺色長條 = 預排工期（project.plannedStart ~ plannedEnd），深色格子 = 實際到場天（來自施工日誌日期，自動統計，不需手動關聯）。
const Gantt = (() => {
  function parseDate(s) {
    if (!s) return null;
    const d = new Date(s + 'T00:00:00');
    return isNaN(d.getTime()) ? null : d;
  }

  function addDays(d, n) {
    const r = new Date(d);
    r.setDate(r.getDate() + n);
    return r;
  }

  function daysBetween(a, b) {
    return Math.round((b - a) / 86400000);
  }

  function fmt(d) {
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }

  function today0() {
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    return t;
  }

  // rows: [{ project, actualDates: Set<'YYYY-MM-DD'>, totalManDays }]
  // actualDates（不重複日期）驅動進度條上的格子與落後判斷；totalManDays（總工數，把每天出工人數加總）只用於列標籤顯示。
  function buildRows(projects, dailyLogsByProject) {
    return projects.map((project) => {
      const logs = dailyLogsByProject[project.id] || [];
      const actualDates = new Set(logs.map((l) => l.date));
      const totalManDays = logs.reduce((sum, log) => {
        const count = Array.isArray(log.personnel) ? log.personnel.filter((n) => (n || '').trim()).length : 0;
        return sum + count;
      }, 0);
      const row = { project, actualDates, totalManDays };
      row.delayed = isBehindSchedule(row);
      return row;
    });
  }

  // 進度落差判斷：已過預排完工日仍未完工，或已過天數比例明顯超前實際到場比例
  function isBehindSchedule(row) {
    const p = row.project;
    if (p.status === DB.STATUS.DONE) return false;
    const ps = parseDate(p.plannedStart);
    const pe = parseDate(p.plannedEnd);
    const today = today0();
    if (pe && today > pe) return true;
    if (ps && pe && today >= ps) {
      const totalPlanned = Math.max(1, daysBetween(ps, pe) + 1);
      const elapsed = Math.min(totalPlanned, daysBetween(ps, today) + 1);
      const expectedRatio = elapsed / totalPlanned;
      const actualRatio = row.actualDates.size / totalPlanned;
      if (expectedRatio - actualRatio > 0.3) return true;
    }
    return false;
  }

  function computeRange(rows) {
    let min = null;
    let max = null;
    const today = today0();
    rows.forEach((r) => {
      const ps = parseDate(r.project.plannedStart);
      const pe = parseDate(r.project.plannedEnd);
      if (ps && (!min || ps < min)) min = ps;
      if (pe && (!max || pe > max)) max = pe;
      r.actualDates.forEach((ds) => {
        const d = parseDate(ds);
        if (d && (!min || d < min)) min = d;
        if (d && (!max || d > max)) max = d;
      });
    });
    if (!min) min = today;
    if (!max) max = today;
    if (max < min) max = min;
    min = addDays(min, -1);
    max = addDays(max, 2);
    return { min, max };
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, Math.abs(w) / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  // 畫到 canvas 上；rows 為空陣列時回傳 null。
  // includeLabels=false 時完全不畫左側名稱欄（畫面上用 renderLabels() 另外畫成固定不捲動的 DOM，
  // 只有時間軸本身可以橫向捲動）；PDF report.js 仍用預設 true，把名稱和時間軸畫在同一張圖裡。
  function draw(canvas, rows, opts = {}) {
    if (!rows.length) return null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rowH = opts.rowHeight || 38;
    const includeLabels = opts.includeLabels !== false;
    const labelW = includeLabels ? (opts.labelWidth || 128) : 0;
    const headerH = 24;
    const paddingR = 20;
    const width = Math.max(320, opts.width || canvas.clientWidth || 600);
    const { min, max } = computeRange(rows);
    const totalDays = Math.max(1, daysBetween(min, max));
    const minDayW = 30; // 改成每天都顯示日期，欄位要留夠寬度放下文字
    const chartW = Math.max(width - labelW - paddingR, totalDays * minDayW);
    const dayW = chartW / totalDays;
    const fullWidth = labelW + chartW + paddingR;
    const height = headerH + rows.length * rowH + 10;

    canvas.width = fullWidth * dpr;
    canvas.height = height * dpr;
    canvas.style.width = fullWidth + 'px';
    canvas.style.height = height + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, fullWidth, height);

    const xOf = (d) => labelW + daysBetween(min, d) * dayW;

    // 每天一條格線＋日期標籤；月份變化才顯示「M/D」，同月份只顯示日數，避免擠成一團
    ctx.font = '11px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.lineWidth = 1;
    let prevMonth = null;
    let cursor = new Date(min);
    while (cursor <= max) {
      const x = xOf(cursor);
      if (x >= labelW) {
        const isWeekStart = cursor.getDay() === 0;
        ctx.strokeStyle = isWeekStart ? '#C7CCDA' : '#EEF0F5';
        ctx.beginPath();
        ctx.moveTo(x, headerH);
        ctx.lineTo(x, height);
        ctx.stroke();
        const month = cursor.getMonth() + 1;
        const label = month !== prevMonth ? fmt(cursor) : String(cursor.getDate());
        ctx.fillStyle = '#7A8299';
        ctx.fillText(label, x + dayW / 2, headerH / 2);
        prevMonth = month;
      }
      cursor = addDays(cursor, 1);
    }

    // 每列
    rows.forEach((r, i) => {
      const y = headerH + i * rowH;
      const cy = y + rowH / 2;
      if (includeLabels) {
        ctx.fillStyle = '#1F2430';
        ctx.font = '13px sans-serif';
        ctx.textAlign = 'left';
        const name = r.project.name.length > 6 ? r.project.name.slice(0, 5) + '…' : r.project.name;
        ctx.fillText(`${name}（${r.totalManDays}工）`, 4, cy);
      }

      const ps = parseDate(r.project.plannedStart);
      const pe = parseDate(r.project.plannedEnd);

      if (ps && pe) {
        const x1 = xOf(ps);
        const x2 = xOf(addDays(pe, 1));
        ctx.fillStyle = r.delayed ? 'rgba(247,110,79,0.20)' : 'rgba(232,134,46,0.20)';
        roundRect(ctx, x1, cy - 10, Math.max(3, x2 - x1), 20, 6);
        ctx.fill();
        if (r.delayed) {
          ctx.strokeStyle = '#F76E4F';
          ctx.lineWidth = 1.5;
          roundRect(ctx, x1, cy - 10, Math.max(3, x2 - x1), 20, 6);
          ctx.stroke();
        }
      }

      ctx.fillStyle = '#3A70D6';
      r.actualDates.forEach((ds) => {
        const d = parseDate(ds);
        if (!d) return;
        const x = xOf(d);
        ctx.fillRect(x + 1, cy - 6, Math.max(2, dayW - 2), 12);
      });
    });

    // 今天紅線
    const t = today0();
    if (t >= min && t <= max) {
      const x = xOf(t);
      ctx.strokeStyle = '#F76E4F';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x, headerH);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    return { min, max, width: fullWidth, height };
  }

  // 畫面上固定不捲動的名稱欄：跟時間軸一樣畫在 canvas 上（而不是用 DOM），
  // 用完全相同的 headerH／rowH 算法，確保每一列的垂直位置跟時間軸 canvas 逐像素對齊，
  // 不會受不同瀏覽器的字型高度、box model 差異影響而跑掉（DOM 版本在 iOS Safari 上對不齊過）。
  function drawLabels(canvas, rows, opts = {}) {
    if (!rows.length) { canvas.width = 0; canvas.height = 0; return null; }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rowH = opts.rowHeight || 38;
    const headerH = 24;
    const width = opts.width || 128;
    const height = headerH + rows.length * rowH + 10;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    rows.forEach((r, i) => {
      const cy = headerH + i * rowH + rowH / 2;
      ctx.fillStyle = '#1F2430';
      ctx.font = '13px sans-serif';
      const name = r.project.name.length > 6 ? r.project.name.slice(0, 5) + '…' : r.project.name;
      ctx.fillText(`${name}（${r.totalManDays}工）`, 4, cy);
    });

    return { width, height };
  }

  return { draw, drawLabels, buildRows, isBehindSchedule };
})();
