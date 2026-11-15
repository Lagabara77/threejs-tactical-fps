// Shared movement and sight math for the player and the bots. One axis-separated
// AABB mover: a body is a box (radius, height) pushed against the world's static boxes
// one axis at a time, so a wall never swallows a body and standing on the floor is not
// read as walking into it. No allocations inside step(): the probe box and the wish
// vector are module-level scratch.
import * as THREE from 'three';

const RADIUS = 0.34;
const GRAVITY = 20;
const probe = new THREE.Box3();

export function makeBody(x, z, height, eye) {
  return {
    position: new THREE.Vector3(x, 0, z),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    height,
    eye,
    onGround: true,
    crouching: false,
  };
}

// Returns the first collider the body's box overlaps, or null. lift keeps the feet and
// the crown out of the horizontal tests.
export function overlaps(colliders, x, y, z, height, lift) {
  probe.min.set(x - RADIUS, y + lift, z - RADIUS);
  probe.max.set(x + RADIUS, y + height - lift, z + RADIUS);
  for (let i = 0; i < colliders.length; i += 1) {
    if (probe.intersectsBox(colliders[i])) return colliders[i];
  }
  return null;
}

// wishX/wishZ are a unit (or zero) horizontal wish direction. groundAccel/airAccel are
// the approach rates, friction the ground damping, speed the target walk speed.
export function moveBody(colliders, body, dt, wishX, wishZ, speed, groundAccel, airAccel, friction, jumpSpeed, wantJump) {
  const blend = Math.min(1, ((body.onGround ? groundAccel : airAccel) * dt) / Math.max(speed, 0.01));
  body.velocity.x += (wishX * speed - body.velocity.x) * blend;
  body.velocity.z += (wishZ * speed - body.velocity.z) * blend;
  if (body.onGround && wishX === 0 && wishZ === 0) {
    const damp = Math.max(0, 1 - friction * dt);
    body.velocity.x *= damp;
    body.velocity.z *= damp;
  }
  if (wantJump && body.onGround) {
    body.velocity.y = jumpSpeed;
    body.onGround = false;
  }
  body.velocity.y -= GRAVITY * dt;

  const nextX = body.position.x + body.velocity.x * dt;
  if (!overlaps(colliders, nextX, body.position.y, body.position.z, body.height, 0.04)) {
    body.position.x = nextX;
  } else {
    body.velocity.x = 0;
  }
  const nextZ = body.position.z + body.velocity.z * dt;
  if (!overlaps(colliders, body.position.x, body.position.y, nextZ, body.height, 0.04)) {
    body.position.z = nextZ;
  } else {
    body.velocity.z = 0;
  }

  body.position.y += body.velocity.y * dt;
  body.onGround = false;
  const hit = overlaps(colliders, body.position.x, body.position.y, body.position.z, body.height, 0);
  if (hit && body.velocity.y <= 0) {
    body.position.y = hit.max.y;
    body.velocity.y = 0;
    body.onGround = true;
  } else if (hit) {
    body.position.y = hit.min.y - body.height;
    body.velocity.y = 0;
  }
  if (body.position.y < 0) {
    body.position.y = 0;
    body.velocity.y = 0;
    body.onGround = true;
  }
  if (body.velocity.y < -30) body.velocity.y = -30;
}

// Line of sight between two points, blocked by any world box. from/to are Vector3s.
// The ray is tested against the colliders' boxes with a slab test, so it never
// allocates a Raycaster.
export function hasLineOfSight(colliders, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const length = Math.hypot(dx, dy, dz);
  if (length < 0.001) return true;
  const invX = 1 / dx;
  const invY = 1 / dy;
  const invZ = 1 / dz;
  for (let i = 0; i < colliders.length; i += 1) {
    const box = colliders[i];
    let tmin = 0;
    let tmax = 1; // parameter space: the segment is t in [0, 1], not [0, length].
    // (Using length here let any wall past the target block the ray.)
    let t1 = (box.min.x - from.x) * invX;
    let t2 = (box.max.x - from.x) * invX;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (Number.isNaN(tmin) || Number.isNaN(tmax) || tmin > tmax) continue;
    t1 = (box.min.y - from.y) * invY;
    t2 = (box.max.y - from.y) * invY;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (Number.isNaN(tmin) || Number.isNaN(tmax) || tmin > tmax) continue;
    t1 = (box.min.z - from.z) * invZ;
    t2 = (box.max.z - from.z) * invZ;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (Number.isNaN(tmin) || Number.isNaN(tmax) || tmin > tmax) continue;
    return false;
  }
  return true;
}

export function groundSpeed(body) {
  return Math.hypot(body.velocity.x, body.velocity.z);
}
