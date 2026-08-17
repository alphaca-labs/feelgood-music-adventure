import type { ZoneId } from "./simulation";

/**
 * Procedural soundtrack (spec K17: 임시 사운드는 절차 생성). No audio files are shipped,
 * so the sound toggle costs zero bytes of the 500 KB initial-load budget.
 */

type Note = { step: number; note: number; length: number };

const ZONE_BASS: Record<ZoneId, number[]> = {
  jungle: [55, 55, 65.41, 73.42],
  city: [65.41, 61.74, 82.41, 73.42],
  stage: [82.41, 98, 73.42, 87.31],
};

const ZONE_LEAD: Record<ZoneId, Note[]> = {
  jungle: [
    { step: 0, note: 440, length: 0.18 },
    { step: 3, note: 523.25, length: 0.14 },
    { step: 6, note: 392, length: 0.2 },
  ],
  city: [
    { step: 0, note: 523.25, length: 0.14 },
    { step: 2, note: 659.25, length: 0.12 },
    { step: 5, note: 587.33, length: 0.16 },
    { step: 7, note: 493.88, length: 0.14 },
  ],
  stage: [
    { step: 0, note: 659.25, length: 0.12 },
    { step: 2, note: 783.99, length: 0.12 },
    { step: 4, note: 880, length: 0.16 },
    { step: 6, note: 659.25, length: 0.18 },
  ],
};

export class GameAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private nextTime = 0;
  private zone: ZoneId = "jungle";
  private fever = false;
  enabled = false;

  private ensure() {
    if (this.context) return this.context;
    const Ctor =
      globalThis.AudioContext ??
      (globalThis as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    this.context = new Ctor();
    this.master = this.context.createGain();
    this.master.gain.value = 0.18;
    this.master.connect(this.context.destination);
    return this.context;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      this.stopMusic();
      return;
    }
    const context = this.ensure();
    void context?.resume();
  }

  setZone(zone: ZoneId) {
    this.zone = zone;
  }

  setFever(fever: boolean) {
    this.fever = fever;
  }

  private tone(
    frequency: number,
    duration: number,
    type: OscillatorType,
    gain: number,
    at?: number,
  ) {
    const context = this.ensure();
    if (!context || !this.master || !this.enabled) return;
    const start = at ?? context.currentTime;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope);
    envelope.connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  startMusic() {
    const context = this.ensure();
    if (!context || this.timer !== null) return;
    void context.resume();
    this.nextTime = context.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 60);
  }

  stopMusic() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  private schedule() {
    const context = this.context;
    if (!context || !this.enabled) return;
    const stepSeconds = this.fever ? 0.115 : 0.13;
    while (this.nextTime < context.currentTime + 0.25) {
      const beat = this.step % 8;
      const bass = ZONE_BASS[this.zone][Math.floor(this.step / 8) % 4];
      if (beat % 2 === 0) this.tone(bass, 0.2, "triangle", 0.3, this.nextTime);
      if (beat === 4) this.tone(bass * 4, 0.05, "square", 0.08, this.nextTime);
      for (const note of ZONE_LEAD[this.zone]) {
        if (note.step !== beat) continue;
        this.tone(
          note.note * (this.fever ? 2 : 1),
          note.length,
          this.fever ? "sawtooth" : "square",
          this.fever ? 0.16 : 0.1,
          this.nextTime,
        );
      }
      this.nextTime += stepSeconds;
      this.step += 1;
    }
  }

  jump(double: boolean) {
    this.tone(double ? 660 : 440, 0.1, "square", 0.14);
  }

  collect() {
    this.tone(880, 0.07, "square", 0.12);
  }

  enemy() {
    this.tone(196, 0.12, "sawtooth", 0.14);
  }

  hit() {
    this.tone(110, 0.24, "sawtooth", 0.2);
  }

  feverStart() {
    this.tone(523.25, 0.18, "sawtooth", 0.2);
    this.tone(1046.5, 0.22, "square", 0.12);
  }

  checkpoint() {
    this.tone(659.25, 0.12, "triangle", 0.16);
    this.tone(987.77, 0.16, "triangle", 0.12);
  }

  dispose() {
    this.stopMusic();
    void this.context?.close();
    this.context = null;
    this.master = null;
  }
}
