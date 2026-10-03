// Procedural 3D models: paintgun, lethal pistol and the bean painter characters. All geometry is built in code.
import * as THREE from 'three';
import { makeNameTagTexture } from './textures';

const PI = Math.PI;
export const std = (color: THREE.ColorRepresentation, o: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, ...o });

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  return m;
}

/** Free GPU resources of an object tree (geometries, materials and owned textures). */
export function disposeObject(o: THREE.Object3D): void {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (mat) {
      (Array.isArray(mat) ? mat : [mat]).forEach((x) => {
        const map = (x as THREE.SpriteMaterial).map;
        if (map && x.userData.ownMap) map.dispose();
        x.dispose();
      });
    }
  });
}

/** Chunky retro-futuristic paintball marker: top hopper, clear pressurised tank, coloured nozzle. Barrel points to -Z, origin = grip. */
export function buildPaintgun(color: THREE.ColorRepresentation): THREE.Group {
  const g = new THREE.Group();
  const cream = std('#f4f1ff', { roughness: 0.35 });
  const dark = std('#3a3f5c', { roughness: 0.5 });
  const metal = std('#b9bfd6', { metalness: 0.85, roughness: 0.28 });
  const paint = std(color, { roughness: 0.25, emissive: color, emissiveIntensity: 0.18 });
  const clear = new THREE.MeshStandardMaterial({ color: '#dff6ff', transparent: true, opacity: 0.4, roughness: 0.1, metalness: 0.1 });

  g.add(mesh(new THREE.BoxGeometry(0.085, 0.11, 0.3), cream, 0, 0.06, -0.1));
  g.add(mesh(new THREE.BoxGeometry(0.089, 0.028, 0.18), paint, 0, 0.075, -0.12));
  const barrel = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.24, 12), metal, 0, 0.085, -0.36); barrel.rotation.x = PI / 2; g.add(barrel);
  const nozzle = mesh(new THREE.CylinderGeometry(0.034, 0.026, 0.06, 14), paint, 0, 0.085, -0.5); nozzle.rotation.x = PI / 2; g.add(nozzle);
  for (const z of [-0.3, -0.38]) g.add(mesh(new THREE.TorusGeometry(0.036, 0.008, 8, 16), metal, 0, 0.085, z)); // cooling rings
  // top-mounted hopper (clear shell with paint inside) + lid
  g.add(mesh(new THREE.CylinderGeometry(0.056, 0.038, 0.1, 18), clear, 0, 0.175, -0.07));
  g.add(mesh(new THREE.CylinderGeometry(0.046, 0.032, 0.085, 18), paint, 0, 0.17, -0.07));
  g.add(mesh(new THREE.CylinderGeometry(0.04, 0.058, 0.02, 18), dark, 0, 0.232, -0.07));
  // clear pressurised tank under the barrel
  const tank = mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.2, 16), clear, 0, -0.012, -0.2); tank.rotation.x = PI / 2; g.add(tank);
  const fill = mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.17, 12), std('#9fe7ff', { emissive: '#9fe7ff', emissiveIntensity: 0.25, roughness: 0.2 }), 0, -0.012, -0.2); fill.rotation.x = PI / 2; g.add(fill);
  for (const z of [-0.3, -0.1]) { const cap = mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.016, 14), metal, 0, -0.012, z); cap.rotation.x = PI / 2; g.add(cap); }
  const grip = mesh(new THREE.BoxGeometry(0.055, 0.15, 0.065), dark, 0, -0.085, 0.02); grip.rotation.x = 0.18; g.add(grip);
  g.add(mesh(new THREE.BoxGeometry(0.012, 0.04, 0.06), dark, 0, -0.025, -0.04)); // trigger guard
  const muzzle = new THREE.Object3D(); muzzle.name = 'muzzle'; muzzle.position.set(0, 0.085, -0.55); g.add(muzzle);
  return g;
}

/** Sleek dark suppressed tactical pistol with metallic accents. Barrel points to -Z, origin = grip. */
export function buildLethalPistol(): THREE.Group {
  const g = new THREE.Group();
  const gun = std('#23262d', { metalness: 0.85, roughness: 0.35 });
  const frame = std('#15171c', { metalness: 0.5, roughness: 0.5 });
  const acc = std('#9aa0b4', { metalness: 0.95, roughness: 0.22 });
  g.add(mesh(new THREE.BoxGeometry(0.046, 0.055, 0.22), gun, 0, 0.05, -0.08));
  g.add(mesh(new THREE.BoxGeometry(0.04, 0.04, 0.18), frame, 0, 0.012, -0.06));
  g.add(mesh(new THREE.BoxGeometry(0.048, 0.006, 0.2), acc, 0, 0.0785, -0.08));
  const supp = mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.22, 16), frame, 0, 0.058, -0.3); supp.rotation.x = PI / 2; g.add(supp);
  for (const z of [-0.22, -0.3, -0.38]) g.add(mesh(new THREE.TorusGeometry(0.027, 0.004, 6, 16), acc, 0, 0.058, z));
  const grip = mesh(new THREE.BoxGeometry(0.04, 0.13, 0.055), frame, 0, -0.065, 0.03); grip.rotation.x = 0.25; g.add(grip);
  g.add(mesh(new THREE.BoxGeometry(0.01, 0.014, 0.012), acc, 0, 0.087, 0.02)); // rear sight
  g.add(mesh(new THREE.BoxGeometry(0.008, 0.012, 0.01), acc, 0, 0.087, -0.17)); // front sight
  const muzzle = new THREE.Object3D(); muzzle.name = 'muzzle'; muzzle.position.set(0, 0.058, -0.42); g.add(muzzle);
  return g;
}

/** Cylinder limb between two points (used for sleeves). */
export function limb(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(b, a);
  const m = mesh(new THREE.CylinderGeometry(r, r * 0.9, dir.length(), 12), mat);
  m.position.copy(a).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return m;
}

// ---------------------------------------------------------------- characters

export type Expression = 'normal' | 'shock' | 'dead';

export interface CharacterRig {
  root: THREE.Group; // positioned at the feet, yaw-rotated
  body: THREE.Group; // tilts when knocked out
  feet: THREE.Mesh[];
  handL: THREE.Group; handR: THREE.Group;
  weaponPaint: THREE.Group; weaponLethal: THREE.Group;
  eyesAlive: THREE.Group; eyesDead: THREE.Group; whites: THREE.Mesh[]; pupils: THREE.Mesh[];
  mouthAlive: THREE.Mesh; mouthDead: THREE.Mesh; mouthShock: THREE.Mesh;
  tag: THREE.Sprite | null;
  expr: Expression;
  // animation state (driven by the engine)
  walk: number; speed: number; recoil: number; flinch: number; aimPitch: number;
  fall: number; dead: boolean; vx: number; vz: number; spin: number;
  blinkT: number; blinkHold: number; phase: number;
  ejecting: number; // seconds since ejection started (0 = not ejecting)
  pool: THREE.Mesh | null;
}

const shade = (hex: string, k: number) => new THREE.Color(hex).multiplyScalar(k);

export function buildCharacter(colorHex: string, name: string, withTag = true): CharacterRig {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const coat = std(colorHex, { roughness: 0.6 });
  const white = std('#ffffff', { roughness: 0.4 });
  const black = std('#1d1f2b', { roughness: 0.3 });

  // bean body, apron belt and paint smudges
  body.add(mesh(new THREE.CapsuleGeometry(0.38, 0.62, 6, 20), coat, 0, 0.8, 0));
  const belt = mesh(new THREE.TorusGeometry(0.385, 0.028, 8, 28), white, 0, 0.56, 0); belt.rotation.x = PI / 2; body.add(belt);
  const smudge = ['#ffd166', '#7fdbca', '#ff8fab'];
  [[-0.3, 0.64, -0.2], [0.26, 0.5, -0.27], [0.33, 0.9, 0.1]].forEach(([x, y, z], i) => {
    const s = mesh(new THREE.SphereGeometry(0.05, 8, 6), std(smudge[i]), x, y, z); s.scale.set(1, 1, 0.45); s.lookAt(0, y, 0); s.castShadow = false; body.add(s);
  });
  // shoes
  const feet: THREE.Mesh[] = [];
  for (const x of [-0.16, 0.16]) { const f = mesh(new THREE.CapsuleGeometry(0.075, 0.1, 4, 8), black, x, 0.07, -0.04); f.rotation.x = PI / 2; body.add(f); feet.push(f); }
  // beret: squashed dome, stem, slight tilt
  const beret = new THREE.Group(); beret.position.set(0, 1.46, 0); beret.rotation.set(-0.12, 0, 0.2);
  const dome = mesh(new THREE.SphereGeometry(0.36, 20, 12), std(shade(colorHex, 0.62), { roughness: 0.85 })); dome.scale.set(1, 0.36, 1); beret.add(dome);
  beret.add(mesh(new THREE.CylinderGeometry(0.022, 0.03, 0.07, 8), std(shade(colorHex, 0.45)), 0, 0.14, 0));
  body.add(beret);

  // face: eyes (white + pupil), X-eyes for knocked-out, mouths
  const eyesAlive = new THREE.Group(), eyesDead = new THREE.Group();
  const whites: THREE.Mesh[] = [], pupils: THREE.Mesh[] = [];
  for (const x of [-0.15, 0.15]) {
    const w = mesh(new THREE.SphereGeometry(0.1, 16, 12), white, x, 1.08, -0.31); w.castShadow = false; whites.push(w); eyesAlive.add(w);
    const p = mesh(new THREE.SphereGeometry(0.055, 12, 10), black, x + (x > 0 ? -0.01 : 0.01), 1.08, -0.385); p.castShadow = false; pupils.push(p); eyesAlive.add(p);
    for (const rot of [PI / 4, -PI / 4]) { const bar = mesh(new THREE.BoxGeometry(0.15, 0.028, 0.02), black, x, 1.08, -0.372); bar.rotation.z = rot; bar.castShadow = false; eyesDead.add(bar); }
  }
  eyesDead.visible = false; body.add(eyesAlive); body.add(eyesDead);
  const smile = mesh(new THREE.TorusGeometry(0.09, 0.014, 8, 20, PI), black, 0, 0.9, -0.376); smile.rotation.z = PI; smile.castShadow = false; body.add(smile);
  const mouthDead = mesh(new THREE.BoxGeometry(0.14, 0.022, 0.02), black, 0, 0.84, -0.375); mouthDead.visible = false; mouthDead.castShadow = false; body.add(mouthDead);
  const mouthShock = mesh(new THREE.TorusGeometry(0.035, 0.014, 8, 14), black, 0, 0.84, -0.378); mouthShock.visible = false; mouthShock.castShadow = false; body.add(mouthShock);
  for (const x of [-0.24, 0.24]) {
    const ch = mesh(new THREE.SphereGeometry(0.05, 10, 8), new THREE.MeshStandardMaterial({ color: '#ff9bb3', transparent: true, opacity: 0.6 }), x, 0.93, -0.29); ch.scale.set(1, 0.7, 0.3); ch.castShadow = false; body.add(ch);
  }

  // floating gloved hands; right hand carries the weapon
  const glove = std('#ffffff', { roughness: 0.35 });
  const handL = new THREE.Group(); handL.position.set(-0.42, 0.7, -0.2); handL.add(mesh(new THREE.SphereGeometry(0.085, 14, 10), glove));
  const handR = new THREE.Group(); handR.position.set(0.42, 0.7, -0.2); handR.add(mesh(new THREE.SphereGeometry(0.085, 14, 10), glove));
  const weaponPaint = buildPaintgun(colorHex); weaponPaint.scale.setScalar(0.6); weaponPaint.position.set(0, -0.04, 0.02);
  const weaponLethal = buildLethalPistol(); weaponLethal.scale.setScalar(0.65); weaponLethal.position.set(0, -0.04, 0.02); weaponLethal.visible = false;
  handR.add(weaponPaint); handR.add(weaponLethal);
  body.add(handL); body.add(handR);

  // tiny details don't cast shadows -> far fewer draw calls in the shadow pass
  for (const o of [weaponPaint, weaponLethal, handL, handR, belt, beret]) o.traverse((c) => { c.castShadow = false; });
  let tag: THREE.Sprite | null = null;
  if (withTag) {
    const tex = makeNameTagTexture(name, colorHex);
    const sm = new THREE.SpriteMaterial({ map: tex, transparent: true }); sm.userData.ownMap = true;
    tag = new THREE.Sprite(sm); tag.scale.set(1.15, 0.29, 1); tag.position.set(0, 2.0, 0); root.add(tag);
  }
  return {
    root, body, feet, handL, handR, weaponPaint, weaponLethal, eyesAlive, eyesDead, whites, pupils,
    mouthAlive: smile, mouthDead, mouthShock, tag, expr: 'normal',
    walk: Math.random() * 6, speed: 0, recoil: 0, flinch: 0, aimPitch: 0, fall: 0, dead: false, vx: 0, vz: 0, spin: 0,
    blinkT: 1 + Math.random() * 3, blinkHold: 0, phase: Math.random() * 6, ejecting: 0, pool: null,
  };
}

export function setExpression(rig: CharacterRig, e: Expression): void {
  if (rig.expr === e) return;
  rig.expr = e;
  rig.eyesAlive.visible = e !== 'dead'; rig.eyesDead.visible = e === 'dead';
  rig.mouthAlive.visible = e === 'normal'; rig.mouthShock.visible = e === 'shock'; rig.mouthDead.visible = e === 'dead';
  const big = e === 'shock';
  rig.whites.forEach((w) => w.scale.setScalar(big ? 1.18 : 1));
  rig.pupils.forEach((p) => p.scale.setScalar(big ? 0.55 : 1));
}

export function setHeld(rig: CharacterRig, slot: 0 | 1): void {
  rig.weaponPaint.visible = slot === 0; rig.weaponLethal.visible = slot === 1;
}

/** Knock the bean over: it keeps animating (slide, tumble, sprawling hands) via animateRig. */
export function knockOut(rig: CharacterRig, pushX: number, pushZ: number): void {
  rig.dead = true; rig.fall = 0; rig.vx = pushX; rig.vz = pushZ; rig.spin = (Math.random() - 0.5) * 6;
  rig.weaponPaint.visible = false; rig.weaponLethal.visible = false;
  setExpression(rig, 'dead');
}

export function animateRig(rig: CharacterRig, dt: number, time: number): void {
  if (rig.dead) {
    rig.fall = Math.min(1, rig.fall + dt * 1.7);
    const e = 1 - Math.pow(1 - rig.fall, 3);
    rig.body.rotation.set(e * PI * 0.5, 0, 0);
    rig.body.position.y = 0.38 * e;
    rig.handL.position.set(-0.4 - 0.25 * e, 0.7 - 0.2 * e, -0.2 + 0.2 * e);
    rig.handR.position.set(0.4 + 0.25 * e, 0.7 - 0.2 * e, -0.2 + 0.2 * e);
    rig.root.position.x += rig.vx * dt; rig.root.position.z += rig.vz * dt;
    const k = Math.exp(-3.2 * dt); rig.vx *= k; rig.vz *= k;
    rig.root.rotation.y += rig.spin * dt; rig.spin *= k;
    return;
  }
  const mv = Math.min(1, rig.speed / 3.5);
  rig.walk += dt * (2 + rig.speed * 2.1);
  const s = Math.sin(rig.walk);
  rig.body.position.y = Math.abs(s) * 0.05 * mv + Math.sin(time * 2 + rig.phase) * 0.006;
  rig.body.rotation.set(-mv * 0.07, 0, s * 0.04 * mv);
  rig.feet[0].position.z = -0.04 + s * 0.2 * mv; rig.feet[1].position.z = -0.04 - s * 0.2 * mv;
  rig.feet[0].position.y = 0.07 + Math.max(0, Math.cos(rig.walk)) * 0.06 * mv;
  rig.feet[1].position.y = 0.07 + Math.max(0, -Math.cos(rig.walk)) * 0.06 * mv;
  rig.handL.position.set(-0.42, 0.7, -0.2 - s * 0.1 * mv);
  rig.recoil = Math.max(0, rig.recoil - dt * 7);
  rig.handR.position.set(0.42, 0.7 + rig.recoil * 0.03, -0.2 + rig.recoil * 0.12);
  rig.handR.rotation.x = rig.aimPitch + rig.recoil * 0.25;
  rig.flinch = Math.max(0, rig.flinch - dt * 3);
  const f = rig.flinch;
  rig.body.scale.set(1 + f * 0.12, 1 - f * 0.16, 1 + f * 0.12);
  // blinking
  if (rig.expr === 'normal') {
    rig.blinkT -= dt;
    if (rig.blinkT < 0) { rig.blinkHold = 0.12; rig.blinkT = 2.5 + Math.random() * 3; }
    rig.blinkHold = Math.max(0, rig.blinkHold - dt);
    rig.eyesAlive.scale.y = rig.blinkHold > 0 ? 0.12 : 1;
  } else rig.eyesAlive.scale.y = 1;
}

/** Renders small transparent head portraits (data URLs) with its own tiny WebGL context. */
export class HeadshotStudio {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private cam = new THREE.PerspectiveCamera(26, 1, 0.1, 20);
  private cache = new Map<string, string>();

  constructor(size = 144) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1); this.renderer.setSize(size, size); this.renderer.setClearColor(0x000000, 0);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const d = new THREE.DirectionalLight(0xffffff, 2.4); d.position.set(-1.5, 3, -3); this.scene.add(d);
    this.cam.position.set(0.55, 1.2, -2.3); this.cam.lookAt(0, 1.12, 0);
  }

  snap(id: number, colorHex: string, dead: boolean): string {
    const key = `${id}:${colorHex}:${dead ? 1 : 0}`;
    const hit = this.cache.get(key); if (hit) return hit;
    const rig = buildCharacter(colorHex, '', false);
    rig.weaponPaint.visible = false; rig.handL.visible = false; rig.handR.visible = false;
    if (dead) setExpression(rig, 'dead');
    this.scene.add(rig.root);
    this.renderer.render(this.scene, this.cam);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.scene.remove(rig.root); disposeObject(rig.root);
    this.cache.set(key, url);
    return url;
  }

  dispose(): void {
    this.renderer.dispose(); this.renderer.forceContextLoss();
    this.cache.clear();
  }
}
