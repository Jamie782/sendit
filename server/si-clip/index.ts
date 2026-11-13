// SEND IT: share a replay clip or a photo from the game to the #clips channel on the SEND IT Discord.
// The game posts multipart form data (token, kind, place, ride, combo, caption, file). We check the player is signed in
// and not banned, keep people to one share every 90 seconds, then the SEND IT bot posts it in #clips as itself, using the
// DISCORD_BOT_TOKEN secret (it never reaches players, and there is no webhook link that could leak). It finds #clips in
// the server named by DISCORD_GUILD_ID (or DISCORD_CLIPS_CHANNEL if set). If the player has linked Discord the post pings
// them. The reply carries a signed "edit" ticket so the player can change the caption afterwards
// (action=edit), for up to 24 hours, without us having to store anything.
import { createClient } from "jsr:@supabase/supabase-js@2";

const BOT = (Deno.env.get("DISCORD_BOT_TOKEN") ?? "").trim();
const GUILD = (Deno.env.get("DISCORD_GUILD_ID") ?? "").trim();
const CHAN_SET = (Deno.env.get("DISCORD_CLIPS_CHANNEL") ?? "").trim();
const DAPI = "https://discord.com/api/v10";
const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(Deno.env.get("SUPABASE_URL")!, KEY, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const MAX = 9_800_000; // Discord's upload limit for servers without boosts is 10 MB
const WAIT = 90_000, EDIT_WAIT = 4_000, EDIT_FOR = 24 * 3600_000, CAP_MAX = 140;
const last = new Map<string, number>(), lastEdit = new Map<string, number>();
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const clean = (v: unknown, n: number) => String(v ?? "").slice(0, n).replace(/[*_`~|>@#\\\[\]()<]/g, "").trim();

// ── captions: one line, no links, no mentions, markdown escaped, swear words blanked ──
// roots that are never part of an innocent word, and words that only count on their own ("grape", "raccoon", "cockpit")
const BAD = ["fuck", "shit", "bitch", "cunt", "wank", "twat", "bollock", "bastard", "pussy", "slut", "whore", "nigg", "faggot", "retard", "tranny", "spastic", "wetback"];
const SHORT = new Set(["ass", "arse", "arsehole", "asshole", "piss", "tit", "tits", "prick", "dick", "dicks", "cock", "cocks", "hoe", "hoes", "fck", "fk", "fuk", "stfu", "milf", "porn", "cum", "nonce", "fag", "fags", "spaz", "paki", "pakis", "chink", "chinks", "kike", "kikes", "coon", "coons", "gook", "gooks", "dyke", "dykes", "rape", "raped", "rapist", "nazi", "nazis", "hitler", "kys"]);
const LEET: Record<string, string> = { "0": "o", "1": "i", "!": "i", "3": "e", "4": "a", "@": "a", "5": "s", "$": "s", "7": "t", "8": "b", "+": "t" };
const norm = (w: string) => w.toLowerCase().replace(/[01!34@5$78+]/g, (c) => LEET[c]).replace(/[^a-z]/g, "").replace(/(.)\1{2,}/g, "$1$1");
function bad(w: string) {
  const n = norm(w), n1 = n.replace(/(.)\1+/g, "$1");
  if (!n) return false;
  if (SHORT.has(n) || SHORT.has(n1) || SHORT.has(n.replace(/s$/, ""))) return true;
  return BAD.some((b) => n.includes(b) || n1.includes(b));
}
// control characters, zero-width and direction-changing characters (built from code points to keep the source plain ASCII)
const CTRL = new RegExp(`[${[[0, 0x1f], [0x7f, 0x7f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f]].map(([a, b]) => String.fromCharCode(a) + "-" + String.fromCharCode(b)).join("")}]`, "g");
function cleanCaption(v: unknown) {
  let s = String(v ?? "").normalize("NFKC").replace(CTRL, " ");
  s = s.replace(/\b(?:https?:\/\/|www\.)\S+/gi, "").replace(/\b(?:discord(?:app)?\.(?:gg|com\/invite)|dsc\.gg)\/\S+/gi, "");
  s = s.replace(/<(?:@[!&]?|#|:[\w~]+:|a:[\w~]+:)\d*>?/g, "").replace(/@/g, "");
  s = s.replace(/\s+/g, " ").trim().slice(0, CAP_MAX);
  s = s.split(/(\s+)/).map((w) => (/\S/.test(w) && bad(w) ? w[0] + "\\*".repeat(Math.max(2, Math.min(8, w.length - 1))) : w.replace(/([\\*_~`|>#\-\[\]()])/g, "\\$1"))).join("");
  return s.trim();
}
// what the caption looks like back in the game (no markdown escapes)
const plain = (c: string) => c.replace(/\\(.)/g, "$1");

// ── signed edit tickets ──
const enc = new TextEncoder();
const b64u = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));
let hk: CryptoKey | null = null;
async function hmac(data: string) {
  hk ||= await crypto.subtle.importKey("raw", enc.encode("si-clip-edit:" + KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(await crypto.subtle.sign("HMAC", hk, enc.encode(data)));
}
async function makeTicket(o: { m: string; c: string; u: string; b: string; t: number }) {
  const body = b64u(enc.encode(JSON.stringify(o)));
  return body + "." + await hmac(body);
}
async function readTicket(t: string) {
  const [body, sig] = String(t || "").split(".");
  if (!body || !sig || sig !== await hmac(body)) return null;
  try { return JSON.parse(unb64u(body)) as { m: string; c: string; u: string; b: string; t: number }; } catch { return null; }
}
const withCaption = (base: string, cap: string) => cap ? `${base}\n> ${cap}` : base;

// ── talking to Discord as the bot ──
async function discord(method: string, path: string, body?: BodyInit, json = false): Promise<Response> {
  for (let i = 0; ; i++) {
    const r = await fetch(DAPI + path, { method, body, headers: { Authorization: `Bot ${BOT}`, ...(json ? { "Content-Type": "application/json" } : {}) } });
    if (r.status !== 429 || i >= 1) return r;
    const j = await r.json().catch(() => ({})); // rate limited: wait once and try again
    await new Promise((res) => setTimeout(res, Math.min(5, Number(j?.retry_after) || 1) * 1000 + 100));
  }
}
let clipsChan = /^\d{5,25}$/.test(CHAN_SET) ? CHAN_SET : "";
async function findClips() {
  if (clipsChan) return clipsChan;
  if (!/^\d{5,25}$/.test(GUILD)) return "";
  const r = await discord("GET", `/guilds/${GUILD}/channels`).catch(() => null);
  if (!r?.ok) return "";
  const list = await r.json().catch(() => []) as { id: string; name: string; type: number }[];
  clipsChan = list.find((c) => c.type === 0 && c.name === "clips")?.id || "";
  return clipsChan;
}

async function whoIs(token: string) {
  const { data: me, error } = await db.rpc("si_me", { p_token: token });
  if (error || !me) return { err: String(error?.message || "").startsWith("banned") ? "banned" : "not_signed_in" };
  return { me };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  if (!BOT || !/^\d{5,25}$/.test(CHAN_SET || GUILD)) return json({ ok: false, error: "not_set_up" });
  if (Number(req.headers.get("content-length") || 0) > MAX + 300_000) return json({ ok: false, error: "too_big" });

  let form: FormData;
  try { form = await req.formData(); } catch { return json({ ok: false, error: "bad_request" }); }
  const token = String(form.get("token") || "");

  // ── change the caption on a post you made ──
  if (form.get("action") === "edit") {
    const tk = await readTicket(String(form.get("edit") || ""));
    if (!tk || !/^\d+$/.test(String(tk.c)) || !/^\d+$/.test(String(tk.m))) return json({ ok: false, error: "bad_request" });
    if (Date.now() - tk.t > EDIT_FOR) return json({ ok: false, error: "edit_expired" });
    const w = await whoIs(token);
    if (!w.me) return json({ ok: false, error: w.err });
    if (String(w.me.id) !== tk.u) return json({ ok: false, error: "not_signed_in" });
    if ((lastEdit.get(tk.u) || 0) > Date.now() - EDIT_WAIT) return json({ ok: false, error: "slow_down", wait: 4 });
    lastEdit.set(tk.u, Date.now());
    const cap = cleanCaption(form.get("caption"));
    try {
      const r = await discord("PATCH", `/channels/${tk.c}/messages/${tk.m}`, JSON.stringify({ content: withCaption(tk.b, cap), allowed_mentions: { parse: [] } }), true);
      if (r.status === 404) return json({ ok: false, error: "gone" });
      if (!r.ok) return json({ ok: false, error: `discord_${r.status}` });
    } catch { return json({ ok: false, error: "discord_unreachable" }); }
    return json({ ok: true, caption: plain(cap) });
  }

  // ── post a new clip or photo ──
  const kind = form.get("kind") === "photo" ? "photo" : "clip", file = form.get("file");
  if (!(file instanceof File) || file.size < 1000 || file.size > MAX) return json({ ok: false, error: file instanceof File && file.size > MAX ? "too_big" : "bad_file" });
  const typeOk = kind === "clip" ? /^video\/(webm|mp4)/.test(file.type) : /^image\/(jpeg|png|webp)$/.test(file.type);
  if (!typeOk) return json({ ok: false, error: "bad_file" });

  const w = await whoIs(token);
  if (!w.me) return json({ ok: false, error: w.err });
  const chan = await findClips();
  if (!chan) return json({ ok: false, error: "not_set_up" });
  const me = w.me, who = String(me.id || me.username), now = Date.now();
  if ((last.get(who) || 0) > now - WAIT) return json({ ok: false, error: "slow_down", wait: Math.ceil(((last.get(who) || 0) + WAIT - now) / 1000) });
  last.set(who, now);

  // ping them if they've linked Discord
  let did = "";
  try { const { data } = await db.from("si_users").select("discord_id").eq("id", me.id).maybeSingle(); did = /^\d{5,25}$/.test(String(data?.discord_id || "")) ? String(data!.discord_id) : ""; } catch { /* post without the ping */ }

  const name = clean(me.username, 32) || "A rider", place = clean(form.get("place"), 40), ride = clean(form.get("ride"), 20), combo = Math.max(0, Math.min(1e9, Number(form.get("combo")) || 0));
  const who2 = did ? `<@${did}> (**${name}**)` : `**${name}**`;
  const base = kind === "clip"
    ? `🎬 ${who2} sent a clip${place ? ` from **${place}**` : ""}${ride ? ` on a ${ride.toLowerCase()}` : ""}${combo > 0 ? ` · best combo **${combo.toLocaleString("en-GB")}**` : ""}`
    : `📸 ${who2} took a photo${place ? ` at **${place}**` : ""}`;
  const cap = cleanCaption(form.get("caption"));
  const fd = new FormData();
  fd.append("payload_json", JSON.stringify({ content: withCaption(base, cap), allowed_mentions: { parse: [], users: did ? [did] : [] } }));
  fd.append("files[0]", file, kind === "clip" ? (file.type.includes("mp4") ? "send-it-clip.mp4" : "send-it-clip.webm") : "send-it-photo.jpg");
  let msgId = "";
  try {
    const r = await discord("POST", `/channels/${chan}/messages`, fd);
    if (r.status === 404) clipsChan = CHAN_SET; // #clips was deleted or remade: look it up again next time
    if (!r.ok) { last.delete(who); return json({ ok: false, error: r.status === 413 ? "too_big" : `discord_${r.status}` }); }
    msgId = String((await r.json().catch(() => ({})))?.id || "");
  } catch {
    last.delete(who); return json({ ok: false, error: "discord_unreachable" });
  }
  const edit = /^\d+$/.test(msgId) ? await makeTicket({ m: msgId, c: chan, u: String(me.id), b: base, t: now }) : null;
  return json({ ok: true, pinged: !!did, caption: plain(cap), edit });
});
