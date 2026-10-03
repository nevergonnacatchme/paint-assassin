// Procedural Web Audio sound effects for Paint Assassin 3D (no audio files).
// Every method takes an optional volume (0..1) so 3D distance attenuation can be applied by the caller.

class SoundManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  private noiseBuf: AudioBuffer | null = null;

  private init(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  setMuted(m: boolean) { this.muted = m; }
  isMuted() { return this.muted; }

  /** Release the AudioContext (called when the game unmounts). */
  dispose() {
    if (this.ctx) { this.ctx.close().catch(() => {}); }
    this.ctx = null; this.master = null; this.noiseBuf = null;
  }

  private noise(ctx: AudioContext): AudioBuffer {
    if (!this.noiseBuf) {
      const len = ctx.sampleRate; // 1s of white noise, reused
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    }
    return this.noiseBuf;
  }

  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, delay = 0) {
    const ctx = this.init(); if (!ctx || !this.master || this.muted || vol <= 0.001) return;
    try {
      const t = ctx.currentTime + delay;
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(g); g.connect(this.master);
      osc.start(t); osc.stop(t + dur + 0.02);
    } catch { /* audio may fail silently when the tab is not focused */ }
  }

  private burst(freq: number, q: number, dur: number, vol: number, type: BiquadFilterType = 'bandpass') {
    const ctx = this.init(); if (!ctx || !this.master || this.muted || vol <= 0.001) return;
    try {
      const t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = this.noise(ctx);
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(t); src.stop(t + dur + 0.02);
    } catch { /* ignore */ }
  }

  /** Cheerful bubble pop for paint; suppressed crack + thud for the lethal pistol. */
  playShoot(isLethal = false, vol = 1) {
    if (isLethal) {
      this.burst(2400, 0.8, 0.05, 0.12 * vol);           // faint suppressed "tch"
      this.tone('sine', 150, 55, 0.16, 0.35 * vol);       // thud
    } else {
      this.tone('sine', 560 + Math.random() * 120, 190, 0.09, 0.18 * vol);
      this.tone('triangle', 900, 400, 0.05, 0.06 * vol);
    }
  }
  playSplat(vol = 1) { this.tone('triangle', 260, 90, 0.07, 0.12 * vol); this.burst(900, 1, 0.05, 0.05 * vol); }
  playKill(vol = 1) { this.tone('sawtooth', 140, 40, 0.28, 0.3 * vol); this.burst(220, 0.7, 0.2, 0.25 * vol, 'lowpass'); }
  playHit() { this.tone('square', 1200, 900, 0.04, 0.08); }
  playClick() { this.tone('square', 300, 200, 0.03, 0.06); }
  playSwitch() { this.burst(1800, 2, 0.04, 0.08); this.tone('square', 500, 380, 0.04, 0.04); }
  /** Soft descending chime used when a painter is eliminated. */
  playChime(vol = 1) {
    [784, 659, 523].forEach((f, i) => this.tone('sine', f, f * 0.99, 0.45, 0.16 * vol, i * 0.11));
  }
  /** Emergency siren: two sweeping saw tones. */
  playAlarm() {
    for (let i = 0; i < 3; i++) {
      this.tone('sawtooth', 620, 980, 0.28, 0.12, i * 0.3);
      this.tone('sawtooth', 980, 620, 0.28, 0.12, i * 0.3 + 0.15);
    }
  }
  /** Incoming chat message chime. */
  playMessage() { this.tone('sine', 880, 880, 0.08, 0.08); this.tone('sine', 1320, 1320, 0.1, 0.07, 0.07); }
  playVote() { this.tone('sine', 659.25, 659.25, 0.1, 0.15); }
  playEject() { this.tone('sine', 440, 110, 0.5, 0.2); }
  playVictory() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone('triangle', f, f, 0.35, 0.2, i * 0.12)); }
  playDefeat() { [392, 369.99, 349.23, 311.13].forEach((f, i) => this.tone('sawtooth', f, f, 0.3, 0.16, i * 0.16)); }
}

export const sounds = new SoundManager();
