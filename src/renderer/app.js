/**
 * App — main application logic
 */
(async () => {
  const RECENT_KEY = 'markdownreader-recent-folders';
  const MAX_RECENT = 5;
  const ZOOM_KEY = 'markdownreader-zoom-level';
  let currentFolder = null;
  let currentFile = null;
  let zoomLevel = 0; // -5 to +10, each step = 2px

  // Editor state
  let isEditorOpen = false;
  let rawContent = '';
  let isUnsaved = false;
  let justSaved = false; // Flag for file watcher integration

  // Init modules
  Viewer.init();
  const folderSelectHandler = (folderPath) => loadFolder(folderPath);
  folderSelectHandler._getCurrentFolder = () => currentFolder;
  Sidebar.init(onFileSelected, folderSelectHandler);
  Search.init(onFileSelected);
  Bookmarks.init(onFileSelected);

  // Init terminal
  if (typeof Terminal !== 'undefined') Terminal.init();

  // Load saved zoom level
  loadZoomLevel();

  // Show recent folders on welcome screen
  loadRecentFolders();

  // Sync recent folders to main process for menu
  syncRecentToMenu();

  // Toolbar buttons
  document.getElementById('btn-open-folder').addEventListener('click', openFolder);
  document.getElementById('btn-switch-folder').addEventListener('click', openFolder);
  document.getElementById('btn-toggle-sidebar').addEventListener('click', toggleSidebar);

  // Editor buttons + keyboard shortcuts
  document.getElementById('btn-toggle-edit').addEventListener('click', toggleEditor);
  document.getElementById('btn-close-editor').addEventListener('click', closeEditor);
  document.getElementById('btn-save-file').addEventListener('click', saveFile);

  const editorTextarea = document.getElementById('editor-content');
  let editorDebounce = null;
  editorTextarea.addEventListener('input', () => {
    isUnsaved = true;
    document.getElementById('unsaved-indicator').style.display = '';
    document.getElementById('btn-save-file').classList.remove('disabled');
    // Debounced live preview
    clearTimeout(editorDebounce);
    editorDebounce = setTimeout(() => {
      const html = Viewer.render(editorTextarea.value, currentFile ? require('path').dirname(currentFile) : '', currentFile || '');
      document.getElementById('markdown-content').innerHTML = html;
    }, 300);
  });

  // Ctrl+S to save, Ctrl+Shift+E to toggle editor
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 's') {
      e.preventDefault();
      saveFile();
    }
    if (e.ctrlKey && e.shiftKey && (e.key === 'E' || e.key === 'e')) {
      e.preventDefault();
      toggleEditor();
    }
    if (e.ctrlKey && (e.key === 'b' || e.key === 'B') && !e.shiftKey) {
      e.preventDefault();
      toggleSidebar();
    }
  });

  // ── Menu action listeners (from Electron native menu) ──

  window.api.onMenuAction('menu-open-folder', () => openFolder());
  window.api.onMenuAction('menu-reload-folder', () => reloadFolder());
  window.api.onMenuAction('menu-open-recent', (folder) => loadFolder(folder));
  window.api.onMenuAction('menu-clear-recent', () => clearRecentFolders());
  window.api.onMenuAction('menu-toggle-search', () => Search.toggle());
  window.api.onMenuAction('menu-toggle-bookmarks', () => Bookmarks.togglePanel());
  window.api.onMenuAction('menu-toggle-sidebar', () => toggleSidebar());
  window.api.onMenuAction('menu-zoom', (direction) => handleZoom(direction));
  window.api.onMenuAction('menu-toggle-edit', () => toggleEditor());
  window.api.onMenuAction('menu-save-file', () => saveFile());
  window.api.onMenuAction('menu-toggle-terminal', () => {
    if (typeof Terminal !== 'undefined') Terminal.toggle();
  });
  window.api.onMenuAction('menu-terminal-settings', () => {
    if (typeof Terminal !== 'undefined') Terminal.showSettings();
  });

  // ── Core functions ──

  async function openFolder() {
    const folderPath = await window.api.openFolderDialog();
    if (!folderPath) return;
    await loadFolder(folderPath);
  }

  async function loadFolder(folderPath) {
    currentFolder = folderPath;
    currentFile = null;

    // Switch to main app view
    document.getElementById('welcome-screen').style.display = 'none';
    document.getElementById('main-app').style.display = 'flex';

    // Update toolbar
    document.getElementById('current-folder-name').textContent = folderPath;
    document.title = `MarkdownReader — ${folderPath.split(/[/\\]/).pop()}`;

    // Reset content
    document.getElementById('content-placeholder').style.display = 'flex';
    document.getElementById('content-header').style.display = 'none';
    document.getElementById('markdown-content').innerHTML = '';

    // Scan directory and render tree
    const tree = await window.api.scanDirectory(folderPath);
    Sidebar.renderTree(tree);

    // Build search index
    await window.api.buildSearchIndex(folderPath);

    // Start file watcher
    await window.api.watchDirectory(folderPath);

    // Save to recent + sync menu
    saveRecentFolder(folderPath);
    syncRecentToMenu();

    // Notify main process
    window.api.updateCurrentFolder(folderPath);
  }

  async function reloadFolder() {
    if (!currentFolder) return;
    const previousFile = currentFile;
    await loadFolder(currentFolder);
    // Re-select the file that was open
    if (previousFile) {
      await onFileSelected(previousFile);
    }
  }

  async function onFileSelected(filePath) {
    // Check unsaved changes before switching
    if (isUnsaved && currentFile) {
      if (!confirm('有未儲存的修改，是否放棄？')) return;
    }

    currentFile = filePath;
    const result = await window.api.readFile(filePath);
    rawContent = result.content;

    // Show content header
    document.getElementById('content-placeholder').style.display = 'none';
    document.getElementById('content-header').style.display = 'flex';
    document.getElementById('content-file-path').textContent = filePath;

    // Render content (markdown or plain text)
    const html = Viewer.render(result.content, result.dir, result.filePath);
    document.getElementById('markdown-content').innerHTML = html;

    // Scroll to top
    document.getElementById('markdown-content').scrollTop = 0;

    // Update editor textarea if open
    if (isEditorOpen) {
      document.getElementById('editor-content').value = rawContent;
    }
    isUnsaved = false;
    document.getElementById('unsaved-indicator').style.display = 'none';
    document.getElementById('btn-save-file').classList.add('disabled');

    // Update sidebar highlight (no callback, breaks infinite loop)
    Sidebar.highlightFile(filePath);

    // Update bookmark button
    Bookmarks.updateBookmarkButton(filePath);

    // Notify main process (for menu: 複製路徑、在檔案總管開啟)
    window.api.updateCurrentFile(filePath);

    // Handle link clicks within markdown
    document.getElementById('markdown-content').querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', async (e) => {
        const rawHref = link.getAttribute('href');
        if (!rawHref) return;
        const href = decodeURIComponent(rawHref);
        // External links open in default browser
        if (href.startsWith('http://') || href.startsWith('https://')) {
          e.preventDefault();
          require('electron').shell.openExternal(href);
          return;
        }
        // Handle relative .md/.txt links
        if (href.endsWith('.md') || href.includes('.md#') || href.endsWith('.txt')) {
          e.preventDefault();
          const mdPath = href.split('#')[0];
          const resolved = resolvePath(result.dir, mdPath);
          onFileSelected(resolved);
          return;
        }
        // Handle directory links (e.g. ./01-品牌策略/)
        e.preventDefault();
        const dirPath = resolvePath(result.dir, href.replace(/\/$/, ''));
        const target = await window.api.resolveDirectoryLink(dirPath);
        if (target) {
          // Expand the directory in sidebar tree, then open the file
          Sidebar.expandDirectory(dirPath);
          onFileSelected(target);
        }
      });
    });
  }

  // ── File watcher ──

  let watchDebounce = null;
  window.api.onFileChange((data) => {
    // Skip changes from our own save
    if (justSaved && data.fullPath && currentFile &&
        data.fullPath.replace(/\\/g, '/') === currentFile.replace(/\\/g, '/')) {
      return;
    }
    clearTimeout(watchDebounce);
    watchDebounce = setTimeout(() => handleFileChange(data), 500);
  });

  async function handleFileChange(data) {
    if (!currentFolder) return;
    const changedPath = data.fullPath ? data.fullPath.replace(/\\/g, '/') : '';
    const currentNorm = currentFile ? currentFile.replace(/\\/g, '/') : '';

    // Current file content changed — reload it
    if (changedPath === currentNorm && currentFile) {
      const result = await window.api.readFile(currentFile);
      rawContent = result.content;
      const html = Viewer.render(result.content, result.dir, result.filePath);
      document.getElementById('markdown-content').innerHTML = html;
      if (isEditorOpen && !isUnsaved) {
        document.getElementById('editor-content').value = rawContent;
      }
    }

    // Always refresh tree + search index on any file change
    const tree = await window.api.scanDirectory(currentFolder);
    Sidebar.renderTree(tree);
    if (currentFile) Sidebar.highlightFile(currentFile);
    await window.api.buildSearchIndex(currentFolder);
  }

  // ── Editor functions ──

  function toggleEditor() {
    if (!currentFile) return;
    isEditorOpen ? closeEditor() : openEditor();
  }

  function openEditor() {
    isEditorOpen = true;
    const editorPanel = document.getElementById('editor-panel');
    const editorResizeHandle = document.getElementById('editor-resize-handle');
    const contentBody = document.querySelector('.content-body');
    editorPanel.style.display = 'flex';
    editorResizeHandle.style.display = '';
    contentBody.classList.add('editing');
    document.getElementById('btn-toggle-edit').classList.add('editing');
    document.getElementById('btn-save-file').classList.toggle('disabled', !isUnsaved);
    document.getElementById('editor-content').value = rawContent;
    document.getElementById('editor-content').focus();
  }

  function closeEditor() {
    isEditorOpen = false;
    const editorPanel = document.getElementById('editor-panel');
    const editorResizeHandle = document.getElementById('editor-resize-handle');
    const contentBody = document.querySelector('.content-body');
    editorPanel.style.display = 'none';
    editorResizeHandle.style.display = 'none';
    contentBody.classList.remove('editing');
    document.getElementById('btn-toggle-edit').classList.remove('editing');
    // Reset flex widths when closing
    document.getElementById('markdown-content').style.flex = '';
    editorPanel.style.flex = '';
  }

  async function saveFile() {
    if (!currentFile || !isUnsaved) return;
    const content = document.getElementById('editor-content').value;
    const result = await window.api.writeFile(currentFile, content);
    if (result.success) {
      rawContent = content;
      isUnsaved = false;
      justSaved = true;
      setTimeout(() => { justSaved = false; }, 1000);
      document.getElementById('unsaved-indicator').style.display = 'none';
      document.getElementById('btn-save-file').classList.add('disabled');
    } else {
      alert('儲存失敗：' + result.error);
    }
  }

  function resolvePath(dir, relativePath) {
    const parts = dir.replace(/\\/g, '/').split('/');
    const relParts = relativePath.replace(/\\/g, '/').split('/');
    for (const p of relParts) {
      if (p === '..') parts.pop();
      else if (p !== '.') parts.push(p);
    }
    return parts.join('/');
  }

  // ── Sidebar toggle ──

  function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const handle = document.getElementById('resize-handle');
    const btn = document.getElementById('btn-toggle-sidebar');
    const isHidden = sidebar.style.display === 'none';
    sidebar.style.display = isHidden ? '' : 'none';
    handle.style.display = isHidden ? '' : 'none';
    btn.classList.toggle('active', isHidden);
  }

  // ── Editor resize handle (viewer ↔ editor split) ──

  (() => {
    const handle = document.getElementById('editor-resize-handle');
    let dragging = false;

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      dragging = true;
      handle.classList.add('resizing');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const contentBody = document.querySelector('.content-body');
      const rect = contentBody.getBoundingClientRect();
      const totalWidth = rect.width;
      const viewerWidth = e.clientX - rect.left;
      const minViewer = 200;
      const minEditor = 250;
      const clampedViewer = Math.max(minViewer, Math.min(viewerWidth, totalWidth - minEditor - 4));

      const markdownContent = document.getElementById('markdown-content');
      const editorPanel = document.getElementById('editor-panel');
      markdownContent.style.flex = `0 0 ${clampedViewer}px`;
      editorPanel.style.flex = `1 1 0`;
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });
  })();

  // ── Zoom ──

  function handleZoom(direction) {
    const content = document.getElementById('markdown-content');
    const baseFontSize = 15;

    if (direction === 'in') {
      zoomLevel = Math.min(zoomLevel + 1, 10);
    } else if (direction === 'out') {
      zoomLevel = Math.max(zoomLevel - 1, -5);
    } else {
      zoomLevel = 0;
    }

    content.style.fontSize = (baseFontSize + zoomLevel * 2) + 'px';
    localStorage.setItem(ZOOM_KEY, String(zoomLevel));
  }

  function loadZoomLevel() {
    try {
      const saved = localStorage.getItem(ZOOM_KEY);
      if (saved !== null) {
        zoomLevel = parseInt(saved, 10) || 0;
        const content = document.getElementById('markdown-content');
        content.style.fontSize = (15 + zoomLevel * 2) + 'px';
      }
    } catch { /* ignore */ }
  }

  // ── Recent folders ──

  function loadRecentFolders() {
    try {
      const data = localStorage.getItem(RECENT_KEY);
      const recent = data ? JSON.parse(data) : [];
      if (recent.length === 0) return;

      document.getElementById('recent-folders').style.display = 'block';
      const list = document.getElementById('recent-list');
      list.innerHTML = recent
        .map(
          (f) => `
        <button class="recent-item" data-path="${f.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">
          <span class="recent-item-name">📁 ${f.split(/[/\\]/).pop()}</span>
          <span class="recent-item-path">${f}</span>
        </button>
      `
        )
        .join('');

      list.querySelectorAll('.recent-item').forEach((btn) => {
        btn.addEventListener('click', () => loadFolder(btn.dataset.path));
      });
    } catch { /* ignore */ }
  }

  function saveRecentFolder(folderPath) {
    try {
      const data = localStorage.getItem(RECENT_KEY);
      let recent = data ? JSON.parse(data) : [];
      recent = recent.filter((f) => f !== folderPath);
      recent.unshift(folderPath);
      if (recent.length > MAX_RECENT) recent = recent.slice(0, MAX_RECENT);
      localStorage.setItem(RECENT_KEY, JSON.stringify(recent));
    } catch { /* ignore */ }
  }

  function clearRecentFolders() {
    localStorage.removeItem(RECENT_KEY);
    syncRecentToMenu();
    // If on welcome screen, refresh the list
    const recentDiv = document.getElementById('recent-folders');
    if (recentDiv) {
      recentDiv.style.display = 'none';
      document.getElementById('recent-list').innerHTML = '';
    }
  }

  function syncRecentToMenu() {
    try {
      const data = localStorage.getItem(RECENT_KEY);
      const recent = data ? JSON.parse(data) : [];
      window.api.updateRecentFolders(recent);
    } catch { /* ignore */ }
  }
})();
