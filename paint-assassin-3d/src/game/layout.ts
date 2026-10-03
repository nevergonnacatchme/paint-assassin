// Arena layout shared by the renderer (arena.ts) and the server (collision / line-of-sight checks).
import { World, ARENA_HALF as H } from './world';

/** [x, z, width, depth, height] */
export const PARTITIONS: [number, number, number, number, number][] = [
  [-10, -8, 8, 1, 2.6], [10, -8, 8, 1, 2.6], [-10, 8, 8, 1, 2.6], [10, 8, 8, 1, 2.6], [-17, 0, 1.2, 8, 2.6], [17, 0, 1.2, 8, 2.6],
];
export const CRATES: [number, number][] = [[-5, -14], [5, -14], [-5, 14], [5, 14]]; // 2 x 1.3 x 2
export const PEDESTALS: [number, number][] = [[-14, -15], [14, -15], [-14, 15], [14, 15]]; // 1.4 x 1.2 x 1.4
export const TABLE = { r: 2.3, h: 0.96 };
export const PERIMETER: [number, number, number, number][] = [
  [0, -H - 1, H * 2 + 4, 2], [0, H + 1, H * 2 + 4, 2], [-H - 1, 0, 2, H * 2 + 4], [H + 1, 0, 2, H * 2 + 4],
];
export const WALL_H = 6.5;

export function addArenaColliders(world: World): void {
  for (const [x, z, w, d] of PERIMETER) world.addBox(x, z, w, d, WALL_H);
  for (const [x, z, w, d, h] of PARTITIONS) world.addBox(x, z, w, d, h + 0.12);
  for (const [x, z] of CRATES) world.addBox(x, z, 2, 2, 1.3);
  for (const [x, z] of PEDESTALS) world.addBox(x, z, 1.4, 1.4, 1.2);
  world.addCyl(0, 0, TABLE.r, TABLE.h);
}

export function makeArenaWorld(): World { const w = new World(); addArenaColliders(w); return w; }
