// ============================================================
//  戦闘システム — 近接判定・投射物・パーティクル・エフェクト
// ============================================================

import * as THREE from 'three';
import { clamp, lerp, Rand } from './utils.js';
import { sparkTexture } from './textures.js';
import { heightAt, WATER_LEVEL } from './terrain.js';

const MAX_PARTICLES = 2000;

const P_VERT = /* glsl */`
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * 340.0 / max(0.001, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const P_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uMap;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    if (t.a < 0.02) discard;
    gl_FragColor = vec4(vColor * t.rgb, t.a * vAlpha);
  }
`;

export class CombatSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = ctx.scene;
    this.rng = new Rand(555);
    this.projectiles = [];
    this.effects = [];
    this.time = 0;
    this._initParticles();
  }

  // ------------------------------------------------------------
  _initParticles() {
    const N = MAX_PARTICLES;
    const geo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(N * 3);
    this.pCol = new Float32Array(N * 3);
    this.pSize = new Float32Array(N);
    this.pAlpha = new Float32Array(N);
    this.pVel = new Float32Array(N * 3);
    this.pLife = new Float32Array(N);
    this.pMax = new Float32Array(N);
    this.pDrag = new Float32Array(N);
    this.pGrav = new Float32Array(N);
    this.pFade = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      this.pPos[i * 3 + 1] = -9999;
      this.pSize[i] = 0;
      this.pAlpha[i] = 0;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.pCol, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.pSize, 1));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.pAlpha, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: sparkTexture() } },
      vertexShader: P_VERT,
      fragmentShader: P_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 8;
    this.scene.add(this.points);
    this.pGeo = geo;
    this.pMat = mat;
    this.pCursor = 0;
  }

  _alloc() {
    const i = this.pCursor;
    this.pCursor = (this.pCursor + 1) % MAX_PARTICLES;
    return i;
  }

  // ------------------------------------------------------------
  burst(position, color, count = 12, opts = {}) {
    const {
      radius = 0.6, up = 2.0, life = 0.7, size = 0.4, spread = 1.0,
      gravity = 9, drag = 2.2, dir = null, fade = 1,
    } = opts;
    const c = new THREE.Color(color).convertSRGBToLinear();
    for (let k = 0; k < count; k++) {
      const i = this._alloc();
      const i3 = i * 3;
      const a = this.rng.range(0, Math.PI * 2);
      const r = Math.sqrt(this.rng.next()) * radius;
      this.pPos[i3] = position.x + Math.cos(a) * r;
      this.pPos[i3 + 1] = position.y + this.rng.range(-radius * 0.4, radius * 0.7);
      this.pPos[i3 + 2] = position.z + Math.sin(a) * r;
      let vx, vy, vz;
      if (dir) {
        vx = dir.x * spread + this.rng.range(-0.5, 0.5);
        vy = dir.y * spread + this.rng.range(0, 1);
        vz = dir.z * spread + this.rng.range(-0.5, 0.5);
      } else {
        const sp = this.rng.range(0.3, 1.0) * spread;
        vx = Math.cos(a) * sp;
        vy = this.rng.range(0.2, 1) * up * 0.4;
        vz = Math.sin(a) * sp;
      }
      this.pVel[i3] = vx;
      this.pVel[i3 + 1] = vy;
      this.pVel[i3 + 2] = vz;
      this.pMax[i] = life * this.rng.range(0.7, 1.3);
      this.pLife[i] = this.pMax[i];
      this.pSize[i] = size * this.rng.range(0.7, 1.4);
      this.pDrag[i] = drag;
      this.pGrav[i] = gravity;
      this.pFade[i] = fade;
      this.pCol[i3] = c.r;
      this.pCol[i3 + 1] = c.g;
      this.pCol[i3 + 2] = c.b;
      this.pAlpha[i] = 1;
    }
  }

  // ------------------------------------------------------------
  meleeArc(origin, yaw, range, halfArc, damage, opts = {}) {
    const em = this.ctx.enemyManager;
    let hits = 0;
    if (em) {
      for (const e of em.enemies) {
        if (e.dead) continue;
        const dx = e.position.x - origin.x;
        const dz = e.position.z - origin.z;
        const d = Math.hypot(dx, dz);
        if (d > range + e.radius) continue;
        const dy = Math.abs(e.position.y - origin.y);
        if (dy > 3.4) continue;
        if (!opts.all) {
          const ang = Math.atan2(dx, dz);
          let diff = Math.abs(((ang - yaw + Math.PI) % (Math.PI * 2)) - Math.PI);
          if (diff > Math.PI) diff = Math.PI * 2 - diff;
          if (diff > halfArc) continue;
        }
        e.takeDamage(damage, {
          crit: opts.crit, critMult: opts.critMult,
          knockback: opts.knockback, origin,
        });
        hits++;
      }
    }
    this.slashArc(origin, yaw, range, halfArc, opts.all ? 0xffc86a : 0xdfeaff);
    return hits;
  }

  slashArc(origin, yaw, range, halfArc, color = 0xdfeaff) {
    const geo = new THREE.RingGeometry(Math.max(0.35, range * 0.3), range, 30, 1, -halfArc, halfArc * 2);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    const g = new THREE.Group();
    g.add(mesh);
    g.position.set(origin.x, origin.y + 1.05, origin.z);
    g.rotation.y = yaw - Math.PI / 2;
    g.renderOrder = 7;
    this.scene.add(g);
    this.effects.push({ obj: g, life: 0, max: 0.26, kind: 'arc', mesh });
  }

  ring(position, color, radius) {
    const geo = new THREE.RingGeometry(radius * 0.55, radius, 44);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.8, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(position);
    mesh.renderOrder = 7;
    this.scene.add(mesh);
    this.effects.push({ obj: mesh, life: 0, max: 0.5, kind: 'ring' });
    this.burst(position, color, 26, { radius: radius * 0.7, up: 1.4, life: 0.6, size: 0.4, gravity: 4 });
  }

  shockwave(position, color, radius) {
    const geo = new THREE.SphereGeometry(radius * 0.5, 16, 12);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);
    this.scene.add(mesh);
    this.effects.push({ obj: mesh, life: 0, max: 0.45, kind: 'sphere', maxRadius: radius });
  }

  // ------------------------------------------------------------
  spawnProjectile(o) {
    const {
      position, direction, speed = 24, damage = 20, radius = 0.5, life = 2.5,
      color = 0xff8a2a, source = 'player', explode = 0, owner = null,
    } = o;

    const geo = new THREE.SphereGeometry(radius, 12, 10);
    const mat = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(position);
    mesh.renderOrder = 6;
    this.scene.add(mesh);

    let light = null;
    const activeLights = this.projectiles.filter((p) => p.light).length;
    if (activeLights < 3) {
      light = new THREE.PointLight(color, 12, 16, 2);
      light.position.copy(position);
      this.scene.add(light);
    }

    // グロー
    const glowMat = new THREE.SpriteMaterial({
      map: sparkTexture(), color, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, opacity: 0.9,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(radius * 6);
    mesh.add(glow);

    this.projectiles.push({
      mesh, light, glow,
      vel: direction.clone().normalize().multiplyScalar(speed),
      damage, radius, life, maxLife: life, source, explode, owner, color,
      trailT: 0,
    });
    return this.projectiles[this.projectiles.length - 1];
  }

  // ------------------------------------------------------------
  update(dt) {
    this.time += dt;

    // --- パーティクル ---
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.pLife[i] <= 0) continue;
      const i3 = i * 3;
      this.pLife[i] -= dt;
      if (this.pLife[i] <= 0) {
        this.pAlpha[i] = 0;
        this.pPos[i3 + 1] = -9999;
        continue;
      }
      const drag = Math.exp(-this.pDrag[i] * dt);
      this.pVel[i3] *= drag;
      this.pVel[i3 + 1] = this.pVel[i3 + 1] * drag - this.pGrav[i] * dt;
      this.pVel[i3 + 2] *= drag;
      this.pPos[i3] += this.pVel[i3] * dt;
      this.pPos[i3 + 1] += this.pVel[i3 + 1] * dt;
      this.pPos[i3 + 2] += this.pVel[i3 + 2] * dt;
      const t = this.pLife[i] / this.pMax[i];
      this.pAlpha[i] = Math.pow(clamp(t, 0, 1), 0.7) * this.pFade[i];
      this.pSize[i] *= (1 - dt * 0.35);
    }
    this.pGeo.attributes.position.needsUpdate = true;
    this.pGeo.attributes.aColor.needsUpdate = true;
    this.pGeo.attributes.aSize.needsUpdate = true;
    this.pGeo.attributes.aAlpha.needsUpdate = true;

    // --- 投射物 ---
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      if (p.light) p.light.position.copy(p.mesh.position);
      p.vel.y -= 5.5 * dt;

      // 軌跡
      p.trailT -= dt;
      if (p.trailT <= 0) {
        p.trailT = 0.02;
        this.burst(p.mesh.position, p.color, 2, {
          radius: p.radius * 0.6, up: 0.4, life: 0.4, size: p.radius * 1.6, gravity: -1, drag: 4, spread: 0.2,
        });
      }

      let hit = false;
      let hitPos = null;

      // 地形
      const gh = heightAt(p.mesh.position.x, p.mesh.position.z);
      if (p.mesh.position.y < gh + 0.1) { hit = true; hitPos = p.mesh.position.clone(); }

      // 対象
      if (!hit) {
        if (p.source === 'player' && this.ctx.enemyManager) {
          for (const e of this.ctx.enemyManager.enemies) {
            if (e.dead) continue;
            const dx = e.position.x - p.mesh.position.x;
            const dy = (e.position.y + e.height * 0.5) - p.mesh.position.y;
            const dz = e.position.z - p.mesh.position.z;
            if (dx * dx + dy * dy + dz * dz < (e.radius + p.radius + 0.3) ** 2) {
              hit = true; hitPos = p.mesh.position.clone();
              if (p.explode > 0) this.explode(p, hitPos);
              else e.takeDamage(p.damage, { crit: 0.15, critMult: 1.8, knockback: 4, origin: p.mesh.position });
              break;
            }
          }
        } else if (p.source === 'enemy') {
          const pl = this.ctx.player;
          const dx = pl.position.x - p.mesh.position.x;
          const dy = (pl.position.y + 0.9) - p.mesh.position.y;
          const dz = pl.position.z - p.mesh.position.z;
          if (!pl.dead && dx * dx + dy * dy + dz * dz < (pl.radius + p.radius + 0.3) ** 2) {
            hit = true; hitPos = p.mesh.position.clone();
            if (p.explode > 0) this.explode(p, hitPos);
            else pl.takeDamage(p.damage, p.mesh.position);
          }
        }
      }

      if (hit) {
        if (p.explode > 0 && !hitPos.__exploded) this.explode(p, hitPos);
        this.removeProjectile(i);
        continue;
      }
      if (p.life <= 0 || p.mesh.position.y < WATER_LEVEL - 3) {
        this.removeProjectile(i);
      }
    }

    // --- 一時エフェクト ---
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const fx = this.effects[i];
      fx.life += dt;
      const t = fx.life / fx.max;
      if (fx.kind === 'arc') {
        fx.mesh.material.opacity = 0.5 * (1 - t);
        fx.mesh.rotation.z += dt * 5;
      } else if (fx.kind === 'ring') {
        fx.obj.material.opacity = 0.8 * (1 - t);
        fx.obj.scale.setScalar(1 + t * 0.6);
      } else if (fx.kind === 'sphere') {
        fx.obj.material.opacity = 0.55 * (1 - t);
        fx.obj.scale.setScalar(1 + t * 2.2);
      }
      if (t >= 1) {
        this.scene.remove(fx.obj);
        fx.obj.traverse?.((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
        if (fx.obj.geometry) fx.obj.geometry.dispose();
        if (fx.obj.material) fx.obj.material.dispose();
        this.effects.splice(i, 1);
      }
    }
  }

  explode(p, pos) {
    const r = p.explode;
    this.burst(pos, p.color, 34, { radius: r * 0.5, up: 3, life: 0.8, size: 0.55, gravity: 6 });
    this.shockwave(pos, p.color, r);
    this.ctx.cameraCtrl?.shake(0.22);

    if (p.source === 'player' && this.ctx.enemyManager) {
      for (const e of this.ctx.enemyManager.enemies) {
        if (e.dead) continue;
        const dx = e.position.x - pos.x;
        const dy = e.position.y + e.height * 0.4 - pos.y;
        const dz = e.position.z - pos.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < r + e.radius) {
          const falloff = clamp(1 - d / (r + e.radius), 0.35, 1);
          e.takeDamage(p.damage * falloff, { knockback: 6 * falloff, origin: pos });
        }
      }
    } else if (p.source === 'enemy') {
      const pl = this.ctx.player;
      const dx = pl.position.x - pos.x;
      const dz = pl.position.z - pos.z;
      const d = Math.hypot(dx, dz);
      if (d < r + pl.radius) pl.takeDamage(p.damage * 0.7, pos);
    }
  }

  removeProjectile(i) {
    const p = this.projectiles[i];
    this.scene.remove(p.mesh);
    if (p.light) this.scene.remove(p.light);
    p.mesh.geometry.dispose();
    p.mesh.material.dispose();
    p.glow.material.dispose();
    this.projectiles.splice(i, 1);
  }

  clear() {
    for (let i = this.projectiles.length - 1; i >= 0; i--) this.removeProjectile(i);
    for (const fx of this.effects) {
      this.scene.remove(fx.obj);
      fx.obj.traverse?.((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
      if (fx.obj.geometry) fx.obj.geometry.dispose();
      if (fx.obj.material) fx.obj.material.dispose();
    }
    this.effects.length = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) { this.pLife[i] = 0; this.pAlpha[i] = 0; this.pPos[i * 3 + 1] = -9999; }
  }
}
