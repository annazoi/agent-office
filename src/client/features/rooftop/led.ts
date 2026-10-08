import type * as THREE from 'three';
import type { DjFrame } from '../../dnb';
import { fitFont } from './helpers';

/**
 * Paints the LED wall behind the DJ: an equalizer in a drop, stripes racing up in a build, slow washes
 * of color otherwise, with the set's name across it. `calm`: the slow washes whatever the set is doing,
 * for anyone who'd rather nothing flashed.
 */
export function paintLed(g: CanvasRenderingContext2D, led: THREE.CanvasTexture, f: DjFrame, t: number, calm: boolean): void {
  const W = 512;
  const H = 256;
  g.globalAlpha = 1;
  g.fillStyle = '#07060d';
  g.fillRect(0, 0, W, H);
  const base = f.hue * 360;
  if (!calm && f.part === 'drop') {
    // An equalizer, jumping with the kick.
    const n = 24;
    for (let i = 0; i < n; i++) {
      const v = 0.25 + 0.75 * Math.abs(Math.sin(i * 1.7 + t * 4.3 + f.beats * 0.9)) * (0.55 + 0.45 * f.kick);
      g.fillStyle = `hsl(${(base + i * 7) % 360}, 95%, 58%)`;
      g.fillRect(i * (W / n) + 3, H - v * H, W / n - 6, v * H);
    }
    g.globalAlpha = 0.35 + 0.65 * f.snare;
  } else if (!calm && f.part === 'build') {
    // Stripes racing up, faster and faster, and a bar filling up to the drop.
    const speed = 60 + 420 * f.rise;
    for (let y = -40; y < H; y += 40) {
      g.fillStyle = `hsla(${(base + y) % 360}, 90%, 55%, ${0.25 + 0.5 * f.rise})`;
      g.fillRect(0, (y + ((t * speed) % 40) + H) % (H + 40) - 40, W, 14);
    }
    g.fillStyle = '#ffffff';
    g.fillRect(40, H - 34, (W - 80) * f.rise, 12);
    g.globalAlpha = 0.6 + 0.4 * f.beat;
  } else {
    // Slow washes of color.
    for (let i = 0; i < 3; i++) {
      const x = W / 2 + Math.sin(t * 0.4 + i * 2.1) * W * 0.35;
      const y = H / 2 + Math.cos(t * 0.3 + i * 1.7) * H * 0.3;
      const grad = g.createRadialGradient(x, y, 0, x, y, 170);
      grad.addColorStop(0, `hsla(${(base + i * 60) % 360}, 90%, 55%, 0.8)`);
      grad.addColorStop(1, 'hsla(0, 0%, 0%, 0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, W, H);
    }
    g.globalAlpha = 0.85;
  }
  const words = f.part === 'drop' ? 'AGENT OFFICE' : f.part === 'build' ? 'GET READY' : 'DJ MERGE CONFLICT';
  fitFont(g, words, 60, W - 40);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffffff';
  g.fillText(words, W / 2, H * 0.42);
  g.globalAlpha = 1;
  led.needsUpdate = true;
}
