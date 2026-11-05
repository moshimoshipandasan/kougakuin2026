// ============================================================
//  三人称カメラ（マウスルック・地形衝突・シェイク）
// ============================================================

import * as THREE from 'three';
import { CONFIG } from './config.js';
import { clamp, damp } from './utils.js';
import { heightAt } from './terrain.js';

export class ThirdPersonCamera {
  constructor(camera, input) {
    this.camera = camera;
    this.input = input;
    this.yaw = Math.PI;
    this.pitch = 0.20;
    this.distance = CONFIG.camera.distance;
    this.targetDistance = CONFIG.camera.distance;
    this.curPos = new THREE.Vector3();
    this.curLook = new THREE.Vector3();
    this.shakeAmt = 0;
    this.shakeT = 0;
    this.aiming = false;
    this._tmp = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._lookTarget = new THREE.Vector3();
  }

  shake(amount) {
    this.shakeAmt = Math.min(1.4, this.shakeAmt + amount);
  }

  get forward() {
    return this._tmp.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /** マウス入力のみ処理（メニュー中でも呼べる） */
  handleInput() {
    const inp = this.input;
    if (!inp.locked) return;
    this.yaw -= inp.mouseDX * CONFIG.camera.sensitivity;
    this.pitch = clamp(this.pitch + inp.mouseDY * CONFIG.camera.sensitivity, CONFIG.camera.pitchMin, CONFIG.camera.pitchMax);
    if (inp.wheel) {
      this.targetDistance = clamp(this.targetDistance + inp.wheel * 0.9, CONFIG.camera.minDistance, CONFIG.camera.maxDistance);
    }
  }

  update(dt, targetPos, extraHeight = 1.5) {
    this.handleInput();
    this.distance = damp(this.distance, this.targetDistance, 8, dt);

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dirX = Math.sin(this.yaw) * cp;
    const dirZ = Math.cos(this.yaw) * cp;
    const dirY = sp;

    // 地形にめり込まないよう距離を詰める
    let dist = this.distance;
    const ox = targetPos.x, oz = targetPos.z, oy = targetPos.y + extraHeight;
    for (let s = 0.6; s <= this.distance; s += 0.35) {
      const px = ox + dirX * s;
      const pz = oz + dirZ * s;
      const py = oy + dirY * s;
      const gh = heightAt(px, pz) + 0.5;
      if (py < gh) { dist = Math.max(0.9, s - 0.35); break; }
    }

    this._desired.set(ox + dirX * dist, oy + dirY * dist, oz + dirZ * dist);
    this._lookTarget.set(ox, oy + 0.1, oz);
    const k = 1 - Math.exp(-CONFIG.camera.lag * dt);
    this.curPos.lerp(this._desired, k);
    this.curLook.lerp(this._lookTarget, 1 - Math.exp(-16 * dt));

    // シェイク
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 2.4);
    let sx = 0, sy = 0, sz = 0;
    if (this.shakeAmt > 0.001) {
      const a = this.shakeAmt * this.shakeAmt * 0.42;
      const t = performance.now() * 0.001 * 34;
      sx = Math.sin(t * 1.7) * a;
      sy = Math.sin(t * 2.3 + 1.1) * a;
      sz = Math.sin(t * 1.3 + 2.2) * a;
    }

    this.camera.position.set(this.curPos.x + sx, this.curPos.y + sy, this.curPos.z + sz);
    this.camera.lookAt(this.curLook.x + sx * 0.4, this.curLook.y + sy * 0.4, this.curLook.z + sz * 0.4);
  }

  snap(targetPos, extraHeight = 1.5) {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const dirX = Math.sin(this.yaw) * cp;
    const dirZ = Math.cos(this.yaw) * cp;
    const dirY = sp;
    this.curPos.set(
      targetPos.x + dirX * this.distance,
      targetPos.y + extraHeight + dirY * this.distance,
      targetPos.z + dirZ * this.distance
    );
    this.curLook.set(targetPos.x, targetPos.y + extraHeight, targetPos.z);
    this.camera.position.copy(this.curPos);
    this.camera.lookAt(this.curLook);
  }
}
