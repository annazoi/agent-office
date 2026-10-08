import * as THREE from 'three';
import { GOLF_HOLE, GOLF_TEE } from '../../../shared/layout';

// A golf shot and the tee it's hit from: what a shot is, and where the golfer stands. Where it goes from
// there is worked out in flight.ts.

/** A shot: its heading (0 is straight out, south, +z; it turns toward +x), how steeply it leaves the club, and how hard it's hit (0–1). */
export interface Shot {
  yaw: number;
  loft: number;
  power: number;
}

/** The lofts you can pick, in radians. Much under 30° and the ball won't clear the railing. */
export const LOFT_MIN = THREE.MathUtils.degToRad(20);
export const LOFT_MAX = THREE.MathUtils.degToRad(60);
/** How far either side of straight out you can aim. */
export const AIM_MAX = 1.2;
/** How fast the ball leaves the club at full power, in m/s. */
export const SPEED = 30;
/** The ball's radius. A real one's is 2.1 cm; this one's bigger, so it can be seen from the tee. */
export const BALL_R = 0.05;
/** The turf mat, and the tee on it. */
export const MAT_H = 0.03;
export const TEE_H = 0.015;
/** The ball on the tee, ready to hit. */
export const TEE_BALL = new THREE.Vector3(GOLF_TEE.ball.x, MAT_H + TEE_H + BALL_R, GOLF_TEE.ball.z);
/** The golfer stands this far from the ball, square to the line. */
export const STANCE = 0.57;

/** Where the golfer stands for a shot heading `yaw`, and which way they face: across the line, with the hole on their left. */
export function stance(yaw: number): { x: number; z: number; facing: number } {
  return { x: GOLF_TEE.ball.x + Math.cos(yaw) * STANCE, z: GOLF_TEE.ball.z - Math.sin(yaw) * STANCE, facing: yaw - Math.PI / 2 };
}

/** Which way from the tee the pin is. */
export const PIN_YAW = Math.atan2(GOLF_HOLE.x - GOLF_TEE.ball.x, GOLF_HOLE.z - GOLF_TEE.ball.z);
/** From the tee to the pin, along the ground. */
export const PIN_DISTANCE = Math.hypot(GOLF_HOLE.x - GOLF_TEE.ball.x, GOLF_HOLE.z - GOLF_TEE.ball.z);
