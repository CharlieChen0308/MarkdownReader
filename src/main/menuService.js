const { Menu, shell, clipboard } = require('electron');

let mainWindow = null;
let recentFolders = [];
let currentFilePath = null;
let currentFolderPath = null;

function init(win) {
  mainWindow = win;
  buildMenu();
}

function setRecentFolders(folders) {
  recentFolders = folders || [];
  buildMenu();
}

function setCurrentFile(filePath) {
  currentFilePath = filePath;
}

function setCurrentFolder(folderPath) {
  currentFolderPath = folderPath;
}

function send(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

function buildMenu() {
  const recentSubmenu = recentFolders.length > 0
    ? [
        ...recentFolders.map((folder) => ({
          label: folder.split(/[/\\]/).pop(),
          sublabel: folder,
          click: () => send('menu-open-recent', folder),
        })),
        { type: 'separator' },
        {
          label: '清除最近開啟記錄',
          click: () => send('menu-clear-recent'),
        },
      ]
    : [{ label: '(無記錄)', enabled: false }];

  const template = [
    {
      label: '檔案(&F)',
      submenu: [
        {
          label: '開啟資料夾...',
          accelerator: 'CmdOrCtrl+O',
          click: () => send('menu-open-folder'),
        },
        {
          label: '重新載入目錄',
          accelerator: 'CmdOrCtrl+R',
          click: () => send('menu-reload-folder'),
        },
        { type: 'separator' },
        {
          label: '儲存',
          accelerator: 'CmdOrCtrl+S',
          click: () => send('menu-save-file'),
        },
        {
          label: '編輯模式',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => send('menu-toggle-edit'),
        },
        { type: 'separator' },
        {
          label: '最近開啟',
          submenu: recentSubmenu,
        },
        { type: 'separator' },
        {
          label: '複製檔案路徑',
          accelerator: 'CmdOrCtrl+L',
          click: () => {
            if (currentFilePath) {
              clipboard.writeText(currentFilePath);
            }
          },
        },
        {
          label: '在檔案總管開啟',
          accelerator: 'CmdOrCtrl+E',
          click: () => {
            if (currentFilePath) {
              shell.showItemInFolder(currentFilePath);
            }
          },
        },
        { type: 'separator' },
        {
          label: '結束',
          accelerator: 'Alt+F4',
          role: 'quit',
        },
      ],
    },
    {
      label: '檢視(&V)',
      submenu: [
        {
          label: '搜尋',
          accelerator: 'CmdOrCtrl+F',
          click: () => send('menu-toggle-search'),
        },
        {
          label: '書籤面板',
          click: () => send('menu-toggle-bookmarks'),
        },
        {
          label: '側邊欄顯示/隱藏',
          accelerator: 'CmdOrCtrl+B',
          click: () => send('menu-toggle-sidebar'),
        },
        { type: 'separator' },
        {
          label: '放大字體',
          accelerator: 'CmdOrCtrl+=',
          click: () => send('menu-zoom', 'in'),
        },
        {
          label: '縮小字體',
          accelerator: 'CmdOrCtrl+-',
          click: () => send('menu-zoom', 'out'),
        },
        {
          label: '重設字體大小',
          accelerator: 'CmdOrCtrl+0',
          click: () => send('menu-zoom', 'reset'),
        },
        { type: 'separator' },
        {
          label: '開發者工具',
          accelerator: 'F12',
          click: () => {
            if (mainWindow) mainWindow.webContents.toggleDevTools();
          },
        },
      ],
    },
    {
      label: '設定(&S)',
      submenu: [
        {
          label: '終端機',
          accelerator: 'Ctrl+`',
          click: () => send('menu-toggle-terminal'),
        },
        {
          label: '終端機設定...',
          click: () => send('menu-terminal-settings'),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

module.exports = { init, setRecentFolders, setCurrentFile, setCurrentFolder, buildMenu };
