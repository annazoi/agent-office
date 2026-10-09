import * as THREE from 'three';
import { mesh, toon, toonUnique } from '../toon';

// ---- The dog ------------------------------------------------------------------------------------

/** A bat wing, root at 0,0,0, reaching out along +x (its leading edge toward +z, the dog's head). */
export function batWingGeometry(span: number): THREE.ShapeGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, 0.05);
  s.lineTo(0.4, 0.13);
  s.lineTo(1, 0.1);
  s.quadraticCurveTo(0.86, 0, 0.78, -0.12);
  s.quadraticCurveTo(0.66, -0.02, 0.52, -0.14);
  s.quadraticCurveTo(0.4, -0.04, 0.26, -0.13);
  s.quadraticCurveTo(0.14, -0.04, 0, -0.08);
  s.closePath();
  return new THREE.ShapeGeometry(s, 6).rotateX(Math.PI / 2).scale(span, 1, span);
}

/** Bat wings on the dog's back (a torso-local group), and the pivots that flap them. */
export function dogBatWings(): { group: THREE.Group; wings: THREE.Object3D[] } {
  const group = new THREE.Group();
  const mat = toonUnique('#2b1d3a');
  mat.side = THREE.DoubleSide;
  const geo = batWingGeometry(0.42);
  const wings: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.07, 0.17, 0.26);
    const w = mesh(geo, mat, 0, 0, 0);
    w.scale.x = sx;
    pivot.add(w);
    group.add(pivot);
    wings.push(pivot);
  }
  return { group, wings };
}

/** A little witch's hat between the dog's ears (head-local). */
export function dogWitchHat(): THREE.Group {
  const g = new THREE.Group();
  const felt = toon('#3c1f5c');
  g.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.012, 24), felt, 0, 0, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.066, 0.068, 0.03, 16), toon('#ff7b00'), 0, 0.02, 0, false));
  const tip = new THREE.Group();
  tip.position.y = 0.03;
  tip.rotation.set(-0.35, 0, 0.2);
  tip.add(mesh(new THREE.ConeGeometry(0.066, 0.2, 16), felt, 0, 0.1, 0));
  g.add(tip);
  g.position.set(0, 0.13, -0.02);
  g.rotation.set(-0.2, 0, 0.15);
  return g;
}

/** Reindeer antlers (head-local). */
export function dogAntlers(): THREE.Group {
  const g = new THREE.Group();
  const horn = toon('#8b5a2b');
  const tine = (len: number) => new THREE.CapsuleGeometry(0.012, len, 4, 6).translate(0, len / 2, 0);
  for (const sx of [-1, 1]) {
    const beam = new THREE.Group();
    beam.position.set(sx * 0.06, 0.11, -0.01);
    beam.rotation.set(-0.25, 0, -sx * 0.45);
    beam.add(mesh(tine(0.16), horn, 0, 0, 0));
    const front = mesh(tine(0.06), horn, 0, 0.07, 0);
    front.rotation.x = 0.95;
    beam.add(front);
    const out = mesh(tine(0.055), horn, 0, 0.13, 0);
    out.rotation.z = -sx * 0.8;
    beam.add(out);
    g.add(beam);
  }
  return g;
}

/** Rudolph's nose, which glows (head-local, over the dog's own). */
export function dogRedNose(): { nose: THREE.Mesh; glow: THREE.MeshToonMaterial } {
  const glow = toonUnique('#ff3030');
  glow.emissive.set('#ff1a1a');
  glow.emissiveIntensity = 0.8;
  return { nose: mesh(new THREE.SphereGeometry(0.04, 12, 10), glow, 0, -0.005, 0.225, false), glow };
}

/** A red scarf round the dog's neck, over its collar, one end hanging down its chest (head-local). */
export function dogScarf(): THREE.Group {
  const g = new THREE.Group();
  const red = toon('#d62828');
  // Where the collar is, and turned the way it is.
  const knit = mesh(new THREE.TorusGeometry(0.1, 0.042, 8, 20), red, 0, -0.11, -0.05);
  knit.rotation.x = Math.PI / 2 + 0.5;
  g.add(knit);
  const end = new THREE.Group();
  end.position.set(0.075, -0.15, 0.0);
  end.rotation.set(0.35, 0.5, 0.12);
  end.add(mesh(new THREE.BoxGeometry(0.055, 0.15, 0.025), red, 0, -0.07, 0));
  for (let i = 0; i < 2; i++) end.add(mesh(new THREE.BoxGeometry(0.057, 0.02, 0.027), toon('#fffaf3'), 0, -0.07 - i * 0.05, 0, false));
  g.add(end);
  return g;
}
