import * as THREE from 'three';
import { BALCONY, GOLF_HOLE, SLAB, STOREY, STREET_Y, WALL_HEIGHT } from '../../../shared/layout';
import { neighbourBoxes } from '../../world/outside';
import { B, CUP, CUP_SPEED, GROUND, lieAt, type Lie } from './course';
import { AIM_MAX, BALL_R, LOFT_MAX, LOFT_MIN, SPEED, TEE_BALL, type Shot } from './shot';

// ---- A ball on its way ------------------------------------------------------------------------------

/** Steps a second the flight's worked out in, and every how many of them the path keeps a point (60 a second). */
export const STEPS = 240;
export const KEEP = 4;
const GRAVITY = 9.81;
/** Air slows it a little. */
const DRAG = 0.05;
/** Coming down slower than this, it stops bouncing and rolls. */
const ROLL_V = 1.2;
/** Longest a ball's followed. */
const MAX_SECONDS = 25;
/** The top of the balcony's railing, and the balcony inside it that a ball rattles round (its center, at least). */
const RAIL_TOP = 1.11;
const INSIDE = { minX: BALCONY.minX + 0.12 + BALL_R, maxX: BALCONY.maxX - 0.12 - BALL_R, minZ: BALCONY.minZ + BALL_R, maxZ: BALCONY.maxZ - 0.12 - BALL_R };

export interface Hit {
  /** Seconds after the shot. */
  t: number;
  kind: 'bounce' | 'rail' | 'wall' | 'cup';
  at: THREE.Vector3;
  /** How hard, in m/s. */
  speed: number;
  lie?: Lie;
}

export interface Flight {
  shot: Shot;
  /** Where the ball is, every 1/60 s from the moment it's hit: x, y, z. */
  path: Float32Array;
  hits: Hit[];
  /** From the hit until it stops. */
  seconds: number;
  rest: THREE.Vector3;
  holed: boolean;
  /** What it stopped on; `lost` is off out of the world. */
  lie: Lie | 'lost';
  /** How far from the pin it stopped, or NaN if it isn't down on the street. */
  fromPin: number;
}

/**
 * Where a shot goes, from the tee on a floor `index` up the building (the street is `street` below
 * it): up off the tee, over the railing (or off it), down onto the street, a roof or a balcony
 * further down, bouncing and rolling to a stop, or into the cup. The same shot always goes the same
 * way, so the one number sent round is enough for everyone to see it.
 */
export function fly(shot: Shot, street: number, index: number): Flight {
  const power = THREE.MathUtils.clamp(shot.power, 0, 1);
  const loft = THREE.MathUtils.clamp(shot.loft, LOFT_MIN, LOFT_MAX);
  const yaw = THREE.MathUtils.clamp(shot.yaw, -AIM_MAX, AIM_MAX);
  const v = SPEED * power;
  let x = TEE_BALL.x;
  let y = TEE_BALL.y;
  let z = TEE_BALL.z;
  let vx = v * Math.cos(loft) * Math.sin(yaw);
  let vy = v * Math.sin(loft);
  let vz = v * Math.cos(loft) * Math.cos(yaw);
  const dt = 1 / STEPS;
  const path: number[] = [x, y, z];
  const hits: Hit[] = [];
  // The neighbours stand on the street; the building's floors above its garage stand in the way too.
  const boxes = [
    ...neighbourBoxes().map((n) => ({ ...n, bottom: street, top: street + n.top, roof: true })),
    { ...B, bottom: street - STREET_Y - SLAB, top: Infinity, roof: false },
  ];
  let rolling = false;
  let holed = false;
  let lie: Lie | 'lost' = 'rough';
  let step = 0;
  const hit = (kind: Hit['kind'], speed: number, at?: Lie) => hits.push({ t: step * dt, kind, at: new THREE.Vector3(x, y, z), speed, lie: at });

  /** What's under the ball at (x, z), coming down from `from`: the ground, a neighbour's roof, or a balcony. */
  const under = (px: number, pz: number, from: number): [number, Lie] => {
    if (px > BALCONY.minX && px < BALCONY.maxX && pz > BALCONY.minZ && pz < BALCONY.maxZ) {
      // This floor's balcony, or one further down the building.
      for (let k = 0; k <= index; k++) {
        const deck = -k * STOREY;
        if (from > deck - 0.1) return [deck, k ? 'below' : 'deck'];
      }
    }
    for (const b of boxes) if (b.roof && px > b.minX && px < b.maxX && pz > b.minZ && pz < b.maxZ && from > b.top - 0.1) return [b.top, 'roof'];
    return [street, lieAt(px, pz)];
  };

  for (; step < MAX_SECONDS * STEPS; step++) {
    if (!rolling) {
      vy -= GRAVITY * dt;
      const k = 1 - DRAG * dt;
      vx *= k;
      vy *= k;
      vz *= k;
    }
    let nx = x + vx * dt;
    let ny = y + vy * dt;
    let nz = z + vz * dt;

    // Round the balcony: the railing on three sides, as high as its top, and the wall behind.
    if (x > INSIDE.minX - 0.01 && x < INSIDE.maxX + 0.01 && z > INSIDE.minZ - 0.01 && z < INSIDE.maxZ + 0.01 && y > -0.2 && y < WALL_HEIGHT) {
      if (ny < RAIL_TOP + BALL_R) {
        if (nz > INSIDE.maxZ) {
          nz = INSIDE.maxZ;
          hit('rail', Math.abs(vz));
          vz = -vz * 0.35;
          vx *= 0.8;
        }
        if (nx < INSIDE.minX || nx > INSIDE.maxX) {
          nx = THREE.MathUtils.clamp(nx, INSIDE.minX, INSIDE.maxX);
          hit('rail', Math.abs(vx));
          vx = -vx * 0.35;
          vz *= 0.8;
        }
      }
      if (nz < INSIDE.minZ) {
        nz = INSIDE.minZ;
        hit('wall', Math.abs(vz));
        vz = -vz * 0.3;
        vx *= 0.8;
      }
    }
    // Off the side of a building.
    for (const b of boxes) {
      if (nx <= b.minX || nx >= b.maxX || nz <= b.minZ || nz >= b.maxZ || ny >= b.top || ny <= b.bottom) continue;
      if (y >= b.top) continue; // onto its roof: that's the ground, below
      if (x <= b.minX || x >= b.maxX) {
        nx = x <= b.minX ? b.minX : b.maxX;
        hit('wall', Math.abs(vx));
        vx = -vx * 0.35;
        vz *= 0.7;
      } else {
        nz = z <= b.minZ ? b.minZ : b.maxZ;
        hit('wall', Math.abs(vz));
        vz = -vz * 0.35;
        vx *= 0.7;
      }
    }

    const [floor, on] = under(nx, nz, y - BALL_R);
    x = nx;
    y = ny;
    z = nz;
    if (y - BALL_R <= floor) {
      y = floor + BALL_R;
      lie = on;
      if (on === 'below') {
        // Onto a balcony further down: it's not coming back from there.
        hit('bounce', -vy, on);
        break;
      }
      const g = GROUND[on];
      const pin = Math.hypot(x - GOLF_HOLE.x, z - GOLF_HOLE.z);
      if (-vy > ROLL_V) {
        // Straight into the cup.
        if (on === 'green' && pin < CUP) {
          holed = true;
          break;
        }
        hit('bounce', -vy, on);
        vy = -vy * g.bounce;
        vx *= g.keep;
        vz *= g.keep;
        rolling = false;
      } else {
        vy = 0;
        rolling = true;
        const speed = Math.hypot(vx, vz);
        if (on === 'green' && pin < CUP && speed < CUP_SPEED) {
          holed = true;
          break;
        }
        const slow = g.roll * dt;
        if (speed <= slow) break;
        vx *= (speed - slow) / speed;
        vz *= (speed - slow) / speed;
      }
    } else if (rolling && y - BALL_R > floor + 0.01) rolling = false; // off an edge
    if (Math.abs(x) > 190 || Math.abs(z) > 190 || y < street - 1) {
      lie = 'lost';
      break;
    }
    if ((step + 1) % KEEP === 0) path.push(x, y, z);
  }
  if (holed) {
    // Down into the cup.
    x = GOLF_HOLE.x;
    z = GOLF_HOLE.z;
    y = street + BALL_R - 0.12;
    lie = 'green';
    hit('cup', 0, 'green');
  }
  path.push(x, y, z);
  const down = lie !== 'lost' && lie !== 'deck' && lie !== 'roof' && lie !== 'below';
  return {
    shot: { yaw, loft, power },
    path: Float32Array.from(path),
    hits,
    seconds: (path.length / 3 - 1) / (STEPS / KEEP),
    rest: new THREE.Vector3(x, y, z),
    holed,
    lie,
    fromPin: holed ? 0 : down ? Math.hypot(x - GOLF_HOLE.x, z - GOLF_HOLE.z) : NaN,
  };
}

/** A distance to the pin, as it's read out: "40 cm", "3.4 m", "27 m". */
export function pinText(m: number): string {
  if (m < 1) return `${Math.round(m * 100)} cm`;
  return m < 10 ? `${m.toFixed(1)} m` : `${Math.round(m)} m`;
}

/** Where a ball stopped, in words. */
export function lieText(f: Flight): string {
  if (f.holed) return 'In the hole!';
  switch (f.lie) {
    case 'lost':
      return 'Lost';
    case 'deck':
      return "Didn't clear the railing";
    case 'below':
      return 'Onto the balcony below';
    case 'roof':
      return 'On the roof';
    case 'sand':
      return `In the bunker · ${pinText(f.fromPin)}`;
    case 'green':
      return `On the green · ${pinText(f.fromPin)}`;
    default:
      return `${pinText(f.fromPin)} from the pin`;
  }
}

