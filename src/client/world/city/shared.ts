import * as THREE from 'three';
import { FLOOR, WALL_T, roofDrop } from '../../../shared/layout';

/** The building, walls included. */
export const B = { minX: FLOOR.minX - WALL_T, maxX: FLOOR.maxX + WALL_T, minZ: FLOOR.minZ - WALL_T, maxZ: FLOOR.maxZ + WALL_T } as const;
/** A block and the street beside it; streets run down x = 28 + 56k and z = 27 + 56k. */
export const PERIOD = 56;
export const STREET_X = 28;
export const STREET_Z = 27;
/** The road, and a sidewalk either side. */
export const ROAD = 8;
export const WALK = 2;
/** How far out the city goes: past this the haze has it anyway. */
export const RADIUS = 330;
/** One storey, and one bay of windows, in meters. */
export const STOREY = 3.3;
export const BAY = 2.8;
/** How far down the street was from the roof the neighbours' heights were picked for: six floors. */
export const LAID_OUT = roofDrop(6);

export interface City {
  group: THREE.Group;
  /**
   * The building has `floors` floors under the roof: the street goes as far down as that is tall,
   * and the buildings nearby come down to stay under the roof.
   */
  setFloors(floors: number, wings?: readonly number[]): void;
  /** The cars along the streets, the blinking lights on the towers: `night` is how dark it is (0–1). */
  update(t: number, dt: number, night: number): void;
}

/** How a building's walls look: its paint, and the windows in it (glass towers are nearly all window). */
export interface Paint {
  wall: string;
  glass: string;
  /** The window's share of a bay across and of a storey up. */
  wide: number;
  tall: number;
}

export const PAINTS: Paint[] = [
  { wall: '#d9a27e', glass: '#a9d6f5', wide: 0.5, tall: 0.55 },
  { wall: '#c96f5a', glass: '#b8e0f7', wide: 0.45, tall: 0.55 },
  { wall: '#e9dcc3', glass: '#9cc9ea', wide: 0.55, tall: 0.6 },
  { wall: '#b9c0c9', glass: '#bfe3ff', wide: 0.6, tall: 0.55 },
  { wall: '#a7c4d9', glass: '#e6f4ff', wide: 0.5, tall: 0.6 },
  { wall: '#e8b4b8', glass: '#bfe3ff', wide: 0.5, tall: 0.55 },
  { wall: '#f1e3b3', glass: '#a9d6f5', wide: 0.45, tall: 0.5 },
  // Glass towers.
  { wall: '#4f6d8a', glass: '#7fb8d8', wide: 0.9, tall: 0.82 },
  { wall: '#3e7c7c', glass: '#8fd3d0', wide: 0.9, tall: 0.82 },
];
export const GLASS_TOWERS = [7, 8];

/**
 * A building on a lot, as it was laid out round a roof LAID_OUT up. How much of that height it
 * stands depends on how far out it is (`ring`: close by, further out, or on the skyline) and on how
 * tall the office's building is (see rise).
 */
export interface Lot {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  paint: number;
  /** Where its lit windows start in the pattern. */
  ou: number;
  ov: number;
  ring: 0 | 1 | 2;
  /** Tall ones step back on the way up: the top part's footprint, and how much taller it goes. */
  step?: { w: number; d: number; up: number };
  /** On its roof: a mast with a red light, a water tower, or a box of air conditioning. */
  top?: { kind: 'mast' } | { kind: 'tank'; x: number; z: number } | { kind: 'plant'; x: number; z: number; w: number; d: number };
}

/**
 * How much of its laid-out height a building in `ring` stands with the street `drop` below the roof.
 * Close by they come down with the roof, to stay under it; further out a bit less, and the skyline
 * stays the skyline. Up to six floors, where they were laid out; no taller past that.
 */
export function rise(ring: number, drop: number): number {
  const k = Math.min(1, drop / LAID_OUT);
  return ring === 0 ? k : ring === 1 ? Math.sqrt(k) : 1;
}

export interface Car {
  /** Along x (true) or z. */
  alongX: boolean;
  /** The lane's line across the street, and which way it drives (±1). */
  lane: number;
  dir: number;
  at: number;
  speed: number;
}
