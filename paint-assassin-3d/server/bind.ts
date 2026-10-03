// Maps every client -> server Socket.io event onto the RoomManager. Shared by server.ts and the tests.
import type { RoomManager } from './RoomManager';
import type { ClientToServer } from '../src/net/protocol';

export type OnFn = <E extends keyof ClientToServer>(ev: E, fn: ClientToServer[E]) => void;

/** A malformed payload (or a missing ack callback) must never crash the server. */
const guard = (fn: () => void): void => { try { fn(); } catch (e) { console.error('[socket handler]', e); } };

export function bindSocket(rooms: RoomManager, sid: string, on: OnFn): void {
  rooms.connect(sid);
  on('room:create', (req, ack) => guard(() => ack(rooms.create(sid, req))));
  on('room:join', (req, ack) => guard(() => ack(rooms.join(sid, req))));
  on('room:quick_play', (req, ack) => guard(() => ack(rooms.quickPlay(sid, req))));
  on('room:leave', () => guard(() => rooms.leave(sid, 'left')));
  on('room:list_request', () => guard(() => rooms.requestList(sid)));
  on('room:kick', (pid) => guard(() => rooms.kick(sid, Number(pid))));
  on('room:set_privacy', (p) => guard(() => rooms.setPrivacy(sid, !!p)));
  on('party:ready_toggle', () => guard(() => rooms.toggleReady(sid)));
  on('party:color_select', (c) => guard(() => rooms.selectColor(sid, String(c))));
  on('party:start_game', (ack) => guard(() => ack(rooms.startGame(sid))));
  on('party:chat_message', (text) => guard(() => rooms.chat(sid, text)));
  on('net:ping', (t, ack) => guard(() => ack(t)));
  on('net:report_ping', (ms) => guard(() => rooms.reportPing(sid, ms)));
  on('game:player_move', (m) => guard(() => rooms.move(sid, m)));
  on('game:shoot_paint', (s) => guard(() => rooms.shootPaint(sid, s)));
  on('game:shoot_lethal', (s) => guard(() => rooms.shootLethal(sid, s)));
  on('game:report_body', (id) => guard(() => rooms.report(sid, Number(id))));
  on('game:emergency_button', () => guard(() => rooms.emergencyButton(sid)));
  on('game:cast_vote', (t) => guard(() => rooms.vote(sid, t === 'skip' ? 'skip' : Number(t))));
}
