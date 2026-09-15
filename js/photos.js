// 工地照片：縮圖格線、拍照/選檔上傳、canvas 框選標註（非破壞性，原圖 Blob 不變）
const Photos = (() => {
  let state = null;

  function resetState() {
    state = {
      photoId: null,
      imgEl: null,
      canvas: null,
      ctx: null,
      annotations: [],
      drawing: null,
      pendingBox: null,
      onClose: null
    };
  }
  resetState();

  function normToPixel(box, w, h) {
    return { x: box.x * w, y: box.y * h, w: box.w * w, h: box.h * h };
  }

  function pixelToNorm(x, y, w, h, cw, ch) {
    return { x: x / cw, y: y / ch, w: w / cw, h: h / ch };
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  // ---------- 照片格線（工地詳細頁「照片」子分頁） ----------
  async function renderGrid(projectId) {
    const grid = document.getElementById('photo-grid');
    const empty = document.getElementById('photo-empty');
    if (!grid) return;
    const photos = await DB.getPhotos(projectId);
    grid.innerHTML = '';
    empty.classList.toggle('hidden', photos.length > 0);
    photos.forEach((p) => {
      const url = URL.createObjectURL(p.blob);
      const cell = document.createElement('div');
      cell.className = 'photo-cell';
      const count = (p.annotations || []).length;
      cell.innerHTML = `<img src="${url}" alt="工地照片">${count ? `<span class="photo-badge">${count}</span>` : ''}`;
      cell.addEventListener('click', () => openEditor(p.id, () => renderGrid(projectId)));
      grid.appendChild(cell);
    });
  }

  async function handleFiles(projectId, fileList) {
    const files = Array.from(fileList || []);
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      await DB.addPhoto({ projectId, blob: file, caption: '' });
    }
    await renderGrid(projectId);
  }

  // ---------- 標註編輯器 ----------
  async function openEditor(photoId, onClose) {
    const photo = await DB.getPhoto(photoId);
    if (!photo) return;
    resetState();
    state.photoId = photoId;
    state.annotations = (photo.annotations || []).slice();
    state.onClose = onClose || null;

    const img = document.getElementById('photo-editor-img');
    const canvas = document.getElementById('photo-editor-canvas');
    const captionInput = document.getElementById('photo-caption-input');
    captionInput.value = photo.caption || '';
    captionInput.oninput = () => {
      DB.updatePhoto(photoId, { caption: captionInput.value });
    };

    const url = URL.createObjectURL(photo.blob);
    img.src = url;
    await new Promise((resolve) => { img.onload = resolve; });

    state.imgEl = img;
    state.canvas = canvas;
    state.ctx = canvas.getContext('2d');

    App.showModal('photo-editor-modal');
    requestAnimationFrame(() => {
      resizeCanvasToImage();
      redraw();
      renderAnnotationList();
    });
  }

  function resizeCanvasToImage() {
    if (!state.imgEl || !state.canvas) return;
    const rect = state.imgEl.getBoundingClientRect();
    const canvas = state.canvas;
    canvas.width = rect.width;
    canvas.height = rect.height;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
  }

  function redraw() {
    if (!state.ctx) return;
    const ctx = state.ctx;
    const canvas = state.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    state.annotations.forEach((a, idx) => drawBox(ctx, a, canvas.width, canvas.height, idx + 1));
    if (state.drawing) {
      const d = state.drawing;
      ctx.strokeStyle = '#E8862E';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      ctx.setLineDash([]);
    }
  }

  function drawBox(ctx, a, cw, ch, index) {
    const px = normToPixel(a, cw, ch);
    ctx.strokeStyle = '#F76E4F';
    ctx.lineWidth = 2;
    ctx.strokeRect(px.x, px.y, px.w, px.h);
    ctx.fillStyle = '#F76E4F';
    ctx.fillRect(px.x, Math.max(0, px.y - 18), 20, 18);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(index), px.x + 10, Math.max(0, px.y - 9));
  }

  function bindPointerEvents() {
    const canvas = document.getElementById('photo-editor-canvas');
    if (!canvas) return;
    let dragging = false;
    canvas.addEventListener('pointerdown', (e) => {
      if (!state.canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      dragging = true;
      state.drawing = { x0: x, y0: y, x1: x, y1: y };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const rect = canvas.getBoundingClientRect();
      state.drawing.x1 = e.clientX - rect.left;
      state.drawing.y1 = e.clientY - rect.top;
      redraw();
    });
    canvas.addEventListener('pointerup', () => {
      if (!dragging) return;
      dragging = false;
      const d = state.drawing;
      state.drawing = null;
      if (!d) return;
      const x = Math.min(d.x0, d.x1);
      const y = Math.min(d.y0, d.y1);
      const w = Math.abs(d.x1 - d.x0);
      const h = Math.abs(d.y1 - d.y0);
      if (w < 12 || h < 12) { redraw(); return; }
      state.pendingBox = pixelToNorm(x, y, w, h, canvas.width, canvas.height);
      openNoteModal(null);
    });
  }

  function openNoteModal(existingAnnotationId) {
    const input = document.getElementById('annotation-note-input');
    const deleteBtn = document.getElementById('annotation-note-delete-btn');
    input.value = '';
    if (existingAnnotationId) {
      const a = state.annotations.find((x) => x.id === existingAnnotationId);
      input.value = a ? (a.note || '') : '';
      deleteBtn.classList.remove('hidden');
    } else {
      deleteBtn.classList.add('hidden');
    }
    App.showModal('annotation-note-modal');
    setTimeout(() => input.focus(), 50);

    const saveBtn = document.getElementById('annotation-note-save-btn');
    const cancelBtn = document.getElementById('annotation-note-cancel-btn');

    saveBtn.onclick = async () => {
      const note = input.value.trim();
      if (existingAnnotationId) {
        state.annotations = state.annotations.map((a) => (a.id === existingAnnotationId ? Object.assign({}, a, { note }) : a));
      } else if (state.pendingBox) {
        state.annotations.push(Object.assign({ id: DB.uid(), note }, state.pendingBox));
        state.pendingBox = null;
      }
      await DB.updatePhoto(state.photoId, { annotations: state.annotations });
      App.hideModal('annotation-note-modal');
      redraw();
      renderAnnotationList();
    };
    cancelBtn.onclick = () => {
      state.pendingBox = null;
      App.hideModal('annotation-note-modal');
      redraw();
    };
    deleteBtn.onclick = async () => {
      state.annotations = state.annotations.filter((a) => a.id !== existingAnnotationId);
      await DB.updatePhoto(state.photoId, { annotations: state.annotations });
      App.hideModal('annotation-note-modal');
      redraw();
      renderAnnotationList();
    };
  }

  function renderAnnotationList() {
    const list = document.getElementById('annotation-list');
    if (!list) return;
    list.innerHTML = '';
    if (!state.annotations.length) {
      list.innerHTML = '<p class="text-muted annotation-hint">在照片上拖曳畫框即可標記問題點</p>';
      return;
    }
    state.annotations.forEach((a, idx) => {
      const item = document.createElement('div');
      item.className = 'annotation-item';
      item.innerHTML = `<span class="annotation-badge">${idx + 1}</span><span class="annotation-note-text"></span>`;
      item.querySelector('.annotation-note-text').textContent = a.note || '（無備註，點一下新增）';
      item.addEventListener('click', () => openNoteModal(a.id));
      list.appendChild(item);
    });
  }

  function closeEditor() {
    const cb = state.onClose;
    App.hideModal('photo-editor-modal');
    if (state.imgEl && state.imgEl.src) URL.revokeObjectURL(state.imgEl.src);
    resetState();
    if (cb) cb();
  }

  async function deleteCurrentPhoto() {
    if (!state.photoId) return;
    if (!confirm('確定要刪除這張照片嗎？')) return;
    await DB.deletePhoto(state.photoId);
    closeEditor();
  }

  return { renderGrid, handleFiles, openEditor, closeEditor, deleteCurrentPhoto, bindPointerEvents, loadImage };
})();
