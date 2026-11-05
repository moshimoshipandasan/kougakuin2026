// ============================================================
//  キャラクターモデル（プリミティブ合成 + 手続きアニメーション）
// ============================================================

import * as THREE from 'three';
import { clamp, lerp, damp, angleDamp } from './utils.js';

function M(geo, mat, cast = true, recv = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = recv;
  return m;
}

function P(parent, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

function stdMat(color, roughness = 0.8, metalness = 0.0, extra = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
}

// ============================================================
//  人型リグ
// ============================================================
export function buildHumanoid(opt = {}) {
  const {
    skin = 0xd9a066, hair = 0x35241a, cloth = 0x46577f, cloth2 = 0x2a3350,
    leather = 0x5a3d24, metal = 0xb9c0c8, scale = 1, slim = 1,
    cape = false, cloakColor = 0x7a2230, horns = false,
  } = opt;

  const matSkin = stdMat(skin, 0.7, 0.02);
  const matCloth = stdMat(cloth, 0.88);
  const matCloth2 = stdMat(cloth2, 0.9);
  const matLeather = stdMat(leather, 0.78);
  const matHair = stdMat(hair, 0.88);
  const matMetal = stdMat(metal, 0.3, 0.85);
  const mats = [matSkin, matCloth, matCloth2, matLeather, matHair, matMetal];

  const root = new THREE.Group();
  const body = P(root, 0, 0.94, 0);
  body.scale.setScalar(scale);

  // --- 骨盤 ---
  const hips = M(new THREE.BoxGeometry(0.30 * slim, 0.20, 0.20), matCloth2);
  hips.position.y = 0.02;
  body.add(hips);

  // --- 胴 ---
  const torso = P(body, 0, 0.10, 0);
  const chest = M(new THREE.CapsuleGeometry(0.165 * slim, 0.26, 4, 10), matCloth);
  chest.position.y = 0.20;
  chest.scale.z = 0.72;
  torso.add(chest);
  const belt = M(new THREE.TorusGeometry(0.165 * slim, 0.032, 6, 12), matLeather);
  belt.rotation.x = Math.PI / 2;
  belt.position.y = 0.03;
  torso.add(belt);

  // 肩当て
  const pauldron = M(new THREE.SphereGeometry(0.11, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.6), matMetal);
  pauldron.position.set(-0.19 * slim, 0.40, 0);
  pauldron.scale.set(1, 0.8, 1);
  torso.add(pauldron);

  // --- 首・頭 ---
  const neck = P(torso, 0, 0.42, 0);
  neck.add(M(new THREE.CylinderGeometry(0.055, 0.06, 0.09, 8), matSkin));
  const head = P(neck, 0, 0.06, 0);
  const skull = M(new THREE.SphereGeometry(0.125, 16, 14), matSkin);
  skull.position.y = 0.10;
  skull.scale.set(0.94, 1.06, 0.96);
  head.add(skull);
  const hairMesh = M(new THREE.SphereGeometry(0.132, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), matHair);
  hairMesh.position.y = 0.105;
  hairMesh.scale.set(1, 0.95, 1.02);
  head.add(hairMesh);
  // 目
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1a2230 });
  for (const s of [-1, 1]) {
    const eye = M(new THREE.SphereGeometry(0.022, 8, 8), eyeMat, false, false);
    eye.position.set(0.045 * s, 0.10, 0.112);
    head.add(eye);
  }
  if (horns) {
    const hornMat = stdMat(0x2a2620, 0.6);
    for (const s of [-1, 1]) {
      const horn = M(new THREE.ConeGeometry(0.035, 0.22, 6), hornMat);
      horn.position.set(0.085 * s, 0.20, -0.01);
      horn.rotation.z = 0.5 * s;
      horn.rotation.x = -0.25;
      head.add(horn);
    }
  }

  // --- 腕 ---
  const arms = {};
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? -1 : 1;
    const shoulder = P(torso, 0.20 * slim * s, 0.38, 0);
    const upper = M(new THREE.CapsuleGeometry(0.062, 0.20, 4, 8), matSkin);
    upper.position.y = -0.12;
    shoulder.add(upper);
    const elbow = P(shoulder, 0, -0.26, 0);
    const fore = M(new THREE.CapsuleGeometry(0.055, 0.19, 4, 8), matSkin);
    fore.position.y = -0.11;
    elbow.add(fore);
    const hand = P(elbow, 0, -0.24, 0);
    const palm = M(new THREE.BoxGeometry(0.075, 0.09, 0.05), matSkin);
    hand.add(palm);
    arms[side] = { shoulder, elbow, hand };
  }

  // --- 脚 ---
  const legs = {};
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? -1 : 1;
    const hip = P(body, 0.095 * s, -0.02, 0);
    const thigh = M(new THREE.CapsuleGeometry(0.085, 0.26, 4, 8), matCloth2);
    thigh.position.y = -0.16;
    hip.add(thigh);
    const knee = P(hip, 0, -0.40, 0);
    const shin = M(new THREE.CapsuleGeometry(0.068, 0.28, 4, 8), matCloth2);
    shin.position.y = -0.16;
    knee.add(shin);
    const ankle = P(knee, 0, -0.38, 0);
    const foot = M(new THREE.BoxGeometry(0.10, 0.07, 0.22), matLeather);
    foot.position.set(0, -0.03, 0.05);
    ankle.add(foot);
    legs[side] = { hip, knee, ankle };
  }

  // --- マント ---
  let cloak = null;
  if (cape) {
    const cloakMat = stdMat(cloakColor, 0.92, 0, { side: THREE.DoubleSide });
    mats.push(cloakMat);
    cloak = P(torso, 0, 0.40, -0.10);
    const cloth1 = M(new THREE.PlaneGeometry(0.46, 0.95, 4, 8), cloakMat, true, false);
    cloth1.position.y = -0.45;
    cloth1.rotation.x = 0.12;
    cloak.add(cloth1);
    cloak.userData.mesh = cloth1;
    cloak.userData.base = cloth1.geometry.attributes.position.array.slice();
  }

  // --- 武器（右手） ---
  const weapon = P(arms.R.hand, 0, -0.05, 0.02);
  const bladeMat = stdMat(0xd7dde4, 0.22, 0.92);
  const hiltMat = stdMat(0x4a3320, 0.75);
  const guardMat = stdMat(0xc9a44a, 0.35, 0.85);
  mats.push(bladeMat, hiltMat, guardMat);
  const blade = M(new THREE.BoxGeometry(0.055, 0.86, 0.012), bladeMat);
  blade.position.y = 0.48;
  blade.geometry.translate(0, 0, 0);
  weapon.add(blade);
  const tip = M(new THREE.ConeGeometry(0.032, 0.12, 4), bladeMat);
  tip.position.y = 0.96;
  tip.rotation.y = Math.PI / 4;
  weapon.add(tip);
  const guard = M(new THREE.BoxGeometry(0.20, 0.035, 0.05), guardMat);
  weapon.add(guard);
  const hilt = M(new THREE.CylinderGeometry(0.022, 0.026, 0.16, 8), hiltMat);
  hilt.position.y = -0.10;
  weapon.add(hilt);
  const pommel = M(new THREE.SphereGeometry(0.032, 8, 8), guardMat);
  pommel.position.y = -0.19;
  weapon.add(pommel);
  weapon.rotation.x = Math.PI * 0.5; // 構え

  // --- 左腕の盾 ---
  const shieldMat = stdMat(0x5a3d24, 0.6, 0.1);
  const shieldRim = stdMat(0xa8a49a, 0.35, 0.8);
  mats.push(shieldMat, shieldRim);
  const shield = P(arms.L.hand, 0, -0.08, 0.04);
  const sPlate = M(new THREE.CylinderGeometry(0.26, 0.26, 0.045, 14), shieldMat);
  sPlate.rotation.x = Math.PI / 2;
  shield.add(sPlate);
  const sRim = M(new THREE.TorusGeometry(0.26, 0.028, 6, 16), shieldRim);
  shield.add(sRim);
  const sBoss = M(new THREE.SphereGeometry(0.07, 10, 8), shieldRim);
  sBoss.position.z = 0.04;
  shield.add(sBoss);
  shield.visible = false;

  root.traverse((o) => { o.frustumCulled = false; });

  // ------------------------------------------------------------
  const state = {
    t: Math.random() * 10,
    phase: 0,
    armX: 0,
    lean: 0,
    deadT: 0,
    dead: false,
    visibleShield: false,
  };

  function update(dt, o = {}) {
    const speed = o.speed ?? 0;
    const moving = speed > 0.2;
    const run = speed > 6.4;
    const attacking = o.attackPhase != null && o.attackPhase >= 0 && o.attackPhase <= 1;
    const casting = o.castPhase != null && o.castPhase >= 0 && o.castPhase <= 1;
    const blocking = !!o.blocking;

    state.t += dt;
    const t = state.t;

    if (o.dead) {
      state.dead = true;
      state.deadT = Math.min(1, state.deadT + dt * 1.6);
      const k = state.deadT;
      root.rotation.x = -k * Math.PI * 0.48;
      root.position.y = -0.15 * k;
      torso.rotation.x = damp(torso.rotation.x, -0.3 * k, 6, dt);
      arms.L.shoulder.rotation.x = damp(arms.L.shoulder.rotation.x, 0.9 * k, 6, dt);
      arms.R.shoulder.rotation.x = damp(arms.R.shoulder.rotation.x, 0.9 * k, 6, dt);
      arms.L.shoulder.rotation.z = damp(arms.L.shoulder.rotation.z, -0.5 * k, 6, dt);
      arms.R.shoulder.rotation.z = damp(arms.R.shoulder.rotation.z, 0.5 * k, 6, dt);
      legs.L.hip.rotation.x = damp(legs.L.hip.rotation.x, -0.3 * k, 6, dt);
      legs.R.hip.rotation.x = damp(legs.R.hip.rotation.x, -0.3 * k, 6, dt);
      return;
    }

    const stride = run ? 1.0 : 0.62;
    const cadence = run ? 9.2 : 6.2;
    const amp = clamp(speed / 5.5, 0, 1.5);
    if (moving) state.phase += dt * cadence * clamp(0.4 + speed / 6, 0.4, 1.8);
    else state.phase += dt * 1.2;

    const sw = Math.sin(state.phase);
    const sw2 = Math.sin(state.phase * 2);

    // 脚
    const legAmp = moving ? stride * amp * 0.85 : 0;
    legs.L.hip.rotation.x = damp(legs.L.hip.rotation.x, sw * legAmp, 14, dt);
    legs.R.hip.rotation.x = damp(legs.R.hip.rotation.x, -sw * legAmp, 14, dt);
    legs.L.knee.rotation.x = damp(legs.L.knee.rotation.x, Math.max(0, -sw) * legAmp * 1.1 + 0.06, 14, dt);
    legs.R.knee.rotation.x = damp(legs.R.knee.rotation.x, Math.max(0, sw) * legAmp * 1.1 + 0.06, 14, dt);

    // 胴の揺れ
    const bob = moving ? Math.abs(sw2) * 0.045 * amp : Math.sin(t * 1.5) * 0.012;
    body.position.y = 0.94 + bob;
    torso.rotation.y = damp(torso.rotation.y, moving ? sw * 0.10 * amp : Math.sin(t * 0.7) * 0.03, 8, dt);
    state.lean = damp(state.lean, run ? 0.20 : (moving ? 0.08 : 0), 8, dt);
    torso.rotation.x = state.lean;
    torso.rotation.z = damp(torso.rotation.z, moving ? -sw * 0.05 : 0, 8, dt);

    // 腕
    let targetRA = moving ? -sw * stride * amp * 0.75 : Math.sin(t * 1.4) * 0.06 + 0.05;
    let targetLA = moving ? sw * stride * amp * 0.6 : Math.sin(t * 1.4 + 1) * 0.06 + 0.05;
    let targetRZ = -0.10;
    let targetLZ = 0.10;
    let targetRE = -0.25;

    if (attacking) {
      const p = o.attackPhase;
      // 振りかぶり → 振り下ろし → 戻し
      let swing;
      if (p < 0.28) swing = lerp(-0.2, -2.35, p / 0.28);
      else if (p < 0.52) swing = lerp(-2.35, 1.35, (p - 0.28) / 0.24);
      else swing = lerp(1.35, -0.2, (p - 0.52) / 0.48);
      targetRA = swing;
      targetRZ = -0.55 + Math.sin(p * Math.PI) * 0.5;
      targetRE = -0.15 - Math.sin(p * Math.PI) * 0.5;
      targetLA = -0.3 - Math.sin(p * Math.PI) * 0.3;
      targetLZ = 0.35;
    } else if (casting) {
      const p = o.castPhase;
      const raise = Math.sin(Math.min(1, p * 1.5) * Math.PI);
      targetRA = -1.5 * raise - 0.2;
      targetLA = -1.5 * raise - 0.2;
      targetRZ = -0.5 * raise;
      targetLZ = 0.5 * raise;
    } else if (blocking) {
      targetLA = -1.0;
      targetRA = -0.5;
      targetLZ = 0.55;
    }

    arms.R.shoulder.rotation.x = damp(arms.R.shoulder.rotation.x, targetRA, attacking ? 30 : 12, dt);
    arms.L.shoulder.rotation.x = damp(arms.L.shoulder.rotation.x, targetLA, 12, dt);
    arms.R.shoulder.rotation.z = damp(arms.R.shoulder.rotation.z, targetRZ, 12, dt);
    arms.L.shoulder.rotation.z = damp(arms.L.shoulder.rotation.z, targetLZ, 12, dt);
    arms.R.elbow.rotation.x = damp(arms.R.elbow.rotation.x, targetRE, 12, dt);
    arms.L.elbow.rotation.x = damp(arms.L.elbow.rotation.x, blocking ? -1.2 : -0.3, 12, dt);

    // 盾の表示
    if (state.visibleShield !== blocking) {
      shield.visible = blocking;
      state.visibleShield = blocking;
    }

    // マント
    if (cloak) {
      const mesh = cloak.userData.mesh;
      const arr = mesh.geometry.attributes.position.array;
      const base = cloak.userData.base;
      for (let i = 0; i < arr.length; i += 3) {
        const by = base[i + 1];
        const w = clamp((-by) / 0.95, 0, 1);
        const wind = Math.sin(t * 3.0 + by * 4.0) * 0.06 * w;
        arr[i] = base[i] + wind * 1.4 + state.lean * w * 0.55;
        arr[i + 2] = base[i + 2] - w * (0.18 + (moving ? 0.42 : 0.05) * amp) - Math.abs(wind) * 0.4;
        arr[i + 1] = by + Math.abs(wind) * 0.2;
      }
      mesh.geometry.attributes.position.needsUpdate = true;
    }

    // 呼吸
    const breath = 1 + Math.sin(t * 1.8) * 0.012;
    chest.scale.set(1, breath, 0.72);
  }

  return { group: root, parts: { body, torso, head, neck, arms, legs, weapon, shield, cloak }, update, materials: mats };
}

// ============================================================
//  スライム
// ============================================================
export function buildSlime(color = 0x66dd88) {
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color, roughness: 0.25, metalness: 0.0, transparent: true, opacity: 0.86,
  });
  const innerMat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, emissive: color, emissiveIntensity: 0.25 });
  const body = M(new THREE.SphereGeometry(0.55, 20, 16), mat);
  body.position.y = 0.5;
  body.scale.set(1, 0.85, 1);
  root.add(body);
  const core = M(new THREE.SphereGeometry(0.24, 12, 10), innerMat, false, false);
  core.position.y = 0.42;
  root.add(core);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x0b1018 });
  const eyes = [];
  for (const s of [-1, 1]) {
    const e = M(new THREE.SphereGeometry(0.085, 10, 10), eyeMat, false, false);
    e.position.set(0.18 * s, 0.68, 0.44);
    root.add(e);
    eyes.push(e);
  }
  root.traverse((o) => { o.frustumCulled = false; });
  let t = Math.random() * 10;
  let sq = 0;
  function update(dt, o = {}) {
    t += dt;
    const hop = o.moving ? Math.abs(Math.sin(t * 4.2)) : 0;
    const targetSq = o.moving ? 0.18 + hop * 0.32 : 0.06 + Math.sin(t * 1.6) * 0.05;
    sq = damp(sq, targetSq, 10, dt);
    body.scale.set(1 + sq * 0.5, 0.85 - sq * 0.5, 1 + sq * 0.5);
    body.position.y = 0.5 - sq * 0.1 + (o.moving ? hop * 0.18 : 0);
    core.position.y = body.position.y - 0.08;
    for (let i = 0; i < eyes.length; i++) {
      const s = i === 0 ? -1 : 1;
      eyes[i].position.set(0.18 * s * (1 + sq * 0.3), body.position.y + 0.18, 0.44 * (1 + sq * 0.2));
    }
    if (o.dead) {
      root.scale.y = damp(root.scale.y, 0.06, 4, dt);
      root.scale.x = root.scale.z = damp(root.scale.x, 1.6, 4, dt);
      mat.opacity = damp(mat.opacity, 0, 1.6, dt);
    }
  }
  return { group: root, parts: { body, core }, update };
}

// ============================================================
//  狼
// ============================================================
export function buildWolf(color = 0x4a4038) {
  const root = new THREE.Group();
  const fur = stdMat(color, 0.92);
  const fur2 = stdMat(new THREE.Color(color).offsetHSL(0, 0, -0.12), 0.95);
  const dark = stdMat(0x14120f, 0.9);
  const body = new THREE.Group();
  body.position.y = 0.72;
  root.add(body);

  const torso = M(new THREE.CapsuleGeometry(0.27, 0.72, 5, 10), fur);
  torso.rotation.z = Math.PI / 2;
  body.add(torso);
  const chestM = M(new THREE.SphereGeometry(0.30, 12, 10), fur);
  chestM.position.set(0, 0.05, 0.42);
  body.add(chestM);

  const neck = P(body, 0, 0.14, 0.62);
  neck.rotation.x = -0.35;
  neck.add(M(new THREE.CapsuleGeometry(0.14, 0.24, 4, 8), fur2));
  const head = P(neck, 0, 0.26, 0.02);
  const skull = M(new THREE.BoxGeometry(0.26, 0.24, 0.34), fur);
  head.add(skull);
  const snout = M(new THREE.BoxGeometry(0.14, 0.13, 0.24), fur2);
  snout.position.set(0, -0.03, 0.26);
  head.add(snout);
  const nose = M(new THREE.SphereGeometry(0.045, 8, 8), dark, false, false);
  nose.position.set(0, -0.03, 0.39);
  head.add(nose);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffcc33 });
  const eyes = [];
  for (const s of [-1, 1]) {
    const e = M(new THREE.SphereGeometry(0.042, 8, 8), eyeMat, false, false);
    e.position.set(0.085 * s, 0.05, 0.16);
    head.add(e);
    eyes.push(e);
  }
  const ears = [];
  for (const s of [-1, 1]) {
    const ear = M(new THREE.ConeGeometry(0.07, 0.16, 5), fur2);
    ear.position.set(0.09 * s, 0.16, 0.02);
    ear.rotation.z = 0.2 * s;
    head.add(ear);
    ears.push(ear);
  }
  const tail = P(body, 0, 0.12, -0.62);
  tail.rotation.x = -0.9;
  const tailMesh = M(new THREE.CapsuleGeometry(0.075, 0.5, 4, 8), fur2);
  tailMesh.position.y = -0.25;
  tail.add(tailMesh);

  const legs = [];
  const legPos = [[-0.19, 0.34], [0.19, 0.34], [-0.19, -0.34], [0.19, -0.34]];
  for (const [x, z] of legPos) {
    const hip = P(body, x, -0.16, z);
    const up = M(new THREE.CapsuleGeometry(0.085, 0.24, 4, 8), fur);
    up.position.y = -0.14;
    hip.add(up);
    const knee = P(hip, 0, -0.30, 0);
    const lo = M(new THREE.CapsuleGeometry(0.065, 0.22, 4, 8), fur2);
    lo.position.y = -0.13;
    knee.add(lo);
    const paw = M(new THREE.BoxGeometry(0.11, 0.07, 0.17), dark);
    paw.position.set(0, -0.28, 0.02);
    knee.add(paw);
    legs.push({ hip, knee, phase: z > 0 ? 0 : Math.PI });
  }

  root.traverse((o) => { o.frustumCulled = false; });
  let t = Math.random() * 10;
  function update(dt, o = {}) {
    t += dt;
    const speed = o.speed ?? 0;
    const moving = speed > 0.3;
    const run = speed > 5;
    const cadence = run ? 12 : 7.5;
    if (moving) t += dt * cadence * 0.5;
    const amp = clamp(speed / 6, 0, 1.3) * (run ? 1.0 : 0.7);
    for (let i = 0; i < legs.length; i++) {
      const ph = t + (i % 2 === 0 ? 0 : Math.PI) + (i < 2 ? 0 : 0.5);
      legs[i].hip.rotation.x = damp(legs[i].hip.rotation.x, Math.sin(ph) * amp * 0.85, 16, dt);
      legs[i].knee.rotation.x = damp(legs[i].knee.rotation.x, Math.max(0, Math.sin(ph + 1)) * amp * 0.9, 16, dt);
    }
    body.position.y = 0.72 + (moving ? Math.abs(Math.sin(t * 2)) * 0.06 * amp : Math.sin(t * 1.4) * 0.015);
    body.rotation.x = damp(body.rotation.x, moving ? -0.06 * amp : 0, 6, dt);
    tail.rotation.z = Math.sin(t * 3.4) * 0.25;
    tail.rotation.x = -0.9 + (moving ? -0.35 : Math.sin(t * 1.2) * 0.1);
    head.rotation.x = damp(head.rotation.x, o.aggro ? -0.05 : 0.05, 6, dt);
    const mouth = o.attacking ? 1 : 0;
    snout.rotation.x = damp(snout.rotation.x, mouth * 0.22, 20, dt);
    for (let i = 0; i < eyes.length; i++) {
      eyes[i].material.color.setHex(o.aggro ? 0xff4422 : 0xffcc33);
    }
    if (o.dead) {
      root.rotation.z = damp(root.rotation.z, Math.PI * 0.42, 3.2, dt);
      root.position.y = damp(root.position.y, -0.25, 3, dt);
    }
  }
  return { group: root, parts: { body, head, tail, legs }, update };
}

// ============================================================
//  ゴーレム / 巨人
// ============================================================
export function buildGolem(color = 0x6b6a63, scale = 1) {
  const root = new THREE.Group();
  const rock = new THREE.MeshStandardMaterial({
    color, roughness: 0.95, metalness: 0.05, flatShading: true,
  });
  const glowMat = new THREE.MeshStandardMaterial({ color: 0x2a1a08, emissive: 0xff7a22, emissiveIntensity: 1.6, roughness: 0.5 });

  const body = P(root, 0, 1.55 * scale, 0);
  body.scale.setScalar(scale);
  const torso = M(new THREE.BoxGeometry(1.0, 1.05, 0.62), rock);
  body.add(torso);
  const shoulderL = M(new THREE.IcosahedronGeometry(0.36, 0), rock);
  shoulderL.position.set(-0.62, 0.36, 0);
  body.add(shoulderL);
  const shoulderR = shoulderL.clone();
  shoulderR.position.x = 0.62;
  body.add(shoulderR);
  const core = M(new THREE.SphereGeometry(0.2, 12, 10), glowMat, false, false);
  core.position.set(0, 0.1, 0.33);
  body.add(core);

  const head = P(body, 0, 0.72, 0.02);
  head.add(M(new THREE.BoxGeometry(0.44, 0.4, 0.42), rock));
  const eye = M(new THREE.BoxGeometry(0.3, 0.06, 0.02), glowMat, false, false);
  eye.position.set(0, 0.02, 0.22);
  head.add(eye);

  const arms = {};
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? -1 : 1;
    const shoulder = P(body, 0.68 * s, 0.34, 0);
    const up = M(new THREE.CapsuleGeometry(0.17, 0.44, 4, 8), rock);
    up.position.y = -0.28;
    shoulder.add(up);
    const elbow = P(shoulder, 0, -0.56, 0);
    const fore = M(new THREE.CapsuleGeometry(0.16, 0.44, 4, 8), rock);
    fore.position.y = -0.28;
    elbow.add(fore);
    const fist = M(new THREE.IcosahedronGeometry(0.26, 0), rock);
    fist.position.y = -0.6;
    elbow.add(fist);
    arms[side] = { shoulder, elbow };
  }

  const legs = {};
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? -1 : 1;
    const hip = P(body, 0.26 * s, -0.5, 0);
    const th = M(new THREE.CapsuleGeometry(0.19, 0.4, 4, 8), rock);
    th.position.y = -0.28;
    hip.add(th);
    const knee = P(hip, 0, -0.56, 0);
    const sh = M(new THREE.CapsuleGeometry(0.17, 0.4, 4, 8), rock);
    sh.position.y = -0.26;
    knee.add(sh);
    const foot = M(new THREE.BoxGeometry(0.34, 0.18, 0.46), rock);
    foot.position.set(0, -0.52, 0.06);
    knee.add(foot);
    legs[side] = { hip, knee };
  }

  root.traverse((o) => { o.frustumCulled = false; });
  let t = Math.random() * 10;
  function update(dt, o = {}) {
    t += dt;
    const speed = o.speed ?? 0;
    const moving = speed > 0.3;
    const cadence = 3.4;
    if (moving) t += dt * cadence * 0.4;
    const amp = clamp(speed / 4, 0, 1) * 0.5;
    const sw = Math.sin(t * 2.0);
    legs.L.hip.rotation.x = damp(legs.L.hip.rotation.x, sw * amp, 8, dt);
    legs.R.hip.rotation.x = damp(legs.R.hip.rotation.x, -sw * amp, 8, dt);
    legs.L.knee.rotation.x = damp(legs.L.knee.rotation.x, Math.max(0, -sw) * amp * 0.8, 8, dt);
    legs.R.knee.rotation.x = damp(legs.R.knee.rotation.x, Math.max(0, sw) * amp * 0.8, 8, dt);
    body.position.y = 1.55 * scale + (moving ? Math.abs(Math.sin(t * 4)) * 0.07 : Math.sin(t * 1.1) * 0.02);
    body.rotation.z = moving ? sw * 0.05 : 0;

    let ra = moving ? -sw * 0.5 * amp : Math.sin(t * 1.2) * 0.05;
    let la = moving ? sw * 0.5 * amp : Math.sin(t * 1.2 + 1) * 0.05;
    if (o.attackPhase != null && o.attackPhase >= 0 && o.attackPhase <= 1) {
      const p = o.attackPhase;
      ra = p < 0.4 ? lerp(0, -2.2, p / 0.4) : lerp(-2.2, 1.0, (p - 0.4) / 0.6);
    }
    arms.R.shoulder.rotation.x = damp(arms.R.shoulder.rotation.x, ra, 10, dt);
    arms.L.shoulder.rotation.x = damp(arms.L.shoulder.rotation.x, la, 10, dt);
    arms.R.shoulder.rotation.z = -0.18;
    arms.L.shoulder.rotation.z = 0.18;
    glowMat.emissiveIntensity = 1.2 + Math.sin(t * 3.5) * 0.5 + (o.aggro ? 1.0 : 0);
    if (o.dead) {
      root.rotation.x = damp(root.rotation.x, -Math.PI * 0.45, 2.2, dt);
      root.position.y = damp(root.position.y, -0.6, 2.2, dt);
    }
  }
  return { group: root, parts: { body, head, arms, legs }, update };
}

// ============================================================
//  ドラゴン（ボス）
// ============================================================
export function buildDragon(color = 0x7a2b34, scale = 1) {
  const root = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.12, flatShading: true });
  const belly = new THREE.MeshStandardMaterial({ color: 0xc9a24a, roughness: 0.7, metalness: 0.15 });
  const membrane = new THREE.MeshStandardMaterial({
    color: 0x5a1c26, roughness: 0.85, side: THREE.DoubleSide, transparent: true, opacity: 0.92,
  });
  const glow = new THREE.MeshStandardMaterial({ color: 0x331000, emissive: 0xff6a10, emissiveIntensity: 2.2, roughness: 0.4 });

  const body = P(root, 0, 3.0 * scale, 0);
  body.scale.setScalar(scale);

  const torso = M(new THREE.CapsuleGeometry(1.05, 1.9, 6, 12), skin);
  torso.rotation.z = Math.PI / 2;
  body.add(torso);
  const chest = M(new THREE.SphereGeometry(1.15, 14, 12), skin);
  chest.position.set(0, 0.05, 1.15);
  body.add(chest);
  const bellyM = M(new THREE.CapsuleGeometry(0.72, 1.7, 5, 10), belly);
  bellyM.rotation.z = Math.PI / 2;
  bellyM.position.y = -0.55;
  body.add(bellyM);

  // 首・頭
  const neck = P(body, 0, 0.35, 1.85);
  neck.rotation.x = -0.55;
  const neckM = M(new THREE.CapsuleGeometry(0.42, 1.4, 5, 10), skin);
  neckM.position.y = 0.7;
  neck.add(neckM);
  const head = P(neck, 0, 1.5, 0);
  const skull = M(new THREE.BoxGeometry(0.8, 0.62, 1.25), skin);
  head.add(skull);
  const jaw = P(head, 0, -0.28, 0.25);
  const jawM = M(new THREE.BoxGeometry(0.66, 0.24, 1.0), skin);
  jawM.position.z = 0.35;
  jaw.add(jawM);
  const mouthGlow = M(new THREE.SphereGeometry(0.26, 10, 8), glow, false, false);
  mouthGlow.position.set(0, -0.2, 0.9);
  mouthGlow.scale.set(1, 0.5, 1.4);
  head.add(mouthGlow);
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffd24a });
  const eyes = [];
  for (const s of [-1, 1]) {
    const e = M(new THREE.SphereGeometry(0.11, 10, 10), eyeMat, false, false);
    e.position.set(0.32 * s, 0.14, 0.45);
    head.add(e);
    eyes.push(e);
    const horn = M(new THREE.ConeGeometry(0.1, 0.55, 6), belly);
    horn.position.set(0.3 * s, 0.42, -0.15);
    horn.rotation.x = -0.5; horn.rotation.z = 0.3 * s;
    head.add(horn);
  }

  // 翼
  const wings = {};
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? -1 : 1;
    const shoulder = P(body, 0.95 * s, 0.45, 0.2);
    const bone1 = M(new THREE.CapsuleGeometry(0.13, 1.5, 4, 8), skin);
    bone1.rotation.z = Math.PI / 2 * s;
    bone1.position.x = 0.75 * s;
    shoulder.add(bone1);
    const joint = P(shoulder, 1.5 * s, 0, 0);
    const bone2 = M(new THREE.CapsuleGeometry(0.1, 1.7, 4, 8), skin);
    bone2.rotation.z = Math.PI / 2 * s;
    bone2.position.x = 0.85 * s;
    joint.add(bone2);
    // 膜
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(1.5 * s, 0.15);
    shape.lineTo(3.3 * s, -1.5);
    shape.lineTo(1.4 * s, -1.1);
    shape.lineTo(0, -0.9);
    shape.lineTo(0, 0);
    const mem = new THREE.Mesh(new THREE.ShapeGeometry(shape), membrane);
    mem.rotation.x = Math.PI / 2;
    mem.position.y = -0.05;
    mem.castShadow = true;
    shoulder.add(mem);
    wings[side] = { shoulder, joint, mem };
  }

  // 尻尾
  const tailSegs = [];
  let tp = P(body, 0, -0.1, -1.7);
  for (let i = 0; i < 6; i++) {
    const seg = M(new THREE.CapsuleGeometry(0.42 - i * 0.055, 0.7, 4, 8), skin);
    seg.rotation.z = Math.PI / 2;
    tp.add(seg);
    const next = P(tp, 0, 0, -0.7);
    tailSegs.push(tp);
    tp = next;
  }
  const tailTip = M(new THREE.ConeGeometry(0.2, 0.7, 6), belly);
  tailTip.rotation.x = -Math.PI / 2;
  tp.add(tailTip);

  // 脚
  const legs = {};
  for (const side of ['L', 'R']) {
    const s = side === 'L' ? -1 : 1;
    const hip = P(body, 0.72 * s, -0.7, -0.5);
    const th = M(new THREE.CapsuleGeometry(0.34, 0.8, 4, 8), skin);
    th.position.y = -0.5;
    hip.add(th);
    const knee = P(hip, 0, -1.0, 0.1);
    const sh = M(new THREE.CapsuleGeometry(0.26, 0.7, 4, 8), skin);
    sh.position.y = -0.42;
    knee.add(sh);
    const foot = M(new THREE.BoxGeometry(0.6, 0.3, 0.85), skin);
    foot.position.set(0, -0.85, 0.16);
    knee.add(foot);
    for (let c = 0; c < 3; c++) {
      const claw = M(new THREE.ConeGeometry(0.08, 0.3, 5), belly);
      claw.position.set((c - 1) * 0.2, -0.95, 0.6);
      claw.rotation.x = 1.3;
      knee.add(claw);
    }
    legs[side] = { hip, knee };
  }

  root.traverse((o) => { o.frustumCulled = false; });
  let t = Math.random() * 10;
  function update(dt, o = {}) {
    t += dt;
    const speed = o.speed ?? 0;
    const moving = speed > 0.3;
    const sw = Math.sin(t * 3.2);
    const amp = clamp(speed / 5, 0, 1) * 0.5;
    legs.L.hip.rotation.x = damp(legs.L.hip.rotation.x, sw * amp, 8, dt);
    legs.R.hip.rotation.x = damp(legs.R.hip.rotation.x, -sw * amp, 8, dt);
    legs.L.knee.rotation.x = damp(legs.L.knee.rotation.x, Math.max(0, -sw) * amp, 8, dt);
    legs.R.knee.rotation.x = damp(legs.R.knee.rotation.x, Math.max(0, sw) * amp, 8, dt);

    body.position.y = 3.0 * scale + (moving ? Math.abs(Math.sin(t * 6.4)) * 0.16 : Math.sin(t * 1.2) * 0.05);
    body.rotation.z = sw * 0.04 * (moving ? 1 : 0.3);

    // 翼ばたき
    const flap = Math.sin(t * (moving ? 2.4 : 1.1)) * (moving ? 0.55 : 0.22);
    wings.L.shoulder.rotation.z = 0.25 + flap;
    wings.R.shoulder.rotation.z = -0.25 - flap;
    wings.L.joint.rotation.z = -0.3 - flap * 0.7;
    wings.R.joint.rotation.z = 0.3 + flap * 0.7;

    // 尻尾
    for (let i = 0; i < tailSegs.length; i++) {
      tailSegs[i].rotation.y = Math.sin(t * 2.2 - i * 0.5) * 0.18;
      tailSegs[i].rotation.x = Math.sin(t * 1.6 - i * 0.4) * 0.06;
    }

    neck.rotation.x = -0.55 + Math.sin(t * 1.4) * 0.06;
    let mouth = 0.15 + Math.sin(t * 2.4) * 0.05;
    if (o.attackPhase != null && o.attackPhase >= 0 && o.attackPhase <= 1) {
      const p = o.attackPhase;
      neck.rotation.x = -0.55 + Math.sin(p * Math.PI) * 0.9;
      mouth = 0.15 + Math.sin(Math.min(1, p * 2) * Math.PI) * 0.85;
      if (p > 0.45 && p < 0.75) {
        // 火炎放射の演出
        mouthGlow.scale.set(1.6, 0.9, 3.4);
        glow.emissiveIntensity = 3.4;
      } else {
        mouthGlow.scale.set(1, 0.5, 1.4);
        glow.emissiveIntensity = 2.2;
      }
    }
    jaw.rotation.x = mouth * 0.6;

    if (o.dead) {
      root.rotation.z = damp(root.rotation.z, Math.PI * 0.46, 1.6, dt);
      root.position.y = damp(root.position.y, -1.6, 1.6, dt);
      for (const k in wings) wings[k].shoulder.rotation.z = damp(wings[k].shoulder.rotation.z, k === 'L' ? 1.1 : -1.1, 2, dt);
    }
  }
  return { group: root, parts: { body, head, neck, jaw, wings, tail: tailSegs, legs }, update, materials: [skin, belly, membrane, glow] };
}

// ============================================================
//  骨（スケルトン）
// ============================================================
export function buildSkeleton(scale = 1) {
  const h = buildHumanoid({
    skin: 0xe8e2d0, hair: 0xd8d2c0, cloth: 0x3a3a44, cloth2: 0x22222a,
    leather: 0x4a3a28, metal: 0x9aa0a8, scale, slim: 0.82,
  });
  const boneMat = stdMat(0xe6e0cc, 0.65);
  // 頭蓋骨っぽく
  h.parts.head.clear();
  const skull = M(new THREE.SphereGeometry(0.14, 14, 12), boneMat);
  skull.position.y = 0.11;
  skull.scale.set(0.92, 1.0, 1.0);
  h.parts.head.add(skull);
  const jawB = M(new THREE.BoxGeometry(0.16, 0.07, 0.14), boneMat);
  jawB.position.set(0, 0.0, 0.05);
  h.parts.head.add(jawB);
  const socket = new THREE.MeshBasicMaterial({ color: 0x090c12 });
  for (const s of [-1, 1]) {
    const e = M(new THREE.SphereGeometry(0.035, 8, 8), socket, false, false);
    e.position.set(0.05 * s, 0.12, 0.11);
    h.parts.head.add(e);
  }
  const glow = new THREE.MeshStandardMaterial({ color: 0x110800, emissive: 0x66ccff, emissiveIntensity: 1.4 });
  for (const s of [-1, 1]) {
    const g = M(new THREE.SphereGeometry(0.022, 6, 6), glow, false, false);
    g.position.set(0.05 * s, 0.12, 0.125);
    h.parts.head.add(g);
  }
  h.parts.head.traverse((o) => { o.frustumCulled = false; });
  return h;
}
