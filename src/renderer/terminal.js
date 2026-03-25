/**
 * Terminal — multi-tab embedded terminal panel with resizable height (IIFE)
 */
const Terminal = (() => {
  const SETTINGS_KEY = 'markdownreader-terminal-settings';
  const HEIGHT_KEY = 'markdownreader-terminal-height';
  const DEFAULT_SETTINGS = {
    shell: 'powershell.exe',
    autoRun: '',
    fontSize: 14,
    fontFamily: 'Cascadia Mono',
    lineHeight: 1.2,
    cursorStyle: 'block',
    cursorBlink: true,
    theme: 'dark',
    tabName: 'Terminal',
    unlimitedScrollback: false,
    cwd: '',
    env: '',
  };

  const THEMES = {
    dark: { background: '#1e1e1e', foreground: '#d4d4d4', cursor: '#aeafad', selectionBackground: '#264f78' },
    monokai: { background: '#272822', foreground: '#f8f8f2', cursor: '#f8f8f0', selectionBackground: '#49483e' },
    dracula: { background: '#282a36', foreground: '#f8f8f2', cursor: '#f8f8f2', selectionBackground: '#44475a' },
    nord: { background: '#2e3440', foreground: '#d8dee9', cursor: '#d8dee9', selectionBackground: '#434c5e' },
    solarized: { background: '#002b36', foreground: '#839496', cursor: '#93a1a1', selectionBackground: '#073642' },
  };

  // Tab state
  const tabs = [];
  let activeTabId = null;
  let isVisible = false;
  let isResizing = false;

  function getSettings() {
    try {
      const data = localStorage.getItem(SETTINGS_KEY);
      return data ? { ...DEFAULT_SETTINGS, ...JSON.parse(data) } : { ...DEFAULT_SETTINGS };
    } catch { return { ...DEFAULT_SETTINGS }; }
  }

  function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function parseEnvString(envStr) {
    if (!envStr || !envStr.trim()) return null;
    const env = {};
    for (const line of envStr.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.includes('=')) continue;
      const eqIdx = trimmed.indexOf('=');
      const key = trimmed.substring(0, eqIdx).trim();
      const val = trimmed.substring(eqIdx + 1).trim();
      if (key) env[key] = val;
    }
    return Object.keys(env).length > 0 ? env : null;
  }

  function init() {
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault();
        toggle();
      }
    });

    const header = document.querySelector('.terminal-header');
    header.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const actionBtn = e.target.closest('#btn-close-terminal, #btn-add-terminal, #btn-terminal-settings');
      if (actionBtn) {
        if (actionBtn.id === 'btn-close-terminal') hide();
        else if (actionBtn.id === 'btn-add-terminal') createTab();
        else if (actionBtn.id === 'btn-terminal-settings') showSettings();
        return;
      }
      const tabClose = e.target.closest('.terminal-tab-close');
      if (tabClose) {
        const tab = tabClose.closest('.terminal-tab');
        const tabId = tab && Number(tab.getAttribute('data-tab-id'));
        if (tabId != null) closeTab(tabId);
        return;
      }
      const tabEl = e.target.closest('.terminal-tab');
      if (tabEl) {
        const tabId = Number(tabEl.getAttribute('data-tab-id'));
        if (tabId != null) switchTab(tabId);
      }
    }, true);

    initSettingsDialog();

    window.api.onTerminalData((id, data) => {
      const tab = tabs.find(t => t.id === id);
      if (tab && tab.term) tab.term.write(data);
    });

    window.api.onTerminalExit((id) => {
      const tab = tabs.find(t => t.id === id);
      if (tab && tab.term) {
        tab.term.write('\r\n[Process exited]\r\n');
        tab.exited = true;
        renderTabs();
      }
    });

    initResizeHandle();
  }

  function initResizeHandle() {
    const handle = document.getElementById('terminal-resize-handle');
    const panel = document.getElementById('terminal-panel');
    const wrapper = panel.parentElement;

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isResizing = true;
      handle.classList.add('resizing');
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';

      const onMouseMove = (e) => {
        if (!isResizing) return;
        const wrapperRect = wrapper.getBoundingClientRect();
        const newHeight = wrapperRect.bottom - e.clientY;
        const clamped = Math.max(100, Math.min(wrapperRect.height * 0.9, newHeight));
        panel.style.height = clamped + 'px';
        const activeTab = tabs.find(t => t.id === activeTabId);
        if (activeTab && activeTab.fitAddon) {
          try { activeTab.fitAddon.fit(); } catch { /* ignore */ }
        }
      };

      const onMouseUp = () => {
        isResizing = false;
        handle.classList.remove('resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        localStorage.setItem(HEIGHT_KEY, panel.style.height);
        const activeTab = tabs.find(t => t.id === activeTabId);
        if (activeTab && activeTab.fitAddon) {
          try {
            activeTab.fitAddon.fit();
            window.api.terminalResize(activeTab.id, activeTab.term.cols, activeTab.term.rows);
          } catch { /* ignore */ }
        }
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  async function toggle() {
    isVisible ? hide() : await show();
  }

  async function show() {
    const panel = document.getElementById('terminal-panel');
    const handle = document.getElementById('terminal-resize-handle');
    panel.style.display = 'flex';
    handle.style.display = '';
    isVisible = true;

    const savedHeight = localStorage.getItem(HEIGHT_KEY);
    if (savedHeight) panel.style.height = savedHeight;

    if (tabs.length === 0) {
      await createTab();
    } else {
      const activeTab = tabs.find(t => t.id === activeTabId);
      if (activeTab && activeTab.fitAddon) {
        setTimeout(() => activeTab.fitAddon.fit(), 50);
      }
    }
  }

  function hide() {
    document.getElementById('terminal-panel').style.display = 'none';
    document.getElementById('terminal-resize-handle').style.display = 'none';
    isVisible = false;
  }

  function buildXtermOptions(settings) {
    const themeColors = THEMES[settings.theme] || THEMES.dark;
    return {
      fontSize: settings.fontSize,
      fontFamily: `"${settings.fontFamily}", "Consolas", monospace`,
      lineHeight: settings.lineHeight,
      cursorStyle: settings.cursorStyle,
      cursorBlink: settings.cursorBlink,
      scrollback: settings.unlimitedScrollback ? 999999 : 1000,
      theme: themeColors,
      allowProposedApi: true,
    };
  }

  async function createTab() {
    const { Terminal: XTerm } = require('xterm');
    const { FitAddon } = require('xterm-addon-fit');
    const { Unicode11Addon } = require('xterm-addon-unicode11');
    const { WebglAddon } = require('xterm-addon-webgl');
    const settings = getSettings();
    const baseName = settings.tabName || 'Terminal';

    const term = new XTerm(buildXtermOptions(settings));
    const fitAddon = new FitAddon();
    const unicode11Addon = new Unicode11Addon();
    term.loadAddon(fitAddon);
    term.loadAddon(unicode11Addon);
    term.unicode.activeVersion = '11';

    const container = document.createElement('div');
    container.className = 'terminal-container';
    container.style.display = 'none';
    document.getElementById('terminal-containers').appendChild(container);
    term.open(container);

    // Use WebGL renderer for better Unicode/font rendering
    let webglAddon = null;
    try {
      webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => { webglAddon.dispose(); webglAddon = null; });
      term.loadAddon(webglAddon);
    } catch { webglAddon = null; }

    // Determine cwd: settings.cwd > current folder > undefined
    const cwd = settings.cwd || document.getElementById('current-folder-name')?.textContent || undefined;
    // Parse env vars
    const envVars = parseEnvString(settings.env);
    let ptyId = null;
    try {
      ptyId = await window.api.terminalCreate(cwd || undefined, settings.shell, envVars);
    } catch (err) {
      term.write(`\x1b[31mTerminal error: ${err.message}\x1b[0m\r\n`);
      term.write('Please install node-pty: npm install node-pty\r\n');
    }

    const tab = { id: ptyId, term, fitAddon, webglAddon, container, label: baseName, exited: false };
    tabs.push(tab);

    term.onData((data) => {
      if (tab.id !== null) window.api.terminalInput(tab.id, data);
    });

    const ro = new ResizeObserver(() => {
      if (tab.id === activeTabId) {
        try {
          fitAddon.fit();
          if (tab.id !== null && term.cols && term.rows) {
            window.api.terminalResize(tab.id, term.cols, term.rows);
          }
        } catch { /* ignore */ }
      }
    });
    ro.observe(container);
    tab.resizeObserver = ro;

    switchTab(tab.id);

    if (ptyId !== null) {
      setTimeout(() => {
        fitAddon.fit();
        window.api.terminalResize(ptyId, term.cols, term.rows);
        if (settings.autoRun) {
          window.api.terminalInput(ptyId, settings.autoRun + '\r');
        }
      }, 150);
    }

    renderTabs();
  }

  function switchTab(id) {
    activeTabId = id;
    for (const tab of tabs) {
      tab.container.style.display = tab.id === id ? '' : 'none';
    }
    const activeTab = tabs.find(t => t.id === id);
    if (activeTab && activeTab.fitAddon) {
      setTimeout(() => {
        try {
          activeTab.fitAddon.fit();
          if (activeTab.id !== null && activeTab.term.cols && activeTab.term.rows) {
            window.api.terminalResize(activeTab.id, activeTab.term.cols, activeTab.term.rows);
          }
        } catch { /* ignore */ }
      }, 50);
    }
    renderTabs();
  }

  async function closeTab(id) {
    const idx = tabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    const tab = tabs[idx];
    if (tab.id !== null) {
      try { await window.api.terminalDestroy(tab.id); } catch { /* ignore */ }
    }
    if (tab.resizeObserver) tab.resizeObserver.disconnect();
    if (tab.webglAddon) {
      try { tab.webglAddon.dispose(); } catch { /* ignore */ }
    }
    try { tab.term.dispose(); } catch { /* ignore WebGL dispose errors */ }
    tab.container.remove();
    tabs.splice(idx, 1);

    if (tabs.length === 0) {
      activeTabId = null;
      hide();
    } else if (activeTabId === id) {
      switchTab(tabs[Math.min(idx, tabs.length - 1)].id);
    }
    renderTabs();
  }

  function updateTabLabels() {
    const baseName = getSettings().tabName || 'Terminal';
    if (tabs.length === 1) {
      tabs[0].label = baseName;
    } else {
      tabs[0].label = baseName;
      for (let i = 1; i < tabs.length; i++) {
        tabs[i].label = baseName + ' ' + (i + 1);
      }
    }
  }

  function renderTabs() {
    updateTabLabels();
    const tabBar = document.getElementById('terminal-tabs');
    tabBar.innerHTML = '';
    for (const tab of tabs) {
      const btn = document.createElement('div');
      btn.className = 'terminal-tab' + (tab.id === activeTabId ? ' active' : '');
      if (tab.exited) btn.classList.add('exited');

      const labelSpan = document.createElement('span');
      labelSpan.className = 'terminal-tab-label';
      labelSpan.textContent = tab.label;
      btn.setAttribute('data-tab-id', tab.id);
      btn.appendChild(labelSpan);

      const closeBtn = document.createElement('span');
      closeBtn.className = 'terminal-tab-close';
      closeBtn.textContent = '✕';
      btn.appendChild(closeBtn);

      tabBar.appendChild(btn);
    }
  }

  // --- Settings Dialog ---

  function showSettings() {
    const settings = getSettings();
    const dialog = document.getElementById('terminal-settings-dialog');

    document.getElementById('setting-cwd').value = settings.cwd;
    document.getElementById('setting-env').value = settings.env;
    document.getElementById('setting-shell').value = settings.shell;
    document.getElementById('setting-tabname').value = settings.tabName;
    document.getElementById('setting-autorun').value = settings.autoRun;
    document.getElementById('setting-fontfamily').value = settings.fontFamily;
    document.getElementById('setting-fontsize').value = settings.fontSize;
    document.getElementById('setting-lineheight').value = settings.lineHeight;
    document.getElementById('setting-cursor-style').value = settings.cursorStyle;
    document.getElementById('setting-cursor-blink').checked = settings.cursorBlink;
    document.getElementById('setting-theme').value = settings.theme;
    document.getElementById('setting-scrollback').checked = settings.unlimitedScrollback;

    updateThemePreview(settings.theme);
    dialog.style.display = 'flex';
    document.getElementById('setting-cwd').focus();
  }

  function updateThemePreview(themeName) {
    const preview = document.getElementById('ts-theme-preview');
    preview.setAttribute('data-theme', themeName);
  }

  function collectSettingsFromUI() {
    return {
      cwd: document.getElementById('setting-cwd').value.trim(),
      env: document.getElementById('setting-env').value.trim(),
      shell: document.getElementById('setting-shell').value.trim() || DEFAULT_SETTINGS.shell,
      tabName: document.getElementById('setting-tabname').value.trim() || DEFAULT_SETTINGS.tabName,
      autoRun: document.getElementById('setting-autorun').value.trim(),
      fontFamily: document.getElementById('setting-fontfamily').value,
      fontSize: parseInt(document.getElementById('setting-fontsize').value, 10) || 14,
      lineHeight: parseFloat(document.getElementById('setting-lineheight').value) || 1.2,
      cursorStyle: document.getElementById('setting-cursor-style').value,
      cursorBlink: document.getElementById('setting-cursor-blink').checked,
      theme: document.getElementById('setting-theme').value,
      unlimitedScrollback: document.getElementById('setting-scrollback').checked,
    };
  }

  function applySettingsToAllTabs(settings) {
    const themeColors = THEMES[settings.theme] || THEMES.dark;
    for (const tab of tabs) {
      tab.term.options.fontSize = settings.fontSize;
      tab.term.options.fontFamily = `"${settings.fontFamily}", "Consolas", monospace`;
      tab.term.options.lineHeight = settings.lineHeight;
      tab.term.options.cursorStyle = settings.cursorStyle;
      tab.term.options.cursorBlink = settings.cursorBlink;
      tab.term.options.scrollback = settings.unlimitedScrollback ? 999999 : 1000;
      tab.term.options.theme = themeColors;
      tab.fitAddon.fit();
    }
  }

  function initSettingsDialog() {
    const dialog = document.getElementById('terminal-settings-dialog');
    const closeDialog = () => { dialog.style.display = 'none'; };

    document.getElementById('btn-close-terminal-settings').addEventListener('click', closeDialog);
    document.getElementById('btn-terminal-settings-cancel').addEventListener('click', closeDialog);

    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) closeDialog();
    });

    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeDialog();
    });

    // Theme preview live update
    document.getElementById('setting-theme').addEventListener('change', (e) => {
      updateThemePreview(e.target.value);
    });

    // Browse cwd button
    document.getElementById('btn-browse-cwd').addEventListener('click', async () => {
      const folderPath = await window.api.openFolderDialog();
      if (folderPath) document.getElementById('setting-cwd').value = folderPath;
    });

    // Reset button
    document.getElementById('btn-terminal-settings-reset').addEventListener('click', () => {
      document.getElementById('setting-cwd').value = DEFAULT_SETTINGS.cwd;
      document.getElementById('setting-env').value = DEFAULT_SETTINGS.env;
      document.getElementById('setting-shell').value = DEFAULT_SETTINGS.shell;
      document.getElementById('setting-tabname').value = DEFAULT_SETTINGS.tabName;
      document.getElementById('setting-autorun').value = DEFAULT_SETTINGS.autoRun;
      document.getElementById('setting-fontfamily').value = DEFAULT_SETTINGS.fontFamily;
      document.getElementById('setting-fontsize').value = DEFAULT_SETTINGS.fontSize;
      document.getElementById('setting-lineheight').value = DEFAULT_SETTINGS.lineHeight;
      document.getElementById('setting-cursor-style').value = DEFAULT_SETTINGS.cursorStyle;
      document.getElementById('setting-cursor-blink').checked = DEFAULT_SETTINGS.cursorBlink;
      document.getElementById('setting-theme').value = DEFAULT_SETTINGS.theme;
      document.getElementById('setting-scrollback').checked = DEFAULT_SETTINGS.unlimitedScrollback;
      updateThemePreview(DEFAULT_SETTINGS.theme);
    });

    // Save button
    document.getElementById('btn-terminal-settings-save').addEventListener('click', () => {
      const newSettings = collectSettingsFromUI();
      saveSettings(newSettings);
      applySettingsToAllTabs(newSettings);
      closeDialog();
    });
  }

  return { init, toggle, show, hide, showSettings };
})();
