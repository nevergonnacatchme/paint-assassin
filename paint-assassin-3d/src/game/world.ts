// Pure game-world math (no Three.js): colliders, movement collision, line of sight and ray tests.
// Axes: x = east, z = south (so -z is "north"), y = up. Player forward at yaw 0 is -z.

export const ARENA_HALF = 22; // arena spans [-22, 22] on x and z
export const CEILING_Y = 6;
export const EYE_Y = 1.1; // eye height of every bean
export const CHEST_Y = 0.85; // where shots aim
export const PLAYER_R = 0.42; // collision radius
export const PLAYER_H = 1.45; // body height (for hit tests)

export interface Box {
  minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number;
}
export interface Cyl {
  x: number; z: number; r: number; y0: number; y1: number;
}
export interface RayHit {
  t: number; nx: number; ny: number; nz: number; kind: 'wall' | 'floor' | 'ceiling' | 'player';
  playerId?: number;
}

export const fwdOf = (yaw: number): [number, number] => [-Math.sin(yaw), -Math.cos(yaw)];
export const yawTo = (dx: number, dz: number): number => Math.atan2(-dx, -dz);
export const angDiff = (a: number, b: number): number => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

export function zoneName(x: number, z: number): string {
  if (Math.hypot(x, z) < 5.5) return 'central rotunda';
  if (Math.abs(x) > Math.abs(z)) return x < 0 ? 'west gallery' : 'east gallery';
  return z < 0 ? 'north hall' : 'south hall';
}

/** Ray vs vertical cylinder (side + top cap). Direction need not be normalised; t is in direction units. */
export function rayCylinder(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  cx: number, cz: number, r: number, y0: number, y1: number,
): { t: number; nx: number; ny: number; nz: number } | null {
  let best: { t: number; nx: number; ny: number; nz: number } | null = null;
  const px = ox - cx, pz = oz - cz;
  const a = dx * dx + dz * dz;
  if (a > 1e-9) {
    const b = 2 * (px * dx + pz * dz);
    const c = px * px + pz * pz - r * r;
    const disc = b * b - 4 * a * c;
    if (disc >= 0 && c > 0) {
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      if (t >= 0) {
        const y = oy + dy * t;
        if (y >= y0 && y <= y1) {
          const hx = px + dx * t, hz = pz + dz * t;
          best = { t, nx: hx / r, ny: 0, nz: hz / r };
        }
      }
    }
  }
  if (Math.abs(dy) > 1e-9) {
    const tt = (y1 - oy) / dy; // top cap
    if (tt >= 0 && dy < 0 && (!best || tt < best.t)) {
      const hx = px + dx * tt, hz = pz + dz * tt;
      if (hx * hx + hz * hz <= r * r) best = { t: tt, nx: 0, ny: 1, nz: 0 };
    }
  }
  return best;
}

/** Ray vs axis-aligned box (slab method). Returns entering t and surface normal. */
export function rayBox(
  ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: Box,
): { t: number; nx: number; ny: number; nz: number } | null {
  let tmin = -Infinity, tmax = Infinity, nx = 0, ny = 0, nz = 0;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  const mn = [b.minX, b.minY, b.minZ], mx = [b.maxX, b.maxY, b.maxZ];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < mn[i] || o[i] > mx[i]) return null;
    } else {
      let t1 = (mn[i] - o[i]) / d[i], t2 = (mx[i] - o[i]) / d[i];
      let sign = -1; // entering through the min face -> normal points to -axis
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sign = 1; }
      if (t1 > tmin) {
        tmin = t1;
        nx = ny = nz = 0;
        if (i === 0) nx = sign; else if (i === 1) ny = sign; else nz = sign;
      }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
  }
  if (tmax < 0) return null;
  if (tmin < 0) {
    // origin inside the box: report an immediate hit pushing back against the dominant direction
    const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
    if (ax >= ay && ax >= az) return { t: 0, nx: -Math.sign(dx), ny: 0, nz: 0 };
    if (ay >= az) return { t: 0, nx: 0, ny: -Math.sign(dy), nz: 0 };
    return { t: 0, nx: 0, ny: 0, nz: -Math.sign(dz) };
  }
  return { t: tmin, nx, ny, nz };
}

export class World {
  boxes: Box[] = [];
  cyls: Cyl[] = [];

  addBox(cx: number, cz: number, w: number, d: number, h: number, y0 = 0): Box {
    const b = { minX: cx - w / 2, maxX: cx + w / 2, minY: y0, maxY: y0 + h, minZ: cz - d / 2, maxZ: cz + d / 2 };
    this.boxes.push(b);
    return b;
  }
  addCyl(x: number, z: number, r: number, h: number, y0 = 0): Cyl {
    const c = { x, z, r, y0, y1: y0 + h };
    this.cyls.push(c);
    return c;
  }

  /** Push a circle (x,z,r) out of every collider, then clamp inside the arena. */
  resolve(p: { x: number; z: number }, r: number): void {
    for (let iter = 0; iter < 2; iter++) {
      for (const b of this.boxes) {
        if (b.minY > 1.0) continue;
        const cx = Math.max(b.minX, Math.min(p.x, b.maxX));
        const cz = Math.max(b.minZ, Math.min(p.z, b.maxZ));
        let dx = p.x - cx, dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 < r * r) {
          if (d2 < 1e-9) {
            // centre is inside the box: exit through the nearest face
            const l = p.x - b.minX, rr = b.maxX - p.x, t = p.z - b.minZ, bt = b.maxZ - p.z;
            const m = Math.min(l, rr, t, bt);
            if (m === l) p.x = b.minX - r; else if (m === rr) p.x = b.maxX + r;
            else if (m === t) p.z = b.minZ - r; else p.z = b.maxZ + r;
          } else {
            const d = Math.sqrt(d2);
            p.x += (dx / d) * (r - d);
            p.z += (dz / d) * (r - d);
          }
        }
      }
      for (const c of this.cyls) {
        const dx = p.x - c.x, dz = p.z - c.z;
        const d = Math.hypot(dx, dz);
        const min = c.r + r;
        if (d < min) {
          const nx = d < 1e-6 ? 1 : dx / d, nz = d < 1e-6 ? 0 : dz / d;
          p.x = c.x + nx * min;
          p.z = c.z + nz * min;
        }
      }
    }
    const lim = ARENA_HALF - r;
    p.x = Math.max(-lim, Math.min(lim, p.x));
    p.z = Math.max(-lim, Math.min(lim, p.z));
  }

  /** Nearest static hit along a ray (floor and ceiling included). dir must be normalised. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): RayHit | null {
    let best: RayHit | null = null;
    const consider = (h: { t: number; nx: number; ny: number; nz: number } | null, kind: RayHit['kind']) => {
      if (h && h.t <= maxT && (!best || h.t < best.t)) best = { ...h, kind };
    };
    for (const b of this.boxes) consider(rayBox(ox, oy, oz, dx, dy, dz, b), 'wall');
    for (const c of this.cyls) consider(rayCylinder(ox, oy, oz, dx, dy, dz, c.x, c.z, c.r, c.y0, c.y1), 'wall');
    if (dy < -1e-9) { const t = (0 - oy) / dy; if (t >= 0) consider({ t, nx: 0, ny: 1, nz: 0 }, 'floor'); }
    if (dy > 1e-9) { const t = (CEILING_Y - oy) / dy; if (t >= 0) consider({ t, nx: 0, ny: -1, nz: 0 }, 'ceiling'); }
    return best;
  }

  /** True when a wall/prop sits between two points. */
  blocked(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return false;
    for (const b of this.boxes) {
      const h = rayBox(ax, ay, az, dx / len, dy / len, dz / len, b);
      if (h && h.t < len) return true;
    }
    for (const c of this.cyls) {
      const h = rayCylinder(ax, ay, az, dx / len, dy / len, dz / len, c.x, c.z, c.r, c.y0, c.y1);
      if (h && h.t < len) return true;
    }
    return false;
  }

  clearPoint(x: number, z: number, margin: number): boolean {
    if (Math.abs(x) > ARENA_HALF - margin || Math.abs(z) > ARENA_HALF - margin) return false;
    for (const b of this.boxes) {
      if (b.minY > 1.0) continue;
      if (x > b.minX - margin && x < b.maxX + margin && z > b.minZ - margin && z < b.maxZ + margin) return false;
    }
    for (const c of this.cyls) if (Math.hypot(x - c.x, z - c.z) < c.r + margin) return false;
    return true;
  }

  randomPoint(margin = 1.0, rnd: () => number = Math.random): { x: number; z: number } {
    for (let i = 0; i < 60; i++) {
      const x = (rnd() * 2 - 1) * (ARENA_HALF - 2), z = (rnd() * 2 - 1) * (ARENA_HALF - 2);
      if (this.clearPoint(x, z, margin)) return { x, z };
    }
    return { x: 0, z: 7 };
  }
}
