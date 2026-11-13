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

## Putting it on Orihost
1. Make a new **Node.js** server on Orihost (Node 18 or newer).
2. **Files**: upload `SendIt-Bot.zip`, then press the **⋯** next to it and choose **Unarchive**. The files can go in the main folder.
3. Open **config.json**, paste the bot token between the quotes in place of `PASTE THE BOT TOKEN HERE`, and press **Save**.
   This is the same token you put in Supabase.
4. **Startup**: if it asks for a main file, put `index.js`.
5. **Console**: press **Start**. It installs discord.js the first time, then says `SEND IT bot online as SEND IT…`.

The slash commands appear in Discord within a few seconds. If they don't, restart Discord with Ctrl+R (Cmd+R on Mac).

**Welcome cards (optional):** on the Discord developer portal, open SEND IT, then **Bot**, and switch on
**Server Members Intent**. Press Save, then **Restart** the bot on Orihost. Without that switch the bot still runs
and just leaves the welcome cards out.
