/**
 * Markdown Viewer — renders MD content using markdown-it + highlight.js + mermaid
 */
const Viewer = (() => {
  let md = null;
  let currentDir = '';
  let highlightQuery = '';
  let mermaidReady = false;
  let mermaidIdCounter = 0;

  function init() {
    const markdownIt = require('markdown-it');
    const hljs = require('highlight.js');

    md = markdownIt({
      html: true,
      linkify: true,
      typographer: true,
      breaks: true,
      highlight: (str, lang) => {
        // Mermaid blocks: render as div placeholder (not code)
        if (lang === 'mermaid') {
          const id = `mermaid-${mermaidIdCounter++}`;
          return `</code></pre><div class="mermaid" id="${id}">${escapeHtml(str)}</div><pre style="display:none"><code>`;
        }
        // No language specified: detect ASCII art diagrams
        if (!lang && isAsciiArt(str)) {
          return `<span class="ascii-art">${escapeHtml(str)}</span>`;
        }
        if (lang && hljs.getLanguage(lang)) {
          try {
            let result = hljs.highlight(str, { language: lang }).value;
            if (lang === 'gherkin') result = postProcessGherkin(result);
            return result;
          } catch { /* fallback */ }
        }
        return hljs.highlightAuto(str).value;
      },
    });

    // Enable checkbox rendering
    md.use(checkboxPlugin);

    // Init mermaid (loaded via <script> tag as global)
    initMermaid();
  }

  function initMermaid() {
    // Wait for mermaid script to load (injected by preload.js)
    const tryInit = () => {
      if (typeof window.mermaid === 'undefined') {
        setTimeout(tryInit, 100);
        return;
      }
      try {
        window.mermaid.initialize({
          startOnLoad: false,
          theme: 'default',
          securityLevel: 'loose',
          fontFamily: '"Microsoft JhengHei", "Noto Sans TC", sans-serif',
          flowchart: { useMaxWidth: true, htmlLabels: true },
          sequence: { useMaxWidth: true },
          classDiagram: { useMaxWidth: true },
          stateDiagram: { useMaxWidth: true },
        });
        mermaidReady = true;
      } catch (err) {
        console.warn('Mermaid init failed:', err);
      }
    };
    tryInit();
  }

  // Interactive checkbox plugin for task lists
  function checkboxPlugin(md) {
    md.core.ruler.after('inline', 'checkbox', (state) => {
      for (const token of state.tokens) {
        if (token.type === 'inline' && token.children) {
          const line = token.map ? token.map[0] : -1;
          for (const child of token.children) {
            if (child.type === 'text') {
              if (child.content.startsWith('[ ] ')) {
                child.content = child.content.slice(4);
                const checkbox = new state.Token('html_inline', '', 0);
                checkbox.content = `<input type="checkbox" class="task-checkbox" data-line="${line}"> `;
                token.children.splice(token.children.indexOf(child), 0, checkbox);
                break;
              } else if (child.content.startsWith('[x] ') || child.content.startsWith('[X] ')) {
                child.content = child.content.slice(4);
                const checkbox = new state.Token('html_inline', '', 0);
                checkbox.content = `<input type="checkbox" class="task-checkbox" data-line="${line}" checked> `;
                token.children.splice(token.children.indexOf(child), 0, checkbox);
                break;
              }
            }
          }
        }
      }
    });
  }

  /**
   * Render content to HTML (markdown or plain text based on file type)
   */
  function render(content, fileDir, filePath) {
    if (!md) init();
    currentDir = fileDir;

    // Plain text files: wrap in <pre> for readability
    const isPlainText = filePath && filePath.toLowerCase().endsWith('.txt');
    let html;
    if (isPlainText) {
      const escaped = content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      html = `<pre class="plain-text">${escaped}</pre>`;
    } else {
      html = md.render(content);
    }

    // Clean up the empty pre/code wrappers from mermaid hack
    html = html.replace(/<pre style="display:none"><code><\/code><\/pre>/g, '');

    // Resolve relative image paths to local-file protocol
    if (fileDir) {
      html = html.replace(
        /(<img\s+[^>]*src=")(?!https?:\/\/|data:|local-file:|file:)([^"]+)(")/g,
        (match, prefix, src, suffix) => {
          const resolved = resolveLocalImagePath(fileDir, src);
          // Encode each segment (keeps '/' intact, encodes ':' etc.)
          const encoded = resolved.split('/').map((seg) => encodeURIComponent(seg)).join('/');
          // Triple-slash form avoids `C:` being parsed as host:port
          return `${prefix}local-file:///${encoded}${suffix}`;
        }
      );
    }

    // Add color swatches next to hex color codes
    html = addColorSwatches(html);

    // Apply search highlight if active
    if (highlightQuery) {
      html = applyHighlight(html, highlightQuery);
    }

    // Schedule mermaid rendering after DOM update
    setTimeout(() => renderMermaidDiagrams(), 50);

    return html;
  }

  /**
   * Find all .mermaid divs and render them as SVG diagrams
   */
  async function renderMermaidDiagrams() {
    if (!mermaidReady) return;
    const elements = document.querySelectorAll('.mermaid:not([data-processed])');

    for (const el of elements) {
      const code = el.textContent.trim();
      if (!code) continue;

      try {
        const id = el.id || `mermaid-auto-${mermaidIdCounter++}`;
        const { svg } = await window.mermaid.render(id + '-svg', code);
        el.innerHTML = svg;
        addMermaidColorSwatches(el);
        el.setAttribute('data-processed', 'true');
      } catch (err) {
        // Show the raw code as fallback with error hint
        el.innerHTML = `<div class="mermaid-error">
          <div class="mermaid-error-msg">Mermaid 圖表渲染失敗</div>
          <pre>${escapeHtml(code)}</pre>
        </div>`;
        el.setAttribute('data-processed', 'true');
        console.warn('Mermaid render error:', err);
      }
    }
  }

  function setHighlightQuery(query) {
    highlightQuery = query;
  }

  function applyHighlight(html, query) {
    if (!query) return html;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    return html.replace(/>([^<]+)</g, (match, text) => {
      return '>' + text.replace(regex, '<span class="search-highlight">$1</span>') + '<';
    });
  }

  /**
   * Post-process highlight.js gherkin output for richer layout
   */
  function postProcessGherkin(html) {
    return html.split('\n').map(line => {
      const trimmed = line.trim();
      // Feature line
      if (trimmed.startsWith('<span class="hljs-keyword">Feature</span>')) {
        return `<span class="gherkin-feature-line">${line}</span>`;
      }
      // Scenario / Scenario Outline
      if (trimmed.startsWith('<span class="hljs-keyword">Scenario</span>') ||
          trimmed.startsWith('<span class="hljs-keyword">Scenario Outline</span>')) {
        return `<span class="gherkin-scenario-line">${line}</span>`;
      }
      // Background
      if (trimmed.startsWith('<span class="hljs-keyword">Background</span>')) {
        return `<span class="gherkin-scenario-line">${line}</span>`;
      }
      // Steps: Given / When / Then / And / But
      if (trimmed.startsWith('<span class="hljs-keyword">Given</span>') ||
          trimmed.startsWith('<span class="hljs-keyword">When</span>') ||
          trimmed.startsWith('<span class="hljs-keyword">Then</span>') ||
          trimmed.startsWith('<span class="hljs-keyword">And</span>') ||
          trimmed.startsWith('<span class="hljs-keyword">But</span>')) {
        return `<span class="gherkin-step-line">${line}</span>`;
      }
      // User story lines (作為/我想要/以便)
      if (trimmed.match(/^(作為|我想要|以便|As a|I want|So that|In order to)/)) {
        return `<span class="gherkin-story-line">${line}</span>`;
      }
      return line;
    }).join('\n');
  }

  /**
   * Detect ASCII art / text diagrams (box-drawing chars, arrows, CJK in code blocks)
   */
  function isAsciiArt(str) {
    const boxChars = /[─│┌┐└┘├┤┬┴┼╔╗╚╝║═←→↑↓↔├┤┬┴┼【】]/;
    const arrowPattern = /[←→↑↓↔⬆⬇⬅➡<\->]{2,}/;
    const hasCJK = /[\u4e00-\u9fff\u3400-\u4dbf]/;
    const multipleSpaces = /^ {4,}/m; // significant indentation (diagram alignment)

    if (boxChars.test(str) && hasCJK.test(str)) return true;
    if (arrowPattern.test(str) && multipleSpaces.test(str)) return true;
    return false;
  }

  /**
   * Insert inline color swatches after hex color codes (#RGB, #RRGGBB, #RRGGBBAA)
   * Works on HTML string for non-mermaid content
   */
  function addColorSwatches(html) {
    // Split by mermaid blocks — preserve them untouched
    return html.replace(
      /(<div class="mermaid"[^>]*>[\s\S]*?<\/div>)|>([^<]+)</g,
      (match, mermaidBlock, textContent) => {
        if (mermaidBlock) return mermaidBlock; // skip mermaid
        if (!textContent) return match;
        const replaced = textContent.replace(
          /#([0-9a-fA-F]{3,8})\b/g,
          (colorMatch, hex) => {
            if (![3, 4, 6, 8].includes(hex.length)) return colorMatch;
            let displayColor = colorMatch;
            if (hex.length <= 4) {
              displayColor = `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
            }
            return `${colorMatch}<span class="color-swatch" style="background:${displayColor}"></span>`;
          }
        );
        return `>${replaced}<`;
      }
    );
  }

  /**
   * Inject color swatches into rendered mermaid SVG labels (foreignObject spans)
   */
  function addMermaidColorSwatches(mermaidEl) {
    const labels = mermaidEl.querySelectorAll('foreignObject span');
    for (const label of labels) {
      // Skip if already processed
      if (label.querySelector('.mermaid-color-swatch')) continue;

      const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
      const textNodes = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode);

      for (const node of textNodes) {
        const text = node.textContent;
        if (!/#[0-9a-fA-F]{3,8}\b/.test(text)) continue;

        const fragment = document.createDocumentFragment();
        let lastIndex = 0;
        const regex = /#([0-9a-fA-F]{3,8})\b/g;
        let m;

        while ((m = regex.exec(text)) !== null) {
          const hex = m[1];
          if (![3, 4, 6, 8].includes(hex.length)) continue;

          // Text before match
          if (m.index > lastIndex) {
            fragment.appendChild(document.createTextNode(text.slice(lastIndex, m.index)));
          }
          // Color code text
          fragment.appendChild(document.createTextNode(m[0]));

          // Color swatch (small size for diagram)
          const swatch = document.createElement('span');
          swatch.className = 'mermaid-color-swatch';
          let color = m[0];
          if (hex.length <= 4) {
            color = `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`;
          }
          swatch.style.background = color;
          fragment.appendChild(swatch);

          lastIndex = m.index + m[0].length;
        }

        if (lastIndex > 0) {
          if (lastIndex < text.length) {
            fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
          }
          node.parentNode.replaceChild(fragment, node);
        }
      }
    }
  }

  /**
   * Resolve `./foo` and `../foo` relative to fileDir, return forward-slash path
   */
  function resolveLocalImagePath(fileDir, src) {
    const baseParts = fileDir.replace(/\\/g, '/').split('/').filter(Boolean);
    const relParts = src.replace(/\\/g, '/').split('/');
    // Preserve Windows drive letter segment ("C:") if present
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

  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return { init, render, setHighlightQuery };
})();
