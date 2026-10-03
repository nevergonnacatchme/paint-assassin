// Procedural canvas textures: nothing is loaded from the network.
import * as THREE from 'three';

function rng(seed: number) { // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d') as CanvasRenderingContext2D];
}
function finish(c: HTMLCanvasElement, repeat?: [number, number]): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

export function makeWoodTexture(repeat: number): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512); const r = rng(7);
  const tones = ['#dcbb91', '#d2b186', '#e4c8a1', '#d8b78d', '#cfae83'];
  const n = 8, pw = 512 / n;
  for (let i = 0; i < n; i++) {
    g.fillStyle = tones[i % tones.length]; g.fillRect(0, i * pw, 512, pw);
    for (let k = 0; k < 26; k++) { // grain
      g.strokeStyle = `rgba(120,80,40,${0.05 + r() * 0.08})`; g.lineWidth = 1;
      const y = i * pw + r() * pw, x = r() * 512, len = 60 + r() * 220;
      g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + len / 3, y + (r() - 0.5) * 4, x + len * 0.66, y + (r() - 0.5) * 4, x + len, y); g.stroke();
    }
    g.fillStyle = 'rgba(90,60,30,.35)'; g.fillRect(0, i * pw, 512, 2); // seam between planks
    const end = r() * 512; g.fillRect(end, i * pw, 2, pw); // staggered plank end
  }
  return finish(c, [repeat, repeat]);
}

export function makePlasterTexture(rx: number, ry: number): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256); const r = rng(3);
  g.fillStyle = '#f6f2ea'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1400; i++) { g.fillStyle = `rgba(150,140,170,${r() * 0.05})`; g.fillRect(r() * 256, r() * 256, 1 + r() * 3, 1 + r() * 3); }
  return finish(c, [rx, ry]);
}

export function makeArtTexture(seed: number): THREE.CanvasTexture {
  const [c, g] = canvas(256, 320); const r = rng(seed * 977 + 13);
  const pal = ['#ff8fab', '#7fdbca', '#ffd166', '#8ecae6', '#b39ddb', '#ffb38a', '#ffffff', '#3a3f5c'];
  g.fillStyle = ['#fff6f0', '#f0f6ff', '#f6f0ff', '#f0fff6'][seed % 4]; g.fillRect(0, 0, 256, 320);
  for (let i = 0; i < 9; i++) {
    g.fillStyle = pal[Math.floor(r() * pal.length)]; g.globalAlpha = 0.75 + r() * 0.25;
    const k = r();
    if (k < 0.4) { g.beginPath(); g.arc(r() * 256, r() * 320, 20 + r() * 70, 0, 6.3); g.fill(); }
    else if (k < 0.75) g.fillRect(r() * 200, r() * 260, 30 + r() * 110, 14 + r() * 60);
    else { g.beginPath(); const x = r() * 256, y = r() * 320; g.moveTo(x, y); g.lineTo(x + 80 * (r() - 0.3), y + 100 * r()); g.lineTo(x - 70 * r(), y + 90 * r()); g.fill(); }
  }
  g.globalAlpha = 1;
  return finish(c);
}

/** White paint-splat silhouette; tinted per instance. */
export function makeSplatTexture(seed: number): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256); const r = rng(seed * 4231 + 5);
  g.fillStyle = '#fff'; g.translate(128, 128);
  g.beginPath(); g.arc(0, 0, 44 + r() * 8, 0, 6.3); g.fill();
  for (let i = 0; i < 9; i++) { // lobes
    const a = r() * 6.3, d = 28 + r() * 22; g.beginPath(); g.arc(Math.cos(a) * d, Math.sin(a) * d, 14 + r() * 16, 0, 6.3); g.fill();
  }
  for (let i = 0; i < 10; i++) { // spiky streaks
    const a = r() * 6.3, len = 70 + r() * 40, w = 4 + r() * 7;
    g.save(); g.rotate(a); g.beginPath(); g.moveTo(20, -w); g.lineTo(len, 0); g.lineTo(20, w); g.fill(); g.beginPath(); g.arc(len + 6, 0, w * 0.8, 0, 6.3); g.fill(); g.restore();
  }
  for (let i = 0; i < 14; i++) { // satellite droplets
    const a = r() * 6.3, d = 80 + r() * 38; g.beginPath(); g.arc(Math.cos(a) * d, Math.sin(a) * d, 2 + r() * 5, 0, 6.3); g.fill();
  }
  return finish(c);
}

export function makeGlowTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 64);
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return finish(c);
}

export function makeRugTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(512, 512); const r = rng(21);
  const rings = ['#f3e9ff', '#ffe4ee', '#e2f6ff', '#fff3d6', '#e6ffe9'];
  for (let i = 0; i < 9; i++) { g.fillStyle = rings[i % rings.length]; g.beginPath(); g.arc(256, 256, 256 - i * 28, 0, 6.3); g.fill(); }
  const dots = ['#ff8fab', '#7fdbca', '#ffd166', '#8ecae6', '#b39ddb'];
  for (let i = 0; i < 40; i++) { g.fillStyle = dots[i % dots.length]; g.globalAlpha = 0.5; const a = r() * 6.3, d = 40 + r() * 170; g.beginPath(); g.arc(256 + Math.cos(a) * d, 256 + Math.sin(a) * d, 5 + r() * 14, 0, 6.3); g.fill(); }
  g.globalAlpha = 1;
  return finish(c);
}

export function makeNameTagTexture(name: string, color: string): THREE.CanvasTexture {
  const [c, g] = canvas(256, 64);
  g.fillStyle = 'rgba(255,255,255,.92)'; g.beginPath(); g.roundRect(4, 8, 248, 48, 24); g.fill();
  g.strokeStyle = color; g.lineWidth = 4; g.stroke();
  g.fillStyle = color; g.beginPath(); g.arc(34, 32, 10, 0, 6.3); g.fill();
  g.fillStyle = '#3a3f5c'; g.font = '700 28px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(name.slice(0, 12), 142, 34);
  return finish(c);
}
