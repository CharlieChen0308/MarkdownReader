const fs = require('fs');
const path = require('path');

const SUPPORTED_EXTENSIONS = ['.md', '.txt', '.html', '.htm'];

// File watcher
let watcher = null;

function watchDirectory(dirPath, onChange) {
  unwatchDirectory();
  watcher = fs.watch(dirPath, { recursive: true }, (eventType, filename) => {
    if (!filename) return;
    // Only care about supported files
    const ext = path.extname(filename).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.includes(ext)) return;
    onChange(eventType, filename, path.join(dirPath, filename));
  });
  watcher.on('error', () => {}); // Silently handle errors
}

function unwatchDirectory() {
  if (watcher) { watcher.close(); watcher = null; }
}

function isSupportedFile(name) {
  const lower = name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Recursively scan directory for supported files (.md, .txt) and build tree structure
 */
function scanDirectory(dirPath) {
  const tree = buildTree(dirPath, dirPath);
  return tree;
}

function buildTree(rootPath, currentPath) {
  const entries = fs.readdirSync(currentPath, { withFileTypes: true });
  const children = [];

  // Sort: folders first, then files, both alphabetically
  const sorted = entries
    .filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules' && e.name !== 'dist')
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name, 'zh-Hant');
    });

  for (const entry of sorted) {
    const fullPath = path.join(currentPath, entry.name);
    const relativePath = path.relative(rootPath, fullPath);

    if (entry.isDirectory()) {
      const subTree = buildTree(rootPath, fullPath);
      // Only include folders that contain .md files (directly or nested)
      if (subTree.length > 0) {
        children.push({
          name: entry.name,
          path: fullPath,
          relativePath,
          type: 'directory',
          children: subTree,
        });
      }
    } else if (isSupportedFile(entry.name)) {
      children.push({
        name: entry.name,
        path: fullPath,
        relativePath,
        type: 'file',
      });
    }
  }

  return children;
}

/**
 * Read file content as UTF-8
 */
function readFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const dir = path.dirname(filePath);
    return { content, dir, filePath };
  } catch (err) {
    return { content: `❌ 無法讀取檔案：${err.message}`, dir: '', filePath };
  }
}

/**
 * Get all supported files flat list for search indexing
 */
function getAllMdFiles(dirPath) {
  const files = [];
  collectFiles(dirPath, files);
  return files;
}

function collectFiles(currentPath, files) {
  const entries = fs.readdirSync(currentPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
    const fullPath = path.join(currentPath, entry.name);
    if (entry.isDirectory()) {
      collectFiles(fullPath, files);
    } else if (isSupportedFile(entry.name)) {
      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        files.push({ path: fullPath, name: entry.name, content });
      } catch {
        // skip unreadable files
      }
    }
  }
}

/**
 * Resolve a directory link — find README.md or first .md file inside
 */
function resolveDirectoryLink(dirPath) {
  try {
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) return null;

    // Try README.md first
    const readme = path.join(dirPath, 'README.md');
    if (fs.existsSync(readme)) return readme;

    // Try readme.md (case variation)
    const readmeLower = path.join(dirPath, 'readme.md');
    if (fs.existsSync(readmeLower)) return readmeLower;

    // Fallback: first .md file alphabetically
    const entries = fs.readdirSync(dirPath).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
    for (const name of entries) {
      if (isSupportedFile(name)) {
        return path.join(dirPath, name);
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Write content to file (UTF-8)
 */
function writeFile(filePath, content) {
  try {
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { scanDirectory, readFile, getAllMdFiles, resolveDirectoryLink, writeFile, watchDirectory, unwatchDirectory };
