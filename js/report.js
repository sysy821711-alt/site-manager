// PDF 施工報告：完全在裝置端用 pdf-lib 組成，不經過任何伺服器。
// 用 @pdf-lib/fontkit 內嵌 Noto Sans TC 字型，產出的中文是真的可選取／可搜尋文字
// （不是把畫面截圖塞進 PDF），檔案小、列印清晰；照片用 JPEG 內嵌，標註用向量矩形疊在圖片上。
const Report = (() => {
  const { rgb } = window.PDFLib;

  const PAGE_W = 595.28; // A4 直向，pt
  const PAGE_H = 841.89;
  const MARGIN = 42;
  const CONTENT_W = PAGE_W - MARGIN * 2;

  const COLOR = {
    text: rgb(0.12, 0.14, 0.19),
    muted: rgb(0.48, 0.51, 0.60),
    primary: rgb(0.91, 0.53, 0.18),
    border: rgb(0.85, 0.86, 0.90),
    danger: rgb(0.97, 0.43, 0.31),
    white: rgb(1, 1, 1)
  };

  let fontBytesPromise = null;
  function loadFontBytes() {
    if (!fontBytesPromise) {
      fontBytesPromise = fetch('fonts/NotoSansTC-Regular.ttf').then((res) => {
        if (!res.ok) throw new Error('找不到中文字型檔 fonts/NotoSansTC-Regular.ttf');
        return res.arrayBuffer();
      });
    }
    return fontBytesPromise;
  }

  function statusLabel(status) {
    return { not_started: '未開始', in_progress: '進行中', done: '已完成' }[status] || status;
  }

  function formatDateTime(d) {
    const p2 = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
  }

  // 內嵌字型沒有 emoji／圖示字符的字形，畫進 PDF 會直接丟例外，先過濾掉避免整份報告產生失敗
  function sanitizeText(text) {
    return String(text == null ? '' : text)
      .replace(/\p{Extended_Pictographic}/gu, '')
      .replace(/[‍️⁦-⁩]/g, '');
  }

  function safeMeasure(font, text, size) {
    try { return font.widthOfTextAtSize(text, size); } catch (e) { return 0; }
  }

  function drawText(page, font, text, x, y, size, color) {
    const clean = sanitizeText(text);
    const opts = { x, y, size, font, color: color || COLOR.text };
    try {
      page.drawText(clean, opts);
    } catch (e) {
      const fallback = clean.replace(/[^\x00-\x7F　-鿿＀-￯]/g, '');
      try { page.drawText(fallback, opts); } catch (e2) { /* 放棄這行文字，不讓整份報告產生失敗 */ }
    }
  }

  function centerText(page, font, text, centerX, y, size, color) {
    const clean = sanitizeText(text);
    const w = safeMeasure(font, clean, size);
    drawText(page, font, clean, centerX - w / 2, y, size, color);
  }

  // 中文沒有空白可斷行，逐字元量測寬度來換行
  function wrapText(font, text, size, maxWidth) {
    const clean = sanitizeText(text);
    const lines = [];
    clean.split('\n').forEach((para) => {
      if (!para) { lines.push(''); return; }
      let line = '';
      for (const ch of para) {
        const test = line + ch;
        if (line && safeMeasure(font, test, size) > maxWidth) {
          lines.push(line);
          line = ch;
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);
    });
    return lines;
  }

  function drawParagraph(page, font, text, x, y, maxWidth, size, lineHeight, color) {
    const lines = wrapText(font, text, size, maxWidth);
    lines.forEach((line, i) => drawText(page, font, line, x, y - lineHeight * i, size, color));
    return y - lineHeight * lines.length;
  }

  // ---------- 頁面游標（自動分頁） ----------
  function makeCtx(pdfDoc, font, project, settings) {
    const ctx = { pdfDoc, font, project, settings, page: null, y: 0 };
    ctx.newPage = () => {
      ctx.page = pdfDoc.addPage([PAGE_W, PAGE_H]);
      ctx.y = PAGE_H - MARGIN;
      return ctx.page;
    };
    ctx.ensureSpace = (h, continued) => {
      if (ctx.y - h < MARGIN + 24) {
        ctx.newPage();
        if (typeof continued === 'function') continued();
        else if (continued) ctx.heading(continued);
      }
    };
    ctx.heading = (text) => {
      drawText(ctx.page, ctx.font, text, MARGIN, ctx.y, 15, COLOR.text);
      ctx.page.drawLine({ start: { x: MARGIN, y: ctx.y - 6 }, end: { x: MARGIN + 60, y: ctx.y - 6 }, thickness: 2, color: COLOR.primary });
      ctx.y -= 30;
    };
    return ctx;
  }

  // ---------- 封面 ----------
  function drawCover(ctx) {
    const { page, font, project, settings } = ctx;
    let y = PAGE_H - 220;
    centerText(page, font, '施工報告', PAGE_W / 2, y, 16, COLOR.muted);
    y -= 40;
    centerText(page, font, project.name, PAGE_W / 2, y, 24, COLOR.text);
    y -= 34;
    if (project.address) { centerText(page, font, project.address, PAGE_W / 2, y, 11, COLOR.muted); y -= 20; }
    centerText(page, font, `狀態：${statusLabel(project.status)}`, PAGE_W / 2, y, 11, COLOR.muted);
    y -= 20;
    if (project.plannedStart || project.plannedEnd) {
      centerText(page, font, `預排工期：${project.plannedStart || '未定'} ~ ${project.plannedEnd || '未定'}`, PAGE_W / 2, y, 11, COLOR.muted);
      y -= 20;
    }
    if (settings.companyName) {
      centerText(page, font, settings.companyName, PAGE_W / 2, 140, 13, COLOR.text);
    }
    centerText(page, font, `報告產生時間：${formatDateTime(new Date())}`, PAGE_W / 2, 100, 9, COLOR.muted);
  }

  // ---------- 施工日誌 ----------
  async function drawLogs(ctx, logs) {
    if (!logs.length) {
      ctx.y = drawParagraph(ctx.page, ctx.font, '（尚無日誌紀錄）', MARGIN, ctx.y, CONTENT_W, 10, 14, COLOR.muted);
      return;
    }
    for (const log of logs) {
      const personnelText = (log.personnel || []).join('、') || '（未記錄人員）';
      const noteLines = log.notes ? wrapText(ctx.font, log.notes, 10, CONTENT_W - 8) : [];
      const blockHeight = 18 + 16 + Math.max(0, noteLines.length) * 13 + 20;
      ctx.ensureSpace(blockHeight, '施工日誌（續）');
      const page = ctx.page;
      drawText(page, ctx.font, log.date, MARGIN, ctx.y, 12, COLOR.primary);
      drawText(page, ctx.font, log.weather || '（未記錄天氣）', MARGIN + 90, ctx.y, 10, COLOR.muted);
      ctx.y -= 18;
      drawText(page, ctx.font, `出工人員：${personnelText}`, MARGIN + 6, ctx.y, 10, COLOR.text);
      ctx.y -= 16;
      if (log.notes) {
        ctx.y = drawParagraph(page, ctx.font, log.notes, MARGIN + 6, ctx.y, CONTENT_W - 8, 10, 13, COLOR.text);
      }
      ctx.y -= 4;
      page.drawLine({ start: { x: MARGIN, y: ctx.y }, end: { x: PAGE_W - MARGIN, y: ctx.y }, thickness: 0.5, color: COLOR.border });
      ctx.y -= 16;
    }
  }

  // ---------- 人員出勤統計（從施工日誌的出工人員自動彙整，不需另外輸入） ----------
  function buildAttendanceStats(logs) {
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

  // 同一份報告通常都在一年內，日期簡化成「月/日」比較好讀
  function shortDate(dateStr) {
    const parts = (dateStr || '').split('-');
    if (parts.length !== 3) return dateStr;
    return `${Number(parts[1])}/${Number(parts[2])}`;
  }

  const ATTEND_COL_NAME = MARGIN;
  const ATTEND_COL_DAYS = MARGIN + 90;
  const ATTEND_COL_DATES = MARGIN + 160;
  const ATTEND_COL_DATES_W = CONTENT_W - 160;

  function drawAttendanceHeader(ctx) {
    drawText(ctx.page, ctx.font, '姓名', ATTEND_COL_NAME, ctx.y, 10, COLOR.muted);
    drawText(ctx.page, ctx.font, '出勤天數', ATTEND_COL_DAYS, ctx.y, 10, COLOR.muted);
    drawText(ctx.page, ctx.font, '出勤日期', ATTEND_COL_DATES, ctx.y, 10, COLOR.muted);
    ctx.y -= 8;
    ctx.page.drawLine({ start: { x: MARGIN, y: ctx.y }, end: { x: PAGE_W - MARGIN, y: ctx.y }, thickness: 0.8, color: COLOR.border });
    ctx.y -= 16;
  }

  function drawAttendance(ctx, logs) {
    const stats = buildAttendanceStats(logs);
    if (!stats.length) {
      ctx.y = drawParagraph(ctx.page, ctx.font, '（尚無出勤紀錄）', MARGIN, ctx.y, CONTENT_W, 10, 14, COLOR.muted);
      return;
    }
    drawAttendanceHeader(ctx);
    stats.forEach((person) => {
      const datesText = person.dates.map(shortDate).join('、');
      const dateLines = wrapText(ctx.font, datesText, 9, ATTEND_COL_DATES_W);
      const rowHeight = Math.max(1, dateLines.length) * 13 + 12;
      ctx.ensureSpace(rowHeight, () => {
        ctx.heading('人員出勤統計（續）');
        drawAttendanceHeader(ctx);
      });
      const page = ctx.page;
      const rowTop = ctx.y;
      drawText(page, ctx.font, person.name, ATTEND_COL_NAME, rowTop, 11, COLOR.text);
      drawText(page, ctx.font, `${person.count} 天`, ATTEND_COL_DAYS, rowTop, 11, COLOR.primary);
      dateLines.forEach((line, i) => drawText(page, ctx.font, line, ATTEND_COL_DATES, rowTop - i * 13, 9, COLOR.muted));
      ctx.y = rowTop - rowHeight + 4;
      page.drawLine({ start: { x: MARGIN, y: ctx.y }, end: { x: PAGE_W - MARGIN, y: ctx.y }, thickness: 0.4, color: COLOR.border });
      ctx.y -= 12;
    });
  }

  // ---------- 待辦事項 ----------
  function drawTodos(ctx, todos) {
    if (!todos.length) {
      ctx.y = drawParagraph(ctx.page, ctx.font, '（尚無待辦事項）', MARGIN, ctx.y, CONTENT_W, 10, 14, COLOR.muted);
      return;
    }
    todos.forEach((todo) => {
      ctx.ensureSpace(20, '待辦事項（續）');
      const mark = todo.done ? '[x]' : '[ ]';
      drawText(ctx.page, ctx.font, `${mark}  ${todo.text}`, MARGIN + 4, ctx.y, 11, todo.done ? COLOR.muted : COLOR.text);
      ctx.y -= 20;
    });
  }

  // ---------- 甘特圖（沿用畫面上同一份 Gantt 繪圖邏輯，轉成圖片內嵌） ----------
  async function canvasToPngBytes(canvas) {
    const res = await fetch(canvas.toDataURL('image/png'));
    return new Uint8Array(await res.arrayBuffer());
  }

  async function drawGanttSection(ctx, logs) {
    const rows = Gantt.buildRows([ctx.project], { [ctx.project.id]: logs });
    const canvas = document.createElement('canvas');
    const drawn = Gantt.draw(canvas, rows, { width: 900, rowHeight: 60 });
    if (drawn) {
      const pngBytes = await canvasToPngBytes(canvas);
      const img = await ctx.pdfDoc.embedPng(pngBytes);
      const w = CONTENT_W;
      const h = w * (canvas.height / canvas.width);
      ctx.ensureSpace(h + 20);
      ctx.page.drawImage(img, { x: MARGIN, y: ctx.y - h, width: w, height: h });
      ctx.y -= h + 24;
    }

    const row = rows[0];
    const ps = ctx.project.plannedStart ? new Date(ctx.project.plannedStart + 'T00:00:00') : null;
    const pe = ctx.project.plannedEnd ? new Date(ctx.project.plannedEnd + 'T00:00:00') : null;
    const plannedDays = ps && pe ? Math.round((pe - ps) / 86400000) + 1 : null;
    const actualDays = row ? row.actualDates.size : 0;

    const lines = [
      `預排工期：${ctx.project.plannedStart || '未定'} ~ ${ctx.project.plannedEnd || '未定'}${plannedDays ? `（共 ${plannedDays} 天）` : ''}`,
      `實際到場天數：${actualDays} 天`,
      row && row.delayed ? '注意：進度落後於預排工期' : '目前進度正常'
    ];
    lines.forEach((line, i) => {
      ctx.ensureSpace(18);
      drawText(ctx.page, ctx.font, line, MARGIN, ctx.y, 11, i === 2 && row && row.delayed ? COLOR.danger : COLOR.text);
      ctx.y -= 18;
    });
  }

  // ---------- 照片（原圖內嵌 JPEG，標註以向量圖形疊在圖片上，非破壞、放大也清楚） ----------
  async function photoToJpegBytes(photo, maxW) {
    const url = URL.createObjectURL(photo.blob);
    let img;
    try {
      img = await Photos.loadImage(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const scale = Math.min(1, maxW / img.naturalWidth);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const res = await fetch(canvas.toDataURL('image/jpeg', 0.85));
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { bytes, width: w, height: h };
  }

  function drawPhotoAnnotations(page, font, annotations, imgX, imgY, imgW, imgH) {
    (annotations || []).forEach((a, idx) => {
      const rx = imgX + a.x * imgW;
      const rw = a.w * imgW;
      const rh = a.h * imgH;
      const ry = imgY + imgH - a.y * imgH - rh;
      page.drawRectangle({ x: rx, y: ry, width: rw, height: rh, borderColor: COLOR.danger, borderWidth: 1.5 });
      const badgeSize = 15;
      const by = ry + rh;
      page.drawRectangle({ x: rx, y: by, width: badgeSize, height: badgeSize, color: COLOR.danger });
      const label = String(idx + 1);
      const lw = safeMeasure(font, label, 9);
      drawText(page, font, label, rx + (badgeSize - lw) / 2, by + 5, 9, COLOR.white);
    });
  }

  async function drawPhotoPage(ctx, photo) {
    const { bytes, width, height } = await photoToJpegBytes(photo, 1400);
    const img = await ctx.pdfDoc.embedJpg(bytes);
    const maxW = CONTENT_W;
    const maxH = 340;
    const scale = Math.min(maxW / width, maxH / height, 1);
    const w = width * scale;
    const h = height * scale;
    const x = MARGIN + (CONTENT_W - w) / 2;
    ctx.ensureSpace(h + 10);
    const y = ctx.y - h;
    ctx.page.drawImage(img, { x, y, width: w, height: h });
    drawPhotoAnnotations(ctx.page, ctx.font, photo.annotations, x, y, w, h);
    ctx.y = y - 18;

    if (photo.caption) {
      ctx.y = drawParagraph(ctx.page, ctx.font, photo.caption, MARGIN, ctx.y, CONTENT_W, 11, 15, COLOR.text);
      ctx.y -= 4;
    }
    if (photo.takenAt) {
      drawText(ctx.page, ctx.font, formatDateTime(new Date(photo.takenAt)), MARGIN, ctx.y, 8, COLOR.muted);
      ctx.y -= 18;
    }
    (photo.annotations || []).forEach((a, idx) => {
      ctx.ensureSpace(16);
      ctx.y = drawParagraph(ctx.page, ctx.font, `${idx + 1}. ${a.note || '（無備註）'}`, MARGIN, ctx.y, CONTENT_W, 10, 14, COLOR.danger);
    });
  }

  // ---------- 浮水印／頁碼（所有頁面內容都畫完後，最後統一加上） ----------
  function drawWatermark(page, font, text) {
    const clean = sanitizeText(text);
    if (!clean) return;
    const size = 14;
    const w = safeMeasure(font, clean, size);
    try {
      page.drawText(clean, { x: PAGE_W / 2 - w / 2, y: 58, size, font, color: rgb(0.55, 0.55, 0.55), opacity: 0.35 });
    } catch (e) { /* 浮水印非必要內容，畫不出來就略過 */ }
  }

  function drawFooterLine(page, font, project, pageNum, total) {
    drawText(page, font, project.name, MARGIN, 24, 8, COLOR.muted);
    const label = `${pageNum} / ${total}`;
    const w = safeMeasure(font, label, 8);
    drawText(page, font, label, PAGE_W - MARGIN - w, 24, 8, COLOR.muted);
  }

  function finalizePages(pdfDoc, font, project, settings) {
    const pages = pdfDoc.getPages();
    pages.forEach((page, i) => {
      drawWatermark(page, font, settings.companyName);
      drawFooterLine(page, font, project, i + 1, pages.length);
    });
  }

  async function createDoc(project) {
    const settings = await DB.getSettings();
    const fontBytes = await loadFontBytes();
    const pdfDoc = await window.PDFLib.PDFDocument.create();
    pdfDoc.registerFontkit(window.fontkit);
    // subset:false — pdf-lib 的中文字型子集化功能有已知 bug 會漏字形，改成內嵌完整字型檔（檔案較大但顯示正確）
    const font = await pdfDoc.embedFont(fontBytes, { subset: false });
    return makeCtx(pdfDoc, font, project, settings);
  }

  async function generate(project, opts = {}) {
    const ctx = await createDoc(project);
    ctx.newPage();
    drawCover(ctx);

    if (opts.includeLog) {
      ctx.newPage();
      ctx.heading('施工日誌');
      await drawLogs(ctx, await DB.getDailyLogs(project.id));
    }
    if (opts.includeAttendance) {
      ctx.newPage();
      ctx.heading('人員出勤統計');
      drawAttendance(ctx, await DB.getDailyLogs(project.id));
    }
    if (opts.includeGantt) {
      ctx.newPage();
      ctx.heading('進度甘特圖');
      await drawGanttSection(ctx, await DB.getDailyLogs(project.id));
    }
    if (opts.includeTodos) {
      ctx.newPage();
      ctx.heading('待辦事項');
      const todos = (await DB.getTodos(project.id)).filter((t) => t.includeInReport !== false);
      drawTodos(ctx, todos);
    }
    if (opts.includePhotos) {
      const photos = await DB.getPhotos(project.id);
      for (const photo of photos) {
        ctx.newPage();
        ctx.heading('工地照片');
        await drawPhotoPage(ctx, photo);
      }
    }

    finalizePages(ctx.pdfDoc, ctx.font, project, ctx.settings);
    return ctx.pdfDoc;
  }

  async function generatePhotoOnly(project) {
    const ctx = await createDoc(project);
    ctx.newPage();
    drawCover(ctx);

    const photos = await DB.getPhotos(project.id);
    for (const photo of photos) {
      ctx.newPage();
      ctx.heading('工地照片');
      await drawPhotoPage(ctx, photo);
    }

    finalizePages(ctx.pdfDoc, ctx.font, project, ctx.settings);
    return ctx.pdfDoc;
  }

  async function download(pdfDoc, filename) {
    const bytes = await pdfDoc.save();
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  return { generate, generatePhotoOnly, download };
})();
