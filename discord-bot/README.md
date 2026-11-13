# SEND IT bot (always online)

Keeps the SEND IT bot online in the SEND IT Discord, with the green dot and **Playing SEND IT · 3 riding online**.

It also adds:
- **/play**: an embed with the Download, Website and Trailer buttons
- **/leaderboard**: the top 10 on any leaderboard (combo, Trick Attack, Hill Bomb and the rest)
- **/profile username**: a rider's card, showing whether they're online, their coins and their best scores
- **/servers**: the online servers open right now, with Join buttons
- **/clip**: how to share a clip
- **/invite**: the server's invite link
- 🔥 on every clip the bot posts in 🎬┃clips, so people can vote for Clip of the Week
- a 👋 welcome card in 💬┃general when someone joins (optional, see the last step)

Clip posting doesn't need this bot. Supabase posts clips with the same token, so clips keep working even if this is off.

## Running it on Render (free)
Claude sets up the service, deploying the `discord-bot` folder of this repo as a free web service. You only add the token:
1. In Render, open the **sendit-bot** service, then go to **Environment**.
2. Press **Add Environment Variable**. For the key, enter `BOT_TOKEN`. For the value, paste the bot token (the same one that's in Supabase).
3. Press **Save, rebuild, and deploy**. Within a minute the logs say `SEND IT bot online as SEND IT…`.

Render puts free services to sleep after 15 minutes with no visitors. The bot visits its own web address every 10 minutes so
that never happens. A 24/7 service uses about 720–744 of the 750 free hours each workspace gets per month, so it should
be the only always-on free service in its workspace.

## Running it somewhere else (Orihost, a VPS, your own computer)
Put the token in `config.json` in place of `PASTE THE BOT TOKEN HERE`, then run `npm install` and `node index.js` (Node 18 or newer).

**Welcome cards (optional):** on the Discord developer portal, open SEND IT, then **Bot**, and switch on
**Server Members Intent**. Press Save, then restart the bot (on Render: **Manual Deploy → Restart service**). Without that switch the bot still runs
and just leaves the welcome cards out.
