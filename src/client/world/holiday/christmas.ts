import * as THREE from 'three';
import { mulberry32 } from '../../../shared/rng';
import { mesh, toon, toonUnique } from '../toon';

// ---- Christmas ----------------------------------------------------------------------------------

/**
 * A decorated Christmas tree `h` tall standing at 0,0,0: tiers of branches, baubles, lights and a
 * star. `lit` collects where each light is, for their glow at night.
 */
export function christmasTree(h: number, lights: THREE.MeshToonMaterial[], lit?: THREE.Vector3[], trunk = false): THREE.Group {
  const g = new THREE.Group();
  const greens = [toon('#1f7a3a'), toon('#2a9d4b'), toon('#23884a')];
  const tiers = 4;
  const base = trunk ? h * 0.1 : 0;
  if (trunk) g.add(mesh(new THREE.CylinderGeometry(h * 0.035, h * 0.045, base + 0.1, 10), toon('#6b4226'), 0, (base + 0.1) / 2, 0));
  const tierH = ((h - base) * 0.92) / (tiers * 0.72);
  const baubles = ['#e63946', '#ffd166', '#4cc9f0', '#f1faee', '#c77dff'].map((c) => toon(c));
  // Seeded, so the trees look the same every time.
  const rand = mulberry32(Math.round(h * 1000));
  for (let i = 0; i < tiers; i++) {
    const r = (h * 0.34 * (tiers - i)) / tiers + h * 0.05;
    const y0 = base + i * tierH * 0.72;
    g.add(mesh(new THREE.ConeGeometry(r, tierH, 14), greens[i % 3], 0, y0 + tierH / 2, 0));
    // Baubles and lights round the tier's lower edge, where the branches stick out.
    const n = 5 + (tiers - i) * 2;
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2 + i;
      const up = 0.08 + rand() * 0.35;
      const rr = r * (1 - up) + h * 0.006;
      const y = y0 + tierH * up;
      if (j % 2) {
        g.add(mesh(new THREE.SphereGeometry(h * 0.024, 10, 8), baubles[(i + j) % baubles.length], Math.cos(a) * rr, y, Math.sin(a) * rr, false));
      } else {
        const at = new THREE.Vector3(Math.cos(a) * (rr + h * 0.004), y + tierH * 0.05, Math.sin(a) * (rr + h * 0.004));
        g.add(mesh(new THREE.SphereGeometry(h * 0.013, 8, 6), lights[(i + j / 2) % lights.length], at.x, at.y, at.z, false));
        lit?.push(at);
      }
    }
  }
  // A gold star on top.
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = (i % 2 ? 0.45 : 1) * h * 0.07;
    if (i) star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    else star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const gold = toonUnique('#ffd166');
  gold.emissive.set('#ffb000');
  gold.emissiveIntensity = 0.6;
  const s = mesh(new THREE.ExtrudeGeometry(star, { depth: h * 0.02, bevelEnabled: false }).translate(0, 0, -h * 0.01), gold, 0, base + tierH * 0.72 * (tiers - 1) + tierH + h * 0.04, 0, false);
  g.add(s);
  const s2 = s.clone();
  s2.rotation.y = Math.PI / 2;
  g.add(s2);
  return g;
}

/** A wrapped present `w` across, sitting on y = 0. */
export function present(w: number, paper: string, ribbon: string): THREE.Group {
  const g = new THREE.Group();
  const h = w * 0.8;
  g.add(mesh(new THREE.BoxGeometry(w, h, w), toon(paper), 0, h / 2, 0));
  const rib = toon(ribbon);
  g.add(mesh(new THREE.BoxGeometry(w * 1.02, h * 1.02, w * 0.18), rib, 0, h / 2, 0, false));
  g.add(mesh(new THREE.BoxGeometry(w * 0.18, h * 1.02, w * 1.02), rib, 0, h / 2, 0, false));
  for (const sx of [-1, 1]) {
    const loop = mesh(new THREE.TorusGeometry(w * 0.15, w * 0.05, 6, 12), rib, sx * w * 0.13, h + w * 0.1, 0, false);
    loop.rotation.y = Math.PI / 2;
    loop.rotation.x = sx * 0.4;
    g.add(loop);
  }
  return g;
}

export const PAPERS: [string, string][] = [
  ['#e63946', '#ffd166'],
  ['#2a9d4b', '#e63946'],
  ['#4cc9f0', '#fffaf3'],
  ['#ffd166', '#c1121f'],
  ['#c77dff', '#ffd166'],
];

/** A snowman with a scarf, a carrot nose, coal eyes and buttons, twig arms and a top hat, facing +z. */
export function snowman(): THREE.Group {
  const g = new THREE.Group();
  const snow = toon('#f4f8ff');
  const coal = toon('#23232b');
  const twig = toon('#6b4226');
  const balls: [number, number][] = [
    [0.55, 0.5],
    [0.4, 1.28],
    [0.28, 1.86],
  ];
  for (const [r, y] of balls) g.add(mesh(new THREE.SphereGeometry(r, 18, 14), snow, 0, y, 0));
  for (const sx of [-1, 1]) g.add(mesh(new THREE.SphereGeometry(0.04, 8, 6), coal, sx * 0.1, 1.94, 0.24, false));
  const nose = mesh(new THREE.ConeGeometry(0.05, 0.3, 10).rotateX(Math.PI / 2), toon('#ff8c1a'), 0, 1.86, 0.4, false);
  g.add(nose);
  for (let i = 0; i < 3; i++) g.add(mesh(new THREE.SphereGeometry(0.045, 8, 6), coal, 0, 1.12 + i * 0.16, 0.39 - Math.abs(i - 1) * 0.02, false));
  const scarf = mesh(new THREE.TorusGeometry(0.29, 0.07, 8, 20), toon('#d62828'), 0, 1.6, 0);
  scarf.rotation.x = Math.PI / 2;
  g.add(scarf);
  g.add(mesh(new THREE.BoxGeometry(0.14, 0.4, 0.05), toon('#d62828'), 0.18, 1.42, 0.24).rotateZ(0.2));
  for (const sx of [-1, 1]) {
    const arm = mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.9, 6), twig, sx * 0.72, 1.45, 0, false);
    arm.rotation.z = sx * 1.05;
    g.add(arm);
  }
  g.add(mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.04, 20), coal, 0, 2.1, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.4, 20), coal, 0, 2.3, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.225, 0.225, 0.07, 20), toon('#d62828'), 0, 2.16, 0, false));
  return g;
}

