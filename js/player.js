// ============================================================
//  プレイヤー
// ============================================================

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, lerp, damp, angleDamp } from './utils.js';
import { buildHumanoid } from './character.js';
import { WATER_LEVEL } from './terrain.js';
import { ITEMS } from './items.js';

const P = CONFIG.player;
const SKILLS = CONFIG.skills;

export class Player {
  constructor(ctx) {
    this.ctx = ctx;
    this.scene = ctx.scene;
    this.world = ctx.world;
    this.audio = ctx.audio;
    this.input = ctx.input;

    const model = buildHumanoid({
      skin: 0xe0ab77, hair: 0x2a1c12, cloth: 0x3f6ea8, cloth2: 0x24344f,
      leather: 0x6b4526, metal: 0xc8ccd4, cape: true, cloakColor: 0x8a2a34, scale: 1,
    });
    this.model = model;
    this.group = model.group;
    this.group.name = 'player';
    this.scene.add(this.group);

    // 夜間の松明（雰囲気づくりと視認性）
    this.torch = new THREE.PointLight(0xffcf9a, 0, 15, 2);
    this.torch.position.set(0, 1.6, 0);
    this.group.add(this.torch);

    // --- 位置と物理 ---
    this.position = new THREE.Vector3(0, 0, 6);
    this.position.y = this.world.getHeight(0, 6);
    this.velocity = new THREE.Vector3();
    this.radius = P.radius;
    this.onGround = true;
    this.facing = 0;

    // --- 能力値 ---
    this.level = 1;
    this.xp = 0;
    this.xpNext = CONFIG.xpTable(1);
    this.gold = 120;
    this.baseAttack = 14;
    this.baseDefense = 5;
    this.maxHp = P.maxHp;
    this.hp = this.maxHp;
    this.maxMp = P.maxMp;
    this.mp = this.maxMp;
    this.maxStamina = P.maxStamina;
    this.stamina = this.maxStamina;
    this.critChance = CONFIG.combat.critChance;
    this.critMult = CONFIG.combat.critMult;
    this.speedMult = 1;
    this.equipment = { weapon: 'traveler_sword', armor: 'cloth_robe' };
    this.kills = 0;
    this.playtime = 0;

    // --- 状態 ---
    this.dead = false;
    this.invuln = 0;
    this.attackCd = 0;
    this.attackAnim = -1;
    this.castAnim = -1;
    this.combo = 0;
    this.comboTimer = 0;
    this.rolling = false;
    this.rollT = 0;
    this.rollDir = new THREE.Vector3();
    this.guardTimer = 0;
    this.hurtFlash = 0;
    this.cooldowns = SKILLS.map(() => 0);
    this.skillLock = 0;
    this.stepTimer = 0;
    this.pendingHit = null;
    this.interactable = null;
    this.godMode = false;

    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._move = new THREE.Vector3();
  }

  // ------------------------------------------------------------
  get attackPower() {
    let a = this.baseAttack;
    const w = ITEMS[this.equipment.weapon];
    if (w) a += w.attack || 0;
    return a * (1 + (this.level - 1) * 0.02);
  }

  get defense() {
    let d = this.baseDefense + (this.level - 1) * 1.1;
    const ar = ITEMS[this.equipment.armor];
    if (ar) d += ar.defense || 0;
    return d;
  }

  get eyePosition() {
    return new THREE.Vector3(this.position.x, this.position.y + 1.5, this.position.z);
  }

  // ------------------------------------------------------------
  update(dt) {
    const inp = this.input;
    this.playtime += dt;

    if (this.dead) {
      this.model.update(dt, { dead: true });
      this.group.position.copy(this.position);
      return;
    }

    // タイマー
    this.invuln = Math.max(0, this.invuln - dt);
    this.attackCd = Math.max(0, this.attackCd - dt);
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    this.guardTimer = Math.max(0, this.guardTimer - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt);
    this.skillLock = Math.max(0, this.skillLock - dt);
    for (let i = 0; i < this.cooldowns.length; i++) this.cooldowns[i] = Math.max(0, this.cooldowns[i] - dt);
    if (this.comboTimer <= 0) this.combo = 0;

    // 回復
    this.hp = Math.min(this.maxHp, this.hp + P.hpRegen * dt * (this.guardTimer > 0 ? 2.2 : 1));
    this.mp = Math.min(this.maxMp, this.mp + P.mpRegen * dt);
    const regen = this.rolling ? 0 : P.staminaRegen * (this.onGround ? 1 : 0.35);
    this.stamina = Math.min(this.maxStamina, this.stamina + regen * dt);

    const busy = this.attackAnim >= 0 || this.castAnim >= 0;

    // --- 回避ロール ---
    if (inp.mouseJustPressed(2) && !this.rolling && this.stamina >= 18 && this.attackAnim < 0) {
      this.startRoll();
    }
    if (this.rolling) {
      this.rollT += dt;
      if (this.rollT >= P.rollTime) { this.rolling = false; }
    }

    // --- 移動 ---
    const cam = this.ctx.cameraCtrl;
    const yaw = cam ? cam.yaw : 0;
    const fwd = this._fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = this._right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    const mv = inp.moveVector();
    let wishX = 0, wishZ = 0;
    if (!this.rolling && !busy) {
      wishX = fwd.x * (-mv.z) + right.x * mv.x;
      wishZ = fwd.z * (-mv.z) + right.z * mv.x;
      const l = Math.hypot(wishX, wishZ);
      if (l > 1) { wishX /= l; wishZ /= l; }
    }

    const wantRun = (inp.isDown('ShiftLeft') || inp.isDown('ShiftRight')) && this.stamina > 1 && (mv.active || this.rolling);
    let maxSpeed = (wantRun ? P.runSpeed : P.walkSpeed) * this.speedMult;
    if (this.guardTimer > 0) maxSpeed *= 0.42;
    if (this.rolling) maxSpeed = P.rollSpeed;

    const accel = (this.onGround ? P.accel : P.airAccel) * (this.rolling ? 2.5 : 1);
    if (this.rolling) {
      this.velocity.x = damp(this.velocity.x, this.rollDir.x * maxSpeed, 9, dt);
      this.velocity.z = damp(this.velocity.z, this.rollDir.z * maxSpeed, 9, dt);
    } else if (wishX || wishZ) {
      const targetX = wishX * maxSpeed;
      const targetZ = wishZ * maxSpeed;
      this.velocity.x = damp(this.velocity.x, targetX, accel * 0.35, dt);
      this.velocity.z = damp(this.velocity.z, targetZ, accel * 0.35, dt);
    } else {
      const f = this.onGround ? P.friction : 1.4;
      this.velocity.x = damp(this.velocity.x, 0, f, dt);
      this.velocity.z = damp(this.velocity.z, 0, f, dt);
    }

    if (wantRun && (mv.active || this.rolling)) {
      this.stamina -= P.runCost * dt;
    }

    // ジャンプ
    if (inp.justPressed('Space') && this.onGround && !this.rolling) {
      this.velocity.y = P.jumpSpeed;
      this.onGround = false;
      this.audio.play('jump');
    }

    // 重力
    this.velocity.y -= P.gravity * dt;
    if (this.velocity.y < -60) this.velocity.y = -60;

    // 水平移動 + 地形衝突
    const nx = this.position.x + this.velocity.x * dt;
    const nz = this.position.z + this.velocity.z * dt;
    const curGround = this.world.getHeight(this.position.x, this.position.z);
    const newGround = this.world.getHeight(nx, nz);
    const stepUp = newGround - Math.max(curGround, this.position.y);
    const slopeBlocked = !this.rolling && stepUp > 1.05 && this.onGround;
    if (!slopeBlocked) {
      this.position.x = nx;
      this.position.z = nz;
    } else {
      this.velocity.x *= 0.2;
      this.velocity.z *= 0.2;
    }

    // 世界の境界
    const R = 214;
    const d = Math.hypot(this.position.x, this.position.z);
    if (d > R) {
      this.position.x *= R / d;
      this.position.z *= R / d;
      this.velocity.x *= 0.3;
      this.velocity.z *= 0.3;
    }

    this.world.resolveCollision(this.position, this.radius);

    // 接地
    const ground = this.world.getHeight(this.position.x, this.position.z);
    this.position.y += this.velocity.y * dt;
    if (this.position.y <= ground) {
      if (!this.onGround && this.velocity.y < -8) {
        this.ctx.cameraCtrl?.shake(0.12);
        this.audio.play('footstep', { volume: 1.6 });
      }
      this.position.y = ground;
      this.velocity.y = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    // 水面下では移動が遅くなる
    if (this.position.y < WATER_LEVEL - 0.2) {
      this.velocity.x *= 0.94;
      this.velocity.z *= 0.94;
    }

    // 向き
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.rolling) {
      this.facing = Math.atan2(this.rollDir.x, this.rollDir.z);
    } else if (speed > 0.6) {
      this.facing = angleDamp(this.facing, Math.atan2(this.velocity.x, this.velocity.z), 12, dt);
    } else if (this.attackAnim >= 0 || this.castAnim >= 0) {
      const f = cam ? cam.forward : this._fwd.set(0, 0, -1);
      this.facing = angleDamp(this.facing, Math.atan2(f.x, f.z), 14, dt);
    }
    this.group.rotation.y = this.facing;
    this.group.position.copy(this.position);

    // 足音
    if (this.onGround && speed > 2.4) {
      this.stepTimer -= dt * speed;
      if (this.stepTimer <= 0) {
        this.stepTimer = 2.6;
        this.audio.play('footstep', { volume: 0.55 });
      }
    }

    // --- 攻撃アニメの進行 ---
    if (this.attackAnim >= 0) {
      this.attackAnim += dt / 0.46;
      if (this.pendingHit && !this.pendingHit.done && this.attackAnim >= this.pendingHit.at) {
        this.pendingHit.done = true;
        this.doMeleeHit();
      }
      if (this.attackAnim >= 1) { this.attackAnim = -1; this.pendingHit = null; }
    }
    if (this.castAnim >= 0) {
      this.castAnim += dt / 0.62;
      if (this.castAnim >= 1) this.castAnim = -1;
    }

    // --- 入力：攻撃・スキル ---
    if (!this.ctx.ui?.isBlockingInput()) {
      if (inp.mouseJustPressed(0) || inp.justPressed('Digit1')) this.tryAttack();
      if (inp.justPressed('Digit2')) this.useSkill(1);
      if (inp.justPressed('Digit3')) this.useSkill(2);
      if (inp.justPressed('Digit4')) this.useSkill(3);
      if (inp.justPressed('Digit5')) this.useSkill(4);
    }

    // 夜間の松明
    if (this.torch) {
      const nf = this.ctx.env ? this.ctx.env.nightFactor : 0;
      this.torch.intensity = nf * 5.0;
      this.torch.visible = nf > 0.02;
    }

    // --- モデル更新 ---
    const animSpeed = this.rolling ? 8 : speed;
    this.model.update(dt, {
      speed: animSpeed,
      attackPhase: this.attackAnim,
      castPhase: this.castAnim,
      blocking: this.guardTimer > 0,
      dead: false,
    });

    // ローリングの見た目
    if (this.rolling) {
      const p = clamp(this.rollT / P.rollTime, 0, 1);
      this.group.rotation.x = -p * Math.PI * 2;
      this.group.position.y = this.position.y + Math.sin(p * Math.PI) * 0.45;
    } else {
      this.group.rotation.x = damp(this.group.rotation.x, 0, 12, dt);
    }

    // 被弾の色
    if (this.hurtFlash > 0) {
      const f = this.hurtFlash / 0.4;
      this.model.parts.body.traverse((o) => {
        if (o.isMesh && o.material?.emissive) o.material.emissive.setRGB(f * 0.5, 0, 0);
      });
    } else {
      this.model.parts.body.traverse((o) => {
        if (o.isMesh && o.material?.emissive && o.material.emissiveIntensity === undefined) o.material.emissive.setRGB(0, 0, 0);
      });
    }

    // --- インタラクト対象 ---
    this.interactable = this.findInteractable();
  }

  // ------------------------------------------------------------
  startRoll() {
    this.rolling = true;
    this.rollT = 0;
    this.stamina -= 18;
    this.invuln = Math.max(this.invuln, P.rollTime * 0.85);
    const inp = this.input;
    const mv = inp.moveVector();
    const cam = this.ctx.cameraCtrl;
    const yaw = cam ? cam.yaw : 0;
    const fwd = this._fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    const right = this._right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    let dx = fwd.x * (-mv.z) + right.x * mv.x;
    let dz = fwd.z * (-mv.z) + right.z * mv.x;
    const l = Math.hypot(dx, dz);
    if (l < 0.1) { dx = Math.sin(this.facing); dz = Math.cos(this.facing); }
    else { dx /= l; dz /= l; }
    this.rollDir.set(dx, 0, dz);
    this.audio.play('roll');
  }

  // ------------------------------------------------------------
  tryAttack() {
    if (this.attackCd > 0 || this.rolling || this.castAnim >= 0) return;
    if (this.stamina < SKILLS[0].stamina) return;
    this.stamina -= SKILLS[0].stamina;
    this.attackCd = CONFIG.combat.attackCooldown;
    this.combo = this.comboTimer > 0 ? (this.combo % 3) + 1 : 1;
    this.comboTimer = CONFIG.combat.comboWindow;
    this.attackAnim = 0;
    this.pendingHit = { at: 0.32, done: false };
    this.audio.play('swing', { volume: 0.9 });
  }

  doMeleeHit() {
    const cam = this.ctx.cameraCtrl;
    const f = cam ? cam.forward : this._fwd.set(0, 0, -1);
    const yaw = Math.atan2(f.x, f.z);
    const mult = 1 + (this.combo - 1) * 0.18;
    const dmg = this.attackPower * mult;
    const hits = this.ctx.combat.meleeArc(this.position, yaw, CONFIG.combat.attackRange, CONFIG.combat.attackArc, dmg, {
      source: 'player',
      knockback: 5.5,
      crit: this.critChance,
      critMult: this.critMult,
    });
    if (hits > 0) {
      this.ctx.cameraCtrl?.shake(0.16);
    }
  }

  // ------------------------------------------------------------
  useSkill(index) {
    const skill = SKILLS[index];
    if (!skill) return;
    if (this.cooldowns[index] > 0 || this.dead) return;
    if (this.mp < skill.mp) { this.ctx.hud?.notify('マナが足りない', 'danger'); return; }
    if (skill.stamina && this.stamina < skill.stamina) { this.ctx.hud?.notify('スタミナが足りない', 'danger'); return; }
    if (this.rolling) return;

    this.mp -= skill.mp;
    if (skill.stamina) this.stamina -= skill.stamina;
    this.cooldowns[index] = skill.cd;

    const cam = this.ctx.cameraCtrl;
    const f = cam ? cam.forward : this._fwd.set(0, 0, -1);
    const yaw = Math.atan2(f.x, f.z);

    switch (skill.id) {
      case 'fire': {
        this.castAnim = 0;
        this.skillLock = 0.3;
        this.audio.play('fire');
        const dir = new THREE.Vector3(f.x, 0.02, f.z).normalize();
        const origin = new THREE.Vector3(this.position.x + dir.x * 0.8, this.position.y + 1.25, this.position.z + dir.z * 0.8);
        this.ctx.combat.spawnProjectile({
          position: origin,
          direction: dir,
          speed: 26,
          damage: this.attackPower * 1.7 + 22,
          radius: 0.55,
          life: 2.4,
          color: 0xff8a2a,
          source: 'player',
          explode: 2.4,
        });
        this.ctx.cameraCtrl?.shake(0.1);
        break;
      }
      case 'heal': {
        this.castAnim = 0;
        const amount = this.maxHp * 0.34 + 18;
        this.hp = Math.min(this.maxHp, this.hp + amount);
        this.audio.play('heal');
        this.ctx.combat.burst(new THREE.Vector3(this.position.x, this.position.y + 1.0, this.position.z), 0x9dffc4, 26, {
          radius: 1.2, up: 2.6, life: 1.1, size: 0.5,
        });
        this.ctx.hud?.floatText(this.position.clone().add(new THREE.Vector3(0, 2.0, 0)), `+${Math.round(amount)}`, 'heal');
        break;
      }
      case 'whirl': {
        this.attackAnim = 0;
        this.skillLock = 0.6;
        this.audio.play('whirl');
        this.ctx.cameraCtrl?.shake(0.3);
        const hits = this.ctx.combat.meleeArc(this.position, yaw, 4.6, Math.PI, this.attackPower * 1.5, {
          source: 'player', knockback: 9, crit: this.critChance, critMult: this.critMult, all: true,
        });
        this.ctx.combat.ring(new THREE.Vector3(this.position.x, this.position.y + 0.6, this.position.z), 0xffe08a, 4.6);
        break;
      }
      case 'guard': {
        this.guardTimer = 5.0;
        this.audio.play('guard');
        this.ctx.combat.burst(new THREE.Vector3(this.position.x, this.position.y + 1.0, this.position.z), 0xffd964, 22, {
          radius: 1.0, up: 1.4, life: 0.9, size: 0.42,
        });
        break;
      }
      default: {
        // 斬撃スキル扱い
        this.tryAttack();
        break;
      }
    }
  }

  // ------------------------------------------------------------
  takeDamage(amount, fromPos) {
    if (this.dead || this.invuln > 0 || this.godMode) return 0;
    let dmg = Math.max(1, amount - this.defense * 0.45);
    if (this.guardTimer > 0) dmg *= 0.25;
    this.hp -= dmg;
    this.invuln = P.invulnTime;
    this.hurtFlash = 0.4;
    this.audio.play('hurt');
    this.ctx.cameraCtrl?.shake(0.4);
    this.ctx.hud?.hurtFlash();
    this.ctx.hud?.floatText(this.position.clone().add(new THREE.Vector3(0, 1.9, 0)), `-${Math.round(dmg)}`, 'player');

    if (fromPos) {
      const dx = this.position.x - fromPos.x;
      const dz = this.position.z - fromPos.z;
      const l = Math.hypot(dx, dz) || 1;
      this.velocity.x += (dx / l) * 4.5;
      this.velocity.z += (dz / l) * 4.5;
    }

    if (this.hp <= 0) {
      this.hp = 0;
      this.die();
    }
    return dmg;
  }

  die() {
    this.dead = true;
    this.audio.play('die');
    this.ctx.cameraCtrl?.shake(0.6);
    this.ctx.onPlayerDeath?.();
  }

  revive() {
    this.dead = false;
    this.hp = this.maxHp * 0.6;
    this.mp = this.maxMp * 0.5;
    this.stamina = this.maxStamina;
    this.invuln = 2.5;
    this.velocity.set(0, 0, 0);
    this.group.rotation.x = 0;
    this.position.set(0, this.world.getHeight(0, 6), 6);
    this.model.update(0.016, {});
  }

  // ------------------------------------------------------------
  gainXp(amount) {
    this.xp += amount;
    this.ctx.hud?.floatText(this.position.clone().add(new THREE.Vector3(0, 2.2, 0)), `+${amount} EXP`, 'xp');
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext;
      this.level++;
      this.xpNext = CONFIG.xpTable(this.level);
      this.onLevelUp();
    }
  }

  onLevelUp() {
    this.maxHp += 16;
    this.maxMp += 7;
    this.baseAttack += 2.4;
    this.baseDefense += 1.2;
    this.hp = this.maxHp;
    this.mp = this.maxMp;
    this.audio.play('levelup');
    this.ctx.hud?.levelUp(this.level);
    this.ctx.onLevelUp?.(this.level);
  }

  gainGold(n) {
    this.gold += n;
    this.audio.play('coin');
  }

  // ------------------------------------------------------------
  findInteractable() {
    const list = [];
    if (this.ctx.npcs) {
      for (const n of this.ctx.npcs) {
        if (n.dead) continue;
        const d = Math.hypot(n.position.x - this.position.x, n.position.z - this.position.z);
        if (d < 3.4) list.push({ type: 'npc', target: n, label: n.name + 'と話す', dist: d });
      }
    }
    if (this.ctx.enemyManager) {
      for (const e of this.ctx.enemyManager.enemies) {
        if (e.dead) continue;
        const d = Math.hypot(e.position.x - this.position.x, e.position.z - this.position.z);
        if (d < 3.2) list.push({ type: 'enemy', target: e, label: e.name + 'を調べる', dist: d });
      }
    }
    if (this.ctx.drops) {
      for (const dr of this.ctx.drops) {
        if (dr.taken) continue;
        const d = Math.hypot(dr.position.x - this.position.x, dr.position.z - this.position.z);
        if (d < 2.6) list.push({ type: 'drop', target: dr, label: `${dr.name}を拾う`, dist: d });
      }
    }
    if (!list.length) return null;
    list.sort((a, b) => a.dist - b.dist);
    return list[0];
  }

  // ------------------------------------------------------------
  serialize() {
    return {
      level: this.level, xp: this.xp, xpNext: this.xpNext, gold: this.gold,
      maxHp: this.maxHp, hp: this.hp, maxMp: this.maxMp, mp: this.mp,
      baseAttack: this.baseAttack, baseDefense: this.baseDefense,
      equipment: { ...this.equipment }, kills: this.kills, playtime: this.playtime,
      position: [this.position.x, this.position.y, this.position.z],
    };
  }

  deserialize(s) {
    if (!s) return;
    Object.assign(this, {
      level: s.level, xp: s.xp, xpNext: s.xpNext, gold: s.gold,
      maxHp: s.maxHp, hp: s.hp, maxMp: s.maxMp, mp: s.mp,
      baseAttack: s.baseAttack, baseDefense: s.baseDefense,
      kills: s.kills || 0, playtime: s.playtime || 0,
    });
    if (s.equipment) this.equipment = { ...s.equipment };
    if (s.position) {
      this.position.set(s.position[0], s.position[1], s.position[2]);
      this.position.y = this.world.getHeight(this.position.x, this.position.z);
    }
  }
}
