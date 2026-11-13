// @ts-nocheck
// SEND IT: the bot builds the SEND IT Discord server. Open the setup page on the website,
//   https://play-sendit.netlify.app/discord-setup.html?key=<setup key>
// press BUILD MY SERVER, and the SEND IT bot (DISCORD_BOT_TOKEN secret) sets up the server it was added to: roles, channels, permissions,
// the welcome / rules / clips messages, the server icon, its own name and picture, and a permanent invite link.
// Nothing to install or host. Safe to open again: it renames and updates instead of making duplicates.
// Bots aren't allowed to create a server themselves (Discord removed that), so you make an empty one and add the bot.
import { createClient } from "jsr:@supabase/supabase-js@2";

const BOT = (Deno.env.get("DISCORD_BOT_TOKEN") ?? "").trim();
const GUILD_SET = (Deno.env.get("DISCORD_GUILD_ID") ?? "").trim();
const CID = Deno.env.get("DISCORD_CLIENT_ID") || "1570333669124472903";
const KEY_HASH = "3eff26dcf2677862cae623da141107c741852f1e333d3c79b0f0f292d4a35f72"; // sha256 of the setup key
const API = "https://discord.com/api/v10";
const SITE = "https://play-sendit.netlify.app";
const ORANGE = 0xff5a26;
const ZW = String.fromCharCode(0x200b); // an invisible spacer line under the embed text
const ADD_BOT = `https://discord.com/oauth2/authorize?client_id=${CID}&scope=bot&permissions=8`;
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

async function api(method, path, body, reason = "SEND IT setup") {
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch(API + path, { method, headers: { Authorization: `Bot ${BOT}`, "Content-Type": "application/json", "X-Audit-Log-Reason": reason }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 429) { const j = await r.json().catch(() => ({})); await new Promise((res) => setTimeout(res, (j.retry_after || 1) * 1000 + 250)); continue; }
    if (r.status === 204) return null;
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${method} ${path} failed (${r.status}): ${JSON.stringify(j)}`);
    return j;
  }
  throw new Error("Discord kept rate-limiting, open the link again in a minute.");
}
async function sha256(s) { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, "0")).join(""); }
async function iconData() {
  const r = await fetch(`${SITE}/media/discord-icon.png`).catch(() => null);
  if (!r?.ok) return null;
  const b = new Uint8Array(await r.arrayBuffer()); let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return "data:image/png;base64," + btoa(s);
}

async function build(G, me, log) {
// ── permissions (Discord bit flags) ──
const P = { VIEW: 1n << 10n, SEND: 1n << 11n, SEND_THREADS: 1n << 38n, THREADS: 1n << 35n, REACT: 1n << 6n, ATTACH: 1n << 15n, EMBED: 1n << 14n, HISTORY: 1n << 16n, CONNECT: 1n << 20n, SPEAK: 1n << 21n, MANAGE_MSG: 1n << 13n, KICK: 1n << 1n, BAN: 1n << 2n, TIMEOUT: 1n << 40n, MANAGE_THREADS: 1n << 34n, MOVE: 1n << 24n, MUTE: 1n << 22n, ADMIN: 1n << 3n, MENTION_ALL: 1n << 17n };
const bits = (...k) => k.reduce((a, x) => a | P[x], 0n).toString();

// Names are matched without their emoji and symbols, so running this again on a server made by an older version
// renames "Dev" to "👑 Dev", "clips" to "🎬┃clips" and so on instead of making duplicates.
const bare = (n) => String(n).toLowerCase().replace(/[^a-z0-9]/g, '');

// ── roles ──
const roles = await api('GET', `/guilds/${G}/roles`);
async function role(name, color, opts = {}) {
  const have = roles.find(r => bare(r.name) === bare(name));
  if (have) {
    if (have.name !== name) { await api('PATCH', `/guilds/${G}/roles/${have.id}`, { name }); log(`  role ${name} — renamed`); }
    else log(`  role ${name} — already there`);
    return have;
  }
  const r = await api('POST', `/guilds/${G}/roles`, { name, color, hoist: !!opts.hoist, mentionable: !!opts.mentionable, permissions: opts.perms || '0' });
  roles.push(r); log(`  role ${name} — made`); return r;
}
log('Roles');
const R = {
  dev: await role('👑 Dev', ORANGE, { hoist: true, perms: bits('ADMIN') }),
  mod: await role('🛡️ Mod', 0x5865f2, { hoist: true, perms: bits('MANAGE_MSG', 'KICK', 'BAN', 'TIMEOUT', 'MANAGE_THREADS', 'MOVE', 'MUTE') }),
  cotw: await role('🏆 Clip of the Week', 0xf5c542, { hoist: true }),
  pro: await role('🔥 Pro Rider', 0x2ecc71, { hoist: true }),
  tester: await role('🧪 Tester', 0x9b59b6),
  ping: await role('🔔 Update Pings', 0x95a5a6, { mentionable: true }),
};

// ── channels ──
let chans = await api('GET', `/guilds/${G}/channels`);
const T = { TEXT: 0, VOICE: 2, CAT: 4, NEWS: 5, FORUM: 15 };
const readOnly = [{ id: G, type: 0, allow: bits('VIEW', 'HISTORY', 'REACT'), deny: bits('SEND', 'SEND_THREADS', 'THREADS') }];
const staffOnly = [{ id: G, type: 0, allow: '0', deny: bits('VIEW') }, { id: R.mod.id, type: 0, allow: bits('VIEW', 'SEND', 'HISTORY'), deny: '0' }, { id: R.dev.id, type: 0, allow: bits('VIEW', 'SEND', 'HISTORY'), deny: '0' }];
const sameKind = (a, b) => a === b || (a !== T.CAT && b !== T.CAT && a !== T.VOICE && b !== T.VOICE);
async function chan(name, type, parent, opts = {}) {
  const label = `${type === T.CAT ? 'category ' : ''}${name}`;
  const have = chans.find(c => bare(c.name) === bare(name) && sameKind(c.type, type));
  if (have) {
    const moved = parent && have.parent_id !== parent.id;
    if (have.name !== name || moved || (opts.topic && have.topic !== opts.topic)) {
      await api('PATCH', `/channels/${have.id}`, { name, ...(moved ? { parent_id: parent.id } : {}), ...(type !== T.CAT && type !== T.VOICE && opts.topic ? { topic: opts.topic } : {}) });
      have.name = name; if (moved) have.parent_id = parent.id; log(`  ${label} — updated`);
    } else log(`  ${label} — already there`);
    return have;
  }
  const body = { name, type, parent_id: parent ? parent.id : undefined, topic: opts.topic, rate_limit_per_user: opts.slow, permission_overwrites: opts.perms, available_tags: opts.tags };
  let c;
  try { c = await api('POST', `/guilds/${G}/channels`, body); }
  catch (e) { if (type === T.NEWS || type === T.FORUM) { c = await api('POST', `/guilds/${G}/channels`, { ...body, type: T.TEXT, available_tags: undefined }); } else throw e; }
  chans.push(c); log(`  ${label} — made`); return c;
}
log('\nChannels');
const catInfo = await chan('── 📌 START HERE ──', T.CAT, null);
const welcome = await chan('👋┃welcome', T.TEXT, catInfo, { topic: '👋 Start here', perms: readOnly });
const rules = await chan('📜┃rules', T.TEXT, catInfo, { topic: '📜 Be decent', perms: readOnly });
const ann = await chan('📢┃announcements', T.NEWS, catInfo, { topic: '📢 News from the SEND IT team', perms: readOnly });
const upd = await chan('🆕┃update-log', T.TEXT, catInfo, { topic: '🆕 Every SEND IT update', perms: readOnly });

const catRide = await chan('── 🛹 RIDE ──', T.CAT, null);
const general = await chan('💬┃general', T.TEXT, catRide, { topic: '💬 Talk about anything SEND IT' });
const clips = await chan('🎬┃clips', T.TEXT, catRide, { topic: '🎬 Clips and photos straight from the game. In a replay press X to share yours.', slow: 30 });
await chan('📸┃screenshots', T.TEXT, catRide, { topic: '📸 Photo mode shots (P in game)', slow: 15 });
const lfr = await chan('🤝┃looking-to-ride', T.TEXT, catRide, { topic: '🤝 Post your server code and find people to ride with', slow: 20 });
const help = await chan('🛹┃tricks-help', T.TEXT, catRide, { topic: '🛹 How do I… ? Ask here' });

const catComp = await chan('── 🏆 COMPETE ──', T.CAT, null);
const cotw = await chan('🏆┃clip-of-the-week', T.TEXT, catComp, { topic: '🏆 The best clip each week wins the Clip of the Week role', perms: readOnly });
await chan('📊┃leaderboards', T.TEXT, catComp, { topic: '📊 Top riders', perms: readOnly });

const catFb = await chan('── 💬 FEEDBACK ──', T.CAT, null);
const tag = (name, emoji) => ({ name, emoji_name: emoji });
const ideas = await chan('💡┃suggestions', T.FORUM, catFb, { topic: 'One idea per post. Upvote the ones you like.', tags: [tag('Ride', '🚲'), tag('Place', '🗺️'), tag('Trick', '🌀'), tag('Other', '💡'), tag('Planned', '✅')] });
const bugs = await chan('🐛┃bug-reports', T.FORUM, catFb, { topic: 'What happened, what you expected, and a screenshot if you can.', tags: [tag('Bug', '🐛'), tag('Crash', '💥'), tag('Lag', '🐢'), tag('Fixed', '✅')] });

const catVoice = await chan('── 🔊 VOICE ──', T.CAT, null);
await chan('🛹┃Riding 1', T.VOICE, catVoice);
await chan('🛴┃Riding 2', T.VOICE, catVoice);
await chan('🛋️┃Chill', T.VOICE, catVoice);

const catStaff = await chan('── 🛠️ STAFF ──', T.CAT, null, { perms: staffOnly });
await chan('🛡️┃mod-chat', T.TEXT, catStaff, { perms: staffOnly });
await chan('📋┃mod-log', T.TEXT, catStaff, { perms: staffOnly });

// ── messages: posted once; on a re-run the bot's own copy (found by its title) is updated to the newest version ──
async function postOnce(ch, payload) {
  const last = await api('GET', `/channels/${ch.id}/messages?after=0&limit=20`); // the oldest messages in the channel
  const title = bare(payload.embeds[0].title);
  const mine = last.find(m => m.author && m.author.id === me.id && m.embeds && m.embeds[0] && bare(m.embeds[0].title) === title);
  if (mine) { await api('PATCH', `/channels/${ch.id}/messages/${mine.id}`, payload); return log(`  ${ch.name} — updated`); }
  if (last.length) return log(`  ${ch.name} already has messages — skipped`);
  await api('POST', `/channels/${ch.id}/messages`, payload); log(`  ${ch.name} — posted`);
}
const linkBtn = (label, url, emoji) => ({ type: 2, style: 5, label, url, emoji: { name: emoji } });
const FOOT = { text: 'SEND IT · see you on the ramps', icon_url: `${SITE}/media/icon.png` };
log('\nMessages');
await postOnce(welcome, {
  embeds: [{
    color: ORANGE,
    author: { name: 'SEND IT', icon_url: `${SITE}/media/icon.png`, url: SITE },
    title: '🛹  Welcome to SEND IT',
    description: '**The free stunt-riding game.** Bikes, scooters, skateboards, skis and surfboards, a whole town to ride, and online servers with your mates.\n' + ZW,
    fields: [
      { name: '🎮  Get the game', value: `[play-sendit.netlify.app](${SITE})\nWindows and Mac`, inline: true },
      { name: '📜  Read the rules', value: `<#${rules.id}>\nTwo minutes, promise`, inline: true },
      { name: '🎬  Share your clips', value: `Open a replay with **V**, press **X**.\nIt lands in <#${clips.id}>`, inline: true },
      { name: '🤝  Ride together', value: `Host a server in the game and drop the code in <#${lfr.id}>`, inline: true },
      { name: '💡  Got an idea?', value: `<#${ideas.id}>`, inline: true },
      { name: '🐛  Found a bug?', value: `<#${bugs.id}>`, inline: true },
      { name: '🔗  Link Discord in the game', value: 'Online → Link Discord. The bot pings you when your clip is posted, and you can sign in with Discord.' },
    ],
    image: { url: `${SITE}/media/trailer-poster.jpg` },
    footer: FOOT,
  }],
  components: [{ type: 1, components: [linkBtn('Play SEND IT', SITE, '🎮'), linkBtn('Watch the trailer', `${SITE}/media/trailer.mp4`, '🎬')] }],
});
const RULES = [
  ['1️⃣', 'Be decent', 'No hate, harassment, threats or slurs.'],
  ['2️⃣', 'Keep it clean', 'No NSFW, gore or shock content.'],
  ['3️⃣', 'No spam or ads', 'No self-promo, scams, or invite links to other servers.'],
  ['4️⃣', 'Right channel', `Clips in <#${clips.id}>, bugs in <#${bugs.id}>, ideas in <#${ideas.id}>.`],
  ['5️⃣', 'No cheating', `Don't share exploits or cheats. Found one? Report it in <#${bugs.id}>.`],
  ['6️⃣', 'English in the main channels', 'So the mods can keep things safe.'],
  ['7️⃣', 'Listen to the Mods', 'They have the final say.'],
];
await postOnce(rules, {
  embeds: [{
    color: ORANGE,
    title: '📜  Rules',
    description: 'Short and simple. Break them and it goes **⚠️ warning → ⏳ timeout → 🔨 ban**.\n' + ZW,
    fields: RULES.map(([e, t, d]) => ({ name: `${e}  ${t}`, value: d })),
    footer: { text: "Discord's own rules apply too · discord.com/guidelines", icon_url: `${SITE}/media/icon.png` },
  }],
});
await postOnce(clips, {
  embeds: [{
    color: ORANGE,
    title: '🎬  Clips from the game land here',
    description: `In the game, open a replay with **V** and press **X**. Add a caption if you want, and the SEND IT bot posts it here.\n\n🔗 Link Discord in the game (**Online → Link Discord**) and the bot pings you when it posts.\n🏆 The best clip each week wins **Clip of the Week** in <#${cotw.id}>.`,
    footer: FOOT,
  }],
});

// ── server icon, and the bot's own name and picture (it posts clips as itself, so there are no webhook links) ──
const icon = await iconData();
if (icon) {
  try { await api('PATCH', `/guilds/${G}`, { icon, system_channel_id: welcome.id }); log('Server icon — set'); }
  catch (e) { log('Server icon — skipped (' + e.message.slice(0, 80) + ')'); }
  const want = { avatar: icon };
  if (me.username !== 'SEND IT') want.username = 'SEND IT';
  try { await api('PATCH', '/users/@me', want); log('Bot name and picture — set'); }
  catch (e) { log('Bot name and picture — skipped (' + e.message.slice(0, 80) + ')'); }
}

// ── remove the old webhooks if an earlier version made them ──
for (const ch of [clips, upd]) {
  for (const w of await api('GET', `/channels/${ch.id}/webhooks`)) {
    if (w.name === 'SEND IT Clips' || w.name === 'SEND IT Updates') { await api('DELETE', `/webhooks/${w.id}`); log(`  old webhook in #${ch.name} — removed`); }
  }
}

// ── invite ──
const inv = await api('POST', `/channels/${welcome.id}/invites`, { max_age: 0, max_uses: 0, unique: false });
return { invite: `https://discord.gg/${inv.code}`, clips: clips.id };
}

// ── the reply: one JSON object per line, streamed, read by play-sendit.netlify.app/discord-setup.html ──
// (Supabase won't serve web pages from functions, so the page lives on the SEND IT website.)
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "content-type" };
const HDR = { ...CORS, "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" };
const one = (o) => new Response(JSON.stringify(o) + "\n", { headers: HDR });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const u = new URL(req.url);
  if (await sha256(u.searchParams.get("key") || "") !== KEY_HASH) return one({ t: "need", what: "key" });
  if (!BOT) return one({ t: "need", what: "token" });
  let me;
  try { me = await api("GET", "/users/@me"); } catch { return one({ t: "need", what: "bad_token" }); }
  const guilds = await api("GET", "/users/@me/guilds");
  if (!guilds.length) return one({ t: "need", what: "add_bot", url: ADD_BOT });
  const pick = u.searchParams.get("guild") || GUILD_SET || (guilds.length === 1 ? guilds[0].id : "");
  const guild = guilds.find((g) => g.id === pick);
  if (!guild) return one({ t: "pick", guilds: guilds.map((g) => ({ id: g.id, name: g.name })) });
  if (u.searchParams.get("check") === "1") return one({ t: "ready", server: guild.name, bot: me.username });

  // build it, and stream the progress so the page can show it happening
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctl) {
      const send = (o) => ctl.enqueue(enc.encode(JSON.stringify(o) + "\n"));
      const log = (s) => send({ t: "log", s: String(s).replace(/^\n+/, "") });
      log(`Setting up "${guild.name}" as ${me.username}…`);
      try {
        const res = await build(guild.id, me, log);
        try { await db.from("si_settings").upsert([{ key: "discord_invite", value: res.invite }, { key: "discord_guild", value: guild.id }]); } catch { /* the page still shows it */ }
        send({ t: "done", invite: res.invite, server: guild.name });
      } catch (e) {
        send({ t: "error", s: String(e?.message || e).slice(0, 400) });
      }
      ctl.close();
    },
  });
  return new Response(stream, { headers: HDR });
});
