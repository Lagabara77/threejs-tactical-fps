// The arsenal: four guns, armour and a frag grenade. Every gun is a row of numbers
// plus a small box-built view model on the camera; main.js owns the ray and the damage,
// this module owns the numbers, the magazine and the reload. Spread grows with movement
// and with sustained fire, and aiming down sights (right mouse) tightens it — stopping
// to aim pays. A thrown grenade is a separate little physics object in effects.js.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', price: 0, damage: 34, headMult: 3,
    mag: 12, reserve: 48, gap: 0.16, reload: 1.15, auto: false,
    spreadStill: 0.0035, spreadMove: 0.02, spreadBloom: 0.004, range: 60,
    kick: 0.011, tracer: 0xffd27a,
  },
  smg: {
    id: 'smg', name: 'Hornet-9', price: 600, damage: 22, headMult: 2.6,
    mag: 28, reserve: 112, gap: 0.075, reload: 1.6, auto: true,
    spreadStill: 0.006, spreadMove: 0.03, spreadBloom: 0.005, range: 45,
    kick: 0.007, tracer: 0xffd27a,
  },
  rifle: {
    id: 'rifle', name: 'Longbow-47', price: 1500, damage: 36, headMult: 3,
    mag: 30, reserve: 90, gap: 0.1, reload: 2.0, auto: true,
    spreadStill: 0.0022, spreadMove: 0.028, spreadBloom: 0.0035, range: 70,
    kick: 0.01, tracer: 0xffd27a,
  },
  sniper: {
    id: 'sniper', name: 'Needle-50', price: 2200, damage: 95, headMult: 2.5,
    mag: 5, reserve: 15, gap: 1.1, reload: 2.6, auto: false,
    spreadStill: 0.0006, spreadMove: 0.05, spreadBloom: 0.002, range: 90,
    kick: 0.03, tracer: 0x9fd8ff, adsSpread: 0.0001,
  },
};
export const ARMOR_PRICE = 400;
export const GRENADE_PRICE = 300;
export const GRENADE_DAMAGE = 120;
export const GRENADE_RADIUS = 5.5;

const DARK = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.65, metalness: 0.25 });
const LIGHT = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.45, metalness: 0.35 });
const ACCENT = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.amber), roughness: 0.5, metalness: 0.2 });

function buildModel(def) {
  const model = new THREE.Group();
  const add = (w, h, d, x, y, z, mat) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    model.add(mesh);
    return mesh;
  };
  if (def.id === 'pistol') {
    add(0.06, 0.09, 0.26, 0, 0, -0.1, LIGHT);
    add(0.05, 0.12, 0.08, 0, -0.06, 0.06, DARK);
  } else if (def.id === 'smg') {
    add(0.08, 0.09, 0.4, 0, 0, -0.12, DARK);
    add(0.04, 0.04, 0.22, 0, 0.02, -0.4, LIGHT);
    add(0.06, 0.1, 0.1, 0, -0.07, -0.02, DARK);
  } else if (def.id === 'sniper') {
    add(0.07, 0.08, 0.62, 0, 0, -0.18, DARK);
    add(0.05, 0.05, 0.3, 0, 0.01, -0.55, LIGHT);
    add(0.06, 0.06, 0.1, 0, 0.06, -0.2, ACCENT);
    add(0.06, 0.1, 0.12, 0, -0.06, 0.08, DARK);
  } else {
    add(0.09, 0.1, 0.46, 0, 0, -0.14, LIGHT);
    add(0.045, 0.045, 0.34, 0, 0.025, -0.44, DARK);
    add(0.075, 0.08, 0.22, 0, -0.02, 0.26, DARK);
    add(0.05, 0.03, 0.1, 0, 0.065, -0.1, ACCENT);
  }
  model.position.set(0.24, -0.2, -0.42);
  return model;
}

export function createWeaponRig(camera) {
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.amber), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.17, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.amber), 0, 6);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const models = {};
  for (const def of Object.values(WEAPONS)) {
    const model = buildModel(def);
    model.visible = false;
    camera.add(model);
    models[def.id] = model;
  }

  const state = {
    def: WEAPONS.pistol,
    mag: WEAPONS.pistol.mag,
    reserve: WEAPONS.pistol.reserve,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    bloom: 0,
    model: null,
  };

  function equip(id) {
    if (state.model) state.model.visible = false;
    state.def = WEAPONS[id];
    state.mag = state.def.mag;
    state.reserve = state.def.reserve;
    state.cooldown = 0;
    state.reloadLeft = 0;
    state.flash = 0;
    state.bloom = 0;
    state.model = models[id];
    state.model.visible = true;
    state.model.position.set(0.24, -0.2, -0.42);
    state.model.rotation.set(0, 0, 0);
  }
  equip('pistol');

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.bloom = Math.max(0, state.bloom - dt * 0.09);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    state.model.position.z = -0.42 + state.kick;
    state.model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      state.model.rotation.x = -0.55 * Math.min(1, (state.def.reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = state.def.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state,
    step,
    equip,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = state.def.gap;
      state.flash = 0.06;
      state.kick = 0.05 + state.def.kick;
      state.bloom = Math.min(0.03, state.bloom + state.def.spreadBloom);
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag === state.def.mag || state.reserve === 0) return;
      state.reloadLeft = state.def.reload;
    },
    spread(speed, ads) {
      const base = state.def.spreadStill + Math.min(1, speed / 5.2) * state.def.spreadMove + state.bloom;
      if (ads) return Math.min(base, state.def.adsSpread ?? base * 0.35);
      return base;
    },
    refill() {
      state.mag = state.def.mag;
      state.reserve = state.def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.bloom = 0;
    },
  };
}
