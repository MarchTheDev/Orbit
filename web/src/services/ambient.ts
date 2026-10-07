/**
 * A slow, low-key melody that sits behind the library.
 *
 * Orbit synthesizes the sound locally with Web Audio; there is no audio file,
 * download or licence to worry about. The notes are a fixed four-bar phrase,
 * with a returning motif over a C, Am, F, G progression. Eighth-note rests give
 * it a pulse, and the harmony changes with the phrase instead of holding one
 * chord beneath unrelated-sounding tones.
 *
 * Sound is off until someone asks for it. If the webview has not received a
 * user gesture yet, playback waits quietly for the first click or key press.
 */

/** C3, a warm register that stays out of the way of most game audio. */
const ROOT = 130.8128;

/**
 * Four bars in C major. Each entry is an eighth-note step; `null` is a rest.
 * The repeated E–G–A–G shape is the hook, answered by the higher F-major bar.
 */
const MELODY: (number | null)[] = [
  // C major: establish the motif.
  16, null, 19, 21, 19, null, 16, 14,
  // A minor: answer it, then climb back to A.
  12, null, 16, 19, 21, null, 19, 16,
  // F major: lift the phrase to C5 before stepping back down.
  17, null, 21, 24, 21, null, 19, 17,
  // G: a lower response that resolves to E as the loop returns to C.
  14, null, 19, 21, 19, null, 14, 16,
];

/** Cmaj9, Am7, Fmaj9 and G6, voiced so adjacent bars move gently. */
const CHORDS = [
  [
    { semitones: -12, level: 0.017 },
    { semitones: -5, level: 0.012 },
    { semitones: 2, level: 0.009 },
    { semitones: 4, level: 0.008 },
    { semitones: 11, level: 0.006 },
  ],
  [
    { semitones: -3, level: 0.015 },
    { semitones: 0, level: 0.008 },
    { semitones: 4, level: 0.009 },
    { semitones: 7, level: 0.007 },
    { semitones: 12, level: 0.005 },
  ],
  [
    { semitones: -7, level: 0.015 },
    { semitones: 0, level: 0.008 },
    { semitones: 4, level: 0.009 },
    { semitones: 7, level: 0.007 },
    { semitones: 9, level: 0.005 },
  ],
  [
    { semitones: -5, level: 0.015 },
    { semitones: 2, level: 0.009 },
    { semitones: 4, level: 0.008 },
    { semitones: 7, level: 0.007 },
    { semitones: 11, level: 0.005 },
  ],
] as const;

const STEPS_PER_BAR = 8;
/** An eighth note at about 77 BPM: a 12.5-second phrase with room to breathe. */
const STEP_MS = 390;
const NOTE_RING_SECONDS = 0.95;

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
  private chordIndex = -1;
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
    this.noteIndex = 0;
    this.chordIndex = -1;
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

  /** A rounded filter and a soft master level keep the sound behind the UI. */
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

    this.noteIndex = 0;
    this.beginPad(0);
    // Let the room settle before the first note arrives.
    this.timer = window.setTimeout(() => this.play(), 1500);
  }

  private play(): void {
    if (!this.wanted || !this.context) return;
    this.timer = null;

    const step = this.noteIndex;
    const chord = Math.floor(step / STEPS_PER_BAR);
    if (chord !== this.chordIndex) this.beginPad(chord);

    const semitones = MELODY[step];
    if (semitones !== null) {
      // The first note of each bar gets a small lift without turning the phrase
      // into a metronomic pattern.
      const accent = step % STEPS_PER_BAR === 0 ? 1 : step % 2 === 0 ? 0.82 : 0.72;
      this.pluck(semitones, accent);
    }

    this.noteIndex = (step + 1) % MELODY.length;
    this.timer = window.setTimeout(() => this.play(), STEP_MS);
  }

  /** A rounded sine tone with a short attack and a soft, overlapping decay. */
  private pluck(semitones: number, accent: number): void {
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
    overtoneGain.gain.value = 0.035;
    overtone.connect(overtoneGain);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.075 * accent, now + 0.11);
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

  /** Crossfade one warm chord into the next at the start of each bar. */
  private beginPad(chordIndex: number): void {
    const ctx = this.context;
    const tone = this.tone;
    if (!ctx || !tone) return;

    if (this.padVoices.length > 0) this.fadeVoices(this.padVoices, 2.0, 0.45);

    const now = ctx.currentTime;
    this.padVoices = CHORDS[chordIndex].map(({ semitones, level }) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = frequency(semitones);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(level, now + 1.5);
      osc.connect(gain).connect(tone);
      osc.start(now);
      return { oscillators: [osc], gain };
    });
    this.chordIndex = chordIndex;
  }

  private fadeVoices(voices: Voice[], stopAfter = 2.3, timeConstant = 0.35): void {
    if (!this.context) return;
    const now = this.context.currentTime;
    for (const voice of voices) {
      try {
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setTargetAtTime(0.0001, now, timeConstant);
        for (const osc of voice.oscillators) osc.stop(now + stopAfter);
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
