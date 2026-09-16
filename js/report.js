// PDF 施工報告：完全在裝置端用 pdf-lib 組成，不經過任何伺服器。
// 用 @pdf-lib/fontkit 內嵌 Noto Sans TC 字型，產出的中文是真的可選取／可搜尋文字
// （不是把畫面截圖塞進 PDF），檔案小、列印清晰；照片用 JPEG 內嵌，標註用向量矩形疊在圖片上。
const Report = (() => {
  const { rgb } = window.PDFLib;

  const PAGE_W = 841.89; // A4 橫向，pt
  const PAGE_H = 595.28;
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

  // ---------- 人員出勤統計（統計邏輯共用 js/attendance.js，跟畫面上的出勤統計分頁一致） ----------
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
    const stats = Attendance.buildStats(logs);
    if (!stats.length) {
      ctx.y = drawParagraph(ctx.page, ctx.font, '（尚無出勤紀錄）', MARGIN, ctx.y, CONTENT_W, 10, 14, COLOR.muted);
      return;
    }
    drawAttendanceHeader(ctx);
    stats.forEach((person) => {
      const datesText = person.dates.map(Attendance.shortDate).join('、');
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

  // canvas -> bytes：用 toBlob 而不是 fetch(data:URL)，避免嚴格 CSP 環境擋掉 data: 請求
  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('canvas 轉檔失敗'))), type, quality);
    });
  }

  // ---------- 甘特圖（沿用畫面上同一份 Gantt 繪圖邏輯，轉成圖片內嵌） ----------
  async function canvasToPngBytes(canvas) {
    const blob = await canvasToBlob(canvas, 'image/png');
    return new Uint8Array(await blob.arrayBuffer());
  }

  async function drawGanttSection(ctx, logs) {
    const rows = Gantt.buildRows([ctx.project], { [ctx.project.id]: logs });
    const canvas = document.createElement('canvas');
    const drawn = Gantt.draw(canvas, rows, { width: 1300, rowHeight: 60 });
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

    const lines = [
      `預排工期：${ctx.project.plannedStart || '未定'} ~ ${ctx.project.plannedEnd || '未定'}${plannedDays ? `（共 ${plannedDays} 天）` : ''}`,
      row && row.delayed ? '注意：進度落後於預排工期' : '目前進度正常'
    ];
    lines.forEach((line, i) => {
      ctx.ensureSpace(18);
      drawText(ctx.page, ctx.font, line, MARGIN, ctx.y, 11, i === 1 && row && row.delayed ? COLOR.danger : COLOR.text);
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
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.85);
    const bytes = new Uint8Array(await blob.arrayBuffer());
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

  // 直式相片 3欄x2列＝一頁6張，橫式相片 2欄x2列＝一頁4張；同一天的照片分在同一組，組間強制換頁
  const PHOTO_GRID = {
    portrait: { cols: 3, rows: 2, cellW: 240, cellH: 190, gapX: 14, gapY: 22 },
    landscape: { cols: 2, rows: 2, cellW: 365, cellH: 190, gapX: 18, gapY: 22 }
  };

  function orientationOf(w, h) {
    return h >= w ? 'portrait' : 'landscape';
  }

  function groupPhotosByDate(photos) {
    const map = new Map();
    photos.forEach((p) => {
      const key = DB.toDateStr(new Date(p.takenAt || Date.now()));
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(p);
    });
    return map;
  }

  function drawDateHeader(ctx, dateStr, count, continued) {
    ctx.ensureSpace(34);
    const barH = 16;
    const topY = ctx.y;
    ctx.page.drawRectangle({ x: MARGIN, y: topY - barH, width: 4, height: barH, color: COLOR.primary });
    const weekday = ['日', '一', '二', '三', '四', '五', '六'][new Date(dateStr + 'T00:00:00').getDay()];
    const label = `${dateStr.replace(/-/g, '/')}（週${weekday}）（${count} 張）${continued ? '續' : ''}`;
    drawText(ctx.page, ctx.font, label, MARGIN + 12, topY - barH + 4, 13, COLOR.text);
    ctx.y -= 30;
  }

  async function drawPhotoGridSection(ctx, photos) {
    if (!photos.length) {
      ctx.y = drawParagraph(ctx.page, ctx.font, '（尚無照片）', MARGIN, ctx.y, CONTENT_W, 10, 14, COLOR.muted);
      return;
    }

    const groups = groupPhotosByDate(photos);
    const dateKeys = Array.from(groups.keys()).sort();

    let firstGroup = true;
    for (const dateKey of dateKeys) {
      const group = groups.get(dateKey);
      if (!firstGroup) ctx.newPage();
      firstGroup = false;
      drawDateHeader(ctx, dateKey, group.length);

      let grid = null;
      for (const photo of group) {
        const { bytes, width, height } = await photoToJpegBytes(photo, 1000);
        const orientation = orientationOf(width, height);
        const cfg = PHOTO_GRID[orientation];

        const needsNewGrid = !grid || grid.orientation !== orientation || grid.row >= cfg.rows;
        if (needsNewGrid) {
          if (grid) {
            ctx.newPage();
            drawDateHeader(ctx, dateKey, group.length, true);
          }
          ctx.ensureSpace(cfg.cellH + 20);
          grid = { orientation, cfg, col: 0, row: 0, top: ctx.y };
        }

        const cellX = MARGIN + grid.col * (cfg.cellW + cfg.gapX);
        const cellY = grid.top - grid.row * (cfg.cellH + cfg.gapY) - cfg.cellH;

        const img = await ctx.pdfDoc.embedJpg(bytes);
        const scale = Math.min(cfg.cellW / width, cfg.cellH / height);
        const w = width * scale;
        const h = height * scale;
        const x = cellX + (cfg.cellW - w) / 2;
        const y = cellY + (cfg.cellH - h) / 2;
        ctx.page.drawImage(img, { x, y, width: w, height: h });
        drawPhotoAnnotations(ctx.page, ctx.font, photo.annotations, x, y, w, h);

        if (photo.caption) {
          const [line] = wrapText(ctx.font, photo.caption, 8, cfg.cellW);
          if (line) drawText(ctx.page, ctx.font, line, cellX, cellY - 10, 8, COLOR.muted);
        }

        grid.col += 1;
        if (grid.col >= cfg.cols) {
          grid.col = 0;
          grid.row += 1;
        }
      }
    }
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
    if (opts.includePhotos) {
      ctx.newPage();
      ctx.heading('工地照片');
      await drawPhotoGridSection(ctx, await DB.getPhotos(project.id));
    }

    finalizePages(ctx.pdfDoc, ctx.font, project, ctx.settings);
    return ctx.pdfDoc;
  }

  async function generatePhotoOnly(project) {
    const ctx = await createDoc(project);
    ctx.newPage();
    drawCover(ctx);

    ctx.newPage();
    ctx.heading('工地照片');
    await drawPhotoGridSection(ctx, await DB.getPhotos(project.id));

    finalizePages(ctx.pdfDoc, ctx.font, project, ctx.settings);
    return ctx.pdfDoc;
  }

  async function download(pdfDoc, filename) {
    const bytes = await pdfDoc.save();
    // 用 application/octet-stream 而不是 application/pdf：Android Chrome 常會把
    // pdf mime 的 blob 直接用內建 PDF 檢視器打開（介面看起來像「直接跳去預覽列印」），
    // 而不是單純存檔。宣告成通用二進位檔就會強制走「下載」而不是「開啟預覽」，
    // 檔名仍然是 .pdf，存下來後照樣是正常、可正確開啟的 PDF。
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
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
