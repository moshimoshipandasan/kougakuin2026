// ============================================================
//  HUD — 体力バー・ミニマップ・ダメージ表示・通知
// ============================================================

import * as THREE from 'three';
import { clamp, lerp, damp } from './utils.js';
import { heightAt, colorAt, WATER_LEVEL, HALF } from './terrain.js';
import { CONFIG } from './config.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(ctx) {
    this.ctx = ctx;
    this.el = {
      hud: $('hud'),
      hp: $('hp-bar'), mp: $('mp-bar'), stam: $('stam-bar'), xp: $('xp-bar'),
      hpText: $('hp-text'), mpText: $('mp-text'), xpText: $('xp-text'), level: $('level-text'),
      gold: $('gold-text'), clock: $('clock-text'), clockIcon: $('clock-icon'), phase: $('phase-text'),
      minimap: $('minimap'), questTracker: $('quest-tracker'), notifications: $('notifications'),
      damageLayer: $('damage-layer'), interact: $('interact-prompt'), interactLabel: $('interact-label'),
      bossBar: $('boss-bar'), bossName: $('boss-name'), bossFill: $('boss-fill'),
      hurt: $('hurt-flash'), levelup: $('levelup-flash'), combatLog: $('combat-log'),
      hotbar: $('hotbar'),
      bgmChip: $('bgm-chip'), bgmName: $('bgm-name'), bgmVol: $('bgm-vol'),
    };
    this.mmCtx = this.el.minimap.getContext('2d');
    this.floats = [];
    this.hurtT = 0;
    this.bossRatio = 1;
    this.bossTarget = 1;
    this.mapCanvas = null;
    this.buildWorldMap();

    // ホットバーのスキル表示を設定
    const slots = this.el.hotbar.querySelectorAll('.slot');
    slots.forEach((s, i) => {
      const sk = CONFIG.skills[i];
      if (!sk) return;
      s.querySelector('.ico').textContent = sk.icon;
      s.querySelector('.nm').textContent = sk.name;
    });
  }

  // ------------------------------------------------------------
  buildWorldMap() {
    const S = 300;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    const img = g.createImageData(S, S);
    const col = [0, 0, 0];
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const wx = (x / (S - 1) - 0.5) * HALF * 2;
        const wz = (y / (S - 1) - 0.5) * HALF * 2;
        const h = heightAt(wx, wz);
        const i = (y * S + x) * 4;
        if (h < WATER_LEVEL) {
          const d = clamp((WATER_LEVEL - h) / 30, 0, 1);
          img.data[i] = 30 - d * 22;
          img.data[i + 1] = 70 - d * 50;
          img.data[i + 2] = 120 - d * 70;
        } else {
          colorAt(wx, wz, h, 0.2, col);
          // 陰影
          const shade = clamp(0.55 + h / 130, 0.4, 1.15);
          img.data[i] = col[0] * 255 * shade;
          img.data[i + 1] = col[1] * 255 * shade;
          img.data[i + 2] = col[2] * 255 * shade;
        }
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    this.mapCanvas = c;
  }

  // ------------------------------------------------------------
  show() { this.el.hud.classList.remove('hidden'); }
  hide() { this.el.hud.classList.add('hidden'); }

  // ------------------------------------------------------------
  notify(text, type = 'info', ms = 2800) {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = text;
    this.el.notifications.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 420);
    }, ms);
    // 最大数を制限
    while (this.el.notifications.children.length > 5) {
      this.el.notifications.firstChild.remove();
    }
  }

  log(text, type = '') {
    const el = document.createElement('div');
    el.className = 'log-line ' + type;
    el.textContent = text;
    this.el.combatLog.appendChild(el);
    while (this.el.combatLog.children.length > 6) this.el.combatLog.firstChild.remove();
    setTimeout(() => {
      el.style.transition = 'opacity 0.6s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 600);
    }, 5200);
  }

  hurtFlash() {
    this.hurtT = 0.35;
    this.el.hurt.classList.add('on');
  }

  levelUp(level) {
    this.el.levelup.classList.remove('on');
    void this.el.levelup.offsetWidth;
    this.el.levelup.classList.add('on');
    this.notify(`レベル ${level} に到達した！`, 'level', 4000);
    this.log(`レベルアップ！ Lv.${level}`, 'loot');
  }

  // ------------------------------------------------------------
  floatText(worldPos, text, type = 'enemy') {
    const el = document.createElement('div');
    el.className = 'dmg-num ' + (type === 'enemy' ? '' : type);
    el.textContent = text;
    this.el.damageLayer.appendChild(el);
    this.floats.push({
      el,
      pos: worldPos.clone(),
      life: 0,
      max: type === 'crit' ? 1.15 : 0.95,
      off: Math.random() * 0.6 - 0.3,
    });
    if (this.floats.length > 40) {
      const f = this.floats.shift();
      f.el.remove();
    }
  }

  // ------------------------------------------------------------
  update(player, env, camera, dt) {
    const p = player;
    const hpR = clamp(p.hp / p.maxHp, 0, 1);
    const mpR = clamp(p.mp / p.maxMp, 0, 1);
    const stR = clamp(p.stamina / p.maxStamina, 0, 1);
    const xpR = clamp(p.xp / p.xpNext, 0, 1);

    this.el.hp.style.width = (hpR * 100) + '%';
    this.el.mp.style.width = (mpR * 100) + '%';
    this.el.stam.style.width = (stR * 100) + '%';
    this.el.xp.style.width = (xpR * 100) + '%';
    this.el.hpText.textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
    this.el.mpText.textContent = `${Math.ceil(p.mp)} / ${p.maxMp}`;
    this.el.xpText.textContent = `EXP ${Math.floor(p.xp)} / ${p.xpNext}`;
    this.el.level.textContent = p.level;
    this.el.gold.textContent = Math.floor(p.gold);

    this.el.clock.textContent = env.clockText;
    const ph = env.phase;
    this.el.clockIcon.textContent = ph.icon;
    this.el.phase.textContent = ph.label;

    // ホットバー
    const slots = this.el.hotbar.querySelectorAll('.slot');
    slots.forEach((s, i) => {
      const sk = CONFIG.skills[i];
      if (!sk) return;
      const cd = p.cooldowns[i] || 0;
      const cdEl = s.querySelector('.cd');
      cdEl.style.transform = `scaleY(${cd > 0 ? clamp(cd / sk.cd, 0, 1) : 0})`;
      s.classList.toggle('no-mp', p.mp < sk.mp);
    });

    // 被弾フラッシュ
    if (this.hurtT > 0) {
      this.hurtT -= dt;
      if (this.hurtT <= 0) this.el.hurt.classList.remove('on');
    }

    // ボスバー
    if (!this.el.bossBar.classList.contains('hidden')) {
      this.bossRatio = damp(this.bossRatio, this.bossTarget, 6, dt);
      this.el.bossFill.style.width = (clamp(this.bossRatio, 0, 1) * 100) + '%';
    }

    // インタラクト表示
    const ia = p.interactable;
    if (ia && !this.ctx.ui?.isBlockingInput()) {
      this.el.interact.classList.remove('hidden');
      this.el.interactLabel.textContent = ia.label;
    } else {
      this.el.interact.classList.add('hidden');
    }

    this.updateFloats(camera, dt);
    this.drawMinimap(p);

    // BGM 表示
    const a = this.ctx.audio;
    if (a && this.el.bgmChip) {
      this.el.bgmChip.classList.toggle('muted', !a.musicOn);
      if (this.el.bgmVol) this.el.bgmVol.textContent = Math.round(a.musicVolume * 100) + '%';
    }
  }

  updateFloats(camera, dt) {
    const w = window.innerWidth, h = window.innerHeight;
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.life += dt;
      const t = f.life / f.max;
      if (t >= 1) { f.el.remove(); this.floats.splice(i, 1); continue; }
      const v = f.pos.clone();
      v.y += t * 1.6;
      v.project(camera);
      const x = (v.x * 0.5 + 0.5) * w + f.off * 30;
      const y = (-v.y * 0.5 + 0.5) * h;
      const visible = v.z < 1 && v.z > -1;
      f.el.style.display = visible ? 'block' : 'none';
      f.el.style.transform = `translate(${x}px, ${y}px) translate(-50%,-50%) scale(${lerp(1.25, 0.85, t)})`;
      f.el.style.opacity = String(clamp(1.4 - t * 1.4, 0, 1));
    }
  }

  // ------------------------------------------------------------
  drawMinimap(player) {
    const ctx = this.mmCtx;
    const S = 180, R = 88, cx = 90, cy = 90;
    const viewR = 78;
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();

    if (this.mapCanvas) {
      const ms = this.mapCanvas.width;
      const worldSize = HALF * 2;
      const px = (player.position.x / worldSize + 0.5) * ms;
      const pz = (player.position.z / worldSize + 0.5) * ms;
      const srcHalf = (viewR / worldSize) * ms;
      ctx.drawImage(this.mapCanvas, px - srcHalf, pz - srcHalf, srcHalf * 2, srcHalf * 2, cx - R, cy - R, R * 2, R * 2);
    }

    // 暗くする
    ctx.fillStyle = 'rgba(6,10,16,0.35)';
    ctx.fillRect(0, 0, S, S);

    const toMap = (wx, wz) => {
      const dx = (wx - player.position.x) / viewR * R;
      const dz = (wz - player.position.z) / viewR * R;
      return [cx + dx, cy + dz];
    };

    // NPC
    const npcs = this.ctx.npcs || [];
    for (const n of npcs) {
      const [x, y] = toMap(n.position.x, n.position.z);
      ctx.fillStyle = '#ffd94a';
      ctx.beginPath(); ctx.arc(x, y, 3.6, 0, Math.PI * 2); ctx.fill();
    }

    // ドロップ
    for (const d of (this.ctx.drops || [])) {
      if (d.taken) continue;
      const [x, y] = toMap(d.position.x, d.position.z);
      ctx.fillStyle = '#ffb347';
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }

    // 敵
    const em = this.ctx.enemyManager;
    if (em) {
      for (const e of em.enemies) {
        if (e.dead) continue;
        const [x, y] = toMap(e.position.x, e.position.z);
        const dd = Math.hypot(x - cx, y - cy);
        if (dd > R) continue;
        ctx.fillStyle = e.isBoss ? '#c04aff' : (e.elite ? '#ff9a3c' : '#ff4a4a');
        ctx.beginPath();
        ctx.arc(x, y, e.isBoss ? 6 : 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // プレイヤー矢印
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(Math.atan2(Math.cos(player.facing), Math.sin(player.facing)));
    ctx.fillStyle = '#eaf6ff';
    ctx.strokeStyle = '#0a0e14';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-5, 5.5);
    ctx.lineTo(-2.5, 0);
    ctx.lineTo(-5, -5.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    ctx.restore();
  }

  // ------------------------------------------------------------
  updateQuestTracker() {
    const qm = this.ctx.questManager;
    const host = this.el.questTracker;
    if (!qm) return;
    const active = qm.activeQuests();
    host.innerHTML = '';
    const show = active.slice(0, 3);
    for (const { quest, state } of show) {
      const div = document.createElement('div');
      div.className = 'qt-item';
      const objs = quest.objectives.map((o, i) => {
        const done = state.progress[i] >= o.count;
        return `<div class="qt-obj ${done ? 'done' : ''}">・${o.label} ${state.progress[i]}/${o.count}</div>`;
      }).join('');
      div.innerHTML = `<div class="qt-title">${quest.name}</div>${objs}`;
      host.appendChild(div);
    }
    if (active.length > 3) {
      const more = document.createElement('div');
      more.className = 'qt-item';
      more.innerHTML = `<div class="qt-obj">ほか ${active.length - 3} 件…</div>`;
      host.appendChild(more);
    }
  }

  showBossBar(name) {
    this.el.bossName.textContent = name;
    this.el.bossBar.classList.remove('hidden');
    this.bossRatio = 1; this.bossTarget = 1;
  }

  setBossRatio(r) { this.bossTarget = r; }
  hideBossBar() { this.el.bossBar.classList.add('hidden'); }
}
