// Emberline: boot, the one loop, and the match state machine. A fixed 60 Hz
// simulation feeds a render at the display's rate. Rounds: 15 s buy phase, then a
// 100 s round. Vanguard (the player plus two bots) attacks the Reactor; Sentinel
// (four bots) defends it. A round ends by elimination, by the clock, by the planted
// charge detonating, or by a defuse. First team to 5 rounds takes the match.
// ?shot=start|play|buy|end with &seed=N stages a deterministic frame for a capture,
// renders it twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld, ATTACKER_SPAWNS, DEFENDER_SPAWNS, SITE } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeaponRig, WEAPONS, ARMOR_PRICE, GRENADE_PRICE } from './weapons.js';
import { createBots } from './bots.js';
import { createEffects } from './effects.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { groundSpeed } from './physics.js';

const FIXED_STEP = 1 / 60;
const ROUND_TIME = 100;
const BUY_TIME = 15;
const PLANT_TIME = 3;
const DETONATE_TIME = 35;
const WIN_ROUNDS = 5;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = shot ? mulberry32(seed) : Math.random;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(shot ? 1 : Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 30, 95);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const effects = createEffects(scene);
const audio = createAudio();
const hud = createHud();
const input = createInput(renderer.domElement, onLockChange);
const player = createPlayer(world.colliders, ATTACKER_SPAWNS[0]);
const rig = createWeaponRig(camera);
const bots = createBots(scene, world);

// The player's own hit boxes, so bot rays can touch the player. Invisible in the
// render (colour writes off), solid to the raycaster.
const hitMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true });
const playerTorso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.68, 0.3), hitMat);
playerTorso.userData.isPlayer = true;
playerTorso.userData.part = 'torso';
const playerHead = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.24), hitMat);
playerHead.userData.isPlayer = true;
playerHead.userData.part = 'head';
scene.add(playerTorso, playerHead);

const raycaster = new THREE.Raycaster();
const shootables = world.shootables.concat(bots.hitMeshes, playerTorso, playerHead);
const direction = new THREE.Vector3();
const muzzle = new THREE.Vector3();
const tmpVec = new THREE.Vector3();

const match = {
  phase: 'menu',
  round: 1,
  scoreVan: 0,
  scoreSen: 0,
  buyTimer: BUY_TIME,
  roundTimer: ROUND_TIME,
  plantTimer: DETONATE_TIME,
  planted: false,
  plantProgress: 0,
  roundEndTimer: 0,
  roundEndReason: '',
  spectate: null,
  prevFiring: false,
  elapsed: 0,
  frozen: false,
};

const playerProxy = { body: player.body, alive: true, team: 'vanguard' };

function spawnBots() {
  bots.spawn('vanguard', 'Rook', ATTACKER_SPAWNS[1], 'rifle', 'mid');
  bots.spawn('vanguard', 'Havoc', ATTACKER_SPAWNS[2], 'smg', 'west');
  bots.spawn('sentinel', 'Wraith', DEFENDER_SPAWNS[0], 'rifle', 'site');
  bots.spawn('sentinel', 'Dagger', DEFENDER_SPAWNS[1], 'smg', 'site');
  bots.spawn('sentinel', 'Onyx', DEFENDER_SPAWNS[2], 'rifle', 'west');
  bots.spawn('sentinel', 'Vex', { x: 8, z: -14, yaw: Math.PI }, 'smg', 'east');
}

function syncPlayerHitMeshes() {
  const p = player.body.position;
  playerTorso.position.set(p.x, p.y + 1.0, p.z);
  playerHead.position.set(p.x, p.y + 1.5, p.z);
  playerTorso.rotation.y = player.body.yaw;
  playerHead.rotation.y = player.body.yaw;
}

function syncCamera() {
  if (match.phase === 'round' && !player.state.alive && match.spectate) {
    const target = match.spectate;
    const p = target.body.position;
    camera.position.set(p.x - Math.sin(target.body.yaw) * 2.2, p.y + 2.1, p.z - Math.cos(target.body.yaw) * 2.2);
    camera.lookAt(p.x, p.y + 1.3, p.z);
    return;
  }
  camera.position.set(player.body.position.x, player.body.position.y + player.body.eye, player.body.position.z);
  camera.rotation.set(player.body.pitch, player.body.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const p = player.body.position;
  const dx = point.x - p.x;
  const dy = point.y - (p.y + player.body.eye);
  const dz = point.z - p.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  player.body.yaw = Math.atan2(-dx, -dz);
  player.body.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function muzzleWorld() {
  muzzle.set(0.24, -0.17, -0.95);
  return camera.localToWorld(muzzle);
}

function shoot() {
  const def = rig.state.def;
  if (!rig.takeRound()) {
    audio.reload();
    return false;
  }
  const spread = rig.spread(player.groundSpeed(), input.state.ads);
  camera.getWorldDirection(direction);
  direction.x += (rng() * 2 - 1) * spread;
  direction.y += (rng() * 2 - 1) * spread;
  direction.z += (rng() * 2 - 1) * spread;
  direction.normalize();
  raycaster.set(camera.position, direction);
  raycaster.far = def.range;
  const hits = raycaster.intersectObjects(shootables, false);
  const first = hits[0];
  const from = muzzleWorld().clone();
  const end = first ? first.point : tmpVec.copy(camera.position).addScaledVector(direction, def.range).clone();
  effects.spawnTracer(from, end, def.tracer);
  audio.shot(def.id === 'sniper' ? 0.6 : def.id === 'smg' ? 1.15 : 1);
  bots.hear(player.body.position.x, player.body.position.z, match.elapsed);
  if (first) {
    const hitBot = first.object.userData.bot;
    if (hitBot) {
      damage(hitBot, def.damage, first.object.userData.part, 'You', first.point);
    } else if (first.object.userData.isPlayer) {
      // The player's own ray never reaches the player's own boxes; this is dead
      // code by construction, kept so the branch reads true.
    } else {
      effects.impact(first.point);
    }
  }
  rig.pullTrigger();
  player.recoil(def.kick + rng() * 0.003, (rng() * 2 - 1) * 0.003);
  hud.setAmmo(rig.state.mag, rig.state.reserve);
  hud.setCrosshairGap(6 + spread * 2600);
  return true;
}

function damage(target, amount, part, attackerName, point) {
  const isHead = part === 'head';
  const isPlayer = target === player.state;
  const mult = isHead ? (attackerName === 'You' ? rig.state.def.headMult : 2.5) : 1;
  let final = amount * mult;
  let absorbed = 0;
  if (target.armor > 0) {
    absorbed = Math.min(target.armor, final * 0.5);
    target.armor -= absorbed;
    final -= absorbed;
  }
  target.hp -= final;
  if (point) effects.blood(point);
  if (isPlayer) {
    audio.hurt();
    const attacker = attackerName === 'You' ? null : bots.bots.find((b) => b.name === attackerName);
    let angle = 0;
    if (attacker) {
      const dx = attacker.body.position.x - player.body.position.x;
      const dz = attacker.body.position.z - player.body.position.z;
      angle = Math.atan2(dx, dz) + player.body.yaw;
    }
    hud.damageFlash(angle);
    hud.setHealth(player.state.hp, player.state.armor);
    if (player.state.hp <= 0 && player.state.alive) killPlayer(attackerName);
    return;
  }
  const bot = target === player.state ? null : target;
  if (bot) {
    if (attackerName === 'You') {
      hud.hitMarker(false, 90);
      audio.hit();
      if (bot.hp <= 0) {
        hud.hitMarker(true, 120);
        audio.kill();
      }
    }
    if (bot.hp <= 0 && bot.alive) killBot(bot, attackerName, isHead);
  }
}

function killBot(bot, attackerName, headshot) {
  bot.alive = false;
  bot.figure.barGroup.visible = false;
  const attackerIsPlayer = attackerName === 'You';
  hud.killfeed(attackerName, bot.name, attackerIsPlayer, false, headshot);
  if (attackerIsPlayer) {
    player.state.money += 150;
    player.state.kills += 1;
    hud.setMoney(player.state.money);
  }
  checkRoundEnd();
}

function killPlayer(attackerName) {
  player.state.alive = false;
  player.state.deaths += 1;
  playerProxy.alive = false;
  hud.killfeed(attackerName || 'Sentinel', 'You', false, true, false);
  const alive = bots.bots.find((b) => b.team === 'vanguard' && b.alive);
  match.spectate = alive || null;
  hud.banner('YOU ARE DOWN', alive ? `Spectating ${alive.name} — round continues` : 'No teammates left');
  checkRoundEnd();
}

function aliveCount(team) {
  let n = team === 'vanguard' && player.state.alive ? 1 : 0;
  n += bots.aliveCount(team);
  return n;
}

function checkRoundEnd() {
  if (match.phase !== 'round') return;
  if (aliveCount('sentinel') === 0) endRound('vanguard', 'Sentinel team eliminated');
  else if (aliveCount('vanguard') === 0) endRound('sentinel', 'Vanguard team eliminated');
}

function startMatch() {
  match.round = 1;
  match.scoreVan = 0;
  match.scoreSen = 0;
  player.state.money = 800;
  player.state.weapons = ['pistol'];
  player.state.current = 'pistol';
  player.state.grenades = 0;
  player.state.armor = 0;
  player.state.kills = 0;
  player.state.deaths = 0;
  rig.equip('pistol');
  startBuyPhase();
}

function startBuyPhase() {
  match.phase = 'buy';
  match.buyTimer = BUY_TIME;
  match.planted = false;
  match.plantProgress = 0;
  player.reset(ATTACKER_SPAWNS[(match.round - 1) % ATTACKER_SPAWNS.length]);
  playerProxy.alive = true;
  match.spectate = null;
  // Death last round costs the primary and the armour; survival keeps them.
  if (player.state.deaths > 0 && match.round > 1) {
    player.state.weapons = ['pistol'];
    player.state.current = 'pistol';
    player.state.armor = 0;
    rig.equip('pistol');
  }
  rig.refill();
  bots.reset(match.round, botEnv());
  hud.setHealth(player.state.hp, player.state.armor);
  hud.setAmmo(rig.state.mag, rig.state.reserve);
  hud.setMoney(player.state.money);
  hud.setWeaponName(rig.state.def.name);
  hud.setScore(match.scoreVan, match.scoreSen, match.round);
  hud.setObjective('BUY PHASE — press B to shop, then take the Reactor');
  hud.setAlive(aliveCount('vanguard'), aliveCount('sentinel'));
  hud.showBuy(player.state.money, { weapons: player.state.weapons, armor: player.state.armor, grenades: player.state.grenades }, buyItem);
  hud.banner(`ROUND ${match.round}`, 'Buy phase — gear up', 2000);
}

function startRound() {
  match.phase = 'round';
  match.roundTimer = ROUND_TIME;
  match.plantTimer = DETONATE_TIME;
  match.planted = false;
  hud.hideBuy();
  hud.setObjective('PLANT THE CHARGE AT THE REACTOR');
  hud.setTimer(match.roundTimer, false);
  hud.banner(`ROUND ${match.round}`, 'Plant the charge or eliminate Sentinel', 2200);
  if (!shot) input.requestLock();
}

function endRound(winner, reason) {
  if (match.phase !== 'round') return;
  match.phase = 'roundEnd';
  match.roundEndTimer = 4;
  match.roundEndReason = reason;
  if (winner === 'vanguard') {
    match.scoreVan += 1;
    player.state.money += 300;
    audio.roundWin();
  } else {
    match.scoreSen += 1;
    player.state.money += 200;
    audio.roundLose();
  }
  hud.setScore(match.scoreVan, match.scoreSen, match.round);
  hud.setMoney(player.state.money);
  hud.setTimer(0, match.planted);
  hud.banner(winner === 'vanguard' ? 'ROUND WON' : 'ROUND LOST', reason, 3600);
  if (match.scoreVan >= WIN_ROUNDS || match.scoreSen >= WIN_ROUNDS) {
    match.phase = 'matchEnd';
    const won = match.scoreVan >= WIN_ROUNDS;
    hud.showOverlay('matchEnd', {
      title: won ? 'MATCH WON' : 'MATCH LOST',
      copy: `Vanguard ${match.scoreVan} — ${match.scoreSen} Sentinel. ${won ? 'Foundry Yard is yours.' : 'Sentinel held the Reactor.'}`,
      action: 'Play again',
    });
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

function buyItem(id) {
  if (match.phase !== 'buy') return;
  const price = id === 'armor' ? ARMOR_PRICE : id === 'grenade' ? GRENADE_PRICE : WEAPONS[id].price;
  if (player.state.money < price) return;
  if (id === 'armor') {
    if (player.state.armor >= 50) return;
    player.state.armor = 50;
  } else if (id === 'grenade') {
    if (player.state.grenades >= 2) return;
    player.state.grenades += 1;
  } else {
    if (player.state.weapons.includes(id)) return;
    player.state.weapons.push(id);
    player.state.current = id;
    rig.equip(id);
    hud.setWeaponName(rig.state.def.name);
    hud.setAmmo(rig.state.mag, rig.state.reserve);
  }
  player.state.money -= price;
  audio.buy();
  hud.updateBuy(player.state.money, { weapons: player.state.weapons, armor: player.state.armor, grenades: player.state.grenades });
}

function throwGrenade() {
  if (match.phase !== 'round' || !player.state.alive || player.state.grenades <= 0) return;
  player.state.grenades -= 1;
  camera.getWorldDirection(direction);
  const origin = camera.position.clone().addScaledVector(direction, 0.5);
  effects.throwGrenade(origin, direction);
  audio.shot(0.9);
}

function explodeGrenade(at, damageAmount, radius) {
  audio.explosion();
  effects.explosion(at);
  bots.hear(at.x, at.z, match.elapsed);
  const victims = [];
  if (player.state.alive) victims.push({ target: player.state, pos: player.body.position, isPlayer: true });
  for (const bot of bots.bots) {
    if (bot.alive) victims.push({ target: bot, pos: bot.body.position, isPlayer: false });
  }
  for (const victim of victims) {
    const dx = victim.pos.x - at.x;
    const dy = victim.pos.y + 1 - at.y;
    const dz = victim.pos.z - at.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > radius) continue;
    const amount = damageAmount * (1 - (d / radius) * 0.7);
    const hitPoint = tmpVec.set(victim.pos.x, victim.pos.y + 1, victim.pos.z);
    if (victim.isPlayer) {
      damage(player.state, amount, 'torso', 'Thunder-1', hitPoint);
    } else {
      damage(victim.target, amount, 'torso', 'You', hitPoint);
    }
  }
}

function botEnv() {
  return {
    time: match.elapsed,
    phase: match.phase,
    planted: match.planted,
    rng,
    raycaster,
    shootables,
    player: playerProxy,
    cameraYaw: player.body.yaw,
    attackerSpawns: ATTACKER_SPAWNS,
    defenderSpawns: DEFENDER_SPAWNS,
    onBotShot(bot, from, to, color) {
      effects.spawnTracer(from, to, color);
      const d = Math.hypot(from.x - player.body.position.x, from.z - player.body.position.z);
      if (d < 40) audio.enemyShot(d);
      bots.hear(from.x, from.z, match.elapsed);
    },
    onDamage(target, amount, part, attacker, point) {
      damage(target === playerProxy ? player.state : target, amount, part, attacker.name, point);
    },
    onActionDone(bot, done) {
      if (done === 'plant') {
        match.planted = true;
        match.plantTimer = DETONATE_TIME;
        player.state.money += 300;
        hud.setMoney(player.state.money);
        hud.banner('CHARGE PLANTED', 'Hold the Reactor for 35 seconds', 3000);
        hud.setObjective('CHARGE PLANTED — HOLD THE SITE');
        audio.plantBeep();
      } else if (done === 'defuse') {
        endRound('sentinel', 'Charge defused by Sentinel');
      }
    },
  };
}

function step(dt) {
  match.elapsed += dt;
  const keys = input.state.keys;

  if (match.phase === 'buy') {
    match.buyTimer -= dt;
    if (input.consume('KeyB')) {
      if (hud.buyVisible()) {
        hud.hideBuy();
        if (!shot) input.requestLock();
      } else {
        hud.showBuy(player.state.money, { weapons: player.state.weapons, armor: player.state.armor, grenades: player.state.grenades }, buyItem);
        input.releaseLock();
      }
    }
    if (match.buyTimer <= 0) startRound();
  }

  if (match.phase === 'round') {
    if (!match.planted) {
      match.roundTimer -= dt;
      if (match.roundTimer <= 0) endRound('sentinel', 'Time expired — charge never planted');
    } else {
      match.plantTimer -= dt;
      if (match.plantTimer <= 0) {
        effects.explosion(new THREE.Vector3(SITE.x, 1, SITE.z));
        audio.explosion();
        endRound('vanguard', 'The Reactor is gone');
      }
    }
    hud.setTimer(match.planted ? match.plantTimer : match.roundTimer, match.planted);

    // Planting: hold E inside the ring.
    if (!match.planted && player.state.alive && keys.has('KeyE')) {
      const dx = player.body.position.x - SITE.x;
      const dz = player.body.position.z - SITE.z;
      if (Math.hypot(dx, dz) < SITE.radius) {
        match.plantProgress += dt;
        hud.setAction('PLANTING CHARGE', match.plantProgress / PLANT_TIME);
        if (match.plantProgress >= PLANT_TIME) {
          match.planted = true;
          match.plantTimer = DETONATE_TIME;
          player.state.money += 300;
          hud.setMoney(player.state.money);
          hud.setAction(null);
          hud.banner('CHARGE PLANTED', 'Hold the Reactor for 35 seconds', 3000);
          hud.setObjective('CHARGE PLANTED — HOLD THE SITE');
          audio.plantBeep();
        }
      } else {
        match.plantProgress = 0;
        hud.setAction(null);
      }
    } else {
      match.plantProgress = 0;
      hud.setAction(null);
    }
  }

  if (match.phase === 'roundEnd') {
    match.roundEndTimer -= dt;
    if (match.roundEndTimer <= 0) {
      match.round += 1;
      startBuyPhase();
    }
  }

  // Movement and shooting, only while the round is live and the player is alive.
  if ((match.phase === 'round' || match.phase === 'buy') && player.state.alive) {
    player.step(dt, keys);
    if (match.phase === 'round') {
      if (input.state.firing) {
        const def = rig.state.def;
        if (def.auto) {
          if (rig.ready()) shoot();
        } else if (!match.prevFiring && rig.ready()) {
          shoot();
        }
      }
      if (keys.has('KeyR')) {
        if (rig.state.reloadLeft === 0 && rig.state.mag < rig.state.def.mag) audio.reload();
        rig.reload();
      }
      if (input.consume('KeyG')) throwGrenade();
      const switchKeys = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
      const switchIds = ['pistol', 'smg', 'rifle', 'sniper'];
      for (let i = 0; i < switchKeys.length; i += 1) {
        if (input.consume(switchKeys[i]) && player.state.weapons.includes(switchIds[i])) {
          player.state.current = switchIds[i];
          rig.equip(switchIds[i]);
          hud.setWeaponName(rig.state.def.name);
          hud.setAmmo(rig.state.mag, rig.state.reserve);
        }
      }
    }
  }
  match.prevFiring = input.state.firing;

  rig.step(dt);
  effects.step(dt, world.colliders, explodeGrenade);
  playerProxy.alive = player.state.alive;
  playerProxy.team = 'vanguard';
  // The bots only play once the match starts; in the menu they stand at spawn.
  if (match.phase === 'buy' || match.phase === 'round' || match.phase === 'roundEnd') {
    const env = botEnv();
    bots.step(dt, env);
  }
  hud.setAlive(aliveCount('vanguard'), aliveCount('sentinel'));
  hud.setCrosshairGap(6 + rig.spread(player.groundSpeed(), input.state.ads) * 2600);
  syncPlayerHitMeshes();
  world.ring.visible = match.phase === 'round' && !match.planted;
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!match.frozen) {
    const look = input.takeLook();
    if (player.state.alive && (match.phase === 'round' || match.phase === 'buy')) {
      player.look(look.x, look.y);
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    // Aim-down-sights: tighten the view and centre the weapon.
    const targetFov = input.state.ads && match.phase === 'round' ? 58 : 74;
    if (Math.abs(camera.fov - targetFov) > 0.1) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 10);
      camera.updateProjectionMatrix();
    }
    syncCamera();
  }
  renderer.render(scene, camera);
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    audio.unlock();
    hud.hideOverlay();
  } else if (match.phase === 'round' && player.state.alive) {
    hud.showOverlay('paused');
  }
}

hud.onPlay(() => {
  audio.unlock();
  if (match.phase === 'menu') {
    startMatch();
    hud.hideOverlay();
    if (!shot) input.requestLock();
  } else if (match.phase === 'matchEnd') {
    hud.hideOverlay();
    startMatch();
    if (!shot) input.requestLock();
  } else {
    hud.hideOverlay();
    if (!shot) input.requestLock();
  }
});

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBanner();
  if (name === 'start') {
    match.phase = 'menu';
    player.body.position.set(0, 0, 14);
    player.body.yaw = 0;
    player.body.pitch = 0;
    settle(10);
    syncCamera();
    hud.showOverlay('start');
  } else if (name === 'play') {
    startMatch();
    match.phase = 'round';
    match.roundTimer = 92;
    hud.hideBuy();
    player.body.position.set(0, 0, 6);
    player.body.yaw = 0;
    player.body.pitch = 0.02;
    // Stage one enemy in the open mid lane and one teammate to the left.
    const foe = bots.bots.find((b) => b.name === 'Onyx');
    foe.body.position.set(1.6, 0, -4.5);
    foe.body.yaw = Math.PI;
    const mate = bots.bots.find((b) => b.name === 'Rook');
    mate.body.position.set(-3.4, 0, 3.5);
    mate.body.yaw = 0.2;
    settle(12);
    aimAt(bots.aimPoint(foe));
    foe.hp = 30; // the staged shot is a real kill: pistol torso damage finishes him
    shoot();
    hud.setTimer(92, false);
    hud.setScore(0, 0, 1);
    hud.setObjective('PLANT THE CHARGE AT THE REACTOR');
  } else if (name === 'buy') {
    startMatch();
    match.round = 2;
    match.scoreVan = 1;
    match.scoreSen = 0;
    player.state.money = 2300;
    player.state.weapons = ['pistol', 'rifle'];
    player.state.current = 'rifle';
    rig.equip('rifle');
    hud.setScore(1, 0, 2);
    hud.setMoney(2300);
    hud.setObjective('BUY PHASE — press B to shop, then take the Reactor');
    hud.showBuy(2300, { weapons: player.state.weapons, armor: 0, grenades: 0 }, buyItem);
    settle(10);
    syncCamera();
  } else if (name === 'end') {
    startMatch();
    match.phase = 'roundEnd';
    match.scoreVan = 1;
    match.roundEndReason = 'Sentinel team eliminated';
    player.body.position.set(0, 0, -8);
    player.body.yaw = 0;
    player.body.pitch = 0;
    settle(10);
    hud.setScore(1, 0, 1);
    hud.setObjective('ROUND WON');
    hud.banner('ROUND WON', 'Sentinel team eliminated', 3600);
    hud.setTimer(0, false);
  }
  paintTwiceThenReady();
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      match.frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
// Clicking the canvas re-locks the mouse when a round is live but the lock was lost.
renderer.domElement.addEventListener('click', () => {
  if (shot) return;
  if ((match.phase === 'round' || match.phase === 'buy') && !input.state.locked && !hud.buyVisible()) {
    input.requestLock();
  }
});
window.addEventListener('error', (event) => {
  window.__error = String(event.message || event.error || 'error');
});

spawnBots();
// In the menu the player is not in the world yet: the bots leave him alone.
player.state.alive = false;
playerProxy.alive = false;
syncCamera();
hud.setHealth(100, 0);
hud.setAmmo(rig.state.mag, rig.state.reserve);
hud.setMoney(800);
hud.setScore(0, 0, 1);
hud.setTimer(ROUND_TIME, false);
hud.setObjective('—');
hud.setWeaponName(rig.state.def.name);
hud.setAlive(3, 4);

let accumulator = 0;
let lastTime = performance.now();
if (shot) runShot(shot);
else {
  hud.showOverlay('start');
  requestAnimationFrame(frame);
}
