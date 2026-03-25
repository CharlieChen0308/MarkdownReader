/**
 * Bookmarks — persistent bookmark management
 */
const Bookmarks = (() => {
  const STORAGE_KEY = 'markdownreader-bookmarks';
  let bookmarks = []; // [{ name, path }]
  let onBookmarkSelect = null;

  function init(callback) {
    onBookmarkSelect = callback;
    load();
    render();

    document.getElementById('btn-bookmark-current').addEventListener('click', toggleCurrentBookmark);
    document.getElementById('btn-toggle-bookmarks').addEventListener('click', togglePanel);
  }

  function load() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      bookmarks = data ? JSON.parse(data) : [];
    } catch {
      bookmarks = [];
    }
  }

  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookmarks));
  }

  function add(filePath, fileName) {
    if (bookmarks.some((b) => b.path === filePath)) return;
    bookmarks.push({ name: fileName, path: filePath });
    save();
    render();
    updateBookmarkButton(filePath);
  }

  function remove(filePath) {
    bookmarks = bookmarks.filter((b) => b.path !== filePath);
    save();
    render();
    updateBookmarkButton(filePath);
  }

  function isBookmarked(filePath) {
    return bookmarks.some((b) => b.path === filePath);
  }

  function toggleCurrentBookmark() {
    const currentPath = Sidebar.getActiveFilePath();
    if (!currentPath) return;

    if (isBookmarked(currentPath)) {
      remove(currentPath);
    } else {
      const name = currentPath.split(/[/\\]/).pop();
      add(currentPath, name);
    }
  }

  function updateBookmarkButton(filePath) {
    const btn = document.getElementById('btn-bookmark-current');
    const currentPath = Sidebar.getActiveFilePath();
    if (currentPath === filePath || !filePath) {
      const is = isBookmarked(currentPath);
      btn.textContent = is ? '★' : '☆';
      btn.classList.toggle('bookmarked', is);
    }
  }

  function togglePanel() {
    const panel = document.getElementById('bookmarks-panel');
    const btn = document.getElementById('btn-toggle-bookmarks');
    panel.classList.toggle('collapsed');
    btn.classList.toggle('active', !panel.classList.contains('collapsed'));
  }

  function render() {
    const container = document.getElementById('bookmarks-list');
    if (bookmarks.length === 0) {
      container.innerHTML = '<div style="padding:8px 12px;color:#888;font-size:12px;">尚無書籤</div>';
      return;
    }

    container.innerHTML = bookmarks
      .map(
        (b) => `
      <div class="bookmark-item" data-path="${escapeAttr(b.path)}">
        <span class="name">⭐ ${escapeHtml(b.name)}</span>
        <button class="bookmark-remove" data-path="${escapeAttr(b.path)}" title="移除書籤">✕</button>
      </div>
    `
      )
      .join('');

    container.querySelectorAll('.bookmark-item').forEach((el) => {
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('bookmark-remove')) return;
        if (onBookmarkSelect) onBookmarkSelect(el.dataset.path);
      });
    });

    container.querySelectorAll('.bookmark-remove').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        remove(btn.dataset.path);
      });
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function escapeAttr(text) {
    return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  return { init, updateBookmarkButton, isBookmarked, togglePanel };
})();
