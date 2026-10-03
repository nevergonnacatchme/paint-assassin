// Paint Assassin 3D engine: Three.js renderer + first-person controls + simulation + bot AI.
// React owns the UI/voting; this class owns everything inside the 3D canvas and reports through callbacks.
import * as THREE from 'three';
import { sounds } from '../sound';
import {
  World, EYE_Y, CHEST_Y, PLAYER_R, PLAYER_H, fwdOf, yawTo, angDiff, rayCylinder, zoneName,
} from './world';
import type { RayHit } from './world';
import { buildArena } from './arena';
import type { ArenaHandles } from './arena';
import {
  buildCharacter, animateRig, setExpression, setHeld, knockOut, disposeObject, HeadshotStudio,
} from './models';
import type { CharacterRig } from './models';
import { DecalSystem, ParticleSystem } from './fx';
import { ViewModel } from './viewmodel';
import { makeSplatTexture } from './textures';
import type { Player, GameConfig, GamePhase, HudState, EngineCallbacks, BotBrain, NetHooks } from '../types';
import { PALETTE } from '../net/protocol';
import type { RoleAssigned, SnapEntry, RoundResume } from '../net/protocol';

export const KILL_CD = 18; // lethal pistol cooldown (spec: 15-20s)
const FIRST_KILL_CD = 10;
const MEETING_CD = 15;
const REPORT_RANGE = 4;
const BUTTON_RANGE = 4.2;
const PELLET_SPEED = 42;
const RING = 7; // respawn ring radius after a meeting
const BOT_NAMES = ['Mint', 'Peach', 'Sky', 'Lemon', 'Lilac', 'Coral', 'Sage', 'Rose', 'Ocean', 'Honey', 'Plum'];
export const COLORS = PALETTE;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const rnd = Math.random;

interface Snap { t: number; x: number; z: number; yaw: number; pitch: number; slot: 0 | 1; moving: boolean }
const INTERP_DELAY = 110; // ms of buffering for smooth remote movement

interface Pellet {
  mesh: THREE.Mesh; x: number; y: number; z: number; vx: number; vy: number; vz: number;
  life: number; shooterId: number; color: THREE.Color;
}

export class Game3D {
  players: Player[] = [];
  phase: GamePhase = 'LOBBY';
  time = 0;

  private host: HTMLElement;
  private cb: EngineCallbacks;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private world = new World();
  private arena: ArenaHandles;
  private decals: DecalSystem;
  private particles: ParticleSystem;
  private poolTex: THREE.Texture;
  private pelletGeo = new THREE.SphereGeometry(0.075, 10, 8);
  private pellets: Pellet[] = [];
  private pelletPool: THREE.Mesh[] = [];
  private vm: ViewModel | null = null;
  private studio: HeadshotStudio | null = null;
  private rigs = new Map<number, CharacterRig>();
  private demo: CharacterRig[] = [];
  private human: Player | null = null;

  private keys = new Set<string>();
  private mouseDown = false; private mouseEdge = false; private mdx = 0; private mdy = 0;
  private locked = false;
  private camMode: 'orbit' | 'fp' | 'spectate' = 'orbit';
  private orbitAngle = 0;
  private lookTarget = new THREE.Vector3(0, 1, 0);
  private camBob = 0; private camKick = 0;
  private meetingCd = 0; private hudT = 0; private lastHud = ''; private alarm = false; private pendingOver = -1;
  private raf = 0; private lastT = 0; private disposed = false;
  private ro: ResizeObserver | null = null;
  private tmpV = new THREE.Vector3(); private tmpV2 = new THREE.Vector3();
  // ---- online mode
  online = false;
  private net: NetHooks | null = null;
  private netSendT = 0;
  private remote = new Map<number, Snap[]>();
  // ---- touch / mobile
  touchMode = false;
  private touchMove = { x: 0, y: 0 }; // analog stick: x = strafe right, y = forward (-1..1)

  constructor(host: HTMLElement, cb: EngineCallbacks) {
    this.host = host; this.cb = cb;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.autoClear = false;
    this.renderer.setClearColor('#e9e4ff');
    const cv = this.renderer.domElement;
    cv.style.cssText = 'display:block;width:100%;height:100%;outline:none';
    cv.addEventListener('contextmenu', this.onContext);
    host.appendChild(cv);

    this.scene.background = new THREE.Color('#e9e4ff');
    this.camera = new THREE.PerspectiveCamera(75, 1, 0.05, 120);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.arena = buildArena(this.scene, this.world);
    this.decals = new DecalSystem(this.scene);
    this.particles = new ParticleSystem(this.scene);
    this.poolTex = makeSplatTexture(9);

    this.resize();
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(host);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    document.addEventListener('pointerlockchange', this.onLockChange);

    this.spawnDemo();
    this.snapOrbit();
    this.raf = requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------ input

  private onContext = (e: Event) => e.preventDefault();
  private typing(e: Event): boolean { const t = e.target as HTMLElement | null; return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'); }
  private onKeyDown = (e: KeyboardEvent) => {
    if (this.typing(e)) return;
    if (this.locked && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    this.keys.add(e.code);
    if (e.repeat || this.phase !== 'PLAYING' || !this.locked) return;
    if (e.code === 'KeyE') this.interact();
    else if (e.code === 'Digit1') this.switchSlot(0);
    else if (e.code === 'Digit2') this.switchSlot(1);
  };
  private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(e.code); };
  private onBlur = () => { this.keys.clear(); this.mouseDown = false; };
  private onMouseMove = (e: MouseEvent) => { if (this.locked) { this.mdx += e.movementX; this.mdy += e.movementY; } };
  private onMouseDown = (e: MouseEvent) => { if (this.touchMode) return; if (e.button === 0 && this.locked) { this.mouseDown = true; this.mouseEdge = true; } };
  private onMouseUp = (e: MouseEvent) => { if (e.button === 0) this.mouseDown = false; };
  private onWheel = (e: WheelEvent) => {
    const h = this.human;
    if (!this.locked || this.phase !== 'PLAYING' || !h || !h.isAssassin || !h.isAlive) return;
    this.switchSlot(h.activeSlot === 0 ? 1 : 0, e.deltaY);
  };
  private onLockChange = () => {
    this.locked = document.pointerLockElement === this.renderer.domElement;
    if (!this.locked) this.mouseDown = false;
    this.cb.onLockChange(this.locked);
  };

  requestLock(): void {
    if (this.touchMode) { // phones have no pointer lock: "capturing" just means the touch controls are live
      if (!this.locked) { this.locked = true; this.cb.onLockChange(true); }
      try { const r: unknown = document.documentElement.requestFullscreen?.(); if (r instanceof Promise) r.catch(() => {}); } catch { /* optional */ }
      return;
    }
    try {
      const r: unknown = this.renderer.domElement.requestPointerLock();
      if (r instanceof Promise) r.catch(() => {});
    } catch { /* ignore: user can click again */ }
  }
  exitLock(): void {
    if (this.touchMode) { if (this.locked) { this.locked = false; this.touchMove.x = this.touchMove.y = 0; this.mouseDown = false; this.cb.onLockChange(false); } return; }
    if (document.pointerLockElement === this.renderer.domElement) document.exitPointerLock();
  }

  // ------------------------------------------------------------------ touch controls API (mobile)

  /** Enable touch controls + lighter rendering for phones/tablets. */
  setTouchMode(on: boolean): void {
    this.touchMode = on;
    if (on) {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      this.scene.traverse((o) => {
        const l = o as THREE.DirectionalLight;
        if (l.isDirectionalLight && l.castShadow) { l.shadow.mapSize.set(1024, 1024); l.shadow.map?.dispose(); l.shadow.map = null; }
      });
      this.resize();
    }
  }
  /** Virtual joystick: x = strafe (-1 left .. 1 right), y = forward (-1 back .. 1 forward). */
  setTouchMove(x: number, y: number): void { this.touchMove.x = clamp(x, -1, 1); this.touchMove.y = clamp(y, -1, 1); }
  /** Drag-to-look, in screen pixels. */
  addLook(dx: number, dy: number): void { if (this.locked) { this.mdx += dx * 2.4; this.mdy += dy * 2.4; } }
  /** Fire button held / released. */
  setFire(down: boolean): void { if (!this.locked) { this.mouseDown = false; return; } this.mouseDown = down; if (down) this.mouseEdge = true; }
  /** Report body / emergency button. */
  pressInteract(): void { if (this.locked) this.interact(); }
  /** Hotbar tap (assassin only). */
  selectSlot(i: 0 | 1): void { this.switchSlot(i); }

  private resize(): void {
    const w = Math.max(1, this.host.clientWidth), h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.vm) this.vm.resize(w / h);
  }

  // ------------------------------------------------------------------ public API (used by React)

  /** Called by React whenever the UI phase changes. */
  setPhase(p: GamePhase): void {
    this.phase = p;
    if (p !== 'PLAYING') this.mouseDown = false;
    if (p === 'LOBBY' || p === 'MEETING' || p === 'VOTE_REVEAL' || p === 'GAME_OVER') {
      this.camMode = p === 'LOBBY' ? 'orbit' : 'orbit';
      if (p !== 'MEETING') this.alarm = false;
      this.exitLock();
    } else if (this.human) {
      this.camMode = this.human.isAlive ? 'fp' : 'spectate';
    }
    this.emitHud(true);
  }

  getTime(): number { return this.time; }

  getHeadshot(id: number, dead: boolean): string {
    const p = this.players.find((q) => q.id === id);
    if (!p) return '';
    if (!this.studio) this.studio = new HeadshotStudio(144);
    return this.studio.snap(id, p.color, dead);
  }

  /** Connect outgoing network hooks (online mode). */
  attachNet(hooks: NetHooks | null): void { this.net = hooks; }

  /** Start an online round from the server's role assignment. Remote players are driven by snapshots. */
  startOnline(p: RoleAssigned): void {
    this.clearRound(); this.clearDemo();
    if (this.studio) { this.studio.dispose(); this.studio = null; }
    this.online = true; this.remote.clear(); this.netSendT = 0;
    for (const sp of p.players) {
      const isHuman = sp.pid === p.selfPid;
      const pl = this.makePlayer(sp.pid, sp.name, sp.color, isHuman, isHuman && p.role === 'assassin');
      pl.brain = null; pl.x = sp.x; pl.z = sp.z; pl.yaw = sp.yaw;
      this.players.push(pl);
      const rig = buildCharacter(sp.color, sp.name, !isHuman);
      // fellow assassins (2-assassin rooms) see each other's name tag in red
      if (rig.tag && p.partners.includes(sp.pid)) { const m = rig.tag.material as THREE.SpriteMaterial; m.color.set('#ffb3c1'); }
      this.scene.add(rig.root); this.rigs.set(sp.pid, rig);
      if (!isHuman) this.remote.set(sp.pid, [{ t: performance.now(), x: sp.x, z: sp.z, yaw: sp.yaw, pitch: 0, slot: 0, moving: false }]);
    }
    this.human = this.players.find((q) => q.isHuman) ?? null;
    if (!this.human) return;
    this.human.killCooldown = p.role === 'assassin' ? p.killCooldown : 0;
    this.vm = new ViewModel(this.human.color, this.human.color);
    this.vm.resize(this.camera.aspect);
    this.meetingCd = p.meetingCooldown; this.pendingOver = -1; this.alarm = false; this.lastHud = '';
    this.camMode = 'fp'; this.camBob = 0; this.camKick = 0;
    this.phase = 'ROLE_REVEAL';
    this.updateCamera(0.016, true);
    this.requestLock();
    this.emitHud(true);
  }

  /** Server snapshot of the other players (20 Hz). */
  netSnapshot(list: SnapEntry[]): void {
    const now = performance.now();
    for (const s of list) {
      if (this.human && s.pid === this.human.id) continue;
      const buf = this.remote.get(s.pid); if (!buf) continue;
      buf.push({ t: now, x: s.x, z: s.z, yaw: s.rotY, pitch: s.pitch, slot: s.slot, moving: s.animState === 'walk' });
      if (buf.length > 30) buf.splice(0, buf.length - 30);
    }
  }

  /** Paint shot fired by another client: same pellet, same splats, on every screen. */
  netPaint(pid: number, origin: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }): void {
    const p = this.players.find((q) => q.id === pid); if (!p || !p.isAlive || this.phase !== 'PLAYING') return;
    this.spawnPellet(new THREE.Vector3(origin.x, origin.y, origin.z), new THREE.Vector3(dir.x, dir.y, dir.z), p, 0);
    const rig = this.rigs.get(pid); if (rig) rig.recoil = 1;
    sounds.playShoot(false, this.vol(origin.x, origin.z) * 0.8);
  }

  /** Suppressed lethal shot heard somewhere in the arena. */
  netLethalFx(x: number, z: number): void { sounds.playShoot(true, this.vol(x, z)); }

  /** Server's verdict on our lethal shot (authoritative cooldown). */
  netLethalResult(ok: boolean, cooldown: number): void {
    const h = this.human; if (!h) return;
    h.killCooldown = cooldown;
    if (ok) this.cb.onHit('kill');
    this.emitHud(true);
  }

  netKill(victimId: number, pos: { x: number; z: number }, dir: { x: number; z: number }): void {
    const v = this.players.find((q) => q.id === victimId); if (!v || !v.isAlive) return;
    v.x = pos.x; v.z = pos.z;
    const rig = this.rigs.get(v.id); if (rig) rig.root.position.set(pos.x, 0, pos.z);
    this.killVisuals(v, new THREE.Vector3(dir.x, 0, dir.z).normalize());
    this.cb.onToast(v.isHuman ? 'You were eliminated! You are now a ghost.' : `${v.name} was eliminated`, 'warn');
    this.emitHud(true);
  }

  /** A player disconnected mid-round: they vanish (no body). */
  netRemove(pid: number): void {
    const p = this.players.find((q) => q.id === pid); if (!p) return;
    p.isAlive = false; p.bodyRemoved = true; p.isReported = true;
    const rig = this.rigs.get(pid); if (rig) { this.disposeRig(rig); this.rigs.delete(pid); }
    this.remote.delete(pid);
    this.emitHud(true);
  }

  /** Emergency meeting started by the server. */
  netMeeting(): void {
    this.phase = 'MEETING'; this.alarm = true; this.mouseDown = false;
    for (const p of this.players) if (!p.isAlive && !p.bodyRemoved) this.removeBody(p);
    for (const p of this.players) p.activeSlot = 0;
    this.clearPellets();
    this.gather(4.4);
    this.camMode = 'orbit';
    this.exitLock();
    sounds.playAlarm();
  }

  /** Meeting over: teleport to the server's spawn ring. */
  netResume(r: RoundResume): void {
    this.alarm = false;
    for (const p of this.players) if (!p.isAlive && !p.bodyRemoved) this.removeBody(p);
    const now = performance.now();
    for (const pos of r.positions) {
      const p = this.players.find((q) => q.id === pos.pid); if (!p || !p.isAlive) continue;
      p.x = pos.x; p.z = pos.z; p.vx = p.vz = 0; p.yaw = yawTo(-p.x, -p.z); p.pitch = 0; p.activeSlot = 0;
      if (!p.isHuman) this.remote.set(p.id, [{ t: now, x: p.x, z: p.z, yaw: p.yaw, pitch: 0, slot: 0, moving: false }]);
    }
    if (this.human) { this.human.killCooldown = r.killCooldown; this.vm?.setSlot(0); }
    this.meetingCd = r.meetingCooldown;
    this.clearPellets();
    const h = this.human;
    this.camMode = h && h.isAlive ? 'fp' : 'spectate';
    this.updateCamera(0.016, true);
  }

  /** Server rejected our position (speed / collision): snap back. */
  netCorrect(x: number, z: number): void { const h = this.human; if (h) { h.x = x; h.z = z; h.vx = h.vz = 0; } }

  private interpRemote(p: Player, now: number, dt: number): void {
    const buf = this.remote.get(p.id); if (!buf || !buf.length) return;
    const rt = now - INTERP_DELAY;
    while (buf.length > 2 && buf[1].t <= rt) buf.shift();
    let x: number, z: number, yaw: number, pitch: number;
    const a = buf[0], b = buf[1];
    if (b && rt > a.t) {
      const k = clamp((rt - a.t) / Math.max(1, b.t - a.t), 0, 1);
      x = a.x + (b.x - a.x) * k; z = a.z + (b.z - a.z) * k;
      yaw = a.yaw + angDiff(a.yaw, b.yaw) * k; pitch = a.pitch + (b.pitch - a.pitch) * k;
      p.activeSlot = k < 0.5 ? a.slot : b.slot;
    } else { x = a.x; z = a.z; yaw = a.yaw; pitch = a.pitch; p.activeSlot = a.slot; }
    if (dt > 0) { p.vx = (x - p.x) / dt; p.vz = (z - p.z) / dt; }
    const last = buf[buf.length - 1];
    if (!last.moving && Math.hypot(p.vx, p.vz) < 0.3) { p.vx = 0; p.vz = 0; }
    p.x = x; p.z = z; p.yaw = yaw; p.pitch = pitch;
  }

  /** Portrait for a colour (party-room cards), rendered with the same bean model. */
  getAvatar(color: string): string {
    if (!this.studio) this.studio = new HeadshotStudio(144);
    return this.studio.snap(-1, color, false);
  }

  /** Start a brand-new round. Must be called from a user gesture so pointer lock can be granted. */
  startRound(cfg: GameConfig): void {
    this.clearRound(); this.clearDemo();
    if (this.studio) { this.studio.dispose(); this.studio = null; }
    this.online = false; this.remote.clear();
    const n = clamp(cfg.playerCount, 4, 12);
    const assassinIdx = cfg.rolePref === 'assassin' ? 0 : cfg.rolePref === 'innocent' ? 1 + Math.floor(rnd() * (n - 1)) : Math.floor(rnd() * n);
    const avail = COLORS.filter((c) => c !== cfg.humanColor);
    for (let i = 0; i < n; i++) {
      const isHuman = i === 0;
      const name = isHuman ? (cfg.humanName.trim() || 'Painter') : (BOT_NAMES[i - 1] || `Bot ${i}`);
      const color = isHuman ? cfg.humanColor : (avail[i - 1] || COLORS[i % COLORS.length]);
      const p = this.makePlayer(i, name, color, isHuman, i === assassinIdx);
      this.players.push(p);
      const rig = buildCharacter(color, name, !isHuman);
      this.scene.add(rig.root); this.rigs.set(i, rig);
    }
    this.human = this.players[0];
    this.gather(RING);
    this.human.pitch = 0;
    this.vm = new ViewModel(this.human.color, this.human.color);
    this.vm.resize(this.camera.aspect);
    for (const p of this.players) if (p.isAssassin) p.killCooldown = FIRST_KILL_CD;
    this.meetingCd = 10; this.pendingOver = -1; this.alarm = false; this.lastHud = '';
    this.camMode = 'fp'; this.camBob = 0; this.camKick = 0;
    this.phase = 'ROLE_REVEAL';
    this.updateCamera(0.016, true);
    this.requestLock();
    this.emitHud(true);
  }

  /** Back to the attract-mode lobby scene. */
  resetToLobby(): void {
    this.clearRound(); this.spawnDemo(); this.online = false; this.remote.clear(); this.phase = 'LOBBY'; this.camMode = 'orbit'; this.alarm = false;
    this.human = null; this.lastHud = '';
  }

  /** Remove a voted-out player (no body is left behind). */
  ejectPlayer(id: number): void {
    const p = this.players.find((q) => q.id === id); if (!p) return;
    p.isAlive = false; p.bodyRemoved = true; p.isReported = true;
    const rig = this.rigs.get(id);
    if (rig) { rig.ejecting = 0.001; rig.root.visible = true; this.particles.burst({ x: p.x, y: 1.2, z: p.z }, new THREE.Color(p.color), 30, 5, 1.2); }
  }

  /** Called when the meeting is over and the round resumes. */
  endMeeting(): void {
    this.alarm = false;
    for (const p of this.players) {
      if (!p.isAlive && !p.bodyRemoved) this.removeBody(p);
      if (p.isAssassin && p.isAlive) p.killCooldown = Math.max(p.killCooldown, 8);
      p.witnessedKillerId = null;
    }
    this.gather(RING);
    this.meetingCd = MEETING_CD;
    this.clearPellets();
    const h = this.human;
    this.camMode = h && h.isAlive ? 'fp' : 'spectate';
    this.updateCamera(0.016, true);
  }

  // ------------------------------------------------------------------ setup helpers

  private makePlayer(id: number, name: string, color: string, isHuman: boolean, isAssassin: boolean): Player {
    const brain: BotBrain | null = isHuman ? null : { state: 'ROAM', timer: 1 + rnd() * 2, think: rnd(), tx: 0, tz: 0, targetId: null, bodyId: null, stuck: 0, burst: 0, equipT: 0 };
    return {
      id, name, color, isHuman, isAssassin, isAlive: true, x: 0, z: 0, vx: 0, vz: 0, yaw: 0, pitch: 0,
      speed: isHuman ? 5.0 : 3.4 + rnd() * 0.7, activeSlot: 0, shootCd: rnd() * 0.5, killCooldown: 0,
      witnessedKillerId: null, witnessTimer: 0, suspicion: {}, seen: {}, isReported: false, bodyRemoved: false, diedAt: 0, brain,
    };
  }

  /** Put every living player on a ring facing the table and reset their AI. */
  private gather(radius: number): void {
    const alive = this.players.filter((p) => p.isAlive);
    alive.forEach((p, i) => {
      const a = (i / alive.length) * Math.PI * 2 + 0.3;
      p.x = Math.cos(a) * radius; p.z = Math.sin(a) * radius; p.vx = p.vz = 0;
      p.yaw = yawTo(-p.x, -p.z); p.pitch = 0; p.activeSlot = 0;
      if (p.brain) { p.brain.state = 'ROAM'; p.brain.timer = rnd() * 0.8; p.brain.targetId = null; p.brain.bodyId = null; p.brain.stuck = 0; }
      const rig = this.rigs.get(p.id);
      if (rig) { setExpression(rig, 'normal'); setHeld(rig, 0); rig.speed = 0; }
    });
  }

  private spawnDemo(): void {
    this.clearDemo();
    const n = 8;
    for (let i = 0; i < n; i++) {
      const rig = buildCharacter(COLORS[i], '', false);
      const a = (i / n) * Math.PI * 2, r = 5.2;
      rig.root.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      rig.root.rotation.y = yawTo(-Math.cos(a), -Math.sin(a));
      this.scene.add(rig.root); this.demo.push(rig);
    }
  }
  private clearDemo(): void { for (const r of this.demo) { this.scene.remove(r.root); disposeObject(r.root); } this.demo = []; }

  private clearRound(): void {
    for (const r of this.rigs.values()) this.disposeRig(r);
    this.rigs.clear(); this.players = []; this.human = null;
    this.clearPellets(); this.decals.clear(); this.particles.clear();
    if (this.vm) { this.vm.dispose(); this.vm = null; }
  }
  private disposeRig(r: CharacterRig): void {
    this.scene.remove(r.root); disposeObject(r.root);
    if (r.pool) { this.scene.remove(r.pool); disposeObject(r.pool); r.pool = null; }
  }
  private clearPellets(): void { for (const p of this.pellets) { p.mesh.visible = false; this.pelletPool.push(p.mesh); } this.pellets = []; }

  private removeBody(p: Player): void {
    p.bodyRemoved = true; p.isReported = true;
    const r = this.rigs.get(p.id);
    if (r) { this.disposeRig(r); this.rigs.delete(p.id); }
  }

  // ------------------------------------------------------------------ main loop

  private loop = (t: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, Math.max(0, (t - this.lastT) / 1000)); this.lastT = t;
    try { this.tick(dt); } catch (e) { console.error(e); }
  };

  private tick(dt: number): void {
    this.time += dt;
    const h = this.human;
    const simulating = this.phase === 'PLAYING' && (this.online || this.locked || (!!h && !h.isAlive));
    this.arena.update(dt, this.time, this.alarm);
    if (simulating) this.simulate(dt);
    this.updateRigs(dt);
    this.particles.update(dt);
    this.updateCamera(dt, false);
    const showVm = !!this.vm && !!h && h.isAlive && this.camMode === 'fp' && (this.phase === 'PLAYING' || this.phase === 'ROLE_REVEAL');
    if (showVm && this.vm && h) this.vm.update(dt, Math.hypot(h.vx, h.vz), this.mdx, this.mdy);
    this.mdx = this.mdy = 0; this.mouseEdge = false;
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (showVm && this.vm) this.vm.render(this.renderer);
  }

  // ------------------------------------------------------------------ simulation

  private simulate(dt: number): void {
    const h = this.human!;
    for (const p of this.players) {
      if (p.killCooldown > 0) p.killCooldown = Math.max(0, p.killCooldown - dt);
      p.shootCd = Math.max(0, p.shootCd - dt);
      if (p.witnessTimer > 0) { p.witnessTimer -= dt; if (p.witnessTimer <= 0) p.witnessedKillerId = null; }
    }
    if (this.meetingCd > 0) this.meetingCd -= dt;
    if (h.isAlive) this.updateHuman(dt);
    if (this.online) {
      const now = performance.now();
      for (const p of this.players) if (p.isAlive && !p.isHuman) this.interpRemote(p, now, dt);
      this.netSendT -= dt;
      if (h.isAlive && this.net && this.netSendT <= 0) { // client -> server state at 20 Hz
        this.netSendT = 0.05;
        this.net.sendMove({ x: h.x, y: 0, z: h.z, rotY: h.yaw, pitch: h.pitch, slot: h.activeSlot, animState: Math.hypot(h.vx, h.vz) > 0.4 ? 'walk' : 'idle' });
      }
    } else {
      for (const p of this.players) { if (this.phase !== 'PLAYING') break; if (p.isAlive && p.brain) this.updateBot(p, dt); }
    }
    this.separate();
    this.updatePellets(dt);
    if (this.pendingOver >= 0) {
      this.pendingOver -= dt;
      if (this.pendingOver < 0) { this.pendingOver = -1; this.exitLock(); this.cb.onGameOver({ winner: 'assassin' }); }
    }
    this.hudT -= dt;
    if (this.hudT <= 0) { this.hudT = 0.1; this.emitHud(false); }
  }

  private key(...codes: string[]): boolean { return codes.some((c) => this.keys.has(c)); }

  private updateHuman(dt: number): void {
    const h = this.human!;
    h.yaw -= this.mdx * 0.0022;
    h.pitch = clamp(h.pitch - this.mdy * 0.0022, -1.45, 1.45);
    const active = this.locked;
    const f = active ? clamp((this.key('KeyW', 'ArrowUp') ? 1 : 0) - (this.key('KeyS', 'ArrowDown') ? 1 : 0) + this.touchMove.y, -1, 1) : 0;
    const r = active ? clamp((this.key('KeyD', 'ArrowRight') ? 1 : 0) - (this.key('KeyA', 'ArrowLeft') ? 1 : 0) + this.touchMove.x, -1, 1) : 0;
    const len = Math.hypot(f, r);
    const norm = Math.max(1, len); // keys -> full speed; joystick -> analog speed
    const [fx, fz] = fwdOf(h.yaw); const rx = Math.cos(h.yaw), rz = -Math.sin(h.yaw);
    let tvx = 0, tvz = 0;
    if (len > 0.08) { tvx = ((fx * f + rx * r) / norm) * h.speed; tvz = ((fz * f + rz * r) / norm) * h.speed; }
    const k = Math.min(1, dt * (len > 0.08 ? 9 : 12)); // acceleration / friction
    h.vx += (tvx - h.vx) * k; h.vz += (tvz - h.vz) * k;
    h.x += h.vx * dt; h.z += h.vz * dt;
    this.world.resolve(h, PLAYER_R);
    this.camBob += dt * Math.hypot(h.vx, h.vz) * 1.7;

    const ready = (!this.vm || this.vm.ready) && active;
    if (h.activeSlot === 0) {
      if (this.mouseDown && h.shootCd <= 0 && ready) this.humanPaint();
    } else if (h.isAssassin && this.mouseEdge && ready) {
      if (h.killCooldown <= 0) this.humanLethal(); else sounds.playClick();
    }
  }

  private camBasis(): { o: THREE.Vector3; fwd: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3 } {
    const q = this.camera.quaternion;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    return { o: this.camera.position.clone(), fwd, right, up };
  }

  private humanPaint(): void {
    const h = this.human!; const { o, fwd, right, up } = this.camBasis();
    const hit = this.world.raycast(o.x, o.y, o.z, fwd.x, fwd.y, fwd.z, 40);
    const aim = o.clone().addScaledVector(fwd, hit ? hit.t : 40);
    const muzzle = o.clone().addScaledVector(right, 0.2).addScaledVector(up, -0.13).addScaledVector(fwd, 0.55);
    const dir = aim.sub(muzzle).normalize();
    const finalDir = this.spawnPellet(muzzle, dir, h, 0.012);
    if (this.online && this.net) this.net.sendPaint({ x: muzzle.x, y: muzzle.y, z: muzzle.z }, { x: finalDir.x, y: finalDir.y, z: finalDir.z });
    h.shootCd = 0.17; this.vm?.kick(1); this.camKick += 0.006;
    sounds.playShoot(false, 0.9);
  }

  private humanLethal(): void {
    const h = this.human!; const { o, fwd } = this.camBasis();
    h.killCooldown = KILL_CD;
    this.vm?.kick(0.7); this.camKick += 0.02;
    this.fireLethal(h, o.x, o.y, o.z, fwd.x, fwd.y, fwd.z);
  }

  /** Hitscan lethal shot (suppressed): kills the first player hit unless a wall is in the way. */
  private fireLethal(shooter: Player, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number): void {
    sounds.playShoot(true, this.vol(shooter.x, shooter.z));
    let best: RayHit | null = this.world.raycast(ox, oy, oz, dx, dy, dz, 60);
    let tBest = best ? best.t : 60; let victim: Player | null = null;
    for (const p of this.players) {
      if (!p.isAlive || p === shooter) continue;
      const hit = rayCylinder(ox, oy, oz, dx, dy, dz, p.x, p.z, PLAYER_R + 0.1, 0, PLAYER_H);
      if (hit && hit.t < tBest) { tBest = hit.t; victim = p; best = { ...hit, kind: 'player' }; }
    }
    if (this.online) { // server validates and broadcasts the kill
      if (shooter.isHuman && this.net) this.net.sendLethal(victim ? victim.id : null, { x: dx, y: dy, z: dz });
      if (!victim && best) this.particles.burst({ x: ox + dx * tBest, y: oy + dy * tBest, z: oz + dz * tBest }, new THREE.Color('#9aa0b4'), 6, 2.5, 0.8);
      return;
    }
    if (victim) { this.killPlayer(victim, shooter, new THREE.Vector3(dx, 0, dz).normalize()); if (shooter.isHuman) this.cb.onHit('kill'); }
    else if (best) this.particles.burst({ x: ox + dx * tBest, y: oy + dy * tBest, z: oz + dz * tBest }, new THREE.Color('#9aa0b4'), 6, 2.5, 0.8);
  }

  private spawnPellet(origin: THREE.Vector3, dir: THREE.Vector3, shooter: Player, spread: number): THREE.Vector3 {
    const mesh = this.pelletPool.pop() ?? new THREE.Mesh(this.pelletGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }));
    if (!mesh.parent) this.scene.add(mesh);
    const color = new THREE.Color(shooter.color);
    (mesh.material as THREE.MeshBasicMaterial).color.copy(color);
    mesh.visible = true; mesh.position.copy(origin);
    const d = dir.clone(); d.x += (rnd() - 0.5) * spread; d.y += (rnd() - 0.5) * spread; d.z += (rnd() - 0.5) * spread; d.normalize();
    this.pellets.push({ mesh, x: origin.x, y: origin.y, z: origin.z, vx: d.x * PELLET_SPEED, vy: d.y * PELLET_SPEED, vz: d.z * PELLET_SPEED, life: 1.6, shooterId: shooter.id, color });
    return d;
  }

  private recycle(p: Pellet): void { p.life = -1; p.mesh.visible = false; this.pelletPool.push(p.mesh); }

  private updatePellets(dt: number): void {
    for (let i = this.pellets.length - 1; i >= 0; i--) {
      const p = this.pellets[i];
      p.vy -= 5 * dt;
      const dx = p.vx * dt, dy = p.vy * dt, dz = p.vz * dt, len = Math.hypot(dx, dy, dz);
      if (len < 1e-6) continue;
      const nx = dx / len, ny = dy / len, nz = dz / len;
      let tBest = len; let wall: RayHit | null = null; let victim: Player | null = null;
      const sh = this.world.raycast(p.x, p.y, p.z, nx, ny, nz, len);
      if (sh) { tBest = sh.t; wall = sh; }
      for (const pl of this.players) {
        if (!pl.isAlive || pl.id === p.shooterId) continue;
        const hit = rayCylinder(p.x, p.y, p.z, nx, ny, nz, pl.x, pl.z, PLAYER_R + 0.06, 0, PLAYER_H);
        if (hit && hit.t < tBest) { tBest = hit.t; victim = pl; wall = null; }
      }
      if (victim) {
        const pos = { x: p.x + nx * tBest, y: p.y + ny * tBest, z: p.z + nz * tBest };
        this.particles.burst(pos, p.color, 14, 4, 1);
        const rig = this.rigs.get(victim.id); if (rig) rig.flinch = 1;
        sounds.playSplat(this.vol(pos.x, pos.z));
        if (p.shooterId === this.human?.id) { this.cb.onHit('hit'); sounds.playHit(); }
        this.recycle(p); this.pellets.splice(i, 1);
      } else if (wall) {
        const pos = { x: p.x + nx * tBest, y: p.y + ny * tBest, z: p.z + nz * tBest };
        this.decals.add(pos, { x: wall.nx, y: wall.ny, z: wall.nz }, p.color, 0.8 + rnd() * 0.9);
        this.particles.burst(pos, p.color, 9, 3.2, 1);
        sounds.playSplat(this.vol(pos.x, pos.z) * 0.7);
        this.recycle(p); this.pellets.splice(i, 1);
      } else {
        p.x += dx; p.y += dy; p.z += dz; p.life -= dt;
        p.mesh.position.set(p.x, p.y, p.z);
        if (p.life <= 0) { this.recycle(p); this.pellets.splice(i, 1); }
      }
    }
  }

  /** Volume 0..1 by distance to the listener. */
  private vol(x: number, z: number): number {
    const c = this.camera.position;
    return clamp(1 - Math.hypot(x - c.x, z - c.z) / 34, 0.05, 1);
  }

  private separate(): void {
    const a = this.players;
    for (let i = 0; i < a.length; i++) {
      if (!a[i].isAlive) continue;
      for (let j = i + 1; j < a.length; j++) {
        if (!a[j].isAlive) continue;
        const dx = a[j].x - a[i].x, dz = a[j].z - a[i].z, d = Math.hypot(dx, dz), min = PLAYER_R * 2;
        if (d < min && d > 1e-4) {
          if (this.online) { // never fight the network: only the local player is pushed
            const me = a[i].isHuman ? a[i] : a[j].isHuman ? a[j] : null; if (!me) continue;
            const s = me === a[i] ? -1 : 1, push = min - d;
            me.x += (dx / d) * push * s; me.z += (dz / d) * push * s; this.world.resolve(me, PLAYER_R);
            continue;
          }
          const push = (min - d) / 2, nx = dx / d, nz = dz / d;
          a[i].x -= nx * push; a[i].z -= nz * push; a[j].x += nx * push; a[j].z += nz * push;
          this.world.resolve(a[i], PLAYER_R); this.world.resolve(a[j], PLAYER_R);
        }
      }
    }
  }

  private switchSlot(slot: number, wheelDir = 0): void {
    const h = this.human; if (!h || !h.isAlive || !h.isAssassin) return;
    let s = slot; if (wheelDir !== 0) s = h.activeSlot === 0 ? 1 : 0;
    if (s !== 0 && s !== 1) return;
    if (h.activeSlot === s) return;
    h.activeSlot = s as 0 | 1; this.vm?.setSlot(s); sounds.playSwitch(); this.emitHud(true);
  }

  // ------------------------------------------------------------------ kills, bodies, meetings

  private killPlayer(victim: Player, killer: Player, dir: THREE.Vector3): void {
    this.killVisuals(victim, dir);
    this.cb.onToast(killer.isHuman ? `You eliminated ${victim.name}` : victim.isHuman ? 'You were eliminated!' : `${victim.name} was eliminated`, killer.isHuman ? 'kill' : 'warn');
    this.witnessKill(victim, killer);
  }

  /** Knock-out ragdoll, paint pool, burst and sounds (shared by solo and online). */
  private killVisuals(victim: Player, dir: THREE.Vector3): void {
    victim.isAlive = false; victim.diedAt = this.time; victim.vx = victim.vz = 0;
    const rig = this.rigs.get(victim.id);
    const col = new THREE.Color(victim.color);
    if (rig) {
      rig.root.visible = true; knockOut(rig, dir.x * 4.4, dir.z * 4.4);
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: this.poolTex, color: col, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
      pool.rotation.x = -Math.PI / 2; pool.position.set(victim.x + dir.x * 1.1, 0.03, victim.z + dir.z * 1.1);
      pool.scale.setScalar(0.01); pool.userData.t = 0; pool.userData.pool = true; this.scene.add(pool); rig.pool = pool;
    }
    this.particles.burst({ x: victim.x, y: 0.9, z: victim.z }, col, 42, 6.5, 1.3);
    const v = this.vol(victim.x, victim.z);
    sounds.playKill(v); sounds.playChime(v * 0.8);
    if (victim.isHuman) this.camMode = 'spectate';
  }

  /** Solo only: bots that saw the kill remember the killer; check the assassin win. */
  private witnessKill(victim: Player, killer: Player): void {

    // Witnesses: bots that see the kill remember the killer and panic
    for (const b of this.players) {
      if (!b.isAlive || b === killer || !b.brain) continue;
      const sawVictim = this.canSee(b, victim.x, victim.z, 0.4, -0.1);
      const sawKiller = this.canSee(b, killer.x, killer.z, CHEST_Y, 0.2);
      if (sawVictim || sawKiller) {
        b.witnessedKillerId = killer.id; b.witnessTimer = 90;
        if (!b.isAssassin) { b.brain.state = 'SHOCK'; b.brain.timer = 1.0; b.brain.bodyId = victim.id; b.vx = b.vz = 0; }
      }
      if (sawVictim) { // whoever was standing near the body becomes a little more suspicious
        for (const o of this.players) {
          if (!o.isAlive || o === b || o === victim) continue;
          if (Math.hypot(o.x - victim.x, o.z - victim.z) < 9 && this.canSee(b, o.x, o.z, CHEST_Y, -0.1)) b.suspicion[o.id] = (b.suspicion[o.id] || 0) + 1;
        }
      }
    }
    const aliveInnocents = this.players.filter((p) => p.isAlive && !p.isAssassin).length;
    if (aliveInnocents <= 1 && this.pendingOver < 0) this.pendingOver = 2.4;
  }

  private bodyPos(p: Player): { x: number; z: number } {
    const r = this.rigs.get(p.id); return r ? { x: r.root.position.x, z: r.root.position.z } : { x: p.x, z: p.z };
  }

  /** Nearest unreported body the human is close to and looking at (used for the [E] prompt). */
  private bodyInView(): Player | null {
    const h = this.human; if (!h || !h.isAlive) return null;
    const [fx, fz] = fwdOf(h.yaw);
    let best: Player | null = null; let bd = REPORT_RANGE;
    for (const p of this.players) {
      if (p.isAlive || p.bodyRemoved) continue;
      const b = this.bodyPos(p); const dx = b.x - h.x, dz = b.z - h.z, d = Math.hypot(dx, dz);
      if (d > bd) continue;
      if (d > 1.2 && (fx * dx + fz * dz) / d < 0.35) continue;
      if (this.world.blocked(h.x, EYE_Y, h.z, b.x, 0.4, b.z)) continue;
      bd = d; best = p;
    }
    return best;
  }

  private interact(): void {
    const h = this.human; if (!h || !h.isAlive || this.phase !== 'PLAYING') return;
    const body = this.bodyInView();
    if (body) { if (this.online) this.net?.sendReport(body.id); else this.startMeeting(h, 'body', body); return; }
    if (Math.hypot(h.x, h.z) < BUTTON_RANGE) {
      if (this.meetingCd <= 0) { if (this.online) this.net?.sendButton(); else this.startMeeting(h, 'button', null); }
      else this.cb.onToast(`Emergency button recharging (${Math.ceil(this.meetingCd)}s)`, 'warn');
    }
  }

  private startMeeting(reporter: Player, kind: 'body' | 'button', body: Player | null): void {
    if (this.phase !== 'PLAYING') return;
    this.phase = 'MEETING'; this.alarm = true; this.mouseDown = false;
    const reason = kind === 'body' && body ? `${body.name}'s fallen body was found by ${reporter.name}!` : `${reporter.name} slammed the Emergency Meeting button!`;
    for (const p of this.players) if (!p.isAlive && !p.bodyRemoved) this.removeBody(p); // reported bodies vanish for good
    this.clearPellets();
    this.gather(4.4);
    this.camMode = 'orbit';
    this.exitLock();
    this.meetingCd = MEETING_CD;
    sounds.playAlarm();
    this.cb.onMeeting({ reason, reporterId: reporter.id, reporterName: reporter.name, kind });
  }


  // ------------------------------------------------------------------ bot AI (state machine)
  // ROAM -> (LOOK | PRACTICE | new waypoint); SHOCK -> report / FLEE; assassin: STALK -> ATTACK -> ESCAPE.

  private canSee(b: Player, tx: number, tz: number, ty: number, minDot: number): boolean {
    const dx = tx - b.x, dz = tz - b.z, d = Math.hypot(dx, dz);
    if (d < 0.001) return true;
    if (d > 26) return false;
    const [fx, fz] = fwdOf(b.yaw);
    if ((fx * dx + fz * dz) / d < minDot) return false;
    return !this.world.blocked(b.x, EYE_Y, b.z, tx, ty, tz);
  }

  /** Alive players who could see the assassin or the victim (the assassin only strikes when this is 0). */
  private countWitnesses(b: Player, t: Player): number {
    let n = 0;
    for (const o of this.players) {
      if (!o.isAlive || o === b || o === t) continue;
      const db = Math.hypot(o.x - b.x, o.z - b.z), dv = Math.hypot(o.x - t.x, o.z - t.z);
      if (db > 22 && dv > 22) continue;
      if ((db <= 22 && this.canSee(o, b.x, b.z, CHEST_Y, 0)) || (dv <= 22 && this.canSee(o, t.x, t.z, CHEST_Y, 0))) n++;
    }
    return n;
  }

  /** Most isolated innocent (nobody else within 11m), nearest first. */
  private pickVictim(b: Player): Player | null {
    let best: Player | null = null, bs = Infinity;
    for (const c of this.players) {
      if (!c.isAlive || c === b || c.isAssassin) continue;
      let crowd = 0;
      for (const o of this.players) if (o.isAlive && o !== b && o !== c && Math.hypot(o.x - c.x, o.z - c.z) < 11) crowd++;
      if (crowd > 0) continue;
      const d = Math.hypot(c.x - b.x, c.z - b.z);
      if (d < bs) { bs = d; best = c; }
    }
    return best;
  }

  private perceive(b: Player): void {
    const br = b.brain!;
    if (!b.isAssassin && br.state !== 'SHOCK' && br.state !== 'FLEE') {
      for (const p of this.players) { // stumbling onto a body
        if (p.isAlive || p.bodyRemoved) continue;
        const d = Math.hypot(p.x - b.x, p.z - b.z);
        if (d < 16 && this.canSee(b, p.x, p.z, 0.3, d < 3 ? -1 : 0.1)) {
          br.state = 'SHOCK'; br.timer = 1.0; br.bodyId = p.id; b.vx = b.vz = 0; break;
        }
      }
    }
    for (const o of this.players) { // remember who I saw and where (used for meeting banter)
      if (o === b || !o.isAlive) continue;
      if (Math.hypot(o.x - b.x, o.z - b.z) < 14 && this.canSee(b, o.x, o.z, CHEST_Y, 0.1)) b.seen[o.id] = { t: this.time, zone: zoneName(o.x, o.z) };
    }
    if (b.isAssassin && br.state === 'ROAM' && b.killCooldown <= 0) {
      const v = this.pickVictim(b);
      if (v) { br.state = 'STALK'; br.targetId = v.id; br.timer = 16; }
    }
  }

  private chooseNext(b: Player): void {
    const br = b.brain!; const r = rnd();
    if (r < 0.2) { br.state = 'LOOK'; br.timer = 1.5 + rnd() * 2; return; }
    if (r < 0.42) { // practice paint splats on a wall
      for (let i = 0; i < 6; i++) {
        const a = rnd() * Math.PI * 2, dx = -Math.sin(a), dz = -Math.cos(a);
        const h = this.world.raycast(b.x, 0.9, b.z, dx, 0, dz, 15);
        if (h && h.t > 2.5) { br.tx = b.x + dx * h.t; br.tz = b.z + dz * h.t; br.state = 'PRACTICE'; br.burst = 3 + Math.floor(rnd() * 4); br.timer = 6; return; }
      }
    }
    for (let i = 0; i < 10; i++) {
      const p = this.world.randomPoint(1.0);
      if (Math.hypot(p.x - b.x, p.z - b.z) > 5 && !this.world.blocked(b.x, EYE_Y, b.z, p.x, EYE_Y, p.z)) { br.tx = p.x; br.tz = p.z; br.state = 'ROAM'; br.timer = 9; return; }
    }
    const p = this.world.randomPoint(1.0); br.tx = p.x; br.tz = p.z; br.state = 'ROAM'; br.timer = 9;
  }

  private startFlee(b: Player, fx: number, fz: number, state: 'FLEE' | 'ESCAPE'): void {
    const br = b.brain!;
    let ax = b.x - fx, az = b.z - fz; const l = Math.hypot(ax, az) || 1; ax /= l; az /= l;
    let found = false;
    for (let i = 0; i < 12 && !found; i++) {
      const ang = (rnd() - 0.5) * 1.6, c = Math.cos(ang), s = Math.sin(ang);
      const dx = ax * c - az * s, dz = ax * s + az * c, dist = 9 + rnd() * 5;
      const tx = b.x + dx * dist, tz = b.z + dz * dist;
      if (this.world.clearPoint(tx, tz, 1.0)) { br.tx = tx; br.tz = tz; found = true; }
    }
    if (!found) { const p = this.world.randomPoint(1.0); br.tx = p.x; br.tz = p.z; }
    br.state = state; br.timer = 5; br.equipT = 0.5;
  }

  private stopBot(b: Player, dt: number): void {
    const k = Math.min(1, dt * 10); b.vx -= b.vx * k; b.vz -= b.vz * k;
    b.x += b.vx * dt; b.z += b.vz * dt; this.world.resolve(b, PLAYER_R);
  }

  private moveBot(b: Player, tx: number, tz: number, speed: number, dt: number): void {
    const br = b.brain!;
    const dx = tx - b.x, dz = tz - b.z;
    if (Math.hypot(dx, dz) < 0.05) { this.stopBot(b, dt); return; }
    const diff = angDiff(b.yaw, yawTo(dx, dz));
    b.yaw += Math.sign(diff) * Math.min(Math.abs(diff), 7 * dt);
    const sp = speed * Math.max(0, Math.cos(diff));
    const [fx, fz] = fwdOf(b.yaw); const k = Math.min(1, dt * 8);
    b.vx += (fx * sp - b.vx) * k; b.vz += (fz * sp - b.vz) * k;
    const ox = b.x, oz = b.z;
    b.x += b.vx * dt; b.z += b.vz * dt; this.world.resolve(b, PLAYER_R);
    const moved = Math.hypot(b.x - ox, b.z - oz);
    if (sp > 0.8 && moved < sp * dt * 0.25) br.stuck += dt; else br.stuck = Math.max(0, br.stuck - dt);
    if (br.stuck > 0.7) { br.stuck = 0; br.timer = 0; b.yaw += (rnd() - 0.5) * 2; } // blocked: pick a new goal
  }

  private botPaint(b: Player): void {
    const [fx, fz] = fwdOf(b.yaw); const cp = Math.cos(b.pitch);
    const origin = new THREE.Vector3(b.x + fx * 0.55, 0.95, b.z + fz * 0.55);
    const dir = new THREE.Vector3(fx * cp, Math.sin(b.pitch), fz * cp);
    this.spawnPellet(origin, dir, b, 0.03);
    b.shootCd = 0.22 + rnd() * 0.12;
    const rig = this.rigs.get(b.id); if (rig) rig.recoil = 1;
    sounds.playShoot(false, this.vol(b.x, b.z) * 0.8);
  }

  private botLethal(b: Player, t: Player): void {
    const dx = t.x - b.x, dy = CHEST_Y - EYE_Y, dz = t.z - b.z, l = Math.hypot(dx, dy, dz) || 1;
    b.killCooldown = KILL_CD;
    const rig = this.rigs.get(b.id); if (rig) rig.recoil = 0.7;
    this.fireLethal(b, b.x, EYE_Y, b.z, dx / l, dy / l, dz / l);
  }

  private updateBot(b: Player, dt: number): void {
    const br = b.brain!; br.timer -= dt; br.think -= dt;
    if (br.think <= 0) { br.think = 0.22 + rnd() * 0.1; this.perceive(b); }
    const target = br.targetId !== null ? this.players.find((p) => p.id === br.targetId) ?? null : null;
    switch (br.state) {
      case 'ROAM': {
        if (br.timer <= 0 || Math.hypot(br.tx - b.x, br.tz - b.z) < 0.9) { this.chooseNext(b); this.stopBot(b, dt); break; }
        this.moveBot(b, br.tx, br.tz, b.speed, dt); break;
      }
      case 'LOOK': {
        this.stopBot(b, dt); b.yaw += Math.sin(this.time * 1.4 + b.id) * dt * 1.1;
        if (br.timer <= 0) { br.state = 'ROAM'; br.timer = 0; }
        break;
      }
      case 'PRACTICE': {
        this.stopBot(b, dt);
        const want = yawTo(br.tx - b.x, br.tz - b.z), diff = angDiff(b.yaw, want);
        b.yaw += Math.sign(diff) * Math.min(Math.abs(diff), 5 * dt);
        b.pitch += (-0.05 - b.pitch) * Math.min(1, dt * 6);
        if (Math.abs(diff) < 0.15 && b.shootCd <= 0 && br.burst > 0) { this.botPaint(b); br.burst--; }
        if ((br.burst <= 0 && b.shootCd <= 0) || br.timer <= 0) { br.state = 'ROAM'; br.timer = 0; }
        break;
      }
      case 'SHOCK': { // freeze for 1s, then call the meeting (or run if the killer was seen)
        this.stopBot(b, dt);
        const body = this.players.find((p) => p.id === br.bodyId);
        if (body) { const bp = this.bodyPos(body); b.yaw += angDiff(b.yaw, yawTo(bp.x - b.x, bp.z - b.z)) * Math.min(1, dt * 6); }
        if (br.timer <= 0) {
          if (body && !body.bodyRemoved) {
            if (b.witnessedKillerId !== null && rnd() < 0.35) { const bp = this.bodyPos(body); this.startFlee(b, bp.x, bp.z, 'FLEE'); }
            else this.startMeeting(b, 'body', body);
          } else { br.state = 'ROAM'; br.timer = 0; }
        }
        break;
      }
      case 'FLEE': case 'ESCAPE': {
        br.equipT -= dt;
        if (br.state === 'ESCAPE' && br.equipT <= 0) b.activeSlot = 0; // holster the pistol, back to the paintgun
        this.moveBot(b, br.tx, br.tz, b.speed * 1.35, dt);
        if (br.timer <= 0 || Math.hypot(br.tx - b.x, br.tz - b.z) < 1) { b.activeSlot = 0; br.state = 'ROAM'; br.timer = 0; }
        break;
      }
      case 'STALK': {
        if (!target || !target.isAlive) { br.state = 'ROAM'; br.timer = 0; break; }
        const d = Math.hypot(target.x - b.x, target.z - b.z);
        const wit = this.countWitnesses(b, target);
        if (wit > 0 && d > 6) { br.state = 'ROAM'; br.timer = 0; br.think = 2.5; br.targetId = null; break; } // too many eyes: wait
        if (d < 8.5 && wit === 0 && b.killCooldown <= 0 && !this.world.blocked(b.x, EYE_Y, b.z, target.x, CHEST_Y, target.z)) {
          br.state = 'ATTACK'; br.equipT = 0.55; br.timer = 2.5; b.activeSlot = 1; break;
        }
        this.moveBot(b, target.x, target.z, b.speed * 1.12, dt);
        if (br.timer <= 0) { br.state = 'ROAM'; br.timer = 0; br.targetId = null; }
        break;
      }
      case 'ATTACK': {
        if (!target || !target.isAlive) { b.activeSlot = 0; br.state = 'ROAM'; br.timer = 0; break; }
        this.stopBot(b, dt);
        const dx = target.x - b.x, dz = target.z - b.z, want = yawTo(dx, dz), diff = angDiff(b.yaw, want);
        b.yaw += Math.sign(diff) * Math.min(Math.abs(diff), 9 * dt);
        b.pitch = Math.atan2(CHEST_Y - EYE_Y, Math.hypot(dx, dz));
        br.equipT -= dt;
        if (br.equipT <= 0 && Math.abs(diff) < 0.08) {
          if (this.countWitnesses(b, target) === 0 && !this.world.blocked(b.x, EYE_Y, b.z, target.x, CHEST_Y, target.z)) {
            this.botLethal(b, target);
            if (this.phase === 'PLAYING') this.startFlee(b, target.x, target.z, 'ESCAPE'); // blend in: holster and run
            br.targetId = null;
          } else { b.activeSlot = 0; br.state = 'ROAM'; br.timer = 0; br.think = 3; br.targetId = null; }
        } else if (br.timer <= 0) { b.activeSlot = 0; br.state = 'ROAM'; br.timer = 0; br.targetId = null; }
        break;
      }
    }
    if (br.state !== 'PRACTICE' && br.state !== 'ATTACK') b.pitch += (0 - b.pitch) * Math.min(1, dt * 5);
  }

  // ------------------------------------------------------------------ visuals

  private updateRigs(dt: number): void {
    for (const p of this.players) {
      const rig = this.rigs.get(p.id); if (!rig) continue;
      if (rig.ejecting > 0) { // voted out: spin up and shrink away
        rig.ejecting += dt; rig.root.position.y += dt * (3 + rig.ejecting * 4); rig.root.rotation.y += dt * 9;
        rig.root.scale.setScalar(Math.max(0.01, 1 - rig.ejecting * 0.75));
        if (rig.tag) rig.tag.visible = false;
        if (rig.ejecting > 1.4) rig.root.visible = false;
        continue;
      }
      if (p.isAlive) {
        rig.root.position.set(p.x, 0, p.z); rig.root.rotation.y = p.yaw;
        rig.speed = Math.hypot(p.vx, p.vz); rig.aimPitch = p.pitch;
        setExpression(rig, p.brain?.state === 'SHOCK' ? 'shock' : 'normal');
        setHeld(rig, p.activeSlot);
        if (p.isHuman) rig.root.visible = this.camMode !== 'fp';
      } else { p.x = rig.root.position.x; p.z = rig.root.position.z; } // body follows its sliding rig
      animateRig(rig, dt, this.time);
      if (rig.pool) {
        const t = (rig.pool.userData.t as number) + dt; rig.pool.userData.t = t;
        const k = Math.min(1, t / 0.9), e = 1 - Math.pow(1 - k, 3);
        rig.pool.scale.setScalar(Math.max(0.01, e * 2.3));
      }
    }
    for (const r of this.demo) { r.root.rotation.y += dt * 0.15; animateRig(r, dt, this.time); }
  }

  private prevMode: 'orbit' | 'fp' | 'spectate' = 'orbit';

  private updateCamera(dt: number, snap: boolean): void {
    const h = this.human;
    if (this.camMode === 'fp' && h) {
      const bob = Math.abs(Math.sin(this.camBob)) * 0.035 * Math.min(1, Math.hypot(h.vx, h.vz) / 4);
      this.camera.position.set(h.x, EYE_Y + bob, h.z);
      this.camKick *= Math.exp(-dt * 12);
      this.camera.rotation.set(clamp(h.pitch + this.camKick, -1.5, 1.5), h.yaw, 0);
      this.prevMode = 'fp';
      return;
    }
    if (this.prevMode === 'fp') { // leaving first person: start looking where we were looking
      const f = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
      this.lookTarget.copy(this.camera.position).addScaledVector(f, 6);
    }
    this.prevMode = this.camMode;
    const spectate = this.camMode === 'spectate', lobby = this.phase === 'LOBBY';
    const R = spectate ? 16 : lobby ? 13 : 11.5, Hh = spectate ? 10 : lobby ? 5.5 : 5.2;
    this.orbitAngle += dt * (lobby ? 0.12 : 0.09);
    this.tmpV.set(Math.cos(this.orbitAngle) * R, Hh, Math.sin(this.orbitAngle) * R);
    const k = snap ? 1 : 1 - Math.exp(-dt * 2.6);
    this.camera.position.lerp(this.tmpV, k);
    this.lookTarget.lerp(this.tmpV2.set(0, 1.0, 0), k);
    this.camera.lookAt(this.lookTarget);
  }

  private snapOrbit(): void { this.camMode = 'orbit'; this.prevMode = 'orbit'; this.updateCamera(0, true); }

  private emitHud(force: boolean): void {
    const h = this.human; if (!h) return;
    const near = this.phase === 'PLAYING' ? this.bodyInView() : null;
    const s: HudState = {
      role: h.isAssassin ? 'assassin' : 'innocent', activeSlot: h.activeSlot,
      killCooldown: Math.ceil(h.killCooldown * 10) / 10, killCooldownMax: KILL_CD,
      nearBody: !!near, nearButton: h.isAlive && Math.hypot(h.x, h.z) < BUTTON_RANGE,
      buttonCooldown: Math.ceil(Math.max(0, this.meetingCd)), humanAlive: h.isAlive,
      aliveCount: this.players.filter((p) => p.isAlive).length, totalCount: this.players.length, locked: this.locked,
    };
    const json = JSON.stringify(s);
    if (force || json !== this.lastHud) { this.lastHud = json; this.cb.onHud(s); }
  }

  // ------------------------------------------------------------------ cleanup

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('pointerlockchange', this.onLockChange);
    this.ro?.disconnect(); this.exitLock();
    this.clearRound(); this.clearDemo();
    for (const m of this.pelletPool) (m.material as THREE.Material).dispose();
    this.pelletPool = []; this.pelletGeo.dispose();
    this.decals.dispose(this.scene); this.particles.dispose(this.scene);
    this.poolTex.dispose();
    disposeObject(this.arena.root); this.arena.textures.forEach((t) => t.dispose());
    this.scene.clear();
    if (this.studio) { this.studio.dispose(); this.studio = null; }
    const cv = this.renderer.domElement;
    cv.removeEventListener('contextmenu', this.onContext);
    this.renderer.dispose(); this.renderer.forceContextLoss();
    if (cv.parentElement) cv.parentElement.removeChild(cv);
    sounds.dispose();
  }
}
