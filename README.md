# SEND IT

**Download:** https://play-sendit.netlify.app · **Play in your browser:** https://play-sendit.netlify.app/play/

3D stunt riding game — bike, e-bike, scooter and e-scooter. Desktop app for Windows and Mac (Electron + Three.js). Everything is procedural, no asset downloads.

## What's new in v1.5
- **Automatic updates.** The app checks for a new version when it starts and every 30 minutes. It downloads just the changed game files (a few MB) in the background, then offers **Restart now**. Saves are kept. If an update ever changes the app itself (rare), players are told to download it again from the website.
- Version number shown at the bottom of Settings.

## Releasing an update
1. Change the game, then bump the version in `version.json` (and `GAME_VERSION` in `src/game.js`).
2. Run `python3 tools/make_manifest.py website "What changed"`. This copies the game into `website/play` and writes `website/play/manifest.json`.
3. Push to GitHub. If Netlify is linked to the repo (publish directory `website`), it goes live and every player's app picks it up.
4. Only if `main.js` changed: raise `MIN_SHELL` in `tools/make_manifest.py`, build new downloads and put them in a GitHub release.

## What's new in v1.4.1
- Quieter, smoother ride sounds (no more buzzing), with separate Music and Sound effects volume sliders in Settings.
- Traffic drives faster (about 55–75 km/h).
- Ride into someone fast and you knock them flat; they get back up a few seconds later.

## What's new in v1.4
- **New menu:** split into Play, Garage, Online, Ranks and Settings tabs, with your avatar and coins at the top. Your rider stays in view beside the menu.
- **Accounts:** sign up with a username and password, or **sign in with Discord**. Coins, upgrades, skins, goals and your avatar save online and follow you to any computer. You can link Discord to an existing account.
- **Coins for tricks:** every combo you land pays coins. Bigger tricks score more, and long combos (×3 and ×6 multipliers) pay a bonus on top.
- **Avatars:** design your face (skin, hair, eyes, mouth, background and head: full-face helmet, open helmet, cap, beanie or nothing). Your rider in the game wears the same head. You can also **upload your own picture** or use your Discord picture.
- **Leaderboards:** best combo, Trick Attack, Hill Bomb time, biggest air and most coins, for everyone or just your friends.
- **Servers:** a server list where you can join any public server in one click, or host your own as **public** or **friends only**.
- **Friends:** add people by username, accept requests, see who's online and which server they're in, and join them.
- **Invites:** invite a friend to the server you're on (they get a pop-up with a JOIN button, even on a friends-only server), or copy an **invite link** that opens the game and joins.
- **More skins:** 4 new paint jobs (pixel camo, rainbow, lava, diamond) and 4 new rider skins (ninja, ice, toxic, royal).

## What's new in v1.3
- **New logo** and app icon.
- **Three new places:**
  - **Hill Bomb** (key 6): a 36 m downhill road with five tabletops, grindable crash barriers and a timed race through the gates. Beat your best time for cash.
  - **Seafront** (key 7): beach, promenade rails, beach huts, a concrete bowl and a pier you can launch off into the sea.
  - **Construction Yard** (key 8): a scaffold drop-in to jump a double-decker bus, shipping containers to ride and grind, a giant concrete pipe, plank ramps and a crane.
- **More ramps** along the high street, with a quarter pipe at the west end.
- **Garage:** earn cash from tricks, combos, letters, goals and races. Spend it on 5 upgrades per ride (top speed, acceleration, pop, trick speed, grip), 10 paint jobs (camo, carbon, chrome, flames, neon, galaxy, oil slick, gold…) and 8 rider outfits. Your paint and outfit show up for friends in multiplayer.
- **Radio:** 5 stations made live in the game — RAD FM (drum & bass), CHILL FM (lo-fi), SKATE PUNK RADIO, 808 FM (trap) and NIGHT DRIVE (synthwave). Press N to change station; volume and off in the menu.
- **Trick Attack:** score as much as you can in 2 minutes.
- 5 new goals (19 in total).

## What's new in v1.2
- **Multiplayer:** ride together in rooms. One person presses HOST A ROOM and gets a 4-letter code; friends type it in and press JOIN. You see each other ride with name tags, a live room scoreboard, combo call-outs in the feed, and chat (T).
- **Grinds:** hop onto any rail, ledge, bench or the fountain rim. Hold a direction as you land for Feeble / Smith / Nose / Crooked (scooter) or Double Peg / Feeble / Smith / Icepick / Luc-E (bike).
- **More tricks:** each vehicle now has 7 trick buttons (J K L I U O SHIFT) — Tabletop, Can-Can, X-Up, Heelwhip, Indy Grab, Nac-Nac, Kickout and more — plus stoppies / nose manuals (SHIFT+S).
- **Easy mode (default) / Pro:** easy finishes your whips and pulls your feet back on before landing, auto-balances grinds and wheelies, and is more forgiving. Pro is the real thing.
- **Slow-mo** on big airs while you're tricking.
- **New zone — the Plaza:** raised granite deck, 7-stair with three handrails, banks, ledges, manual pad, flat bars, planters and a fountain.
- **A living city:** traffic that obeys the lights and gives way to you, people walking the pavements (they step out of your way), bunting, murals, billboards, autumn trees, flags.
- **Time of day:** day, sunset or night — at night streetlights, floodlights and your headlight light the world.
- **Collect S-E-N-D-I-T** letters hidden in hard-to-reach spots, and 14 **goals** to complete (progress is saved).

## Zones (keys 1–8 to warp)
1. **Street** — high street with traffic, kickers on the centre line, benches to grind.
2. **Skatepark** — quarter pipes, funbox with rail, kicker gap, ledges, flat bar.
3. **Dirt jumps** — two lines.
4. **Mega ramp** — 20 m roll-in, 30 m+ gap.
5. **Plaza** — stairs, handrails, ledges, banks.
6. **Hill Bomb** — downhill race with tabletops.
7. **Seafront** — bowl, promenade, pier send.
8. **Construction Yard** — bus jump, containers, big pipe.

## Controls
| Key | On the ground | In the air |
|---|---|---|
| W / S | ride / brake | frontflip / backflip (press again after take-off) |
| A / D | steer | spin |
| Space | hop (and hop off rails) | — |
| Shift | wheelie / manual · with S: stoppie / nose manual | trick (X-Up, Nac-Nac or Can-Can) |
| J K L I U O | — | tricks — shown on screen for your vehicle |

N radio station · Q vehicle · C camera · R reset · T chat (in a room) · H show/hide controls · M mute · Esc menu · F11 fullscreen. Gamepad works too.

## Run it
Needs Node.js (nodejs.org, LTS). In a terminal, in this folder:
1. `npm install`
2. `npm start`

## Build an installable app
- Mac: `npm run dist:mac` → `dist/Send It-1.4.0 (see dist/)`
- Windows: `npm run dist:win`

## Online and multiplayer notes
- Riding together is peer-to-peer: the host's game is the server, so there's nothing to pay for. Matchmaking uses the free public PeerJS service, with a free relay as a fallback for strict networks. Each player sees their own traffic and pedestrians.
- Accounts, friends, the server list, invites and leaderboards live in a Supabase database (the `si_` tables in the ReelRoom project). The game only talks to it through `si_` functions, and the tables can't be read directly. The SQL is in `server/`.
- Discord sign-in runs through the `si-discord` edge function (`server/si-discord/`). See `server/README.md` to switch it on.

## Files
- `website/` — the play-sendit.netlify.app site (Netlify publish directory)
- `server/` — the online backend (Supabase SQL + Discord edge function)
- `tools/make_manifest.py` — copies the game into `website/play` and writes the update manifest
- `main.js` — Electron window (serves the game from a local `app://` protocol)
- `index.html`, `style.css` — HUD and menus
- `src/game.js` — the whole game
- `vendor/` — Three.js (MIT), PeerJS (MIT) and fonts (OFL), bundled so it works offline
