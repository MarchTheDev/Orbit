/**
 * Something quiet to sit behind a game.
 *
 * There is no music file to ship. Orbit makes the sound itself, with the Web
 * Audio API, which has three good consequences: nothing to download, nothing to
 * license, and nothing that sounds the same twice. It is a slow melody rather
 * than a wall of sound: one soft note at a time, plucked and left to ring, over
 * a very low bed.
 *
 * Two things keep it from ever being annoying:
 *
 * - The notes come from a pentatonic scale, five notes to the octave with no
 *   semitones in it. There is no interval in that scale that sounds wrong, so a
 *   note picked by a coin toss still lands on the chord underneath.
 * - The melody walks rather than jumps. Each note is one or two steps from the
 *   one before it, and a quarter of the turns are rests, which is what makes a
 *   line sound like it is going somewhere rather than being generated.
 *
 * It is off until somebody turns it on. Browsers (and the webview) refuse to
 * start audio until the page has been interacted with, so this tries when asked
 * and, if it is refused, waits for the first click or key press and starts then.
 * Nothing here ever throws at the caller: a machine with no audio at all should
 * be a silent app, not a broken one.
 */

/** The five notes of the scale, as semitones from the root. */
const SCALE = [0, 2, 4, 7, 9];

/** How far the melody may wander: two octaves down, one up, from the root. */
const LOWEST = -2 * SCALE.length;
const HIGHEST = SCALE.length;

/** A minor pentatonic rooted at A3, which is where a quiet melody sits. */
const ROOT = 220.0;

/** The note a semitone offset makes, from the root of the scale. */
function note(semitones: number): number {
  return ROOT * Math.pow(2, semitones / 12);
}

/** The semitone offset of one step of the scale, `degree` steps from the root. */
function degreeToSemitones(degree: number): number {
  const octave = Math.floor(degree / SCALE.length);
  const step = SCALE[((degree % SCALE.length) + SCALE.length) % SCALE.length];
  return step + 12 * octave;
}

export class Ambient {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private timer: number | null = null;
  private voices: { osc: OscillatorNode; gain: GainNode }[] = [];
  private pad: BiquadFilterNode | null = null;
  private padTimer: number | null = null;
  private padVoices: { osc: OscillatorNode; gain: GainNode }[] = [];
  private step = 0;
  /** Where the melody currently is, in scale steps from the root. */
  private degree = 0;
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
    this.stopPad();
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
        v.osc.stop(this.context!.currentTime + 2.4);
      } catch {
        // Already stopped.
      }
    });
    this.voices = [];
    // The context itself is suspended, so a machine left alone overnight is not
    // running an audio graph for nothing.
    window.setTimeout(() => {
      if (!this.wanted) void this.context?.suspend().catch(() => {});
    }, 2600);
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

  /** Make the audio graph, and start playing. */
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

  /** The master gain, the space the notes ring in, and a little air underneath. */
  private build(): void {
    const ctx = this.context;
    if (!ctx) return;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // The soft top end every note goes through. Nothing here is bright, because
    // a bright note is the one that gets noticed on the twentieth repeat.
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 2600;
    tone.Q.value = 0.4;
    tone.connect(this.master);

    // Space: a short delay with a little of itself fed back in, which turns one
    // plucked note into a room. Kept away from the melody's own path so the
    // notes stay in front of their own echo.
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.42;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.3;
    const wet = ctx.createGain();
    wet.gain.value = 0.26;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 1800;
    tone.connect(delay);
    delay.connect(damp).connect(feedback).connect(delay);
    delay.connect(wet).connect(this.master);

    // The deep end is taken out before anything reaches the notes. This is the
    // difference between a chord that floats and one that sits on your chest,
    // and no amount of turning it down makes the second one pleasant.
    const rumbleCut = ctx.createBiquadFilter();
    rumbleCut.type = 'highpass';
    rumbleCut.frequency.value = 140;
    rumbleCut.Q.value = 0.6;
    rumbleCut.connect(tone);

    // Air: a very quiet, very slow noise bed, so the melody has something behind
    // it rather than starting from digital silence. Filtered to the point where
    // it is more a texture than a sound.
    const noise = ctx.createBufferSource();
    const seconds = 4;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i += 1) {
      // Brown-ish noise: smoother than white, and it sits under a note without
      // hissing.
      last = (last + Math.random() * 2 - 1) * 0.5;
      data[i] = last * 0.02;
    }
    noise.buffer = buffer;
    noise.loop = true;
    const airGain = ctx.createGain();
    airGain.gain.value = 0.3;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = 'bandpass';
    airFilter.frequency.value = 640;
    airFilter.Q.value = 0.3;
    noise.connect(airFilter).connect(airGain).connect(rumbleCut);
    noise.start();

    this.pad = tone;
  }

  /** Start playing, from silence. */
  private begin(): void {
    if (!this.wanted || !this.context || this.timer !== null) return;
    if (this.master && this.context) {
      try {
        this.master.gain.cancelScheduledValues(this.context.currentTime);
        this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 3);
      } catch {
        // Left where it is.
      }
    }
    // The first note arrives a moment in, so the sound fades up rather than
    // starting on top of whatever the player was doing.
    this.voices = [];
    this.beginPad();
    this.timer = window.setTimeout(() => this.play(), 1400);
  }

  /** One note at a time, each one scheduled when the last has had its turn. */
  private play(): void {
    if (!this.wanted) return;
    this.timer = null;
    // A quarter of the turns are rests, which is what makes the line breathe.
    if (Math.random() > 0.25) this.pluck(degreeToSemitones(this.walk()));
    // Between two and a half and six seconds to the next note: slow enough to
    // sit under a game, and uneven enough not to become a pulse.
    const gap = 2400 + Math.random() * 3600;
    this.timer = window.setTimeout(() => this.play(), gap);
  }

  /**
   * The next note of the melody, as a step of the scale.
   *
   * A walk, not a jump: one or two steps up or down, with a nudge back toward
   * the middle when it has wandered far enough that the next note would be thin
   * or muddy.
   */
  private walk(): number {
    const room = [1, 1, 1, 2, 2, -1, -1, -1, -2, -2];
    let step = room[Math.floor(Math.random() * room.length)];
    if (this.degree > HIGHEST - 2) step -= 2;
    else if (this.degree < LOWEST + 2) step += 2;
    this.degree = Math.max(LOWEST, Math.min(HIGHEST, this.degree + step));
    return this.degree;
  }

  /**
   * One note: a soft pluck that rings out rather than a sustained voice.
   *
   * The tiny second sine an octave up is what makes it read as a bell or a
   * string rather than a test tone, and it is very quiet: the fundamental is
   * the note, and this is only its colour.
   */
  private pluck(semitones: number): void {
    const ctx = this.context;
    const pad = this.pad;
    if (!ctx || !pad) return;

    const now = ctx.currentTime;
    const frequency = note(semitones);

    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(pad);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = frequency;
    osc.connect(gain);

    const shine = ctx.createGain();
    shine.gain.value = 0.14;
    const upper = ctx.createOscillator();
    upper.type = 'sine';
    upper.frequency.value = frequency * 2;
    upper.connect(shine).connect(gain);

    // Plucked, then left: a fast soft attack and a long fall, so two notes that
    // overlap blend instead of fighting.
    const level = 0.24;
    const ring = 4.5 + Math.random() * 1.5;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(level, now + 0.045);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + ring);

    osc.start(now);
    upper.start(now);
    osc.stop(now + ring + 0.2);
    upper.stop(now + ring + 0.2);
    osc.onended = () => {
      try {
        gain.disconnect();
      } catch {
        // Nothing to disconnect.
      }
    };
    this.voices.push({ osc: upper, gain: shine });
    // The finished ones are left to the garbage collector; the list only has to
    // say which are still worth fading out on Stop.
    if (this.voices.length > 64) this.voices = this.voices.slice(-32);
  }

  /** The bed under the melody: root and fifth, very low, changing rarely. */
  private beginPad(): void {
    const ctx = this.context;
    if (!ctx || this.padTimer !== null) return;
    const roots = [0, -3, -5, 2];
    const up = () => {
      if (!this.wanted) return;
      this.padChord(roots[this.step % roots.length]);
      this.step += 1;
    };
    up();
    this.padTimer = window.setInterval(up, 40000);
  }

  /**
   * One chord of the bed: the root, its fifth and its octave, at a level that
   * is felt more than heard.
   *
   * Only the root and the fifth, because thirds are what decide whether a chord
   * is happy or sad, and a bed that changes mood under a melody that has not
   * changed yet is what sounds wrong.
   */
  private padChord(root: number): void {
    const ctx = this.context;
    const pad = this.pad;
    if (!ctx || !pad) return;
    const now = ctx.currentTime;
    const fade = 9;
    [0, 7, 12].forEach((interval, i) => {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(pad);
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = note(root + interval) / 2;
      osc.connect(gain);
      const level = 0.09 / (1 + i * 0.7);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(level, now + fade);
      // A long fall, so the changes overlap and are never heard as a change.
      gain.gain.setTargetAtTime(0, now + fade + 30, 8);
      osc.start(now);
      osc.stop(now + fade + 60);
      osc.onended = () => {
        try {
          gain.disconnect();
        } catch {
          // Nothing to disconnect.
        }
      };
      this.padVoices.push({ osc, gain });
    });
    if (this.padVoices.length > 24) this.padVoices = this.padVoices.slice(-12);
  }

  private stopPad(): void {
    if (this.padTimer !== null) {
      window.clearInterval(this.padTimer);
      this.padTimer = null;
    }
    const at = this.context ? this.context.currentTime + 3 : 0;
    this.padVoices.forEach((v) => {
      try {
        v.osc.stop(at);
      } catch {
        // Already stopped.
      }
    });
    this.padVoices = [];
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
