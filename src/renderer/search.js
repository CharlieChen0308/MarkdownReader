/**
 * Search — full-text search UI
 */
const Search = (() => {
  let isVisible = false;
  let debounceTimer = null;
  let onResultSelect = null;

  function init(callback) {
    onResultSelect = callback;

    const input = document.getElementById('search-input');
    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => performSearch(input.value.trim()), 300);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hide();
    });

    document.getElementById('btn-toggle-search').addEventListener('click', toggle);
    document.getElementById('btn-close-search').addEventListener('click', hide);
  }

  function toggle() {
    if (isVisible) {
      hide();
    } else {
      show();
    }
  }

  function show() {
    isVisible = true;
    const panel = document.getElementById('search-panel');
    panel.style.display = 'flex';
    document.getElementById('btn-toggle-search').classList.add('active');
    document.getElementById('search-input').focus();
  }

  function hide() {
    isVisible = false;
    document.getElementById('search-panel').style.display = 'none';
    document.getElementById('btn-toggle-search').classList.remove('active');
    Viewer.setHighlightQuery('');
  }

  async function performSearch(query) {
    const container = document.getElementById('search-results');

    if (!query) {
      container.innerHTML = '';
      Viewer.setHighlightQuery('');
      return;
    }

    const results = await window.api.search(query);
    Viewer.setHighlightQuery(query);

    if (results.length === 0) {
      container.innerHTML = '<div style="padding:12px;color:#888;font-size:13px;">找不到相關結果</div>';
      return;
    }

    container.innerHTML = results
      .map(
        (r) => `
      <div class="search-result-item" data-path="${escapeAttr(r.path)}">
        <div class="search-result-name">📄 ${escapeHtml(r.name)}</div>
        <div class="search-result-snippet">${escapeHtml(r.snippet)}</div>
      </div>
    `
      )
      .join('');

    container.querySelectorAll('.search-result-item').forEach((el) => {
      el.addEventListener('click', () => {
        if (onResultSelect) onResultSelect(el.dataset.path);
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

  return { init, show, hide, toggle };
})();
