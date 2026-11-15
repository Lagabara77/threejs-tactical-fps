// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, score, kill feed,
// banners, the buy menu and every overlay panel. It never touches the simulation;
// main.js pushes numbers in and reads the button callbacks out.
import { WEAPONS, ARMOR_PRICE, GRENADE_PRICE } from './weapons.js';

// In shot mode (?shot=...) the capture happens seconds after the staged action, so
// the timed fade-outs (hit marker, banner, kill feed, damage flash) are disabled:
// the frame must still show them when it is taken.
const SHOT_MODE = new URLSearchParams(window.location.search).has('shot');

const BUY_ITEMS = [
  { id: 'smg', label: 'Hornet-9 SMG', price: WEAPONS.smg.price, desc: 'Fast, close quarters. 28 rounds.' },
  { id: 'rifle', label: 'Longbow-47 Rifle', price: WEAPONS.rifle.price, desc: 'The all-rounder. 30 rounds.' },
  { id: 'sniper', label: 'Needle-50 Sniper', price: WEAPONS.sniper.price, desc: 'One shot, long range. 5 rounds.' },
  { id: 'armor', label: 'Plate Armour', price: ARMOR_PRICE, desc: 'Absorbs half of all damage.' },
  { id: 'grenade', label: 'Thunder-1 Frag', price: GRENADE_PRICE, desc: 'Throw with G. Blast radius 5 m.' },
];

const COPY = {
  start: {
    title: 'EMBERLINE',
    copy: 'Foundry Yard. Vanguard attacks the Reactor; Sentinel defends it. Plant the charge or wipe the enemy team — first to 5 rounds takes the match.',
    action: 'Deploy',
  },
  paused: {
    title: 'EMBERLINE',
    copy: 'Paused. Click to resume.',
    action: 'Resume',
  },
  roundEnd: { title: '', copy: '', action: '' },
  matchEnd: { title: '', copy: '', action: 'Play again' },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const overlayTitle = $('overlay-title');
  const overlayCopy = $('overlay-copy');
  const playBtn = $('play');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const killfeed = $('killfeed');
  const buyPanel = $('buy');
  const buyList = $('buy-list');
  const buyMoney = $('buy-money');
  const actionBar = $('action-bar');
  const actionLabel = $('action-label');
  const actionFill = $('action-fill');
  const damageVignette = $('damage');
  const damageDir = $('damage-dir');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  let hitTimer = 0;
  let bannerTimer = 0;
  let last = {};

  function setText(el, key, value) {
    if (last[key] === value) return;
    last[key] = value;
    el.textContent = value;
  }

  function buildBuy(onBuy) {
    buyList.innerHTML = '';
    for (const item of BUY_ITEMS) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'buy-row';
      row.dataset.id = item.id;
      row.innerHTML = `<span class="buy-name">${item.label}</span><span class="buy-desc">${item.desc}</span><span class="buy-price">$${item.price}</span>`;
      row.addEventListener('click', () => onBuy(item.id));
      buyList.appendChild(row);
    }
  }

  return {
    setHealth(hp, armor) {
      setText($('health-value'), 'hp', String(Math.max(0, Math.ceil(hp))));
      $('health-fill').style.width = `${Math.max(0, Math.min(100, hp))}%`;
      $('armor-fill').style.width = `${Math.max(0, Math.min(100, armor))}%`;
      $('health').classList.toggle('low', hp <= 30);
    },
    setAmmo(mag, reserve) {
      setText($('ammo-mag'), 'mag', String(mag));
      setText($('ammo-reserve'), 'res', `/ ${reserve}`);
      $('ammo').classList.toggle('empty', mag === 0);
    },
    setMoney(n) {
      setText($('money-value'), 'money', `$${n}`);
      setText(buyMoney, 'buyMoney', `$${n}`);
    },
    setTimer(seconds, planted) {
      const s = Math.max(0, Math.ceil(seconds));
      const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      setText($('timer-value'), 'timer', text);
      $('timer').classList.toggle('planted', planted);
    },
    setScore(van, sen, round) {
      setText($('score-nums'), 'score', `${van} — ${sen}`);
      setText($('round-value'), 'round', `ROUND ${round}`);
    },
    setAlive(van, sen) {
      setText($('alive-van'), 'aliveVan', String(van));
      setText($('alive-sen'), 'aliveSen', String(sen));
    },
    setObjective(text) {
      setText($('objective-value'), 'objective', text);
    },
    setWeaponName(name) {
      setText($('weapon-name'), 'weapon', name);
    },
    setCrosshairGap(px) {
      crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.classList.toggle('kill', killed);
      if (SHOT_MODE) return;
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
    },
    damageFlash(angleRad) {
      damageVignette.classList.add('on');
      damageDir.style.transform = `translate(-50%, -50%) rotate(${angleRad}rad)`;
      damageDir.classList.add('on');
      if (SHOT_MODE) return;
      setTimeout(() => {
        damageVignette.classList.remove('on');
        damageDir.classList.remove('on');
      }, 220);
    },
    killfeed(killer, victim, killerIsPlayer, victimIsPlayer, headshot) {
      const row = document.createElement('div');
      row.className = 'feed-row';
      const k = killerIsPlayer ? `<b class="you">${killer}</b>` : killer;
      const v = victimIsPlayer ? `<b class="you">${victim}</b>` : victim;
      row.innerHTML = `${k} <span class="feed-sep">${headshot ? '◉' : '▸'}</span> ${v}`;
      killfeed.prepend(row);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
      if (!SHOT_MODE) setTimeout(() => row.remove(), 6000);
    },
    banner(title, sub, ms = 2600) {
      bannerTitle.textContent = title;
      bannerSub.textContent = sub;
      banner.hidden = false;
      if (SHOT_MODE) return;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => { banner.hidden = true; }, ms);
    },
    hideBanner() {
      clearTimeout(bannerTimer);
      banner.hidden = true;
    },
    setAction(label, frac) {
      if (frac == null) {
        actionBar.hidden = true;
        return;
      }
      actionBar.hidden = false;
      actionLabel.textContent = label;
      actionFill.style.width = `${Math.round(frac * 100)}%`;
    },
    showOverlay(mode, data = {}) {
      if (mode === 'roundEnd' || mode === 'matchEnd') {
        overlayTitle.textContent = data.title;
        overlayCopy.textContent = data.copy;
        playBtn.textContent = data.action || 'Continue';
      } else {
        const text = COPY[mode];
        overlayTitle.textContent = text.title;
        overlayCopy.textContent = text.copy;
        playBtn.textContent = text.action;
      }
      overlay.hidden = false;
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      playBtn.addEventListener('click', handler);
    },
    showBuy(money, owned, onBuy) {
      buildBuy(onBuy);
      this.updateBuy(money, owned);
      buyPanel.hidden = false;
    },
    updateBuy(money, owned) {
      this.setMoney(money);
      for (const row of buyList.children) {
        const id = row.dataset.id;
        const price = BUY_ITEMS.find((item) => item.id === id).price;
        const isOwned = id === 'armor' ? owned.armor > 0 : id === 'grenade' ? owned.grenades > 0 : owned.weapons.includes(id);
        row.classList.toggle('owned', isOwned);
        row.classList.toggle('cant', !isOwned && money < price);
        row.querySelector('.buy-price').textContent = isOwned ? 'OWNED' : `$${price}`;
      }
    },
    hideBuy() {
      buyPanel.hidden = true;
    },
    buyVisible() {
      return !buyPanel.hidden;
    },
  };
}
