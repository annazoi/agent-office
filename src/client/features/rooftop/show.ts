import * as THREE from 'three';
import type { DjFrame } from '../../dnb';
import { hue, sparkle } from './helpers';

// What the lights do to the DJ's set: the moving heads aim and flash, the lasers sweep and the dance floor's tiles change color.

export interface Head {
  pan: THREE.Group;
  tilt: THREE.Group;
  beam: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;
  lens: THREE.MeshBasicMaterial;
  i: number;
}

export interface Laser {
  lines: THREE.LineSegments;
  mat: THREE.LineBasicMaterial;
  from: THREE.Vector3;
  k: number;
}

/** Rays in each laser's fan. */
export const LASER_RAYS = 7;

/** Moves the heads: sweeping down onto the dance floor and up into the sky in the drops, slowly searching the sky in a breakdown, and all rising together through a build. `show`: how much the lights stand out, 0.3 in the sun to 1 at night. */
export function aimHeads(heads: Head[], f: DjFrame, t: number, motion: boolean, show: number, tmp: THREE.Color): void {
  const drop = f.part === 'drop';
  heads.forEach((h) => {
    const i = h.i;
    const side = i - 2;
    // Across (radians either side of straight out over the dance floor), and up: -1 down onto the floor, 1 high into the sky.
    let pan = side * 0.25;
    let aim = 0.4;
    if (!motion) {
      // Held still.
    } else if (drop) {
      const bar = Math.floor(f.beats / 4);
      pan = side * 0.25 + Math.sin(f.beats * Math.PI * 0.5 + i) * 0.55;
      aim = 0.85 * Math.sin(f.beats * Math.PI * 0.25 + (bar % 2 ? i : -i));
    } else if (f.part === 'build') {
      pan = side * (0.35 - 0.3 * f.rise) + Math.sin(t * (1 + 6 * f.rise) + i) * 0.3 * (1 - f.rise);
      aim = 0.2 + 0.8 * f.rise;
    } else {
      pan = side * 0.3 + Math.sin(t * 0.35 + i * 0.9) * 0.4;
      aim = 0.5 + 0.3 * Math.sin(t * 0.27 + i);
    }
    h.pan.rotation.y = pan;
    // The beam hangs straight down at 0; turned back past level, out over the dance floor (+z) and up.
    h.tilt.rotation.x = -(1.8 + 0.8 * aim);
    const color = hue(tmp, f.hue + (drop && Math.floor(f.beats) % 2 ? 0.5 : 0) + i * 0.04, 0.6);
    const level = (drop ? 0.55 + 0.45 * f.beat : f.part === 'build' ? 0.3 + 0.6 * f.rise : 0.25) * show;
    h.beam.material.uniforms.color.value.copy(color);
    h.beam.material.uniforms.opacity.value = level * 0.55;
    h.lens.color.copy(color).multiplyScalar(0.6 + 0.8 * level);
  });
}

/** Sweeps the lasers' fans back and forth, in the drops and the builds. `dark`: 0 by day to 1 at night. */
export function sweepLasers(lasers: Laser[], f: DjFrame, t: number, dark: number, motion: boolean): void {
  const drop = f.part === 'drop';
  for (const l of lasers) {
    const on = drop ? 1 : f.part === 'build' ? f.rise : 0;
    // Only once it's getting dark: in the sun they'd just be scratches on the sky.
    l.mat.opacity = on * 0.9 * dark;
    l.lines.visible = l.mat.opacity > 0.01;
    if (!l.lines.visible) continue;
    const pos = l.lines.geometry.attributes.position as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    const sweep = Math.sin(t * (drop ? 1.3 : 0.6) * (motion ? 1 : 0) + l.k * Math.PI) * 0.45;
    const lift = 0.12 + 0.28 * (0.5 + 0.5 * Math.sin(t * 0.9 * (motion ? 1 : 0) + l.k));
    for (let r = 0; r < LASER_RAYS; r++) {
      const yaw = sweep + (r / (LASER_RAYS - 1) - 0.5) * 1.1 + (l.k ? -0.2 : 0.2);
      const dx = Math.sin(yaw) * Math.cos(lift);
      const dz = Math.cos(yaw) * Math.cos(lift);
      const dy = Math.sin(lift);
      const L = 70;
      a.set([l.from.x, l.from.y, l.from.z, l.from.x + dx * L, l.from.y + dy * L, l.from.z + dz * L], r * 6);
    }
    pos.needsUpdate = true;
  }
}

/** Colors the dance floor's tiles: a checkerboard, ripples, stripes or sparkles, changing every four bars. */
export function paintDanceFloor(tiles: THREE.InstancedMesh, cols: number, rows: number, f: DjFrame, t: number, motion: boolean, tmp: THREE.Color): void {
  const e = f.energy;
  const drop = f.part === 'drop';
  const beat = Math.floor(f.beats);
  const pattern = Math.floor(f.beats / 16) % 4;
  // With reduced motion it keeps to the slow wash, whatever the set is doing.
  const pulse = !motion ? 0.3 : drop ? 0.45 + 0.55 * f.beat : f.part === 'build' ? 0.35 + 0.5 * f.beat * f.rise : 0.3;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let on: number;
      let h = f.hue;
      if (!motion || (!drop && f.part !== 'build')) {
        // Slow color washing across it.
        on = 0.5 + 0.5 * Math.sin(c * 0.6 + r * 0.4 - t * 1.2);
        h += c * 0.02 + r * 0.03;
      } else if (pattern === 0) on = (c + r + beat) % 2;
      else if (pattern === 1) {
        const dist = Math.hypot(c - cols / 2 + 0.5, r - rows / 2 + 0.5);
        on = 0.5 + 0.5 * Math.sin(dist * 1.3 - f.beats * Math.PI);
        h += dist * 0.04;
      } else if (pattern === 2) on = (c + beat) % 3 === 0 ? 1 : 0.1;
      else on = sparkle(c, r, beat) > 0.45 ? 1 : 0.05;
      const l = 0.08 + 0.5 * Math.abs(on) * pulse * (0.6 + 0.4 * e);
      tiles.setColorAt(r * cols + c, hue(tmp, h + (on > 0.5 ? 0 : 0.5), l));
    }
  }
  if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true;
}
