// Sound: real Oolite .ogg files through AudioContext.
// Oolite has no dedicated engine loop — afterburner1.ogg is its flight/engine
// sound, so we reuse it (looped, gain/pitch following the throttle).

export class GameAudio {
  constructor(rawSounds) {
    this.raw = rawSounds || {};
    this.ctx = null;
    this.buffers = new Map(); // name -> AudioBuffer
    this.master = null;
    this.engineSrc = null;
    this.engineGain = null;
    this.enabled = true;
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
