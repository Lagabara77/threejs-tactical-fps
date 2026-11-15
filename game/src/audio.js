// Synthesized sound, no audio files: every effect is a small WebAudio graph built on
// the fly (noise through a filter for shots and the explosion, short oscillators for
// beeps and the round jingle). The context is created on the first user gesture; in
// shot mode there is no gesture, so every call is a safe no-op.
export function createAudio() {
  let ctx = null;
  let master = null;

  function ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.35;
      master.connect(ctx.destination);
      return true;
    } catch {
      return false;
    }
  }

  function noiseBuffer(seconds) {
    const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function shot(pitch) {
    if (!ensure() || ctx.state === 'suspended') return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(0.12);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(3200 * pitch, t);
    filter.frequency.exponentialRampToValueAtTime(320, t + 0.1);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.9, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    src.connect(filter).connect(gain).connect(master);
    src.start(t);
    src.stop(t + 0.12);
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(160 * pitch, t);
    thump.frequency.exponentialRampToValueAtTime(55, t + 0.09);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.5, t);
    tg.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    thump.connect(tg).connect(master);
    thump.start(t);
    thump.stop(t + 0.11);
  }

  function beep(freq, seconds, volume, type = 'sine') {
    if (!ensure() || ctx.state === 'suspended') return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + seconds);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + seconds + 0.02);
  }

  return {
    unlock() {
      ensure();
      if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    },
    shot,
    enemyShot(distance) {
      shot(0.8 + Math.min(0.4, distance / 60));
    },
    hit() {
      beep(1400, 0.05, 0.25, 'square');
    },
    kill() {
      beep(880, 0.09, 0.3);
      setTimeout(() => beep(1320, 0.12, 0.3), 70);
    },
    hurt() {
      beep(180, 0.12, 0.4, 'sawtooth');
    },
    reload() {
      beep(500, 0.04, 0.2, 'square');
      setTimeout(() => beep(700, 0.04, 0.2, 'square'), 350);
    },
    plantBeep() {
      beep(1100, 0.07, 0.3, 'square');
    },
    explosion() {
      if (!ensure() || ctx.state === 'suspended') return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(0.7);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(900, t);
      filter.frequency.exponentialRampToValueAtTime(90, t + 0.6);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(1, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
      src.connect(filter).connect(gain).connect(master);
      src.start(t);
      src.stop(t + 0.7);
    },
    roundWin() {
      beep(523, 0.12, 0.3);
      setTimeout(() => beep(659, 0.12, 0.3), 120);
      setTimeout(() => beep(784, 0.22, 0.3), 240);
    },
    roundLose() {
      beep(392, 0.16, 0.3);
      setTimeout(() => beep(311, 0.28, 0.3), 160);
    },
    buy() {
      beep(980, 0.06, 0.25, 'square');
    },
  };
}
