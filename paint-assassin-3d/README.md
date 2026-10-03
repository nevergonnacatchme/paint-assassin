# Paint Assassin 3D — solo + online multiplayer

First-person 3D social-deduction paintball. Everyone carries a paintgun; one painter secretly also has a lethal pistol.
Play solo against bots, or online with friends (party rooms, server browser, private codes, Quick Play).
All models, textures and sounds are procedural (Three.js geometry, canvas textures, Web Audio) — no asset files.

## Run it (Windows / Mac / Linux)
1. Install Node.js LTS from nodejs.org.
2. Open a terminal in this folder (the one with `package.json`).
3. `npm install`
4. `npm run dev`
5. Open **http://localhost:3000**

`npm run dev` starts ONE server that serves the game *and* the multiplayer backend.

## Playing online
- Click **Play Online with Friends** in the solo lobby.
- **Testing alone:** open 4 browser tabs at http://localhost:3000 — each tab is a separate player.
- **Friends on the same Wi-Fi:** they open `http://YOUR-IP:3000` (find YOUR-IP with `ipconfig` on Windows, look for "IPv4 Address"). Allow Node.js through the Windows firewall when asked.
- **Friends over the internet:** the server must be reachable publicly — deploy this folder to a Node host (e.g. Render or Railway: build `npm install && npm run build`, start `npm start`), or use a tunnel such as `npx localtunnel --port 3000`.
- A game needs at least 4 players, all ready (the host is ready automatically).

## Phones & tablets
Touch controls appear automatically on touch screens: left thumb = floating joystick, right thumb = drag to look,
big PAINT/SHOOT button = fire (drag it to aim while shooting), 🎨/💀 = hotbar (Assassin), 🚨 Report / 🔴 Meeting appear when nearby,
⏸ pauses. Landscape works best. Graphics are automatically lightened on phones.

## Put it online (free, permanent link) — Render
1. Make a free account at github.com -> "New repository" (name it paint-assassin) -> "uploading an existing file".
   Drag in everything from this folder **except `node_modules`** and commit.
2. Make a free account at render.com (sign in with GitHub) -> New -> **Web Service** -> pick the repo.
3. Build command: `npm install && npm run build` · Start command: `npm start` · Instance type: Free -> Create.
4. After a few minutes you get a link like `https://paint-assassin.onrender.com` — share it; invite links work too.
Free Render servers sleep after ~15 minutes without players; the first visit then takes ~1 minute to wake up.
(`render.yaml` is included, so "New -> Blueprint" also works.)

Quick temporary alternative (your PC stays the server): install cloudflared (`winget install --id Cloudflare.cloudflared`),
run `npm run dev` in one window and `cloudflared tunnel --url http://localhost:3000` in another, then share the
`https://….trycloudflare.com` link it prints. It stops working when you close the windows.

## Controls
| Key | Action |
| --- | --- |
| W A S D / arrows | move |
| Mouse | look (click to capture the mouse) |
| Left click | fire the active weapon |
| 1 / 2 or wheel | switch hotbar slot (Assassin only) |
| E | report a body (look at it, within 4 m) / press the central Emergency button |
| M | mute · Esc pause (online: the round keeps going!) |

## Scripts
- `npm run dev` — game + multiplayer server with hot reload (port 3000)
- `npm run build` then `npm start` — production build served by the same server
- `npm run dev:solo` — front-end only (solo works, online won't connect)

## Layout
- `server.ts` — Express + Socket.io + Vite middleware (one port)
- `server/RoomManager.ts` — authoritative rooms, parties, matchmaking, roles, kill validation, bodies, meetings, votes, 3-tie rule, host migration
- `server/bind.ts` — Socket.io event → RoomManager bindings
- `src/net/protocol.ts` — typed Socket.io events + shared constants
- `src/online/` — `session.ts` (socket ↔ engine glue), `Hub.tsx`, `PartyRoom.tsx`, `OnlineMeeting.tsx`, `OnlineApp.tsx`
- `src/App.tsx` — solo mode (bots) · `src/Root.tsx` — solo/online switch (invite links `?code=XXXXXX` open online mode)
- `src/game/` — Three.js engine (`Game3D.ts`), shared arena layout (`layout.ts`), collision (`world.ts`), models, viewmodel, FX
