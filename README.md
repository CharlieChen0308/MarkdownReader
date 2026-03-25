# MarkdownReader — 專案指引

## 專案概述

MarkdownReader 是基於 Electron 的 Markdown 文件閱讀與輕量編輯工具，支援即時預覽、全文搜尋、檔案監聽、內嵌終端機。

## 技術棧

| 層級 | 技術 |
|------|------|
| 框架 | Electron 33 (`contextIsolation: false`, `nodeIntegration: true`) |
| Markdown | markdown-it 14 + highlight.js 11 |
| 圖表 | mermaid 11 (動態載入 via script tag) |
| 搜尋 | MiniSearch 7 (CJK tokenizer + fuzzy) |
| 終端機 | node-pty + xterm 5 + xterm-addon-fit |

## 架構

```
src/
├── main/                    # Electron 主進程
│   ├── main.js              # 視窗建立、IPC handler、protocol 註冊
│   ├── fileService.js       # 檔案掃描、讀寫、目錄監聽 (fs.watch)
│   ├── searchService.js     # 全文搜尋索引 (MiniSearch)
│   ├── menuService.js       # 原生選單建立與狀態管理
│   └── terminalService.js   # PTY 管理 (node-pty)
├── renderer/                # 渲染進程 (所有模組用 IIFE pattern)
│   ├── index.html           # 主 UI layout
│   ├── styles.css           # 全部樣式 (CSS Variables 主題)
│   ├── app.js               # 主邏輯 (async IIFE)，協調所有模組
│   ├── viewer.js            # Markdown/純文字渲染引擎
│   ├── sidebar.js           # 檔案樹 + 快速存取 + 收折面板
│   ├── search.js            # 搜尋 UI
│   ├── bookmarks.js         # 書籤管理
│   └── terminal.js          # 終端機 UI (xterm)
└── preload.js               # IPC 橋接 (window.api)
```

## 模組模式

- **Renderer 模組**：全部使用 IIFE pattern，回傳公開 API 物件
  - `Viewer`、`Sidebar`、`Search`、`Bookmarks`、`Terminal`
  - `app.js` 是 async IIFE，作為協調者呼叫各模組
- **Main 模組**：標準 CommonJS (`module.exports`)
- **IPC 橋接**：`preload.js` 將所有 IPC 包裝為 `window.api` 物件

## 資料流

```
Renderer (window.api.xxx) → IPC invoke/send → Main (ipcMain.handle/on) → Service module
Main → webContents.send → Renderer (ipcRenderer.on / window.api.onXxx)
```

## 持久化

所有用 localStorage，key prefix 為 `markdownreader-`：
- `markdownreader-recent-folders` — 最近開啟資料夾 (max 5)
- `markdownreader-zoom-level` — 字體縮放等級
- `markdownreader-pinned-folders` — 快速存取釘選
- `markdownreader-bookmarks` — 書籤清單
- `markdownreader-collapsed-panels` — 側邊欄面板收折狀態
- `markdownreader-terminal-settings` — 終端機設定 (shell/autoRun/fontSize)

## 開發指令

| 指令 | 說明 |
|------|------|
| `npm start` | 啟動開發模式 |
| `npm run build` | 打包 (electron-builder 預設) |
| `npm run build:portable` | 打包為 portable exe |
| `npm run build:nsis` | 打包為 NSIS 安裝程式 |
| `npm run rebuild` | 重新編譯原生模組 (node-pty) |

## 測試方式

無自動化測試框架。修改後以 `npm start` 啟動手動驗證：
1. 開啟資料夾，確認目錄樹正確
2. 點選檔案，確認 Markdown 渲染
3. 測試對應功能 (搜尋、書籤、編輯、終端機等)

## 重要：每次修改後必須重新打包

程式碼調整完成後，**一律執行打包**再回報完成：

```bash
cd /c/Github/Tools/MarkdownReader && npm run build:portable
```

未打包 = 未完成。

## 打包注意事項

- 修改後必須重新打包 (`npm run build`) 才能產生新的 exe
- mermaid 透過動態 script tag 載入，打包時需確認路徑
- node-pty 為原生模組，打包前需執行 `npm run rebuild`（需 Visual Studio Build Tools）
- xterm CSS 從 `node_modules/xterm/css/xterm.css` 載入

## 開發規範

- 不使用框架 (無 React/Vue)，純原生 DOM 操作
- 新增 renderer 模組時，使用 IIFE pattern 並在 `index.html` 中以 `<script>` 載入（app.js 之前）
- CSS Variables 定義在 `:root`，主題色用 `--accent`、`--bg-*`、`--text-*`
- 檔案篩選：僅支援 `.md` 和 `.txt`（`SUPPORTED_EXTENSIONS`）
- 目錄掃描忽略：`.` 開頭、`node_modules`、`dist`

## 快捷鍵

| 快捷鍵 | 功能 |
|--------|------|
| Ctrl+O | 開啟資料夾 |
| Ctrl+R | 重新載入目錄 |
| Ctrl+F | 搜尋 |
| Ctrl+B | 側邊欄顯示/隱藏 |
| Ctrl+S | 儲存 (編輯模式) |
| Ctrl+Shift+E | 切換編輯模式 |
| Ctrl+` | 切換終端機 |
| Ctrl+L | 複製檔案路徑 |
| Ctrl+E | 在檔案總管開啟 |
| Ctrl+=/-/0 | 放大/縮小/重設字體 |
