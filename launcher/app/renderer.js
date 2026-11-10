const L = window.launcher, SITE = 'https://play-sendit.netlify.app/';
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mb = n => (n / 1048576).toFixed(n > 1e8 ? 0 : 1) + ' MB';
let S = null, prog = null, news = null;

if (navigator.userAgent.includes('Mac')) document.body.classList.add('mac');
document.querySelectorAll('[data-w]').forEach(b => b.onclick = () => L.win(b.dataset.w));
document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => L.open(b.dataset.open));
// pages
function page(p) {
  document.querySelectorAll('[data-page]').forEach(x => x.classList.toggle('hidden', x.dataset.page !== p));
  document.querySelectorAll('#side nav button').forEach(b => b.classList.toggle('sel', b.dataset.p === p));
}
document.querySelectorAll('[data-p]').forEach(b => b.onclick = () => page(b.dataset.p));

function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.add('hidden'), 6000); }

function render() {
  if (!S) return;
  const go = $('#go'), st = $('#status'), sub = $('#sub'), bar = $('#bar');
  const tag = S.installed ? S.installed.tag.replace(/^v/, '') : null, lt = S.latest ? S.latest.tag.replace(/^v/, '') : null;
  go.className = 'go'; go.disabled = false;
  if (S.busy) {
    go.disabled = true; bar.classList.remove('hidden');
    if (!prog || prog.stage === 'download') {
      const pc = prog && prog.total ? prog.got / prog.total * 100 : 0;
      go.textContent = (S.busy === 'update' ? 'UPDATING ' : 'INSTALLING ') + Math.floor(pc) + '%';
      bar.firstElementChild.style.width = pc + '%';
      st.textContent = S.busy === 'update' ? `Updating to ${lt}` : `Installing SEND IT ${lt || ''}`;
      sub.textContent = prog && prog.total ? `${mb(prog.got)} of ${mb(prog.total)}${prog.speed ? ` · ${mb(prog.speed)}/s · ${Math.max(1, Math.round((prog.total - prog.got) / prog.speed))}s left` : ''}` : 'Starting the download…';
    } else { go.textContent = 'UNPACKING…'; bar.firstElementChild.style.width = '100%'; sub.textContent = 'Nearly there'; }
  } else if (S.running) {
    go.textContent = 'PLAYING'; go.disabled = true; go.classList.add('playing'); bar.classList.add('hidden');
    st.textContent = 'SEND IT is running'; sub.textContent = 'Close the game to come back here.';
  } else if (!S.installed) {
    go.textContent = 'INSTALL'; go.classList.add('install'); bar.classList.add('hidden');
    st.textContent = lt ? `Version ${lt} · free` : "Can't reach the download server"; sub.textContent = 'About 150 MB. Your saves sync when you sign in.';
  } else if (S.updateAvailable) {
    go.textContent = 'UPDATE'; go.classList.add('install'); bar.classList.add('hidden');
    st.textContent = `Update ready: ${tag} → ${lt}`; sub.textContent = 'Takes about a minute.';
  } else {
    go.textContent = 'PLAY'; bar.classList.add('hidden');
    st.textContent = `Version ${tag} installed`; sub.textContent = lt ? 'Up to date' : "Couldn't check for updates (offline?)";
  }
  $('#sg-status').textContent = S.running ? 'Playing' : S.busy ? (S.busy === 'update' ? 'Updating…' : 'Installing…') : !S.installed ? 'Not installed' : S.updateAvailable ? 'Update ready' : 'Ready to play';
  $('#lver').textContent = 'Launcher ' + S.launcher;
  $('#dir').textContent = S.installDir;
  $('#check-info').textContent = S.installed ? `Installed: ${tag}${lt ? ` · Newest: ${lt}` : ''}` : (lt ? `Newest: ${lt}` : '');
  document.querySelectorAll('#on-launch button').forEach(b => b.classList.toggle('sel', b.dataset.v === S.settings.onLaunch));
  document.querySelectorAll('#auto button').forEach(b => b.classList.toggle('sel', (b.dataset.v === '1') === !!S.settings.autoUpdate));
  for (const id of ['#repair', '#uninstall', '#change-dir']) $(id).disabled = !!S.busy || S.running || (id !== '#change-dir' && !S.installed);
  if (news && news.launcher && S.launcher && newer(news.launcher, S.launcher)) $('#lver').innerHTML = `Launcher ${esc(S.launcher)} · <a href="#" id="lup">new version</a>`, $('#lup').onclick = e => { e.preventDefault(); L.open(SITE + '#download'); };
}
const newer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) > (y[i] || 0)) return true; if ((x[i] || 0) < (y[i] || 0)) return false; } return false; };

$('#go').onclick = async () => {
  if (!S || S.busy || S.running) return;
  prog = null;
  if (!S.installed || S.updateAvailable) { S = await L.install(); render(); return; }
  S = await L.play(); render();
};
L.on('state', s => { S = s; if (!s.busy) prog = null; render(); });
L.on('progress', p => { prog = p; if (p.stage === 'done') toast('SEND IT is ready. Press PLAY.'); render(); });
L.on('toast', toast);

// settings
$('#on-launch').onclick = async e => { const b = e.target.closest('button'); if (b) { S = await L.set('onLaunch', b.dataset.v); render(); } };
$('#auto').onclick = async e => { const b = e.target.closest('button'); if (b) { S = await L.set('autoUpdate', b.dataset.v === '1'); render(); } };
$('#open-dir').onclick = () => L.openDir();
$('#change-dir').onclick = async () => { S = await L.chooseDir(); render(); };
$('#check').onclick = async () => { $('#check').textContent = 'CHECKING…'; S = await L.check(); $('#check').textContent = 'CHECK NOW'; render(); toast(S.updateAvailable ? 'An update is ready.' : S.latest ? "You're up to date." : "Couldn't reach the update server."); };
$('#repair').onclick = async () => { prog = null; page('home'); S = await L.install(); render(); };
let unPending = false;
$('#uninstall').onclick = async () => {
  if (!unPending) { unPending = true; $('#uninstall').textContent = 'PRESS AGAIN TO CONFIRM'; setTimeout(() => { unPending = false; $('#uninstall').textContent = 'UNINSTALL'; }, 4000); return; }
  unPending = false; $('#uninstall').textContent = 'UNINSTALL'; S = await L.uninstall(); render(); toast('SEND IT was uninstalled. Your saves are still there.');
};

// news and places (from the website, with a copy built in for when you're offline)
function img(src) { return /^https?:/.test(src) ? src : SITE + src; }
function renderNews() {
  if (!news) return;
  const n0 = news.news[0];
  $('#latest').innerHTML = n0 ? `<div class="lt-img" style="background-image:url('${img(n0.image)}')"></div><div class="lt-txt"><div class="ch">LATEST UPDATE · ${esc(n0.v)}</div><h2>${esc(n0.title)}</h2><ul>${n0.items.slice(0, 4).map(x => `<li>${esc(x)}</li>`).join('')}</ul><button class="link" id="more">Read the full update log ›</button></div>` : '';
  const m = $('#more'); if (m) m.onclick = () => page('news');
  $('#news').innerHTML = news.news.map((n, i) => `<article class="nw${i === 0 ? ' first' : ''}"><div class="nw-img" style="background-image:url('${img(n.image)}')"></div><div class="nw-txt"><div class="nw-h"><b>VERSION ${esc(n.v)}</b><span>${esc(n.date)}</span></div><h2>${esc(n.title)}</h2><ul>${n.items.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div></article>`).join('');
  $('#places').innerHTML = (news.places || []).map(p => `<div class="pl"><div class="pl-img" style="background-image:url('${img(p.img)}')"></div><b>${esc(p.n)}</b>${p.lv > 1 ? `<small>UNLOCKS AT LEVEL ${p.lv}</small>` : '<small>OPEN FROM THE START</small>'}</div>`).join('');
}
(async () => {
  news = window.NEWS_FALLBACK || null; renderNews();
  try { const r = await fetch(SITE + 'news.json?t=' + Date.now()); if (r.ok) { news = await r.json(); renderNews(); render(); } } catch { }
  S = await L.state(); render();
})();
