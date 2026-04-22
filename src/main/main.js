const { app, BrowserWindow, ipcMain, dialog, protocol, clipboard, shell, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const fileService = require('./fileService');
const searchService = require('./searchService');
const menuService = require('./menuService');
const terminalService = require('./terminalService');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'MarkdownReader',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: false,
      nodeIntegration: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Register custom protocol for local images (triple-slash form: local-file:///C%3A/...)
  protocol.registerFileProtocol('local-file', (request, callback) => {
    try {
      const u = new URL(request.url);
      let filePath = decodeURIComponent(u.pathname);
      // Strip leading slash before Windows drive letter: "/C:/..." -> "C:/..."
      if (/^\/[A-Za-z]:\//.test(filePath)) filePath = filePath.substring(1);
      callback({ path: filePath });
    } catch (err) {
      console.error('local-file protocol error:', err, request.url);
      callback({ error: -6 }); // FILE_NOT_FOUND
    }
  });

  // Init menu after window is ready
  menuService.init(mainWindow);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  fileService.unwatchDirectory();
  terminalService.destroyAll();
  app.quit();
});

// IPC handlers
ipcMain.handle('open-folder-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '選擇 Markdown 資料夾',
  });
  if (result.canceled) return null;
  return result.filePaths[0];
});

ipcMain.handle('scan-directory', async (_event, dirPath) => {
  return fileService.scanDirectory(dirPath);
});

ipcMain.handle('read-file', async (_event, filePath) => {
  return fileService.readFile(filePath);
});

ipcMain.handle('build-search-index', async (_event, dirPath) => {
  return searchService.buildIndex(dirPath);
});

ipcMain.handle('search', async (_event, query) => {
  return searchService.search(query);
});


ipcMain.handle('resolve-directory-link', async (_event, dirPath) => {
  return fileService.resolveDirectoryLink(dirPath);
});

ipcMain.handle('write-file', async (_event, filePath, content) => {
  return fileService.writeFile(filePath, content);
});

ipcMain.handle('watch-directory', async (_event, dirPath) => {
  fileService.watchDirectory(dirPath, (eventType, filename, fullPath) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('file-changed', { eventType, filename, fullPath });
    }
  });
  return true;
});

ipcMain.handle('unwatch-directory', async () => {
  fileService.unwatchDirectory();
  return true;
});

// Terminal IPC (multi-instance)
ipcMain.handle('terminal-create', async (_event, cwd, shellPath, envVars) => {
  const { id, process: p } = terminalService.create(cwd, shellPath, envVars);
  p.onData((data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal-data', id, data);
    }
  });
  p.onExit(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('terminal-exit', id);
    }
  });
  return id;
});
ipcMain.on('terminal-input', (_event, id, data) => terminalService.write(id, data));
ipcMain.on('terminal-resize', (_event, id, cols, rows) => terminalService.resize(id, cols, rows));
ipcMain.handle('terminal-destroy', async (_event, id) => { terminalService.destroy(id); return true; });

// File context menu IPC handlers
ipcMain.handle('copy-file-to-clipboard', async (_event, filePath) => {
  if (process.platform === 'win32') {
    const { execSync } = require('child_process');
    const tmpScript = path.join(app.getPath('temp'), 'mdreader-copy-file.ps1');
    // Use single quotes in PowerShell to avoid path escaping issues
    const escaped = filePath.replace(/'/g, "''");
    const scriptContent =
      "Add-Type -AssemblyName System.Windows.Forms\r\n" +
      "$f = [System.Collections.Specialized.StringCollection]::new()\r\n" +
      "$f.Add('" + escaped + "')\r\n" +
      "[System.Windows.Forms.Clipboard]::SetFileDropList($f)\r\n";
    fs.writeFileSync(tmpScript, scriptContent, 'utf8');
    try {
      execSync('powershell -STA -ExecutionPolicy Bypass -File "' + tmpScript + '"', { windowsHide: true, timeout: 5000 });
      return true;
    } catch (err) {
      console.error('copy-file-to-clipboard error:', err.stderr?.toString() || err.message);
      return false;
    } finally {
      try { fs.unlinkSync(tmpScript); } catch { /* ignore */ }
    }
  }
  return false;
});

ipcMain.handle('copy-path-to-clipboard', async (_event, filePath) => {
  clipboard.writeText(filePath);
  return true;
});

ipcMain.handle('show-in-explorer', async (_event, filePath) => {
  shell.showItemInFolder(filePath);
  return true;
});

ipcMain.handle('open-in-default-app', async (_event, filePath) => {
  await shell.openPath(filePath);
  return true;
});

ipcMain.handle('get-file-name', async (_event, filePath) => {
  return path.basename(filePath);
});

ipcMain.on('start-drag', (event, filePath) => {
  try {
    const iconFile = ensureDragIcon();
    event.sender.startDrag({ file: filePath, icon: iconFile });
  } catch { /* silently fail */ }
});

// Create a drag icon PNG file once, reuse it
let _dragIconPath = null;
function ensureDragIcon() {
  if (_dragIconPath && fs.existsSync(_dragIconPath)) return _dragIconPath;
  _dragIconPath = path.join(app.getPath('temp'), 'mdreader-drag-icon.png');
  // Use Electron to create a simple colored square as PNG
  const size = 32;
  const rgbaBuf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const border = x < 2 || x >= 30 || y < 1 || y >= 31;
      rgbaBuf[i]     = border ? 120 : 210; // R
      rgbaBuf[i + 1] = border ? 130 : 215; // G
      rgbaBuf[i + 2] = border ? 150 : 240; // B
      rgbaBuf[i + 3] = border ? 200 : 240; // A
    }
  }
  const img = nativeImage.createFromBitmap(rgbaBuf, { width: size, height: size });
  fs.writeFileSync(_dragIconPath, img.toPNG());
  return _dragIconPath;
}

// Menu-related IPC: renderer notifies main of state changes
ipcMain.on('update-recent-folders', (_event, folders) => {
  menuService.setRecentFolders(folders);
});

ipcMain.on('update-current-file', (_event, filePath) => {
  menuService.setCurrentFile(filePath);
});

ipcMain.on('update-current-folder', (_event, folderPath) => {
  menuService.setCurrentFolder(folderPath);
});
