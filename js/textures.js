// ============================================================
//  手続き生成テクスチャ（画像ファイル不要）
// ============================================================

import * as THREE from 'three';
import { mulberry32, clamp, lerp, hash2 } from './utils.js';

function makeCanvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** タイル可能なバリューノイズ */
function tileNoise(gridN, seed) {
  const rnd = mulberry32(seed);
  const g = new Float32Array(gridN * gridN);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const at = (x, y) =>
    g[(((y % gridN) + gridN) % gridN) * gridN + (((x % gridN) + gridN) % gridN)];
  return (x, y) => {
    const fx = x * gridN, fy = y * gridN;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
  };
}

/** タイル可能な fBm */
export function fbm(seed, octaves = 4, base = 4) {
  const layers = [];
  let n = base, amp = 1, total = 0;
  for (let i = 0; i < octaves; i++) {
    layers.push({ f: tileNoise(n, seed + i * 131), amp });
    total += amp; n *= 2; amp *= 0.5;
  }
  return (x, y) => {
    let s = 0;
    for (let i = 0; i < layers.length; i++) s += layers[i].f(x, y) * layers[i].amp;
    return s / total;
  };
}

function finish(canvas, { repeat = 1, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------
//  草地
// ------------------------------------------------------------
let _grass;
export function grassTexture(size = 512) {
  if (_grass) return _grass;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const f1 = fbm(11, 4, 6);
  const f2 = fbm(29, 3, 26);
  const f3 = fbm(53, 2, 64);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const a = f1(u, v), b = f2(u, v), d = f3(u, v);
      const blade = (hash2(x * 0.9, y * 0.9) - 0.5) * 0.22;
      const i = (y * size + x) * 4;
      img.data[i]     = clamp((0.24 + 0.26 * a + 0.10 * b + blade) * 255, 0, 255);
      img.data[i + 1] = clamp((0.40 + 0.30 * a + 0.12 * d + blade * 1.2) * 255, 0, 255);
      img.data[i + 2] = clamp((0.15 + 0.14 * a + 0.06 * d) * 255, 0, 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  _grass = finish(c, { repeat: 1 });
  return _grass;
}

// ------------------------------------------------------------
//  岩
// ------------------------------------------------------------
let _rock;
export function rockTexture(size = 512) {
  if (_rock) return _rock;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const f1 = fbm(71, 5, 5);
  const f2 = fbm(97, 4, 18);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const a = f1(u, v), b = f2(u, v);
      let g = 0.30 + 0.34 * a + 0.14 * b;
      // ひび割れ
      const crack = Math.abs(a - 0.5);
      if (crack < 0.035) g *= 0.6;
      const i = (y * size + x) * 4;
      const tint = 1 + (b - 0.5) * 0.14;
      img.data[i]     = clamp(g * 255 * tint, 0, 255);
      img.data[i + 1] = clamp(g * 252 * tint, 0, 255);
      img.data[i + 2] = clamp(g * 244 * tint, 0, 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  _rock = finish(c);
  return _rock;
}

// ------------------------------------------------------------
//  樹皮
// ------------------------------------------------------------
let _bark;
export function barkTexture(size = 256) {
  if (_bark) return _bark;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const f1 = fbm(131, 4, 5);
  const f2 = fbm(151, 3, 20);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const stripe = f1(u * 3.5, v * 0.5);
      const b = f2(u, v * 0.4);
      const g = 0.26 + 0.26 * stripe + 0.10 * b;
      const i = (y * size + x) * 4;
      img.data[i]     = clamp(g * 1.05 * 255, 0, 255);
      img.data[i + 1] = clamp(g * 0.86 * 255, 0, 255);
      img.data[i + 2] = clamp(g * 0.62 * 255, 0, 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  _bark = finish(c, { repeat: 1 });
  return _bark;
}

// ------------------------------------------------------------
//  水のノーマルマップ
// ------------------------------------------------------------
function heightToNormal(height, size, strength = 1.0) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const H = (x, y) => height[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength * size * 0.06;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength * size * 0.06;
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * size + x) * 4;
      img.data[i]     = (( -dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = (( -dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

let _waterN;
export function waterNormalTexture(size = 256) {
  if (_waterN) return _waterN;
  const f = fbm(211, 4, 8);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) h[y * size + x] = f(x / size, y / size);
  _waterN = finish(heightToNormal(h, size, 1.0), { srgb: false });
  return _waterN;
}

// ------------------------------------------------------------
//  雲
// ------------------------------------------------------------
let _cloud;
export function cloudTexture(size = 512) {
  if (_cloud) return _cloud;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const f1 = fbm(311, 5, 4);
  const f2 = fbm(331, 4, 11);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = f1(x / size, y / size) * 0.7 + f2(x / size, y / size) * 0.3;
      let alpha = clamp((a - 0.48) * 3.4, 0, 1);
      alpha = Math.pow(alpha, 1.4);
      const i = (y * size + x) * 4;
      const br = 235 + 20 * (a - 0.5);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = clamp(br, 0, 255);
      img.data[i + 3] = alpha * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  _cloud = finish(c, { repeat: 1, srgb: true });
  return _cloud;
}

// ------------------------------------------------------------
//  パーティクル用の光点
// ------------------------------------------------------------
let _spark;
export function sparkTexture(size = 128) {
  if (_spark) return _spark;
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.28)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  _spark = finish(c, { repeat: 1 });
  _spark.wrapS = _spark.wrapT = THREE.ClampToEdgeWrapping;
  return _spark;
}

// ------------------------------------------------------------
//  草の板ポリゴン用アルファ
// ------------------------------------------------------------
let _blade;
export function grassBladeTexture(size = 128) {
  if (_blade) return _blade;
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const rnd = mulberry32(777);
  for (let i = 0; i < 14; i++) {
    const x0 = size * (0.1 + 0.8 * rnd());
    const w = 1.5 + rnd() * 2.5;
    const hgt = size * (0.5 + 0.5 * rnd());
    const bend = (rnd() - 0.5) * size * 0.3;
    const grad = ctx.createLinearGradient(x0, size, x0, size - hgt);
    grad.addColorStop(0, 'rgba(60,86,38,1)');
    grad.addColorStop(0.6, 'rgba(96,132,58,1)');
    grad.addColorStop(1, 'rgba(150,182,92,1)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, size);
    ctx.quadraticCurveTo(x0 + bend * 0.4, size - hgt * 0.55, x0 + bend, size - hgt);
    ctx.stroke();
  }
  _blade = finish(c, { repeat: 1 });
  _blade.wrapS = _blade.wrapT = THREE.ClampToEdgeWrapping;
  return _blade;
}

// ------------------------------------------------------------
//  汎用ノイズ（ルックアップ用）
// ------------------------------------------------------------
export function noiseLookup(seed, size = 256, octaves = 5) {
  const f = fbm(seed, octaves, 4);
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      data[y * size + x] = clamp(f(x / size, y / size) * 255, 0, 255);
  return { data, size };
}

/** 使い終わったテクスチャを破棄 */
export function disposeTextures() {
  [_grass, _rock, _bark, _waterN, _cloud, _spark, _blade].forEach((t) => t?.dispose());
  _grass = _rock = _bark = _waterN = _cloud = _spark = _blade = null;
}
