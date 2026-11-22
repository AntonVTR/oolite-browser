// Sound: real Oolite .ogg files through AudioContext.
// Oolite has no dedicated engine loop — afterburner1.ogg is its flight/engine
// sound, so we reuse it (looped, gain/pitch following the throttle).

// ---- auto-dock music (#21) --------------------------------------------------
// A short generated waltz in the spirit of "The Blue Danube", scheduled with
// oscillators — no audio assets. Six bars of 3/4 at 160 bpm: bass on beat one,
// chords on two and three, the melody's rising call over the top.
const WALTZ_BPM = 160;
const BEAT = 60 / WALTZ_BPM;
export const WALTZ_LEN = 18 * BEAT; // six bars, seconds

// [bass midi, chord voicing] per bar — D, D, G, A, D, A
export const WALTZ_BARS = [
  { bass: 50, chord: [62, 66, 69] }, // D3 · D4 F#4 A4
  { bass: 50, chord: [62, 66, 69] },
  { bass: 55, chord: [62, 67, 71] }, // G3 · D4 G4 B4
  { bass: 57, chord: [61, 64, 69] }, // A3 · C#4 E4 A4
  { bass: 50, chord: [62, 66, 69] },
  { bass: 57, chord: [61, 64, 69] },
];

// The melody as [beat, midi, length in beats, volume] over the same 18 beats.
export const WALTZ_MELODY = [
  [0, 62, 1, 0.30], [1, 66, 1, 0.30], [2, 69, 1, 0.30],   // rising call
  [3, 74, 2, 0.34], [5, 69, 1, 0.28],
  [6, 71, 1, 0.30], [7, 67, 1, 0.30], [8, 64, 1, 0.30],
  [9, 69, 2, 0.32], [11, 66, 1, 0.28],
  [12, 74, 1, 0.34], [13, 73, 1, 0.30], [14, 71, 1, 0.30],
  [15, 69, 3, 0.32],
];

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// One phrase onto `dest`, starting at `start`; returns its length in seconds.
function scheduleWaltz(ctx, dest, start) {
  const at = (beat) => start + beat * BEAT;
  const voice = (midi, t, dur, vol) => {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = mtof(midi);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(dest);
    try { osc.start(t); osc.stop(t + dur + 0.05); } catch (e) { /* bad time */ }
  };
  for (let bar = 0; bar < WALTZ_BARS.length; bar++) {
    const b = bar * 3;
    const ch = WALTZ_BARS[bar];
    voice(ch.bass, at(b), BEAT * 0.9, 0.45);
    for (const beat of [1, 2]) {
      for (const m of ch.chord) voice(m, at(b + beat), BEAT * 0.7, 0.14);
    }
  }
  for (const [beat, midi, len, vol] of WALTZ_MELODY) {
    voice(midi, at(beat), BEAT * len * 0.95, vol);
  }
  return WALTZ_LEN;
}

export class GameAudio {
  constructor(rawSounds) {
    this.raw = rawSounds || {};
    this.ctx = null;
    this.buffers = new Map(); // name -> AudioBuffer
    this.master = null;
    this.engineSrc = null;
    this.engineGain = null;
    this.enabled = true;
    this.musicOn = false;   // the auto-dock jingle is running (#21)
    this.musicTimer = null;
    this.musicNext = 0;     // when the phrase already scheduled ends
    this.musicGain = null;
  }

  // Start (or keep) the auto-dock jingle. Idempotent: main.js calls it every
  // frame while the docking computer holds the ship.
  startDockMusic() {
    if (!this.ctx || this.musicOn) return;
    this.musicOn = true;
    if (!this.musicGain) {
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.0001;
      this.musicGain.connect(this.master);
    }
    const phrase = () => {
      if (!this.musicOn || !this.ctx) return;
      // mute (the same enabled flag every .ogg sound respects): fade out now,
      // fade back in and carry on when it clears
      if (!this.enabled) {
        this.musicGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.05);
        return;
      }
      this.musicGain.gain.setTargetAtTime(0.5, this.ctx.currentTime, 0.1);
      const start = Math.max(this.ctx.currentTime + 0.05, this.musicNext);
      this.musicNext = start + scheduleWaltz(this.ctx, this.musicGain, start);
    };
    phrase();
    this.musicTimer = setInterval(phrase, (WALTZ_LEN - 0.5) * 1000);
  }

  // The computer lets go (or the ship docks): one ramp silences every voice.
  stopDockMusic() {
    if (!this.musicOn) return;
    this.musicOn = false;
    clearInterval(this.musicTimer);
    this.musicTimer = null;
    this.musicNext = 0;
    if (this.musicGain) {
      this.musicGain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.08);
    }
  }

  // Must be called from a user gesture (title tap).
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.ctx.destination);
  }

  async buffer(name) {
    if (this.buffers.has(name)) return this.buffers.get(name);
    const raw = this.raw[name];
    if (!raw || !this.ctx) return null;
    try {
      // decodeAudioData detaches the ArrayBuffer, so decode a copy.
      const buf = await this.ctx.decodeAudioData(raw.slice(0));
      this.buffers.set(name, buf);
      return buf;
    } catch (e) {
      return null;
    }
  }

  async play(name, { volume = 1, rate = 1, loop = false } = {}) {
    if (!this.ctx || !this.enabled) return null;
    const buf = await this.buffer(name);
    if (!buf) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
    src.playbackRate.value = rate;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain).connect(this.master);
    try { src.start(0); } catch (e) { return null; }
    return { src, gain };
  }

  // Looping engine sound; call each frame with throttle fraction 0..1.
  setEngine(throttle, active) {
    if (!this.ctx) return;
    if (active && !this.engineSrc) {
      const raw = this.raw.afterburner1;
      if (!raw) return;
      this.ctx.decodeAudioData(raw.slice(0)).then((buf) => {
        if (!buf || this.engineSrc) return;
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const gain = this.ctx.createGain();
        gain.gain.value = 0.0001;
        src.connect(gain).connect(this.master);
        try { src.start(0); } catch (e) { return; }
        this.engineSrc = src;
        this.engineGain = gain;
      }).catch(() => {});
      return;
    }
    if (!this.engineGain) return;
    const now = this.ctx.currentTime;
    const target = active ? 0.05 + 0.22 * Math.min(1, throttle) : 0.0001;
    this.engineGain.gain.setTargetAtTime(target, now, 0.15);
    if (this.engineSrc) {
      this.engineSrc.playbackRate.setTargetAtTime(0.7 + 0.6 * Math.min(1, throttle), now, 0.2);
    }
  }

  stopEngine() {
    if (this.engineSrc) {
      try { this.engineSrc.stop(); } catch (e) { /* ignore */ }
      this.engineSrc = null;
      this.engineGain = null;
    }
  }
}
