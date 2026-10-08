import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { glowTexture } from '../costumes';
import type { Spot } from './spots';

// ---- Jack-o'-lanterns ---------------------------------------------------------------------------

/** A ribbed pumpkin 2 m across, sitting on y = 0, its face toward +z (u = 0.25 on the sphere's map). */
export function pumpkinGeometry(): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, 36, 20);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const a = Math.atan2(v.x, v.z);
    const rib = 1 + 0.06 * Math.cos(10 * a) * Math.sqrt(1 - v.y * v.y);
    // Squat, with a dimple on top where the stem goes.
    const dimple = v.y > 0.8 ? (v.y - 0.8) * 0.9 : 0;
    pos.setXYZ(i, v.x * rib, (v.y - dimple) * 0.78 + 0.78, v.z * rib);
  }
  geo.computeVertexNormals();
  return geo;
}

/** The carved face, lit from inside, and its skin: [what it looks like, what glows]. */
export function pumpkinTextures(): [THREE.CanvasTexture, THREE.CanvasTexture] {
  const W = 512;
  const H = 256;
  const face = (g: CanvasRenderingContext2D, fill: string, edge?: string) => {
    const shapes: [number, number][][] = [
      // Slanted triangle eyes.
      [
        [70, 112],
        [118, 110],
        [100, 76],
      ],
      [
        [138, 110],
        [186, 112],
        [156, 76],
      ],
      // A nose.
      [
        [118, 132],
        [138, 132],
        [128, 116],
      ],
      // A jagged grin with two teeth.
      [
        [66, 140],
        [92, 150],
        [100, 140],
        [110, 154],
        [146, 154],
        [156, 140],
        [164, 150],
        [190, 140],
        [178, 164],
        [154, 180],
        [128, 184],
        [102, 180],
        [78, 164],
      ],
    ];
    for (const s of shapes) {
      g.beginPath();
      s.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.fillStyle = fill;
      g.fill();
      if (edge) {
        g.lineWidth = 5;
        g.strokeStyle = edge;
        g.stroke();
      }
    }
  };
  const skin = document.createElement('canvas');
  skin.width = W;
  skin.height = H;
  const g = skin.getContext('2d')!;
  g.fillStyle = '#f28a1d';
  g.fillRect(0, 0, W, H);
  // Darker down the grooves between the ribs (see pumpkinGeometry), lighter on the ridges.
  for (let k = 0; k < 10; k++) {
    const x = (((0.3 + 0.1 * k) % 1) * W) | 0;
    const grad = g.createLinearGradient(x - 26, 0, x + 26, 0);
    grad.addColorStop(0, 'rgba(160, 60, 0, 0)');
    grad.addColorStop(0.5, 'rgba(160, 60, 0, 0.45)');
    grad.addColorStop(1, 'rgba(160, 60, 0, 0)');
    g.fillStyle = grad;
    g.fillRect(x - 26, 0, 52, H);
  }
  face(g, '#ffd23f', '#6b2d00');
  const glow = document.createElement('canvas');
  glow.width = W;
  glow.height = H;
  const e = glow.getContext('2d')!;
  e.fillStyle = '#000000';
  e.fillRect(0, 0, W, H);
  face(e, '#ffb347');
  return [skin, glow].map((c) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }) as [THREE.CanvasTexture, THREE.CanvasTexture];
}

/** Places copies of `geo` at `spots` (scaled by r, turned by rotY) as one geometry. */
export function scatter(geo: THREE.BufferGeometry, spots: Spot[], extra?: (m: THREE.Matrix4, i: number) => void): THREE.BufferGeometry {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const parts = spots.map(([x, y, z, r, rotY], i) => {
    m.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(up, rotY), new THREE.Vector3(r, r, r));
    extra?.(m, i);
    return geo.clone().applyMatrix4(m);
  });
  const out = mergeGeometries(parts)!;
  for (const p of parts) p.dispose();
  return out;
}

/** Soft glows at `at`, one set of points per size. */
export function halos(at: { p: THREE.Vector3; size: number; color: string }[]): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>[] {
  const map = glowTexture();
  const bySize = new Map<number, { pos: number[]; col: number[] }>();
  for (const h of at) {
    const size = Math.round(h.size * 10) / 10;
    let set = bySize.get(size);
    if (!set) bySize.set(size, (set = { pos: [], col: [] }));
    set.pos.push(h.p.x, h.p.y, h.p.z);
    const c = new THREE.Color(h.color);
    set.col.push(c.r, c.g, c.b);
  }
  return [...bySize].map(([size, { pos, col }]) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    return new THREE.Points(geo, new THREE.PointsMaterial({ size, map, vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  });
}

