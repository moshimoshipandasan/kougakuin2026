// ============================================================
//  ゲーム本体 — 初期化・ループ・進行・セーブ
// ============================================================

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

import { CONFIG } from './config.js';
import { clamp, Rand, toast } from './utils.js';
import { Input } from './input.js';
import { AudioSystem } from './audio.js';
import { Environment } from './sky.js';
import { World } from './world.js';
import { Player } from './player.js';
import { EnemyManager } from './enemy.js';
import { CombatSystem } from './combat.js';
import { HUD } from './hud.js';
import { UI } from './ui.js';
import { NPC } from './npc.js';
import { QuestManager } from './quests.js';
import { Inventory, ITEMS, rollLoot } from './items.js';
import { heightAt, WATER_LEVEL } from './terrain.js';
import { sparkTexture } from './textures.js';
import { ThirdPersonCamera } from './camera.js';

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = 'boot';   // boot | title | playing | paused | dead
    this.clock = new THREE.Clock();
    this.rand = new Rand(2026);
    this.drops = [];
    this.npcs = [];
    this.dialogues = 0;
    this.hintTimer = 12;
    this.ready = false;
    this.autoQuality = true;
    this.shadowInterval = 1;
    this._shadowFrame = 0;
  }

  // ============================================================
  async boot() {
    const canvas = this.canvas;

    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, powerPreference: 'high-performance', stencil: false,
    });
    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, CONFIG.render.maxPixelRatio);
    this.pixelRatio = this.maxPixelRatio;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;   // 手動で更新（負荷に応じて間引く）
    this.shadowInterval = 1;
    this._shadowFrame = 0;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CONFIG.render.fov, window.innerWidth / window.innerHeight, CONFIG.render.near, CONFIG.render.far);
    this.camera.position.set(0, 20, 30);

    // --- UI / HUD を先に作る（loading 表示のため） ---
    this.ui = new UI(this);
    this.ui.setLoading(0.02, '起動中');

    // --- ポストプロセス ---
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      CONFIG.render.bloom.strength, CONFIG.render.bloom.radius, CONFIG.render.bloom.threshold
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.smaa = new SMAAPass(window.innerWidth, window.innerHeight);
    this.composer.addPass(this.smaa);

    // --- 環境 ---
    this.env = new Environment(this.scene, this.renderer);
    this.env.update(0.016, this.camera, new THREE.Vector3());

    await new Promise((r) => requestAnimationFrame(r));

    // --- 世界 ---
    this.world = new World(this.scene);
    await this.world.build((p, step) => this.ui.setLoading(p * 0.88, step));

    // --- 入力 / 音 ---
    this.input = new Input(canvas);
    this.audio = new AudioSystem();
    this.cameraCtrl = null;

    // --- BGM の先読み ---
    this.ui.setLoading(0.9, 'BGMを読み込んでいます');
    const bgmOk = await this.audio.loadBgm('./assets/bgm/field-theme.mp3');
    if (bgmOk) {
      this.ui.setLoading(0.96, '「風の大地をゆく」 準備完了');
    } else {
      this.ui.setLoading(0.96, '内蔵の環境音楽を使用します');
    }
    await new Promise((r) => requestAnimationFrame(r));

    // --- プレイヤー ---
    this.player = new Player(this);
    this.player.position.set(0, heightAt(0, 6), 6);

    // --- システム ---
    this.inventory = new Inventory(30);
    this.inventory.add('hp_potion', 3);
    this.inventory.add('traveler_sword', 1);
    this.questManager = new QuestManager(this);
    this.combat = new CombatSystem(this);
    this.enemyManager = new EnemyManager(this);
    this.hud = new HUD(this);

    // --- カメラコントローラ ---
    this.cameraCtrl = new ThirdPersonCamera(this.camera, this.input);
    this.cameraCtrl.snap(this.player.position);

    // --- NPC ---
    this.spawnNpcs();

    // --- イベント ---
    this._bindEvents();

    this.questManager.refreshAvailability();
    this.hud.updateQuestTracker();
    this.hud.update(this.player, this.env, this.camera, 0.016);

    this.ready = true;
    this.ui.setLoading(1, '完了');
    await new Promise((r) => setTimeout(r, 250));
    this.ui.hideLoading();
    this.ui.showTitle();
    this.state = 'title';

    this.renderer.setAnimationLoop(() => this.tick());
  }

  spawnNpcs() {
    this.npcs = [
      new NPC('elder', this),
      new NPC('smith', this),
      new NPC('guard', this),
      new NPC('villager', this),
    ];
    for (const n of this.npcs) this._refreshNpcMarker(n);
  }

  _refreshNpcMarker(npc) {
    const qm = this.questManager;
    if (qm.turnInFor(npc.giver).length) npc.setMarker('?');
    else if (qm.availableFor(npc.giver).length) npc.setMarker('!');
    else npc.setMarker('');
  }

  // ============================================================
  _bindEvents() {
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.onPanelClosed = () => this._relock();

    const unlock = () => {
      this.audio.init();
      this.audio.resume();
      window.removeEventListener('pointerdown', unlock);
    };
    window.addEventListener('pointerdown', unlock);

    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !this.ui.isBlockingInput()) {
        // ポインタロックが外れたらポーズ
        this.pause();
      }
    };
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.smaa.setSize(w, h);
  }

  _applyPixelRatio() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
    this.smaa.setSize(w, h);
  }

  /** フレームレートに応じて描画解像度・影の更新頻度を自動調整 */
  _adaptQuality(dt) {
    if (this.autoQuality === false) return;
    this._fpsAcc = (this._fpsAcc || 0) + dt;
    this._fpsFrames = (this._fpsFrames || 0) + 1;
    this._qCooldown = (this._qCooldown === undefined ? 3.0 : this._qCooldown) - dt;
    if (this._fpsAcc < 1.2) return;
    const fps = this._fpsFrames / this._fpsAcc;
    this._fpsAcc = 0;
    this._fpsFrames = 0;
    if (this._qCooldown > 0) return;

    if (fps < 40) {
      if (this.pixelRatio > 0.72) {
        this.pixelRatio = Math.max(0.7, this.pixelRatio - 0.16);
        this._applyPixelRatio();
        this._qCooldown = 2.2;
      } else if (this.shadowInterval < 4) {
        this.shadowInterval++;
        this._qCooldown = 2.2;
      }
    } else if (fps > 56) {
      if (this.shadowInterval > 1) {
        this.shadowInterval--;
        this._qCooldown = 3.0;
      } else if (this.pixelRatio < this.maxPixelRatio - 0.02) {
        this.pixelRatio = Math.min(this.maxPixelRatio, this.pixelRatio + 0.12);
        this._applyPixelRatio();
        this._qCooldown = 4.5;
      }
    }
  }

  _relock() {
    if (this.state === 'playing' && !this.ui.isBlockingInput()) {
      this.input.requestLock();
    }
  }

  // ============================================================
  onKey(e) {
    if (!this.ready) return;
    const code = e.code;

    if (code === 'Escape') {
      if (this.ui.inDialogue) { this.ui.closeDialogue(); return; }
      if (this.state === 'playing') { this.pause(); return; }
      if (this.state === 'paused') { this.resume(); return; }
    }
    if (this.state !== 'playing') return;

    if (code === 'KeyI') { this.ui.toggle('inventory'); if (!this.ui.panels.inventory.classList.contains('hidden')) this.ui.renderInventory(); this._relock(); }
    if (code === 'KeyQ') { this.ui.toggle('questlog'); if (!this.ui.panels.questlog.classList.contains('hidden')) this.ui.renderQuests(); this._relock(); }
    if (code === 'KeyE') this.interact();
    if (code === 'KeyF') this.pickupNearest();
    if (code === 'KeyM') {
      this.audio.setMusic(!this.audio.musicOn);
      this.hud.notify(this.audio.musicOn ? 'BGM 再生' : 'BGM ミュート', 'info', 1600);
    }
    if (code === 'BracketRight') {
      this.audio.setMusicVolume(this.audio.musicVolume + 0.1);
      this.hud.notify(`BGM 音量 ${Math.round(this.audio.musicVolume * 100)}%`, 'info', 1400);
    }
    if (code === 'BracketLeft') {
      this.audio.setMusicVolume(this.audio.musicVolume - 0.1);
      this.hud.notify(`BGM 音量 ${Math.round(this.audio.musicVolume * 100)}%`, 'info', 1400);
    }
  }

  interact() {
    const ia = this.player.interactable;
    if (!ia) return;
    if (ia.type === 'npc') this.talkTo(ia.target);
    else if (ia.type === 'drop') this.collectDrop(ia.target);
  }

  // ============================================================
  startNewGame() {
    this.ui.hideTitle();
    this.ui.closeAll();
    this.hud.show();
    this.state = 'playing';
    this.env.time = CONFIG.startTime;
    this.player.position.set(0, heightAt(0, 6), 6);
    this.cameraCtrl.yaw = Math.PI;
    this.cameraCtrl.pitch = 0.22;
    this.cameraCtrl.snap(this.player.position);
    this.input.requestLock();
    this.audio.init();
    this.audio.resume();
    this.hud.notify('ようこそ、アヴァロンへ。村長エルダに話しかけよう。', 'quest', 6000);
    this.ui.setLoading(1, '');
  }

  continueGame() {
    const raw = localStorage.getItem(CONFIG.saveKey);
    if (!raw) { toast('セーブデータがありません', 'danger'); return; }
    try {
      const data = JSON.parse(raw);
      this.load(data);
      this.ui.hideTitle();
      this.ui.closeAll();
      this.hud.show();
      this.state = 'playing';
      this.cameraCtrl.snap(this.player.position);
      this.input.requestLock();
      this.audio.init();
      this.audio.resume();
      this.hud.notify('冒険の続きを再開した', 'quest');
      this.hud.updateQuestTracker();
    } catch (err) {
      console.error(err);
      toast('セーブデータを読み込めませんでした', 'danger');
    }
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.ui.updatePauseStats(this.player);
    this.ui.open('pause');
  }

  resume() {
    this.ui.closeAll();
    this.state = 'playing';
    this.input.requestLock();
  }

  toTitle() {
    this.ui.closeAll();
    this.hud.hide();
    this.state = 'title';
    this.ui.showTitle();
    this.input.exitLock();
  }

  // ============================================================
  onPlayerDeath() {
    this.state = 'dead';
    this.ui.showDeath(this.player);
    this.input.exitLock();
  }

  respawn() {
    this.ui.hideDeath();
    const lost = Math.floor(this.player.gold * 0.5);
    this.player.gold -= lost;
    this.player.revive();
    this.enemyManager.clear();
    this.combat.clear();
    this.hud.hideBossBar();
    this.hud.notify(`教会で目を覚ました。${lost}ゴールドを失った……`, 'danger', 5000);
    this.state = 'playing';
    this.cameraCtrl.snap(this.player.position);
    this.input.requestLock();
    this.audio.resume();
  }

  onLevelUp(level) {
    for (const n of this.npcs) this._refreshNpcMarker(n);
    this.questManager.refreshAvailability();
    for (const n of this.npcs) this._refreshNpcMarker(n);
    if (level >= 12 && !this.enemyManager.bossSpawned) {
      setTimeout(() => { if (this.state === 'playing') this.enemyManager.spawnBoss(); }, 1500);
    }
  }

  onQuestTurnIn(q) {
    for (const n of this.npcs) this._refreshNpcMarker(n);
  }

  onEnemyDeath(e) {
    this.player.kills++;
    this.player.gainXp(e.xpValue);
    this.questManager.progress('kill', e.typeKey, 1);
    this.hud.log(`${e.name} を倒した (+${e.xpValue} EXP)`, 'loot');

    // 戦利品
    const loot = rollLoot(e.type, this.rand, e.elite ? 0.15 : 0);
    for (const l of loot) {
      if (l.id === 'coin') {
        this.player.gainGold(l.count);
        this.hud.floatText(e.position.clone().add(new THREE.Vector3(0, e.height + 0.5, 0)), `+${l.count}◈`, 'xp');
      } else {
        this.spawnDrop(e.position, l.id, l.count);
      }
    }
    if (e.isBoss) {
      this.hud.notify('古代竜ヴァルガを討伐した！', 'quest', 8000);
      this.hud.hideBossBar();
      this.enemyManager.boss = null;
    }
    for (const n of this.npcs) this._refreshNpcMarker(n);
    this.hud.updateQuestTracker();
  }

  // ------------------------------------------------------------
  spawnDrop(position, itemId, count) {
    const def = ITEMS[itemId];
    const p = position.clone();
    p.x += this.rand.range(-1, 1);
    p.z += this.rand.range(-1, 1);
    p.y = heightAt(p.x, p.z) + 0.55;

    const g = new THREE.Group();
    g.position.copy(p);

    const geo = new THREE.IcosahedronGeometry(0.22, 0);
    const mat = new THREE.MeshStandardMaterial({
      color: def.type === 'weapon' || def.type === 'armor' ? 0xd9b25c : 0x9fd8ff,
      emissive: def.type === 'weapon' || def.type === 'armor' ? 0x6a4f10 : 0x2a5a80,
      emissiveIntensity: 1.2, roughness: 0.3, metalness: 0.6,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    g.add(mesh);

    const glowMat = new THREE.SpriteMaterial({
      map: sparkTexture(), color: 0xffd98a, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.7,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.setScalar(1.5);
    g.add(glow);

    this.scene.add(g);
    const drop = {
      position: p, id: itemId, count, group: g, mesh, glow,
      taken: false, bobT: Math.random() * 6, name: def.name,
    };
    this.drops.push(drop);
    return drop;
  }

  collectDrop(drop) {
    if (drop.taken) return;
    drop.taken = true;
    this.inventory.add(drop.id, drop.count);
    this.audio.play('pickup');
    this.hud.notify(`入手：${ITEMS[drop.id].name} ×${drop.count}`, 'loot', 2600);
    this.hud.log(`${ITEMS[drop.id].name} を手に入れた`, 'loot');
    this.scene.remove(drop.group);
    drop.mesh.geometry.dispose();
    drop.mesh.material.dispose();
    drop.glow.material.dispose();
    this.questManager.syncCollect();
    const i = this.drops.indexOf(drop);
    if (i >= 0) this.drops.splice(i, 1);
  }

  pickupNearest() {
    let best = null, bd = 3.2;
    for (const d of this.drops) {
      if (d.taken) continue;
      const dist = Math.hypot(d.position.x - this.player.position.x, d.position.z - this.player.position.z);
      if (dist < bd) { bd = dist; best = d; }
    }
    if (best) this.collectDrop(best);
  }

  // ============================================================
  talkTo(npc) {
    const qm = this.questManager;
    qm.refreshAvailability();
    const turnIns = qm.turnInFor(npc.giver);
    const availables = qm.availableFor(npc.giver);
    const options = [];

    for (const q of turnIns) {
      options.push({
        label: `【報告】${q.name}`,
        action: () => {
          qm.turnIn(q.id);
          this._refreshNpcMarker(npc);
        },
      });
    }
    for (const q of availables) {
      options.push({
        label: `【受注】${q.name}`,
        next: () => ({
          name: npc.name, face: npc.face, text: q.desc,
          options: [
            {
              label: '引き受ける',
              action: () => { qm.start(q.id); this._refreshNpcMarker(npc); },
              next: () => ({
                name: npc.name, face: npc.face,
                text: '頼んだぞ、勇者よ。この地の未来は君にかかっている。',
                options: [{ label: '閉じる', close: true }],
              }),
            },
            { label: 'やめておく', close: true },
          ],
        }),
      });
    }

    if (npc.key === 'smith') options.push({ label: '買い物をする', next: () => this.shopNode(npc) });
    if (npc.key === 'guard') options.push({ label: '周辺の様子を聞く', next: () => ({ name: npc.name, face: npc.face, text: this.guardGossip(), options: [{ label: '閉じる', close: true }] }) });
    options.push({ label: 'また今度', close: true });

    this.ui.startDialogue(npc, {
      name: npc.name, face: npc.face,
      text: this.npcGreeting(npc, turnIns, availables),
      options,
    });
  }

  npcGreeting(npc, turnIns, availables) {
    if (turnIns.length) return 'おお、勇者殿！ 見事な働きだ。報告を聞かせてくれ。';
    if (availables.length) return 'よく来たな、勇者殿。頼みたいことがあるのだ。';
    switch (npc.key) {
      case 'elder': return 'この村も随分と平和になった。だが、山の向こうにはまだ何かが眠っている気がする……。';
      case 'smith': return 'ふん、武器が欲しいのか？ 金を積むなら話は別だがな。';
      case 'guard': return '俺はこの門を守っている。お前も無茶はするなよ。';
      case 'villager': return '夜になると魔物が増えるの。気をつけてね、勇者さま。';
      default: return 'こんにちは。';
    }
  }

  guardGossip() {
    const lvl = this.player.level;
    if (lvl >= 12) return '山の頂から咆哮が聞こえた……。あれは間違いなく古代竜だ。';
    if (lvl >= 8) return '北の山で岩の巨人が動き出したらしい。近づかない方がいい。';
    if (lvl >= 4) return '夜の墓地には骸骨が出る。昼のうちに片付けておけ。';
    return '村の周りはまだ安全だ。だが夜は気を抜くなよ。';
  }

  shopNode(npc) {
    const wares = [
      ['hp_potion', 30], ['mp_potion', 40], ['elixir', 300],
      ['iron_sword', 260], ['silver_sword', 780],
      ['leather_armor', 320], ['knight_armor', 980],
    ];
    const options = wares.map(([id, price]) => ({
      label: `${ITEMS[id].icon} ${ITEMS[id].name} — ${price}G`,
      action: () => {
        if (this.player.gold < price) { this.hud.notify('ゴールドが足りない', 'danger'); return; }
        this.player.gold -= price;
        this.inventory.add(id, 1);
        this.audio.play('coin');
        this.hud.notify(`${ITEMS[id].name}を購入した`, 'loot');
      },
    }));
    options.push({ label: '閉じる', close: true });
    return {
      name: npc.name, face: npc.face,
      text: `所持金：${Math.floor(this.player.gold)}G\n何が要る？`,
      options,
    };
  }

  // ============================================================
  tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const elapsed = this.clock.elapsedTime;
    this.frameCount = (this.frameCount || 0) + 1;

    if (!this.ready) return;

    if (this.state === 'title') {
      // タイトル中は村の周りをゆっくり旋回
      const a = elapsed * 0.12;
      const r = 26;
      this.camera.position.set(Math.cos(a) * r, heightAt(0, 0) + 11 + Math.sin(a * 0.7) * 2, Math.sin(a) * r);
      this.camera.lookAt(0, heightAt(0, 0) + 3.5, 0);
      this.env.update(dt, this.camera, new THREE.Vector3(0, 0, 0));
      this.world.update(dt, elapsed, this.camera, this.player.position, this.env);
      this._shadowFrame = (this._shadowFrame + 1) % this.shadowInterval;
      this.renderer.shadowMap.needsUpdate = this._shadowFrame === 0;
      this.composer.render();
      this.input.endFrame();
      return;
    }

    const active = this.state === 'playing';
    const dying = this.state === 'dead';

    if (active) {
      this.cameraCtrl.update(dt, this.player.position, CONFIG.camera.height);
      this.player.update(dt);
      this.enemyManager.update(dt, this.player, this.world);
      this.combat.update(dt);
      this.updateDrops(dt, elapsed);
      for (const n of this.npcs) n.update(dt, this.player);
      this.questManager.syncCollect();
      this.checkBossBar();
    } else if (dying) {
      this.player.update(dt);
      this.enemyManager.update(dt, this.player, this.world);
      this.combat.update(dt);
      this.cameraCtrl.update(dt, this.player.position, CONFIG.camera.height);
    } else {
      // ポーズ中もカメラ入力は無効、少しだけアニメは進める
      this.cameraCtrl.update(dt * 0.0, this.player.position, CONFIG.camera.height);
    }

    this.env.update(active ? dt : dt * 0.15, this.camera, this.player.position);
    this.world.update(active ? dt : 0, elapsed, this.camera, this.player.position, this.env);

    this.hud.update(this.player, this.env, this.camera, dt);
    this.audio.update(dt, this.enemyManager.aliveCount > 3 ? 'battle' : 'calm');

    if (active) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) document.getElementById('hint')?.classList.add('hidden');
    }

    this.composer.render();
    this.input.endFrame();
    this._shadowFrame = (this._shadowFrame + 1) % this.shadowInterval;
    this.renderer.shadowMap.needsUpdate = this._shadowFrame === 0;
    if (this.state !== 'title') this._adaptQuality(dt);
  }

  updateDrops(dt, elapsed) {
    const p = this.player.position;
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      d.bobT += dt;
      d.group.position.y = d.position.y + Math.sin(d.bobT * 2.2) * 0.16;
      d.group.rotation.y += dt * 1.4;
      d.mesh.rotation.x += dt * 0.9;
      const dist = Math.hypot(d.position.x - p.x, d.position.z - p.z);
      if (dist < 1.7) this.collectDrop(d);
      else if (dist > 90) {
        this.scene.remove(d.group);
        d.mesh.geometry.dispose();
        d.mesh.material.dispose();
        d.glow.material.dispose();
        this.drops.splice(i, 1);
      }
    }
  }

  checkBossBar() {
    const boss = this.enemyManager.boss;
    if (!boss) return;
    if (boss.dead || boss.removed) { return; }
    this.hud.setBossRatio(boss.hp / boss.maxHp);
    this.hud.el.bossName.textContent = boss.name;
  }

  // ============================================================
  itemName(id) { return ITEMS[id]?.name || id; }

  save() {
    const data = {
      version: 1,
      time: this.env.time,
      player: this.player.serialize(),
      inventory: this.inventory.serialize(),
      quests: this.questManager.serialize(),
      savedAt: Date.now(),
    };
    localStorage.setItem(CONFIG.saveKey, JSON.stringify(data));
    return data;
  }

  load(data) {
    if (data.player) this.player.deserialize(data.player);
    if (data.inventory) this.inventory.deserialize(data.inventory);
    if (data.quests) this.questManager.deserialize(data.quests);
    if (typeof data.time === 'number') this.env.time = data.time;
    this.questManager.refreshAvailability();
    for (const n of this.npcs) this._refreshNpcMarker(n);
    this.hud.updateQuestTracker();
    this.enemyManager.clear();
    this.combat.clear();
  }
}
