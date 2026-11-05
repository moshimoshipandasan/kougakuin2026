// ============================================================
//  アヴァロン・クロニクル — 全体設定
// ============================================================

export const CONFIG = {
  world: {
    size: 460,          // 地形の一辺
    segments: 230,      // 分割数（頂点数 = (segments+1)^2）
    waterLevel: 0.0,
    seed: 20260214,
    trees: 1500,
    rocks: 520,
    grassCount: 26000,
    grassRadius: 95,
    flowers: 900,
  },

  render: {
    fov: 58,
    near: 0.15,
    far: 1400,
    maxPixelRatio: 1.75,
    shadowSize: 2048,
    shadowRadius: 95,
    bloom: { strength: 0.42, radius: 0.55, threshold: 0.86 },
    fogNear: 60,
    fogFar: 480,
  },

  player: {
    radius: 0.42,
    height: 1.78,
    walkSpeed: 6.2,
    runSpeed: 11.4,
    accel: 42,
    airAccel: 9,
    friction: 12,
    jumpSpeed: 9.4,
    gravity: 26,
    rollSpeed: 15,
    rollTime: 0.42,
    maxHp: 120,
    maxMp: 70,
    maxStamina: 100,
    staminaRegen: 18,
    runCost: 14,
    attackCost: 9,
    hpRegen: 0.55,
    mpRegen: 2.4,
    invulnTime: 0.55,
  },

  camera: {
    distance: 6.4,
    minDistance: 2.6,
    maxDistance: 13,
    height: 1.55,
    sensitivity: 0.0024,
    pitchMin: -0.62,
    pitchMax: 1.15,
    lag: 11,
  },

  combat: {
    attackRange: 3.0,
    attackArc: 2.05,     // ラジアン（片側）
    attackCooldown: 0.42,
    critChance: 0.14,
    critMult: 1.85,
    comboWindow: 1.1,
  },

  dayLength: 480,        // 1日の実時間（秒）
  startTime: 0.30,       // 0=深夜, 0.25=朝, 0.5=昼, 0.75=夜

  skills: [
    { id: 'slash',  name: '斬撃',    key: '1', icon: '🗡', mp: 0,  cd: 0.42, stamina: 9,  desc: '前方に剣を振るう' },
    { id: 'fire',   name: '火球',    key: '2', icon: '🔥', mp: 14, cd: 1.5,  stamina: 0,  desc: '炎の弾を放つ' },
    { id: 'heal',   name: '治癒',    key: '3', icon: '✨', mp: 26, cd: 9.0,  stamina: 0,  desc: 'HPを大きく回復する' },
    { id: 'whirl',  name: '旋風斬',  key: '4', icon: '🌀', mp: 20, cd: 5.0,  stamina: 22, desc: '周囲の敵を切り払う' },
    { id: 'guard',  name: '鉄壁',    key: '5', icon: '🛡', mp: 12, cd: 12.0, stamina: 0,  desc: '数秒間、被ダメージを激減させる' },
  ],

  xpTable: (lvl) => Math.floor(70 * Math.pow(lvl, 1.55) + 30 * lvl),

  saveKey: 'avalon-chronicle-save-v1',
};
