// ============================================================
//  クエスト
// ============================================================

export const QUESTS = [
  {
    id: 'q_slime', name: '村の脅威', giver: 'elder', minLevel: 1, next: 'q_wolf',
    desc: '村の周りにスライムが湧き始めた。あれを退治してくれぬか。',
    objectives: [{ type: 'kill', target: 'slime', count: 5, label: 'スライムを退治する' }],
    rewards: { xp: 140, gold: 90, items: [['hp_potion', 3]] },
  },
  {
    id: 'q_wolf', name: '森の牙', giver: 'elder', minLevel: 2, next: 'q_gather',
    desc: '森狼が旅人を襲っている。奴らを追い払ってくれ。',
    objectives: [{ type: 'kill', target: 'wolf', count: 6, label: '森狼を倒す' }],
    rewards: { xp: 260, gold: 180, items: [['leather_armor', 1], ['hp_potion', 3]] },
  },
  {
    id: 'q_gather', name: '鍛冶屋の依頼', giver: 'smith', minLevel: 3, next: 'q_skeleton',
    desc: '良い鉄が欲しい。狼の牙を集めてきてくれ。',
    objectives: [{ type: 'collect', target: 'wolf_fang', count: 4, label: '狼の牙を集める' }],
    rewards: { xp: 320, gold: 240, items: [['iron_sword', 1]] },
  },
  {
    id: 'q_skeleton', name: '眠れぬ死者', giver: 'elder', minLevel: 4, next: 'q_golem',
    desc: '夜になると墓所から骸骨が這い出てくる。安らかに眠らせてやってくれ。',
    objectives: [{ type: 'kill', target: 'skeleton', count: 8, label: '骸骨戦士を倒す' }],
    rewards: { xp: 620, gold: 420, items: [['knight_armor', 1], ['mp_potion', 4]] },
  },
  {
    id: 'q_golem', name: '大地の鼓動', giver: 'elder', minLevel: 8, next: 'q_dragon',
    desc: '山のふもとで岩の巨人が目覚めた。あれを止められるのは君しかおらん。',
    objectives: [{ type: 'kill', target: 'golem', count: 3, label: '岩のゴーレムを倒す' }],
    rewards: { xp: 1400, gold: 900, items: [['silver_sword', 1], ['elixir', 2]] },
  },
  {
    id: 'q_dragon', name: '失われし大地', giver: 'elder', minLevel: 12,
    desc: '……ついに古代竜ヴァルガが目覚めた。この地の命運は君に託された。',
    objectives: [{ type: 'kill', target: 'dragon', count: 1, label: '古代竜ヴァルガを討伐する' }],
    rewards: { xp: 6000, gold: 3000, items: [['dragon_armor', 1], ['elixir', 3]] },
    final: true,
  },
];

export class QuestManager {
  constructor(ctx) {
    this.ctx = ctx;
    this.states = new Map();  // id -> { status, progress[] }
    this.tracked = null;
    for (const q of QUESTS) {
      this.states.set(q.id, { status: 'locked', progress: q.objectives.map(() => 0) });
    }
  }

  get(id) { return QUESTS.find((q) => q.id === id); }
  state(id) { return this.states.get(id); }
  status(id) { return this.states.get(id)?.status; }

  /** 前提条件を満たしたクエストを解放 */
  refreshAvailability() {
    const lvl = this.ctx.player.level;
    for (const q of QUESTS) {
      const st = this.states.get(q.id);
      if (st.status !== 'locked') continue;
      const prev = QUESTS.find((x) => x.next === q.id);
      const prevDone = !prev || this.states.get(prev.id).status === 'turnedin';
      if (prevDone && lvl >= (q.minLevel || 1)) st.status = 'available';
    }
  }

  /** そのNPCが受けられるクエスト */
  availableFor(giver) {
    this.refreshAvailability();
    const out = [];
    for (const q of QUESTS) {
      const st = this.states.get(q.id);
      if (st.status === 'available' && q.giver === giver) out.push(q);
    }
    return out;
  }

  /** 完了報告できるクエスト */
  turnInFor(giver) {
    const out = [];
    for (const q of QUESTS) {
      const st = this.states.get(q.id);
      if (st.status === 'complete' && q.giver === giver) out.push(q);
    }
    return out;
  }

  activeQuests() {
    const out = [];
    for (const q of QUESTS) {
      const st = this.states.get(q.id);
      if (st.status === 'active' || st.status === 'complete') out.push({ quest: q, state: st });
    }
    return out;
  }

  start(id) {
    const q = this.get(id);
    const st = this.states.get(id);
    if (!q || st.status !== 'available') return false;
    st.status = 'active';
    if (!this.tracked) this.tracked = id;
    this.ctx.hud?.notify(`クエスト受注：${q.name}`, 'quest', 4200);
    this.ctx.audio?.play('quest');
    this.ctx.hud?.updateQuestTracker();
    return true;
  }

  /** 進捗を進める（kill / collect 以外も） */
  progress(type, target, amount = 1) {
    let changed = false;
    for (const q of QUESTS) {
      const st = this.states.get(q.id);
      if (st.status !== 'active') continue;
      q.objectives.forEach((o, i) => {
        if (o.type !== type || o.target !== target) return;
        const before = st.progress[i];
        st.progress[i] = Math.min(o.count, st.progress[i] + amount);
        if (st.progress[i] !== before) changed = true;
      });
      if (this.isComplete(q, st)) {
        st.status = 'complete';
        this.ctx.hud?.notify(`クエスト達成：${q.name} — 報告しよう`, 'quest', 5000);
        this.ctx.audio?.play('quest');
      }
    }
    if (changed) this.ctx.hud?.updateQuestTracker();
    return changed;
  }

  /** 収集クエストは所持数を直接見る */
  syncCollect() {
    const inv = this.ctx.inventory;
    let changed = false;
    for (const q of QUESTS) {
      const st = this.states.get(q.id);
      if (st.status !== 'active') continue;
      q.objectives.forEach((o, i) => {
        if (o.type !== 'collect') return;
        const c = Math.min(o.count, inv.count(o.target));
        if (c !== st.progress[i]) { st.progress[i] = c; changed = true; }
      });
      if (this.isComplete(q, st)) {
        st.status = 'complete';
        this.ctx.hud?.notify(`クエスト達成：${q.name} — 報告しよう`, 'quest', 5000);
        this.ctx.audio?.play('quest');
      }
    }
    if (changed) this.ctx.hud?.updateQuestTracker();
    return changed;
  }

  isComplete(q, st) {
    return q.objectives.every((o, i) => st.progress[i] >= o.count);
  }

  turnIn(id) {
    const q = this.get(id);
    const st = this.states.get(id);
    if (!q || st.status !== 'complete') return false;

    const r = q.rewards || {};
    if (r.xp) this.ctx.player.gainXp(r.xp);
    if (r.gold) { this.ctx.player.gainGold(r.gold); this.ctx.inventory.gold += r.gold; }
    if (r.items) {
      for (const [itemId, n] of r.items) {
        this.ctx.inventory.add(itemId, n);
        this.ctx.hud?.notify(`入手：${this.ctx.itemName(itemId)} ×${n}`, 'loot', 3600);
      }
    }
    // 収集クエストのアイテムを消費
    for (const o of q.objectives) {
      if (o.type === 'collect') this.ctx.inventory.remove(o.target, o.count);
    }
    st.status = 'turnedin';
    this.ctx.audio?.play('levelup');
    this.ctx.hud?.notify(`クエスト完了：${q.name}`, 'quest', 5000);
    this.ctx.onQuestTurnIn?.(q);
    if (this.tracked === id) this.tracked = null;
    this.ctx.hud?.updateQuestTracker();
    return true;
  }

  trackedQuest() {
    const list = this.activeQuests();
    if (!list.length) return null;
    if (this.tracked) {
      const f = list.find((x) => x.quest.id === this.tracked);
      if (f) return f;
    }
    return list[0];
  }

  serialize() {
    const out = {};
    for (const [k, v] of this.states) out[k] = { status: v.status, progress: [...v.progress] };
    return { states: out, tracked: this.tracked };
  }

  deserialize(d) {
    if (!d) return;
    for (const [k, v] of Object.entries(d.states || {})) {
      const st = this.states.get(k);
      if (st) { st.status = v.status; st.progress = [...v.progress]; }
    }
    this.tracked = d.tracked || null;
  }
}
