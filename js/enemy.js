// ============================================================
//  敵 — 種類・AI・ヘルスバー・ドロップ
// ============================================================

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, lerp, damp, angleDamp, Rand } from './utils.js';
import { buildSlime, buildWolf, buildSkeleton, buildGolem, buildDragon } from './character.js';
import { heightAt, slopeAt, WATER_LEVEL } from './terrain.js';

const _v = new THREE.Vector3();

// ------------------------------------------------------------
//  ヘルスバー（スプライト）
// ------------------------------------------------------------
const barCanvas = document.createElement('canvas');
barCanvas.width = 128; barCanvas.height = 20;
const barCtx = barCanvas.getContext('2d');

function makeHealthBar() {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 20;
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.4, 0.22, 1);
  sprite.renderOrder = 10;

  const draw = (ratio, color = '#d8434a', elite = false) => {
    ctx.clearRect(0, 0, 128, 20);
    // 枠
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(0, 4, 128, 12);
    ctx.strokeStyle = elite ? 'rgba(255,215,110,0.9)' : 'rgba(220,210,190,0.65)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 5, 126, 10);
    const w = Math.max(0, Math.min(1, ratio)) * 122;
    const g = ctx.createLinearGradient(0, 6, 0, 14);
    g.addColorStop(0, color);
    g.addColorStop(1, '#5c1016');
    ctx.fillStyle = g;
    ctx.fillRect(3, 7, w, 6);
    tex.needsUpdate = true;
  };
  draw(1);
  return { sprite, draw };
}

// ------------------------------------------------------------
//  敵の定義
// ------------------------------------------------------------
export const ENEMY_TYPES = {
  slime: {
    name: 'スライム', tier: 1, hp: 46, damage: 10, speed: 2.6, xp: 16, gold: [3, 10],
    radius: 0.62, height: 1.1, attackRange: 1.7, attackCd: 1.5, aggro: 15, windup: 0.45,
    build: () => buildSlime(0x5fd07a), barY: 1.5, barScale: 1.0,
    drops: [['slime_gel', 0.8, 1, 2], ['coin', 0.6, 3, 9]],
    nightBonus: 0.4,
  },
  wolf: {
    name: '森狼', tier: 2, hp: 78, damage: 15, speed: 6.2, xp: 30, gold: [6, 16],
    radius: 0.7, height: 1.3, attackRange: 2.1, attackCd: 1.15, aggro: 26, windup: 0.32,
    build: () => buildWolf(0x50463c), barY: 1.7, barScale: 1.0,
    drops: [['wolf_fang', 0.65, 1, 2], ['coin', 0.7, 6, 18]],
    nightBonus: 0.6,
  },
  skeleton: {
    name: '骸骨戦士', tier: 3, hp: 120, damage: 20, speed: 3.6, xp: 48, gold: [12, 28],
    radius: 0.6, height: 1.85, attackRange: 2.4, attackCd: 1.35, aggro: 24, windup: 0.42,
    build: () => buildSkeleton(1.02), barY: 2.15, barScale: 1.0,
    drops: [['bone_shard', 0.7, 1, 3], ['coin', 0.75, 12, 30]],
    nightBonus: 0.9,
  },
  golem: {
    name: '岩のゴーレム', tier: 4, hp: 300, damage: 30, speed: 2.4, xp: 110, gold: [30, 70],
    radius: 1.15, height: 3.0, attackRange: 3.1, attackCd: 2.0, aggro: 20, windup: 0.62,
    build: () => buildGolem(0x6b6a63, 1.0), barY: 3.5, barScale: 1.5,
    drops: [['golem_core', 0.55, 1, 1], ['iron_ore', 0.8, 1, 3], ['coin', 0.9, 30, 75]],
    nightBonus: 0.5,
  },
  dragon: {
    name: '古代竜ヴァルガ', tier: 6, hp: 3200, damage: 52, speed: 4.4, xp: 1800, gold: [500, 900],
    radius: 2.6, height: 5.2, attackRange: 6.0, attackCd: 2.6, aggro: 60, windup: 0.85,
    build: () => buildDragon(0x7a2b34, 1.0), barY: 6.4, barScale: 3.4,
    boss: true, ranged: true,
    drops: [['dragon_scale', 1.0, 2, 4], ['coin', 1.0, 400, 900], ['avalon_blade', 0.35, 1, 1]],
    nightBonus: 0,
  },
};

// ------------------------------------------------------------
//  敵本体
// ------------------------------------------------------------
export class Enemy {
  constructor(typeKey, position, ctx, opts = {}) {
    this.typeKey = typeKey;
    this.type = ENEMY_TYPES[typeKey];
    this.ctx = ctx;
    this.name = opts.name || this.type.name;
    this.elite = !!opts.elite;
    this.isBoss = !!this.type.boss;

    const pLevel = ctx.player.level;
    const scaleHp = 1 + (pLevel - 1) * 0.24;
    const scaleDmg = 1 + (pLevel - 1) * 0.15;
    const eliteMult = this.elite ? 2.3 : 1;

    this.maxHp = Math.round(this.type.hp * scaleHp * eliteMult * (opts.hpMult || 1));
    this.hp = this.maxHp;
    this.damage = this.type.damage * scaleDmg * (this.elite ? 1.35 : 1);
    this.speed = this.type.speed * (this.elite ? 1.08 : 1);
    this.xpValue = Math.round(this.type.xp * (1 + (pLevel - 1) * 0.1) * eliteMult);
    this.radius = this.type.radius * (this.elite ? 1.12 : 1);
    this.height = this.type.height;

    this.position = new THREE.Vector3().copy(position);
    this.velocity = new THREE.Vector3();
    this.facing = Math.random() * Math.PI * 2;
    this.dead = false;
    this.deadT = 0;
    this.removed = false;
    this.aggro = false;
    this.attackCd = 0;
    this.attackAnim = -1;
    this.hitDone = false;
    this.flash = 0;
    this.wanderT = 0;
    this.wanderDir = new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    this.hitCooldown = 0;
    this.rangedCd = 3.5;
    this.stun = 0;

    // モデル
    const model = this.type.build();
    this.model = model;
    this.group = model.group;
    this.group.position.copy(this.position);
    this.group.rotation.y = this.facing;
    if (this.elite) {
      this.group.scale.multiplyScalar(1.15);
    }
    this.ctx.scene.add(this.group);

    // ヘルスバー
    this.bar = makeHealthBar();
    this.bar.sprite.scale.multiplyScalar(this.type.barScale);
    this.group.add(this.bar.sprite);
    this.bar.sprite.position.y = this.type.barY;
    this.bar.draw(1, this.elite ? '#e8b23c' : '#d8434a', this.elite);

    // ターゲットリング
    const ringGeo = new THREE.RingGeometry(this.radius * 0.85, this.radius * 1.05, 24);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff5a4a, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false,
    });
    this.ring = new THREE.Mesh(ringGeo, ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.06;
    this.ctx.scene.add(this.ring);

    this._matCache = [];
    this.group.traverse((o) => {
      if (o.isMesh && o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => { if (m.emissive) this._matCache.push(m); });
      }
    });
  }

  get eyePosition() { return _v.set(this.position.x, this.position.y + this.height * 0.7, this.position.z); }

  // ------------------------------------------------------------
  takeDamage(amount, opts = {}) {
    if (this.dead) return 0;
    const crit = opts.crit ? Math.random() < opts.crit : false;
    let dmg = amount * (crit ? (opts.critMult || 1.8) : 1);
    dmg *= 1 + (Math.random() - 0.5) * 0.14;
    dmg = Math.max(1, dmg);
    this.hp -= dmg;
    this.flash = 0.18;
    this.aggro = true;
    this.stun = Math.max(this.stun, 0.12);

    if (opts.knockback) {
      const dx = this.position.x - opts.origin.x;
      const dz = this.position.z - opts.origin.z;
      const l = Math.hypot(dx, dz) || 1;
      const k = opts.knockback / (1 + this.radius * 0.8);
      this.velocity.x += (dx / l) * k;
      this.velocity.z += (dz / l) * k;
    }

    this.bar.draw(this.hp / this.maxHp, this.elite ? '#e8b23c' : '#d8434a', this.elite);
    this.ctx.hud?.floatText(
      this.position.clone().add(new THREE.Vector3(0, this.height * 0.85 + 0.4, 0)),
      String(Math.round(dmg)), crit ? 'crit' : 'enemy'
    );
    this.ctx.audio?.play(crit ? 'crit' : 'hit', { volume: crit ? 1 : 0.75 });
    this.ctx.combat?.burst(
      this.position.clone().add(new THREE.Vector3(0, this.height * 0.55, 0)),
      crit ? 0xffd15c : 0xff9a5a, crit ? 18 : 10, { radius: 0.5, up: 2.0, life: 0.5, size: 0.3 }
    );
    if (crit) this.ctx.cameraCtrl?.shake(0.18);

    if (this.hp <= 0) this.die();
    return dmg;
  }

  die() {
    this.dead = true;
    this.hp = 0;
    this.velocity.set(0, 0, 0);
    this.bar.sprite.visible = false;
    this.ring.material.opacity = 0;
    this.ctx.audio?.play(this.isBoss ? 'boss' : 'die', { volume: this.isBoss ? 1 : 0.7 });
    this.ctx.combat?.burst(this.position.clone().add(new THREE.Vector3(0, this.height * 0.6, 0)), 0xff6a4a, 30, {
      radius: 1.2, up: 3.5, life: 1.0, size: 0.5,
    });
    this.ctx.onEnemyDeath?.(this);
  }

  // ------------------------------------------------------------
  update(dt, player, world) {
    if (this.dead) {
      this.deadT += dt;
      this.model.update(dt, { dead: true, speed: 0 });
      this.group.position.copy(this.position);
      if (this.deadT > 2.6) this.removed = true;
      return;
    }

    this.attackCd = Math.max(0, this.attackCd - dt);
    this.rangedCd = Math.max(0, this.rangedCd - dt);
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    this.stun = Math.max(0, this.stun - dt);
    this.flash = Math.max(0, this.flash - dt);

    const dx = player.position.x - this.position.x;
    const dz = player.position.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    const playerDead = player.dead;

    if (!playerDead && dist < this.type.aggro) this.aggro = true;
    if (playerDead) this.aggro = false;
    if (this.aggro && dist > this.type.aggro * 2.6) this.aggro = false;

    let moveX = 0, moveZ = 0;
    let targetSpeed = 0;

    const attacking = this.attackAnim >= 0;

    if (this.aggro && !playerDead && this.stun <= 0) {
      this.facing = angleDamp(this.facing, Math.atan2(dx, dz), 7, dt);
      if (attacking) {
        // 攻撃中は前進を弱める
        targetSpeed = this.speed * 0.12;
        moveX = Math.sin(this.facing);
        moveZ = Math.cos(this.facing);
      } else if (dist > this.type.attackRange * 0.85) {
        targetSpeed = this.speed;
        moveX = dx / (dist || 1);
        moveZ = dz / (dist || 1);
      } else if (this.attackCd <= 0) {
        this.startAttack(player);
      } else {
        // 回り込む
        targetSpeed = this.speed * 0.35;
        moveX = -dz / (dist || 1);
        moveZ = dx / (dist || 1);
      }

      // 遠距離攻撃（ボス）
      if (this.type.ranged && !attacking && this.rangedCd <= 0 && dist > 8 && dist < 42) {
        this.rangedCd = 7.5;
        this.attackAnim = 0;
        this.hitDone = false;
        this.rangedShot = true;
        this.ctx.audio?.play('fire', { volume: 0.7 });
      }
    } else if (!this.aggro) {
      // 徘徊
      this.wanderT -= dt;
      if (this.wanderT <= 0) {
        this.wanderT = 2 + Math.random() * 4;
        this.wanderDir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
        this.moving = Math.random() < 0.65;
      }
      if (this.moving) {
        targetSpeed = this.speed * 0.32;
        moveX = this.wanderDir.x;
        moveZ = this.wanderDir.z;
        this.facing = angleDamp(this.facing, Math.atan2(moveX, moveZ), 3, dt);
      }
    }

    // 攻撃アニメ進行
    if (attacking) {
      const dur = this.isBoss ? 1.5 : 0.75;
      this.attackAnim += dt / dur;
      const hitAt = this.isBoss ? 0.55 : 0.5;
      if (!this.hitDone && this.attackAnim >= hitAt) {
        this.hitDone = true;
        this.doAttackHit(player, dist);
      }
      if (this.attackAnim >= 1) { this.attackAnim = -1; this.rangedShot = false; }
    }

    // 移動
    const accel = this.aggro ? 9 : 4;
    this.velocity.x = damp(this.velocity.x, moveX * targetSpeed, accel, dt);
    this.velocity.z = damp(this.velocity.z, moveZ * targetSpeed, accel, dt);
    this.velocity.y -= 26 * dt;

    const nx = this.position.x + this.velocity.x * dt;
    const nz = this.position.z + this.velocity.z * dt;
    const curG = heightAt(this.position.x, this.position.z);
    const newG = heightAt(nx, nz);
    if (newG - Math.max(curG, this.position.y) < 1.4) {
      this.position.x = nx;
      this.position.z = nz;
    } else {
      this.velocity.x *= 0.2; this.velocity.z *= 0.2;
      this.wanderDir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    }

    // 境界
    const dd = Math.hypot(this.position.x, this.position.z);
    if (dd > 216) {
      this.position.x *= 216 / dd;
      this.position.z *= 216 / dd;
    }
    world.resolveCollision(this.position, this.radius * 0.8);

    this.position.y += this.velocity.y * dt;
    const ground = heightAt(this.position.x, this.position.z);
    if (this.position.y <= ground) {
      this.position.y = ground;
      this.velocity.y = 0;
      this.onGround = true;
    } else this.onGround = false;

    // 地面に沈む（水の中）
    if (this.position.y < WATER_LEVEL - 1.5) {
      this.hp -= dt * 12;
      if (this.hp <= 0) this.die();
    }

    this.group.position.copy(this.position);
    this.group.rotation.y = this.facing;

    // モデル
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.model.update(dt, {
      speed,
      moving: speed > 0.3,
      aggro: this.aggro,
      attacking: attacking,
      attackPhase: this.attackAnim,
      dead: false,
    });

    // フラッシュ
    const f = this.flash / 0.18;
    for (const m of this._matCache) {
      m.emissive.setRGB(f * 0.85, f * 0.12, f * 0.12);
    }

    // リング
    const targetOp = this.aggro ? 0.55 : 0;
    this.ring.material.opacity = damp(this.ring.material.opacity, targetOp, 6, dt);
    this.ring.position.set(this.position.x, heightAt(this.position.x, this.position.z) + 0.07, this.position.z);
    this.ring.material.color.setHex(this.aggro ? 0xff5a4a : 0x88ccff);

    // ヘルスバーの表示制御
    const showBar = this.hp < this.maxHp || this.aggro;
    this.bar.sprite.visible = showBar;
  }

  startAttack(player) {
    this.attackAnim = 0;
    this.hitDone = false;
    this.attackCd = this.type.attackCd;
    if (!this.isBoss) this.ctx.audio?.play('swing', { volume: 0.5 });
  }

  doAttackHit(player, dist) {
    const dx = player.position.x - this.position.x;
    const dz = player.position.z - this.position.z;
    const d = Math.hypot(dx, dz);

    if (this.rangedShot) {
      // ブレス
      const origin = this.position.clone().add(new THREE.Vector3(0, this.height * 0.75, 0));
      const dir = new THREE.Vector3(dx, 0, dz).normalize();
      this.ctx.combat.spawnProjectile({
        position: origin, direction: dir, speed: 22, damage: this.damage * 0.8,
        radius: 1.1, life: 3.2, color: 0xff6a10, source: 'enemy', explode: 3.2, owner: this,
      });
      return;
    }

    if (d < this.type.attackRange + player.radius + 0.6) {
      player.takeDamage(this.damage, this.position);
    }
  }

  dispose() {
    this.ctx.scene.remove(this.group);
    this.ctx.scene.remove(this.ring);
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => { m?.map?.dispose?.(); m?.dispose?.(); });
      }
    });
    this.ring.geometry.dispose();
    this.ring.material.dispose();
    this.bar.sprite.material.map.dispose();
    this.bar.sprite.material.dispose();
  }
}

// ------------------------------------------------------------
//  敵マネージャ（スポーン・更新）
// ------------------------------------------------------------
export class EnemyManager {
  constructor(ctx) {
    this.ctx = ctx;
    this.enemies = [];
    this.rng = new Rand(9182);
    this.spawnTimer = 2;
    this.bossSpawned = false;
    this.boss = null;
  }

  get aliveCount() { return this.enemies.filter((e) => !e.dead).length; }

  get targetCount() {
    const lvl = this.ctx.player.level;
    const night = this.ctx.env.nightFactor;
    return Math.min(26, Math.round(6 + lvl * 0.7 + night * 6));
  }

  get nightBoost() { return this.ctx.env.nightFactor; }

  pickType() {
    const lvl = this.ctx.player.level;
    const night = this.ctx.env.nightFactor;
    const pool = [];
    pool.push(['slime', 3]);
    if (lvl >= 2) pool.push(['wolf', 2.4]);
    if (lvl >= 4) pool.push(['skeleton', 2.0 + night * 1.5]);
    if (lvl >= 8) pool.push(['golem', 0.9 + night * 1.4]);
    let total = 0;
    for (const [, w] of pool) total += w;
    let r = this.rng.next() * total;
    for (const [k, w] of pool) { r -= w; if (r <= 0) return k; }
    return 'slime';
  }

  spawn(typeKey, position, opts = {}) {
    const e = new Enemy(typeKey, position, this.ctx, opts);
    this.enemies.push(e);
    this.ctx.audio?.play('spawn', { volume: 0.35 });
    return e;
  }

  spawnBoss() {
    const p = this.ctx.player.position;
    const a = this.rng.range(0, Math.PI * 2);
    const pos = this.ctx.world.findSpawnPoint(this.rng, p, 30, 40)
      || new THREE.Vector3(p.x + Math.cos(a) * 34, heightAt(p.x + Math.cos(a) * 34, p.z + Math.sin(a) * 34), p.z + Math.sin(a) * 34);
    const boss = this.spawn('dragon', pos, { hpMult: 1 });
    this.boss = boss;
    this.bossSpawned = true;
    this.ctx.audio?.play('boss');
    this.ctx.hud?.notify('⚠ 古代竜ヴァルガが目覚めた！', 'danger', 6000);
    this.ctx.hud?.showBossBar(boss.name);
    this.ctx.cameraCtrl?.shake(0.8);
    return boss;
  }

  update(dt, player, world) {
    // スポーン
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && !player.dead) {
      this.spawnTimer = this.rng.range(2.2, 4.6);
      if (this.aliveCount < this.targetCount) {
        const p = world.findSpawnPoint(this.rng, player.position, 42, 88);
        if (p) {
          const elite = this.rng.chance(0.10 + this.nightBoost * 0.16);
          this.spawn(this.pickType(), p, { elite });
        }
      }
    }

    for (let i = 0; i < this.enemies.length; i++) {
      const e = this.enemies[i];
      e.update(dt, player, world);
      // 分離
      if (!e.dead) {
        for (let j = i + 1; j < this.enemies.length; j++) {
          const o = this.enemies[j];
          if (o.dead) continue;
          const dx = o.position.x - e.position.x;
          const dz = o.position.z - e.position.z;
          const d2 = dx * dx + dz * dz;
          const rr = e.radius + o.radius;
          if (d2 < rr * rr && d2 > 1e-5) {
            const d = Math.sqrt(d2);
            const push = (rr - d) / d * 0.5;
            e.position.x -= dx * push; e.position.z -= dz * push;
            o.position.x += dx * push; o.position.z += dz * push;
          }
        }
      }
    }

    // 遠すぎる敵を間引く
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const e = this.enemies[i];
      const dist = Math.hypot(e.position.x - player.position.x, e.position.z - player.position.z);
      if ((e.removed || e.dead) && e.deadT > 2.6) {
        e.dispose();
        this.enemies.splice(i, 1);
      } else if (!e.isBoss && !e.dead && dist > 160) {
        e.dispose();
        this.enemies.splice(i, 1);
      }
    }
  }

  clear() {
    for (const e of this.enemies) e.dispose();
    this.enemies.length = 0;
    this.boss = null;
    this.bossSpawned = false;
  }
}
