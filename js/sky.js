// ============================================================
//  環境 — 空・太陽・月・星・雲・霧・ライティング・昼夜サイクル
// ============================================================

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, lerp, smoothstep, damp } from './utils.js';
import { cloudTexture } from './textures.js';

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uTop, uHorizon, uGround;
  uniform vec3 uSunDir, uSunColor;
  uniform vec3 uMoonDir;
  uniform float uSunIntensity, uMoonI, uNight, uTime;
  varying vec3 vDir;

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = d.y;

    vec3 col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.42));
    col = mix(col, uGround, smoothstep(0.02, -0.32, h));

    float sd = dot(d, uSunDir);
    float sdp = max(sd, 0.0);
    col += uSunColor * pow(sdp, 4.0) * 0.14 * uSunIntensity;
    col += uSunColor * pow(sdp, 80.0) * 0.55 * uSunIntensity;
    col += uSunColor * smoothstep(0.99930, 0.99985, sd) * 7.0 * uSunIntensity;

    float md = dot(d, uMoonDir);
    col += vec3(0.70, 0.79, 1.0) * pow(max(md, 0.0), 140.0) * 0.55 * uMoonI;
    col += vec3(0.86, 0.91, 1.0) * smoothstep(0.99955, 0.99992, md) * 3.2 * uMoonI;

    if (uNight > 0.02) {
      vec3 q = d * 190.0;
      vec3 id = floor(q);
      float h1 = hash21(id.xy + id.z * 13.7);
      float tw = 0.55 + 0.45 * sin(uTime * 1.7 + h1 * 43.0);
      float s = smoothstep(0.9976, 1.0, h1) * tw;
      s *= smoothstep(-0.03, 0.22, h);
      col += vec3(0.85, 0.90, 1.0) * s * uNight * 2.4;
    }

    col += (hash21(gl_FragCoord.xy) - 0.5) * (1.0 / 255.0);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Environment {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.time = CONFIG.startTime;
    this.elapsed = 0;

    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.moonDir = new THREE.Vector3(0, -1, 0);
    this.sunColor = new THREE.Color(1, 1, 1);
    this.dayFactor = 1;
    this.nightFactor = 0;
    this.duskAmount = 0;

    // --- 色パレット ---
    this.c = {
      dayTop: new THREE.Color(0x2f6ec4),
      dayHor: new THREE.Color(0xa8c8e8),
      dayGround: new THREE.Color(0x54603f),
      nightTop: new THREE.Color(0x03060f),
      nightHor: new THREE.Color(0x080d1e),
      nightGround: new THREE.Color(0x04060b),
      duskTop: new THREE.Color(0x3a3160),
      duskHor: new THREE.Color(0xff8a3c),
      sunWarm: new THREE.Color(0xffb066),
      sunNoon: new THREE.Color(0xfff3dd),
      moonLight: new THREE.Color(0x8fb0ff),
    };

    this.skyTop = this.c.dayTop.clone();
    this.skyHorizon = this.c.dayHor.clone();

    this._buildSky();
    this._buildClouds();
    this._buildLights();

    scene.fog = new THREE.Fog(this.skyHorizon.getHex(), CONFIG.render.fogNear, CONFIG.render.fogFar);
  }

  _buildSky() {
    const geo = new THREE.SphereGeometry(900, 40, 24);
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color(0x2f6ec4) },
        uHorizon: { value: new THREE.Color(0xa8c8e8) },
        uGround: { value: new THREE.Color(0x54603f) },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
        uSunIntensity: { value: 1 },
        uMoonI: { value: 0 },
        uNight: { value: 0 },
        uTime: { value: 0 },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(geo, this.skyMat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1000;
    this.scene.add(this.sky);
  }

  _buildClouds() {
    this.clouds = [];
    const layers = [
      { y: 300, size: 4200, opacity: 0.55, speed: 1.6, repeat: 3, tint: 1.0 },
      { y: 380, size: 5200, opacity: 0.34, speed: 0.9, repeat: 2, tint: 0.85 },
    ];
    for (const l of layers) {
      const tex = cloudTexture().clone();
      tex.needsUpdate = true;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(l.repeat, l.repeat);
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: l.opacity,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: false,
        color: 0xffffff,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(l.size, l.size), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.y = l.y;
      mesh.renderOrder = -500;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.clouds.push({ mesh, tex, ...l });
    }
  }

  _buildLights() {
    this.sun = new THREE.DirectionalLight(0xfff3dd, 3.2);
    this.sun.castShadow = true;
    const R = CONFIG.render.shadowRadius;
    const sc = this.sun.shadow.camera;
    sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R;
    sc.near = 1; sc.far = 520;
    this.sun.shadow.mapSize.set(CONFIG.render.shadowSize, CONFIG.render.shadowSize);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.moon = new THREE.DirectionalLight(0x8fb0ff, 0.0);
    this.scene.add(this.moon);
    this.scene.add(this.moon.target);

    this.hemi = new THREE.HemisphereLight(0x9fc4e8, 0x54603f, 0.7);
    this.scene.add(this.hemi);

    this.ambient = new THREE.AmbientLight(0xffffff, 0.10);
    this.scene.add(this.ambient);
  }

  get clockText() {
    const total = Math.floor(this.time * 24 * 60);
    const h = Math.floor(total / 60) % 24;
    const m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  get phase() {
    if (this.dayFactor > 0.72) return { label: '昼', icon: '☀' };
    if (this.duskAmount > 0.5) return this.time < 0.5 ? { label: '明け', icon: '🌅' } : { label: '黄昏', icon: '🌇' };
    if (this.nightFactor > 0.6) return { label: '夜', icon: '🌙' };
    return { label: '薄明', icon: '🌆' };
  }

  update(dt, camera, shadowTarget) {
    this.elapsed += dt;
    this.time = (this.time + dt / CONFIG.dayLength) % 1;

    const a = (this.time - 0.25) * Math.PI * 2;
    this.sunDir.set(Math.cos(a), Math.sin(a), 0.34).normalize();
    this.moonDir.copy(this.sunDir).multiplyScalar(-1);

    const elev = this.sunDir.y;
    this.dayFactor = smoothstep(-0.10, 0.20, elev);
    this.nightFactor = 1 - smoothstep(-0.18, 0.04, elev);
    this.duskAmount = Math.exp(-Math.pow(elev / 0.19, 2));

    // --- 空の色 ---
    const c = this.c;
    const top = c.nightTop.clone().lerp(c.dayTop, this.dayFactor).lerp(c.duskTop, this.duskAmount * 0.55);
    const hor = c.nightHor.clone().lerp(c.dayHor, this.dayFactor).lerp(c.duskHor, this.duskAmount);
    const grd = c.nightGround.clone().lerp(c.dayGround, this.dayFactor);

    this.skyTop.copy(top);
    this.skyHorizon.copy(hor);

    const u = this.skyMat.uniforms;
    u.uTop.value.copy(top).convertSRGBToLinear();
    u.uHorizon.value.copy(hor).convertSRGBToLinear();
    u.uGround.value.copy(grd).convertSRGBToLinear();
    u.uSunDir.value.copy(this.sunDir);
    u.uMoonDir.value.copy(this.moonDir);
    u.uNight.value = this.nightFactor;
    u.uTime.value = this.elapsed;

    // --- 太陽光 ---
    const warm = smoothstep(0.0, 0.42, elev);
    this.sunColor.copy(c.sunWarm).lerp(c.sunNoon, warm);
    this.sun.color.copy(this.sunColor);
    this.sun.intensity = this.dayFactor * 3.4;
    u.uSunColor.value.copy(this.sunColor).convertSRGBToLinear();
    u.uSunIntensity.value = clamp(this.dayFactor * 1.2 + this.duskAmount * 0.5, 0, 1.6);

    this.moon.intensity = this.nightFactor * 0.55;
    u.uMoonI.value = this.nightFactor;

    // --- 環境光 ---
    this.hemi.color.copy(top).lerp(c.dayHor, 0.4);
    this.hemi.groundColor.copy(grd);
    this.hemi.intensity = lerp(0.22, 1.05, this.dayFactor) + this.duskAmount * 0.15;
    this.ambient.intensity = lerp(0.045, 0.13, this.dayFactor);

    // --- 露出 ---
    this.renderer.toneMappingExposure = lerp(0.82, 1.06, this.dayFactor);

    // --- 霧 ---
    const fogCol = hor.clone().lerp(grd, 0.25).multiplyScalar(lerp(0.75, 1.0, this.dayFactor));
    this.scene.fog.color.copy(fogCol);
    this.scene.fog.near = CONFIG.render.fogNear;
    this.scene.fog.far = CONFIG.render.fogFar;

    // --- シャドウカメラを追従 ---
    const tgt = shadowTarget || new THREE.Vector3();
    this.sun.target.position.copy(tgt);
    this.sun.position.copy(tgt).addScaledVector(this.sunDir, 220);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();

    this.moon.target.position.copy(tgt);
    this.moon.position.copy(tgt).addScaledVector(this.moonDir, 220);

    // --- 雲 ---
    for (const cl of this.clouds) {
      cl.tex.offset.x += (dt * cl.speed) / 900;
      cl.tex.offset.y += (dt * cl.speed * 0.25) / 900;
      cl.mesh.position.x = tgt.x;
      cl.mesh.position.z = tgt.z;
      cl.mesh.material.color.copy(top).lerp(c.dayHor, 0.55).multiplyScalar(lerp(0.28, 1.0, this.dayFactor));
      cl.mesh.material.opacity = cl.opacity * lerp(0.35, 1.0, this.dayFactor);
    }

    // --- 空ドームを追従 ---
    if (camera) this.sky.position.copy(camera.position);
  }
}
