// Electron shell for SEND IT — serves the game from a local app:// protocol
const { app, BrowserWindow, protocol, net, Menu, shell } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

// keep the GPU working on older machines
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');

// invite links: sendit://join/ABCDE opens the game and joins that server
if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient('sendit', process.execPath, [path.resolve(process.argv[1])]);
else app.setAsDefaultProtocolClient('sendit');
let win = null, pendingJoin = null;
const codeFrom = s => { const m = String(s || '').match(/sendit:\/\/join\/([A-Za-z0-9]{4,8})/i); return m ? m[1].toUpperCase() : null; };
function deliverJoin(code) {
  if (!code) return;
  if (win && !win.webContents.isLoading()) win.webContents.executeJavaScript(`window.__joinCode && window.__joinCode(${JSON.stringify(code)})`).catch(() => { });
  else pendingJoin = code;
}
pendingJoin = codeFrom(process.argv.find(a => a.startsWith('sendit://')));
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_e, argv) => {
  deliverJoin(codeFrom(argv.find(a => a.startsWith('sendit://'))));
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
});
app.on('open-url', (e, url) => { e.preventDefault(); deliverJoin(codeFrom(url)); });

function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 900, minWidth: 960, minHeight: 540,
    backgroundColor: '#0b0c10', title: 'Send It', show: false,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL('app://game/index.html');
  // links (Discord sign-in, the website) open in the normal browser
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) { e.preventDefault(); if (/^https:\/\//.test(url)) shell.openExternal(url); } });
  win.webContents.on('did-finish-load', () => { if (pendingJoin) { const c = pendingJoin; pendingJoin = null; setTimeout(() => deliverJoin(c), 1500); } });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && (input.key === 'F11' || (input.key === 'f' && input.meta && input.control))) {
      win.setFullScreen(!win.isFullScreen()); e.preventDefault();
    }
  });
}

app.whenReady().then(() => {
  protocol.handle('app', req => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(__dirname, decodeURIComponent(pathname)));
    if (!file.startsWith(__dirname)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
