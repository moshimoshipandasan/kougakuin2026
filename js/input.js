// ============================================================
//  入力（キーボード / マウス / ポインターロック）
// ============================================================

export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.keys = new Set();
    this.pressedThisFrame = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.buttons = new Set();
    this.buttonsPressed = new Set();
    this.locked = false;
    this.enabled = true;
    this.onLockChange = null;
    this.onKey = null;

    this._bind();
  }

  _bind() {
    const dom = this.dom;

    window.addEventListener('keydown', (e) => {
      if (e.repeat) {
        if (['Space', 'Tab', 'F5'].includes(e.code)) e.preventDefault();
        return;
      }
      this.keys.add(e.code);
      this.pressedThisFrame.add(e.code);
      this.onKey?.(e.code, e);
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.buttons.clear();
    });

    dom.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (!this.locked) { this.requestLock(); return; }
      this.buttons.add(e.button);
      this.buttonsPressed.add(e.button);
    });

    window.addEventListener('mouseup', (e) => this.buttons.delete(e.button));
    dom.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      this.mouseDX += e.movementX || 0;
      this.mouseDY += e.movementY || 0;
    });

    window.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      this.wheel += Math.sign(e.deltaY);
    }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
      this.onLockChange?.(this.locked);
      if (!this.locked) { this.buttons.clear(); }
    });
  }

  requestLock() {
    if (!this.enabled) return;
    try {
      const p = this.dom.requestPointerLock?.({ unadjustedMovement: true });
      if (p && p.catch) {
        p.catch(() => { try { this.dom.requestPointerLock(); } catch (e) { /* noop */ } });
      }
    } catch (e) {
      try { this.dom.requestPointerLock(); } catch (e2) { /* noop */ }
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(code) { return this.keys.has(code); }
  justPressed(code) { return this.pressedThisFrame.has(code); }
  isMouseDown(btn = 0) { return this.buttons.has(btn); }
  mouseJustPressed(btn = 0) { return this.buttonsPressed.has(btn); }

  /** 前後左右の入力ベクトル（正規化前） */
  moveVector() {
    let x = 0, z = 0;
    if (this.isDown('KeyW') || this.isDown('ArrowUp')) z -= 1;
    if (this.isDown('KeyS') || this.isDown('ArrowDown')) z += 1;
    if (this.isDown('KeyA') || this.isDown('ArrowLeft')) x -= 1;
    if (this.isDown('KeyD') || this.isDown('ArrowRight')) x += 1;
    const len = Math.hypot(x, z);
    if (len > 1) { x /= len; z /= len; }
    return { x, z, active: len > 0.01 };
  }

  endFrame() {
    this.pressedThisFrame.clear();
    this.buttonsPressed.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}
