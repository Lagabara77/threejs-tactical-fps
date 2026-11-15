// The player: a body from physics.js plus crouch, look and recoil. Movement is
// acceleration, friction, gravity and jump, resolved as a box against the world's
// colliders one axis at a time. Crouching lowers the body and the eye; standing back
// up is refused while a ceiling would clip the head.
import * as THREE from 'three';
import { makeBody, moveBody, overlaps, groundSpeed } from './physics.js';

const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;
const JUMP_SPEED = 6.2;

export function createPlayer(colliders, spawn) {
  const body = makeBody(spawn.x, spawn.z, STAND_HEIGHT, STAND_EYE);
  body.yaw = spawn.yaw;
  const state = {
    body,
    hp: 100,
    armor: 0,
    alive: true,
    money: 800,
    weapons: ['pistol'],
    current: 'pistol',
    grenades: 0,
    kills: 0,
    deaths: 0,
  };
  const eye = { current: STAND_EYE };

  function look(dx, dy, sensitivity = 0.0022) {
    body.yaw -= dx * sensitivity;
    body.pitch = Math.max(-1.45, Math.min(1.45, body.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    body.pitch = Math.min(1.45, body.pitch + pitchKick);
    body.yaw += yawKick;
  }

  function step(dt, keys) {
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (crouching && !body.crouching) {
      body.crouching = true;
      body.height = CROUCH_HEIGHT;
    } else if (!crouching && body.crouching && !overlaps(colliders, body.position.x, body.position.y, body.position.z, STAND_HEIGHT, 0.02)) {
      body.crouching = false;
      body.height = STAND_HEIGHT;
    }
    const eyeTarget = body.crouching ? CROUCH_EYE : STAND_EYE;
    eye.current += (eyeTarget - eye.current) * Math.min(1, dt * 12);
    body.eye = eye.current;

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    let wishX = 0;
    let wishZ = 0;
    if (forward || strafe) {
      const sin = Math.sin(body.yaw);
      const cos = Math.cos(body.yaw);
      const len = Math.hypot(forward, strafe) || 1;
      wishX = (-sin * forward + cos * strafe) / len;
      wishZ = (-cos * forward - sin * strafe) / len;
    }
    const speed = body.crouching ? CROUCH_SPEED : WALK_SPEED;
    moveBody(colliders, body, dt, wishX, wishZ, speed, 42, 9, 9, JUMP_SPEED, keys.has('Space'));
  }

  return {
    state,
    body,
    step,
    look,
    recoil,
    groundSpeed() {
      return groundSpeed(body);
    },
    reset(spawnPoint) {
      body.position.set(spawnPoint.x, 0, spawnPoint.z);
      body.velocity.set(0, 0, 0);
      body.yaw = spawnPoint.yaw;
      body.pitch = 0;
      body.height = STAND_HEIGHT;
      body.eye = STAND_EYE;
      body.crouching = false;
      body.onGround = true;
      state.hp = 100;
      state.alive = true;
    },
  };
}
