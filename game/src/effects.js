// Tracers, muzzle sparks, blood puffs, explosion debris and the thrown grenade.
// Everything is pooled and reused: no mesh is created inside the frame loop. A tracer
// is a stretched box that fades in 80 ms; a burst is a handful of small boxes with a
// velocity and a lifetime; the grenade is one mesh with its own little arc physics.
import * as THREE from 'three';
import { GRENADE_DAMAGE, GRENADE_RADIUS } from './weapons.js';

const TRACER_COUNT = 24;
const PARTICLE_COUNT = 90;
const tracerGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
const particleGeo = new THREE.BoxGeometry(0.07, 0.07, 0.07);
const tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false });
const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0 });
const puffMat = new THREE.MeshBasicMaterial({ color: 0xd95555, transparent: true, opacity: 0 });
const debrisMat = new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0 });
const smokeMat = new THREE.MeshBasicMaterial({ color: 0x8a8f96, transparent: true, opacity: 0 });

const tmpDir = new THREE.Vector3();
const tmpMid = new THREE.Vector3();

export function createEffects(scene) {
  const tracers = [];
  for (let i = 0; i < TRACER_COUNT; i += 1) {
    const mesh = new THREE.Mesh(tracerGeo, tracerMat.clone());
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0 });
  }
  const particles = [];
  for (let i = 0; i < PARTICLE_COUNT; i += 1) {
    const mesh = new THREE.Mesh(particleGeo, sparkMat.clone());
    mesh.visible = false;
    scene.add(mesh);
    particles.push({ mesh, life: 0, max: 1, vel: new THREE.Vector3() });
  }
  let tracerCursor = 0;
  let particleCursor = 0;

  // A grenade: one dark sphere with an orange band, thrown on an arc, 1.6 s fuse.
  const grenade = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 10, 8),
    new THREE.MeshStandardMaterial({ color: 0x2c323a, roughness: 0.5, metalness: 0.4 }),
  );
  grenade.visible = false;
  scene.add(grenade);
  const grenadeState = { active: false, fuse: 0, vel: new THREE.Vector3(), pos: new THREE.Vector3() };

  function spawnTracer(from, to, color) {
    const slot = tracers[tracerCursor];
    tracerCursor = (tracerCursor + 1) % TRACER_COUNT;
    tmpDir.subVectors(to, from);
    const length = tmpDir.length();
    if (length < 0.1) return;
    tmpMid.addVectors(from, to).multiplyScalar(0.5);
    slot.mesh.position.copy(tmpMid);
    slot.mesh.lookAt(to);
    slot.mesh.scale.set(1, 1, length);
    slot.mesh.material.color.setHex(color);
    slot.mesh.material.opacity = 0.85;
    slot.mesh.visible = true;
    slot.life = 0.08;
  }

  function burst(point, material, count, speed, life, up) {
    for (let n = 0; n < count; n += 1) {
      const slot = particles[particleCursor];
      particleCursor = (particleCursor + 1) % PARTICLE_COUNT;
      slot.mesh.material = material;
      slot.mesh.position.copy(point);
      slot.mesh.visible = true;
      slot.mesh.material.opacity = 1;
      slot.vel.set((Math.random() * 2 - 1) * speed, Math.random() * speed * up, (Math.random() * 2 - 1) * speed);
      slot.life = life * (0.6 + Math.random() * 0.7);
      slot.max = slot.life;
    }
  }

  function throwGrenade(origin, direction) {
    grenadeState.active = true;
    grenadeState.fuse = 1.6;
    grenadeState.pos.copy(origin);
    grenadeState.vel.copy(direction).multiplyScalar(13);
    grenadeState.vel.y += 3.2;
    grenade.visible = true;
    grenade.position.copy(origin);
  }

  function step(dt, colliders, onExplode) {
    for (const slot of tracers) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      slot.mesh.material.opacity = Math.max(0, slot.life / 0.08) * 0.85;
      if (slot.life <= 0) slot.mesh.visible = false;
    }
    for (const slot of particles) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      slot.vel.y -= 9 * dt;
      slot.mesh.position.addScaledVector(slot.vel, dt);
      slot.mesh.material.opacity = Math.max(0, slot.life / slot.max);
      if (slot.mesh.position.y < 0.04) {
        slot.mesh.position.y = 0.04;
        slot.vel.y *= -0.3;
        slot.vel.x *= 0.7;
        slot.vel.z *= 0.7;
      }
      if (slot.life <= 0) slot.mesh.visible = false;
    }
    if (grenadeState.active) {
      grenadeState.fuse -= dt;
      grenadeState.vel.y -= 12 * dt;
      grenadeState.pos.addScaledVector(grenadeState.vel, dt);
      if (grenadeState.pos.y < 0.09) {
        grenadeState.pos.y = 0.09;
        grenadeState.vel.y *= -0.45;
        grenadeState.vel.x *= 0.7;
        grenadeState.vel.z *= 0.7;
      }
      grenade.position.copy(grenadeState.pos);
      grenade.rotation.x += dt * 9;
      if (grenadeState.fuse <= 0) {
        grenadeState.active = false;
        grenade.visible = false;
        const at = grenadeState.pos.clone();
        burst(at, debrisMat, 22, 7, 0.7, 1.2);
        burst(at, smokeMat, 10, 2.5, 1.1, 1.4);
        onExplode(at, GRENADE_DAMAGE, GRENADE_RADIUS);
      }
    }
  }

  return {
    step,
    spawnTracer,
    throwGrenade,
    impact(point) {
      burst(point, sparkMat, 6, 3, 0.35, 0.8);
    },
    blood(point) {
      burst(point, puffMat, 8, 2.4, 0.45, 0.9);
    },
    explosion(point) {
      burst(point, debrisMat, 22, 7, 0.7, 1.2);
      burst(point, smokeMat, 10, 2.5, 1.1, 1.4);
    },
    grenadeActive() {
      return grenadeState.active;
    },
  };
}
