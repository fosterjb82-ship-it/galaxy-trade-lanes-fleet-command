// Music and sound effects, synthesised with the Web Audio API (no audio
// files). Browsers only allow audio after the player interacts with the page,
// so nothing plays until the first click or key press.
//
//   sound.sfx('laser')          one-shot effect
//   sound.settings / sound.set({ enabled, music, sfx, musicOn, sfxOn })
//
// The music is a slow generative ambient piece: a pad of detuned saws through
// a drifting low-pass filter, a sub bass, and a sparse plucked arpeggio with
// echoes, all through a synthetic reverb. It never repeats exactly.

const KEY = 'fleetcommand.sound';
const DEFAULTS = { enabled: true, musicOn: true, sfxOn: true, music: 0.5, sfx: 0.7 };

function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}

const midi = (n) => 440 * 2 ** ((n - 69) / 12);

// Chord progressions (MIDI notes). Natural minor around A, with colour tones.
const PROGRESSIONS = [
  [[57, 60, 64, 71], [53, 57, 60, 64], [48, 55, 59, 64], [55, 59, 62, 66]], // Am9 · Fmaj7 · Cmaj7 · G6
  [[57, 60, 64, 67], [50, 57, 60, 65], [53, 57, 60, 67], [52, 56, 59, 64]], // Am7 · Dm7 · Fadd9 · E
  [[57, 64, 67, 71], [55, 62, 66, 69], [53, 60, 64, 69], [52, 59, 64, 67]], // Am(add9) · G · F · Em
];
const SCALE = [57, 59, 60, 62, 64, 65, 67, 69, 71, 72, 74, 76];
const BAR = 7.5; // seconds per chord

class SoundEngine {
  constructor() {
    this.settings = loadSettings();
    this.ctx = null;
    this.listeners = new Set();
    this.musicTimer = null;
    this.nextBar = 0;
    this.bar = 0;
    this.prog = 0;
  }

  // ------------------------------------------------------------ setup

  /** Create the audio graph on the first user gesture. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);

    this.musicBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);

    // Shared reverb and echo.
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb.connect(wet).connect(this.musicBus);
    this.sfxVerb = ctx.createConvolver();
    this.sfxVerb.buffer = this.impulse(1.4, 3);
    const sfxWet = ctx.createGain();
    sfxWet.gain.value = 0.22;
    this.sfxVerb.connect(sfxWet).connect(this.sfxBus);

    this.echo = ctx.createDelay(2);
    this.echo.delayTime.value = (BAR / 8) * 1.5;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const echoTone = ctx.createBiquadFilter();
    echoTone.type = 'lowpass';
    echoTone.frequency.value = 2200;
    this.echo.connect(echoTone).connect(fb).connect(this.echo);
    echoTone.connect(this.reverb);
    echoTone.connect(this.musicBus);

    this.noise = this.noiseBuffer(2);
    this.apply();
  }

  impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
    }
    return buf;
  }

  noiseBuffer(seconds) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // ------------------------------------------------------------ settings

  set(patch) {
    Object.assign(this.settings, patch);
    try { localStorage.setItem(KEY, JSON.stringify(this.settings)); } catch { /* ignore */ }
    this.apply();
    for (const fn of this.listeners) fn(this.settings);
  }

  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  apply() {
    if (!this.ctx) return;
    const s = this.settings;
    const t = this.ctx.currentTime;
    const ramp = (param, v) => { param.cancelScheduledValues(t); param.setTargetAtTime(v, t, 0.12); };
    ramp(this.master.gain, s.enabled ? 1 : 0);
    ramp(this.musicBus.gain, s.musicOn ? s.music * 0.55 : 0);
    ramp(this.sfxBus.gain, s.sfxOn ? s.sfx : 0);
    const wantMusic = s.enabled && s.musicOn && s.music > 0;
    if (wantMusic && !this.musicTimer) this.startMusic();
    if (!wantMusic && this.musicTimer) this.stopMusic();
  }

  get sfxAudible() {
    return this.ctx && this.settings.enabled && this.settings.sfxOn && this.settings.sfx > 0;
  }

  // ------------------------------------------------------------ music

  startMusic() {
    this.nextBar = this.ctx.currentTime + 0.3;
    this.musicTimer = setInterval(() => this.scheduleMusic(), 250);
    this.scheduleMusic();
  }

  stopMusic() {
    clearInterval(this.musicTimer);
    this.musicTimer = null;
  }

  scheduleMusic() {
    if (this.ctx.state !== 'running') return;
    while (this.nextBar < this.ctx.currentTime + 1.5) {
      if (this.bar % 8 === 0 && this.bar > 0) this.prog = (this.prog + 1 + Math.floor(Math.random() * 2)) % PROGRESSIONS.length;
      const chord = PROGRESSIONS[this.prog][this.bar % 4];
      this.playBar(chord, this.nextBar);
      this.nextBar += BAR;
      this.bar++;
    }
  }

  playBar(chord, t0) {
    const ctx = this.ctx;
    const end = t0 + BAR + 3.5;
    // Pad: filtered, detuned saws with a slow swell.
    const padGain = ctx.createGain();
    padGain.gain.setValueAtTime(0, t0);
    padGain.gain.linearRampToValueAtTime(0.07, t0 + 2.6);
    padGain.gain.setValueAtTime(0.07, t0 + BAR - 0.4);
    padGain.gain.linearRampToValueAtTime(0, end);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 2.5;
    lp.frequency.setValueAtTime(500 + Math.random() * 300, t0);
    lp.frequency.linearRampToValueAtTime(900 + Math.random() * 700, t0 + BAR * 0.6);
    lp.frequency.linearRampToValueAtTime(450, end);
    lp.connect(padGain);
    padGain.connect(this.musicBus);
    padGain.connect(this.reverb);
    for (const n of chord) {
      for (const det of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midi(n);
        o.detune.value = det + (Math.random() * 4 - 2);
        o.connect(lp);
        o.start(t0);
        o.stop(end);
      }
    }
    // Sub bass on the root.
    const bass = ctx.createOscillator();
    const bg = ctx.createGain();
    bass.type = 'sine';
    bass.frequency.value = midi(chord[0] - 24 + (chord[0] < 54 ? 12 : 0));
    bg.gain.setValueAtTime(0, t0);
    bg.gain.linearRampToValueAtTime(0.16, t0 + 1.5);
    bg.gain.linearRampToValueAtTime(0, t0 + BAR + 1);
    bass.connect(bg).connect(this.musicBus);
    bass.start(t0);
    bass.stop(t0 + BAR + 1.2);
    // Sparse arpeggio: chord tones and the scale, into the echo.
    const step = BAR / 8;
    const tones = [...chord.map((n) => n + 12), ...SCALE.filter(() => Math.random() < 0.25).map((n) => n + 12)];
    for (let i = 0; i < 8; i++) {
      if (Math.random() > (i % 2 ? 0.3 : 0.55)) continue;
      this.pluck(tones[Math.floor(Math.random() * tones.length)], t0 + i * step + Math.random() * 0.03, 0.05 + Math.random() * 0.03);
    }
    // A distant bell now and then.
    if (Math.random() < 0.35) this.bell(chord[Math.floor(Math.random() * chord.length)] + 24, t0 + BAR * (0.3 + Math.random() * 0.5), 0.03);
  }

  pluck(note, t, vol) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    o.type = 'triangle';
    o.frequency.value = midi(note);
    f.type = 'lowpass';
    f.frequency.setValueAtTime(3200, t);
    f.frequency.exponentialRampToValueAtTime(600, t + 0.6);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    o.connect(f).connect(g);
    g.connect(this.musicBus);
    g.connect(this.echo);
    g.connect(this.reverb);
    o.start(t);
    o.stop(t + 1.3);
  }

  bell(note, t, vol, bus = 'music') {
    const ctx = this.ctx;
    const out = bus === 'music' ? this.musicBus : this.sfxBus;
    const verb = bus === 'music' ? this.reverb : this.sfxVerb;
    for (const [ratio, amp, dec] of [[1, 1, 2.4], [2.76, 0.35, 1.1], [5.4, 0.15, 0.6]]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = midi(note) * ratio;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol * amp, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      o.connect(g);
      g.connect(out);
      g.connect(verb);
      o.start(t);
      o.stop(t + dec + 0.05);
    }
  }

  // ------------------------------------------------------------ effects

  /** Play a sound effect by name. `opts.duration` stretches engine sounds. */
  sfx(name, opts = {}) {
    if (!this.sfxAudible) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const fn = SFX[name];
    if (!fn) return;
    // The same effect several times at once (e.g. tolls) plays once.
    const now = this.ctx.currentTime;
    this.last ??= {};
    if (now - (this.last[name] ?? -1) < 0.06) return;
    this.last[name] = now;
    fn(this, now + 0.01, opts);
  }

  // Building blocks for the effects below.
  tone(t, { type = 'sine', from, to = from, dur, vol, attack = 0.005, curve = 'exp', verb = 0, filter }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    if (to !== from) {
      if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
      else o.frequency.linearRampToValueAtTime(to, t + dur);
    }
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node = o.connect(g);
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = filter.type ?? 'lowpass';
      f.frequency.value = filter.freq;
      f.Q.value = filter.q ?? 1;
      node = g.connect(f);
    }
    node.connect(this.sfxBus);
    if (verb) {
      const s = ctx.createGain();
      s.gain.value = verb;
      node.connect(s).connect(this.sfxVerb);
    }
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  hiss(t, { dur, vol, type = 'bandpass', from, to = from, q = 1, attack = 0.005, verb = 0 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    if (to !== from) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    if (verb) {
      const s = ctx.createGain();
      s.gain.value = verb;
      g.connect(s).connect(this.sfxVerb);
    }
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }
}

const SFX = {
  click: (s, t) => s.tone(t, { type: 'sine', from: 1400, to: 900, dur: 0.05, vol: 0.06 }),
  card: (s, t) => {
    s.hiss(t, { dur: 0.16, vol: 0.18, from: 1800, to: 5200, q: 0.8, attack: 0.02 });
    s.tone(t + 0.04, { type: 'triangle', from: 660, to: 990, dur: 0.12, vol: 0.05 });
  },
  buy: (s, t) => {
    s.hiss(t, { dur: 0.14, vol: 0.12, from: 2500, to: 6000, q: 0.8, attack: 0.02 });
    s.tone(t + 0.02, { type: 'square', from: 988, dur: 0.09, vol: 0.05, filter: { freq: 3000 } });
    s.tone(t + 0.09, { type: 'square', from: 1319, dur: 0.28, vol: 0.05, filter: { freq: 3500 }, verb: 0.6 });
  },
  income: (s, t) => {
    s.tone(t, { type: 'triangle', from: 1568, dur: 0.18, vol: 0.1, verb: 0.5 });
    s.tone(t + 0.07, { type: 'triangle', from: 2093, dur: 0.4, vol: 0.1, verb: 0.7 });
  },
  deploy: (s, t) => {
    s.tone(t, { type: 'sawtooth', from: 110, to: 660, dur: 0.45, vol: 0.09, attack: 0.05, filter: { freq: 1400, q: 4 } });
    s.hiss(t, { dur: 0.5, vol: 0.08, from: 800, to: 5000, q: 2, attack: 0.1, verb: 0.6 });
    s.bell(81, t + 0.32, 0.05, 'sfx');
  },
  move: (s, t, { duration = 0.6 } = {}) => {
    const d = Math.min(2.2, Math.max(0.35, duration));
    s.tone(t, { type: 'sawtooth', from: 70, to: 95, dur: d, vol: 0.07, attack: 0.12, curve: 'lin', filter: { freq: 380, q: 2 } });
    s.hiss(t, { dur: d, vol: 0.09, type: 'lowpass', from: 300, to: 900, q: 1.2, attack: 0.15 });
  },
  laser: (s, t) => {
    s.tone(t, { type: 'square', from: 2200, to: 260, dur: 0.16, vol: 0.09, filter: { freq: 4000 } });
    s.tone(t, { type: 'sine', from: 1600, to: 200, dur: 0.18, vol: 0.09, verb: 0.3 });
  },
  cannon: (s, t) => {
    s.tone(t, { type: 'sine', from: 150, to: 38, dur: 0.45, vol: 0.32 });
    s.hiss(t, { dur: 0.25, vol: 0.2, type: 'lowpass', from: 2400, to: 300, verb: 0.4 });
  },
  missile: (s, t) => {
    s.hiss(t, { dur: 0.42, vol: 0.14, from: 600, to: 3200, q: 3, attack: 0.08 });
    s.tone(t, { type: 'sawtooth', from: 180, to: 420, dur: 0.42, vol: 0.04, filter: { freq: 900 } });
  },
  ion: (s, t) => {
    const o = s.tone(t, { type: 'sine', from: 520, to: 1300, dur: 0.3, vol: 0.08, verb: 0.5 });
    const lfo = s.ctx.createOscillator();
    const depth = s.ctx.createGain();
    lfo.type = 'square';
    lfo.frequency.value = 38;
    depth.gain.value = 260;
    lfo.connect(depth).connect(o.frequency);
    lfo.start(t);
    lfo.stop(t + 0.32);
    s.hiss(t, { dur: 0.25, vol: 0.05, type: 'highpass', from: 4000 });
  },
  impact: (s, t) => s.hiss(t, { dur: 0.16, vol: 0.14, type: 'lowpass', from: 1800, to: 300 }),
  shield: (s, t) => s.tone(t, { type: 'triangle', from: 900, to: 1500, dur: 0.22, vol: 0.05, verb: 0.5 }),
  explode: (s, t) => {
    s.hiss(t, { dur: 1.3, vol: 0.4, type: 'lowpass', from: 2600, to: 90, q: 0.7, verb: 0.5 });
    s.tone(t, { type: 'sine', from: 110, to: 28, dur: 0.9, vol: 0.4 });
    s.hiss(t + 0.08, { dur: 0.6, vol: 0.12, from: 500, to: 160, q: 3 });
  },
  repair: (s, t) => {
    [72, 76, 79, 84].forEach((n, i) => s.tone(t + i * 0.06, { type: 'sine', from: midi(n), dur: 0.22, vol: 0.05, verb: 0.6 }));
  },
  reveal: (s, t) => {
    s.tone(t, { type: 'sine', from: midi(64), to: midi(71), dur: 0.9, vol: 0.06, attack: 0.2, curve: 'lin', verb: 0.8 });
    s.tone(t, { type: 'sine', from: midi(64) * 1.006, to: midi(71) * 1.006, dur: 0.9, vol: 0.06, attack: 0.2, curve: 'lin' });
    s.bell(88, t + 0.5, 0.05, 'sfx');
  },
  turn: (s, t) => {
    [69, 76, 81].forEach((n, i) => s.bell(n, t + i * 0.09, 0.05, 'sfx'));
  },
  round: (s, t) => {
    s.tone(t, { type: 'sine', from: midi(45), dur: 2.6, vol: 0.14, attack: 0.02, verb: 0.9 });
    [57, 64, 69, 72].forEach((n, i) => s.bell(n, t + 0.05 + i * 0.12, 0.05, 'sfx'));
  },
  mission: (s, t) => {
    [69, 73, 76, 81].forEach((n, i) => s.tone(t + i * 0.1, { type: 'triangle', from: midi(n), dur: 0.5, vol: 0.06, verb: 0.7 }));
  },
  victory: (s, t) => {
    const seq = [[60, 0], [64, 0.16], [67, 0.32], [72, 0.48], [67, 0.8], [72, 0.96]];
    for (const [n, d] of seq) {
      s.tone(t + d, { type: 'sawtooth', from: midi(n), dur: d === 0.96 ? 1.6 : 0.4, vol: 0.08, filter: { freq: 2400 }, verb: 0.7 });
      s.tone(t + d, { type: 'triangle', from: midi(n - 12), dur: d === 0.96 ? 1.6 : 0.4, vol: 0.08 });
    }
  },
  error: (s, t) => {
    s.tone(t, { type: 'square', from: 196, dur: 0.09, vol: 0.05, filter: { freq: 1200 } });
    s.tone(t + 0.11, { type: 'square', from: 165, dur: 0.14, vol: 0.05, filter: { freq: 1200 } });
  },
};

export const SFX_NAMES = Object.keys(SFX);
export const sound = new SoundEngine();

// Start audio on the first interaction, and click sounds on buttons.
if (typeof window !== 'undefined') {
  const unlock = () => sound.unlock();
  window.addEventListener('pointerdown', unlock, { capture: true });
  window.addEventListener('keydown', unlock, { capture: true });
  window.addEventListener('click', (e) => {
    const b = e.target.closest?.('button, .button, .segmented button');
    if (b && !b.disabled && !b.dataset.silent) sound.sfx('click');
  }, { capture: true });
}
