// SEND IT: share a replay clip or a photo from the game to the #clips channel on the SEND IT Discord.
// The game posts multipart form data (token, kind, place, ride, combo, file). We check the player is signed in and
// not banned, keep people to one share every 90 seconds, then forward the file to the Discord webhook kept in the
// DISCORD_CLIPS_WEBHOOK secret (the webhook address never reaches players).
import { createClient } from "jsr:@supabase/supabase-js@2";

const HOOK = Deno.env.get("DISCORD_CLIPS_WEBHOOK") ?? "";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, apikey, authorization, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const MAX = 9_800_000; // Discord's upload limit for servers without boosts is 10 MB
const WAIT = 90_000;
const last = new Map<string, number>();
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const clean = (v: unknown, n: number) => String(v ?? "").slice(0, n).replace(/[*_`~|>@#\\\[\]()<]/g, "").trim();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  if (!/^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(HOOK)) return json({ ok: false, error: "not_set_up" });
  if (Number(req.headers.get("content-length") || 0) > MAX + 300_000) return json({ ok: false, error: "too_big" });

  let form: FormData;
  try { form = await req.formData(); } catch { return json({ ok: false, error: "bad_request" }); }
  const token = String(form.get("token") || ""), kind = form.get("kind") === "photo" ? "photo" : "clip", file = form.get("file");
  if (!(file instanceof File) || file.size < 1000 || file.size > MAX) return json({ ok: false, error: file instanceof File && file.size > MAX ? "too_big" : "bad_file" });
  const typeOk = kind === "clip" ? /^video\/(webm|mp4)/.test(file.type) : /^image\/(jpeg|png|webp)$/.test(file.type);
  if (!typeOk) return json({ ok: false, error: "bad_file" });

  const { data: me, error } = await db.rpc("si_me", { p_token: token });
  if (error || !me) return json({ ok: false, error: String(error?.message || "").startsWith("banned") ? "banned" : "not_signed_in" });
  const who = String(me.id || me.username), now = Date.now();
  if ((last.get(who) || 0) > now - WAIT) return json({ ok: false, error: "slow_down", wait: Math.ceil(((last.get(who) || 0) + WAIT - now) / 1000) });
  last.set(who, now);

  const name = clean(me.username, 32) || "A rider", place = clean(form.get("place"), 40), ride = clean(form.get("ride"), 20), combo = Math.max(0, Math.min(1e9, Number(form.get("combo")) || 0));
  const content = kind === "clip"
    ? `🎬 **${name}** sent a clip${place ? ` from **${place}**` : ""}${ride ? ` on a ${ride.toLowerCase()}` : ""}${combo > 0 ? ` · best combo **${combo.toLocaleString("en-GB")}**` : ""}`
    : `📸 **${name}** took a photo${place ? ` at **${place}**` : ""}`;
  const fd = new FormData();
  fd.append("payload_json", JSON.stringify({ username: "SEND IT", avatar_url: "https://play-sendit.netlify.app/media/icon.png", content, allowed_mentions: { parse: [] } }));
  fd.append("files[0]", file, kind === "clip" ? (file.type.includes("mp4") ? "send-it-clip.mp4" : "send-it-clip.webm") : "send-it-photo.jpg");
  try {
    const r = await fetch(`${HOOK}?wait=true`, { method: "POST", body: fd });
    if (!r.ok) { last.delete(who); return json({ ok: false, error: r.status === 413 ? "too_big" : `discord_${r.status}` }); }
  } catch {
    last.delete(who); return json({ ok: false, error: "discord_unreachable" });
  }
  return json({ ok: true });
});
