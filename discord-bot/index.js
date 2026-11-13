// SEND IT bot: keeps the SEND IT bot online in the Discord server (green dot + "Playing SEND IT"), and adds
//   /play  /leaderboard  /profile  /servers  /clip  /invite
//   a welcome card in 💬┃general when someone joins
//   🔥 on every clip the bot posts in 🎬┃clips, so people can vote for Clip of the Week
// Clip posting itself doesn't need this running: Supabase posts clips with the same token whenever someone shares one.
//
// Runs on Render (free web service: the token goes in the BOT_TOKEN environment variable) or anything with Node 18+
// (the token goes in config.json). On Render it also answers web requests and visits its own address every
// 10 minutes, because Render puts free services to sleep after 15 minutes with no visitors.
import { readFileSync, existsSync } from 'node:fs';
import http from 'node:http';
import { Client, GatewayIntentBits, ActivityType, MessageFlags, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder, Events, escapeMarkdown } from 'discord.js';

const cfgFile = new URL('./config.json', import.meta.url);
const cfg = existsSync(cfgFile) ? JSON.parse(readFileSync(cfgFile, 'utf8')) : {};
const TOKEN = (process.env.BOT_TOKEN || cfg.token || '').trim();
const HAS_TOKEN = !!TOKEN && !TOKEN.startsWith('PASTE');
let botState = HAS_TOKEN ? 'starting' : 'waiting for the bot token';

// ── on Render: a tiny web page, and a visit to ourselves every 10 minutes so the service never falls asleep ──
const PORT = Number(process.env.PORT || 0);
if (PORT) {
  http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(`SEND IT bot: ${botState}\n`);
  }).listen(PORT, () => console.log(`web page on port ${PORT}`));
  const self = process.env.RENDER_EXTERNAL_URL;
  if (self) setInterval(() => fetch(self + '/?ping=1').catch(() => { }), 10 * 60_000);
}
if (!HAS_TOKEN) {
  console.log(PORT ? 'No bot token yet. In Render open the service, go to Environment, add BOT_TOKEN with the bot token, and save.'
    : 'No bot token yet. Open config.json and paste the bot token between the quotes, then start the server again.');
  if (!PORT) process.exit(1);
}

const SITE = 'https://play-sendit.netlify.app';
const DB = 'https://jmrgxreacfnakwsbwjyk.supabase.co';
const KEY = 'sb_publishable_dT28MOtEkXkeXclJnqzcvQ_xTSOJqlX'; // public key, the same one the game uses
const ORANGE = 0xff5a26;
const ICON = `${SITE}/media/icon.png`;

// ── talking to the SEND IT database (the same public functions the game uses) ──
async function rpc(fn, args = {}) {
  const r = await fetch(`${DB}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.message || `HTTP ${r.status}`);
  return j;
}

const num = v => Math.round(v).toLocaleString('en-GB');
const secs = v => Number(v).toFixed(2) + 's';
const BOARDS = {
  combo: ['🌀', 'Best combo', num], attack: ['⚡', 'Trick Attack', num], air: ['🚀', 'Biggest air', secs],
  hill: ['🏁', 'Hill Bomb', secs], ski: ['⛷️', 'Peak Run (ski)', secs], woods: ['🌲', 'Woods downhill', secs],
  xp: ['⭐', 'Most XP', num], coins: ['🪙', 'Most coins', num], treasure: ['💎', 'Treasure chests', num], surf: ['🏄', 'Longest surf', v => Math.round(v) + ' m'],
};
const PLACES = { street: 'High street', park: 'Skatepark', dirt: 'Dirt jumps', mega: 'Mega ramp', plaza: 'Plaza', hill: 'Hill Bomb', beach: 'Seafront', yard: 'Construction yard', bigair: 'Big Air', vert: 'Vert ramp', airbag: 'Airbag', downtown: 'Downtown', canyon: 'Canyon', desert: 'Desert line', woods: 'Woods', market: 'Market Street', mountain: 'Peak Run', skihut: 'Peak Run', islands: 'Islands', woodpark: 'Wood Park', warehouse: 'The Warehouse', rooftop: 'Rooftop Park', bigbowl: 'The Big Bowl', the100: 'The 100' };
const place = k => PLACES[k] || (/^isle/.test(k || '') ? 'Islands' : k ? k[0].toUpperCase() + k.slice(1).replace(/_/g, ' ') : 'Town');
const medal = r => ['🥇', '🥈', '🥉'][r - 1] || `\`#${String(r).padStart(2, ' ')}\``;
const clean = s => escapeMarkdown(String(s ?? ''));
const foot = { text: 'SEND IT · see you on the ramps', iconURL: ICON };
const link = (label, url, emoji) => new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url).setEmoji(emoji);

// ── slash commands ──
const COMMANDS = [
  new SlashCommandBuilder().setName('play').setDescription('🎮 Get SEND IT (free, Windows and Mac)'),
  new SlashCommandBuilder().setName('leaderboard').setDescription('🏆 The top 10 riders on a leaderboard')
    .addStringOption(o => o.setName('board').setDescription('Which leaderboard').setRequired(false)
      .addChoices(...Object.entries(BOARDS).map(([id, [e, n]]) => ({ name: `${e} ${n}`, value: id })))),
  new SlashCommandBuilder().setName('profile').setDescription('🪪 A rider\'s SEND IT profile')
    .addStringOption(o => o.setName('username').setDescription('Their SEND IT username').setRequired(true).setMaxLength(32)),
  new SlashCommandBuilder().setName('servers').setDescription('🌐 Online servers you can join right now'),
  new SlashCommandBuilder().setName('clip').setDescription('🎬 How to share a clip from the game'),
  new SlashCommandBuilder().setName('invite').setDescription('🔗 The invite link for this server'),
].map(c => c.toJSON());

async function play(i) {
  const e = new EmbedBuilder().setColor(ORANGE).setAuthor({ name: 'SEND IT', iconURL: ICON, url: SITE })
    .setTitle('🛹  Get SEND IT')
    .setDescription('The free stunt-riding game. Bikes, scooters, skateboards, skis and surfboards, a whole town to ride, and online servers with your mates.')
    .addFields({ name: '💻  Windows and Mac', value: 'Download the launcher, it keeps the game up to date by itself.', inline: true }, { name: '🌐  Online', value: 'Host a server and share the code, or join one with `/servers`.', inline: true })
    .setImage(`${SITE}/media/trailer-poster.jpg`).setFooter(foot);
  await i.reply({ embeds: [e], components: [new ActionRowBuilder().addComponents(link('Download', `${SITE}/#download`, '⬇️'), link('Website', SITE, '🌐'), link('Trailer', `${SITE}/media/trailer.mp4`, '🎬'))] });
}

async function leaderboard(i) {
  const id = i.options.getString('board') || 'combo', [emoji, name, fmt] = BOARDS[id];
  await i.deferReply();
  const r = await rpc('si_leaderboard', { p_board: id, p_scope: 'all', p_limit: 10 });
  const rows = r?.rows || [];
  const e = new EmbedBuilder().setColor(ORANGE).setTitle(`${emoji}  ${name}`).setFooter(foot).setTimestamp();
  e.setDescription(rows.length ? rows.map(x => `${medal(x.rank)}  **${clean(x.username)}**  ·  ${fmt(x.value)}`).join('\n') : 'Nobody on this one yet. Be the first! 🏁');
  await i.editReply({ embeds: [e], components: [new ActionRowBuilder().addComponents(link('Play now', SITE, '🎮'))] });
}

async function profile(i) {
  const name = i.options.getString('username');
  await i.deferReply();
  let p;
  try { p = await rpc('si_profile', { p_username: name }); }
  catch (err) { return i.editReply({ content: /no_such_user/.test(err.message) ? `There's no rider called **${clean(name)}**. Check the spelling?` : 'Couldn\'t reach the SEND IT server, try again in a minute.' }); }
  const scores = Object.entries(p.scores || {}).filter(([b]) => BOARDS[b]).map(([b, v]) => ({ name: `${BOARDS[b][0]} ${BOARDS[b][1]}`, value: BOARDS[b][2](v), inline: true }));
  const e = new EmbedBuilder().setColor(p.online ? 0x2ecc71 : ORANGE)
    .setTitle(`${p.online ? '🟢' : '⚫'}  ${clean(p.username)}`)
    .setDescription([p.online ? '**Riding right now**' : 'Not riding right now', p.discord ? `🔗 Discord: **${clean(p.discord)}**` : null, `🪙 **${num(p.coins_total || 0)}** coins earned`].filter(Boolean).join('\n'))
    .setFooter(foot);
  if (scores.length) e.addFields(scores.slice(0, 24)); else e.addFields({ name: 'Leaderboards', value: 'No scores yet.' });
  await i.editReply({ embeds: [e] });
}

async function servers(i) {
  await i.deferReply();
  const rooms = (await rpc('si_rooms_list', {})) || [];
  const riders = rooms.reduce((t, r) => t + (r.players || 0), 0);
  const e = new EmbedBuilder().setColor(ORANGE).setTitle('🌐  Online servers').setFooter(foot).setTimestamp();
  if (!rooms.length) {
    e.setDescription('No public servers open right now.\nHost one in the game (**Online → Host**) and post the code in 🤝┃looking-to-ride!');
    return i.editReply({ embeds: [e] });
  }
  e.setDescription(`**${riders}** rider${riders === 1 ? '' : 's'} online in **${rooms.length}** server${rooms.length === 1 ? '' : 's'}\n​`);
  const title = r => r.name || `${r.host}'s server`;
  e.addFields(rooms.slice(0, 10).map(r => ({ name: `🛹 ${clean(title(r))}`, value: `📍 ${place(r.zone)}  ·  👥 ${r.players}/${r.max}\nHost: **${clean(r.host)}**  ·  Code \`${r.code}\``, inline: false })));
  const btns = rooms.slice(0, 5).map(r => link(`Join ${title(r).slice(0, 24)}`, `${SITE}/join.html?code=${encodeURIComponent(r.code)}`, '▶️'));
  await i.editReply({ embeds: [e], components: [new ActionRowBuilder().addComponents(...btns)] });
}

async function clip(i) {
  const ch = i.guild?.channels.cache.find(c => c.name.toLowerCase().replace(/[^a-z-]/g, '') === 'clips');
  const e = new EmbedBuilder().setColor(ORANGE).setTitle('🎬  Share a clip')
    .addFields(
      { name: '1️⃣  Open a replay', value: 'After a run press **V**.', inline: true },
      { name: '2️⃣  Press X', value: 'It records the replay with the music.', inline: true },
      { name: '3️⃣  Add a caption', value: 'Optional. Press **Enter** to post.', inline: true },
    )
    .setDescription(`The SEND IT bot posts it in ${ch ? `<#${ch.id}>` : '🎬┃clips'}. Link Discord in the game (**Online → Link Discord**) and it pings you. In photo mode (**P**) press **X** to share a photo.\n​`)
    .setFooter(foot);
  await i.reply({ embeds: [e] });
}

async function invite(i) {
  let url = null; try { url = await rpc('si_discord_invite'); } catch { }
  if (!url) return i.reply({ content: 'No invite link saved yet. Run the setup page again to make one.', flags: MessageFlags.Ephemeral });
  await i.reply({ content: `🔗 **Invite your mates:** ${url}` });
}

const HANDLERS = { play, leaderboard, profile, servers, clip, invite };

// ── the bot ──
function start(withMembers) {
  const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages];
  if (withMembers) intents.push(GatewayIntentBits.GuildMembers);
  const client = new Client({ intents });

  client.once(Events.ClientReady, async c => {
    botState = `online as ${c.user.tag}`;
    console.log(`SEND IT bot online as ${c.user.tag} in ${c.guilds.cache.size} server(s)${withMembers ? '' : ' (welcome cards off: switch on "Server Members Intent" on the Bot page to turn them on)'}`);
    for (const g of c.guilds.cache.values()) {
      try { await g.commands.set(COMMANDS); console.log(`  slash commands ready in ${g.name}`); } catch (e) { console.log(`  couldn't add slash commands in ${g.name}: ${e.message}`); }
    }
    status(c); setInterval(() => status(c), 60_000);
  });
  client.on(Events.GuildCreate, g => g.commands.set(COMMANDS).catch(() => { }));

  client.on(Events.InteractionCreate, async i => {
    if (!i.isChatInputCommand() || !HANDLERS[i.commandName]) return;
    try { await HANDLERS[i.commandName](i); }
    catch (e) {
      console.log(`/${i.commandName} failed:`, e.message);
      const msg = { content: 'Something went wrong there. Try again in a minute.', flags: MessageFlags.Ephemeral };
      try { i.deferred || i.replied ? await i.editReply(msg) : await i.reply(msg); } catch { }
    }
  });

  // 🔥 on every clip or photo the bot posts in 🎬┃clips, for Clip of the Week voting
  client.on(Events.MessageCreate, async m => {
    if (m.author.id !== client.user.id || !m.attachments.size) return;
    if (m.channel.name?.toLowerCase().replace(/[^a-z-]/g, '') !== 'clips') return;
    m.react('🔥').catch(() => { });
  });

  // welcome card in 💬┃general
  if (withMembers) client.on(Events.GuildMemberAdd, async mem => {
    if (mem.user.bot) return;
    const find = n => mem.guild.channels.cache.find(c => c.name.toLowerCase().replace(/[^a-z-]/g, '') === n);
    const general = find('general'); if (!general) return;
    const rules = find('rules'), clips = find('clips'), lfr = find('looking-to-ride');
    const e = new EmbedBuilder().setColor(ORANGE).setThumbnail(mem.user.displayAvatarURL({ size: 128 }))
      .setTitle(`👋  Welcome to SEND IT, ${clean(mem.displayName)}!`)
      .setDescription([
        `You're rider **#${mem.guild.memberCount.toLocaleString('en-GB')}** 🎉`,
        '',
        `📜 Read the ${rules ? `<#${rules.id}>` : 'rules'}`,
        `🎬 Share clips from the game in ${clips ? `<#${clips.id}>` : '🎬┃clips'}`,
        `🤝 Find people to ride with in ${lfr ? `<#${lfr.id}>` : '🤝┃looking-to-ride'}`,
      ].join('\n'))
      .setFooter(foot);
    general.send({ content: `<@${mem.id}>`, embeds: [e], components: [new ActionRowBuilder().addComponents(link('Get the game', SITE, '🎮'))], allowedMentions: { users: [mem.id] } }).catch(() => { });
  });

  client.login(TOKEN).catch(e => {
    if (withMembers && (e.code === 'DisallowedIntents' || /intent/i.test(e.message))) { client.destroy(); return start(false); }
    botState = 'the bot token was not accepted';
    console.log(/token/i.test(e.message) ? 'Discord didn\'t accept the bot token. Reset it on the Bot page and put the new one in (BOT_TOKEN on Render, config.json elsewhere).' : 'Couldn\'t log in: ' + e.message);
    if (!PORT) process.exit(1);
  });
}

// "Playing SEND IT · 3 online", swapping with "Watching your clips 🎬" every minute
let tick = 0;
async function status(c) {
  let riders = 0;
  try { riders = ((await rpc('si_rooms_list', {})) || []).reduce((t, r) => t + (r.players || 0), 0); } catch { }
  const list = [
    { type: ActivityType.Playing, name: riders ? `SEND IT · ${riders} riding online` : 'SEND IT' },
    { type: ActivityType.Watching, name: 'your clips 🎬' },
  ];
  c.user.setPresence({ status: 'online', activities: [list[tick++ % list.length]] });
}

if (HAS_TOKEN) start(true);
process.on('unhandledRejection', e => console.log('error:', e?.message || e));
