// Paint Assassin 3D server: Express + Socket.io on one port.
//   npm run dev   -> serves the React app through Vite (with hot reload) + multiplayer on http://localhost:3000
//   npm run build && npm start -> serves the production build from dist/
import express from 'express';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { RoomManager } from './server/RoomManager';
import type { Transport } from './server/RoomManager';
import { bindSocket } from './server/bind';
import type { ClientToServer, ServerToClient } from './src/net/protocol';

const PORT = Number(process.env.PORT) || 3000;
const PROD = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';
const root = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const http = createServer(app);
const io = new Server<ClientToServer, ServerToClient>(http, {
  destroyUpgrade: false, // let Vite's hot-reload websocket share this HTTP server
  pingInterval: 10_000,
  pingTimeout: 8_000,
});

// Socket.io's typed emit() doesn't accept a generic event name, so emit through a minimal untyped view.
type Emitter = { emit: (ev: string, ...args: unknown[]) => unknown };
const out = (target: unknown, ev: string, args: unknown[]) => { (target as Emitter).emit(ev, ...args); };
const transport: Transport = {
  toSocket: (sid, ev, ...args) => out(io.to(sid), ev, args),
  toRoom: (rid, ev, ...args) => out(io.to(rid), ev, args),
  toRoomExcept: (rid, except, ev, ...args) => out(io.to(rid).except(except), ev, args),
  toHub: (ev, ...args) => out(io.to('hub'), ev, args),
  join: (sid, ch) => { void io.sockets.sockets.get(sid)?.join(ch); },
  leave: (sid, ch) => { void io.sockets.sockets.get(sid)?.leave(ch); },
};
const rooms = new RoomManager(transport);

io.on('connection', (socket) => {
  bindSocket(rooms, socket.id, (ev, fn) => { socket.on(ev, fn as never); });
  socket.on('disconnect', () => { try { rooms.disconnect(socket.id); } catch (e) { console.error('[disconnect]', e); } });
});

setInterval(() => { try { rooms.tick(Date.now()); } catch (e) { console.error('[tick]', e); } }, 50);

async function main() {
  if (PROD) {
    const dist = path.join(root, 'dist');
    app.use(express.static(dist));
    app.get(/.*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else {
    const { createServer: createVite } = await import('vite');
    const vite = await createVite({
      server: { middlewareMode: true, allowedHosts: true, hmr: process.env.DISABLE_HMR === 'true' ? false : { server: http } }, // allowedHosts: tunnel URLs work
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }
  http.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  Paint Assassin 3D is running:  http://localhost:${PORT}`);
    console.log('  Friends on the same Wi-Fi can join at http://<your-computer-ip>:' + PORT + '\n');
  });
}
main().catch((e) => { console.error(e); process.exit(1); });
