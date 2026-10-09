import * as THREE from 'three';
import { mesh, toon } from '../toon';
import { detail } from './shared';

// ---- People -------------------------------------------------------------------------------------

/** A tall, crooked warlock's hat for a person's head (its middle is 0,0,0, 0.34 round; the face looks down +z). */
export function warlockHat(): THREE.Group {
  const g = new THREE.Group();
  const felt = toon('#2d1b3d');
  g.add(mesh(new THREE.CylinderGeometry(0.54, 0.54, 0.03, 32), felt, 0, 0.25, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.13, 0.31, 0.42, 24), felt, 0, 0.46, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.305, 0.312, 0.08, 24), toon('#ff7b00'), 0, 0.3, 0));
  g.add(mesh(new THREE.BoxGeometry(0.11, 0.08, 0.02), detail('#ffd166'), 0, 0.3, 0.315, false));
  const bend = new THREE.Group();
  bend.position.set(0, 0.66, 0);
  bend.rotation.set(-0.55, 0, 0.25);
  bend.add(mesh(new THREE.ConeGeometry(0.13, 0.36, 20), felt, 0, 0.17, 0));
  g.add(bend);
  g.rotation.x = -0.15;
  return g;
}

/** A floppy Santa hat for a person's head. */
export function santaHat(): THREE.Group {
  const g = new THREE.Group();
  const red = toon('#d62828');
  const fur = toon('#fffaf3');
  const brim = mesh(new THREE.TorusGeometry(0.31, 0.075, 10, 30), fur, 0, 0.21, 0);
  brim.rotation.x = Math.PI / 2;
  g.add(brim);
  g.add(mesh(new THREE.CylinderGeometry(0.17, 0.31, 0.3, 24), red, 0, 0.36, 0));
  const flop = new THREE.Group();
  flop.position.set(0, 0.5, 0);
  flop.rotation.set(-0.35, 0, -1.05);
  flop.add(mesh(new THREE.ConeGeometry(0.17, 0.4, 20), red, 0, 0.18, 0));
  flop.add(mesh(new THREE.SphereGeometry(0.085, 12, 10), fur, 0, 0.4, 0));
  g.add(flop);
  g.rotation.x = -0.15;
  return g;
}
