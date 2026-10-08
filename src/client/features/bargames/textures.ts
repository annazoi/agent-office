import * as THREE from 'three';
import { AXE_TARGET, DART, DART_NUMBERS } from '../../../shared/bargames';
import { canvasTexture } from '../../world/texture';
import { toon } from '../../world/toon';


/** A toon material with a picture on it, banded like everything else. */
export function toonMap(map: THREE.Texture): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ map, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap });
  m.userData.outlineParameters = { visible: false };
  return m;
}

/** The dart board's face: the numbers' wedges, the treble and double rings, the bulls and the ring of numbers round it. */
export function dartboardTexture(): THREE.CanvasTexture {
  const S = 1024;
  const px = S / 2 / DART.board;
  return canvasTexture(S, S, (g) => {
    const c = S / 2;
    g.fillStyle = '#141414';
    g.beginPath();
    g.arc(c, c, c, 0, Math.PI * 2);
    g.fill();
    const wedge = (r0: number, r1: number, a: number, color: string) => {
      g.fillStyle = color;
      g.beginPath();
      g.arc(c, c, r1 * px, a - Math.PI / 20, a + Math.PI / 20);
      g.arc(c, c, r0 * px, a + Math.PI / 20, a - Math.PI / 20, true);
      g.closePath();
      g.fill();
    };
    for (let i = 0; i < 20; i++) {
      // Clockwise from the top: on the canvas, y runs down, so that's clockwise from -π/2.
      const a = -Math.PI / 2 + (i * Math.PI) / 10;
      const dark = i % 2 === 0;
      wedge(DART.outer, DART.doubleOut, a, dark ? '#1b1b1b' : '#efe3c8');
      wedge(DART.trebleIn, DART.trebleOut, a, dark ? '#d62828' : '#2a9d4b');
      wedge(DART.doubleIn, DART.doubleOut, a, dark ? '#d62828' : '#2a9d4b');
    }
    g.fillStyle = '#2a9d4b';
    g.beginPath();
    g.arc(c, c, DART.outer * px, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#d62828';
    g.beginPath();
    g.arc(c, c, DART.bull * px, 0, Math.PI * 2);
    g.fill();
    // The wire: round the rings, and out along the wedges' edges.
    g.strokeStyle = '#c9ccd3';
    g.lineWidth = 2.5;
    for (const r of [DART.outer, DART.trebleIn, DART.trebleOut, DART.doubleIn, DART.doubleOut]) {
      g.beginPath();
      g.arc(c, c, r * px, 0, Math.PI * 2);
      g.stroke();
    }
    for (let i = 0; i < 20; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 10 - Math.PI / 20;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * DART.outer * px, c + Math.sin(a) * DART.outer * px);
      g.lineTo(c + Math.cos(a) * DART.doubleOut * px, c + Math.sin(a) * DART.doubleOut * px);
      g.stroke();
    }
    g.fillStyle = '#f5f5f5';
    g.font = '900 54px Nunito, ui-rounded, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const numbersAt = ((DART.doubleOut + DART.board) / 2) * px;
    DART_NUMBERS.forEach((n, i) => {
      const a = -Math.PI / 2 + (i * Math.PI) / 10;
      g.fillText(String(n), c + Math.cos(a) * numbersAt, c + Math.sin(a) * numbersAt);
    });
  });
}

/** The axe target: rings painted on pale planks, a number in each, and the two blue killshot dots. */
export function axeTargetTexture(): THREE.CanvasTexture {
  const px = 512;
  const W = Math.round(AXE_TARGET.width * px);
  const H = Math.round(AXE_TARGET.height * px);
  return canvasTexture(W, H, (g) => {
    // Upright planks, each its own shade, with a little grain.
    const planks = 5;
    for (let i = 0; i < planks; i++) {
      const x = (i * W) / planks;
      const tone = 0.9 + ((i * 7) % 5) * 0.035;
      g.fillStyle = `rgb(${Math.round(222 * tone)}, ${Math.round(186 * tone)}, ${Math.round(140 * tone)})`;
      g.fillRect(x, 0, W / planks, H);
      g.strokeStyle = 'rgba(110, 70, 35, 0.18)';
      g.lineWidth = 2;
      for (let k = 0; k < 9; k++) {
        const gx = x + 12 + ((k * 37 + i * 13) % (W / planks - 24));
        g.beginPath();
        g.moveTo(gx, 0);
        g.bezierCurveTo(gx + 6, H * 0.3, gx - 6, H * 0.6, gx + 3, H);
        g.stroke();
      }
      g.fillStyle = 'rgba(60, 35, 15, 0.45)';
      g.fillRect(x, 0, 3, H);
    }
    const cx = W / 2;
    const cy = H / 2;
    const rings = [...AXE_TARGET.rings].reverse();
    rings.forEach((ring, i) => {
      g.fillStyle = ring.points === 6 ? '#e63946' : i % 2 === 0 ? '#f7f3ea' : '#22223b';
      g.beginPath();
      g.arc(cx, cy, ring.r * px, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#111';
      g.lineWidth = 5;
      g.stroke();
    });
    g.font = '900 44px Nunito, ui-rounded, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    rings.forEach((ring, i) => {
      if (ring.points === 6) return;
      const inner = rings[i + 1]?.r ?? 0;
      g.fillStyle = i % 2 === 0 ? '#22223b' : '#f7f3ea';
      g.fillText(String(ring.points), cx, cy - ((ring.r + inner) / 2) * px);
    });
    g.fillStyle = '#fff';
    g.fillText('6', cx, cy + 2);
    const k = AXE_TARGET.kill;
    for (const s of [-1, 1]) {
      g.fillStyle = '#118ab2';
      g.beginPath();
      g.arc(cx + s * k.u * px, cy - k.v * px, k.r * px, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#fff';
      g.lineWidth = 4;
      g.stroke();
    }
  });
}
