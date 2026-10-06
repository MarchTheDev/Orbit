/**
 * Something quiet to sit behind a game.
 *
 * There is no music file to ship. Orbit makes the sound itself, with the Web
 * Audio API, which has three good consequences: nothing to download, nothing to
 * license, and nothing that sounds the same twice. It is a slow, warm pad: four
 * chords that change every so often, a gentle filter drifting over them, and a
 * breath of air underneath, quiet enough to leave running for hours.
 *
 * It is off until somebody turns it on. Browsers (and the webview) refuse to
 * start audio until the page has been interacted with, so this tries when asked
 * and, if it is refused, waits for the first click or key press and starts then.
 * Nothing here ever throws at the caller: a machine with no audio at all should
 * be a silent app, not a broken one.
 */

/** A chord as semitone offsets from the root, and where the root sits. */
interface Chord {
  root: number;
  notes: number[];
}

/**
 * Four chords that belong together in A minor, which is the key most ambient
 * music is written in because nothing in it ever sounds wrong.
 *
 * They sit high: the roots are around A3 rather than A2, and the notes stack up
 * from there. Low chords are what make a pad sound heavy, and this one is meant
 * to sit behind somebody reading, not under them.
 */
const PROGRESSION: Chord[] = [
  { root: 220.0, notes: [0, 7, 12, 14, 19] }, // A minor 9
  { root: 174.61, notes: [0, 7, 12, 16, 19] }, // F major 9
  { root: 261.63, notes: [0, 7, 12, 16, 19] }, // C major 9
  { root: 196.0, notes: [0, 7, 12, 14, 19] }, // G major 9
];

/** How long one chord is held before the next one drifts in. */
const CHORD_SECONDS = 32;

/** The note a semitone offset makes, from a root frequency. */
function note(root: number, semitones: number): number {
  return root * Math.pow(2, semitones / 12);
}

export class Ambient {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private timer: number | null = null;
  private voices: { osc: OscillatorNode; gain: GainNode }[] = [];
  private step = 0;
  private pad: BiquadFilterNode | null = null;
  private wanted = false;
  private volume = 0.35;
  private resumeOn: (() => void) | null = null;

  /** Turn the sound on, and keep it on. */
  start(volume: number): void {
    this.wanted = true;
    this.setVolume(volume);
    this.ensure();
  }

  /**
   * Turn it off. The audio context is kept, so turning it back on is instant and
   * does not need another click from the player.
   */
  stop(): void {
    this.wanted = false;
    this.clearTimer();
    if (!this.context) return;
    // A moment to fall away rather than a click, then silence.
    try {
      const now = this.context.currentTime;
      this.master?.gain.cancelScheduledValues(now);
      this.master?.gain.setTargetAtTime(0, now, 0.35);
    } catch {
      // Nothing to fade.
    }
    this.voices.forEach((v) => {
      try {
        v.osc.stop(this.context!.currentTime + 1.6);
      } catch {
        // Already stopped.
      }
    });
    this.voices = [];
    // The context itself is suspended, so a machine left alone overnight is not
    // running an audio graph for nothing.
    window.setTimeout(() => {
      if (!this.wanted) void this.context?.suspend().catch(() => {});
    }, 1800);
  }

  /** Volume, 0 to 1. Safe to call before anything is playing. */
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.master && this.context && this.wanted) {
      try {
        this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.4);
      } catch {
        // Left at whatever it was.
      }
    }
  }

  /**
   * Whether the window is being looked at.
   *
   * In front, it plays. Behind, it either carries on or steps aside, which is
   * what the setting is for: somebody playing a game in fullscreen does not want
   * two soundtracks, and somebody who leaves Orbit open on a second monitor
   * does.
   */
  setFocused(focused: boolean, keepWhenUnfocused: boolean): void {
    if (!this.context || !this.master) return;
    const target = !focused && !keepWhenUnfocused ? 0 : this.volume;
    try {
      this.master.gain.setTargetAtTime(target, this.context.currentTime, 0.5);
    } catch {
      // Left at whatever it was.
    }
  }

  // ------------------------------------------------------------------ private

  /** Make the audio graph, and start the progression. */
  private ensure(): void {
    if (!this.context) {
      try {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return;
        this.context = new Ctor();
        this.build();
      } catch {
        return;
      }
    }
    // A webview that has not been touched yet will hand back a suspended
    // context. The first click or key press starts it, and until then the app
    // simply has no sound rather than an error.
    if (this.context.state === 'suspended') {
      void this.context.resume().then(
        () => this.beginProgression(),
        () => this.waitForGesture(),
      );
      if (this.context.state === 'suspended') this.waitForGesture();
      return;
    }
    this.beginProgression();
  }

  private waitForGesture(): void {
    if (this.resumeOn) return;
    const go = () => {
      this.removeGesture();
      if (!this.wanted || !this.context) return;
      void this.context.resume().then(
        () => this.beginProgression(),
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

  /** The master gain, a warm filter, and a little air underneath. */
  private build(): void {
    const ctx = this.context;
    if (!ctx) return;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1600;
    filter.Q.value = 0.5;
    filter.connect(this.master);

    // The deep end is taken out before anything reaches the pad. This is the
    // difference between a chord that floats and one that sits on your chest,
    // and no amount of turning it down makes the second one pleasant.
    const rumbleCut = ctx.createBiquadFilter();
    rumbleCut.type = 'highpass';
    rumbleCut.frequency.value = 130;
    rumbleCut.Q.value = 0.6;
    rumbleCut.connect(filter);

    // Air: a very quiet, very slow noise bed, so the pad has something behind it
    // rather than starting from digital silence. Filtered to the point where it
    // is more a texture than a sound.
    const noise = ctx.createBufferSource();
    const seconds = 4;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i += 1) {
      // Brown-ish noise: smoother than white, and it sits under a chord without
      // hissing.
      last = (last + Math.random() * 2 - 1) * 0.5;
      data[i] = last * 0.035;
    }
    noise.buffer = buffer;
    noise.loop = true;
    const airGain = ctx.createGain();
    airGain.gain.value = 0.35;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = 'bandpass';
    airFilter.frequency.value = 780;
    airFilter.Q.value = 0.3;
    noise.connect(airFilter).connect(airGain).connect(rumbleCut);
    noise.start();

    this.pad = filter;
  }

  /** Put a chord up, and bring the one before it down. */
  private beginProgression(): void {
    if (!this.wanted || !this.context || this.timer !== null) return;
    this.clearTimer();
    this.voice(PROGRESSION[this.step % PROGRESSION.length], 4);
    this.step += 1;
    this.timer = window.setInterval(() => {
      if (!this.wanted) return;
      this.voice(PROGRESSION[this.step % PROGRESSION.length], 8);
      this.step += 1;
    }, CHORD_SECONDS * 1000);

    // The filter drifts, so the pad opens and closes rather than sitting still.
    if (this.pad && this.context) {
      try {
        const now = this.context.currentTime;
        this.pad.frequency.cancelScheduledValues(now);
        this.pad.frequency.setValueAtTime(1100, now);
        this.pad.frequency.linearRampToValueAtTime(2100, now + CHORD_SECONDS * 0.6);
        this.pad.frequency.linearRampToValueAtTime(1300, now + CHORD_SECONDS * 1.2);
      } catch {
        // Left where it is.
      }
    }

    if (this.master && this.context) {
      try {
        this.master.gain.cancelScheduledValues(this.context.currentTime);
        this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 3);
      } catch {
        // Left where it is.
      }
    }
  }

  /**
   * One chord: a triangle for the body and a sine an octave up for a little
   * brightness, each with its own slow swell so the notes arrive one after
   * another rather than all at once.
   */
  private voice(chord: Chord, fadeIn: number): void {
    const ctx = this.context;
    const pad = this.pad;
    if (!ctx || !pad) return;

    const now = ctx.currentTime;
    chord.notes.forEach((semitones, i) => {
      const frequency = note(chord.root, semitones);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(pad);

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      // A few cents apart from the note it is meant to be, so two notes in the
      // same chord beat very slowly against each other instead of sounding
      // exactly the same.
      osc.frequency.value = frequency * (1 + (Math.random() - 0.5) * 0.0015);
      osc.detune.value = (Math.random() - 0.5) * 4;
      osc.connect(gain);

      const level = 0.12 / (1 + i * 0.4);
      const arrives = now + i * 0.9;
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(level, arrives + fadeIn);
      // A long fall, so the chords overlap and the change is never heard as a
      // change.
      gain.gain.setTargetAtTime(0, arrives + fadeIn + CHORD_SECONDS * 0.6, CHORD_SECONDS * 0.25);

      osc.start(now);
      osc.stop(now + CHORD_SECONDS * 1.6);
      // Automatically dropped from the graph when it stops.
      osc.onended = () => {
        try {
          gain.disconnect();
        } catch {
          // Nothing to disconnect.
        }
      };
      this.voices.push({ osc, gain });
    });

    // Oscillators that have finished are left to the garbage collector; the
    // list only has to say which ones are still worth fading out on Stop.
    if (this.voices.length > 64) this.voices = this.voices.slice(-32);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }
}

/** One sound for the whole app: two of these would be two pads at once. */
export const ambient = new Ambient();
