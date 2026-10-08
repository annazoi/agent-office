import * as THREE from 'three';
import { rand } from './math';

interface Drop {
  x: number;
  y: number;
  r: number;
  /** Running down the glass this fast (px/s), or 0 while it clings. */
  vy: number;
  trail: number;
  age: number;
  life: number;
}

/** Raindrops on the windows: they land, cling, now and then run down, and dry off after the rain. */
export class WetGlass {
  private readonly canvas = document.createElement('canvas');
  private readonly g: CanvasRenderingContext2D;
  private readonly tex: THREE.CanvasTexture;
  private drops: Drop[] = [];
  private since = 0;
  private spawn = 0;

  constructor(private mat: THREE.MeshBasicMaterial) {
    // 90 cm of glass square (see wetPane in world/office/shell.ts).
    this.canvas.width = this.canvas.height = 256;
    this.g = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.wrapS = this.tex.wrapT = THREE.RepeatWrapping;
    mat.map = this.tex;
    mat.needsUpdate = true;
  }

  update(dt: number, rain: number, lit: number) {
    this.since += dt;
    this.spawn += rain * 70 * dt;
    for (; this.spawn >= 1; this.spawn--) {
      if (this.drops.length < 220) this.drops.push({ x: rand(0, 256), y: rand(0, 256), r: rand(1.6, 4.4), vy: 0, trail: 0, age: 0, life: rand(4, 12) });
    }
    for (const d of this.drops) {
      d.age += dt;
      if (!d.vy && d.r > 3.4 && Math.random() < dt * 0.4) d.vy = rand(50, 140);
      if (d.vy) {
        d.y += d.vy * dt;
        d.trail = Math.min(d.trail + d.vy * dt, 70);
      }
    }
    this.drops = this.drops.filter((d) => d.age < d.life && d.y < 256 + 80);
    this.mat.visible = this.drops.length > 0;
    // A dozen redraws a second is plenty for drops.
    if (!this.mat.visible || this.since < 0.08) return;
    this.since = 0;
    this.mat.color.setScalar(lit);
    const g = this.g;
    g.clearRect(0, 0, 256, 256);
    for (const d of this.drops) {
      const fade = Math.min(1, (d.life - d.age) / 1.5);
      // Near an edge, draw it on the other side too, so the glass tiles without seams.
      for (const ox of d.x < 8 ? [0, 256] : d.x > 248 ? [0, -256] : [0]) {
        for (const oy of [0, -256]) {
          const x = d.x + ox;
          const y = d.y + oy;
          if (y + d.r < -80 || y - d.r - d.trail > 256) continue;
          if (d.trail > 0) {
            g.fillStyle = `rgba(225, 238, 255, ${0.22 * fade})`;
            g.fillRect(x - d.r * 0.35, y - d.trail, d.r * 0.7, d.trail);
          }
          g.fillStyle = `rgba(214, 230, 250, ${0.5 * fade})`;
          g.beginPath();
          g.ellipse(x, y, d.r, d.r * 1.15, 0, 0, Math.PI * 2);
          g.fill();
          g.strokeStyle = `rgba(30, 50, 80, ${0.5 * fade})`;
          g.lineWidth = 1;
          g.stroke();
          g.fillStyle = `rgba(255, 255, 255, ${0.85 * fade})`;
          g.beginPath();
          g.arc(x - d.r * 0.35, y - d.r * 0.4, d.r * 0.32, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    this.tex.needsUpdate = true;
  }
}
