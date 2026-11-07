# SEND IT online backend

Everything lives in the Supabase project **jmrgxreacfnakwsbwjyk** (the ReelRoom project), named with an `si_` prefix so it stays apart from ReelRoom.

- `schema.sql`: accounts, sessions, friends, scores, servers, join tickets
- `schema2.sql`: invites, picture avatars, Discord linking / sign-in
- `si-discord/index.ts`: the Discord sign-in edge function (deployed as `si-discord`, JWT check off because Discord's redirect has no token)

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
