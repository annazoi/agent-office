import * as THREE from 'three';
import type { DjFrame } from '../../dnb';
import { mesh, toon, toonUnique } from '../../world/toon';

/** The DJ: headphones on, cap on backwards, sunglasses at night, moving to the music. Faces +z. */
export class Dj {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private head = new THREE.Group();
  /** Arms on the -x and +x sides (their right and left, facing +z). */
  private armR: THREE.Group;
  private armL: THREE.Group;

  constructor() {
    const skin = toon('#8d5524');
    const shirt = toonUnique('#1d1d1d');
    const pants = toon('#3d405b');
    const ink = toon('#111111');
    this.root.add(this.body);
    this.body.add(mesh(new THREE.CapsuleGeometry(0.26, 0.28, 6, 12), shirt, 0, 0.72, 0));
    // A print on the front of the tee.
    this.body.add(mesh(new THREE.CircleGeometry(0.1, 16), toon('#06d6a0'), 0, 0.78, 0.262, false));
    const head = this.head;
    head.position.y = 1.32;
    head.add(mesh(new THREE.SphereGeometry(0.34, 20, 16), skin));
    // The cap, on backwards.
    const capMat = toon('#ef476f');
    const cap = mesh(new THREE.SphereGeometry(0.36, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), capMat, 0, 0.04, 0);
    head.add(cap);
    head.add(mesh(new THREE.BoxGeometry(0.3, 0.03, 0.22), capMat, 0, 0.06, -0.4));
    // Sunglasses.
    head.add(mesh(new THREE.BoxGeometry(0.44, 0.09, 0.05), ink, 0, 0.04, 0.31, false));
    const smile = mesh(new THREE.TorusGeometry(0.06, 0.015, 6, 12, Math.PI), ink, 0, -0.1, 0.31, false);
    smile.rotation.z = Math.PI;
    head.add(smile);
    // Headphones: a band over the cap and a cup on each ear.
    const band = mesh(new THREE.TorusGeometry(0.39, 0.035, 8, 24, Math.PI), ink, 0, 0.02, 0, false);
    head.add(band);
    for (const s of [-1, 1]) {
      const cup = mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.09, 16), toon('#3d405b'), s * 0.36, 0.02, 0, false);
      cup.rotation.z = Math.PI / 2;
      head.add(cup);
    }
    this.body.add(head);
    const limb = (len: number, r: number, mat: THREE.Material, x: number, y: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, 0);
      pivot.add(mesh(new THREE.CapsuleGeometry(r, len, 4, 8), mat, 0, -len / 2 - r / 2, 0));
      this.body.add(pivot);
      return pivot;
    };
    limb(0.22, 0.1, pants, -0.12, 0.42);
    limb(0.22, 0.1, pants, 0.12, 0.42);
    this.armR = limb(0.24, 0.08, shirt, -0.33, 0.9);
    this.armL = limb(0.24, 0.08, shirt, 0.33, 0.9);
    for (const arm of [this.armR, this.armL]) arm.add(mesh(new THREE.SphereGeometry(0.085, 12, 10), skin, 0, -0.38, 0));
  }

  update(t: number, f: DjFrame, motion: boolean) {
    const e = f.energy;
    const phase = f.beats % 1;
    const m = motion ? 1 : 0.3;
    // Bouncing on every beat, and nodding along.
    this.body.position.y = -0.05 * e * m * Math.sin(phase * Math.PI);
    this.head.rotation.x = 0.28 * m * (0.35 + 0.65 * e) * Math.max(0, Math.sin(phase * Math.PI * 2));
    this.head.rotation.z = 0.06 * m * Math.sin(f.beats * Math.PI * 0.5);
    // Their right hand's on the mixer, riding the faders.
    this.armR.rotation.set(-1.15 + 0.05 * Math.sin(t * 7), 0, 0.25 + 0.06 * Math.sin(t * 3.1));
    const fist = f.sinceDrop < 3.2 && motion;
    if (fist) {
      // The drop: a fist in the air, pumping on the beat.
      this.armL.rotation.set(0, 0, 2.9 - 0.3 * Math.sin(phase * Math.PI));
    } else if (f.part === 'build' || f.part === 'intro' || (f.part === 'breakdown' && f.beats % 16 < 8)) {
      // One cup of the headphones held to their ear, listening for the next track.
      this.armL.rotation.set(-0.2, 0, 2.55);
    } else {
      // Working the jog wheel.
      this.armL.rotation.set(-1.2 + 0.08 * Math.sin(t * 11), 0, -0.2 + 0.12 * Math.sin(t * 5.3));
    }
  }
}
