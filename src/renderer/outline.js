/**
 * Outline — document heading outline / TOC (like OneNote)
 */
const Outline = (() => {
  let outlineList = null;
  let contentEl = null;
  let isVisible = false;

  function init() {
    outlineList = document.getElementById('outline-list');
    const panel = document.getElementById('outline-panel');

    // Toggle collapse
    panel.querySelector('.panel-header').addEventListener('click', () => {
      panel.classList.toggle('collapsed');
    });
  }

  /**
   * Rebuild outline from rendered headings in markdown-content
   */
  function update() {
    if (!outlineList) return;
    contentEl = document.getElementById('markdown-content');
    if (!contentEl) return;

    const headings = contentEl.querySelectorAll('h1, h2, h3, h4, h5, h6');
    if (headings.length === 0) {
      outlineList.innerHTML = '<div class="outline-empty">此文件無標題</div>';
      return;
    }

    // Find the minimum heading level for proper indentation
    let minLevel = 6;
    headings.forEach(h => {
      const level = parseInt(h.tagName[1]);
      if (level < minLevel) minLevel = level;
    });

    outlineList.innerHTML = '';
    headings.forEach((h, index) => {
      const level = parseInt(h.tagName[1]);
      const indent = level - minLevel;
      const item = document.createElement('div');
      item.className = `outline-item outline-level-${indent}`;
      item.dataset.index = index;

      const text = h.textContent.replace(/[\u2705\u2757\u26A0\uFE0F]/g, '').trim(); // strip emoji
      item.textContent = text;
      item.title = text;

      item.addEventListener('click', (e) => {
        e.stopPropagation();
        h.scrollIntoView({ behavior: 'smooth', block: 'start' });
        setActive(index);
      });

      outlineList.appendChild(item);
    });

    // Show the outline panel
    document.getElementById('outline-panel').style.display = '';
  }

  function setActive(index) {
    if (!outlineList) return;
    outlineList.querySelectorAll('.outline-item.active').forEach(el => el.classList.remove('active'));
    const target = outlineList.querySelector(`.outline-item[data-index="${index}"]`);
    if (target) {
      target.classList.add('active');
      // Scroll outline list to show active item
      target.scrollIntoView({ block: 'nearest' });
    }
  }

  /**
   * Highlight the current heading based on viewer scroll position
   */
  function syncWithScroll() {
    if (!contentEl || !outlineList) return;
    const headings = contentEl.querySelectorAll('h1, h2, h3, h4, h5, h6');
    if (headings.length === 0) return;

    const scrollTop = contentEl.scrollTop;
    let activeIndex = 0;

    for (let i = 0; i < headings.length; i++) {
      // Use offsetTop relative to the scrollable container
      const headingTop = headings[i].offsetTop - contentEl.offsetTop;
      if (headingTop <= scrollTop + 60) {
        activeIndex = i;
      } else {
        break;
      }
    }

    setActive(activeIndex);
  }

  /**
   * Clear outline when no file is open
   */
  function clear() {
    if (outlineList) outlineList.innerHTML = '';
    document.getElementById('outline-panel').style.display = 'none';
  }

  return { init, update, syncWithScroll, clear };
})();
