// 待辦事項：現場發現的問題可直接拍照記錄待辦
const Todos = (() => {
  let currentProjectId = null;
  let pendingPhotoFile = null;

  async function renderList(projectId) {
    currentProjectId = projectId;
    const listEl = document.getElementById('todo-list');
    const emptyEl = document.getElementById('todo-empty');
    const todos = await DB.getTodos(projectId);
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

      const textEl = document.createElement('span');
      textEl.className = 'todo-text';
      textEl.textContent = todo.text;

      item.appendChild(checkbox);
      item.appendChild(textEl);

      if (todo.photoId) {
        const photo = await DB.getPhoto(todo.photoId);
        if (photo) {
          const thumb = document.createElement('img');
          thumb.className = 'todo-thumb';
          thumb.src = URL.createObjectURL(photo.blob);
          thumb.addEventListener('click', () => Photos.openEditor(photo.id));
          item.appendChild(thumb);
        }
      }

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'icon-btn todo-delete-btn';
      deleteBtn.setAttribute('aria-label', '刪除待辦');
      deleteBtn.textContent = '✕';
      deleteBtn.addEventListener('click', async () => {
        await DB.deleteTodo(todo.id);
        App.notifyDataChanged();
        renderList(currentProjectId);
      });
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
    const text = input.value.trim();
    if (!text) return;

    let photoId = null;
    if (pendingPhotoFile) {
      const photo = await DB.addPhoto({ projectId: currentProjectId, blob: pendingPhotoFile, caption: text });
      photoId = photo.id;
    }
    await DB.addTodo({ projectId: currentProjectId, text, photoId });

    input.value = '';
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
