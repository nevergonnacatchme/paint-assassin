// Visual effects: instanced paint decals that cling to surfaces, and an instanced particle system for splashes.
import * as THREE from 'three';
import { makeSplatTexture } from './textures';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _n = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

export class DecalSystem {
  private meshes: THREE.InstancedMesh[] = [];
  private ptr: number[] = [];
  private textures: THREE.Texture[] = [];
  private seq = 0;
  private cap: number;

  constructor(parent: THREE.Object3D, variants = 3, capacityEach = 140) {
    this.cap = capacityEach;
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let v = 0; v < variants; v++) {
      const tex = makeSplatTexture(v + 1); this.textures.push(tex);
      const mat = new THREE.MeshBasicMaterial({
        map: tex, transparent: true, depthWrite: false, alphaTest: 0.02,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      });
      const im = new THREE.InstancedMesh(geo, mat, capacityEach);
      im.frustumCulled = false; im.renderOrder = 2;
      const white = new THREE.Color(1, 1, 1);
      for (let i = 0; i < capacityEach; i++) { im.setMatrixAt(i, ZERO); im.setColorAt(i, white); }
      parent.add(im); this.meshes.push(im); this.ptr.push(0);
    }
  }

  /** Stick a splat onto a surface at `point` with outward `normal`. */
  add(point: { x: number; y: number; z: number }, normal: { x: number; y: number; z: number }, color: THREE.Color, size: number): void {
    const v = Math.floor(Math.random() * this.meshes.length);
    const im = this.meshes[v]; const idx = this.ptr[v]; this.ptr[v] = (idx + 1) % this.cap;
    const off = 0.02 + (this.seq++ % 40) * 0.0004; // tiny stagger so overlapping splats never z-fight
    _n.set(normal.x, normal.y, normal.z).normalize();
    _p.set(point.x + _n.x * off, point.y + _n.y * off, point.z + _n.z * off);
    _q.setFromUnitVectors(_z, _n);
    _q2.setFromAxisAngle(_n, Math.random() * Math.PI * 2);
    _q2.multiply(_q);
    const sx = size * (0.8 + Math.random() * 0.5), sy = size * (0.8 + Math.random() * 0.5);
    _s.set(sx, sy, 1);
    _m.compose(_p, _q2, _s);
    im.setMatrixAt(idx, _m); im.setColorAt(idx, color);
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }

  clear(): void {
    for (const im of this.meshes) { for (let i = 0; i < this.cap; i++) im.setMatrixAt(i, ZERO); im.instanceMatrix.needsUpdate = true; }
    this.ptr = this.ptr.map(() => 0);
  }

  dispose(parent: THREE.Object3D): void {
    for (const im of this.meshes) { parent.remove(im); im.geometry.dispose(); (im.material as THREE.Material).dispose(); im.dispose(); }
    this.textures.forEach((t) => t.dispose());
    this.meshes = [];
  }
}

interface Particle { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; size: number; }

export class ParticleSystem {
  private mesh: THREE.InstancedMesh;
  private items: Particle[] = [];
  private ptr = 0;
  private cap: number;

  constructor(parent: THREE.Object3D, capacity = 320) {
    this.cap = capacity;
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.06, 0), new THREE.MeshBasicMaterial({ color: 0xffffff }), capacity);
    this.mesh.frustumCulled = false;
    const white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < capacity; i++) { this.items.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 1 }); this.mesh.setMatrixAt(i, ZERO); this.mesh.setColorAt(i, white); }
    parent.add(this.mesh);
  }

  burst(pos: { x: number; y: number; z: number }, color: THREE.Color, count: number, speed: number, size = 1, up = 1): void {
    for (let i = 0; i < count; i++) {
      const idx = this.ptr; this.ptr = (this.ptr + 1) % this.cap;
      const a = Math.random() * Math.PI * 2, e = Math.random() * 1.2 - 0.2, s = speed * (0.4 + Math.random() * 0.8);
      const p = this.items[idx];
      p.x = pos.x; p.y = pos.y; p.z = pos.z;
      p.vx = Math.cos(a) * Math.cos(e) * s; p.vz = Math.sin(a) * Math.cos(e) * s; p.vy = Math.sin(e) * s * up + 1;
      p.max = p.life = 0.5 + Math.random() * 0.7; p.size = size * (0.6 + Math.random() * 0.9);
      this.mesh.setColorAt(idx, color);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    for (let i = 0; i < this.cap; i++) {
      const p = this.items[i];
      if (p.life <= 0) continue;
      p.life -= dt; p.vy -= 9 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.03) { p.y = 0.03; p.vy = 0; p.vx *= 0.8; p.vz *= 0.8; }
      if (p.life <= 0) { this.mesh.setMatrixAt(i, ZERO); continue; }
      const k = Math.min(1, p.life / (p.max * 0.5)) * p.size;
      _p.set(p.x, p.y, p.z); _s.set(k, k, k); _q.identity();
      _m.compose(_p, _q, _s); this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void { for (const p of this.items) p.life = 0; for (let i = 0; i < this.cap; i++) this.mesh.setMatrixAt(i, ZERO); this.mesh.instanceMatrix.needsUpdate = true; }

  dispose(parent: THREE.Object3D): void {
    parent.remove(this.mesh); this.mesh.geometry.dispose(); (this.mesh.material as THREE.Material).dispose(); this.mesh.dispose();
  }
}
