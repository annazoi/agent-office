import { FLOOR, GOLF_HOLE, ROAD, WALL_T } from '../../../shared/building/layout';

// The course across the street: where the green, fairway and bunkers are, and what a ball comes down on.

// ---- The course -------------------------------------------------------------------------------------

/** The green's collar of longer grass. */
export const FRINGE = 0.7;
/** The fairway starts past the far sidewalk. */
export const FAIRWAY_Z0 = ROAD.maxZ + 2.5;
/** Sand traps round the green: [x, z, radius]. The first two make one kidney-shaped trap in front. */
export const BUNKERS: [number, number, number][] = [
  [GOLF_HOLE.x - 5.4, GOLF_HOLE.z - 4.4, 1.7],
  [GOLF_HOLE.x - 3.7, GOLF_HOLE.z - 5.7, 1.25],
  [GOLF_HOLE.x + 5.6, GOLF_HOLE.z + 3.2, 1.6],
];
/** How far from the pin a ball drops in: rolling in slower than CUP_SPEED, or landing straight in. */
export const CUP = 0.12;
export const CUP_SPEED = 1.8;
/** The flagstick, taller than a real one so it shows up from the balcony. */
export const STICK = 3.4;

/** What a ball can come down on. `below` is a balcony further down the building. */
export type Lie = 'green' | 'fringe' | 'fairway' | 'rough' | 'sand' | 'road' | 'deck' | 'roof' | 'below';

/** How each surface takes a ball: how much of its fall it bounces back up, how much speed along it keeps on a bounce, and how fast it slows a rolling ball (m/s²). */
export const GROUND: Record<Lie, { bounce: number; keep: number; roll: number }> = {
  green: { bounce: 0.28, keep: 0.45, roll: 2.5 },
  fringe: { bounce: 0.28, keep: 0.45, roll: 3.2 },
  fairway: { bounce: 0.32, keep: 0.55, roll: 2.4 },
  rough: { bounce: 0.22, keep: 0.35, roll: 5.5 },
  sand: { bounce: 0.04, keep: 0.1, roll: 20 },
  road: { bounce: 0.5, keep: 0.8, roll: 1.1 },
  deck: { bounce: 0.42, keep: 0.7, roll: 1.8 },
  roof: { bounce: 0.42, keep: 0.7, roll: 1.8 },
  below: { bounce: 0, keep: 0, roll: 99 },
};

/** The building, walls included. */
export const B = { minX: FLOOR.minX - WALL_T, maxX: FLOOR.maxX + WALL_T, minZ: FLOOR.minZ - WALL_T, maxZ: FLOOR.maxZ + WALL_T } as const;

/** What's underfoot at (x, z) down on the street. */
export function lieAt(x: number, z: number): Lie {
  for (const [bx, bz, r] of BUNKERS) if (Math.hypot(x - bx, z - bz) < r) return 'sand';
  const d = Math.hypot(x - GOLF_HOLE.x, z - GOLF_HOLE.z);
  if (d < GOLF_HOLE.green) return 'green';
  if (d < GOLF_HOLE.green + FRINGE) return 'fringe';
  if (x > GOLF_HOLE.fairway[0] && x < GOLF_HOLE.fairway[1] && z > FAIRWAY_Z0 && z < GOLF_HOLE.z) return 'fairway';
  // The road and its sidewalks, the lot out front, the one beside the building, and the garage under it.
  if (z > ROAD.minZ - 2 && z < ROAD.maxZ + 2) return 'road';
  if (Math.abs(x) < 30 && z > B.minZ && z < ROAD.minZ - 2) return 'road';
  if (x > B.maxX && x < B.maxX + 12 && z > B.minZ - 2 && z < B.maxZ + 4) return 'road';
  return 'rough';
}
