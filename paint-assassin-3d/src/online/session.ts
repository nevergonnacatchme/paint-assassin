// OnlineSession: the glue between Socket.io and the 3D engine. It owns no UI; React subscribes to its state.
import type {
  ClientToServer, ServerToClient, RoomInfo, RoomState, ChatMsg, RoleAssigned, MeetingStarted, VoteUpdate,
  VoteTallied, RoundEnded, CreateRoomReq, JoinReq, JoinResult, RoomPhase,
} from '../net/protocol';
import type { GamePhase } from '../types';
import type { Game3D } from '../game/Game3D';
import { sounds } from '../sound';

/** Minimal socket surface (socket.io-client's Socket satisfies it; tests use a fake). */
export interface SocketLike {
  connected: boolean;
  emit(ev: string, ...args: unknown[]): unknown;
  on(ev: string, fn: (...args: never[]) => void): unknown;
  off(ev: string, fn?: (...args: never[]) => void): unknown;
  disconnect(): unknown;
}

export interface SessionState {
  conn: 'connecting' | 'online' | 'offline';
  rooms: RoomInfo[];
  room: RoomState | null;
  selfPid: number;
  chat: ChatMsg[];
  role: RoleAssigned | null;
  meeting: (MeetingStarted & { endsAt: number }) | null;
  votes: VoteUpdate | null;
  myVote: number | 'skip' | null;
  tally: VoteTallied | null;
  ended: RoundEnded | null;
  notice: { id: number; text: string; tone: 'info' | 'warn' | 'error' } | null;
  ping: number;
}

const PHASE_MAP: Record<RoomPhase, GamePhase> = {
  LOBBY: 'LOBBY', ROLE_REVEAL: 'ROLE_REVEAL', PLAYING: 'PLAYING', MEETING: 'MEETING', VOTE_REVEAL: 'VOTE_REVEAL', ENDED: 'GAME_OVER',
};

export class OnlineSession {
  state: SessionState = {
    conn: 'connecting', rooms: [], room: null, selfPid: -1, chat: [], role: null, meeting: null, votes: null,
    myVote: null, tally: null, ended: null, notice: null, ping: 0,
  };
  private listeners = new Set<(s: SessionState) => void>();
  private offs: (() => void)[] = [];
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private noticeSeq = 0;
  private disposed = false;

  constructor(private socket: SocketLike, private engine: Game3D | null) {
    engine?.attachNet({
      sendMove: (m) => this.emit('game:player_move', m),
      sendPaint: (origin, dir) => this.emit('game:shoot_paint', { origin, dir }),
      sendLethal: (targetId, dir) => this.emit('game:shoot_lethal', { targetId, dir }),
      sendReport: (bodyId) => this.emit('game:report_body', bodyId),
      sendButton: () => this.emit('game:emergency_button'),
    });
    this.listen('connect', () => {
      this.set({ conn: 'online' });
      this.emit('room:list_request');
      this.startPing();
    });
    this.listen('disconnect', () => {
      const wasInRoom = !!this.state.room;
      this.backToHub();
      this.set({ conn: 'offline' });
      if (wasInRoom) this.note('Lost connection to the server.', 'error');
    });
    this.listen('connect_error', () => this.set({ conn: 'offline' }));
    this.listen('room:list_update', (rooms) => this.set({ rooms }));
    this.listen('room:state', (room) => this.onRoomState(room));
    this.listen('room:kicked', (reason) => { this.backToHub(); this.note(reason, 'error'); });
    this.listen('room:error', (msg) => this.note(msg, 'warn'));
    this.listen('party:chat_message', (m) => {
      this.set({ chat: [...this.state.chat.slice(-99), m] });
      if (m.pid !== this.state.selfPid && !m.system) sounds.playMessage();
    });
    this.listen('role_assigned', (p) => {
      this.set({ role: p, meeting: null, votes: null, tally: null, ended: null, myVote: null });
      this.engine?.startOnline(p);
    });
    this.listen('game:snapshot', (s) => this.engine?.netSnapshot(s.players));
    this.listen('game:shoot_paint', (s) => this.engine?.netPaint(s.pid, s.origin, s.dir));
    this.listen('game:lethal_fx', (p) => this.engine?.netLethalFx(p.x, p.z));
    this.listen('game:lethal_result', (p) => {
      this.engine?.netLethalResult(p.ok, p.cooldown);
      if (!p.ok && p.reason && p.reason !== 'Missed.') this.note(p.reason, 'warn');
    });
    this.listen('game:player_killed', (p) => this.engine?.netKill(p.victimId, p.pos, p.dir));
    this.listen('game:player_left', (p) => { this.engine?.netRemove(p.pid); });
    this.listen('game:emergency_meeting_started', (m) => {
      if (!m.revote) this.engine?.netMeeting();
      this.set({ meeting: { ...m, endsAt: Date.now() + m.secondsLeft * 1000 }, votes: null, myVote: null, tally: null });
    });
    this.listen('game:vote_update', (v) => {
      const meeting = this.state.meeting ? { ...this.state.meeting, endsAt: Date.now() + v.secondsLeft * 1000 } : null;
      this.set({ votes: v, meeting });
    });
    this.listen('game:vote_tallied', (t) => {
      this.set({ tally: t });
      if (t.ejectedId !== null) this.engine?.ejectPlayer(t.ejectedId);
    });
    this.listen('game:round_resume', (r) => { this.engine?.netResume(r); this.set({ meeting: null, votes: null, tally: null, myVote: null }); });
    this.listen('game:correct', (p) => this.engine?.netCorrect(p.x, p.z));
    this.listen('game:round_ended', (r) => this.set({ ended: r, meeting: null, votes: null, tally: null }));
    if (socket.connected) { this.set({ conn: 'online' }); this.emit('room:list_request'); this.startPing(); }
  }

  // ------------------------------------------------------------------ plumbing

  subscribe(fn: (s: SessionState) => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  private set(patch: Partial<SessionState>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  private note(text: string, tone: 'info' | 'warn' | 'error' = 'info'): void { this.set({ notice: { id: ++this.noticeSeq, text, tone } }); }
  clearNotice(id: number): void { if (this.state.notice?.id === id) this.set({ notice: null }); }

  private emit<E extends keyof ClientToServer>(ev: E, ...args: Parameters<ClientToServer[E]>): void { this.socket.emit(ev, ...args); }

  private listen<E extends keyof ServerToClient | 'connect' | 'disconnect' | 'connect_error'>(
    ev: E, fn: E extends keyof ServerToClient ? ServerToClient[E] : () => void,
  ): void {
    const h = fn as unknown as (...args: never[]) => void;
    this.socket.on(ev, h);
    this.offs.push(() => { this.socket.off(ev, h); });
  }

  private startPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    const probe = () => {
      if (!this.socket.connected) return;
      this.socket.emit('net:ping', Date.now(), (t: number) => {
        const ms = Date.now() - t; this.set({ ping: ms }); this.emit('net:report_ping', ms);
      });
    };
    probe();
    this.pingTimer = setInterval(probe, 3000);
  }

  private request<R>(ev: 'room:create' | 'room:join' | 'room:quick_play', payload: unknown): Promise<R> {
    return new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => { if (!done) { done = true; resolve({ ok: false, code: 'INVALID', error: "The server didn't respond. Is it running?" } as R); } }, 8000);
      this.socket.emit(ev, payload, (r: R) => { if (done) return; done = true; clearTimeout(timer); resolve(r); });
    });
  }

  private onJoined(r: JoinResult): JoinResult {
    if (r.ok) { this.set({ room: r.room, selfPid: r.selfPid, chat: [], role: null, meeting: null, votes: null, tally: null, ended: null, myVote: null }); }
    return r;
  }

  private onRoomState(room: RoomState): void {
    const prev = this.state.room?.phase;
    const changed = prev !== room.phase;
    this.set({ room });
    if (!changed || !this.engine) return;
    if (room.phase === 'LOBBY') {
      if (prev && prev !== 'LOBBY') this.engine.resetToLobby();
      this.set({ role: null, meeting: null, votes: null, tally: null, ended: null, myVote: null });
      this.engine.setPhase('LOBBY');
    } else if (this.state.role) this.engine.setPhase(PHASE_MAP[room.phase]);
  }

  private backToHub(): void {
    const hadGame = !!this.state.role;
    this.set({ room: null, selfPid: -1, chat: [], role: null, meeting: null, votes: null, tally: null, ended: null, myVote: null });
    if (hadGame && this.engine) { this.engine.resetToLobby(); this.engine.setPhase('LOBBY'); }
  }

  // ------------------------------------------------------------------ actions (called by the UI)

  async create(req: CreateRoomReq): Promise<JoinResult> { return this.onJoined(await this.request<JoinResult>('room:create', req)); }
  async join(req: JoinReq): Promise<JoinResult> { return this.onJoined(await this.request<JoinResult>('room:join', req)); }
  async quickPlay(name: string): Promise<JoinResult> { return this.onJoined(await this.request<JoinResult>('room:quick_play', { name })); }
  leave(): void { this.emit('room:leave'); this.backToHub(); this.emit('room:list_request'); }
  refreshList(): void { this.emit('room:list_request'); }
  toggleReady(): void { this.emit('party:ready_toggle'); }
  selectColor(color: string): void { this.emit('party:color_select', color); }
  kick(pid: number): void { this.emit('room:kick', pid); }
  setPrivacy(isPrivate: boolean): void { this.emit('room:set_privacy', isPrivate); }
  sendChat(text: string): void { const t = text.trim(); if (t) this.emit('party:chat_message', t.slice(0, 200)); }
  start(): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => this.socket.emit('party:start_game', (r: { ok: boolean; error?: string }) => {
      if (!r.ok && r.error) this.note(r.error, 'warn');
      resolve(r);
    }));
  }
  vote(target: number | 'skip'): void {
    if (this.state.myVote !== null || !this.state.meeting) return;
    this.set({ myVote: target });
    this.emit('game:cast_vote', target);
    sounds.playVote();
  }

  dispose(): void {
    this.offs.forEach((f) => f()); this.offs = [];
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.engine?.attachNet(null);
    this.listeners.clear();
    this.disposed = true;
  }
}
