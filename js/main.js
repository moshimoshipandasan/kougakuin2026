// ============================================================
//  エントリポイント
// ============================================================

import { Game } from './game.js';

const canvas = document.getElementById('game');
const game = new Game(canvas);
window.game = game;

game.boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading-step');
  if (el) el.textContent = '起動に失敗しました: ' + err.message;
});

// セーブデータが古い形式なら警告
window.addEventListener('beforeunload', () => {
  // 自動セーブはしない（手動セーブのみ）
});
