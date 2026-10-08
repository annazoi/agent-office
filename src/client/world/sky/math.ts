import * as THREE from 'three';

export const DEG = Math.PI / 180;
export const lerp = THREE.MathUtils.lerp;
export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const rand = (a: number, b: number) => a + Math.random() * (b - a);
/** Eases `x` toward `to`, most of the way in `secs`. */
export const ease = (x: number, to: number, dt: number, secs: number) => x + (to - x) * (1 - Math.exp(-dt / secs));
