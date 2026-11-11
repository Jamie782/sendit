// Discord Rich Presence over Discord's local IPC socket (no extra libraries).
// Shows "Playing SEND IT" on the player's profile with what they're doing. If Discord isn't running,
// it quietly retries every 20 seconds.
const net = require('net');
const path = require('path');
const crypto = require('crypto');

function pipePaths() {
  const out = [];
  for (let i = 0; i < 10; i++) {
    if (process.platform === 'win32') { out.push(`\\\\?\\pipe\\discord-ipc-${i}`); continue; }
    const base = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
    for (const sub of ['', 'app/com.discordapp.Discord', 'snap.discord', '.flatpak/com.discordapp.Discord/xdg-run']) out.push(path.join(base, sub, `discord-ipc-${i}`));
  }
  return out;
}

class DiscordPresence {
  constructor(log = () => { }) { this.log = log; this.clientId = null; this.sock = null; this.ready = false; this.want = null; this.sent = null; this.lastSend = 0; this.buf = Buffer.alloc(0); this.timer = null; }
  start(clientId) {
    if (!clientId || !/^\d{15,22}$/.test(String(clientId))) return;
    if (this.clientId === clientId) return;
    this.clientId = String(clientId); this.close(); this.connect();
    clearInterval(this.timer); this.timer = setInterval(() => { if (!this.sock) this.connect(); else this.flush(); }, 20000);
  }
  async connect() {
    if (this.connecting || !this.clientId) return; this.connecting = true;
    for (const p of pipePaths()) {
      const s = await new Promise(res => { const c = net.createConnection(p); c.once('connect', () => res(c)); c.once('error', () => res(null)); });
      if (!s) continue;
      this.sock = s; this.ready = false; this.buf = Buffer.alloc(0);
      s.on('data', d => this.onData(d));
      s.on('close', () => { if (this.sock === s) { this.sock = null; this.ready = false; this.sent = null; } });
      s.on('error', () => { });
      this.write(0, { v: 1, client_id: this.clientId });
      break;
    }
    this.connecting = false;
  }
  write(op, obj) {
    if (!this.sock) return;
    const body = Buffer.from(JSON.stringify(obj)), head = Buffer.alloc(8);
    head.writeInt32LE(op, 0); head.writeInt32LE(body.length, 4);
    try { this.sock.write(Buffer.concat([head, body])); } catch { }
  }
  onData(d) {
    this.buf = Buffer.concat([this.buf, d]);
    while (this.buf.length >= 8) {
      const op = this.buf.readInt32LE(0), len = this.buf.readInt32LE(4);
      if (this.buf.length < 8 + len) break;
      let msg = null; try { msg = JSON.parse(this.buf.slice(8, 8 + len).toString()); } catch { }
      this.buf = this.buf.slice(8 + len);
      if (op === 1 && msg && msg.evt === 'READY') { this.ready = true; this.sent = null; this.log('discord: connected as ' + (msg.data && msg.data.user ? msg.data.user.username : '?')); this.flush(); }
      else if (op === 1 && msg && msg.evt === 'ERROR') this.log('discord: ' + JSON.stringify(msg.data));
      else if (op === 2) { this.log('discord: closed ' + JSON.stringify(msg)); this.close(); }
      else if (op === 3) this.write(4, msg);
    }
  }
  // p comes from the game (window.__presence)
  set(p) { this.want = p; this.flush(); }
  flush() {
    if (!this.ready) return;
    const p = this.want;
    const activity = !p || p.off ? null : {
      type: 0,
      details: p.details || undefined, state: p.state || undefined,
      timestamps: p.start ? { start: p.start } : undefined,
      assets: { large_image: p.large || undefined, large_text: p.largeText || undefined, small_image: p.small || undefined, small_text: p.smallText || undefined },
      party: p.party ? { id: String(p.party.id).slice(0, 120), size: p.party.size } : undefined,
      buttons: Array.isArray(p.buttons) && p.buttons.length ? p.buttons.slice(0, 2).map(b => ({ label: String(b.label).slice(0, 32), url: String(b.url) })) : undefined,
      instance: false,
    };
    const key = JSON.stringify(activity);
    // Discord allows about 5 updates every 20 seconds
    if (key === this.sent || Date.now() - this.lastSend < 4500) return;
    this.sent = key; this.lastSend = Date.now();
    this.write(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity }, nonce: crypto.randomUUID() });
  }
  close() { if (this.sock) { try { this.sock.destroy(); } catch { } } this.sock = null; this.ready = false; this.sent = null; }
}
module.exports = { DiscordPresence };
