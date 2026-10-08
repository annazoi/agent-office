import * as THREE from 'three';
import { mulberry32 } from '../../../shared/util/rng';
import { tilingCanvasTexture } from '../texture';
import { PERIOD, ROAD, WALK, Paint } from './shared';

/** One bay of one storey: the wall with a window in it. */
export function bayTexture(p: Paint): THREE.CanvasTexture {
  const S = 64;
  return tilingCanvasTexture(S, S, (g) => {
    g.fillStyle = p.wall;
    g.fillRect(0, 0, S, S);
    const w = S * p.wide;
    const h = S * p.tall;
    const x = (S - w) / 2;
    const y = S * 0.18;
    g.fillStyle = p.glass;
    g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.fillRect(x + w * 0.12, y, w * 0.1, h);
    // A sill under it.
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(x - 2, y + h, w + 4, 3);
  });
}

/** Which windows are lit at night: 16 × 16 bays of them, each building showing a different part. */
export function litTexture(p: Paint, seed: number): THREE.CanvasTexture {
  const N = 16;
  const C = 16;
  const r = mulberry32(seed);
  return tilingCanvasTexture(N * C, N * C, (g) => {
    g.fillStyle = '#000000';
    g.fillRect(0, 0, N * C, N * C);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        if (r() < 0.5) continue;
        const k = r();
        g.fillStyle = k < 0.12 ? '#9ec9ff' : k < 0.55 ? '#ffd27a' : '#ffe6b0';
        const w = C * p.wide;
        const h = C * p.tall;
        g.fillRect(i * C + (C - w) / 2, j * C + C * 0.18, w, h);
      }
    }
  });
}

/** The streets and blocks, a block at a time: roads, sidewalks, crossings and the lane markings. */
export function groundTexture(): THREE.CanvasTexture {
  const S = 512;
  const px = S / PERIOD;
  return tilingCanvasTexture(S, S, (g) => {
    g.fillStyle = '#b3aea4';
    g.fillRect(0, 0, S, S);
    const mid = S / 2;
    const road = ROAD * px;
    const walk = (ROAD + WALK * 2) * px;
    g.fillStyle = '#d9d3c5';
    g.fillRect(mid - walk / 2, 0, walk, S);
    g.fillRect(0, mid - walk / 2, S, walk);
    g.fillStyle = '#4b505c';
    g.fillRect(mid - road / 2, 0, road, S);
    g.fillRect(0, mid - road / 2, S, road);
    // Dashed yellow down the middle of each road, stopping short of the crossing.
    g.fillStyle = '#ffd166';
    for (let i = 0; i < S; i += 24) {
      if (Math.abs(i + 6 - mid) < walk * 0.9) continue;
      g.fillRect(mid - 1.5, i, 3, 12);
      g.fillRect(i, mid - 1.5, 12, 3);
    }
    // Zebra crossings round the intersection.
    g.fillStyle = '#f1f1f1';
    for (let k = -road / 2 + 3; k < road / 2 - 3; k += 7) {
      for (const s of [-1, 1]) {
        g.fillRect(mid + k, mid + s * (walk / 2 + 2) - (s < 0 ? 16 : 0), 4, 16);
        g.fillRect(mid + s * (walk / 2 + 2) - (s < 0 ? 16 : 0), mid + k, 16, 4);
      }
    }
  });
}
