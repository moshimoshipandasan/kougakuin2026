// ============================================================
//  アイテム定義と持ち物
// ============================================================

export const ITEMS = {
  // --- 武器 ---
  traveler_sword: { id: 'traveler_sword', name: '旅人の剣', icon: '🗡', type: 'weapon', attack: 8, value: 60, desc: '村の鍛冶屋が打った標準的な片手剣。' },
  iron_sword:     { id: 'iron_sword',     name: '鉄の長剣',   icon: '⚔', type: 'weapon', attack: 20, value: 260, desc: '分厚い鉄の刃。扱いには力が要る。' },
  silver_sword:   { id: 'silver_sword',   name: '銀の剣',     icon: '🗡', type: 'weapon', attack: 34, value: 780, desc: '魔物の血肉に強く反応する。' },
  avalon_blade:   { id: 'avalon_blade',   name: 'アヴァロンの聖剣', icon: '⚜', type: 'weapon', attack: 62, value: 2400, desc: '失われし大地の守護者が握っていた伝説の剣。' },

  // --- 防具 ---
  cloth_robe:     { id: 'cloth_robe',     name: '布の服',     icon: '👕', type: 'armor', defense: 4,  value: 40,  desc: '最低限の防寒着。' },
  leather_armor:  { id: 'leather_armor',  name: '革の鎧',     icon: '🥋', type: 'armor', defense: 14, value: 320, desc: '動きやすい獣皮の鎧。' },
  knight_armor:   { id: 'knight_armor',   name: '騎士の鎧',   icon: '🛡', type: 'armor', defense: 30, value: 980, desc: '重厚な板金鎧。' },
  dragon_armor:   { id: 'dragon_armor',   name: '竜鱗の鎧',   icon: '🐲', type: 'armor', defense: 48, value: 2200, desc: '竜の鱗を編み込んだ鎧。炎を防ぐ。' },

  // --- 消耗品 ---
  hp_potion:      { id: 'hp_potion', name: '回復薬', icon: '🧪', type: 'consumable', heal: 70, value: 30, stack: true, desc: 'HPを70回復する。' },
  mp_potion:      { id: 'mp_potion', name: '魔力の薬', icon: '🔵', type: 'consumable', mana: 50, value: 40, stack: true, desc: 'MPを50回復する。' },
  elixir:         { id: 'elixir',    name: 'エリクサー', icon: '⚗', type: 'consumable', heal: 9999, mana: 9999, value: 300, stack: true, desc: 'HPとMPを全回復する。' },

  // --- 素材 ---
  slime_gel:   { id: 'slime_gel',   name: 'スライムの粘液', icon: '🟢', type: 'material', value: 5,  desc: 'ぷるぷるしている。' },
  wolf_fang:   { id: 'wolf_fang',   name: '狼の牙',       icon: '🦷', type: 'material', value: 14, desc: '鋭い牙。武器の素材になる。' },
  bone_shard:  { id: 'bone_shard',  name: '骨の欠片',     icon: '🦴', type: 'material', value: 18, desc: '不気味に冷たい。' },
  iron_ore:    { id: 'iron_ore',    name: '鉄鉱石',       icon: '⛏', type: 'material', value: 16, desc: '鍛えれば良質な鉄になる。' },
  golem_core:  { id: 'golem_core',  name: 'ゴーレムの核', icon: '🔶', type: 'material', value: 90, desc: '今も微かに熱を帯びている。' },
  dragon_scale:{ id: 'dragon_scale',name: '竜の鱗',       icon: '🐉', type: 'material', value: 260, desc: '刃を寄せ付けない硬さ。' },
};

export class Inventory {
  constructor(capacity = 30) {
    this.slots = [];       // { id, count }
    this.capacity = capacity;
    this.gold = 0;
  }

  find(id) { return this.slots.find((s) => s.id === id); }
  count(id) { const s = this.find(id); return s ? s.count : 0; }

  add(id, n = 1) {
    if (!ITEMS[id]) return false;
    const s = this.find(id);
    const stackable = ITEMS[id].stack || ITEMS[id].type === 'material';
    if (s && stackable) { s.count += n; return true; }
    if (s && !stackable) { s.count += n; return true; }
    if (this.slots.length >= this.capacity) return false;
    this.slots.push({ id, count: n });
    return true;
  }

  remove(id, n = 1) {
    const i = this.slots.findIndex((s) => s.id === id);
    if (i < 0) return false;
    this.slots[i].count -= n;
    if (this.slots[i].count <= 0) this.slots.splice(i, 1);
    return true;
  }

  list() { return this.slots; }

  serialize() { return { slots: this.slots.map((s) => ({ ...s })), gold: this.gold }; }
  deserialize(d) {
    if (!d) return;
    this.slots = (d.slots || []).filter((s) => ITEMS[s.id]).map((s) => ({ ...s }));
    this.gold = d.gold || 0;
  }
}

/** ドロップテーブルから戦利品を決める */
export function rollLoot(type, rng, luck = 0) {
  const out = [];
  if (!type.drops) return out;
  for (const [id, chance, min, max] of type.drops) {
    if (rng.next() < chance + luck) {
      const n = rng.int(min, max);
      out.push({ id, count: n });
    }
  }
  return out;
}
