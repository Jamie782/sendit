# Setting up the SEND IT Discord server

`setup-server.mjs` builds the whole server for you: roles, channels, permissions, the welcome and rules
messages, the server icon, the webhooks the game uses to post clips, and a permanent invite link.
It is safe to run again; anything that already exists is left alone.

## What it makes

| Section | Channels |
|---|---|
| 📌 START HERE (read-only) | #welcome, #rules, #announcements, #update-log |
| 🛹 RIDE | #general, #clips, #screenshots, #looking-to-ride, #tricks-help |
| 🏆 COMPETE (read-only) | #clip-of-the-week, #leaderboards |
| 💬 FEEDBACK | suggestions and bug-reports (forums with tags) |
| 🔊 VOICE | Riding 1, Riding 2, Chill |
| 🛠 STAFF (Dev and Mod only) | #mod-chat, #mod-log |

Roles: **Dev** (admin), **Mod**, **Clip of the Week**, **Pro Rider**, **Tester**, **Update Pings**.

## Steps

1. In Discord, press **+** in the server list → **Create My Own** → **For me and my friends**, name it **SEND IT**.
2. Go to <https://discord.com/developers/applications>, open **SEND IT** → **Bot** → **Reset Token**, and copy the token. Keep it private.
3. Open this link and pick the SEND IT server, so the bot joins with admin rights:
   <https://discord.com/oauth2/authorize?client_id=1570333669124472903&scope=bot&permissions=8>
4. In a terminal, go to this folder: `cd SendIt/tools/discord-setup`
5. Run it: `node setup-server.mjs`, then paste the bot token when it asks.
6. Copy the four things it prints at the end. The Supabase secrets go in: ReelRoom org → jamiesmp56@gmail.com's Project →
   Edge Functions → Secrets.
   - the **clips webhook** → secret `DISCORD_CLIPS_WEBHOOK` (the SEND IT bot posts clips with it)
   - the **server ID** → secret `DISCORD_GUILD_ID`, plus your **bot token** → secret `DISCORD_BOT_TOKEN`
     (these let players tick "Also join the SEND IT Discord server" when they sign in with Discord)
   - the **update-log webhook** → keep it for automatic update posts
   - the **invite link** → send it to Claude to put in the game and on the website
7. Give yourself the **Dev** role: Server Settings → Members → your name → **+** → Dev.

Optional: Server Settings → **Enable Community** turns #announcements into a real announcement channel
people can follow, and lets you pick #rules as the rules channel.
