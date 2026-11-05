// ============================================================
//  音響 — WebAudio で効果音を合成 + 音声ファイルによる BGM
// ============================================================

import { clamp } from './utils.js';

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.ready = false;
    this.musicOn = true;
    this.enabled = true;
    this._musicTimer = 0;
    this._chordIndex = 0;
    this._wind = null;

    // --- BGM（音声ファイル） ---
    this.bgm = null;          // HTMLAudioElement
    this.bgmSource = null;    // MediaElementAudioSourceNode
    this.bgmReady = false;
    this.bgmUrl = null;
    this.musicVolume = 0.45;
    this._bgmPauseTimer = null;
  }

  /**
   * BGM の音声ファイルを先読みする（AudioContext はまだ無くてよい）
   * @returns {Promise<boolean>} 読み込めたか
   */
  async loadBgm(url) {
    this.bgmUrl = url;
    try {
      const el = new Audio();
      el.src = url;
      el.loop = true;
      el.preload = 'auto';
      el.crossOrigin = 'anonymous';
      el.volume = 1;
      el.setAttribute('playsinline', '');

      await new Promise((resolve) => {
        let done = false;
        const finish = () => { if (!done) { done = true; cleanup(); resolve(); } };
        const cleanup = () => {
          el.removeEventListener('canplaythrough', finish);
          el.removeEventListener('loadeddata', finish);
          el.removeEventListener('error', fail);
        };
        const fail = () => { if (!done) { done = true; cleanup(); resolve(); } };
        el.addEventListener('canplaythrough', finish, { once: true });
        el.addEventListener('loadeddata', finish, { once: true });
        el.addEventListener('error', fail, { once: true });
        setTimeout(finish, 20000);
        try { el.load(); } catch (e) { fail(); }
      });

      if (el.error || (!el.duration && el.readyState === 0)) {
        console.warn('BGM: 読み込みに失敗しました。内蔵の環境音楽を使用します。', url);
        this.bgm = null;
        this.bgmReady = false;
        return false;
      }

      this.bgm = el;
      this.bgmReady = true;
      // AudioContext が既にあるなら即座に接続
      if (this.ctx) this._connectBgm();
      return true;
    } catch (e) {
      console.warn('BGMの読み込みエラー', e);
      this.bgm = null;
      this.bgmReady = false;
      return false;
    }
  }

  _connectBgm() {
    if (!this.ctx || !this.bgm || this.bgmSource) return;
    try {
      this.bgmSource = this.ctx.createMediaElementSource(this.bgm);
      this.bgmSource.connect(this.musicGain);
    } catch (e) {
      // 既に接続済み等
      console.warn('BGM接続に失敗', e);
    }
  }

  init() {
    if (this.ready) {
      this._connectBgm();
      if (this.musicOn) this.setMusic(true);
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.75;
    this.master.connect(this.ctx.destination);

    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.85;
    this.sfxGain.connect(this.master);

    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.0;
    this.musicGain.connect(this.master);

    this.noiseBuffer = this._makeNoise(2.0);
    this.ready = true;
    this._startWind();
    this._connectBgm();
    if (this.musicOn) this.setMusic(true);
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  resume() { if (this.ctx?.state === 'suspended') this.ctx.resume(); }

  _makeNoise(seconds) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(1, len, rate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  get t() { return this.ctx.currentTime; }

  // --- 基本ヘルパ ---
  _osc(type, freq, t0, dur, gain, dest = this.sfxGain, detune = 0) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (detune) o.detune.value = detune;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + Math.min(0.012, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest);
    o.start(t0); o.stop(t0 + dur + 0.03);
    return o;
  }

  _noise(t0, dur, gain, filterType, freq, q = 1, dest = this.sfxGain) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t0); src.stop(t0 + dur + 0.03);
    return { src, f, g };
  }

  // --- 効果音 ---
  play(name, opt = {}) {
    if (!this.enabled || !this.ready) return;
    const t = this.t;
    const v = opt.volume ?? 1;
    switch (name) {
      case 'swing': {
        const { f, g } = this._noise(t, 0.22, 0.24 * v, 'bandpass', 1400, 1.1);
        f.frequency.setValueAtTime(2600, t);
        f.frequency.exponentialRampToValueAtTime(500, t + 0.2);
        break;
      }
      case 'hit': {
        this._noise(t, 0.14, 0.4 * v, 'lowpass', 900, 0.8);
        this._osc('triangle', 150, t, 0.16, 0.3 * v);
        this._osc('square', 88, t, 0.1, 0.14 * v);
        break;
      }
      case 'crit': {
        this._noise(t, 0.2, 0.5 * v, 'bandpass', 1800, 1.4);
        this._osc('sawtooth', 320, t, 0.22, 0.24 * v);
        this._osc('triangle', 160, t, 0.3, 0.28 * v);
        break;
      }
      case 'hurt': {
        this._osc('sawtooth', 210, t, 0.28, 0.26 * v);
        this._osc('sawtooth', 158, t + 0.03, 0.24, 0.2 * v);
        this._noise(t, 0.2, 0.22 * v, 'lowpass', 700, 1);
        break;
      }
      case 'die': {
        this._osc('sawtooth', 240, t, 0.9, 0.24 * v);
        const o = this._osc('sawtooth', 180, t, 1.1, 0.2 * v);
        o.frequency.exponentialRampToValueAtTime(60, t + 1.0);
        this._noise(t, 0.7, 0.2 * v, 'lowpass', 500, 1);
        break;
      }
      case 'fire': {
        const { f, g } = this._noise(t, 0.55, 0.3 * v, 'lowpass', 900, 0.7);
        f.frequency.setValueAtTime(1800, t);
        f.frequency.exponentialRampToValueAtTime(220, t + 0.5);
        this._osc('sawtooth', 90, t, 0.4, 0.14 * v);
        break;
      }
      case 'heal': {
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
          this._osc('sine', f, t + i * 0.07, 0.7 - i * 0.08, 0.14 * v));
        break;
      }
      case 'whirl': {
        this._noise(t, 0.5, 0.32 * v, 'bandpass', 900, 2.2);
        this._osc('triangle', 160, t, 0.45, 0.16 * v);
        break;
      }
      case 'guard': {
        this._osc('square', 320, t, 0.3, 0.16 * v);
        this._osc('sine', 640, t, 0.35, 0.1 * v);
        break;
      }
      case 'levelup': {
        [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) =>
          this._osc('triangle', f, t + i * 0.11, 0.8, 0.17 * v));
        break;
      }
      case 'coin': {
        this._osc('square', 1046.5, t, 0.1, 0.1 * v);
        this._osc('square', 1568, t + 0.06, 0.16, 0.09 * v);
        break;
      }
      case 'pickup': {
        this._osc('sine', 660, t, 0.12, 0.14 * v);
        this._osc('sine', 990, t + 0.05, 0.18, 0.1 * v);
        break;
      }
      case 'ui': this._osc('sine', 880, t, 0.07, 0.07 * v); break;
      case 'quest': {
        [440, 554.37, 659.25, 880].forEach((f, i) =>
          this._osc('sine', f, t + i * 0.1, 0.55, 0.13 * v));
        break;
      }
      case 'boss': {
        this._osc('sawtooth', 55, t, 2.2, 0.3 * v);
        this._osc('sawtooth', 82.4, t + 0.05, 2.0, 0.22 * v);
        this._noise(t, 1.6, 0.22 * v, 'lowpass', 300, 0.9);
        break;
      }
      case 'footstep': {
        this._noise(t, 0.09, 0.09 * v, 'bandpass', 380 + Math.random() * 260, 1.6);
        break;
      }
      case 'roll': {
        this._noise(t, 0.26, 0.14 * v, 'bandpass', 600, 1.2);
        break;
      }
      case 'jump': {
        this._osc('sine', 420, t, 0.14, 0.09 * v);
        break;
      }
      case 'spawn': {
        this._osc('sawtooth', 140, t, 0.5, 0.1 * v);
        this._noise(t, 0.4, 0.14 * v, 'bandpass', 700, 1.4);
        break;
      }
    }
  }

  // --- 環境音 ---
  _startWind() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 380; f.Q.value = 0.6;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.028;
    lfo.connect(lfoGain); lfoGain.connect(g.gain);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(); lfo.start();
    this._wind = g;
  }

  setWind(level) {
    if (!this._wind || !this.ready) return;
    this._wind.gain.setTargetAtTime(level, this.t, 0.6);
  }

  // --- BGM（ゆっくりしたアンビエント） ---
  setMusic(on) {
    this.musicOn = on;
    if (!this.ready) return;

    if (this._bgmPauseTimer) { clearTimeout(this._bgmPauseTimer); this._bgmPauseTimer = null; }

    if (this.bgmReady && this.bgm) {
      // 音声ファイルを再生
      if (on) {
        this.bgm.play().catch(() => {});
      }
      this.musicGain.gain.cancelScheduledValues(this.t);
      this.musicGain.gain.setTargetAtTime(on ? this.musicVolume : 0.0, this.t, 0.8);
      if (!on) {
        this._bgmPauseTimer = setTimeout(() => {
          try { this.bgm.pause(); } catch (e) { /* noop */ }
          this._bgmPauseTimer = null;
        }, 2000);
      }
      return;
    }

    // ファイルが無い場合は内蔵のアンビエント
    this.musicGain.gain.setTargetAtTime(on ? 0.16 : 0.0, this.t, 1.2);
  }

  /** BGM の音量（0〜1） */
  setMusicVolume(v) {
    this.musicVolume = clamp(v, 0, 1);
    if (this.ready && this.musicOn) {
      this.musicGain.gain.setTargetAtTime(this.musicVolume, this.t, 0.3);
    }
  }

  /** 再生位置（秒）— デバッグ表示用 */
  get bgmTime() { return this.bgm ? this.bgm.currentTime : 0; }
  get bgmDuration() { return this.bgm && isFinite(this.bgm.duration) ? this.bgm.duration : 0; }

  update(dt, mood = 'calm') {
    if (!this.ready || !this.musicOn) return;
    // 音声ファイルがあるときは内蔵の和音は鳴らさない
    if (this.bgmReady) return;
    this._musicTimer -= dt;
    if (this._musicTimer > 0) return;
    const chords = mood === 'battle'
      ? [[110, 130.81, 164.81], [98, 116.54, 146.83], [123.47, 146.83, 185]]
      : [[130.81, 164.81, 196], [110, 138.59, 164.81], [98, 123.47, 146.83], [116.54, 146.83, 174.61]];
    const chord = chords[this._chordIndex % chords.length];
    this._chordIndex++;
    const dur = mood === 'battle' ? 3.2 : 6.0;
    const t0 = this.t + 0.05;
    chord.forEach((f, i) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = i === 0 ? 'triangle' : 'sine';
      o.frequency.value = f;
      o.detune.value = (Math.random() - 0.5) * 8;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.22 / (i + 1), t0 + dur * 0.35);
      g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(this.musicGain);
      o.start(t0); o.stop(t0 + dur + 0.1);
    });
    this._musicTimer = dur * 0.82;
  }
}
