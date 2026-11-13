// SEND IT Discord server setup — run once:  node setup-server.mjs
// Builds the roles, channels and permissions for the SEND IT community server, posts the welcome and rules
// messages, sets the server icon and the bot's name and picture, and makes a permanent invite link. The game's clips
// are posted by the SEND IT bot itself (no webhooks). Safe to run again: anything that already exists is left alone.
//
// You need: Node 18 or newer, and the SEND IT bot added to your server with the "Administrator" permission.
// The bot token is asked for when the script runs. It is not saved anywhere.
import { createInterface } from 'node:readline/promises';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const API = 'https://discord.com/api/v10';
const SITE = 'https://play-sendit.netlify.app';
const ORANGE = 0xff5a26;

const rl = createInterface({ input: process.stdin, output: process.stdout });
const TOKEN = (process.env.BOT_TOKEN || (await rl.question('Paste the SEND IT bot token and press Enter: '))).trim();
if (!TOKEN) { console.log('No token, stopping.'); process.exit(1); }

async function api(method, path, body, reason = 'SEND IT setup') {
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch(API + path, { method, headers: { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json', 'X-Audit-Log-Reason': reason }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 429) { const j = await r.json(); await new Promise(res => setTimeout(res, (j.retry_after || 1) * 1000 + 250)); continue; }
    if (r.status === 204) return null;
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${method} ${path} failed (${r.status}): ${JSON.stringify(j)}`);
    return j;
  }
  throw new Error('Discord kept rate-limiting, try again in a minute.');
}

// ── which server? ──
const me = await api('GET', '/users/@me').catch(e => { console.log('\nThat token did not work. Copy it again from the Bot page (Reset Token) and retry.'); process.exit(1); });
const guilds = await api('GET', '/users/@me/guilds');
if (!guilds.length) { console.log(`\n${me.username} isn't in any server yet. Add it with the invite link from the guide, then run this again.`); process.exit(1); }
let guild = guilds[0];
if (guilds.length > 1) {
  guilds.forEach((g, i) => console.log(`  ${i + 1}. ${g.name}`));
  const n = Number(await rl.question('Which server should I set up? Type the number: '));
  guild = guilds[n - 1]; if (!guild) process.exit(1);
}
rl.close();
const G = guild.id;
console.log(`\nSetting up "${guild.name}" as ${me.username}…\n`);

// ── permissions (Discord bit flags) ──
const P = { VIEW: 1n << 10n, SEND: 1n << 11n, SEND_THREADS: 1n << 38n, THREADS: 1n << 35n, REACT: 1n << 6n, ATTACH: 1n << 15n, EMBED: 1n << 14n, HISTORY: 1n << 16n, CONNECT: 1n << 20n, SPEAK: 1n << 21n, MANAGE_MSG: 1n << 13n, KICK: 1n << 1n, BAN: 1n << 2n, TIMEOUT: 1n << 40n, MANAGE_THREADS: 1n << 34n, MOVE: 1n << 24n, MUTE: 1n << 22n, ADMIN: 1n << 3n, MENTION_ALL: 1n << 17n };
const bits = (...k) => k.reduce((a, x) => a | P[x], 0n).toString();

// ── roles ──
const roles = await api('GET', `/guilds/${G}/roles`);
const everyone = roles.find(r => r.id === G);
async function role(name, color, opts = {}) {
  const have = roles.find(r => r.name === name);
  if (have) { console.log(`  role ${name} — already there`); return have; }
  const r = await api('POST', `/guilds/${G}/roles`, { name, color, hoist: !!opts.hoist, mentionable: !!opts.mentionable, permissions: opts.perms || '0' });
  roles.push(r); console.log(`  role ${name} — made`); return r;
}
console.log('Roles');
const R = {
  dev: await role('Dev', ORANGE, { hoist: true, perms: bits('ADMIN') }),
  mod: await role('Mod', 0x5865f2, { hoist: true, perms: bits('MANAGE_MSG', 'KICK', 'BAN', 'TIMEOUT', 'MANAGE_THREADS', 'MOVE', 'MUTE') }),
  cotw: await role('Clip of the Week', 0xf5c542, { hoist: true }),
  pro: await role('Pro Rider', 0x2ecc71, { hoist: true }),
  tester: await role('Tester', 0x9b59b6),
  ping: await role('Update Pings', 0x95a5a6, { mentionable: true }),
};

// ── channels ──
let chans = await api('GET', `/guilds/${G}/channels`);
const T = { TEXT: 0, VOICE: 2, CAT: 4, NEWS: 5, FORUM: 15 };
const readOnly = [{ id: G, type: 0, allow: bits('VIEW', 'HISTORY', 'REACT'), deny: bits('SEND', 'SEND_THREADS', 'THREADS') }];
const staffOnly = [{ id: G, type: 0, allow: '0', deny: bits('VIEW') }, { id: R.mod.id, type: 0, allow: bits('VIEW', 'SEND', 'HISTORY'), deny: '0' }, { id: R.dev.id, type: 0, allow: bits('VIEW', 'SEND', 'HISTORY'), deny: '0' }];
async function chan(name, type, parent, opts = {}) {
  const have = chans.find(c => c.name === name && c.type === type);
  if (have) { console.log(`  ${type === T.CAT ? 'category' : '#'}${name} — already there`); return have; }
  const body = { name, type, parent_id: parent ? parent.id : undefined, topic: opts.topic, rate_limit_per_user: opts.slow, permission_overwrites: opts.perms, available_tags: opts.tags };
  let c;
  try { c = await api('POST', `/guilds/${G}/channels`, body); }
  catch (e) { if (type === T.NEWS || type === T.FORUM) { c = await api('POST', `/guilds/${G}/channels`, { ...body, type: T.TEXT, available_tags: undefined }); } else throw e; }
  chans.push(c); console.log(`  ${type === T.CAT ? 'category' : '#'}${name} — made`); return c;
}
console.log('\nChannels');
const catInfo = await chan('📌 START HERE', T.CAT, null);
const welcome = await chan('welcome', T.TEXT, catInfo, { topic: 'Start here', perms: readOnly });
const rules = await chan('rules', T.TEXT, catInfo, { topic: 'Be decent', perms: readOnly });
const ann = await chan('announcements', T.NEWS, catInfo, { topic: 'News from the SEND IT team', perms: readOnly });
const upd = await chan('update-log', T.TEXT, catInfo, { topic: 'Every SEND IT update, posted automatically', perms: readOnly });

const catRide = await chan('🛹 RIDE', T.CAT, null);
await chan('general', T.TEXT, catRide, { topic: 'Talk about anything SEND IT' });
const clips = await chan('clips', T.TEXT, catRide, { topic: 'Clips and photos straight from the game. In a replay press X to share yours.', slow: 30 });
await chan('screenshots', T.TEXT, catRide, { topic: 'Photo mode shots (P in game)', slow: 15 });
await chan('looking-to-ride', T.TEXT, catRide, { topic: 'Post your server code and find people to ride with', slow: 20 });
await chan('tricks-help', T.TEXT, catRide, { topic: 'How do I… ? Ask here' });

const catComp = await chan('🏆 COMPETE', T.CAT, null);
await chan('clip-of-the-week', T.TEXT, catComp, { topic: 'The best clip each week wins the Clip of the Week role', perms: readOnly });
await chan('leaderboards', T.TEXT, catComp, { topic: 'Top riders', perms: readOnly });

const catFb = await chan('💬 FEEDBACK', T.CAT, null);
const tag = (name, emoji) => ({ name, emoji_name: emoji });
await chan('suggestions', T.FORUM, catFb, { topic: 'One idea per post. Upvote the ones you like.', tags: [tag('Ride', '🚲'), tag('Place', '🗺️'), tag('Trick', '🌀'), tag('Other', '💡'), tag('Planned', '✅')] });
await chan('bug-reports', T.FORUM, catFb, { topic: 'What happened, what you expected, and a screenshot if you can.', tags: [tag('Bug', '🐛'), tag('Crash', '💥'), tag('Lag', '🐢'), tag('Fixed', '✅')] });

const catVoice = await chan('🔊 VOICE', T.CAT, null);
await chan('Riding 1', T.VOICE, catVoice);
await chan('Riding 2', T.VOICE, catVoice);
await chan('Chill', T.VOICE, catVoice);

const catStaff = await chan('🛠 STAFF', T.CAT, null, { perms: staffOnly });
await chan('mod-chat', T.TEXT, catStaff, { perms: staffOnly });
await chan('mod-log', T.TEXT, catStaff, { perms: staffOnly });

// ── welcome and rules messages (only if the channel is empty) ──
async function postOnce(ch, payload) {
  const last = await api('GET', `/channels/${ch.id}/messages?limit=1`);
  if (last.length) return console.log(`  #${ch.name} already has messages — skipped`);
  await api('POST', `/channels/${ch.id}/messages`, payload); console.log(`  #${ch.name} — posted`);
}
console.log('\nMessages');
await postOnce(welcome, { embeds: [{
  title: 'Welcome to SEND IT', color: ORANGE,
  description: 'The free stunt-riding game on bikes, scooters, skateboards, skis and surfboards.\n\n' +
    `**Get the game:** ${SITE}\n` +
    `**Read the rules:** <#${rules.id}>\n` +
    `**Share your clips:** in the game open a replay with **V** and press **X**. It lands in <#${clips.id}>.\n` +
    '**Ride together:** host a server in the game and post the code in looking-to-ride.\n\nSee you on the ramps.',
  thumbnail: { url: `${SITE}/media/icon.png` },
}] });
await postOnce(rules, { embeds: [{
  title: 'Rules', color: ORANGE,
  description: [
    '**1. Be decent.** No hate, harassment, threats or slurs.',
    '**2. Keep it clean.** No NSFW, gore or shock content.',
    '**3. No spam or ads.** No self-promo, scams, or invite links to other servers.',
    '**4. Right channel.** Clips in clips, bugs in bug-reports, ideas in suggestions.',
    '**5. No cheating.** Don\'t share exploits or cheats. Found one? Report it in bug-reports.',
    '**6. English in the main channels**, so mods can keep things safe.',
    '**7. Listen to the Mods.** They have the final say.',
    '\nBreaking the rules gets a warning, then a timeout, then a ban. Discord\'s own rules also apply: https://discord.com/guidelines',
  ].join('\n'),
}] });

// ── server icon ──
const icon = join(HERE, 'icon.png');
if (existsSync(icon)) {
  try { await api('PATCH', `/guilds/${G}`, { icon: 'data:image/png;base64,' + readFileSync(icon).toString('base64'), system_channel_id: welcome.id }); console.log('\nServer icon — set'); }
  catch (e) { console.log('\nServer icon — skipped (' + e.message.slice(0, 80) + ')'); }
}

// ── the bot's own name and picture (it posts clips as itself, so there are no webhook links to leak) ──
if (existsSync(icon)) {
  const want = { avatar: 'data:image/png;base64,' + readFileSync(icon).toString('base64') };
  if (me.username !== 'SEND IT') want.username = 'SEND IT';
  try { await api('PATCH', '/users/@me', want); console.log('Bot name and picture — set'); }
  catch (e) { console.log('Bot name and picture — skipped (' + e.message.slice(0, 80) + ')'); }
}

// ── remove the old webhooks if an earlier version of this script made them ──
for (const ch of [clips, upd]) {
  for (const w of await api('GET', `/channels/${ch.id}/webhooks`)) {
    if (w.name === 'SEND IT Clips' || w.name === 'SEND IT Updates') { await api('DELETE', `/webhooks/${w.id}`); console.log(`  old webhook in #${ch.name} — removed`); }
  }
}

// ── invite ──
const inv = await api('POST', `/channels/${welcome.id}/invites`, { max_age: 0, max_uses: 0, unique: false });

console.log('\n────────────────────────────────────────────');
console.log('Done! Three things to copy:\n');
console.log('1) Server ID — put this in Supabase as the secret DISCORD_GUILD_ID:');
console.log(`   ${G}\n`);
console.log('2) Your bot token (the one you just pasted) — put it in Supabase as the secret DISCORD_BOT_TOKEN.');
console.log('   With these two, the bot posts clips in #clips and adds players who tick "Also join the SEND IT Discord server".\n');
console.log('3) Invite link — send this one to Claude for the game and website:');
console.log(`   https://discord.gg/${inv.code}\n`);
console.log('Keep the bot token private. If it ever leaks, press Reset Token on the Bot page and update the Supabase secret.');
console.log('────────────────────────────────────────────');
