// Authoritative multiplayer state: rooms, parties, matchmaking, roles, kills, bodies, meetings and votes.
// Pure logic: it talks to the network only through the Transport interface, and time is passed into tick(),
// so the whole game can be unit-tested without Socket.io.
import {
  MIN_PLAYERS, MAX_PLAYERS, KILL_COOLDOWN, FIRST_KILL_COOLDOWN, MEETING_COOLDOWN, VOTE_SECONDS, ROLE_REVEAL_MS,
  VOTE_REVEAL_MS, ENDED_MS, PALETTE, ringPositions,
} from '../src/net/protocol';
import type {
  ServerToClient, RoomPhase, RoomState, RoomInfo, RosterEntry, ChatMsg, CreateRoomReq, JoinReq, JoinResult,
  NetMove, Vec3, VoteTallied, RoundEnded, SnapEntry,
} from '../src/net/protocol';
import { makeArenaWorld } from '../src/game/layout';
import { PLAYER_R, EYE_Y, CHEST_Y, PLAYER_H, rayCylinder } from '../src/game/world';

type Ev = keyof ServerToClient;
type Args<E extends Ev> = Parameters<ServerToClient[E]>;

export interface Transport {
  toSocket<E extends Ev>(sid: string, ev: E, ...args: Args<E>): void;
  toRoom<E extends Ev>(roomId: string, ev: E, ...args: Args<E>): void;
  toRoomExcept<E extends Ev>(roomId: string, exceptSid: string, ev: E, ...args: Args<E>): void;
  toHub<E extends Ev>(ev: E, ...args: Args<E>): void; // sockets browsing rooms (not in a room)
  join(sid: string, channel: string): void;
  leave(sid: string, channel: string): void;
}

interface Member {
  sid: string; pid: number; name: string; color: string; ready: boolean; ping: number; joinedAt: number;
  inGame: boolean; alive: boolean; isAssassin: boolean;
  x: number; z: number; yaw: number; pitch: number; slot: 0 | 1; anim: 'idle' | 'walk';
  lastMoveAt: number; lastPaintAt: number; lastChatAt: number; killReadyAt: number;
}
interface Body { victimId: number; x: number; z: number }
interface Room {
  id: string; code: string; name: string; isPrivate: boolean; passcode: string; maxPlayers: number; assassinCount: 1 | 2;
  phase: RoomPhase; hostPid: number; members: Member[]; nextPid: number; createdAt: number;
  bodies: Body[]; phaseEndsAt: number; meetingReadyAt: number;
  votes: Map<number, number | 'skip'>; tieCount: number;
  after: { kind: 'resume' } | { kind: 'revote' } | { kind: 'end'; result: RoundEnded } | null;
  chatSeq: number; lastPingBroadcast: number;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LOBBY_CHANNEL = 'hub';
const clean = (s: unknown, max: number): string => (typeof s === 'string' ? s.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max) : '');
const finite = (...n: unknown[]): boolean => n.every((v) => typeof v === 'number' && Number.isFinite(v));

export class RoomManager {
  private rooms = new Map<string, Room>();
  private bySid = new Map<string, string>(); // socket id -> room id
  private world = makeArenaWorld();
  private seq = 0;
  private listDirty = false;
  private lastSnapshotAt = 0;

  constructor(private t: Transport, private now: () => number = Date.now, private rnd: () => number = Math.random) {}

  // ------------------------------------------------------------------ connection

  connect(sid: string): void { this.t.join(sid, LOBBY_CHANNEL); this.t.toSocket(sid, 'room:list_update', this.listRooms()); }
  disconnect(sid: string): void { this.leave(sid, 'disconnected'); this.t.leave(sid, LOBBY_CHANNEL); }

  // ------------------------------------------------------------------ rooms / matchmaking

  listRooms(): RoomInfo[] {
    return [...this.rooms.values()].filter((r) => !r.isPrivate).map((r) => ({
      id: r.id, name: r.name, hostName: this.host(r)?.name ?? '?', players: r.members.length, maxPlayers: r.maxPlayers,
      hasPasscode: !!r.passcode, phase: r.phase,
    })).sort((a, b) => b.players - a.players);
  }

  requestList(sid: string): void { this.t.toSocket(sid, 'room:list_update', this.listRooms()); }

  create(sid: string, req: CreateRoomReq): JoinResult {
    const name = clean(req?.name, 12) || 'Painter';
    this.leave(sid, 'left');
    const code = this.newCode();
    const r: Room = {
      id: `r${++this.seq}`, code, name: clean(req?.partyName, 32) || `${name}'s Party`, isPrivate: !!req?.isPrivate,
      passcode: clean(req?.passcode, 12), maxPlayers: Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, Math.floor(Number(req?.maxPlayers) || 10))),
      assassinCount: req?.assassinCount === 2 ? 2 : 1, phase: 'LOBBY', hostPid: 0, members: [], nextPid: 1, createdAt: this.now(),
      bodies: [], phaseEndsAt: 0, meetingReadyAt: 0, votes: new Map(), tieCount: 0, after: null, chatSeq: 0, lastPingBroadcast: 0,
    };
    this.rooms.set(r.id, r);
    const m = this.addMember(r, sid, name);
    r.hostPid = m.pid;
    this.afterJoin(r, m);
    return { ok: true, room: this.state(r), selfPid: m.pid };
  }

  join(sid: string, req: JoinReq): JoinResult {
    const name = clean(req?.name, 12) || 'Painter';
    let r: Room | undefined;
    if (req?.code) { const code = clean(req.code, 6).toUpperCase(); r = [...this.rooms.values()].find((x) => x.code === code); }
    else if (req?.roomId) { r = this.rooms.get(String(req.roomId)); if (r && r.isPrivate) r = undefined; }
    if (!r) return { ok: false, code: 'NOT_FOUND', error: 'Room not found. Check the code and try again.' };
    if (this.bySid.get(sid) === r.id) { const me = this.member(r, sid)!; return { ok: true, room: this.state(r), selfPid: me.pid }; }
    if (r.phase !== 'LOBBY') return { ok: false, code: 'IN_PROGRESS', error: 'That game is already in progress.' };
    if (r.members.length >= r.maxPlayers) return { ok: false, code: 'FULL', error: 'That room is full.' };
    if (r.passcode) {
      if (!req.passcode) return { ok: false, code: 'NEED_PASSCODE', error: 'This room needs a passcode.' };
      if (clean(req.passcode, 12) !== r.passcode) return { ok: false, code: 'BAD_PASSCODE', error: 'Wrong passcode.' };
    }
    this.leave(sid, 'left');
    const m = this.addMember(r, sid, name);
    this.afterJoin(r, m);
    return { ok: true, room: this.state(r), selfPid: m.pid };
  }

  quickPlay(sid: string, req: { name: string }): JoinResult {
    const current = this.bySid.get(sid);
    const open = [...this.rooms.values()]
      .filter((r) => !r.isPrivate && !r.passcode && r.phase === 'LOBBY' && r.members.length < r.maxPlayers && r.id !== current)
      .sort((a, b) => b.members.length - a.members.length || a.createdAt - b.createdAt);
    if (open.length) return this.join(sid, { name: req?.name, roomId: open[0].id });
    const name = clean(req?.name, 12) || 'Painter';
    return this.create(sid, { name, partyName: `${name}'s Room`, maxPlayers: 10, isPrivate: false, passcode: '', assassinCount: 1 });
  }

  leave(sid: string, why: 'left' | 'disconnected' | 'kicked'): void {
    const rid = this.bySid.get(sid); if (!rid) return;
    const r = this.rooms.get(rid); this.bySid.delete(sid);
    this.t.leave(sid, rid); this.t.join(sid, LOBBY_CHANNEL);
    if (!r) return;
    const m = this.member(r, sid); if (!m) return;
    r.members = r.members.filter((x) => x !== m);
    this.listDirty = true;
    if (!r.members.length) { this.rooms.delete(r.id); return; }
    if (r.hostPid === m.pid) { // host migration: the longest-connected player takes over
      const next = [...r.members].sort((a, b) => a.joinedAt - b.joinedAt)[0];
      r.hostPid = next.pid;
      this.system(r, `${m.name} ${why === 'kicked' ? 'was kicked' : 'left'}. ${next.name} is now the host.`);
    } else this.system(r, `${m.name} ${why === 'kicked' ? 'was kicked from the party' : why === 'disconnected' ? 'disconnected' : 'left the party'}.`);
    if (m.inGame && r.phase !== 'LOBBY' && r.phase !== 'ENDED') {
      this.t.toRoom(r.id, 'game:player_left', { pid: m.pid, name: m.name });
      r.bodies = r.bodies.filter((b) => b.victimId !== m.pid);
      r.votes.delete(m.pid);
      for (const [voter, target] of r.votes) if (target === m.pid) r.votes.delete(voter); // their votes are void
      if (!this.checkWin(r, m.isAssassin ? `${m.name} (the Assassin) left the game.` : undefined) && r.phase === 'MEETING') this.maybeTally(r);
    }
    this.broadcastState(r);
  }

  kick(sid: string, pid: number): void {
    const r = this.roomOf(sid); if (!r) return;
    const me = this.member(r, sid); if (!me || me.pid !== r.hostPid || pid === me.pid) return;
    const target = r.members.find((m) => m.pid === pid); if (!target) return;
    this.t.toSocket(target.sid, 'room:kicked', 'The host removed you from the party.');
    this.leave(target.sid, 'kicked');
  }

  setPrivacy(sid: string, isPrivate: boolean): void {
    const r = this.roomOf(sid); const me = r && this.member(r, sid);
    if (!r || !me || me.pid !== r.hostPid) return;
    r.isPrivate = !!isPrivate; this.listDirty = true;
    this.system(r, r.isPrivate ? 'The party is now private (join with the code).' : 'The party is now public.');
    this.broadcastState(r);
  }

  // ------------------------------------------------------------------ party room

  toggleReady(sid: string): void {
    const r = this.roomOf(sid); const m = r && this.member(r, sid);
    if (!r || !m || r.phase !== 'LOBBY') return;
    m.ready = !m.ready; this.broadcastState(r);
  }

  selectColor(sid: string, color: string): void {
    const r = this.roomOf(sid); const m = r && this.member(r, sid);
    if (!r || !m || r.phase !== 'LOBBY' || !PALETTE.includes(color)) return;
    if (r.members.some((o) => o !== m && o.color === color)) { this.t.toSocket(sid, 'room:error', 'That color is already taken.'); return; }
    m.color = color; this.broadcastState(r);
  }

  chat(sid: string, text: string): void {
    const r = this.roomOf(sid); const m = r && this.member(r, sid);
    const msg = clean(text, 200);
    if (!r || !m || !msg) return;
    const now = this.now();
    if (now - m.lastChatAt < 400) return; // spam guard
    m.lastChatAt = now;
    const ghost = r.phase !== 'LOBBY' && r.phase !== 'ENDED' && m.inGame && !m.alive;
    if (r.phase === 'PLAYING' && !ghost) return; // living painters can only talk in meetings
    const c: ChatMsg = { id: ++r.chatSeq, pid: m.pid, name: m.name, color: m.color, text: msg, ghost };
    if (ghost) { for (const o of r.members) if (!o.alive || !o.inGame) this.t.toSocket(o.sid, 'party:chat_message', c); }
    else this.t.toRoom(r.id, 'party:chat_message', c);
  }

  reportPing(sid: string, ms: number): void {
    const r = this.roomOf(sid); const m = r && this.member(r, sid);
    if (!r || !m || !finite(ms)) return;
    m.ping = Math.max(0, Math.min(9999, Math.round(ms)));
  }

  startGame(sid: string): { ok: boolean; error?: string } {
    const r = this.roomOf(sid); const me = r && this.member(r, sid);
    if (!r || !me) return { ok: false, error: 'You are not in a room.' };
    if (me.pid !== r.hostPid) return { ok: false, error: 'Only the host can start the game.' };
    if (r.phase !== 'LOBBY') return { ok: false, error: 'The game already started.' };
    if (r.members.length < MIN_PLAYERS) return { ok: false, error: `Need at least ${MIN_PLAYERS} players.` };
    if (r.members.some((m) => m.pid !== r.hostPid && !m.ready)) return { ok: false, error: 'Everyone must be ready.' };

    const now = this.now();
    const n = r.members.length;
    const count = r.assassinCount === 2 && n >= 10 ? 2 : 1;
    const order = r.members.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(this.rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const assassins = new Set(order.slice(0, count));
    const ring = ringPositions(n);
    r.members.forEach((m, i) => {
      Object.assign(m, {
        inGame: true, alive: true, isAssassin: assassins.has(i), x: ring[i].x, z: ring[i].z, yaw: ring[i].yaw, pitch: 0, slot: 0,
        anim: 'idle', lastMoveAt: now, lastPaintAt: 0, killReadyAt: now + FIRST_KILL_COOLDOWN * 1000,
      });
    });
    r.bodies = []; r.votes.clear(); r.tieCount = 0; r.after = null;
    r.meetingReadyAt = now + 10_000;
    r.phase = 'ROLE_REVEAL'; r.phaseEndsAt = now + ROLE_REVEAL_MS;
    const players = r.members.map((m) => ({ pid: m.pid, name: m.name, color: m.color, x: m.x, z: m.z, yaw: m.yaw }));
    const partners = r.members.filter((m) => m.isAssassin).map((m) => m.pid);
    for (const m of r.members) { // the role is sent privately to each socket
      this.t.toSocket(m.sid, 'role_assigned', {
        selfPid: m.pid, role: m.isAssassin ? 'assassin' : 'innocent', partners: m.isAssassin ? partners.filter((p) => p !== m.pid) : [],
        players, killCooldown: FIRST_KILL_COOLDOWN, meetingCooldown: 10,
      });
    }
    this.listDirty = true;
    this.broadcastState(r);
    return { ok: true };
  }

  // ------------------------------------------------------------------ gameplay

  move(sid: string, mv: NetMove): void {
    const r = this.roomOf(sid); const m = r && this.member(r, sid);
    if (!r || !m || r.phase !== 'PLAYING' || !m.alive || !mv || !finite(mv.x, mv.z, mv.rotY, mv.pitch)) return;
    const now = this.now();
    const dt = Math.min(1, Math.max(0.016, (now - m.lastMoveAt) / 1000));
    m.lastMoveAt = now;
    let x = mv.x, z = mv.z;
    const dx = x - m.x, dz = z - m.z, d = Math.hypot(dx, dz), maxStep = 7 * dt + 0.6; // speed check with lag allowance
    let corrected = false;
    if (d > maxStep) { x = m.x + (dx / d) * maxStep; z = m.z + (dz / d) * maxStep; corrected = true; }
    const p = { x, z }; this.world.resolve(p, PLAYER_R);
    if (Math.hypot(p.x - x, p.z - z) > 0.35) corrected = true;
    m.x = p.x; m.z = p.z; m.yaw = mv.rotY; m.pitch = Math.max(-1.5, Math.min(1.5, mv.pitch));
    m.slot = m.isAssassin && mv.slot === 1 ? 1 : 0;
    m.anim = mv.animState === 'walk' ? 'walk' : 'idle';
    if (corrected) this.t.toSocket(sid, 'game:correct', { x: m.x, z: m.z });
  }

  shootPaint(sid: string, s: { origin: Vec3; dir: Vec3 }): void {
    const r = this.roomOf(sid); const m = r && this.member(r, sid);
    if (!r || !m || r.phase !== 'PLAYING' || !m.alive || !s?.origin || !s?.dir) return;
    const { origin: o, dir: d } = s;
    if (!finite(o.x, o.y, o.z, d.x, d.y, d.z)) return;
    const now = this.now(); if (now - m.lastPaintAt < 120) return; // fire-rate limit
    m.lastPaintAt = now;
    if (Math.hypot(o.x - m.x, o.z - m.z) > 2.5 || o.y < 0 || o.y > 3) return; // must fire from your own position
    const l = Math.hypot(d.x, d.y, d.z); if (l < 1e-6) return;
    this.t.toRoomExcept(r.id, sid, 'game:shoot_paint', { pid: m.pid, origin: o, dir: { x: d.x / l, y: d.y / l, z: d.z / l }, color: m.color });
  }

  shootLethal(sid: string, s: { targetId: number | null; dir: Vec3 }): void {
    const r = this.roomOf(sid); const m = r && this.member(r, sid);
    if (!r || !m || r.phase !== 'PLAYING' || !m.alive) return;
    if (!m.isAssassin) { this.t.toSocket(sid, 'game:lethal_result', { ok: false, cooldown: 0, reason: 'Not armed.' }); return; }
    const now = this.now();
    if (now < m.killReadyAt) { this.t.toSocket(sid, 'game:lethal_result', { ok: false, cooldown: (m.killReadyAt - now) / 1000, reason: 'Reloading.' }); return; }
    m.killReadyAt = now + KILL_COOLDOWN * 1000; // any shot fired consumes the cooldown
    this.t.toRoomExcept(r.id, sid, 'game:lethal_fx', { x: m.x, z: m.z });
    const target = s && typeof s.targetId === 'number' ? r.members.find((o) => o.pid === s.targetId) : undefined;
    const d = s?.dir;
    let ok = false, reason = 'Missed.';
    if (target && target !== m && target.alive && target.inGame && d && finite(d.x, d.y, d.z)) {
      const dist = Math.hypot(target.x - m.x, target.z - m.z);
      const l = Math.hypot(d.x, d.y, d.z) || 1;
      const nx = d.x / l, ny = d.y / l, nz = d.z / l;
      // aim check against the target cylinder, inflated to absorb ~150ms of movement latency
      const hit = rayCylinder(m.x, EYE_Y, m.z, nx, ny, nz, target.x, target.z, PLAYER_R + 0.85, 0, PLAYER_H + 0.4);
      if (dist > 40) reason = 'Too far.';
      else if (!hit) reason = 'Missed.';
      else if (this.world.blocked(m.x, EYE_Y, m.z, target.x, CHEST_Y, target.z)) reason = 'Blocked by a wall.';
      else ok = true;
    }
    this.t.toSocket(sid, 'game:lethal_result', { ok, cooldown: KILL_COOLDOWN, reason: ok ? undefined : reason });
    if (ok && target) this.killMember(r, target, { x: target.x - m.x, z: target.z - m.z });
  }

  private killMember(r: Room, v: Member, dir: { x: number; z: number }): void {
    v.alive = false; v.slot = 0;
    const l = Math.hypot(dir.x, dir.z) || 1;
    r.bodies.push({ victimId: v.pid, x: v.x, z: v.z });
    this.t.toRoom(r.id, 'game:player_killed', { victimId: v.pid, pos: { x: v.x, z: v.z }, dir: { x: dir.x / l, z: dir.z / l } });
    this.checkWin(r);
    this.broadcastState(r);
  }

  report(sid: string, bodyId: number): void {
    const r = this.roomOf(sid); const m = r && this.member(r, sid);
    if (!r || !m || r.phase !== 'PLAYING' || !m.alive) return;
    const b = r.bodies.find((x) => x.victimId === bodyId);
    if (!b) return; // already reported / removed
    if (Math.hypot(b.x - m.x, b.z - m.z) > 5.5) return;
    const victim = r.members.find((x) => x.pid === bodyId);
    this.startMeeting(r, m, 'body', `${victim?.name ?? 'A painter'}'s fallen body was found by ${m.name}!`);
  }

  emergencyButton(sid: string): void {
    const r = this.roomOf(sid); const m = r && this.member(r, sid);
    if (!r || !m || r.phase !== 'PLAYING' || !m.alive) return;
    if (Math.hypot(m.x, m.z) > 4.8) return;
    if (this.now() < r.meetingReadyAt) { this.t.toSocket(sid, 'room:error', 'The Emergency button is recharging.'); return; }
    this.startMeeting(r, m, 'button', `${m.name} slammed the Emergency Meeting button!`);
  }

  private startMeeting(r: Room, reporter: Member, kind: 'body' | 'button', reason: string): void {
    r.bodies = []; // single-report rule: bodies are removed for good once a meeting is called
    r.phase = 'MEETING'; r.votes.clear(); r.tieCount = 0; r.after = null;
    r.phaseEndsAt = this.now() + VOTE_SECONDS * 1000;
    for (const m of r.members) m.slot = 0;
    this.t.toRoom(r.id, 'game:emergency_meeting_started', { reason, reporterPid: reporter.pid, kind, secondsLeft: VOTE_SECONDS, tieCount: 0, revote: false });
    this.system(r, `🚨 ${reason}`);
    this.broadcastState(r);
    this.sendVoteUpdate(r);
  }

  vote(sid: string, target: number | 'skip'): void {
    const r = this.roomOf(sid); const m = r && this.member(r, sid);
    if (!r || !m || r.phase !== 'MEETING' || !m.alive || !m.inGame || r.votes.has(m.pid)) return;
    if (target !== 'skip') {
      const t = r.members.find((x) => x.pid === target);
      if (!t || !t.alive || !t.inGame) return;
    }
    r.votes.set(m.pid, target);
    this.sendVoteUpdate(r);
    this.maybeTally(r);
  }

  private voters(r: Room): Member[] { return r.members.filter((m) => m.inGame && m.alive); }

  private counts(r: Room): { counts: Record<number, number>; skips: number } {
    const counts: Record<number, number> = {}; let skips = 0;
    for (const v of r.votes.values()) { if (v === 'skip') skips++; else counts[v] = (counts[v] || 0) + 1; }
    return { counts, skips };
  }

  private sendVoteUpdate(r: Room): void {
    const { counts, skips } = this.counts(r);
    this.t.toRoom(r.id, 'game:vote_update', {
      votedPids: [...r.votes.keys()], counts, skips, secondsLeft: Math.max(0, Math.ceil((r.phaseEndsAt - this.now()) / 1000)),
    });
  }

  private maybeTally(r: Room): void {
    if (r.phase === 'MEETING' && this.voters(r).every((m) => r.votes.has(m.pid))) this.tally(r);
  }

  private tally(r: Room): void {
    const { counts, skips } = this.counts(r);
    let max = 0, top: number | null = null, playerTie = false;
    for (const [k, c] of Object.entries(counts)) {
      if (c > max) { max = c; top = Number(k); playerTie = false; } else if (c === max && max > 0) playerTie = true;
    }
    const isTie = max > 0 && (playerTie || skips === max);
    const skipped = max === 0 || (!isTie && skips > max);
    const res: VoteTallied = { ejectedId: null, ejectedWasAssassin: false, isTie, tieCount: r.tieCount, deadlock: false, skipped, counts, skips };
    r.after = { kind: 'resume' };
    if (isTie) {
      r.tieCount++; res.tieCount = r.tieCount;
      if (r.tieCount >= 3) res.deadlock = true; else r.after = { kind: 'revote' };
    } else if (!skipped && top !== null) {
      const v = r.members.find((m) => m.pid === top);
      if (v) {
        v.alive = false; res.ejectedId = v.pid; res.ejectedWasAssassin = v.isAssassin;
        const result = this.winner(r, v.isAssassin ? `${v.name} was the Assassin and got voted out!` : undefined);
        if (result) r.after = { kind: 'end', result };
      }
    }
    r.phase = 'VOTE_REVEAL'; r.phaseEndsAt = this.now() + VOTE_REVEAL_MS;
    this.t.toRoom(r.id, 'game:vote_tallied', res);
    this.broadcastState(r);
  }

  /** Returns the round result if somebody has won (does not change state). */
  private winner(r: Room, reason?: string): RoundEnded | null {
    const ins = r.members.filter((m) => m.inGame);
    const assassinsAlive = ins.filter((m) => m.isAssassin && m.alive).length;
    const innocentsAlive = ins.filter((m) => !m.isAssassin && m.alive).length;
    const assassins = ins.filter((m) => m.isAssassin).map((m) => ({ pid: m.pid, name: m.name }));
    if (assassinsAlive === 0) return { winner: 'PAINTERS', reason: reason ?? 'Every Assassin has been caught!', assassins };
    if (innocentsAlive <= assassinsAlive) return { winner: 'ASSASSIN', reason: 'The Assassin eliminated the painters.', assassins };
    return null;
  }

  private checkWin(r: Room, reason?: string): boolean {
    const res = this.winner(r, reason);
    if (res) { this.endRound(r, res); return true; }
    return false;
  }

  private endRound(r: Room, res: RoundEnded): void {
    r.phase = 'ENDED'; r.phaseEndsAt = this.now() + ENDED_MS; r.bodies = []; r.after = null;
    this.t.toRoom(r.id, 'game:round_ended', res);
    this.listDirty = true;
    this.broadcastState(r);
  }

  private resume(r: Room): void {
    const now = this.now();
    const alive = r.members.filter((m) => m.inGame && m.alive);
    const ring = ringPositions(alive.length);
    alive.forEach((m, i) => { m.x = ring[i].x; m.z = ring[i].z; m.yaw = ring[i].yaw; m.slot = 0; m.lastMoveAt = now; if (m.isAssassin) m.killReadyAt = Math.max(m.killReadyAt, now + 8000); });
    r.bodies = []; r.phase = 'PLAYING'; r.meetingReadyAt = now + MEETING_COOLDOWN * 1000; r.after = null;
    const positions = alive.map((m) => ({ pid: m.pid, x: m.x, z: m.z }));
    for (const m of r.members) {
      this.t.toSocket(m.sid, 'game:round_resume', {
        positions, meetingCooldown: MEETING_COOLDOWN, killCooldown: m.isAssassin ? Math.max(0, (m.killReadyAt - now) / 1000) : 0,
      });
    }
    this.broadcastState(r);
  }

  private backToLobby(r: Room): void {
    r.phase = 'LOBBY'; r.bodies = []; r.votes.clear(); r.tieCount = 0; r.after = null;
    for (const m of r.members) Object.assign(m, { inGame: false, alive: true, isAssassin: false, ready: false, slot: 0 });
    this.listDirty = true;
    this.broadcastState(r);
  }

  // ------------------------------------------------------------------ timers (called every ~50ms)

  tick(now = this.now()): void {
    for (const r of [...this.rooms.values()]) {
      if (r.phaseEndsAt && now >= r.phaseEndsAt) {
        if (r.phase === 'ROLE_REVEAL') { r.phase = 'PLAYING'; r.phaseEndsAt = 0; this.broadcastState(r); }
        else if (r.phase === 'MEETING') this.tally(r);
        else if (r.phase === 'VOTE_REVEAL') {
          const a = r.after;
          if (a?.kind === 'revote') {
            r.votes.clear(); r.phase = 'MEETING'; r.phaseEndsAt = now + VOTE_SECONDS * 1000; r.after = null;
            this.t.toRoom(r.id, 'game:emergency_meeting_started', { reason: `Tie #${r.tieCount} of 3 — vote again!`, reporterPid: -1, kind: 'button', secondsLeft: VOTE_SECONDS, tieCount: r.tieCount, revote: true });
            this.broadcastState(r); this.sendVoteUpdate(r);
          } else if (a?.kind === 'end') this.endRound(r, a.result);
          else this.resume(r);
        } else if (r.phase === 'ENDED') { r.phaseEndsAt = 0; this.backToLobby(r); }
      }
      if (r.phase === 'MEETING' && now - r.lastPingBroadcast > 1000) { r.lastPingBroadcast = now; this.sendVoteUpdate(r); }
      else if (r.phase === 'LOBBY' && now - r.lastPingBroadcast > 3000) { r.lastPingBroadcast = now; this.broadcastState(r); } // refresh pings
    }
    if (now - this.lastSnapshotAt >= 45) {
      this.lastSnapshotAt = now;
      for (const r of this.rooms.values()) {
        if (r.phase !== 'PLAYING' && r.phase !== 'ROLE_REVEAL') continue;
        const players: SnapEntry[] = r.members.filter((m) => m.inGame && m.alive)
          .map((m) => ({ pid: m.pid, x: m.x, z: m.z, rotY: m.yaw, pitch: m.pitch, slot: m.slot, animState: m.anim }));
        this.t.toRoom(r.id, 'game:snapshot', { players });
      }
    }
    if (this.listDirty) { this.listDirty = false; this.t.toHub('room:list_update', this.listRooms()); }
  }

  // ------------------------------------------------------------------ helpers

  private addMember(r: Room, sid: string, name: string): Member {
    let n = name, k = 2;
    while (r.members.some((m) => m.name.toLowerCase() === n.toLowerCase())) n = `${name.slice(0, 10)}${k++}`;
    const color = PALETTE.find((c) => !r.members.some((m) => m.color === c)) ?? PALETTE[0];
    const m: Member = {
      sid, pid: r.nextPid++, name: n, color, ready: false, ping: 0, joinedAt: this.now() + r.members.length * 1e-3,
      inGame: false, alive: true, isAssassin: false, x: 0, z: 0, yaw: 0, pitch: 0, slot: 0, anim: 'idle',
      lastMoveAt: 0, lastPaintAt: 0, lastChatAt: 0, killReadyAt: 0,
    };
    r.members.push(m);
    this.bySid.set(sid, r.id);
    this.t.leave(sid, LOBBY_CHANNEL); this.t.join(sid, r.id);
    return m;
  }

  private afterJoin(r: Room, m: Member): void {
    this.listDirty = true;
    this.system(r, `${m.name} joined the party.`);
    this.broadcastState(r);
  }

  private newCode(): string {
    for (;;) {
      let c = ''; for (let i = 0; i < 6; i++) c += CODE_CHARS[Math.floor(this.rnd() * CODE_CHARS.length)];
      if (![...this.rooms.values()].some((r) => r.code === c)) return c;
    }
  }

  private system(r: Room, text: string): void {
    this.t.toRoom(r.id, 'party:chat_message', { id: ++r.chatSeq, pid: -1, name: 'SYSTEM', color: '#7c83fd', text, system: true });
  }

  private roomOf(sid: string): Room | undefined { const id = this.bySid.get(sid); return id ? this.rooms.get(id) : undefined; }
  private member(r: Room, sid: string): Member | undefined { return r.members.find((m) => m.sid === sid); }
  private host(r: Room): Member | undefined { return r.members.find((m) => m.pid === r.hostPid); }

  state(r: Room): RoomState {
    const roster: RosterEntry[] = r.members.map((m) => ({
      pid: m.pid, name: m.name, color: m.color, ready: m.ready || m.pid === r.hostPid, isHost: m.pid === r.hostPid, ping: m.ping,
      alive: m.alive, inGame: m.inGame,
    }));
    return { id: r.id, code: r.code, name: r.name, isPrivate: r.isPrivate, hasPasscode: !!r.passcode, maxPlayers: r.maxPlayers, assassinCount: r.assassinCount, phase: r.phase, hostPid: r.hostPid, roster };
  }

  private broadcastState(r: Room): void { if (this.rooms.has(r.id)) this.t.toRoom(r.id, 'room:state', this.state(r)); }

  /** Test / debug helper */
  debugRoom(id: string): Room | undefined { return this.rooms.get(id); }
}
