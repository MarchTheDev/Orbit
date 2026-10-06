/**
 * A slow, low-key melody that sits behind the library.
 *
 * Orbit synthesizes the sound locally with Web Audio; there is no audio file,
 * download or licence to worry about. The melody is intentionally composed,
 * not randomized: it stays in one gentle major-pentatonic key over a soft,
 * unchanging chord, so there are no surprise notes or sudden mood changes.
 *
 * Sound is off until someone asks for it. If the webview has not received a
 * user gesture yet, playback waits quietly for the first click or key press.
 */

/** C3, a warm register that stays out of the way of most game audio. */
const ROOT = 130.8128;

/** One calm phrase, in semitones above C3. A null is a full beat of rest. */
const MELODY: (number | null)[] = [
  7, 9, 12, null,
  9, 7, 4, null,
  2, 4, 7, null,
  9, 7, 4, null,
];

const BEAT_MS = 4000;
const NOTE_RING_SECONDS = 4.8;

function frequency(semitones: number): number {
  return ROOT * Math.pow(2, semitones / 12);
}

interface Voice {
  oscillators: OscillatorNode[];
  gain: GainNode;
}

export class Ambient {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private tone: BiquadFilterNode | null = null;
  private timer: number | null = null;
  private voices: Voice[] = [];
  private padVoices: Voice[] = [];
  private noteIndex = 0;
  private wanted = false;
  private volume = 0.35;
  private resumeOn: (() => void) | null = null;

  /** Turn the sound on, and keep it on. */
  start(volume: number): void {
    this.wanted = true;
    this.setVolume(volume);
    this.ensure();
  }

  /** Fade to silence, stop the notes, and suspend the audio graph shortly after. */
  stop(): void {
    this.wanted = false;
    this.clearTimer();
    this.fadeVoices(this.voices);
    this.fadeVoices(this.padVoices);
    this.voices = [];
    this.padVoices = [];
    this.removeGesture();
    if (!this.context) return;

    try {
      const now = this.context.currentTime;
      this.master?.gain.cancelScheduledValues(now);
      this.master?.gain.setTargetAtTime(0, now, 0.35);
    } catch {
      // Nothing to fade.
    }

    // Keep the context around so turning the music back on is quick, but do not
    // leave an idle audio device running in the background.
    window.setTimeout(() => {
      if (!this.wanted) void this.context?.suspend().catch(() => {});
    }, 2600);
  }

  /** Volume, 0 to 1. Safe to call before anything is playing. */
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (!this.master || !this.context || !this.wanted) return;
    try {
      this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.5);
    } catch {
      // Leave the last usable value in place.
    }
  }

  /** Whether the window is being looked at, and whether music may continue away. */
  setFocused(focused: boolean, keepWhenUnfocused: boolean): void {
    if (!this.context || !this.master) return;
    const target = !focused && !keepWhenUnfocused ? 0 : this.volume;
    try {
      this.master.gain.setTargetAtTime(target, this.context.currentTime, 0.6);
    } catch {
      // Leave the last usable value in place.
    }
  }

  // ------------------------------------------------------------------ private

  private ensure(): void {
    if (!this.context) {
      try {
        const Ctor =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.context = new Ctor();
        this.build();
      } catch {
        return;
      }
    }

    if (this.context.state === 'suspended') {
      void this.context.resume().then(
        () => this.begin(),
        () => this.waitForGesture(),
      );
      if (this.context.state === 'suspended') this.waitForGesture();
      return;
    }
    this.begin();
  }

  private waitForGesture(): void {
    if (this.resumeOn) return;
    const go = () => {
      this.removeGesture();
      if (!this.wanted || !this.context) return;
      void this.context.resume().then(
        () => this.begin(),
        () => {},
      );
    };
    this.resumeOn = go;
    window.addEventListener('pointerdown', go, { once: true });
    window.addEventListener('keydown', go, { once: true });
  }

  private removeGesture(): void {
    if (!this.resumeOn) return;
    window.removeEventListener('pointerdown', this.resumeOn);
    window.removeEventListener('keydown', this.resumeOn);
    this.resumeOn = null;
  }

  /** A rounded filter, soft master level and the quiet chord under the melody. */
  private build(): void {
    const ctx = this.context;
    if (!ctx) return;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 52;
    highpass.Q.value = 0.45;

    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 1450;
    this.tone.Q.value = 0.35;

    highpass.connect(this.tone).connect(this.master);
  }

  private begin(): void {
    if (!this.wanted || !this.context || this.timer !== null) return;

    try {
      this.master?.gain.cancelScheduledValues(this.context.currentTime);
      this.master?.gain.setTargetAtTime(this.volume, this.context.currentTime, 2.5);
    } catch {
      // Leave the last usable value in place.
    }

    this.beginPad();
    // Let the room settle before the first note arrives.
    this.timer = window.setTimeout(() => this.play(), 1800);
  }

  private play(): void {
    if (!this.wanted) return;
    this.timer = null;

    const semitones = MELODY[this.noteIndex];
    this.noteIndex = (this.noteIndex + 1) % MELODY.length;
    if (semitones !== null) this.pluck(semitones);

    this.timer = window.setTimeout(() => this.play(), BEAT_MS);
  }

  /** A soft, rounded sine tone with only a hint of its second harmonic. */
  private pluck(semitones: number): void {
    const ctx = this.context;
    const tone = this.tone;
    if (!ctx || !tone) return;

    const now = ctx.currentTime;
    const fundamental = ctx.createOscillator();
    fundamental.type = 'sine';
    fundamental.frequency.value = frequency(semitones);

    const overtone = ctx.createOscillator();
    overtone.type = 'sine';
    overtone.frequency.value = frequency(semitones) * 2;

    const overtoneGain = ctx.createGain();
    overtoneGain.gain.value = 0.045;
    overtone.connect(overtoneGain);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.105, now + 0.45);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + NOTE_RING_SECONDS);

    fundamental.connect(gain);
    overtoneGain.connect(gain);
    gain.connect(tone);
    fundamental.start(now);
    overtone.start(now);
    fundamental.stop(now + NOTE_RING_SECONDS + 0.1);
    overtone.stop(now + NOTE_RING_SECONDS + 0.1);

    this.voices.push({ oscillators: [fundamental, overtone], gain });
    if (this.voices.length > 24) this.voices = this.voices.slice(-16);
  }

  /** The same quiet C-major ninth chord throughout, so the melody never clashes. */
  private beginPad(): void {
    const ctx = this.context;
    const tone = this.tone;
    if (!ctx || !tone || this.padVoices.length > 0) return;

    const now = ctx.currentTime;
    // C2, G2, D3, E3 and G3: a stable, softly voiced Cmaj9 bed.
    const notes = [
      { semitones: -12, level: 0.018 },
      { semitones: -5, level: 0.014 },
      { semitones: 2, level: 0.010 },
      { semitones: 4, level: 0.009 },
      { semitones: 7, level: 0.006 },
    ];

    this.padVoices = notes.map(({ semitones, level }) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = frequency(semitones);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(level, now + 8);
      osc.connect(gain).connect(tone);
      osc.start(now);
      return { oscillators: [osc], gain };
    });
  }

  private fadeVoices(voices: Voice[]): void {
    if (!this.context) return;
    const now = this.context.currentTime;
    for (const voice of voices) {
      try {
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setTargetAtTime(0.0001, now, 0.35);
        for (const osc of voice.oscillators) osc.stop(now + 2.3);
      } catch {
        // Already stopped.
      }
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

/** One sound for the whole app: two of these would be two melodies at once. */
export const ambient = new Ambient();
