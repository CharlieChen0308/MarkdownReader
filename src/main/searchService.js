const MiniSearch = require('minisearch');
const fileService = require('./fileService');

let miniSearch = null;

/**
 * Build full-text search index for all .md files in directory
 */
function buildIndex(dirPath) {
  const files = fileService.getAllMdFiles(dirPath);

  miniSearch = new MiniSearch({
    fields: ['name', 'content'],
    storeFields: ['name', 'path', 'snippet'],
    tokenize: (text) => {
      // Support CJK characters: split by whitespace AND individual CJK chars
      const tokens = [];
      // Standard word tokenization
      const words = text.split(/[\s\-_/\\.,;:!?()[\]{}'"<>]+/).filter(Boolean);
      tokens.push(...words);
      // CJK bigram tokenization for better Chinese search
      const cjkRegex = /[\u4e00-\u9fff\u3400-\u4dbf]/g;
      let match;
      while ((match = cjkRegex.exec(text)) !== null) {
        tokens.push(match[0]);
        // Also add bigrams
        const nextChar = text[match.index + 1];
        if (nextChar && /[\u4e00-\u9fff\u3400-\u4dbf]/.test(nextChar)) {
          tokens.push(match[0] + nextChar);
        }
      }
      return tokens;
    },
  });

  const docs = files.map((f, i) => ({
    id: i,
    name: f.name,
    path: f.path,
    content: f.content,
    snippet: f.content.substring(0, 200),
  }));

  miniSearch.addAll(docs);
  return { count: docs.length };
}

/**
 * Search indexed documents
 */
function search(query) {
  if (!miniSearch) return [];

  const results = miniSearch.search(query, {
    prefix: true,
    fuzzy: 0.2,
    boost: { name: 2 },
  });

  return results.slice(0, 20).map((r) => ({
    name: r.name,
    path: r.path,
    snippet: r.snippet,
    score: r.score,
  }));
}

module.exports = { buildIndex, search };
