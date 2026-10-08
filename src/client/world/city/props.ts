import * as THREE from 'three';
import { tilingCanvasTexture } from '../texture';
import { mesh, toon } from '../toon';

export function tree(r: () => number): THREE.Group {
  const t = new THREE.Group();
  const s = 0.8 + r() * 0.7;
  t.add(mesh(new THREE.CylinderGeometry(0.25 * s, 0.32 * s, 2.4 * s, 6), toon('#8a5a3b'), 0, 1.2 * s, 0, false));
  t.add(mesh(new THREE.SphereGeometry(1.9 * s, 8, 6), toon(r() < 0.5 ? '#5fb760' : '#4ea657'), 0, 3.4 * s, 0, false));
  return t;
}

/** Soft round blob, for lamps seen from far off. */
export function glowTexture(): THREE.CanvasTexture {
  return tilingCanvasTexture(64, 64, (g) => {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.25, 'rgba(255,255,255,0.7)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  });
}

/** Puts geometries (position and normal only) into one. */
export function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const norm: number[] = [];
  for (const g of geos) {
    const flat = g.index ? g.toNonIndexed() : g;
    pos.push(...(flat.getAttribute('position').array as Float32Array));
    norm.push(...(flat.getAttribute('normal').array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  return out;
}
