/**
 * MilkdownBridge — Crepe editor lifecycle wrapped for MarkdownReader
 * Handles create/destroy/load/getMarkdown and image path rewriting.
 */
const MilkdownBridge = (() => {
  let crepe = null;
  let currentDir = '';
  let onUpdate = null;
  let suppressUpdate = false;

  /**
   * Resolve ./foo and ../foo against fileDir, return forward-slash absolute path
   */
  function resolvePath(fileDir, src) {
    const baseParts = fileDir.replace(/\\/g, '/').split('/').filter(Boolean);
    const relParts = src.replace(/\\/g, '/').split('/');
    const isWinDrive = /^[A-Za-z]:$/.test(baseParts[0] || '');
    for (const p of relParts) {
      if (!p || p === '.') continue;
      if (p === '..') {
        if (baseParts.length > (isWinDrive ? 1 : 0)) baseParts.pop();
      } else {
        baseParts.push(p);
      }
    }
    return baseParts.join('/');
  }

  /**
   * Compute a relative path from fromDir to toPath (both forward-slash absolute).
   */
  function makeRelative(fromDir, toPath) {
    const fromParts = fromDir.replace(/\\/g, '/').split('/').filter(Boolean);
    const toParts = toPath.replace(/\\/g, '/').split('/').filter(Boolean);
    let i = 0;
    while (i < fromParts.length && i < toParts.length &&
           fromParts[i].toLowerCase() === toParts[i].toLowerCase()) i++;
    const ups = fromParts.length - i;
    const downs = toParts.slice(i);
    if (ups === 0 && downs.length === toParts.length) return toParts.join('/');
    const prefix = ups === 0 ? './' : '../'.repeat(ups);
    return prefix + downs.join('/');
  }

  /**
   * Rewrite relative image URLs in markdown to local-file:/// absolute URLs
   * for correct display in the editor.
   */
  function toDisplayMarkdown(md, fileDir) {
    if (!fileDir) return md;
    const dir = fileDir.replace(/\\/g, '/');
    return md.replace(
      /(!\[[^\]]*\]\()((?!https?:\/\/|data:|local-file:|file:|#)[^)\s]+)(\s*(?:"[^"]*"|'[^']*')?\s*\))/g,
      (m, open, src, close) => {
        // Skip absolute unix paths (already absolute)
        if (src.startsWith('/') && !/^\/[A-Za-z]:/.test(src)) return m;
        const resolved = resolvePath(dir, src);
        const encoded = resolved.split('/').map(encodeURIComponent).join('/');
        return `${open}local-file:///${encoded}${close}`;
      }
    );
  }

  /**
   * Reverse transform: convert local-file:/// URLs back to paths relative to fileDir
   * for saving to disk.
   */
  function toSourceMarkdown(md, fileDir) {
    if (!fileDir) return md;
    const dir = fileDir.replace(/\\/g, '/');
    return md.replace(
      /(!\[[^\]]*\]\()local-file:\/\/\/([^)\s]+)(\s*(?:"[^"]*"|'[^']*')?\s*\))/g,
      (m, open, encoded, close) => {
        let abs = decodeURIComponent(encoded);
        if (abs.startsWith('/') && /^\/[A-Za-z]:/.test(abs)) abs = abs.substring(1);
        const rel = makeRelative(dir, abs);
        return `${open}${rel}${close}`;
      }
    );
  }

  let mermaidIdCounter = 0;
  function ensureMermaidInit() {
    if (!window.mermaid || window.__mermaidInited) return;
    window.mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'loose',
      fontFamily: '"Microsoft JhengHei", "Noto Sans TC", sans-serif',
      flowchart: { useMaxWidth: true, htmlLabels: true },
      sequence: { useMaxWidth: true },
    });
    window.__mermaidInited = true;
  }

  async function renderMermaidInto(container, code) {
    const tryRender = async () => {
      if (!window.mermaid) return false;
      ensureMermaidInit();
      try {
        const id = `mermaid-crepe-${mermaidIdCounter++}`;
        const { svg } = await window.mermaid.render(id, code);
        container.innerHTML = svg;
      } catch (err) {
        const safe = code
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        container.innerHTML =
          `<div class="mermaid-error"><div class="mermaid-error-msg">Mermaid 渲染失敗</div><pre>${safe}</pre></div>`;
        console.warn('mermaid render error:', err);
      }
      return true;
    };
    if (!(await tryRender())) {
      // Mermaid script may still be loading; retry after a beat
      setTimeout(tryRender, 300);
    }
  }

  /**
   * Mount Crepe on the given root element with initial markdown.
   * callbacks.onMarkdownUpdate(markdown) fires when user edits content.
   * callbacks.onLinkClick(href) fires when user Ctrl+clicks or clicks an internal link.
   */
  async function mount(rootEl, markdown, fileDir, callbacks = {}) {
    await destroy();
    currentDir = fileDir || '';
    onUpdate = callbacks.onMarkdownUpdate || null;
    suppressUpdate = true; // ignore any events during initial parse

    const { Crepe } = window.MilkdownBundle;
    const displayMd = toDisplayMarkdown(markdown, currentDir);

    crepe = new Crepe({
      root: rootEl,
      defaultValue: displayMd,
      featureConfigs: {
        [Crepe.Feature.Placeholder]: {
          text: '',
        },
        [Crepe.Feature.CodeMirror]: {
          renderPreview: (language, content) => {
            if (!language || language.toLowerCase() !== 'mermaid') return null;
            if (!content || !content.trim()) return null;
            const container = document.createElement('div');
            container.className = 'mermaid-preview';
            renderMermaidInto(container, content);
            return container;
          },
          previewLabel: () => '圖表預覽',
        },
      },
    });

    await crepe.create();

    // Register update listener
    crepe.on((listener) => {
      listener.markdownUpdated((ctx, md) => {
        if (suppressUpdate) return;
        if (!onUpdate) return;
        const sourceMd = toSourceMarkdown(md, currentDir);
        onUpdate(sourceMd, md);
      });
    });

    // Intercept link clicks for internal .md/.txt/.htm navigation
    if (callbacks.onLinkClick) {
      rootEl.addEventListener('click', (e) => {
        const a = e.target.closest('a');
        if (!a) return;
        const href = a.getAttribute('href');
        if (!href) return;
        // Let Crepe's link tooltip handle its own UI
        if (e.defaultPrevented) return;
        // Only intercept on Ctrl+click or when clicking with editor not focused on this link
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          e.stopPropagation();
          callbacks.onLinkClick(href);
        }
      }, true);
    }

    // Allow updates after the initial parse settles
    setTimeout(() => { suppressUpdate = false; }, 100);

    return crepe;
  }

  async function destroy() {
    if (!crepe) return;
    try {
      await crepe.destroy();
    } catch (err) {
      console.warn('Crepe destroy error:', err);
    }
    crepe = null;
  }

  function getMarkdown() {
    if (!crepe) return '';
    const md = crepe.getMarkdown();
    return toSourceMarkdown(md, currentDir);
  }

  function getDisplayMarkdown() {
    if (!crepe) return '';
    return crepe.getMarkdown();
  }

  function setReadonly(readonly) {
    if (!crepe) return;
    try { crepe.setReadonly(readonly); } catch { /* noop */ }
  }

  /**
   * Replace content without triggering onMarkdownUpdate (used by file watcher).
   */
  async function replaceContent(markdown, fileDir) {
    if (!crepe) return;
    currentDir = fileDir || currentDir;
    const displayMd = toDisplayMarkdown(markdown, currentDir);
    suppressUpdate = true;
    try {
      const { replaceAll } = window.MilkdownBundle;
      crepe.editor.action(replaceAll(displayMd));
    } catch (err) {
      console.warn('Crepe replace content error:', err);
    } finally {
      // Allow the next user-driven update through
      setTimeout(() => { suppressUpdate = false; }, 50);
    }
  }

  function isMounted() {
    return !!crepe;
  }

  return {
    mount,
    destroy,
    getMarkdown,
    getDisplayMarkdown,
    setReadonly,
    replaceContent,
    isMounted,
    toDisplayMarkdown,
    toSourceMarkdown,
  };
})();
