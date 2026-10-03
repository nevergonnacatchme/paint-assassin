// First-person viewmodel: hands + weapons rendered in their own scene/camera on top of the world
// (so the gun never clips into walls). Procedural bob, mouse sway, recoil and slot-switch slide animations.
import * as THREE from 'three';
import { buildPaintgun, buildLethalPistol, limb, std, disposeObject } from './models';
import { makeGlowTexture } from './textures';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const BASE = new THREE.Vector3(0.27, -0.25, -0.46);

export class ViewModel {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(62, 1, 0.01, 10);
  private root = new THREE.Group();
  private slots: THREE.Group[] = [];
  private flashes: THREE.Mesh[] = [];
  private glow: THREE.Texture;
  private t = 0; private swayX = 0; private swayY = 0; private recoil = 0; private flashT = 0;
  private slot = 0; private pending = -1; private phase: 'idle' | 'down' | 'up' = 'up'; private lower = 1;
  onSwitch: (() => void) | null = null;

  constructor(coatHex: string, paintHex: string) {
    this.glow = makeGlowTexture();
    this.scene.add(new THREE.AmbientLight('#ffffff', 1.5));
    const d = new THREE.DirectionalLight('#ffffff', 2.4); d.position.set(-1, 2, 1.5); this.scene.add(d);
    this.scene.add(this.camera); this.camera.add(this.root);
    this.root.scale.setScalar(0.95);

    const coat = std(coatHex, { roughness: 0.6 }), glove = std('#ffffff', { roughness: 0.35 });
    const mk = (weapon: THREE.Group, handR: THREE.Vector3, leftHand: THREE.Vector3 | null, flashColor: string, flashSize: number): THREE.Group => {
      const g = new THREE.Group(); g.add(weapon);
      const hr = new THREE.Mesh(new THREE.SphereGeometry(0.052, 14, 10), glove); hr.position.copy(handR); g.add(hr);
      g.add(limb(handR.clone().add(new THREE.Vector3(0, -0.01, 0.03)), new THREE.Vector3(0.1, -0.34, 0.55), 0.05, coat));
      if (leftHand) {
        const hl = new THREE.Mesh(new THREE.SphereGeometry(0.048, 14, 10), glove); hl.position.copy(leftHand); g.add(hl);
        g.add(limb(leftHand.clone(), new THREE.Vector3(-0.28, -0.4, 0.45), 0.048, coat));
      }
      const muzzle = weapon.getObjectByName('muzzle');
      const fl = new THREE.Mesh(new THREE.PlaneGeometry(flashSize, flashSize), new THREE.MeshBasicMaterial({ map: this.glow, color: flashColor, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      if (muzzle) fl.position.copy(muzzle.position).add(weapon.position); fl.visible = false; g.add(fl); this.flashes.push(fl);
      g.visible = false; this.root.add(g); return g;
    };
    this.slots.push(mk(buildPaintgun(paintHex), new THREE.Vector3(0, -0.02, 0.04), new THREE.Vector3(0.0, -0.05, -0.2), paintHex, 0.34));
    this.slots.push(mk(buildLethalPistol(), new THREE.Vector3(0, -0.02, 0.05), new THREE.Vector3(-0.045, -0.06, 0.05), '#ffe9b0', 0.12));
    this.slots[0].visible = true;
  }

  /** false while a weapon is being swapped (blocks firing) */
  get ready(): boolean { return this.lower < 0.3; }

  resize(aspect: number) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }

  setSlot(i: number) {
    if (i === this.slot && this.phase === 'idle') return;
    if (this.phase !== 'idle') { this.pending = i; return; }
    this.pending = i; this.phase = 'down';
  }

  kick(strength = 1) { this.recoil = Math.min(1.4, this.recoil + strength); this.flashT = 0.05; }

  update(dt: number, speed: number, mdx: number, mdy: number) {
    this.t += dt;
    const mv = clamp(speed / 5, 0, 1);
    const bobX = Math.cos(this.t * 7.5) * 0.011 * mv;
    const bobY = Math.abs(Math.sin(this.t * 7.5)) * 0.017 * mv;
    const breathe = Math.sin(this.t * 1.7) * 0.002;
    const k = Math.min(1, dt * 10);
    this.swayX += (-clamp(mdx * 0.0007, -0.05, 0.05) - this.swayX) * k;
    this.swayY += (clamp(mdy * 0.0007, -0.05, 0.05) - this.swayY) * k;
    this.recoil *= Math.exp(-dt * 13);

    // slot-switch slide: lower the current weapon, swap, raise the new one
    if (this.phase === 'down') {
      this.lower += dt / 0.12;
      if (this.lower >= 1) {
        this.lower = 1; this.slots[this.slot].visible = false;
        this.slot = this.pending; this.slots[this.slot].visible = true; this.phase = 'up';
        if (this.onSwitch) this.onSwitch();
      }
    } else if (this.phase === 'up') {
      this.lower -= dt / 0.2;
      if (this.lower <= 0) { this.lower = 0; this.phase = 'idle'; }
    }
    const ease = this.lower * this.lower * (3 - 2 * this.lower);

    this.root.position.set(BASE.x + bobX + this.swayX, BASE.y + bobY + breathe + this.swayY - 0.5 * ease, BASE.z + this.recoil * 0.09);
    this.root.rotation.set(this.recoil * 0.2 + this.swayY * 0.8, 0.05 + this.swayX * 0.8, -bobX * 1.5 + ease * 0.5);

    this.flashT -= dt;
    this.flashes.forEach((f, i) => {
      f.visible = this.flashT > 0 && i === this.slot;
      if (f.visible) { f.rotation.z = Math.random() * 6; f.scale.setScalar(0.8 + Math.random() * 0.5); }
    });
  }

  render(renderer: THREE.WebGLRenderer) { renderer.clearDepth(); renderer.render(this.scene, this.camera); }

  dispose() {
    disposeObject(this.root); this.glow.dispose(); this.scene.clear();
  }
}
