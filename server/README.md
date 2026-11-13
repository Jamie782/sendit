# SEND IT online backend

Everything lives in the Supabase project **jmrgxreacfnakwsbwjyk** (the ReelRoom project), named with an `si_` prefix so it stays apart from ReelRoom.

- `schema.sql`: accounts, sessions, friends, scores, servers, join tickets
- `schema2.sql`: invites, picture avatars, Discord linking / sign-in
- `schema4.sql`: `si_settings` (the Discord server ID and invite link the bot saves) and `si_discord_invite()` for the website
- `si-discord/index.ts`: the Discord sign-in edge function (deployed as `si-discord`, JWT check off because Discord's redirect has no token)
- `si-clip/index.ts`: posts clips and photos from the game in 🎬┃clips as the SEND IT bot, with pings and caption edits
- `si-discord-setup/index.ts`: the SEND IT bot builds the Discord server (used by the website's setup page)

Passwords are hashed with bcrypt. The tables have row-level security on and no direct access; the game can only call the `si_` functions.

## Switching on "Sign in with Discord"
1. Go to https://discord.com/developers/applications and press **New Application**. Call it SEND IT.
2. Open **OAuth2**. Under **Redirects** add exactly:
   `https://jmrgxreacfnakwsbwjyk.supabase.co/functions/v1/si-discord`
   and save.
3. Copy the **Client ID**, then press **Reset Secret** and copy the **Client Secret**.
4. In Supabase: **Edge Functions → Secrets**, add `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET`.
5. Optional: add `SITE_URL` (your Netlify address, e.g. `https://play-sendit.netlify.app`) so players land on the site's "All done" page after signing in.

## Invite links
The game makes links like `https://play-sendit.netlify.app/join.html?code=ABCDE`. If your Netlify site has a different address, change `SITE_URL` near the top of the online section in `src/game.js`.

## The SEND IT Discord server (the bot builds it)
Open **https://play-sendit.netlify.app/discord-setup.html?key=SETUP_KEY** (Claude has the key) and follow the four steps:
1. Make an empty server in Discord (bots aren't allowed to create servers themselves).
2. Bot page → **Reset Token**, then add it in Supabase **Edge Functions → Secrets** as `DISCORD_BOT_TOKEN`.
3. Press **ADD THE BOT** and pick the server.
4. Press **BUILD MY SERVER**. The bot makes the roles, channels, rules, welcome message and invite link, and saves the
   server ID and invite link in `si_settings`, so clip posting, server joining and the website's Discord link all find it
   by themselves. Nothing to host: Supabase only uses the bot token when something happens. Safe to press again.
