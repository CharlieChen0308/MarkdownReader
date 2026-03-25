const { ipcRenderer } = require('electron');
const path = require('path');

// Load mermaid.min.js via dynamic script tag (works in both dev and asar)
const mermaidPath = path.join(__dirname, '..', 'node_modules', 'mermaid', 'dist', 'mermaid.min.js');
const script = document.createElement('script');
script.src = 'file:///' + mermaidPath.replace(/\\/g, '/');
script.onload = () => {
  window.__mermaidLoaded = true;
};
script.onerror = () => {
  console.warn('Failed to load mermaid from:', mermaidPath);
};
document.addEventListener('DOMContentLoaded', () => {
  document.head.appendChild(script);
});

window.api = {
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  scanDirectory: (dirPath) => ipcRenderer.invoke('scan-directory', dirPath),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  buildSearchIndex: (dirPath) => ipcRenderer.invoke('build-search-index', dirPath),
  search: (query) => ipcRenderer.invoke('search', query),
  resolveDirectoryLink: (dirPath) => ipcRenderer.invoke('resolve-directory-link', dirPath),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
  watchDirectory: (dirPath) => ipcRenderer.invoke('watch-directory', dirPath),
  unwatchDirectory: () => ipcRenderer.invoke('unwatch-directory'),
  onFileChange: (callback) => ipcRenderer.on('file-changed', (_e, data) => callback(data)),

  // Terminal (multi-instance)
  terminalCreate: (cwd, shellPath, envVars) => ipcRenderer.invoke('terminal-create', cwd, shellPath, envVars),
  terminalInput: (id, data) => ipcRenderer.send('terminal-input', id, data),
  terminalResize: (id, cols, rows) => ipcRenderer.send('terminal-resize', id, cols, rows),
  terminalDestroy: (id) => ipcRenderer.invoke('terminal-destroy', id),
  onTerminalData: (cb) => ipcRenderer.on('terminal-data', (_e, id, data) => cb(id, data)),
  onTerminalExit: (cb) => ipcRenderer.on('terminal-exit', (_e, id) => cb(id)),

  // Menu state sync: renderer → main
  updateRecentFolders: (folders) => ipcRenderer.send('update-recent-folders', folders),
  updateCurrentFile: (filePath) => ipcRenderer.send('update-current-file', filePath),
  updateCurrentFolder: (folderPath) => ipcRenderer.send('update-current-folder', folderPath),

  // Menu actions: main → renderer
  onMenuAction: (channel, callback) => ipcRenderer.on(channel, (_event, ...args) => callback(...args)),
};
