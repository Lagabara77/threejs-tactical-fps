// The bots: two Vanguard teammates and four Sentinel defenders, each a little
// soldier of boxes with a role, a waypoint route and a temper. A bot walks the
// waypoint graph (breadth-first path), holds a position and scans, engages what it
// can see with a reaction delay and aim error, investigates gunshots it hears, and
// plants or defuses the charge when its team asks it to. Bots shoot with the same
// raycaster and the same damage rules as the player: a ray from the muzzle, blocked
// by the world, that must actually touch a body.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { makeBody, moveBody, hasLineOfSight } from './physics.js';
import { WAYPOINTS, EDGES, SITE } from './world.js';
import { WEAPONS } from './weapons.js';

const VANGUARD_NAMES = ['Rook', 'Havoc', 'Bishop'];
const SENTINEL_NAMES = ['Wraith', 'Dagger', 'Onyx', 'Vex'];
const WALK_SPEED = 4.3;
const ENGAGE_SPEED = 2.1;
const REACTION_MIN = 0.35;
const REACTION_MAX = 0.75;
const PLANT_TIME = 3;
const DEFUSE_TIME = 4;

const tmpAim = new THREE.Vector3();
const tmpEye = new THREE.Vector3();
const tmpTo = new THREE.Vector3();
const tmpDir = new THREE.Vector3();

function nearestWaypoint(x, z) {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i += 1) {
    const dx = WAYPOINTS[i][0] - x;
    const dz = WAYPOINTS[i][1] - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// Breadth-first path on the waypoint graph, from node a to node b.
export function findPath(a, b) {
  if (a === b) return [a];
  const prev = new Array(WAYPOINTS.length).fill(-1);
  const queue = [a];
  prev[a] = a;
  while (queue.length > 0) {
    const node = queue.shift();
    for (const next of EDGES[node]) {
      if (prev[next] !== -1) continue;
      prev[next] = node;
      if (next === b) {
        const path = [b];
        let at = b;
        while (at !== a) { at = prev[at]; path.unshift(at); }
        return path;
      }
      queue.push(next);
    }
  }
  return [a];
}

function buildFigure(team) {
  const group = new THREE.Group();
  const teamColor = team === 'vanguard' ? PALETTE.amber : PALETTE.teal;
  const suit = new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor), roughness: 0.7, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color('#c9a184'), roughness: 0.8 });

  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.62, 0.18), dark);
  legL.position.set(-0.11, 0.31, 0);
  const legR = legL.clone();
  legR.position.x = 0.11;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.68, 0.3), suit);
  torso.position.y = 1.0;
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.4, 0.32), dark);
  vest.position.y = 1.02;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.24), skin);
  head.position.y = 1.5;
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.26), suit);
  band.position.y = 1.58;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.55), dark);
  gun.position.set(0.2, 1.15, -0.3);
  group.add(legL, legR, torso, vest, head, band, gun);
  group.traverse((mesh) => {
    if (mesh.isMesh) { mesh.castShadow = true; mesh.receiveShadow = true; }
  });

  // A health bar that floats over the head and turns to face the camera.
  const barGroup = new THREE.Group();
  barGroup.position.y = 1.85;
  const barBg = new THREE.Mesh(
    new THREE.BoxGeometry(0.62, 0.09, 0.02),
    new THREE.MeshBasicMaterial({ color: 0x111318, transparent: true, opacity: 0.8 }),
  );
  const barFg = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.06, 0.02),
    new THREE.MeshBasicMaterial({ color: 0x4ade80 }),
  );
  barFg.position.z = 0.012;
  barGroup.add(barBg, barFg);
  group.add(barGroup);

  return { group, torso, head, barGroup, barFg };
}

export function createBots(scene, world) {
  const bots = [];
  const hitMeshes = [];

  function spawn(team, name, spawnPoint, weaponId, role) {
    const figure = buildFigure(team);
    scene.add(figure.group);
    const body = makeBody(spawnPoint.x, spawnPoint.z, 1.72, 1.5);
    body.yaw = spawnPoint.yaw;
    const bot = {
      team,
      name,
      role,
      figure,
      body,
      weapon: WEAPONS[weaponId],
      hp: 100,
      armor: 0,
      alive: true,
      mag: WEAPONS[weaponId].mag,
      cooldown: 0,
      reloadLeft: 0,
      target: null,
      reaction: 0,
      burstLeft: 0,
      burstPause: 0,
      path: [],
      pathIndex: 0,
      holdUntil: 0,
      strafeDir: 1,
      strafeUntil: 0,
      repositionAt: 0,
      action: null,
      actionProgress: 0,
      actionTarget: null,
      fall: 0,
      heardAt: 0,
      heardX: 0,
      heardZ: 0,
      home: nearestWaypoint(spawnPoint.x, spawnPoint.z),
      patrolIndex: 0,
    };
    figure.torso.userData.bot = bot;
    figure.torso.userData.part = 'torso';
    figure.head.userData.bot = bot;
    figure.head.userData.part = 'head';
    hitMeshes.push(figure.torso, figure.head);
    bots.push(bot);
    return bot;
  }

  function setGoal(bot, node, env) {
    const from = nearestWaypoint(bot.body.position.x, bot.body.position.z);
    bot.path = findPath(from, node);
    bot.pathIndex = 0;
  }

  function pickRoleGoal(bot, env) {
    if (bot.team === 'sentinel') {
      if (env.planted) { setGoal(bot, 10, env); return; } // converge on the site
      if (bot.role === 'site') { setGoal(bot, bot.patrolIndex % 2 === 0 ? 18 : 19, env); bot.patrolIndex += 1; return; }
      // patrol: walk a lane loop
      const lanes = bot.role === 'west' ? [3, 4, 5, 6, 18] : [11, 12, 13, 14, 19];
      bot.patrolIndex = (bot.patrolIndex + 1) % lanes.length;
      setGoal(bot, lanes[bot.patrolIndex], env);
      return;
    }
    // Vanguard teammates push the site, each down a different lane.
    const lane = bot.role === 'west' ? 6 : bot.role === 'east' ? 14 : 10;
    setGoal(bot, env.planted ? 10 : lane, env);
  }

  function nearestEnemy(bot, env) {
    let best = null;
    let bestD = Infinity;
    const eye = tmpEye.set(bot.body.position.x, bot.body.position.y + bot.body.eye, bot.body.position.z);
    const candidates = [];
    if (env.player.alive && env.player.team !== bot.team) candidates.push(env.player);
    for (const other of bots) {
      if (other.alive && other.team !== bot.team) candidates.push(other);
    }
    for (const enemy of candidates) {
      const ex = enemy.body.position.x;
      const ey = enemy.body.position.y + enemy.body.eye;
      const ez = enemy.body.position.z;
      const dx = ex - eye.x;
      const dy = ey - eye.y;
      const dz = ez - eye.z;
      const d = Math.hypot(dx, dy, dz);
      if (d > 55) continue;
      tmpTo.set(ex, ey, ez);
      if (!hasLineOfSight(world.colliders, eye, tmpTo)) continue;
      if (d < bestD) { bestD = d; best = enemy; }
    }
    return best ? { enemy: best, distance: bestD } : null;
  }

  function stepBot(bot, dt, env) {
    const body = bot.body;
    if (!bot.alive) {
      if (bot.fall < 1) {
        bot.fall = Math.min(1, bot.fall + dt / 0.4);
        bot.figure.group.rotation.x = -bot.fall * 1.45;
        bot.figure.group.position.y = -bot.fall * 0.08;
      }
      return;
    }
    bot.cooldown = Math.max(0, bot.cooldown - dt);
    bot.burstPause = Math.max(0, bot.burstPause - dt);
    if (bot.reloadLeft > 0) {
      bot.reloadLeft = Math.max(0, bot.reloadLeft - dt);
      if (bot.reloadLeft === 0) bot.mag = bot.weapon.mag;
    }

    // See: pick the nearest visible enemy and start the reaction clock.
    const seen = nearestEnemy(bot, env);
    if (seen) {
      if (bot.target !== seen.enemy) {
        bot.target = seen.enemy;
        bot.reaction = REACTION_MIN + env.rng() * (REACTION_MAX - REACTION_MIN);
      }
      bot.targetDistance = seen.distance;
    } else {
      bot.target = null;
    }

    // Plant / defuse progress: standing still in the ring, uninterrupted.
    if (bot.action) {
      const dx = bot.body.position.x - SITE.x;
      const dz = bot.body.position.z - SITE.z;
      const inRing = Math.hypot(dx, dz) < SITE.radius;
      const foeNear = seen && seen.distance < 18;
      if (!inRing || foeNear) {
        bot.action = null;
        bot.actionProgress = 0;
      } else {
        bot.actionProgress += dt;
        const need = bot.action === 'plant' ? PLANT_TIME : DEFUSE_TIME;
        if (bot.actionProgress >= need) {
          const done = bot.action;
          bot.action = null;
          bot.actionProgress = 0;
          env.onActionDone(bot, done);
        }
      }
    }

    let wishX = 0;
    let wishZ = 0;
    let speed = WALK_SPEED;
    let wantJump = false;

    if (bot.target) {
      // Engage: strafe, keep a fighting distance, shoot in bursts.
      bot.reaction -= dt;
      const enemy = bot.target;
      const dx = enemy.body.position.x - body.position.x;
      const dz = enemy.body.position.z - body.position.z;
      const dist = Math.hypot(dx, dz) || 1;
      const fx = dx / dist;
      const fz = dz / dist;
      body.yaw = Math.atan2(-fx, -fz);
      if (env.time > bot.strafeUntil) {
        bot.strafeDir = env.rng() > 0.5 ? 1 : -1;
        bot.strafeUntil = env.time + 0.7 + env.rng() * 0.9;
      }
      if (dist > 26) { wishX = fx; wishZ = fz; }
      else if (dist < 7) { wishX = -fx; wishZ = -fz; }
      else { wishX = -fz * bot.strafeDir; wishZ = fx * bot.strafeDir; }
      speed = ENGAGE_SPEED;
      if (env.time > bot.repositionAt && dist < 20 && env.rng() < dt * 0.25) {
        bot.repositionAt = env.time + 4;
        const near = nearestWaypoint(body.position.x, body.position.z);
        const alt = EDGES[near][Math.floor(env.rng() * EDGES[near].length)];
        setGoal(bot, alt, env);
      }
      if (bot.reaction <= 0 && bot.cooldown === 0 && bot.reloadLeft === 0 && bot.burstPause === 0) {
        if (bot.burstLeft === 0) bot.burstLeft = 3 + Math.floor(env.rng() * 3);
        bot.burstLeft -= 1;
        if (bot.burstLeft === 0) bot.burstPause = 0.55 + env.rng() * 0.7;
        if (bot.mag === 0) {
          bot.reloadLeft = bot.weapon.reload;
        } else {
          bot.mag -= 1;
          bot.cooldown = bot.weapon.gap;
          fireBot(bot, env);
        }
      }
    } else if (bot.action) {
      // Planting or defusing: stand still and face the reactor.
      const dx = SITE.x - body.position.x;
      const dz = SITE.z - body.position.z;
      body.yaw = Math.atan2(-dx, -dz);
    } else {
      // Walk the route. On arrival, hold a while, then pick the next goal.
      if (bot.pathIndex >= bot.path.length) {
        if (env.time > bot.holdUntil) {
          // Attackers at the site start the plant; defenders at the site hold it.
          const dx = body.position.x - SITE.x;
          const dz = body.position.z - SITE.z;
          if (bot.team === 'vanguard' && Math.hypot(dx, dz) < SITE.radius && !env.planted && env.phase === 'round') {
            bot.action = 'plant';
            bot.actionProgress = 0;
          } else if (bot.team === 'sentinel' && env.planted && Math.hypot(dx, dz) < SITE.radius && env.phase === 'round') {
            bot.action = 'defuse';
            bot.actionProgress = 0;
          } else {
            bot.holdUntil = env.time + 1.5 + env.rng() * 2.5;
            pickRoleGoal(bot, env);
          }
        }
      } else {
        const node = WAYPOINTS[bot.path[bot.pathIndex]];
        const dx = node[0] - body.position.x;
        const dz = node[1] - body.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.5) {
          bot.pathIndex += 1;
        } else {
          wishX = dx / dist;
          wishZ = dz / dist;
          body.yaw = Math.atan2(-wishX, -wishZ);
        }
      }
      // A gunshot heard nearby pulls a bot off its route to look.
      if (env.time < bot.heardAt) {
        const hx = bot.heardX - body.position.x;
        const hz = bot.heardZ - body.position.z;
        if (Math.hypot(hx, hz) > 2) {
          const d = Math.hypot(hx, hz) || 1;
          wishX = hx / d;
          wishZ = hz / d;
          body.yaw = Math.atan2(-wishX, -wishZ);
        }
      }
    }

    moveBody(world.colliders, body, dt, wishX, wishZ, speed, 30, 8, 8, 6.2, wantJump);

    // Light separation so bots do not stack on one another.
    for (const other of bots) {
      if (other === bot || !other.alive) continue;
      const dx = body.position.x - other.body.position.x;
      const dz = body.position.z - other.body.position.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 0.49 && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        const push = (0.7 - d) * 0.5;
        body.position.x += (dx / d) * push * dt * 10;
        body.position.z += (dz / d) * push * dt * 10;
      }
    }

    // Pose the figure: position, facing, a walk bob, and the health bar.
    const figure = bot.figure.group;
    figure.position.set(body.position.x, body.position.y, body.position.z);
    figure.rotation.y = body.yaw;
    const moving = Math.hypot(body.velocity.x, body.velocity.z);
    figure.position.y += Math.abs(Math.sin(env.time * 9 + bot.patrolIndex)) * 0.03 * Math.min(1, moving / 4);
    bot.figure.barGroup.rotation.y = -body.yaw + env.cameraYaw;
    const hpFrac = Math.max(0, bot.hp / 100);
    bot.figure.barFg.scale.x = Math.max(0.02, hpFrac);
    bot.figure.barFg.position.x = -0.3 * (1 - hpFrac);
    bot.figure.barFg.material.color.setHex(hpFrac > 0.5 ? 0x4ade80 : hpFrac > 0.25 ? 0xf0a830 : 0xe5484d);
  }

  function fireBot(bot, env) {
    const enemy = bot.target;
    if (!enemy) return;
    const eye = tmpEye.set(bot.body.position.x, bot.body.position.y + bot.body.eye, bot.body.position.z);
    // Aim at the torso, sometimes the head, with an error that grows with distance
    // and with how fast the target is moving.
    const moving = enemy.body ? Math.hypot(enemy.body.velocity.x, enemy.body.velocity.z) : 0;
    const err = 0.012 + bot.targetDistance * 0.0011 + moving * 0.0012;
    const aimY = enemy.body.position.y + enemy.body.eye - 0.35 + (env.rng() < 0.14 ? 0.42 : 0);
    tmpAim.set(
      enemy.body.position.x - eye.x + (env.rng() * 2 - 1) * err * bot.targetDistance,
      aimY - eye.y + (env.rng() * 2 - 1) * err * bot.targetDistance,
      enemy.body.position.z - eye.z + (env.rng() * 2 - 1) * err * bot.targetDistance,
    ).normalize();
    env.raycaster.set(eye, tmpAim);
    env.raycaster.far = bot.weapon.range;
    const hits = env.raycaster.intersectObjects(env.shootables, false);
    const first = hits[0];
    const end = first ? first.point : tmpDir.copy(eye).addScaledVector(tmpAim, bot.weapon.range);
    env.onBotShot(bot, eye, end, bot.weapon.tracer);
    if (!first) return;
    const hitBot = first.object.userData.bot;
    const part = first.object.userData.part;
    if (hitBot) {
      env.onDamage(hitBot, bot.weapon.damage, part, bot, first.point);
    } else if (first.object.userData.isPlayer) {
      env.onDamage(env.player, bot.weapon.damage, part, bot, first.point);
    }
  }

  function hear(x, z, time) {
    for (const bot of bots) {
      if (!bot.alive || bot.target) continue;
      const dx = bot.body.position.x - x;
      const dz = bot.body.position.z - z;
      if (dx * dx + dz * dz < 30 * 30) {
        bot.heardAt = time + 3.5;
        bot.heardX = x;
        bot.heardZ = z;
      }
    }
  }

  function reset(round, env) {
    for (const bot of bots) {
      const teamBots = bots.filter((b) => b.team === bot.team);
      const spawnList = bot.team === 'vanguard' ? env.attackerSpawns : env.defenderSpawns;
      const spawnPoint = spawnList[teamBots.indexOf(bot) % spawnList.length];
      bot.body.position.set(spawnPoint.x, 0, spawnPoint.z);
      bot.body.velocity.set(0, 0, 0);
      bot.body.yaw = spawnPoint.yaw;
      bot.hp = 100;
      bot.armor = 0;
      bot.alive = true;
      bot.mag = bot.weapon.mag;
      bot.cooldown = 0;
      bot.reloadLeft = 0;
      bot.target = null;
      bot.burstLeft = 0;
      bot.burstPause = 0;
      bot.path = [];
      bot.pathIndex = 0;
      bot.holdUntil = 0;
      bot.action = null;
      bot.actionProgress = 0;
      bot.fall = 0;
      bot.heardAt = 0;
      bot.figure.group.rotation.set(0, bot.body.yaw, 0);
      bot.figure.group.position.set(spawnPoint.x, 0, spawnPoint.z);
      bot.figure.barGroup.visible = true;
      pickRoleGoal(bot, env);
    }
  }

  return {
    bots,
    hitMeshes,
    spawn,
    hear,
    reset,
    step(dt, env) {
      for (const bot of bots) stepBot(bot, dt, env);
    },
    aliveCount(team) {
      let n = 0;
      for (const bot of bots) if (bot.team === team && bot.alive) n += 1;
      return n;
    },
    aimPoint(bot) {
      return new THREE.Vector3(bot.body.position.x, bot.body.position.y + 1.1, bot.body.position.z);
    },
    hideBars() {
      for (const bot of bots) bot.figure.barGroup.visible = false;
    },
  };
}
