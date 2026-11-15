/**
 * Procedural Web Audio Engine (§11 & v2.1 §2.6).
 * - Above water: gentle wind noise
 * - Breach transition: whoosh + low-frequency underwater thump + low-pass sweep
 * - Underwater: depth-modulated low-pass abyssal ambience + sonar ping
 * - Paused automatically on visibilitychange.
 */

export class OceanAudioEngine {
  private ctx: AudioContext | null = null;
  private noiseNode: AudioBufferSourceNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private masterGain: GainNode | null = null;
  private enabled = true;
  private initialized = false;

  unlock() {
    if (!this.enabled || this.initialized) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();

      // Create 2-second pink/brown noise loop
      const length = this.ctx.sampleRate * 2;
      const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let lastOut = 0;
      for (let i = 0; i < length; i++) {
        const white = ((i * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff * 2 - 1;
        data[i] = (lastOut + 0.02 * white) / 1.02;
        lastOut = data[i];
        data[i] *= 2.8;
      }

      this.noiseNode = this.ctx.createBufferSource();
      this.noiseNode.buffer = buffer;
      this.noiseNode.loop = true;

      this.filter = this.ctx.createBiquadFilter();
      this.filter.type = 'lowpass';
      this.filter.frequency.value = 1400;

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.06;

      this.noiseNode.connect(this.filter);
      this.filter.connect(this.masterGain);
      this.masterGain.connect(this.ctx.destination);
      this.noiseNode.start();
      this.initialized = true;
    } catch {
      // Ignore audio errors on restricted devices
    }
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(enabled ? 0.06 : 0.0, this.ctx.currentTime, 0.08);
    }
  }

  setPaused(paused: boolean) {
    if (!this.ctx) return;
    if (paused && this.ctx.state === 'running') {
      this.ctx.suspend().catch(() => {});
    } else if (!paused && this.ctx.state === 'suspended' && this.enabled) {
      this.ctx.resume().catch(() => {});
    }
  }

  updateDepth(depthM: number) {
    if (!this.ctx || !this.filter || !this.enabled) return;
    const cutoff =
      depthM <= 0
        ? 1600
        : Math.max(95, 650 * Math.exp(-depthM / 450));
    this.filter.frequency.setTargetAtTime(cutoff, this.ctx.currentTime, 0.1);
  }

  playBreach(enteringWater: boolean) {
    if (!this.ctx || !this.enabled) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(enteringWater ? 130 : 85, now);
      osc.frequency.exponentialRampToValueAtTime(enteringWater ? 42 : 160, now + 0.35);

      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.4);
    } catch {
      // Ignore
    }
  }

  playSonarPing() {
    if (!this.ctx || !this.enabled) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1180, now);
      osc.frequency.exponentialRampToValueAtTime(920, now + 0.7);

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.85);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.9);
    } catch {
      // Ignore
    }
  }

  dispose() {
    try {
      this.noiseNode?.stop();
      this.ctx?.close();
    } catch {
      // Ignore
    }
  }
}
