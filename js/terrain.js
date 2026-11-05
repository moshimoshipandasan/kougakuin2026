// ============================================================
//  地形生成 — 高さ関数は世界の物理・配置の基準になる
// ============================================================

import * as THREE from 'three';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';
import { CONFIG } from './config.js';
import { clamp, lerp, smoothstep, mulberry32, hash2 } from './utils.js';

export const WORLD_SIZE = CONFIG.world.size;
export const HALF = WORLD_SIZE * 0.5;
export const WATER_LEVEL = CONFIG.world.waterLevel;
export const PLAY_RADIUS = HALF * 0.94;

const rng = mulberry32(CONFIG.world.seed);
const simplex = new SimplexNoise({ random: rng });
const simplex2 = new SimplexNoise({ random: mulberry32(CONFIG.world.seed + 991) });

/** 山岳ベルトの強度（0..1） */
function ridgeBelt(x, z) {
  const b = simplex.noise(x * 0.0021 - 41.3, z * 0.0021 + 92.7);
  return Math.pow(clamp(b * 1.45 + 0.22, 0, 1), 2.0);
}

/**
 * 指定座標の地面の高さ。
 * 決定論的で、毎フレーム呼んでも安全。
 */
export function heightAt(x, z) {
  let h = 0;
  h += simplex.noise(x * 0.0032, z * 0.0032) * 31;
  h += simplex.noise(x * 0.0088 + 11.2, z * 0.0088 - 7.4) * 11.5;
  h += simplex.noise(x * 0.0215 - 3.1, z * 0.0215 + 5.9) * 3.6;
  h += simplex.noise(x * 0.062, z * 0.062) * 1.1;

  // 山岳
  const belt = ridgeBelt(x, z);
  if (belt > 0.001) {
    const detail = 0.45 + 0.55 * (simplex.noise(x * 0.013 + 3.3, z * 0.013 + 3.3) * 0.5 + 0.5);
    h += belt * 92 * detail;
    h += belt * simplex2.noise(x * 0.05, z * 0.05) * 6;
  }

  // 侵食（谷を彫る）
  const erosion = simplex2.noise(x * 0.006, z * 0.006);
  h -= Math.pow(clamp(erosion * 0.5 + 0.5, 0, 1), 3.0) * 9 * (1 - belt);

  // スポーン地点（村）は平坦な台地に
  const d0 = Math.hypot(x, z);
  const flat = smoothstep(16, 74, d0);
  h = lerp(5.4, h, flat);

  // 外周は海に沈める
  const edge = smoothstep(HALF * 0.60, HALF * 1.03, d0);
  h = lerp(h, -38, edge * edge);

  return h;
}

const _e = 1.6;
/** 傾斜（0=平坦, 1=ほぼ垂直） */
export function slopeAt(x, z) {
  const h = heightAt(x, z);
  const hx = heightAt(x + _e, z);
  const hz = heightAt(x, z + _e);
  const dx = (hx - h) / _e;
  const dz = (hz - h) / _e;
  const g = Math.sqrt(dx * dx + dz * dz);
  return clamp(g / 1.6, 0, 1);
}

export function normalAt(x, z, out = new THREE.Vector3()) {
  const h = heightAt(x, z);
  const dx = (heightAt(x + _e, z) - h) / _e;
  const dz = (heightAt(x, z + _e) - h) / _e;
  return out.set(-dx, 1, -dz).normalize();
}

export function isWater(x, z) { return heightAt(x, z) < WATER_LEVEL - 0.05; }
export function inBounds(x, z) { return Math.hypot(x, z) < PLAY_RADIUS; }

/** バイオーム判定 */
export function biomeAt(x, z) {
  const h = heightAt(x, z);
  const s = slopeAt(x, z);
  if (h < WATER_LEVEL + 0.6) return 'shore';
  if (h > 66) return 'snow';
  if (h > 40 || s > 0.62) return 'rock';
  if (h > 24) return 'highland';
  return 'grass';
}

const PAL = {
  bed:    [0.10, 0.13, 0.12],
  sand:   [0.76, 0.69, 0.49],
  grass1: [0.20, 0.34, 0.13],
  grass2: [0.34, 0.46, 0.19],
  dry:    [0.44, 0.42, 0.22],
  rock:   [0.36, 0.35, 0.33],
  rock2:  [0.50, 0.48, 0.45],
  snow:   [0.90, 0.93, 0.97],
};

const _c = [0, 0, 0];
/** 地形の頂点色（0..1 の RGB 配列を out に書き込む） */
export function colorAt(x, z, h, slope, out = _c) {
  const n = simplex2.noise(x * 0.05, z * 0.05) * 0.5 + 0.5;
  const n2 = simplex.noise(x * 0.15, z * 0.15) * 0.5 + 0.5;

  let r, g, b;
  if (h < WATER_LEVEL + 1.6) {
    const t = smoothstep(WATER_LEVEL - 6, WATER_LEVEL + 1.6, h);
    r = lerp(PAL.bed[0], PAL.sand[0], t);
    g = lerp(PAL.bed[1], PAL.sand[1], t);
    b = lerp(PAL.bed[2], PAL.sand[2], t);
  } else {
    // 草 → 高地 → 岩 → 雪
    const tGrass = smoothstep(WATER_LEVEL + 1.2, WATER_LEVEL + 5, h);
    const gr = lerp(PAL.grass1[0], PAL.grass2[0], n);
    const gg = lerp(PAL.grass1[1], PAL.grass2[1], n);
    const gb = lerp(PAL.grass1[2], PAL.grass2[2], n);
    r = lerp(PAL.sand[0], gr, tGrass);
    g = lerp(PAL.sand[1], gg, tGrass);
    b = lerp(PAL.sand[2], gb, tGrass);

    const tDry = smoothstep(20, 34, h) * 0.7;
    r = lerp(r, PAL.dry[0], tDry);
    g = lerp(g, PAL.dry[1], tDry);
    b = lerp(b, PAL.dry[2], tDry);

    const tRock = Math.max(smoothstep(34, 52, h), smoothstep(0.42, 0.72, slope));
    r = lerp(r, lerp(PAL.rock[0], PAL.rock2[0], n), tRock);
    g = lerp(g, lerp(PAL.rock[1], PAL.rock2[1], n), tRock);
    b = lerp(b, lerp(PAL.rock[2], PAL.rock2[2], n), tRock);

    const tSnow = smoothstep(58, 74, h) * smoothstep(0.75, 0.35, slope);
    r = lerp(r, PAL.snow[0], tSnow);
    g = lerp(g, PAL.snow[1], tSnow);
    b = lerp(b, PAL.snow[2], tSnow);
  }

  // 微妙なムラ
  const v = (n2 - 0.5) * 0.09;
  out[0] = clamp(r + v, 0, 1);
  out[1] = clamp(g + v * 1.1, 0, 1);
  out[2] = clamp(b + v * 0.8, 0, 1);
  return out;
}

/** 木や草が生えるのに適した場所か */
export function isVegetationFriendly(x, z) {
  const h = heightAt(x, z);
  if (h < WATER_LEVEL + 1.1 || h > 58) return false;
  const s = slopeAt(x, z);
  if (s > 0.55) return false;
  const d = Math.hypot(x, z);
  if (d < 26) return false; // 村の中心
  return true;
}

export function hashAt(x, z) { return hash2(Math.floor(x), Math.floor(z)); }
