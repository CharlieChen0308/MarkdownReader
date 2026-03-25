const { app, BrowserWindow, ipcMain, dialog, protocol } = require('electron');
const path = require('path');
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

  // Register custom protocol for local images
  protocol.registerFileProtocol('local-file', (request, callback) => {
    const filePath = decodeURIComponent(request.url.replace('local-file://', ''));
    callback({ path: filePath });
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
