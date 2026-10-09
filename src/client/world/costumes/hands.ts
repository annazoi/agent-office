import * as THREE from 'three';
import { mesh } from '../toon';
import { detail } from './shared';

// ---- Your hands (first person) ------------------------------------------------------------------

/** An open sleeve end flaring out toward the hand, in rags (along -z, like the hands' arms). */
export function raggedCuff(mat: THREE.Material): THREE.Mesh {
  const n = 16;
  const geo = new THREE.CylinderGeometry(0.066, 0.1, 0.15, n, 2, true).rotateX(Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getZ(i) > -0.07) continue;
    const a = Math.atan2(pos.getY(i), pos.getX(i));
    const k = Math.round(((a + Math.PI) / (Math.PI * 2)) * n);
    pos.setZ(i, pos.getZ(i) + (k % 2 ? 0.045 : k % 3 ? 0.012 : 0));
  }
  geo.computeVertexNormals();
  return mesh(geo, mat, 0, 0, 0.11, false);
}

/**
 * An undead warlock's hand, in camera space like the hands' own (-z is forward): a bony grey-green
 * palm, long crooked fingers with black claws, and a thumb on the inside (`side` is 1 for the right).
 */
export function warlockHand(side: 1 | -1, skin: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const palm = mesh(new THREE.SphereGeometry(0.054, 18, 12), skin, 0, 0, 0, false);
  palm.scale.set(1, 0.62, 1.2);
  g.add(palm);
  const claw = detail('#1e1522');
  const knuckle = new THREE.SphereGeometry(0.013, 8, 6);
  const bone = (len: number) => new THREE.CapsuleGeometry(0.0092, len, 4, 8).rotateX(Math.PI / 2).translate(0, 0, -len / 2);
  const tip = new THREE.ConeGeometry(0.0095, 0.038, 8).rotateX(-Math.PI / 2).translate(0, 0, -0.019);
  const fingers: [number, number][] = [
    [-0.032, 0.056],
    [-0.011, 0.064],
    [0.011, 0.06],
    [0.031, 0.046],
  ];
  for (const [fx, len] of fingers) {
    const x = fx * side;
    g.add(mesh(knuckle, skin, x, 0.02, -0.052, false));
    const base = new THREE.Group();
    base.position.set(x, 0.01, -0.058);
    base.rotation.set(-0.2, x * 2.2, 0);
    base.add(mesh(bone(len), skin, 0, 0, 0, false));
    const joint = new THREE.Group();
    joint.position.z = -len;
    joint.rotation.x = -0.55;
    joint.add(mesh(knuckle, skin, 0, 0, 0, false));
    joint.add(mesh(bone(len * 0.8), skin, 0, 0, 0, false));
    const nail = new THREE.Group();
    nail.position.z = -len * 0.8;
    nail.rotation.x = -0.4;
    nail.add(mesh(tip, claw, 0, 0, 0, false));
    joint.add(nail);
    base.add(joint);
    g.add(base);
  }
  // The thumb, on the inside of the hand.
  const thumb = new THREE.Group();
  thumb.position.set(-side * 0.045, -0.004, -0.02);
  thumb.rotation.set(-0.1, side * 0.75, 0);
  thumb.add(mesh(bone(0.04), skin, 0, 0, 0, false));
  const tnail = new THREE.Group();
  tnail.position.z = -0.04;
  tnail.rotation.x = -0.35;
  tnail.add(mesh(tip, claw, 0, 0, 0, false));
  thumb.add(tnail);
  g.add(thumb);
  return g;
}

let glow: THREE.CanvasTexture | null = null;

/** Soft round blob, for glows: one texture, shared by everything that glows (so dressing up again doesn't make another). */
export function glowTexture(): THREE.CanvasTexture {
  if (glow) return glow;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return (glow = new THREE.CanvasTexture(c));
}

/** Green witch-fire swirling round a warlock's hand: points to move each frame (see Hands.update). */
export function witchFire(count: number): THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial> {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage));
  // Drawn over what's behind, not added to it, so it stays green over a bright floor.
  const p = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#5dff2e', size: 0.03, map: glowTexture(), transparent: true, opacity: 0.85, depthWrite: false }));
  p.frustumCulled = false;
  return p;
}
