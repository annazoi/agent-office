import * as THREE from 'three';
import { toonUnique } from '../toon';

/** What undead skin is mixed toward, for Halloween: a warlock's hands and face. */
export const UNDEAD_SKIN = new THREE.Color('#a3bf98');

export const details = new Map<string, THREE.MeshToonMaterial>();
/** A material for small bits (stitches, bells), drawn without the cartoon outline, which would swallow them. */
export function detail(color: string): THREE.MeshToonMaterial {
  let m = details.get(color);
  if (!m) {
    m = toonUnique(color);
    m.userData.outlineParameters = { visible: false };
    details.set(color, m);
  }
  return m;
}

export const Z = new THREE.Vector3(0, 0, 1);
