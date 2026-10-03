// Shared Socket.io protocol for Paint Assassin 3D (imported by both server.ts and the React client).

export const MIN_PLAYERS = 4; // players (all ready) needed before the host can start
export const MAX_PLAYERS = 12;
export const KILL_COOLDOWN = 18; // seconds (spec: 15-20s)
export const FIRST_KILL_COOLDOWN = 10;
export const MEETING_COOLDOWN = 15;
export const VOTE_SECONDS = 45;
export const ROLE_REVEAL_MS = 3000;
export const VOTE_REVEAL_MS = 5000;
export const ENDED_MS = 9000;
export const SPAWN_RING = 7;

export const PALETTE = [
  '#ff8fab', '#4fd1b5', '#ffb38a', '#6fb8ff', '#ffd166', '#b39ddb',
  '#ff7b7b', '#8fd98a', '#f7a8d8', '#5aa9ff', '#f4b942', '#9b8bd6',
];

export type RoomPhase = 'LOBBY' | 'ROLE_REVEAL' | 'PLAYING' | 'MEETING' | 'VOTE_REVEAL' | 'ENDED';
export type AnimState = 'idle' | 'walk';

export interface Vec3 { x: number; y: number; z: number }

export interface RosterEntry {
  pid: number; name: string; color: string; ready: boolean; isHost: boolean; ping: number;
  alive: boolean; inGame: boolean;
}

/** Room card shown in the server browser (public rooms only). */
export interface RoomInfo {
  id: string; name: string; hostName: string; players: number; maxPlayers: number;
  hasPasscode: boolean; phase: RoomPhase;
}

export interface RoomState {
  id: string; code: string; name: string; isPrivate: boolean; hasPasscode: boolean;
  maxPlayers: number; assassinCount: 1 | 2; phase: RoomPhase; hostPid: number; roster: RosterEntry[];
}

export interface ChatMsg { id: number; pid: number; name: string; color: string; text: string; ghost?: boolean; system?: boolean }

export interface CreateRoomReq { name: string; partyName: string; maxPlayers: number; isPrivate: boolean; passcode: string; assassinCount: 1 | 2 }
export interface JoinReq { name: string; code?: string; roomId?: string; passcode?: string }
export type JoinErrorCode = 'NOT_FOUND' | 'FULL' | 'IN_PROGRESS' | 'NEED_PASSCODE' | 'BAD_PASSCODE' | 'INVALID';
export type JoinResult = { ok: true; room: RoomState; selfPid: number } | { ok: false; error: string; code: JoinErrorCode };

export interface StartPlayer { pid: number; name: string; color: string; x: number; z: number; yaw: number }
export interface RoleAssigned {
  selfPid: number; role: 'assassin' | 'innocent'; partners: number[]; players: StartPlayer[];
  killCooldown: number; meetingCooldown: number;
}

export interface NetMove { x: number; y: number; z: number; rotY: number; pitch: number; slot: 0 | 1; animState: AnimState }
export interface SnapEntry { pid: number; x: number; z: number; rotY: number; pitch: number; slot: 0 | 1; animState: AnimState }

export interface MeetingStarted { reason: string; reporterPid: number; kind: 'body' | 'button'; secondsLeft: number; tieCount: number; revote: boolean }
export interface VoteUpdate { votedPids: number[]; counts: Record<number, number>; skips: number; secondsLeft: number }
export interface VoteTallied {
  ejectedId: number | null; ejectedWasAssassin: boolean; isTie: boolean; tieCount: number; deadlock: boolean; skipped: boolean;
  counts: Record<number, number>; skips: number;
}
export interface RoundResume { positions: { pid: number; x: number; z: number }[]; meetingCooldown: number; killCooldown: number }
export interface RoundEnded { winner: 'PAINTERS' | 'ASSASSIN'; reason: string; assassins: { pid: number; name: string }[] }

export interface ClientToServer {
  'room:create': (req: CreateRoomReq, ack: (r: JoinResult) => void) => void;
  'room:join': (req: JoinReq, ack: (r: JoinResult) => void) => void;
  'room:quick_play': (req: { name: string }, ack: (r: JoinResult) => void) => void;
  'room:leave': () => void;
  'room:list_request': () => void;
  'room:kick': (pid: number) => void;
  'room:set_privacy': (isPrivate: boolean) => void;
  'party:ready_toggle': () => void;
  'party:color_select': (color: string) => void;
  'party:start_game': (ack: (r: { ok: boolean; error?: string }) => void) => void;
  'party:chat_message': (text: string) => void;
  'net:ping': (t: number, ack: (t: number) => void) => void;
  'net:report_ping': (ms: number) => void;
  'game:player_move': (m: NetMove) => void;
  'game:shoot_paint': (s: { origin: Vec3; dir: Vec3 }) => void;
  'game:shoot_lethal': (s: { targetId: number | null; dir: Vec3 }) => void;
  'game:report_body': (bodyId: number) => void;
  'game:emergency_button': () => void;
  'game:cast_vote': (target: number | 'skip') => void;
}

export interface ServerToClient {
  'room:list_update': (rooms: RoomInfo[]) => void;
  'room:state': (s: RoomState) => void;
  'room:kicked': (reason: string) => void;
  'room:error': (msg: string) => void;
  'party:chat_message': (m: ChatMsg) => void;
  'role_assigned': (p: RoleAssigned) => void;
  'game:snapshot': (s: { players: SnapEntry[] }) => void;
  'game:shoot_paint': (s: { pid: number; origin: Vec3; dir: Vec3; color: string }) => void;
  'game:lethal_fx': (p: { x: number; z: number }) => void;
  'game:lethal_result': (p: { ok: boolean; cooldown: number; reason?: string }) => void;
  'game:player_killed': (p: { victimId: number; pos: { x: number; z: number }; dir: { x: number; z: number } }) => void;
  'game:player_left': (p: { pid: number; name: string }) => void;
  'game:emergency_meeting_started': (m: MeetingStarted) => void;
  'game:vote_update': (v: VoteUpdate) => void;
  'game:vote_tallied': (t: VoteTallied) => void;
  'game:round_resume': (p: RoundResume) => void;
  'game:correct': (p: { x: number; z: number }) => void;
  'game:round_ended': (r: RoundEnded) => void;
}

/** Ring of spawn points around the central table (same formula on server and client). */
export function ringPositions(count: number, radius = SPAWN_RING): { x: number; z: number; yaw: number }[] {
  const out: { x: number; z: number; yaw: number }[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + 0.3;
    const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
    out.push({ x, z, yaw: Math.atan2(x, z) }); // faces the centre (yaw 0 looks toward -z)
  }
  return out;
}
