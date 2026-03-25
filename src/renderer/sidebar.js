/**
 * Sidebar — file tree navigation + quick access
 */
const Sidebar = (() => {
  let treeData = [];
  let activeFilePath = null;
  let onFileSelect = null;
  let onFolderSelect = null;
  const PIN_KEY = 'markdownreader-pinned-folders';

  function init(fileCallback, folderCallback) {
    onFileSelect = fileCallback;
    onFolderSelect = folderCallback;
    setupResize();
    loadQuickAccess();
    setupCollapsiblePanels();

    // Pin button
    document.getElementById('btn-pin-folder').addEventListener('click', (e) => {
      e.stopPropagation();
      if (onFolderSelect && onFolderSelect._getCurrentFolder) {
        const folder = onFolderSelect._getCurrentFolder();
        if (folder) pinFolder(folder);
      }
    });
  }

  // ── Collapsible panels ──

  const COLLAPSE_KEY = 'markdownreader-collapsed-panels';

  function setupCollapsiblePanels() {
    // File Tree header toggle
    const ftHeader = document.querySelector('#file-tree-panel .panel-header');
    ftHeader.style.cursor = 'pointer';
    ftHeader.addEventListener('click', () => togglePanel('file-tree-panel'));

    // Quick Access header toggle
    const qaHeader = document.querySelector('#quick-access-panel .panel-header');
    qaHeader.style.cursor = 'pointer';
    qaHeader.addEventListener('click', (e) => {
      if (e.target.closest('.btn-pin')) return;
      togglePanel('quick-access-panel');
    });

    // Bookmarks header toggle
    const bmHeader = document.querySelector('#bookmarks-panel .panel-header');
    bmHeader.style.cursor = 'pointer';
    bmHeader.addEventListener('click', () => {
      togglePanel('bookmarks-panel');
    });

    // Restore saved collapse state
    loadCollapseState();
  }

  function togglePanel(panelId) {
    const panel = document.getElementById(panelId);
    panel.classList.toggle('collapsed');
    saveCollapseState();
  }

  function saveCollapseState() {
    const panels = ['file-tree-panel', 'quick-access-panel', 'bookmarks-panel'];
    const collapsed = panels.filter(id => document.getElementById(id).classList.contains('collapsed'));
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsed));
  }

  function loadCollapseState() {
    try {
      const data = localStorage.getItem(COLLAPSE_KEY);
      if (!data) return;
      const collapsed = JSON.parse(data);
      for (const id of collapsed) {
        document.getElementById(id)?.classList.add('collapsed');
      }
    } catch { /* ignore */ }
  }

  function collapsePanels() {
    document.getElementById('quick-access-panel').classList.add('collapsed');
    document.getElementById('bookmarks-panel').classList.add('collapsed');
  }

  // ── Quick Access (快速存取) ──

  function loadQuickAccess() {
    const pinned = getPinnedFolders();
    renderQuickAccess(pinned);
  }

  function getPinnedFolders() {
    try {
      const data = localStorage.getItem(PIN_KEY);
      return data ? JSON.parse(data) : [];
    } catch { return []; }
  }

  function savePinnedFolders(folders) {
    localStorage.setItem(PIN_KEY, JSON.stringify(folders));
  }

  function pinFolder(folderPath) {
    const pinned = getPinnedFolders();
    if (pinned.includes(folderPath)) return;
    pinned.push(folderPath);
    savePinnedFolders(pinned);
    renderQuickAccess(pinned);
  }

  function unpinFolder(folderPath) {
    let pinned = getPinnedFolders();
    pinned = pinned.filter(f => f !== folderPath);
    savePinnedFolders(pinned);
    renderQuickAccess(pinned);
  }

  function renderQuickAccess(pinned) {
    const container = document.getElementById('quick-access-list');
    container.innerHTML = '';
    if (pinned.length === 0) {
      container.innerHTML = '<div class="nav-empty">尚未釘選資料夾</div>';
      return;
    }
    for (const folder of pinned) {
      const name = folder.split(/[/\\]/).pop();
      const item = document.createElement('div');
      item.className = 'nav-item';
      item.title = folder;
      item.innerHTML = `<span class="nav-icon">📁</span><span class="nav-name">${escapeHtml(name)}</span><button class="btn-unpin" title="取消釘選">✕</button>`;
      item.addEventListener('click', (e) => {
        if (e.target.closest('.btn-unpin')) return;
        if (onFolderSelect) onFolderSelect(folder);
      });
      item.querySelector('.btn-unpin').addEventListener('click', (e) => {
        e.stopPropagation();
        unpinFolder(folder);
      });
      container.appendChild(item);
    }
  }

  function renderTree(data) {
    treeData = data;
    const container = document.getElementById('file-tree');
    container.innerHTML = '';
    container.appendChild(buildTreeDOM(data, 0));
  }

  function buildTreeDOM(items, depth) {
    const fragment = document.createDocumentFragment();

    for (const item of items) {
      if (item.type === 'directory') {
        // Folder
        const folderEl = document.createElement('div');
        folderEl.className = 'tree-item';
        folderEl.style.paddingLeft = `${12 + depth * 16}px`;
        folderEl.innerHTML = `<span class="icon">📁</span><span class="name">${escapeHtml(item.name)}</span>`;
        folderEl.dataset.folderPath = item.path;

        const childrenEl = document.createElement('div');
        childrenEl.className = 'tree-children';
        childrenEl.appendChild(buildTreeDOM(item.children, depth + 1));

        folderEl.addEventListener('click', (e) => {
          e.stopPropagation();
          const isExpanded = childrenEl.classList.contains('expanded');
          childrenEl.classList.toggle('expanded');
          folderEl.querySelector('.icon').textContent = isExpanded ? '📁' : '📂';
        });

        fragment.appendChild(folderEl);
        fragment.appendChild(childrenEl);
      } else {
        // File
        const fileEl = document.createElement('div');
        fileEl.className = 'tree-item';
        fileEl.style.paddingLeft = `${12 + depth * 16}px`;
        fileEl.dataset.path = item.path;
        const fileIcon = item.name.toLowerCase().endsWith('.txt') ? '📝' : '📄';
        fileEl.innerHTML = `<span class="icon">${fileIcon}</span><span class="name">${escapeHtml(item.name)}</span>`;

        fileEl.addEventListener('click', (e) => {
          e.stopPropagation();
          selectFile(item.path);
        });

        fragment.appendChild(fileEl);
      }
    }

    return fragment;
  }

  /**
   * Select file: update UI + trigger callback (called from sidebar clicks)
   */
  function selectFile(filePath) {
    if (activeFilePath === filePath) return; // prevent re-select
    highlightFile(filePath);
    collapsePanels();
    if (onFileSelect) onFileSelect(filePath);
  }

  /**
   * Highlight file in tree: update UI only, no callback (called from app.js)
   */
  function highlightFile(filePath) {
    activeFilePath = filePath;

    // Update active state
    document.querySelectorAll('.file-tree .tree-item').forEach((el) => {
      el.classList.toggle('active', el.dataset.path === filePath);
    });

    // Expand parent folders
    expandToFile(filePath);
  }

  function expandToFile(filePath) {
    const allItems = document.querySelectorAll('.file-tree .tree-item');
    for (const item of allItems) {
      if (item.dataset.path === filePath) {
        // Walk up and expand parent .tree-children
        let parent = item.parentElement;
        while (parent && !parent.classList.contains('file-tree')) {
          if (parent.classList.contains('tree-children')) {
            parent.classList.add('expanded');
            // Update folder icon
            const folderItem = parent.previousElementSibling;
            if (folderItem) {
              const icon = folderItem.querySelector('.icon');
              if (icon) icon.textContent = '📂';
            }
          }
          parent = parent.parentElement;
        }
        break;
      }
    }
  }

  /**
   * Expand a directory in the sidebar tree (used when clicking directory links in content)
   */
  function expandDirectory(dirPath) {
    const normalized = dirPath.replace(/\//g, '\\');
    const allFolders = document.querySelectorAll('.file-tree .tree-item[data-folder-path]');
    for (const folderEl of allFolders) {
      if (folderEl.dataset.folderPath === normalized || folderEl.dataset.folderPath === dirPath) {
        // Expand this folder's children
        const childrenEl = folderEl.nextElementSibling;
        if (childrenEl && childrenEl.classList.contains('tree-children')) {
          childrenEl.classList.add('expanded');
          folderEl.querySelector('.icon').textContent = '📂';
        }
        // Also expand all parents
        let parent = folderEl.parentElement;
        while (parent && !parent.classList.contains('file-tree')) {
          if (parent.classList.contains('tree-children')) {
            parent.classList.add('expanded');
            const parentFolder = parent.previousElementSibling;
            if (parentFolder) {
              const icon = parentFolder.querySelector('.icon');
              if (icon) icon.textContent = '📂';
            }
          }
          parent = parent.parentElement;
        }
        break;
      }
    }
  }

  function getActiveFilePath() {
    return activeFilePath;
  }

  // Sidebar resize
  function setupResize() {
    const handle = document.getElementById('resize-handle');
    const sidebar = document.getElementById('sidebar');
    let isResizing = false;

    handle.addEventListener('mousedown', (e) => {
      isResizing = true;
      handle.classList.add('resizing');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing) return;
      const newWidth = Math.max(200, Math.min(500, e.clientX));
      sidebar.style.width = newWidth + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        isResizing = false;
        handle.classList.remove('resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  return { init, renderTree, selectFile, highlightFile, expandDirectory, getActiveFilePath };
})();
