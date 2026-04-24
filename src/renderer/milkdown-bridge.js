/**
 * MilkdownBridge — Crepe editor lifecycle wrapped for MarkdownReader
 * Handles create/destroy/load/getMarkdown and image path rewriting.
 */
const MilkdownBridge = (() => {
  let crepe = null;
  let currentDir = '';
  let onUpdate = null;
  let suppressUpdate = false;
  let mermaidObserver = null;

  /**
   * Watch for .mermaid-placeholder elements added by renderPreview, render mermaid
   * SVG directly via DOM manipulation (bypassing Milkdown's DOMPurify.sanitize which
   * strips SVG <text>/<style>).
   */
  function setupMermaidObserver(rootEl) {
    if (mermaidObserver) mermaidObserver.disconnect();
    const process = () => {
      const placeholders = rootEl.querySelectorAll(
        '.mermaid-placeholder[data-mermaid-code]:not([data-mermaid-rendered])'
      );
      for (const ph of placeholders) {
        ph.setAttribute('data-mermaid-rendered', '1');
        let code = '';
        try {
          code = decodeURIComponent(escape(atob(ph.getAttribute('data-mermaid-code') || '')));
        } catch { /* ignore */ }
        if (!code) continue;
        renderMermaidHtml(code).then((html) => {
          // Direct innerHTML — bypasses DOMPurify entirely
          ph.innerHTML = html;
        });
      }
    };
    mermaidObserver = new MutationObserver(() => process());
    mermaidObserver.observe(rootEl, { childList: true, subtree: true });
    process(); // catch any already present
  }

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
    // htmlLabels=false → 用 SVG <text> 而非 <foreignObject><div>
    // （Milkdown 的 PreviewPanel 會走 DOMPurify.sanitize，foreignObject 內的 HTML 會被剝掉造成空白）
    window.mermaid.initialize({
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'loose',
      fontFamily: '"Microsoft JhengHei", "Noto Sans TC", sans-serif',
      flowchart: { useMaxWidth: true, htmlLabels: false },
      sequence: { useMaxWidth: true },
      class: { htmlLabels: false },
      state: { htmlLabels: false },
    });
    window.__mermaidInited = true;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * Wait for window.mermaid to appear (preload.js loads it asynchronously).
   */
  async function waitForMermaid(timeoutMs = 3000) {
    const t0 = Date.now();
    while (!window.mermaid && Date.now() - t0 < timeoutMs) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return !!window.mermaid;
  }

  /**
   * Render mermaid code to an HTML string (for Crepe's async applyPreview path).
   */
  async function renderMermaidHtml(code) {
    if (!(await waitForMermaid())) {
      return `<div class="mermaid-error"><div class="mermaid-error-msg">Mermaid 未載入</div><pre>${esc(code)}</pre></div>`;
    }
    ensureMermaidInit();
    try {
      const id = `mermaid-crepe-${mermaidIdCounter++}`;
      const { svg } = await window.mermaid.render(id, code);
      return `<div class="mermaid-preview">${svg}</div>`;
    } catch (err) {
      console.warn('mermaid render error:', err);
      return `<div class="mermaid-error"><div class="mermaid-error-msg">Mermaid 渲染失敗</div><pre>${esc(code)}</pre></div>`;
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
            // 回傳 placeholder 讓 MutationObserver 直接注入 SVG（繞過 DOMPurify，
            // 否則 sanitize 會剝掉 SVG <text>/<style> 導致框有字沒）
            const encoded = btoa(unescape(encodeURIComponent(content)));
            return `<div class="mermaid-placeholder" data-mermaid-code="${encoded}"></div>`;
          },
          previewLabel: () => '圖表預覽',
          // mermaid 預設直接顯示渲染結果；非 mermaid 的 renderPreview 回 null，此旗標對它們不影響
          previewOnlyByDefault: true,
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

    // Start mermaid placeholder observer
    setupMermaidObserver(rootEl);

    return crepe;
  }

  async function destroy() {
    if (mermaidObserver) {
      mermaidObserver.disconnect();
      mermaidObserver = null;
    }
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
