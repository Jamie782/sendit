// Electron shell for SEND IT — serves the game from a local app:// protocol
const { app, BrowserWindow, protocol, net, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

// ── automatic updates ──────────────────────────────────────────────
// The game files (HTML, CSS, JS) are also published on the website. On start-up and every 30 minutes we
// check play/manifest.json there; if it lists a newer version we download just those files (a few MB) into
// the user's app-data folder and run them from then on. The app:// address stays the same, so saves are kept.
const UPDATE_BASE = process.env.SENDIT_UPDATE_BASE || 'https://play-sendit.netlify.app/play/';
const SHELL_VERSION = app.getVersion();
const readJSON = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const newer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) > (y[i] || 0)) return true; if ((x[i] || 0) < (y[i] || 0)) return false; } return false; };
let gameRoot = __dirname, gameVersion = (readJSON(path.join(__dirname, 'version.json')) || { version: SHELL_VERSION }).version;
let updatesDir = null, updating = false, notified = null;
function pickGameRoot() {
  updatesDir = path.join(app.getPath('userData'), 'game-updates');
  const cur = readJSON(path.join(updatesDir, 'current.json'));
  if (cur && newer(cur.version, gameVersion) && !(cur.minShell && newer(cur.minShell, SHELL_VERSION)) && fs.existsSync(path.join(updatesDir, cur.dir, 'index.html'))) {
    gameRoot = path.join(updatesDir, cur.dir); gameVersion = cur.version;
  }
}
function tellGame(info) {
  notified = info;
  if (win && !win.webContents.isLoading()) win.webContents.executeJavaScript(`window.__sendItUpdate && window.__sendItUpdate(${JSON.stringify(info)})`).catch(() => { });
}
async function checkForUpdate() {
  if (updating || !updatesDir) return; updating = true;
  try {
    const r = await net.fetch(UPDATE_BASE + 'manifest.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    const m = await r.json();
    if (!m || !m.version || !Array.isArray(m.files) || !newer(m.version, gameVersion)) return;
    if (m.minShell && newer(m.minShell, SHELL_VERSION)) { tellGame({ kind: 'download', version: m.version }); return; }
    const dir = 'v' + m.version.replace(/[^0-9.]/g, ''), tmp = path.join(updatesDir, dir + '.part');
    fs.rmSync(tmp, { recursive: true, force: true }); fs.mkdirSync(tmp, { recursive: true });
    for (const f of m.files) {
      const rel = String(f.path || '');
      if (!rel || rel.includes('..') || path.isAbsolute(rel) || !/^[A-Za-z0-9_./-]+$/.test(rel)) throw new Error('bad path ' + rel);
      const res = await net.fetch(UPDATE_BASE + rel, { cache: 'no-store' });
      if (!res.ok) throw new Error('download failed ' + rel);
      const buf = Buffer.from(await res.arrayBuffer());
      if (crypto.createHash('sha256').update(buf).digest('hex') !== f.sha256) throw new Error('checksum failed ' + rel);
      const out = path.join(tmp, rel); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, buf);
    }
    const final = path.join(updatesDir, dir);
    fs.rmSync(final, { recursive: true, force: true }); fs.renameSync(tmp, final);
    fs.writeFileSync(path.join(updatesDir, 'current.json'), JSON.stringify({ version: m.version, dir, minShell: m.minShell || null }));
    // tidy up older downloads
    for (const d of fs.readdirSync(updatesDir)) if (d !== dir && d !== 'current.json') fs.rmSync(path.join(updatesDir, d), { recursive: true, force: true });
    gameRoot = final; gameVersion = m.version;
    tellGame({ kind: 'ready', version: m.version, notes: m.notes || '' });
  } catch (e) { console.warn('update check failed:', e.message); }
  finally { updating = false; }
}

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
  win.webContents.on('did-finish-load', () => {
    win.webContents.executeJavaScript(`window.__sendItVersion && window.__sendItVersion(${JSON.stringify({ game: gameVersion, shell: SHELL_VERSION })})`).catch(() => { });
    if (notified && notified.kind === 'download') tellGame(notified);
    if (pendingJoin) { const c = pendingJoin; pendingJoin = null; setTimeout(() => deliverJoin(c), 1500); }
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && (input.key === 'F11' || (input.key === 'f' && input.meta && input.control))) {
      win.setFullScreen(!win.isFullScreen()); e.preventDefault();
    }
  });
}

app.whenReady().then(() => {
  pickGameRoot();
  protocol.handle('app', req => {
    const { pathname } = new URL(req.url);
    const root = gameRoot;
    let file = path.normalize(path.join(root, decodeURIComponent(pathname)));
    if (!file.startsWith(root)) return new Response('Not found', { status: 404 });
    // anything an update didn't include still comes from the copy inside the app
    if (root !== __dirname && !fs.existsSync(file)) file = path.normalize(path.join(__dirname, decodeURIComponent(pathname)));
    return net.fetch(pathToFileURL(file).toString());
  });
  setTimeout(checkForUpdate, 4000);
  setInterval(checkForUpdate, 30 * 60 * 1000);
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => app.quit());
