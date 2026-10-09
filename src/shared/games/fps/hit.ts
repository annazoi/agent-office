// Where a shot goes and what it hits, as pure arithmetic both sides run: the page to draw the tracer
// and the mark on the wall, the office to decide who was hit and for how much. Nobody sends a hit;
// everybody sends where they were aiming, and the office shoots the ray itself.

import { ARENA_BOXES, type Box } from './arena.js';
import type { HitPart } from './weapons.js';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** How tall someone is standing and crouched, where their eyes are, and how wide they are. */
export const STAND_H = 1.8;
export const CROUCH_H = 1.25;
export const EYE = 0.92;
export const BODY_R = 0.38;
/** The top of this much of them is a leg hit; above the shoulders is a head hit. */
export const LEGS_H = 0.42;
export const HEAD_H = 0.26;

/** Someone a shot can hit: where their feet are and how tall they are right now. */
export interface Target {
  id: string;
  x: number;
  y: number;
  z: number;
  crouching?: boolean;
}

/** How high someone's eyes are above their feet. */
export const eyeHeight = (crouching?: boolean): number => (crouching ? CROUCH_H : STAND_H) - (STAND_H - EYE) * (crouching ? 0.55 : 1);

/** Where someone is looking from. */
export const eyeOf = (t: Target): Vec3 => ({ x: t.x, y: t.y + eyeHeight(t.crouching), z: t.z });

/** A direction from a yaw (0 is -z, the way the office faces) and a pitch (up is positive). */
export function dirOf(yaw: number, pitch: number): Vec3 {
  const c = Math.cos(pitch);
  return { x: -Math.sin(yaw) * c, y: Math.sin(pitch), z: -Math.cos(yaw) * c };
}

/** `dir` turned by `yaw` about the up axis and `pitch` about its own side: how a stray shot leaves the barrel. */
export function stray(yaw: number, pitch: number, dYaw: number, dPitch: number): Vec3 {
  return dirOf(yaw + dYaw, Math.max(-1.5, Math.min(1.5, pitch + dPitch)));
}

/** How far along `dir` from `from` the ray first meets `b`, or Infinity. */
export function rayBox(from: Vec3, dir: Vec3, b: Box): number {
  let near = 0;
  let far = Infinity;
  const slab = (o: number, d: number, lo: number, hi: number) => {
    if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
    const t0 = (lo - o) / d;
    const t1 = (hi - o) / d;
    near = Math.max(near, Math.min(t0, t1));
    far = Math.min(far, Math.max(t0, t1));
    return far >= near;
  };
  if (!slab(from.x, dir.x, b.minX, b.maxX)) return Infinity;
  if (!slab(from.y, dir.y, b.y, b.top)) return Infinity;
  if (!slab(from.z, dir.z, b.minZ, b.maxZ)) return Infinity;
  return far >= Math.max(0, near) ? near : Infinity;
}

/** How far along `dir` the arena itself stops the ray (the walls, the crates), or `max`. */
export function rayWorld(from: Vec3, dir: Vec3, max = 200, boxes: readonly Box[] = ARENA_BOXES): number {
  let hit = max;
  for (const b of boxes) {
    const t = rayBox(from, dir, b);
    if (t < hit) hit = t;
  }
  return hit;
}

/** Whether nothing in the arena stands between the two points. */
export function canSee(from: Vec3, to: Vec3, boxes: readonly Box[] = ARENA_BOXES): boolean {
  const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  const len = Math.hypot(d.x, d.y, d.z);
  if (len < 1e-6) return true;
  const dir = { x: d.x / len, y: d.y / len, z: d.z / len };
  return rayWorld(from, dir, len, boxes) >= len - 1e-3;
}

/** Where a shot met someone: how far along the ray, and what part of them it was. */
export interface BodyHit {
  t: number;
  part: HitPart;
}

/** Whether (and where) the ray meets `who`, who is a standing cylinder BODY_R wide. */
export function rayBody(from: Vec3, dir: Vec3, who: Target, max: number): BodyHit | null {
  const h = who.crouching ? CROUCH_H : STAND_H;
  const ox = from.x - who.x;
  const oz = from.z - who.z;
  const a = dir.x * dir.x + dir.z * dir.z;
  const b = 2 * (ox * dir.x + oz * dir.z);
  const c = ox * ox + oz * oz - BODY_R * BODY_R;
  let t: number;
  if (a < 1e-9) {
    // Straight up or down the barrel: only a hit when the ray starts inside the cylinder.
    if (c > 0) return null;
    t = 0;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const root = Math.sqrt(disc);
    t = (-b - root) / (2 * a);
    if (t < 0) t = (-b + root) / (2 * a);
  }
  if (t < 0 || t > max) return null;
  const y = from.y + dir.y * t - who.y;
  if (y < 0 || y > h) return null;
  const part: HitPart = y >= h - HEAD_H * (who.crouching ? 1 : 1) ? 'head' : y <= LEGS_H ? 'legs' : 'body';
  return { t, part };
}

/** What a shot hit: the nearest body the arena didn't shield, or nothing. */
export function shoot(from: Vec3, dir: Vec3, targets: readonly Target[], max: number, boxes?: readonly Box[]): { who: Target; hit: BodyHit } | null {
  const wall = rayWorld(from, dir, max, boxes);
  let best: { who: Target; hit: BodyHit } | null = null;
  for (const who of targets) {
    const hit = rayBody(from, dir, who, Math.min(max, wall));
    if (hit && (!best || hit.t < best.hit.t)) best = { who, hit };
  }
  return best;
}

/** Where a thrown thing gets to, step by step, bouncing off the arena until its fuse runs out. */
export function flyGrenade(from: Vec3, dir: Vec3, speed: number, fuse: number, boxes: readonly Box[] = ARENA_BOXES): Vec3 {
  const step = 1 / 60;
  const pos = { ...from };
  const vel = { x: dir.x * speed, y: dir.y * speed, z: dir.z * speed };
  for (let t = 0; t < fuse; t += step) {
    vel.y -= 18 * step;
    const next = { x: pos.x + vel.x * step, y: pos.y + vel.y * step, z: pos.z + vel.z * step };
    if (next.y < 0.12) {
      next.y = 0.12;
      vel.y = -vel.y * 0.35;
      vel.x *= 0.7;
      vel.z *= 0.7;
    }
    // Into something: bounce off whichever face it came through.
    const blocked = boxes.find((b) => next.x > b.minX && next.x < b.maxX && next.z > b.minZ && next.z < b.maxZ && next.y > b.y && next.y < b.top);
    if (blocked) {
      if (pos.y >= blocked.top - 0.02 && vel.y < 0) {
        next.y = blocked.top + 0.02;
        vel.y = -vel.y * 0.35;
      } else if (pos.x <= blocked.minX || pos.x >= blocked.maxX) {
        next.x = pos.x;
        vel.x = -vel.x * 0.4;
      } else {
        next.z = pos.z;
        vel.z = -vel.z * 0.4;
      }
    }
    pos.x = next.x;
    pos.y = next.y;
    pos.z = next.z;
  }
  return pos;
}
