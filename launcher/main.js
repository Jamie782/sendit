// SEND IT Launcher: installs SEND IT, keeps it up to date and starts it.
const { app, BrowserWindow, ipcMain, shell, net, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');

const REPO = 'Jamie782/sendit';
const SITE = 'https://play-sendit.netlify.app/';
const PLATFORM = process.platform === 'darwin' ? (process.arch === 'arm64' ? 'mac-arm' : 'mac-intel') : 'win';
const ASSET = { win: 'SendIt-Windows.zip', 'mac-arm': 'SendIt-Mac-AppleSilicon.zip', 'mac-intel': 'SendIt-Mac-Intel.zip' }[PLATFORM];

let win = null, busy = null, gameProc = null;
const userDir = () => app.getPath('userData');
const settingsFile = () => path.join(userDir(), 'settings.json');
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJSON = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2)); };
let settings = null;
function loadSettings() {
  settings = Object.assign({ installDir: path.join(userDir(), 'Games', 'SEND IT'), onLaunch: 'minimise', autoUpdate: true }, readJSON(settingsFile(), {}));
}
const saveSettings = () => writeJSON(settingsFile(), settings);
const installedFile = () => path.join(settings.installDir, 'installed.json');
const installed = () => readJSON(installedFile(), null);
const exePath = () => PLATFORM === 'win' ? path.join(settings.installDir, 'game', 'Send It.exe') : path.join(settings.installDir, 'game', 'Send It.app');
const isInstalled = () => !!installed() && fs.existsSync(exePath());
const newer = (a, b) => { const x = String(a).replace(/^v/, '').split('.').map(Number), y = String(b).replace(/^v/, '').split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) > (y[i] || 0)) return true; if ((x[i] || 0) < (y[i] || 0)) return false; } return false; };
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };

// what's the newest release on GitHub?
let latest = null;
async function checkLatest() {
  try {
    const r = await net.fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'SendIt-Launcher' } });
    if (!r.ok) throw new Error('GitHub said ' + r.status);
    const j = await r.json();
    const a = (j.assets || []).find(x => x.name === ASSET);
    latest = { tag: j.tag_name, url: a ? a.browser_download_url : `https://github.com/${REPO}/releases/latest/download/${ASSET}`, size: a ? a.size : 0, notes: j.body || '' };
  } catch (e) {
    // fall back to the website's version number and the "latest" download link
    try { const m = await (await net.fetch(SITE + 'play/manifest.json?t=' + Date.now())).json(); latest = { tag: 'v' + m.version, url: `https://github.com/${REPO}/releases/latest/download/${ASSET}`, size: 0, notes: m.notes || '' }; }
    catch { latest = latest || null; }
  }
  return latest;
}
function state() {
  const ins = installed();
  return {
    platform: PLATFORM, launcher: app.getVersion(), installDir: settings.installDir, settings,
    installed: isInstalled() ? ins : null, latest,
    updateAvailable: !!(isInstalled() && latest && ins && newer(latest.tag, ins.tag)),
    busy, running: !!gameProc,
  };
}

// download with progress
async function download(url, out) {
  const r = await net.fetch(url, { headers: { 'User-Agent': 'SendIt-Launcher' } });
  if (!r.ok) throw new Error('Download failed (' + r.status + ')');
  const total = +r.headers.get('content-length') || (latest && latest.size) || 0;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const fh = fs.openSync(out, 'w');
  const reader = r.body.getReader();
  let got = 0, t0 = Date.now(), lastSent = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      fs.writeSync(fh, Buffer.from(value)); got += value.length;
      const now = Date.now();
      if (now - lastSent > 120) { lastSent = now; const secs = (now - t0) / 1000; send('progress', { stage: 'download', got, total, speed: got / Math.max(0.5, secs) }); }
    }
  } finally { fs.closeSync(fh); }
  send('progress', { stage: 'download', got, total: total || got, speed: 0 });
}
const run = (cmd, args) => new Promise((res, rej) => execFile(cmd, args, { maxBuffer: 1 << 26, windowsHide: true }, (e, so, se) => e ? rej(new Error((se || e.message).toString().slice(0, 300))) : res(so)));
async function extract(zip, dest) {
  fs.rmSync(dest, { recursive: true, force: true }); fs.mkdirSync(dest, { recursive: true });
  if (process.platform === 'win32') {
    try { await run('tar', ['-xf', zip, '-C', dest]); }
    catch { await run('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`]); }
  } else {
    await run('ditto', ['-x', '-k', zip, dest]);
    try { await run('xattr', ['-cr', path.join(dest, 'Send It.app')]); } catch { }
  }
}
async function install() {
  if (busy) return state();
  if (gameProc) throw new Error('Close SEND IT before updating it.');
  busy = isInstalled() ? 'update' : 'install'; send('state', state());
  const tmpZip = path.join(settings.installDir, 'download.zip'), tmpDir = path.join(settings.installDir, 'game.new'), gameDir = path.join(settings.installDir, 'game');
  try {
    if (!latest) await checkLatest();
    if (!latest) throw new Error("Can't reach the download server. Check your internet.");
    await download(latest.url, tmpZip);
    send('progress', { stage: 'extract' });
    await extract(tmpZip, tmpDir);
    const ok = PLATFORM === 'win' ? fs.existsSync(path.join(tmpDir, 'Send It.exe')) : fs.existsSync(path.join(tmpDir, 'Send It.app'));
    if (!ok) throw new Error('The download looks broken. Try again.');
    fs.rmSync(gameDir, { recursive: true, force: true }); fs.renameSync(tmpDir, gameDir);
    writeJSON(installedFile(), { tag: latest.tag, at: new Date().toISOString(), platform: PLATFORM });
    send('progress', { stage: 'done' });
  } finally {
    fs.rmSync(tmpZip, { force: true }); fs.rmSync(tmpDir, { recursive: true, force: true });
    busy = null; send('state', state());
  }
  return state();
}
function play() {
  if (gameProc) return state();
  if (!isInstalled()) throw new Error('Install SEND IT first.');
  const p = PLATFORM === 'win' ? spawn(exePath(), [], { detached: true, stdio: 'ignore', cwd: path.dirname(exePath()) }) : spawn('open', ['-W', '-n', exePath()], { stdio: 'ignore' });
  gameProc = p;
  p.on('exit', () => { gameProc = null; send('state', state()); if (settings.onLaunch === 'minimise' && win && !win.isDestroyed()) { win.restore(); } });
  p.on('error', e => { gameProc = null; send('toast', "Couldn't start SEND IT: " + e.message); send('state', state()); });
  if (settings.onLaunch === 'minimise' && win) win.minimize();
  if (settings.onLaunch === 'close') setTimeout(() => app.quit(), 1500);
  return state();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 780, minWidth: 960, minHeight: 600, backgroundColor: '#0a0b0f', show: false,
    frame: process.platform === 'darwin', titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    icon: path.join(__dirname, 'app', 'img', 'logo-icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'app', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) { e.preventDefault(); if (/^https:\/\//.test(url)) shell.openExternal(url); } });
}

ipcMain.handle('state', () => state());
ipcMain.handle('check', async () => { await checkLatest(); return state(); });
ipcMain.handle('install', async () => { try { return await install(); } catch (e) { send('toast', e.message); return state(); } });
ipcMain.handle('play', () => { try { return play(); } catch (e) { send('toast', e.message); return state(); } });
ipcMain.handle('set', (e, k, v) => { if (['onLaunch', 'autoUpdate'].includes(k)) { settings[k] = v; saveSaveable(); } return state(); });
function saveSaveable() { saveSettings(); }
ipcMain.handle('chooseDir', async () => {
  if (busy || gameProc) return state();
  const r = await dialog.showOpenDialog(win, { title: 'Where should SEND IT be installed?', properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled || !r.filePaths[0]) return state();
  const old = settings.installDir, next = path.join(r.filePaths[0], 'SEND IT');
  if (next === old) return state();
  if (fs.existsSync(path.join(old, 'game'))) { fs.mkdirSync(next, { recursive: true }); try { fs.renameSync(path.join(old, 'game'), path.join(next, 'game')); fs.renameSync(path.join(old, 'installed.json'), path.join(next, 'installed.json')); } catch { send('toast', "Couldn't move the game there, so it will download again."); } }
  settings.installDir = next; saveSettings(); return state();
});
ipcMain.handle('openDir', () => { fs.mkdirSync(settings.installDir, { recursive: true }); shell.openPath(settings.installDir); });
ipcMain.handle('uninstall', () => { if (busy || gameProc) return state(); fs.rmSync(path.join(settings.installDir, 'game'), { recursive: true, force: true }); fs.rmSync(installedFile(), { force: true }); return state(); });
ipcMain.handle('open', (e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
ipcMain.handle('win', (e, a) => { if (!win) return; if (a === 'min') win.minimize(); else if (a === 'max') win.isMaximized() ? win.unmaximize() : win.maximize(); else if (a === 'close') win.close(); });

app.whenReady().then(async () => {
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
  loadSettings();
  createWindow();
  await checkLatest();
  send('state', state());
  // install or update by itself if that's switched on
  if (settings.autoUpdate && isInstalled() && state().updateAvailable) install().catch(e => send('toast', e.message));
  setInterval(async () => { await checkLatest(); send('state', state()); if (settings.autoUpdate && state().updateAvailable && !gameProc) install().catch(() => { }); }, 30 * 60 * 1000);
});
app.on('window-all-closed', () => app.quit());
