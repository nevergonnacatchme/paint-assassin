export type GamePhase = 'LOBBY' | 'ROLE_REVEAL' | 'PLAYING' | 'MEETING' | 'VOTE_REVEAL' | 'GAME_OVER';
export type RolePref = 'random' | 'assassin' | 'innocent';

export type BotState = 'ROAM' | 'LOOK' | 'PRACTICE' | 'SHOCK' | 'FLEE' | 'STALK' | 'ATTACK' | 'ESCAPE';

/** Per-bot AI memory (state machine) */
export interface BotBrain {
  state: BotState;
  timer: number; // generic state timer
  think: number; // perception tick
  tx: number; tz: number; // current movement / aim target
  targetId: number | null; // assassin victim
  bodyId: number | null; // body being reacted to
  stuck: number;
  burst: number; // remaining paint shots in a "practice" burst
  equipT: number; // weapon equip / hold timer
}

export interface SeenRecord { t: number; zone: string }

export interface Player {
  id: number;
  name: string;
  color: string; // css hex
  isHuman: boolean;
  isAssassin: boolean;
  isAlive: boolean;
  // 3D simulation (x east, z south, yaw 0 faces north / -z)
  x: number; z: number; vx: number; vz: number;
  yaw: number; pitch: number; speed: number;
  activeSlot: 0 | 1; // 0 = paintgun, 1 = lethal pistol (assassin only)
  shootCd: number;
  killCooldown: number; // seconds until the lethal pistol is ready
  // social-deduction memory (used for banter + bot voting)
  witnessedKillerId: number | null;
  witnessTimer: number;
  suspicion: Record<number, number>;
  seen: Record<number, SeenRecord>;
  // death info
  isReported: boolean;
  bodyRemoved: boolean;
  diedAt: number;
  brain: BotBrain | null;
}

export interface ChatMessage {
  senderId: number;
  senderName: string;
  senderColor: string;
  text: string;
}

export interface VoteRecord {
  voterId: number;
  targetId: number | null; // null = skip
}

export interface GameConfig {
  playerCount: number;
  humanName: string;
  humanColor: string;
  rolePref: RolePref;
}

export interface HudState {
  role: 'assassin' | 'innocent';
  activeSlot: 0 | 1;
  killCooldown: number;
  killCooldownMax: number;
  nearBody: boolean;
  nearButton: boolean;
  buttonCooldown: number;
  humanAlive: boolean;
  aliveCount: number;
  totalCount: number;
  locked: boolean;
}

export interface MeetingInfo {
  reason: string;
  reporterId: number;
  reporterName: string;
  kind: 'body' | 'button';
}

/** Outgoing network hooks used by the engine in online mode (wired to Socket.io by the online session). */
export interface NetHooks {
  sendMove(m: { x: number; y: number; z: number; rotY: number; pitch: number; slot: 0 | 1; animState: 'idle' | 'walk' }): void;
  sendPaint(origin: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }): void;
  sendLethal(targetId: number | null, dir: { x: number; y: number; z: number }): void;
  sendReport(bodyId: number): void;
  sendButton(): void;
}

export interface EngineCallbacks {
  onHud(h: HudState): void;
  onHit(kind: 'hit' | 'kill'): void;
  onToast(text: string, tone: 'info' | 'kill' | 'warn'): void;
  onMeeting(info: MeetingInfo): void;
  onGameOver(r: { winner: 'assassin' | 'painters' }): void;
  onLockChange(locked: boolean): void;
}
