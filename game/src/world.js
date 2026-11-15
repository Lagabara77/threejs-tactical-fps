// Foundry Yard: a 48 x 36 m dusk industrial yard with three lanes, a central plaza and
// the Reactor site at the north end. Vanguard attacks from the south, Sentinel defends
// the north. Every box is a collider and a surface a bullet stops on; the waypoint graph
// is what the bots walk. Plain geometry only, no models, no textures.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoints: [x, z]. The bots walk these; main.js uses SPAWNS to place the teams.
export const WAYPOINTS = [
  [0, 14], [-7, 14], [7, 14], // 0-2 attacker spawn
  [-16, 10], [-16, 2], [-16, -6], [-12, -11], // 3-6 west lane
  [0, 8], [0, 0], [0, -6], [0, -11], // 7-10 mid lane + site
  [16, 10], [16, 2], [16, -6], [12, -11], // 11-14 east lane
  [0, -15], [-8, -14], [8, -14], // 15-17 defender spawn
  [-4, -11], [4, -11], // 18-19 site flanks
  [-10, 4], [10, 4], // 20-21 cross connectors
  [-8, -2], [8, -2], // 22-23 mid cross
];
export const EDGES = [
  [1, 2, 7, 3, 11], // 0
  [0, 3, 20], // 1
  [0, 11, 21], // 2
  [0, 1, 4, 20], // 3
  [3, 5, 20, 22], // 4
  [4, 6, 22], // 5
  [5, 18, 10], // 6
  [0, 8, 20, 21], // 7
  [7, 9, 22, 23], // 8
  [8, 10, 22, 23], // 9
  [9, 6, 14, 18, 19], // 10
  [0, 2, 12, 21], // 11
  [11, 13, 21, 23], // 12
  [12, 14, 23], // 13
  [13, 19, 10], // 14
  [16, 17, 18, 19], // 15
  [15, 17, 18], // 16
  [15, 16, 19], // 17
  [6, 10, 15, 16], // 18
  [10, 14, 15, 17], // 19
  [1, 3, 4, 7, 22], // 20
  [2, 11, 12, 7, 23], // 21
  [4, 5, 8, 9, 20], // 22
  [12, 13, 8, 9, 21], // 23
];

export const ATTACKER_SPAWNS = [
  { x: 0, z: 14, yaw: 0 },
  { x: -7, z: 14, yaw: 0 },
  { x: 7, z: 14, yaw: 0 },
];
export const DEFENDER_SPAWNS = [
  { x: 0, z: -15, yaw: Math.PI },
  { x: -8, z: -14, yaw: Math.PI },
  { x: 8, z: -14, yaw: Math.PI },
];
export const SITE = { x: 0, z: -11.5, radius: 3.2 };

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const mats = {};
  for (const name of Object.keys(PALETTE)) {
    mats[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'amber' || name === 'teal' || name === 'reactor' ? 0.5 : 0.92,
      metalness: name === 'container' || name === 'containerAlt' ? 0.25 : 0.04,
    });
  }
  const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.reactor) });

  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, mat, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[mat]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (collide) {
      colliders.push(new THREE.Box3().setFromObject(mesh));
      shootables.push(mesh);
    }
    return mesh;
  }

  // Ground, painted lane strips and the outer walls.
  box(48.6, 0.4, 36.6, 0, -0.2, 0, 'floor');
  box(2.2, 0.02, 30, -16, 0.01, 0, 'floorDark', false);
  box(2.2, 0.02, 30, 16, 0.01, 0, 'floorDark', false);
  box(2.2, 0.02, 30, 0, 0.01, 0, 'floorDark', false);
  box(0.6, 5, 36.6, -24.3, 2.5, 0, 'surface');
  box(0.6, 5, 36.6, 24.3, 2.5, 0, 'surface');
  box(48.6, 5, 0.6, 0, 2.5, -18.3, 'surface');
  box(48.6, 5, 0.6, 0, 2.5, 18.3, 'surface');

  // The Reactor: a glowing core at the north end, flanked by pocket walls.
  box(2.6, 2.8, 2.6, 0, 1.4, -13.5, 'hairline');
  const core = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.6, 1.2), glowMat);
  core.position.set(0, 1.1, -13.5);
  group.add(core);
  box(0.5, 1.2, 0.5, 0, 3.2, -13.5, 'reactor');
  box(0.5, 3.4, 4.5, -4.6, 1.7, -12.5, 'surface');
  box(0.5, 3.4, 4.5, 4.6, 1.7, -12.5, 'surface');
  box(9.2, 0.5, 0.5, 0, 3.9, -12.5, 'surface');

  // Mid plaza: a pillar, a low platform to jump on, and lane walls with gaps.
  box(1.6, 3.4, 1.6, 0, 1.7, 0, 'hairline');
  box(6, 0.5, 3, 0, 0.25, 5, 'surface');
  box(3.2, 1.1, 0.8, -6, 0.55, -3, 'hairline');
  box(3.2, 1.1, 0.8, 6, 0.55, -3, 'hairline');
  box(0.8, 2.6, 5, -9.5, 1.3, 7, 'container');
  box(0.8, 2.6, 5, 9.5, 1.3, 7, 'containerAlt');

  // West lane: crates to crouch behind, one tall container.
  box(1.2, 1.1, 1.2, -16, 0.55, 6, 'crate');
  box(1.2, 1.1, 1.2, -18, 0.55, -2, 'crate');
  box(1.2, 1.1, 1.2, -14, 0.55, -8, 'crate');
  box(2.4, 2.4, 2.4, -19.5, 1.2, -9.5, 'container');
  box(2.2, 0.9, 1.1, -12, 0.45, 3, 'crate');

  // East lane: containers and crates, mirrored but not identical.
  box(2.4, 2.4, 2.4, 18.5, 1.2, 5.5, 'containerAlt');
  box(1.2, 1.1, 1.2, 14, 0.55, -1, 'crate');
  box(1.2, 1.1, 1.2, 17, 0.55, -7, 'crate');
  box(3.4, 1.1, 0.9, 12, 0.55, -9, 'crate');
  box(1.2, 1.1, 1.2, 10, 0.55, 9, 'crate');

  // South cover near the attacker spawn.
  box(2.4, 0.9, 1.2, -3.5, 0.45, 10.5, 'crate');
  box(2.4, 0.9, 1.2, 3.5, 0.45, 10.5, 'crate');

  // Distant skyline silhouettes, outside the walls, no collision.
  const skyline = [[-32, -26, 10, 22], [30, -24, 12, 18], [-34, 20, 8, 16], [33, 22, 9, 20], [0, -34, 14, 26]];
  for (const [x, z, w, h] of skyline) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, 2), mats.surface);
    mesh.position.set(x, h / 2 - 1, z);
    group.add(mesh);
  }
  // A gantry beam across the mid lane, high above the action.
  box(30, 0.8, 1.2, 0, 6.4, 0, 'hairline', false);

  // Light: dusk hemisphere, a warm key with shadows, a cool fill, the reactor glow.
  const sky = new THREE.HemisphereLight(new THREE.Color('#4a5568'), new THREE.Color(PALETTE.canvas), 0.95);
  scene.add(sky);
  const key = new THREE.DirectionalLight(new THREE.Color('#ffd9a0'), 2.0);
  key.position.set(16, 20, 12);
  key.target.position.set(0, 0, -4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -30;
  key.shadow.camera.right = 30;
  key.shadow.camera.top = 24;
  key.shadow.camera.bottom = -24;
  key.shadow.camera.far = 70;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#7fa3c0'), 0.5);
  fill.position.set(-14, 12, -10);
  scene.add(fill);
  const reactorLight = new THREE.PointLight(new THREE.Color(PALETTE.reactor), 26, 20, 1.6);
  reactorLight.position.set(0, 2.4, -12.5);
  scene.add(reactorLight);

  // The plant ring on the floor, shown while a plant or defuse is in progress.
  const ringGeo = new THREE.RingGeometry(SITE.radius - 0.18, SITE.radius, 48);
  const ringMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(PALETTE.reactor),
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(SITE.x, 0.03, SITE.z);
  ring.visible = false;
  group.add(ring);

  return { colliders, shootables, group, ring };
}
