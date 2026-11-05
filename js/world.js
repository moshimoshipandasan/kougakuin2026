// ============================================================
//  世界の構築 — 地形・水・植生・村・衝突判定
// ============================================================

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from './config.js';
import { clamp, lerp, smoothstep, Rand, mulberry32 } from './utils.js';
import {
  heightAt, slopeAt, normalAt, colorAt, biomeAt, isWater,
  WORLD_SIZE, HALF, WATER_LEVEL, PLAY_RADIUS,
} from './terrain.js';
import {
  grassTexture, rockTexture, barkTexture, waterNormalTexture,
  cloudTexture, sparkTexture, grassBladeTexture, fbm,
} from './textures.js';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

function detailTexture(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const f1 = fbm(401, 4, 8);
  const f2 = fbm(419, 3, 32);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = f1(x / size, y / size), b = f2(x / size, y / size);
      let g = 0.82 + a * 0.30 + (b - 0.5) * 0.16;
      g = clamp(g, 0.5, 1.25);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = clamp(g * 210, 0, 255);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ------------------------------------------------------------
//  水面シェーダ
// ------------------------------------------------------------
const WATER_VERT = /* glsl */`
  uniform float uTime;
  uniform sampler2D uHeightMap;
  uniform float uWorldSize;
  varying vec3 vWorld;
  varying vec3 vNormal;

  vec3 gerstner(vec2 p, vec2 dir, float steep, float wl, float speed, float t, out vec3 tangent) {
    float k = 6.28318 / wl;
    vec2 d = normalize(dir);
    float f = k * (dot(d, p) - speed * t);
    float a = steep / k;
    float s = sin(f), c = cos(f);
    tangent = vec3(1.0 - d.x*d.x*steep*s, d.x*steep*c, -d.x*d.y*steep*s);
    return vec3(d.x*a*c, a*s, d.y*a*c);
  }

  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec2 p = wp.xz;
    vec3 t1, t2, t3;
    vec3 g = vec3(0.0);
    g += gerstner(p, vec2(1.0, 0.25), 0.16, 14.0, 1.1, uTime, t1);
    g += gerstner(p, vec2(-0.6, 1.0), 0.12, 8.5, 1.5, uTime * 1.2, t2);
    g += gerstner(p, vec2(0.3, -1.0), 0.08, 5.0, 1.9, uTime * 1.5, t3);
    wp.y += g.y;
    vWorld = wp.xyz;
    vNormal = normalize(vec3(-(t1.y + t2.y + t3.y), 1.0, -(t1.z + t2.z + t3.z)));
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const WATER_FRAG = /* glsl */`
  precision highp float;
  uniform float uTime;
  uniform vec3 uSunDir, uSunColor, uSkyTop, uSkyHorizon, uDeep, uShallow, uFoam;
  uniform vec3 uCamPos;
  uniform float uFogNear, uFogFar;
  uniform vec3 uFogColor;
  uniform sampler2D uNormalMap;
  uniform sampler2D uHeightMap;
  uniform float uWorldSize, uWaterLevel;
  varying vec3 vWorld;
  varying vec3 vNormal;

  void main() {
    vec3 V = normalize(uCamPos - vWorld);
    vec2 uvN = vWorld.xz * 0.045;
    vec3 n1 = texture2D(uNormalMap, uvN + vec2(uTime * 0.012, uTime * 0.008)).rgb * 2.0 - 1.0;
    vec3 n2 = texture2D(uNormalMap, uvN * 2.3 - vec2(uTime * 0.02, uTime * 0.014)).rgb * 2.0 - 1.0;
    vec3 N = normalize(vNormal + vec3(n1.x + n2.x * 0.6, 0.0, n1.z + n2.z * 0.6) * 0.55);

    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.0);
    fres = mix(0.045, 1.0, fres);

    vec3 skyRefl = mix(uSkyHorizon, uSkyTop, 0.5);
    vec3 L = normalize(uSunDir);
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 420.0) * 3.0;
    float sparkle = pow(max(dot(N, H), 0.0), 60.0) * 0.25;

    vec2 uvH = (vWorld.xz / uWorldSize) + 0.5;
    float terr = texture2D(uHeightMap, uvH).r * 255.0 - 128.0;
    float depth = uWaterLevel - terr;

    float shallowMix = 1.0 - smoothstep(0.4, 6.5, depth);
    vec3 body = mix(uDeep, uShallow, shallowMix);

    vec3 col = mix(body, skyRefl, fres * 0.85);
    col += uSunColor * (spec + sparkle);

    // 岸の泡
    float foam = smoothstep(0.65, 0.05, depth) * (0.55 + 0.45 * sin(vWorld.x * 3.0 + vWorld.z * 2.3 + uTime * 2.2));
    col = mix(col, uFoam, clamp(foam, 0.0, 0.75));

    float dist = distance(uCamPos, vWorld);
    float fogF = smoothstep(uFogNear, uFogFar, dist);
    col = mix(col, uFogColor, fogF);

    float alpha = mix(0.72, 0.96, fres);
    alpha = mix(alpha, 0.35, shallowMix * 0.5);
    gl_FragColor = vec4(col, alpha);
  }
`;

// ------------------------------------------------------------
//  草シェーダ
// ------------------------------------------------------------
const GRASS_VERT = /* glsl */`
  uniform float uTime;
  uniform vec3 uPlayerPos;
  uniform float uRadius;
  varying vec2 vUv;
  varying vec3 vWorld;

  void main() {
    vUv = uv;
    vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
    float ph = ip.x * 0.83 + ip.z * 0.61;
    float gust = sin(uTime * 0.55 + ip.x * 0.05) * 0.5 + 0.5;
    float sway = (sin(uTime * 1.9 + ph) * 0.6 + sin(uTime * 3.7 + ph * 1.7) * 0.4);
    float bend = uv.y * uv.y * sway * (0.20 + gust * 0.30);
    vec3 pos = position;
    pos.x += bend;
    pos.z += bend * 0.55;
    vec4 wp = instanceMatrix * vec4(pos, 1.0);
    vWorld = (modelMatrix * wp).xyz;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * wp;
  }
`;

const GRASS_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uMap;
  uniform vec3 uSunDir, uSunColor, uAmbient;
  uniform vec3 uFogColor;
  uniform float uFogNear, uFogFar;
  uniform vec3 uPlayerPos;
  uniform float uRadius;
  uniform vec3 uFirePos, uFireColor;
  uniform float uFireI, uFireRange;
  varying vec2 vUv;
  varying vec3 vWorld;

  void main() {
    vec4 tex = texture2D(uMap, vUv);
    if (tex.a < 0.42) discard;
    vec3 base = tex.rgb;
    float diff = max(dot(vec3(0.0, 1.0, 0.0), normalize(uSunDir)), 0.0);
    vec3 lit = base * (uAmbient + uSunColor * diff * 1.15);

    // 焚き火の灯り
    vec3 toFire = uFirePos - vWorld;
    float fd = length(toFire);
    float atten = clamp(1.0 - fd / uFireRange, 0.0, 1.0);
    atten *= atten;
    float fnl = max(dot(vec3(0.0, 1.0, 0.0), normalize(toFire)), 0.0) * 0.55 + 0.45;
    lit += base * uFireColor * atten * fnl * uFireI;

    float dist = distance(vWorld, uPlayerPos);
    float fade = 1.0 - smoothstep(uRadius * 0.62, uRadius * 0.98, dist);
    if (fade < 0.02) discard;
    float fogF = smoothstep(uFogNear, uFogFar, dist);
    vec3 col = mix(lit, uFogColor, fogF);
    gl_FragColor = vec4(col, tex.a * fade);
  }
`;

// ============================================================
export class World {
  constructor(scene) {
    this.scene = scene;
    this.colliders = new Map();
    this.cellSize = 10;
    this.grassInstances = null;
    this._grassPos = null;
    this._rand = new Rand(4242);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._col = new THREE.Color();
    this.treePositions = [];
    this.waterLevel = WATER_LEVEL;
    this.villageCenter = new THREE.Vector3(0, heightAt(0, 0), 0);
    this.campfires = [];
    this.disposables = [];
  }

  getHeight(x, z) { return heightAt(x, z); }
  getNormal(x, z) { return normalAt(x, z); }
  isWater(x, z) { return isWater(x, z); }

  // --- 衝突判定 ---
  addCollider(x, z, r) {
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    const k = cx + ',' + cz;
    let arr = this.colliders.get(k);
    if (!arr) { arr = []; this.colliders.set(k, arr); }
    arr.push({ x, z, r });
  }

  resolveCollision(pos, radius) {
    const cx = Math.floor(pos.x / this.cellSize);
    const cz = Math.floor(pos.z / this.cellSize);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const arr = this.colliders.get((cx + dx) + ',' + (cz + dz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) {
          const c = arr[i];
          const ex = pos.x - c.x, ez = pos.z - c.z;
          const rr = c.r + radius;
          const d2 = ex * ex + ez * ez;
          if (d2 < rr * rr && d2 > 1e-6) {
            const d = Math.sqrt(d2);
            const push = (rr - d) / d;
            pos.x += ex * push;
            pos.z += ez * push;
          }
        }
      }
    }
    return pos;
  }

  // ============================================================
  async build(onProgress = () => {}) {
    onProgress(0.05, '地形を彫っています');
    this._buildTerrain();
    await nextFrame();

    onProgress(0.30, '海と湖を満たしています');
    this._buildWater();
    await nextFrame();

    onProgress(0.45, '森を植えています');
    this._buildTrees();
    await nextFrame();

    onProgress(0.62, '岩と茂みを配置しています');
    this._buildRocks();
    this._buildBushes();
    await nextFrame();

    onProgress(0.74, '村を建てています');
    this._buildVillage();
    await nextFrame();

    onProgress(0.88, '草を生やしています');
    this._buildGrass();
    await nextFrame();

    onProgress(0.97, '仕上げ');
    await nextFrame();
    onProgress(1.0, '完了');
  }

  // ------------------------------------------------------------
  _buildTerrain() {
    const seg = CONFIG.world.segments;
    const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, seg, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const col = [0, 0, 0];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const h = heightAt(x, z);
      pos.setY(i, h);
      const s = slopeAt(x, z);
      colorAt(x, z, h, s, col);
      colors[i * 3] = col[0];
      colors[i * 3 + 1] = col[1];
      colors[i * 3 + 2] = col[2];
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    const detail = detailTexture(512);
    detail.repeat.set(120, 120);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: detail,
      roughness: 0.95,
      metalness: 0.0,
      envMapIntensity: 0.4,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = 'terrain';
    this.terrain = mesh;
    this.scene.add(mesh);
    this.disposables.push(geo, mat, detail);
  }

  // ------------------------------------------------------------
  _buildWater() {
    // 高さマップ（水面の深さ・泡に使う）
    const N = 256;
    const data = new Uint8Array(N * N * 4);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const wx = (x / (N - 1) - 0.5) * WORLD_SIZE;
        const wz = (y / (N - 1) - 0.5) * WORLD_SIZE;
        const h = clamp(heightAt(wx, wz), -128, 127);
        const i = (y * N + x) * 4;
        data[i] = Math.round(h + 128);
        data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 255;
      }
    }
    const heightMap = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
    heightMap.needsUpdate = true;
    heightMap.minFilter = heightMap.magFilter = THREE.LinearFilter;
    heightMap.wrapS = heightMap.wrapT = THREE.ClampToEdgeWrapping;

    const geo = new THREE.PlaneGeometry(WORLD_SIZE * 1.35, WORLD_SIZE * 1.35, 220, 220);
    geo.rotateX(-Math.PI / 2);

    const normalMap = waterNormalTexture();
    normalMap.repeat.set(1, 1);

    this.waterMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uSkyTop: { value: new THREE.Color(0x2f6ec4) },
        uSkyHorizon: { value: new THREE.Color(0xa8c8e8) },
        uDeep: { value: new THREE.Color(0x0a2233) },
        uShallow: { value: new THREE.Color(0x2e7f8f) },
        uFoam: { value: new THREE.Color(0xd8eef2) },
        uCamPos: { value: new THREE.Vector3() },
        uNormalMap: { value: normalMap },
        uHeightMap: { value: heightMap },
        uWorldSize: { value: WORLD_SIZE },
        uWaterLevel: { value: WATER_LEVEL },
        uFogColor: { value: new THREE.Color(0xa8c8e8) },
        uFogNear: { value: CONFIG.render.fogNear },
        uFogFar: { value: CONFIG.render.fogFar },
      },
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    const water = new THREE.Mesh(geo, this.waterMat);
    water.position.y = WATER_LEVEL;
    water.renderOrder = 5;
    water.name = 'water';
    this.water = water;
    this.scene.add(water);
    this.disposables.push(geo, this.waterMat, heightMap);
  }

  // ------------------------------------------------------------
  _makeTreeGeometries() {
    // 広葉樹：幹 + 3つの球
    const trunk = new THREE.CylinderGeometry(0.18, 0.36, 4.6, 7, 1);
    trunk.translate(0, 2.3, 0);
    const blobs = [];
    const offs = [
      [0, 4.9, 0, 1.85],
      [0.75, 5.7, 0.35, 1.35],
      [-0.7, 5.5, -0.45, 1.25],
      [0.2, 6.6, -0.2, 1.05],
    ];
    for (const [x, y, z, r] of offs) {
      const g = new THREE.IcosahedronGeometry(r, 0);
      g.translate(x, y, z);
      blobs.push(g);
    }
    const leafGeo = mergeGeometries(blobs);

    // 針葉樹：幹 + 3つの円錐
    const ptrunk = new THREE.CylinderGeometry(0.14, 0.28, 3.2, 6, 1);
    ptrunk.translate(0, 1.6, 0);
    const cones = [];
    const cs = [[1.9, 3.0, 3.2], [1.5, 2.6, 5.0], [1.05, 2.2, 6.7]];
    for (const [r, h, y] of cs) {
      const g = new THREE.ConeGeometry(r, h, 8, 1);
      g.translate(0, y, 0);
      cones.push(g);
    }
    const pineGeo = mergeGeometries(cones);

    return { trunk, leafGeo, ptrunk, pineGeo };
  }

  _buildTrees() {
    const { trunk, leafGeo, ptrunk, pineGeo } = this._makeTreeGeometries();
    const bark = barkTexture();
    bark.repeat.set(1, 2.2);
    const leafTex = grassTexture();

    const trunkMat = new THREE.MeshStandardMaterial({ map: bark, roughness: 0.92, metalness: 0 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0, flatShading: true });
    const pineMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, flatShading: true });

    const total = CONFIG.world.trees;
    const nBroad = Math.floor(total * 0.68);
    const nPine = total - nBroad;

    const places = this._scatterPositions(total, 6.5, (x, z) => {
      const h = heightAt(x, z);
      if (h < WATER_LEVEL + 1.2 || h > 62) return 0;
      const s = slopeAt(x, z);
      if (s > 0.5) return 0;
      const d = Math.hypot(x, z);
      if (d < 30) return 0;
      // 山岳ベルトに近いほど針葉樹
      const alt = smoothstep(20, 46, h);
      return 0.6 + alt * 0.4;
    }, CONFIG.world.seed + 7);

    const rand = new Rand(CONFIG.world.seed + 99);
    const broad = [], pine = [];
    for (let i = 0; i < places.length; i++) {
      const p = places[i];
      const h = heightAt(p.x, p.z);
      const isPine = (h > 34) ? rand.chance(0.8) : rand.chance(0.16);
      if (isPine && pine.length < nPine) pine.push(p);
      else if (broad.length < nBroad) broad.push(p);
      else pine.push(p);
    }

    const mk = (geo, mat, list, scaleRange, colorRange) => {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      im.castShadow = true;
      im.receiveShadow = true;
      im.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        const s = rand.range(scaleRange[0], scaleRange[1]);
        this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand.range(0, Math.PI * 2));
        this._s.set(s * rand.range(0.9, 1.1), s * rand.range(0.92, 1.15), s * rand.range(0.9, 1.1));
        this._v.set(p.x, p.y - 0.25, p.z);
        this._m.compose(this._v, this._q, this._s);
        im.setMatrixAt(i, this._m);
        this._col.setHSL(
          rand.range(colorRange[0], colorRange[1]),
          rand.range(colorRange[2], colorRange[3]),
          rand.range(colorRange[4], colorRange[5])
        );
        im.setColorAt(i, this._col);
        this.addCollider(p.x, p.z, 0.42 * s + 0.18);
        this.treePositions.push(p.x, p.z);
      }
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.frustumCulled = true;
      im.computeBoundingSphere();
      this.scene.add(im);
      return im;
    };

    mk(trunk, trunkMat, broad, [0.85, 1.5], [0.07, 0.11, 0.2, 0.45, 0.14, 0.26]);
    mk(leafGeo, leafMat, broad, [0.85, 1.5], [0.19, 0.31, 0.35, 0.62, 0.22, 0.42]);
    mk(ptrunk, trunkMat, pine, [0.8, 1.45], [0.06, 0.10, 0.2, 0.4, 0.12, 0.22]);
    mk(pineGeo, pineMat, pine, [0.8, 1.45], [0.26, 0.36, 0.30, 0.5, 0.14, 0.26]);

    this.disposables.push(trunk, leafGeo, ptrunk, pineGeo, trunkMat, leafMat, pineMat);
  }

  // ------------------------------------------------------------
  _buildRocks() {
    const geo = new THREE.DodecahedronGeometry(1, 0);
    const mat = new THREE.MeshStandardMaterial({
      map: rockTexture(), roughness: 0.94, metalness: 0.02, flatShading: true, color: 0xffffff,
    });
    rockTexture().repeat.set(2, 2);
    const list = this._scatterPositions(CONFIG.world.rocks, 5.0, (x, z) => {
      const h = heightAt(x, z);
      if (h < WATER_LEVEL - 1) return 0;
      const s = slopeAt(x, z);
      const d = Math.hypot(x, z);
      if (d < 24) return 0.15;
      return 0.25 + s * 0.75 + smoothstep(30, 60, h) * 0.5;
    }, CONFIG.world.seed + 313);

    const rand = new Rand(CONFIG.world.seed + 555);
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    im.castShadow = true;
    im.receiveShadow = true;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const s = rand.range(0.5, 2.6) * (biomeAt(p.x, p.z) === 'rock' ? 1.7 : 1);
      this._q.setFromEuler(new THREE.Euler(rand.range(0, 3), rand.range(0, 6), rand.range(0, 3)));
      this._s.set(s * rand.range(0.8, 1.3), s * rand.range(0.55, 1.0), s * rand.range(0.8, 1.3));
      this._v.set(p.x, p.y - s * 0.28, p.z);
      this._m.compose(this._v, this._q, this._s);
      im.setMatrixAt(i, this._m);
      const g = rand.range(0.34, 0.62);
      this._col.setRGB(g, g * 0.98, g * 0.93);
      im.setColorAt(i, this._col);
      if (s > 0.9) this.addCollider(p.x, p.z, s * 0.85);
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    this.scene.add(im);
    this.disposables.push(geo, mat);
  }

  // ------------------------------------------------------------
  _buildBushes() {
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, flatShading: true, color: 0xffffff });
    const list = this._scatterPositions(700, 4, (x, z) => {
      const h = heightAt(x, z);
      if (h < WATER_LEVEL + 1 || h > 52) return 0;
      if (slopeAt(x, z) > 0.5) return 0;
      if (Math.hypot(x, z) < 22) return 0;
      return 0.5;
    }, CONFIG.world.seed + 808);

    const rand = new Rand(CONFIG.world.seed + 909);
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    im.castShadow = true;
    im.receiveShadow = true;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      const s = rand.range(0.5, 1.4);
      this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand.range(0, 6.28));
      this._s.set(s * 1.25, s * rand.range(0.6, 0.9), s * 1.25);
      this._v.set(p.x, p.y + s * 0.2, p.z);
      this._m.compose(this._v, this._q, this._s);
      im.setMatrixAt(i, this._m);
      this._col.setHSL(rand.range(0.22, 0.33), rand.range(0.35, 0.6), rand.range(0.16, 0.3));
      im.setColorAt(i, this._col);
    }
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    this.scene.add(im);
    this.disposables.push(geo, mat);
  }

  // ------------------------------------------------------------
  _buildVillage() {
    const group = new THREE.Group();
    group.name = 'village';
    this.village = group;
    this.scene.add(group);

    const woodMat = new THREE.MeshStandardMaterial({ map: barkTexture(), roughness: 0.85, metalness: 0, color: 0xb08a5a });
    const plasterMat = new THREE.MeshStandardMaterial({ color: 0xd9cfb4, roughness: 0.95, metalness: 0 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x7a3b2c, roughness: 0.8, metalness: 0.02 });
    const stoneMat = new THREE.MeshStandardMaterial({ map: rockTexture(), roughness: 0.92, metalness: 0.02, color: 0xb8b4ac });
    const glowMat = new THREE.MeshBasicMaterial({ color: 0xffcf7a });

    this.disposables.push(woodMat, plasterMat, roofMat, stoneMat, glowMat);

    const y0 = heightAt(0, 0);

    const makeHouse = (x, z, rotY, w, d, h) => {
      const g = new THREE.Group();
      const y = heightAt(x, z);
      g.position.set(x, y, z);
      g.rotation.y = rotY;

      const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), plasterMat);
      body.position.y = h / 2;
      body.castShadow = true; body.receiveShadow = true;
      g.add(body);

      // 木枠
      const frame = new THREE.Mesh(new THREE.BoxGeometry(w * 1.02, h * 0.14, d * 1.02), woodMat);
      frame.position.y = h * 0.98;
      frame.castShadow = true;
      g.add(frame);
      const base = new THREE.Mesh(new THREE.BoxGeometry(w * 1.04, h * 0.16, d * 1.04), stoneMat);
      base.position.y = h * 0.08;
      base.receiveShadow = true;
      g.add(base);

      // 屋根（四角錐）
      const roof = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.86, h * 0.95, 4), roofMat);
      roof.position.y = h + h * 0.42;
      roof.rotation.y = Math.PI / 4;
      roof.castShadow = true;
      g.add(roof);

      // 窓（発光）
      const win = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.24, h * 0.3), glowMat);
      win.position.set(0, h * 0.55, d / 2 + 0.02);
      g.add(win);

      // 扉
      const door = new THREE.Mesh(new THREE.BoxGeometry(w * 0.26, h * 0.6, 0.1), woodMat);
      door.position.set(w * 0.3, h * 0.3, d / 2 + 0.03);
      g.add(door);

      group.add(g);
      this.addCollider(x, z, Math.max(w, d) * 0.62);
      return g;
    };

    const houses = [
      [0, 15.5, Math.PI, 6.2, 5.2, 3.4],
      [13.5, -7.5, -Math.PI / 2 + 0.3, 5.6, 5.0, 3.1],
      [-13.5, -7.5, Math.PI / 2 - 0.3, 5.6, 5.0, 3.1],
      [-15.5, 6.0, Math.PI / 2, 5.0, 4.6, 3.0],
      [15.5, 6.0, -Math.PI / 2, 5.0, 4.6, 3.0],
    ];
    for (const h of houses) makeHouse(...h);

    // 井戸
    const well = new THREE.Group();
    well.position.set(0, y0, -8);
    const wring = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.25, 1.0, 16, 1, true), stoneMat);
    wring.position.y = 0.5; wring.castShadow = true; wring.receiveShadow = true;
    well.add(wring);
    for (let i = 0; i < 2; i++) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.6, 0.16), woodMat);
      post.position.set(i ? 0.9 : -0.9, 1.3, 0);
      post.castShadow = true;
      well.add(post);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.16, 0.16), woodMat);
    beam.position.y = 2.6; beam.castShadow = true;
    well.add(beam);
    const roofW = new THREE.Mesh(new THREE.ConeGeometry(1.9, 1.0, 4), roofMat);
    roofW.position.y = 3.3; roofW.rotation.y = Math.PI / 4; roofW.castShadow = true;
    well.add(roofW);
    group.add(well);
    this.addCollider(0, -8, 1.5);

    // 焚き火
    const firePos = new THREE.Vector3(0, heightAt(0, 6), 6);
    const fire = new THREE.Group();
    fire.position.copy(firePos);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.16, 6, 14), stoneMat);
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.1; ring.castShadow = true;
    fire.add(ring);
    for (let i = 0; i < 5; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 1.5, 5), woodMat);
      log.rotation.z = Math.PI / 2.4;
      log.rotation.y = (i / 5) * Math.PI;
      log.position.y = 0.35;
      log.castShadow = true;
      fire.add(log);
    }
    const light = new THREE.PointLight(0xff9a3c, 6.5, 22, 1.8);
    light.position.y = 1.1;
    light.castShadow = false;
    fire.add(light);
    this.campfires.push({ light, base: 6.5, pos: firePos.clone() });

    // 炎のパーティクル
    const pCount = 70;
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(pCount * 3);
    const pSeed = new Float32Array(pCount);
    for (let i = 0; i < pCount; i++) {
      pSeed[i] = Math.random();
      pPos[i * 3] = 0; pPos[i * 3 + 1] = -100; pPos[i * 3 + 2] = 0;
    }
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    const pMat = new THREE.PointsMaterial({
      size: 0.55, map: sparkTexture(), transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, color: 0xff8a2a, sizeAttenuation: true,
    });
    const pts = new THREE.Points(pGeo, pMat);
    pts.position.copy(firePos);
    pts.frustumCulled = false;
    group.add(pts);
    this.fireParticles = { pts, geo: pGeo, seed: pSeed, count: pCount };
    this.disposables.push(pGeo, pMat);
    group.add(fire);

    // 柵
    const fenceMat = woodMat;
    const fenceGeo = new THREE.BoxGeometry(0.14, 1.3, 0.14);
    fenceGeo.translate(0, 0.65, 0);
    const railGeo = new THREE.BoxGeometry(2.4, 0.12, 0.08);
    const posts = [];
    const rails = [];
    const R = 21;
    const segs = 56;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      const h = heightAt(x, z);
      if (h < WATER_LEVEL + 0.6) continue;
      posts.push({ x, z, y: h });
      if (i % 3 === 0) this.addCollider(x, z, 0.3);
    }
    const postIM = new THREE.InstancedMesh(fenceGeo, fenceMat, posts.length);
    postIM.castShadow = true;
    for (let i = 0; i < posts.length; i++) {
      this._v.set(posts[i].x, posts[i].y - 0.1, posts[i].z);
      this._q.identity(); this._s.set(1, 1, 1);
      this._m.compose(this._v, this._q, this._s);
      postIM.setMatrixAt(i, this._m);
    }
    postIM.instanceMatrix.needsUpdate = true;
    postIM.computeBoundingSphere();
    group.add(postIM);

    for (let i = 0; i < posts.length; i++) {
      const a = posts[i], b = posts[(i + 1) % posts.length];
      const dx = b.x - a.x, dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      if (len > 4.5) continue;
      for (const yy of [0.45, 0.95]) {
        const rail = new THREE.Mesh(railGeo, fenceMat);
        rail.scale.x = len / 2.4;
        rail.position.set((a.x + b.x) / 2, (a.y + b.y) / 2 + yy, (a.z + b.z) / 2);
        rail.rotation.y = Math.atan2(dx, dz) + Math.PI / 2;
        rail.castShadow = true;
        rails.push(rail);
        group.add(rail);
      }
    }
    this.disposables.push(fenceGeo, railGeo);

    // 案内板
    const sign = new THREE.Group();
    const sx = 3.4, sz = 10.5;
    sign.position.set(sx, heightAt(sx, sz), sz);
    const spost = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.4, 0.14), woodMat);
    spost.position.y = 1.2; spost.castShadow = true;
    sign.add(spost);
    const board = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.7, 0.09), woodMat);
    board.position.y = 1.9; board.castShadow = true;
    sign.add(board);
    group.add(sign);
    this.addCollider(sx, sz, 0.4);

    // 古代遺跡（石柱）
    const ruinRand = new Rand(31337);
    const pillarGeo = new THREE.CylinderGeometry(0.55, 0.7, 5.5, 8);
    const pillarList = [];
    for (let k = 0; k < 3; k++) {
      const a = ruinRand.range(0, Math.PI * 2);
      const dist = ruinRand.range(70, 150);
      const cx = Math.cos(a) * dist, cz = Math.sin(a) * dist;
      if (heightAt(cx, cz) < WATER_LEVEL + 1) continue;
      for (let i = 0; i < ruinRand.int(5, 9); i++) {
        const px = cx + ruinRand.range(-9, 9);
        const pz = cz + ruinRand.range(-9, 9);
        const ph = heightAt(px, pz);
        if (ph < WATER_LEVEL + 0.5) continue;
        pillarList.push({ x: px, y: ph, z: pz, s: ruinRand.range(0.6, 1.25), t: ruinRand.range(-0.2, 0.2) });
      }
    }
    const ruinIM = new THREE.InstancedMesh(pillarGeo, stoneMat, pillarList.length);
    ruinIM.castShadow = true; ruinIM.receiveShadow = true;
    for (let i = 0; i < pillarList.length; i++) {
      const p = pillarList[i];
      this._q.setFromEuler(new THREE.Euler(p.t, 0, p.t * 0.7));
      this._s.set(p.s, p.s * ruinRand.range(0.5, 1.4), p.s);
      this._v.set(p.x, p.y + 2.4 * p.s, p.z);
      this._m.compose(this._v, this._q, this._s);
      ruinIM.setMatrixAt(i, this._m);
      this.addCollider(p.x, p.z, 0.8 * p.s);
    }
    ruinIM.instanceMatrix.needsUpdate = true;
    ruinIM.computeBoundingSphere();
    group.add(ruinIM);
    this.disposables.push(pillarGeo);
  }

  // ------------------------------------------------------------
  _buildGrass() {
    const blade = grassBladeTexture();
    const count = CONFIG.world.grassCount;
    const radius = CONFIG.world.grassRadius;

    const quad = new THREE.PlaneGeometry(0.62, 0.78);
    quad.translate(0, 0.39, 0);
    const q2 = quad.clone();
    q2.rotateY(Math.PI / 2);
    const geo = mergeGeometries([quad, q2]);
    quad.dispose(); q2.dispose();

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uMap: { value: blade },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uAmbient: { value: new THREE.Color(0.35, 0.4, 0.3) },
        uFogColor: { value: new THREE.Color(0xa8c8e8) },
        uFogNear: { value: CONFIG.render.fogNear },
        uFogFar: { value: CONFIG.render.fogFar },
        uPlayerPos: { value: new THREE.Vector3() },
        uRadius: { value: radius },
        uFirePos: { value: new THREE.Vector3(0, -999, 0) },
        uFireColor: { value: new THREE.Color(0xffb066).convertSRGBToLinear() },
        uFireI: { value: 0 },
        uFireRange: { value: 16 },
      },
      vertexShader: GRASS_VERT,
      fragmentShader: GRASS_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const im = new THREE.InstancedMesh(geo, mat, count);
    im.frustumCulled = false;
    im.renderOrder = 4;
    this.grassInstances = im;
    this.grassMat = mat;
    this._grassPos = new Float32Array(count * 2);
    const rand = new Rand(1234);

    for (let i = 0; i < count; i++) {
      const a = rand.range(0, Math.PI * 2);
      const r = Math.sqrt(rand.range(0, 1)) * radius;
      this._grassPos[i * 2] = Math.cos(a) * r;
      this._grassPos[i * 2 + 1] = Math.sin(a) * r;
    }
    this._placeGrassAll(true);

    this.scene.add(im);
    this.disposables.push(geo, mat);
  }

  _placeGrassAll(initial) {
    const im = this.grassInstances;
    const count = im.count;
    const radius = CONFIG.world.grassRadius;
    const rand = this._rand;
    for (let i = 0; i < count; i++) {
      const x = this._grassPos[i * 2];
      const z = this._grassPos[i * 2 + 1];
      const y = heightAt(x, z);
      this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand.range(0, Math.PI * 2));
      const s = rand.range(0.7, 1.6);
      this._s.set(s, s * rand.range(0.7, 1.35), s);
      this._v.set(x, y - 0.06, z);
      this._m.compose(this._v, this._q, this._s);
      im.setMatrixAt(i, this._m);
    }
    im.instanceMatrix.needsUpdate = true;
    if (initial) im.computeBoundingSphere();
  }

  _updateGrass(playerPos) {
    const im = this.grassInstances;
    if (!im) return;
    const count = im.count;
    const radius = CONFIG.world.grassRadius;
    const r2 = radius * radius;
    const rand = this._rand;
    let dirty = false;
    const px = playerPos.x, pz = playerPos.z;
    for (let i = 0; i < count; i++) {
      const x = this._grassPos[i * 2];
      const z = this._grassPos[i * 2 + 1];
      const dx = x - px, dz = z - pz;
      if (dx * dx + dz * dz < r2) continue;
      // 遠くなった草をプレイヤーの周囲に再配置
      let nx = 0, nz = 0, ny = 0, ok = false;
      for (let t = 0; t < 3; t++) {
        const a = rand.range(0, Math.PI * 2);
        const r = radius * (0.72 + rand.range(0, 0.28));
        nx = px + Math.cos(a) * r;
        nz = pz + Math.sin(a) * r;
        ny = heightAt(nx, nz);
        if (ny > WATER_LEVEL + 0.5 && slopeAt(nx, nz) < 0.6) { ok = true; break; }
      }
      if (!ok) { ny = heightAt(nx, nz); }
      this._grassPos[i * 2] = nx;
      this._grassPos[i * 2 + 1] = nz;
      this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand.range(0, Math.PI * 2));
      const s = rand.range(0.7, 1.6);
      this._s.set(s, s * rand.range(0.7, 1.35), s);
      this._v.set(nx, ny - 0.06, nz);
      this._m.compose(this._v, this._q, this._s);
      im.setMatrixAt(i, this._m);
      dirty = true;
    }
    if (dirty) im.instanceMatrix.needsUpdate = true;
  }

  // ------------------------------------------------------------
  /** 互いに離れた候補点を生成する（Poisson風の棄却サンプリング） */
  _scatterPositions(count, minDist, weightFn, seed) {
    const rand = new Rand(seed);
    const grid = new Map();
    const cell = minDist;
    const out = [];
    let attempts = 0;
    const maxAttempts = count * 26;
    while (out.length < count && attempts < maxAttempts) {
      attempts++;
      const a = rand.range(0, Math.PI * 2);
      const r = Math.sqrt(rand.range(0, 1)) * PLAY_RADIUS;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const w = weightFn(x, z);
      if (w <= 0 || !rand.chance(Math.min(1, w))) continue;

      const cx = Math.floor(x / cell), cz = Math.floor(z / cell);
      let tooClose = false;
      for (let dz = -1; dz <= 1 && !tooClose; dz++) {
        for (let dx = -1; dx <= 1 && !tooClose; dx++) {
          const arr = grid.get((cx + dx) + ',' + (cz + dz));
          if (!arr) continue;
          for (const p of arr) {
            if ((p.x - x) ** 2 + (p.z - z) ** 2 < minDist * minDist) { tooClose = true; break; }
          }
        }
      }
      if (tooClose) continue;
      const k = cx + ',' + cz;
      let arr = grid.get(k);
      if (!arr) { arr = []; grid.set(k, arr); }
      const p = { x, z, y: heightAt(x, z) };
      arr.push(p);
      out.push(p);
    }
    return out;
  }

  /** 敵などのスポーン地点を探す */
  findSpawnPoint(rng, center, minDist, maxDist) {
    for (let i = 0; i < 40; i++) {
      const a = rng.range(0, Math.PI * 2);
      const r = rng.range(minDist, maxDist);
      const x = center.x + Math.cos(a) * r;
      const z = center.z + Math.sin(a) * r;
      if (Math.hypot(x, z) > PLAY_RADIUS - 6) continue;
      const h = heightAt(x, z);
      if (h < WATER_LEVEL + 0.6) continue;
      if (slopeAt(x, z) > 0.55) continue;
      return new THREE.Vector3(x, h, z);
    }
    return null;
  }

  // ------------------------------------------------------------
  update(dt, elapsed, camera, playerPos, env) {
    if (this.waterMat) {
      const u = this.waterMat.uniforms;
      u.uTime.value = elapsed;
      u.uCamPos.value.copy(camera.position);
      u.uSunDir.value.copy(env.sunDir);
      u.uSunColor.value.copy(env.sunColor).convertSRGBToLinear().multiplyScalar(clamp(env.dayFactor, 0.05, 1));
      u.uSkyTop.value.copy(env.skyTop).convertSRGBToLinear();
      u.uSkyHorizon.value.copy(env.skyHorizon).convertSRGBToLinear();
      u.uFogColor.value.copy(this.scene.fog.color);
      u.uFogNear.value = this.scene.fog.near;
      u.uFogFar.value = this.scene.fog.far;
      const nightTint = lerp(0.25, 1.0, env.dayFactor);
      u.uDeep.value.setRGB(0.03 * nightTint, 0.10 * nightTint, 0.15 * nightTint);
      u.uShallow.value.setRGB(0.10 * nightTint, 0.35 * nightTint, 0.38 * nightTint);
    }

    if (this.grassMat) {
      const u = this.grassMat.uniforms;
      u.uTime.value = elapsed;
      u.uPlayerPos.value.copy(playerPos);
      u.uSunDir.value.copy(env.sunDir);
      u.uSunColor.value.copy(env.sunColor).convertSRGBToLinear().multiplyScalar(env.dayFactor * 0.9);
      u.uAmbient.value.copy(env.hemi.color).convertSRGBToLinear().multiplyScalar(env.hemi.intensity * 0.5);
      u.uFogColor.value.copy(this.scene.fog.color);
      u.uFogNear.value = this.scene.fog.near;
      u.uFogFar.value = this.scene.fog.far;
      const fire = this.campfires[0];
      if (fire) {
        u.uFirePos.value.copy(fire.pos).add(new THREE.Vector3(0, 1.1, 0));
        u.uFireI.value = clamp(fire.light.intensity * 0.16, 0, 2.2);
      }
    }

    this._updateGrass(playerPos);

    // 焚き火
    for (const f of this.campfires) {
      const flick = 0.75 + Math.sin(elapsed * 11.3) * 0.09 + Math.sin(elapsed * 27.7) * 0.06 + Math.random() * 0.06;
      f.light.intensity = f.base * flick * lerp(0.7, 1.15, env.nightFactor);
    }

    if (this.fireParticles) {
      const { pts, geo, seed, count } = this.fireParticles;
      const arr = geo.attributes.position.array;
      for (let i = 0; i < count; i++) {
        const life = (elapsed * 0.75 + seed[i] * 3.0) % 1.0;
        const a = seed[i] * 40.0 + elapsed * 0.9;
        const rad = 0.32 * life;
        arr[i * 3] = Math.cos(a) * rad;
        arr[i * 3 + 1] = 0.3 + life * 2.3;
        arr[i * 3 + 2] = Math.sin(a) * rad;
      }
      geo.attributes.position.needsUpdate = true;
      pts.material.opacity = lerp(0.35, 1.0, env.nightFactor);
    }
  }

  dispose() {
    this.disposables.forEach((d) => d?.dispose?.());
    this.scene.remove(this.terrain, this.water, this.village, this.grassInstances);
    this.colliders.clear();
  }
}
