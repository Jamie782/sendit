// SEND IT: "Link Discord" / "Sign in with Discord".
// The game asks the database for a one-time state, opens  <project>/functions/v1/si-discord?start=<state>  in the browser,
// we bounce to Discord, Discord sends the player back here with a code, we look the player up with Discord and
// record the result against the state. The game is polling that state and picks the result up.
import { createClient } from "jsr:@supabase/supabase-js@2";

const CID = Deno.env.get("DISCORD_CLIENT_ID") ?? "";
const SECRET = Deno.env.get("DISCORD_CLIENT_SECRET") ?? "";
const SITE = (Deno.env.get("SITE_URL") ?? "").replace(/\/$/, "");
const BASE = Deno.env.get("SUPABASE_URL")!;
const SELF = `${BASE}/functions/v1/si-discord`;
const db = createClient(BASE, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

function finish(ok: boolean, msg: string) {
  // the website shows a nice page if SITE_URL is set; otherwise a plain message
  if (SITE) return Response.redirect(`${SITE}/discord.html?ok=${ok ? 1 : 0}&msg=${encodeURIComponent(msg)}`, 302);
  return new Response(`SEND IT\n\n${msg}\n\nYou can close this tab and go back to the game.`, { status: ok ? 200 : 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

Deno.serve(async (req) => {
  const u = new URL(req.url);
  if (!CID || !SECRET) return finish(false, "Discord sign-in isn't switched on yet.");

  const start = u.searchParams.get("start");
  if (start) {
    if (!/^[a-f0-9]{48}$/.test(start)) return finish(false, "That link is broken. Try again from the game.");
    const q = new URLSearchParams({ client_id: CID, response_type: "code", scope: "identify", redirect_uri: SELF, state: start, prompt: "consent" });
    return Response.redirect(`https://discord.com/oauth2/authorize?${q}`, 302);
  }

  if (u.searchParams.get("error")) return finish(false, "Discord sign-in was cancelled.");
  const code = u.searchParams.get("code"), state = u.searchParams.get("state");
  if (!code || !state || !/^[a-f0-9]{48}$/.test(state)) return finish(false, "Something went wrong. Try again from the game.");

  try {
    const tok = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: CID, client_secret: SECRET, grant_type: "authorization_code", code, redirect_uri: SELF }),
    }).then((r) => r.json());
    if (!tok.access_token) return finish(false, "Discord didn't accept the sign-in. Try again from the game.");
    const me = await fetch("https://discord.com/api/users/@me", { headers: { Authorization: `Bearer ${tok.access_token}` } }).then((r) => r.json());
    if (!me.id) return finish(false, "Couldn't read your Discord profile.");
    const avatar = me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=128` : null;
    const name = (me.global_name || me.username || "rider").slice(0, 40);
    const { data, error } = await db.rpc("si_discord_complete", { p_state: state, p_id: String(me.id), p_name: name, p_avatar: avatar });
    if (error) return finish(false, "The game server had a problem. Try again.");
    if (!data.ok) return finish(false, data.error === "discord_in_use" ? "That Discord account is already linked to another SEND IT account." : "That sign-in link expired. Try again from the game.");
    return finish(true, data.kind === "link" ? `Linked Discord (${name}) to ${data.username}.` : `Signed in as ${data.username}.`);
  } catch (_e) {
    return finish(false, "Couldn't reach Discord. Try again.");
  }
});
