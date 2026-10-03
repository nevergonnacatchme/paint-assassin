// Procedural art-gallery / loft studio: wooden floor, plaster walls with framed art, partitions, crates,
// statue pedestals, studio spotlights and the central Emergency Meeting table with its big red button.
import * as THREE from 'three';
import { World, ARENA_HALF as H, CEILING_Y } from './world';
import { PARTITIONS, CRATES, PEDESTALS, TABLE, PERIMETER, WALL_H, addArenaColliders } from './layout';
import { makeWoodTexture, makePlasterTexture, makeArtTexture, makeRugTexture, makeGlowTexture } from './textures';
import { std } from './models';

export interface ArenaHandles {
  root: THREE.Group;
  textures: THREE.Texture[];
  update(dt: number, time: number, alarm: boolean): void;
}

export function buildArena(scene: THREE.Scene, world: World): ArenaHandles {
  const root = new THREE.Group(); scene.add(root);
  addArenaColliders(world); // collision shapes come from the shared layout (also used by the server)
  const textures: THREE.Texture[] = [];
  const spinners: THREE.Object3D[] = [];
  const track = <T extends THREE.Texture>(t: T): T => { textures.push(t); return t; };

  // ---- lights (indoor studio look; intensities follow three's physically-based units)
  root.add(new THREE.AmbientLight('#ffffff', 0.8));
  root.add(new THREE.HemisphereLight('#fff7ff', '#d9d2ff', 1.0));
  const sun = new THREE.DirectionalLight('#fff4e5', 1.8);
  sun.position.set(12, 26, 10); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03;
  Object.assign(sun.shadow.camera, { left: -27, right: 27, top: 27, bottom: -27, near: 1, far: 70 });
  sun.shadow.camera.updateProjectionMatrix(); // required after changing the orthographic bounds
  root.add(sun);

  // ---- floor + rug
  const floorTex = track(makeWoodTexture(H / 2));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), std('#ffffff', { map: floorTex, roughness: 0.55 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; root.add(floor);
  const rug = new THREE.Mesh(new THREE.CircleGeometry(5.8, 64), std('#ffffff', { map: track(makeRugTexture()), roughness: 0.9 }));
  rug.rotation.x = -Math.PI / 2; rug.position.y = 0.012; rug.receiveShadow = true; root.add(rug);

  // ---- perimeter walls (+ colliders)
  const plaster = track(makePlasterTexture(12, 1.6));
  const wallMat = std('#ffffff', { map: plaster, roughness: 0.95 });
  for (const [x, z, w, d] of PERIMETER) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, d), wallMat); m.position.set(x, WALL_H / 2, z); m.receiveShadow = true; root.add(m);
  }
  const band = std('#d6dcff', { roughness: 0.8 }), base = std('#ffffff', { roughness: 0.6 });
  const trim = (x: number, z: number, w: number, d: number, h: number, y: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.receiveShadow = true; root.add(m);
  };
  trim(0, -H + 0.03, 2 * H, 0.06, 1.1, 0.55, band); trim(0, H - 0.03, 2 * H, 0.06, 1.1, 0.55, band);
  trim(-H + 0.03, 0, 0.06, 2 * H, 1.1, 0.55, band); trim(H - 0.03, 0, 0.06, 2 * H, 1.1, 0.55, band);
  trim(0, -H + 0.05, 2 * H, 0.1, 0.2, 0.1, base); trim(0, H - 0.05, 2 * H, 0.1, 0.2, 0.1, base);
  trim(-H + 0.05, 0, 0.1, 2 * H, 0.2, 0.1, base); trim(H - 0.05, 0, 0.1, 2 * H, 0.2, 0.1, base);

  // ---- framed paintings on the walls
  const arts = Array.from({ length: 6 }, (_, i) => track(makeArtTexture(i + 1)));
  const frameMat = std('#3a3f5c', { roughness: 0.5 });
  let n = 0;
  const frame = (x: number, z: number, rotY: number) => {
    const g = new THREE.Group(); g.position.set(x, 2.7, z); g.rotation.y = rotY;
    const f = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.5, 0.08), frameMat); f.castShadow = true; g.add(f);
    const art = new THREE.Mesh(new THREE.PlaneGeometry(1.75, 2.2), std('#ffffff', { map: arts[n++ % arts.length], roughness: 0.9 })); art.position.z = 0.045; g.add(art);
    root.add(g);
  };
  for (const t of [-12, 0, 12]) {
    frame(t, -H + 0.06, 0); frame(t, H - 0.06, Math.PI);
    frame(-H + 0.06, t, Math.PI / 2); frame(H - 0.06, t, -Math.PI / 2);
  }

  // ---- ceiling, beams and studio spotlights
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(H * 2, H * 2), std('#fffaf6', { roughness: 1 }));
  ceil.rotation.x = Math.PI / 2; ceil.position.y = CEILING_Y; root.add(ceil);
  const beamMat = std('#e8e1f7', { roughness: 0.8 });
  for (const z of [-16, -8, 0, 8, 16]) trim(0, z, 2 * H, 0.5, 0.45, CEILING_Y - 0.22, beamMat);
  const glow = track(makeGlowTexture());
  const spot = (x: number, z: number, tx: number, tz: number, color: string, intensity: number) => {
    const fx = new THREE.Group(); fx.position.set(x, CEILING_Y - 0.45, z);
    fx.add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.34, 14), std('#2a2d3c', { metalness: 0.6, roughness: 0.4 })));
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8), new THREE.MeshBasicMaterial({ color })); bulb.position.y = -0.2; fx.add(bulb);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending })); halo.scale.set(1.4, 1.4, 1); halo.position.y = -0.2; fx.add(halo);
    root.add(fx);
    const sl = new THREE.SpotLight(color, intensity, 0, 0.55, 0.65, 2);
    sl.position.set(x, CEILING_Y - 0.6, z); sl.target.position.set(tx, 1, tz); root.add(sl); root.add(sl.target);
  };
  spot(0, 0, 0, 0, '#fff6e8', 55);
  spot(-14, -15, -14, -15, '#ffe2c4', 32); spot(14, -15, 14, -15, '#d9e8ff', 32);
  spot(-14, 15, -14, 15, '#ffd9ec', 32); spot(14, 15, 14, 15, '#e0ffe8', 32);

  // ---- partitions (galleries), crates, statue pedestals
  const partMat = std('#ece6ff', { roughness: 0.85 }), partTop = std('#c9bff0', { roughness: 0.7 });
  const partition = (x: number, z: number, w: number, d: number, h: number) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), partMat); m.position.set(x, h / 2, z); m.castShadow = m.receiveShadow = true; root.add(m);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.12, d + 0.1), partTop); cap.position.set(x, h + 0.06, z); cap.castShadow = true; root.add(cap);
  };
  for (const [x, z, w, d, h] of PARTITIONS) partition(x, z, w, d, h);

  const crateCols = ['#ffd6a5', '#bde0fe', '#ffc8dd', '#caffbf'];
  CRATES.forEach(([x, z], i) => {
    const c = new THREE.Mesh(new THREE.BoxGeometry(2, 1.3, 2), std(crateCols[i], { roughness: 0.7 })); c.position.set(x, 0.65, z); c.castShadow = c.receiveShadow = true; root.add(c);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.12, 2.04), std('#ffffff')); strap.position.set(x, 0.9, z); root.add(strap);
  });

  const pedMat = std('#f7f7fb', { roughness: 0.3 });
  const statues: [number, number, () => THREE.Mesh][] = [
    [PEDESTALS[0][0], PEDESTALS[0][1], () => new THREE.Mesh(new THREE.TorusKnotGeometry(0.4, 0.13, 100, 16), std('#b39ddb', { metalness: 0.5, roughness: 0.25 }))],
    [PEDESTALS[1][0], PEDESTALS[1][1], () => new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 1), std('#ff9e9e', { roughness: 0.3, flatShading: true }))],
    [PEDESTALS[2][0], PEDESTALS[2][1], () => new THREE.Mesh(new THREE.OctahedronGeometry(0.6), std('#7fdbca', { metalness: 0.4, roughness: 0.25, flatShading: true }))],
    [PEDESTALS[3][0], PEDESTALS[3][1], () => new THREE.Mesh(new THREE.DodecahedronGeometry(0.55), std('#8ecae6', { metalness: 0.4, roughness: 0.25, flatShading: true }))],
  ];
  for (const [x, z, make] of statues) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 1.4), pedMat); p.position.set(x, 0.6, z); p.castShadow = p.receiveShadow = true; root.add(p);
    const s = make(); s.position.set(x, 1.95, z); s.castShadow = true; root.add(s); spinners.push(s);
  }

  // ---- central Emergency Meeting table + big red button
  const tableMat = std('#ffffff', { roughness: 0.25 });
  const top = new THREE.Mesh(new THREE.CylinderGeometry(TABLE.r - 0.1, TABLE.r - 0.1, 0.12, 48), tableMat); top.position.y = 0.9; top.castShadow = top.receiveShadow = true; root.add(top);
  const inlay = new THREE.Mesh(new THREE.TorusGeometry(2.0, 0.035, 8, 64), std('#7c83fd')); inlay.rotation.x = Math.PI / 2; inlay.position.y = 0.97; root.add(inlay);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 0.85, 24), std('#e9e6fb')); stem.position.y = 0.45; stem.castShadow = true; root.add(stem);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.3, 0.08, 32), std('#c9ccd8')); foot.position.y = 0.04; root.add(foot);
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.66, 0.1, 28), std('#c9ccd8', { metalness: 0.6, roughness: 0.3 })); plate.position.y = 1.01; root.add(plate);
  const buttonMat = std('#ff3b5c', { emissive: '#ff1744', emissiveIntensity: 0.5, roughness: 0.25 });
  const button = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.18, 28), buttonMat); button.position.y = 1.1; button.castShadow = true; root.add(button);
  const buttonLight = new THREE.PointLight('#ff3b5c', 4, 7, 2); buttonLight.position.set(0, 1.9, 0); root.add(buttonLight);

  return {
    root, textures,
    update(dt, time, alarm) {
      spinners.forEach((s, i) => { s.rotation.y += dt * (0.5 + i * 0.1); s.rotation.x += dt * 0.15; });
      const k = alarm ? 1.4 + Math.sin(time * 14) * 1.2 : 0.55 + Math.sin(time * 2.4) * 0.35;
      buttonMat.emissiveIntensity = Math.max(0.1, k);
      buttonLight.intensity = alarm ? 8 + Math.sin(time * 14) * 6 : 3 + Math.sin(time * 2.4) * 1.5;
      button.position.y = 1.1 - (alarm ? 0.06 : 0);
    },
  };
}
