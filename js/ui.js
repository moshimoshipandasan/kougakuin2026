// ============================================================
//  UI — パネル・会話・タイトル・死亡画面
// ============================================================

import { ITEMS } from './items.js';
import { CONFIG } from './config.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(ctx) {
    this.ctx = ctx;
    this.panels = {
      inventory: $('inventory'),
      questlog: $('questlog'),
      pause: $('pause'),
      death: $('death'),
      howto: $('howto'),
    };
    this.dialogueEl = $('dialogue');
    this.titleEl = $('title');
    this.loadingEl = $('loading');
    this.currentDialogue = null;
    this.dialogueNpc = null;

    this._bind();
  }

  _bind() {
    document.querySelectorAll('[data-close]').forEach((b) => {
      b.addEventListener('click', () => this.close(b.dataset.close));
    });

    document.querySelectorAll('#pause .menu-btn').forEach((b) => {
      b.addEventListener('click', () => {
        const a = b.dataset.action;
        if (a === 'resume') this.closeAll();
        else if (a === 'save') { this.ctx.save(); this.ctx.hud.notify('冒険の記録を保存した', 'quest'); }
        else if (a === 'inventory') { this.closeAll(); this.open('inventory'); this.renderInventory(); }
        else if (a === 'questlog') { this.closeAll(); this.open('questlog'); this.renderQuests(); }
        else if (a === 'title') { this.ctx.toTitle(); }
      });
    });

    $('btn-new')?.addEventListener('click', () => this.ctx.startNewGame());
    $('btn-continue')?.addEventListener('click', () => this.ctx.continueGame());
    $('btn-howto')?.addEventListener('click', () => this.open('howto'));
    $('btn-respawn')?.addEventListener('click', () => this.ctx.respawn());

    // ホットバーのクリックでスキル
    document.querySelectorAll('#hotbar .slot').forEach((s) => {
      s.addEventListener('click', () => {
        const i = Number(s.dataset.skill);
        if (i === 0) this.ctx.player.tryAttack();
        else this.ctx.player.useSkill(i);
      });
    });
  }

  // ------------------------------------------------------------
  isBlockingInput() {
    if (!this.titleEl.classList.contains('hidden')) return true;
    for (const k in this.panels) {
      if (!this.panels[k].classList.contains('hidden')) return true;
    }
    if (!this.dialogueEl.classList.contains('hidden')) return true;
    return false;
  }

  open(name) {
    const p = this.panels[name];
    if (!p) return;
    p.classList.remove('hidden');
    this.ctx.input.exitLock();
    this.ctx.audio?.play('ui');
  }

  close(name) {
    const p = this.panels[name];
    if (!p) return;
    p.classList.add('hidden');
    this.ctx.audio?.play('ui');
    this.ctx.onPanelClosed?.();
  }

  closeAll() {
    for (const k in this.panels) this.panels[k].classList.add('hidden');
    this.closeDialogue();
    this.ctx.onPanelClosed?.();
  }

  toggle(name) {
    const p = this.panels[name];
    if (!p) return;
    if (p.classList.contains('hidden')) this.open(name);
    else this.close(name);
  }

  // ------------------------------------------------------------
  showTitle() {
    this.titleEl.classList.remove('hidden');
    this.ctx.hud.hide();
    const hasSave = !!localStorage.getItem(CONFIG.saveKey);
    const btn = $('btn-continue');
    if (btn) {
      btn.disabled = !hasSave;
      btn.style.opacity = hasSave ? '1' : '0.4';
    }
  }

  hideTitle() { this.titleEl.classList.add('hidden'); }

  // ------------------------------------------------------------
  setLoading(p, step) {
    this.loadingEl.classList.remove('done');
    const bar = $('loading-bar');
    if (bar) bar.style.width = (p * 100).toFixed(0) + '%';
    const s = $('loading-step');
    if (s) s.textContent = step || '';
  }

  hideLoading() {
    this.loadingEl.classList.add('done');
    setTimeout(() => this.loadingEl.classList.add('hidden'), 700);
  }

  // ------------------------------------------------------------
  startDialogue(npc, node) {
    this.dialogueNpc = npc;
    if (npc) npc.talking = true;
    this.showDialogueNode(node);
    this.ctx.input.exitLock();
  }

  showDialogueNode(node) {
    this.currentDialogue = node;
    this.dialogueEl.classList.remove('hidden');
    $('dlg-name').textContent = node.name || (this.dialogueNpc ? this.dialogueNpc.name : '');
    $('dlg-face').textContent = node.face || (this.dialogueNpc ? this.dialogueNpc.face : '💬');
    const textEl = $('dlg-text');
    textEl.textContent = node.text || '';

    const opts = $('dlg-options');
    opts.innerHTML = '';
    const options = node.options || [{ label: '閉じる', close: true }];
    options.forEach((o) => {
      const b = document.createElement('button');
      b.className = 'dlg-opt';
      b.textContent = o.label;
      b.addEventListener('click', () => {
        this.ctx.audio?.play('ui');
        if (o.action) o.action();
        if (o.close) { this.closeDialogue(); return; }
        if (o.next) {
          const n = typeof o.next === 'function' ? o.next() : o.next;
          if (n) this.showDialogueNode(n);
          else this.closeDialogue();
        }
      });
      opts.appendChild(b);
    });
  }

  closeDialogue() {
    this.dialogueEl.classList.add('hidden');
    if (this.dialogueNpc) this.dialogueNpc.talking = false;
    this.dialogueNpc = null;
    this.currentDialogue = null;
  }

  get inDialogue() { return !this.dialogueEl.classList.contains('hidden'); }

  // ------------------------------------------------------------
  renderInventory() {
    const grid = $('inv-grid');
    const inv = this.ctx.inventory;
    const player = this.ctx.player;
    grid.innerHTML = '';

    const list = inv.list();
    const cells = Math.max(24, Math.ceil((list.length + 1) / 6) * 6);
    for (let i = 0; i < cells; i++) {
      const cell = document.createElement('div');
      cell.className = 'inv-cell';
      const item = list[i];
      if (item) {
        const def = ITEMS[item.id];
        cell.innerHTML = `<span class="qty">${def.icon}</span><span class="cnt">${item.count > 1 ? item.count : ''}</span>`;
        cell.title = `${def.name}\n${def.desc || ''}${def.attack ? `\n攻撃力 +${def.attack}` : ''}${def.defense ? `\n防御力 +${def.defense}` : ''}\n売値 ${def.value}`;
        cell.addEventListener('click', () => this.useItem(item.id));
      }
      grid.appendChild(cell);
    }

    $('eq-weapon').textContent = ITEMS[player.equipment.weapon]?.name || '素手';
    $('eq-armor').textContent = ITEMS[player.equipment.armor]?.name || 'なし';

    const stats = $('inv-stats');
    stats.innerHTML = `
      <div class="stat-row"><span>攻撃力</span><span>${Math.round(player.attackPower)}</span></div>
      <div class="stat-row"><span>防御力</span><span>${Math.round(player.defense)}</span></div>
      <div class="stat-row"><span>会心率</span><span>${Math.round(player.critChance * 100)}%</span></div>
      <div class="stat-row"><span>最大HP</span><span>${player.maxHp}</span></div>
      <div class="stat-row"><span>最大MP</span><span>${player.maxMp}</span></div>
      <div class="stat-row"><span>討伐数</span><span>${player.kills}</span></div>
    `;
  }

  useItem(id) {
    const def = ITEMS[id];
    const player = this.ctx.player;
    const inv = this.ctx.inventory;
    if (!def) return;
    if (def.type === 'weapon') {
      const old = player.equipment.weapon;
      player.equipment.weapon = id;
      if (old) inv.add(old, 1);
      inv.remove(id, 1);
      this.ctx.hud.notify(`${def.name}を装備した`, 'loot');
      this.ctx.audio?.play('pickup');
    } else if (def.type === 'armor') {
      const old = player.equipment.armor;
      player.equipment.armor = id;
      if (old) inv.add(old, 1);
      inv.remove(id, 1);
      this.ctx.hud.notify(`${def.name}を装備した`, 'loot');
      this.ctx.audio?.play('pickup');
    } else if (def.type === 'consumable') {
      if (def.heal) player.hp = Math.min(player.maxHp, player.hp + def.heal);
      if (def.mana) player.mp = Math.min(player.maxMp, player.mp + def.mana);
      inv.remove(id, 1);
      this.ctx.hud.notify(`${def.name}を使った`, 'heal');
      this.ctx.audio?.play('heal');
    } else {
      return;
    }
    this.renderInventory();
  }

  // ------------------------------------------------------------
  renderQuests() {
    const host = $('quest-list');
    const qm = this.ctx.questManager;
    host.innerHTML = '';
    const list = qm.activeQuests();
    if (!list.length) {
      host.innerHTML = '<p style="color:#a49a86;font-size:13px">受注中のクエストはない。村長に話しかけてみよう。</p>';
      return;
    }
    for (const { quest, state } of list) {
      const card = document.createElement('div');
      card.className = 'quest-card ' + (state.status === 'complete' ? 'done' : 'active');
      const objs = quest.objectives.map((o, i) => {
        const done = state.progress[i] >= o.count;
        return `<div class="quest-obj ${done ? 'done' : ''}"><span>${o.label}</span><span>${state.progress[i]} / ${o.count}</span></div>`;
      }).join('');
      const rw = quest.rewards || {};
      const rwText = [
        rw.xp ? `${rw.xp} EXP` : '',
        rw.gold ? `${rw.gold} ゴールド` : '',
        ...(rw.items || []).map(([id, n]) => `${ITEMS[id]?.name || id}×${n}`),
      ].filter(Boolean).join(' / ');
      card.innerHTML = `
        <h4>${quest.name}${state.status === 'complete' ? ' （報告可能）' : ''}</h4>
        <p>${quest.desc}</p>
        ${objs}
        <div class="quest-reward">報酬：${rwText}</div>
      `;
      host.appendChild(card);
    }
  }

  // ------------------------------------------------------------
  showDeath(player) {
    const p = this.panels.death;
    $('death-stats').innerHTML = `
      到達レベル <b style="color:#f4dc9a">${player.level}</b> ／ 討伐数 <b style="color:#f4dc9a">${player.kills}</b><br>
      所持金 ${Math.floor(player.gold)} ゴールドは半分になってしまう……
    `;
    p.classList.remove('hidden');
    this.ctx.input.exitLock();
  }

  hideDeath() { this.panels.death.classList.add('hidden'); }

  // ------------------------------------------------------------
  updatePauseStats(player) {
    const el = $('pause-stats');
    if (!el) return;
    el.innerHTML = `
      <div class="stat-row"><span>レベル</span><span>${player.level}</span></div>
      <div class="stat-row"><span>攻撃力</span><span>${Math.round(player.attackPower)}</span></div>
      <div class="stat-row"><span>防御力</span><span>${Math.round(player.defense)}</span></div>
      <div class="stat-row"><span>討伐数</span><span>${player.kills}</span></div>
      <div class="stat-row"><span>所持金</span><span>${Math.floor(player.gold)}</span></div>
      <div class="stat-row"><span>プレイ時間</span><span>${this.fmtTime(player.playtime)}</span></div>
    `;
  }

  fmtTime(s) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}時間${m}分` : `${m}分`;
  }
}
