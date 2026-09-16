// 待辦事項：現場發現的問題可直接拍照記錄待辦
const Todos = (() => {
  let currentProjectId = null;
  let pendingPhotoFile = null;
  let thumbUrls = [];

  async function renderList(projectId) {
    currentProjectId = projectId;
    const listEl = document.getElementById('todo-list');
    const emptyEl = document.getElementById('todo-empty');
    thumbUrls.forEach((url) => URL.revokeObjectURL(url));
    thumbUrls = [];
    const [todos, photos] = await Promise.all([DB.getTodos(projectId), DB.getPhotos(projectId)]);
    const photosById = new Map(photos.map((photo) => [photo.id, photo]));
    emptyEl.classList.toggle('hidden', todos.length > 0);
    listEl.innerHTML = '';

    for (const todo of todos) {
      const item = document.createElement('div');
      item.className = 'todo-item' + (todo.done ? ' done' : '');

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !!todo.done;
      checkbox.addEventListener('change', async () => {
        await DB.updateTodo(todo.id, { done: checkbox.checked });
        App.notifyDataChanged();
        renderList(currentProjectId);
      });

      const main = document.createElement('div');
      main.className = 'todo-main';

      const textEl = document.createElement('span');
      textEl.className = 'todo-text';
      textEl.textContent = todo.text;
      main.appendChild(textEl);

      if (todo.dueDate) {
        const dueEl = document.createElement('span');
        const todayStr = DB.toDateStr(new Date());
        const state = todo.done ? '' : todo.dueDate < todayStr ? 'overdue' : todo.dueDate === todayStr ? 'due-today' : '';
        dueEl.className = 'todo-due' + (state ? ' ' + state : '');
        const label = state === 'overdue' ? '已逾期' : state === 'due-today' ? '今天到期' : '提醒';
        dueEl.textContent = `⏰ ${todo.dueDate}（${label}）`;
        main.appendChild(dueEl);
      }

      item.appendChild(checkbox);
      item.appendChild(main);

      if (todo.photoId) {
        const photo = photosById.get(todo.photoId);
        if (photo) {
          const thumb = document.createElement('img');
          thumb.className = 'todo-thumb';
          thumb.src = URL.createObjectURL(photo.blob);
          thumbUrls.push(thumb.src);
          thumb.tabIndex = 0;
          thumb.setAttribute('role', 'button');
          thumb.setAttribute('aria-label', '開啟待辦照片');
          thumb.addEventListener('click', () => Photos.openEditor(photo.id));
          thumb.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); Photos.openEditor(photo.id); }
          });
          item.appendChild(thumb);
        }
      }

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'icon-btn todo-delete-btn';
      deleteBtn.setAttribute('aria-label', '刪除待辦');
      deleteBtn.textContent = '✕';
      deleteBtn.addEventListener('click', async () => {
        if (!confirm('確定要刪除這筆待辦嗎？')) return;
        await DB.deleteTodo(todo.id);
        App.notifyDataChanged();
        renderList(currentProjectId);
      });
      const editBtn = document.createElement('button');
      editBtn.className = 'icon-btn todo-delete-btn';
      editBtn.setAttribute('aria-label', '編輯待辦');
      editBtn.textContent = '✎';
      editBtn.addEventListener('click', async () => {
        const next = prompt('編輯待辦事項', todo.text);
        if (next == null || !next.trim()) return;
        const nextDue = prompt('提醒日期（YYYY-MM-DD，留空表示不提醒）', todo.dueDate || '');
        if (nextDue == null) return;
        const dueDate = nextDue.trim();
        if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
          alert('日期格式不正確，請用 YYYY-MM-DD');
          return;
        }
        await DB.updateTodo(todo.id, { text: next.trim(), dueDate: dueDate || null });
        App.notifyDataChanged();
        renderList(currentProjectId);
      });
      item.appendChild(editBtn);
      item.appendChild(deleteBtn);

      listEl.appendChild(item);
    }
  }

  function handlePhotoInputChange(e) {
    const file = e.target.files && e.target.files[0];
    const pendingEl = document.getElementById('todo-photo-pending');
    if (file) {
      pendingPhotoFile = file;
      pendingEl.textContent = `已附加照片：${file.name}`;
      pendingEl.classList.remove('hidden');
    } else {
      pendingPhotoFile = null;
      pendingEl.classList.add('hidden');
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const input = document.getElementById('todo-input');
    const dueInput = document.getElementById('todo-due-input');
    const text = input.value.trim();
    if (!text) return;

    let photoId = null;
    if (pendingPhotoFile) {
      const blob = await Photos.optimizeImage(pendingPhotoFile);
      const photo = await DB.addPhoto({ projectId: currentProjectId, blob, caption: text });
      photoId = photo.id;
    }
    await DB.addTodo({ projectId: currentProjectId, text, photoId, dueDate: dueInput.value || null });

    input.value = '';
    dueInput.value = '';
    pendingPhotoFile = null;
    document.getElementById('todo-photo-input').value = '';
    document.getElementById('todo-photo-pending').classList.add('hidden');

    App.notifyDataChanged();
    await renderList(currentProjectId);
  }

  function bindEvents() {
    document.getElementById('todo-form').addEventListener('submit', handleSubmit);
    document.getElementById('todo-photo-input').addEventListener('change', handlePhotoInputChange);
  }

  return { renderList, bindEvents };
})();
