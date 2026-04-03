/**
 * 🔊 Retro Sound Effects Generator
 * Generates authentic 56k modem connection sounds using Web Audio API
 */

export class RetroSoundGenerator {
  private audioContext: AudioContext | null = null;

  constructor() {
    // Initialize AudioContext lazily (browser requirement)
    if (typeof window !== 'undefined' && 'AudioContext' in window) {
      this.audioContext = new AudioContext();
    }
  }

  /**
   * Play authentic 56k modem connection sequence
   * Duration: ~3 seconds
   */
  async playModemConnect(): Promise<void> {
    if (!this.audioContext) {
      console.warn('Web Audio API not available');
      return;
    }

    const ctx = this.audioContext;
    const now = ctx.currentTime;

    // Resume context if suspended (required by some browsers)
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    // Phase 1: Dial tone (0-0.5s)
    this.createTone(ctx, 350, 0.3, now, 0.5);
    this.createTone(ctx, 440, 0.3, now, 0.5);

    // Phase 2: Initial handshake beeps (0.5-1.2s)
    this.createBeep(ctx, 2100, 0.4, now + 0.5, 0.1);
    this.createBeep(ctx, 2100, 0.4, now + 0.7, 0.1);
    this.createBeep(ctx, 2100, 0.4, now + 0.9, 0.1);

    // Phase 3: High-pitched carrier signal (1.2-1.8s)
    this.createCarrierNoise(ctx, now + 1.2, 0.6);

    // Phase 4: Data exchange static/noise (1.8-2.8s)
    this.createModemNoise(ctx, now + 1.8, 1.0);

    // Phase 5: Final connection tone (2.8-3.2s)
    this.createTone(ctx, 1800, 0.25, now + 2.8, 0.4);
  }

  /**
   * Play PC speaker beep (short and sharp)
   */
  async playPCBeep(): Promise<void> {
    if (!this.audioContext) return;

    const ctx = this.audioContext;
    const now = ctx.currentTime;

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    this.createBeep(ctx, 800, 0.5, now, 0.1);
  }

  /**
   * Play error bonk sound
   */
  async playErrorSound(): Promise<void> {
    if (!this.audioContext) return;

    const ctx = this.audioContext;
    const now = ctx.currentTime;

    if (ctx.state === 'suspended') {
      await ctx.resume();
    }

    // Three descending bonks
    this.createBeep(ctx, 200, 0.6, now, 0.15);
    this.createBeep(ctx, 150, 0.6, now + 0.2, 0.15);
    this.createBeep(ctx, 100, 0.6, now + 0.4, 0.15);
  }

  /**
   * Create a simple tone
   */
  private createTone(
    ctx: AudioContext,
    frequency: number,
    volume: number,
    startTime: number,
    duration: number
  ): void {
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;

    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(volume, startTime + 0.01);
    gainNode.gain.setValueAtTime(volume, startTime + duration - 0.05);
    gainNode.gain.linearRampToValueAtTime(0, startTime + duration);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start(startTime);
    oscillator.stop(startTime + duration);
  }

  /**
   * Create a beep sound
   */
  private createBeep(
    ctx: AudioContext,
    frequency: number,
    volume: number,
    startTime: number,
    duration: number
  ): void {
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = 'square';
    oscillator.frequency.value = frequency;

    gainNode.gain.setValueAtTime(volume, startTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + duration);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start(startTime);
    oscillator.stop(startTime + duration);
  }

  /**
   * Create carrier signal noise (high-pitched warbling)
   */
  private createCarrierNoise(
    ctx: AudioContext,
    startTime: number,
    duration: number
  ): void {
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();

    // Main carrier at ~2000Hz
    oscillator.type = 'sawtooth';
    oscillator.frequency.value = 2000;

    // LFO for warbling effect
    lfo.type = 'sine';
    lfo.frequency.value = 15;
    lfoGain.gain.value = 100;

    lfo.connect(lfoGain);
    lfoGain.connect(oscillator.frequency);

    // Envelope
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(0.3, startTime + 0.05);
    gainNode.gain.setValueAtTime(0.3, startTime + duration - 0.1);
    gainNode.gain.linearRampToValueAtTime(0, startTime + duration);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start(startTime);
    lfo.start(startTime);
    oscillator.stop(startTime + duration);
    lfo.stop(startTime + duration);
  }

  /**
   * Create modem data exchange noise
   */
  private createModemNoise(
    ctx: AudioContext,
    startTime: number,
    duration: number
  ): void {
    const bufferSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Generate band-limited noise (sounds like data transfer)
    for (let i = 0; i < bufferSize; i++) {
      // Mix of random noise with some structure
      const t = i / ctx.sampleRate;
      const noise = (Math.random() * 2 - 1) * 0.3;
      const tone1 = Math.sin(2 * Math.PI * 1200 * t) * 0.2;
      const tone2 = Math.sin(2 * Math.PI * 2400 * t) * 0.15;

      // Amplitude modulation for "data bursts"
      const envelope = Math.sin(2 * Math.PI * 30 * t) * 0.5 + 0.5;

      data[i] = (noise + tone1 + tone2) * envelope;
    }

    const source = ctx.createBufferSource();
    const gainNode = ctx.createGain();

    source.buffer = buffer;

    // Fade in/out
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(0.4, startTime + 0.1);
    gainNode.gain.setValueAtTime(0.4, startTime + duration - 0.2);
    gainNode.gain.linearRampToValueAtTime(0, startTime + duration);

    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    source.start(startTime);
  }

  /**
   * Cleanup audio context
   */
  async dispose(): Promise<void> {
    if (this.audioContext && this.audioContext.state !== 'closed') {
      await this.audioContext.close();
      this.audioContext = null;
    }
  }
}

// Singleton instance
let soundGenerator: RetroSoundGenerator | null = null;

export function getRetroSoundGenerator(): RetroSoundGenerator {
  if (!soundGenerator) {
    soundGenerator = new RetroSoundGenerator();
  }
  return soundGenerator;
}
