// ============================================================
//  NPC
// ============================================================

import * as THREE from 'three';
import { damp, angleDamp } from './utils.js';
import { buildHumanoid } from './character.js';

const _v = new THREE.Vector3();

export const NPC_DEFS = {
  elder: {
    name: '村長エルダ', face: '🧙', icon: '!',
    look: { skin: 0xd8a878, hair: 0xd8d4c8, cloth: 0x6a5a8a, cloth2: 0x3a3050, leather: 0x5a4a30, metal: 0xb0a878, cape: true, cloakColor: 0x4a3a6a },
    pos: [2.5, 9.5], rot: Math.PI,
  },
  smith: {
    name: '鍛冶屋ガルド', face: '🧔', icon: '?',
    look: { skin: 0xc08a5a, hair: 0x2a1a10, cloth: 0x8a4a2a, cloth2: 0x3a2a1a, leather: 0x4a3a2a, metal: 0xc8c0b0 },
    pos: [-5.0, 4.0], rot: Math.PI * 0.6,
  },
  guard: {
    name: '衛兵ロルフ', face: '💂', icon: '',
    look: { skin: 0xd8a878, hair: 0x5a4a2a, cloth: 0x4a5a7a, cloth2: 0x2a3244, leather: 0x5a4a30, metal: 0xc0c8d0 },
    pos: [-2.0, 17.0], rot: 0,
  },
  villager: {
    name: '村人ミア', face: '👧', icon: '',
    look: { skin: 0xe8b888, hair: 0x8a5a2a, cloth: 0xa85a6a, cloth2: 0x6a3a44, leather: 0x6a4a30, metal: 0xb0b0b0 },
    pos: [-8.5, 12.0], rot: Math.PI * 0.2,
  },
};

export class NPC {
  constructor(key, ctx, override = {}) {
    this.key = key;
    this.ctx = ctx;
    const def = NPC_DEFS[key] || NPC_DEFS.villager;
    this.def = def;
    this.name = override.name || def.name;
    this.face = def.face;
    this.giver = key;
    this.dead = false;
    this.talking = false;
    this.bobT = Math.random() * 10;

    const model = buildHumanoid({ ...def.look, scale: 1 });
    this.model = model;
    this.group = model.group;

    const [ox, oz] = override.pos || def.pos;
    const x = ox + (override.dx || 0);
    const z = oz + (override.dz || 0);
    this.position = new THREE.Vector3(x, ctx.world.getHeight(x, z), z);
    this.facing = override.rot ?? def.rot ?? 0;
    this.group.position.copy(this.position);
    this.group.rotation.y = this.facing;
    ctx.scene.add(this.group);

    // 頭上マーカー
    this.marker = this._makeMarker(def.icon);
    this.marker.position.set(0, 2.25, 0);
    this.group.add(this.marker);

    // 名前ラベル
    this.label = this._makeLabel(this.name);
    this.label.position.set(0, 1.95, 0);
    this.group.add(this.label);
  }

  _makeMarker(icon) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    ctx.font = 'bold 46px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 8;
    ctx.fillStyle = icon === '!' ? '#ffd94a' : '#7fc8ff';
    ctx.fillText(icon || '?', 32, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
    const s = new THREE.Sprite(mat);
    s.scale.set(0.42, 0.42, 1);
    s.visible = !!icon;
    s.renderOrder = 20;
    return s;
  }

  _makeLabel(text) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const ctx = c.getContext('2d');
    ctx.font = 'bold 30px "Noto Sans JP", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#f0e6cc';
    ctx.fillText(text, 128, 34);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, opacity: 0.9 });
    const s = new THREE.Sprite(mat);
    s.scale.set(1.9, 0.48, 1);
    s.renderOrder = 21;
    return s;
  }

  setMarker(icon) {
    if (this._markerIcon === icon) return;
    this._markerIcon = icon;
    this.marker.material.map.dispose();
    this.marker.material.dispose();
    const m = this._makeMarker(icon);
    this.marker.material = m.material;
    this.marker.visible = !!icon;
  }

  get eyePosition() { return _v.set(this.position.x, this.position.y + 1.6, this.position.z); }

  update(dt, player) {
    this.bobT += dt;
    const d = Math.hypot(player.position.x - this.position.x, player.position.z - this.position.z);

    // プレイヤーが近いとこちらを向く
    if (d < 7 && !this.talking) {
      const want = Math.atan2(player.position.x - this.position.x, player.position.z - this.position.z);
      this.facing = angleDamp(this.facing, want, 3, dt);
    } else if (this.talking) {
      const want = Math.atan2(player.position.x - this.position.x, player.position.z - this.position.z);
      this.facing = angleDamp(this.facing, want, 6, dt);
    } else {
      this.facing = angleDamp(this.facing, this.def.rot ?? 0, 1.5, dt);
    }
    this.group.rotation.y = this.facing;
    this.model.update(dt, { speed: 0, dead: false });

    // マーカーの浮遊
    this.marker.position.y = 2.25 + Math.sin(this.bobT * 2.2) * 0.08;
    if (this.marker.material) {
      this.marker.material.opacity = 0.75 + Math.sin(this.bobT * 3.4) * 0.25;
    }
    this.label.visible = d < 12;
    if (this.label.material) this.label.material.opacity = damp(this.label.material.opacity, d < 12 ? 0.9 : 0, 6, dt);
  }

  dispose() {
    this.ctx.scene.remove(this.group);
  }
}
