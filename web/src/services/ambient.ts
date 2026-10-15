/**
 * A quiet, space-like sound bed for the library.
 *
 * The sound is synthesized locally. Slow, open chords drift into one another,
 * with occasional soft chimes drawn from the same consonant scale. There is no
 * beat or singable tune: the notes are sparse points of light over a steady,
 * gently moving atmosphere.
 *
 * Sound plays unless it has been turned off. If the webview has not received a
 * user gesture yet, playback waits quietly for the first click or key press.
 */

import { fileSrc } from './desktop';
import { ambientFile, ambientSet, isNative } from './native';

/** C3 keeps the chimes warm while leaving room for game audio. */
const ROOT = 130.8128;

/** A small fixed constellation, spaced unevenly rather than played as a tune. */
const SPARKLES = [
  { semitones: 24, afterMs: 6500, level: 0.82 },
  { semitones: 19, afterMs: 8200, level: 0.64 },
  { semitones: 26, afterMs: 5900, level: 0.73 },
  { semitones: 21, afterMs: 9300, level: 0.68 },
  { semitones: 28, afterMs: 7100, level: 0.61 },
  { semitones: 16, afterMs: 10400, level: 0.66 },
  { semitones: 24, afterMs: 5700, level: 0.78 },
  { semitones: 14, afterMs: 8600, level: 0.58 },
  { semitones: 21, afterMs: 11200, level: 0.63 },
  { semitones: 26, afterMs: 7600, level: 0.71 },
  { semitones: 19, afterMs: 9100, level: 0.59 },
  { semitones: 28, afterMs: 6500, level: 0.64 },
] as const;

/** Open, gently shifting colors. Shared tones make each change feel related. */
const CHORDS = [
  [
    { semitones: -12, level: 0.023 },
    { semitones: -5, level: 0.016 },
    { semitones: 2, level: 0.013 },
    { semitones: 4, level: 0.010 },
    { semitones: 11, level: 0.008 },
  ],
  [
    { semitones: -10, level: 0.021 },
    { semitones: -3, level: 0.014 },
    { semitones: 2, level: 0.012 },
    { semitones: 4, level: 0.010 },
    { semitones: 9, level: 0.008 },
  ],
  [
    { semitones: -3, level: 0.021 },
    { semitones: 2, level: 0.014 },
    { semitones: 4, level: 0.012 },
    { semitones: 7, level: 0.010 },
    { semitones: 11, level: 0.008 },
  ],
  [
    { semitones: -5, level: 0.021 },
    { semitones: 2, level: 0.015 },
    { semitones: 4, level: 0.012 },
    { semitones: 9, level: 0.010 },
    { semitones: 11, level: 0.008 },
  ],
] as const;

/** Chords take their time; the full color cycle lasts a little over a minute. */
const CHORD_CHANGE_SECONDS = 18;
const FIRST_SPARKLE_MS = 3200;
const CHIME_RING_SECONDS = 5.2;
const PAD_FADE_SECONDS = 7.8;

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
  private sparkleIndex = 0;
  private chordIndex = -1;
  private phraseStartedAt = 0;
  private wanted = false;
  private volume = 0.35;
  private resumeOn: (() => void) | null = null;
  /**
   * Linux WebKit's Web Audio graph often stays silent. When the system player
   * took the pad, the oscillators stay off so two copies don't play.
   */
  private nativeHeld = false;
  /** A file the player picked. Empty means the chord. */
  private file: string | null = null;
  /** The system player has the file, so the web view must stay quiet. */
  private fileNative = false;
  /** The file could not be played. The chord is used until a different file is chosen. */
  private fileFailed = false;
  private fileAudio: HTMLAudioElement | null = null;
  private fileSrc = '';
  /** play() was refused until the window is clicked. Not the same as a bad file. */
  private fileBlocked = false;
  /** play() has either started or refused. Until then the system player stays out. */
  private fileSettled = false;
  /** Drops a start that was overtaken by a newer one, so a stop cannot land late. */
  private applyGen = 0;
  /** Whether the pad should be heard right now. A fake blur must not clear this. */
  private audible = true;
  /**
   * WebKitGTK reports a blur at startup, before the window has ever been
   * focused. That blur is ignored until a real focus has been seen.
   */
  private sawFocus = false;

  /**
   * Turn the sound on, and keep it on.
   *
   * `file` replaces the chord. An empty file is the chord again: the same one
   * a fresh install plays, not a leftover of the file that was just removed.
   */
  start(volume: number, file?: string | null): void {
    this.wanted = true;
    this.volume = Math.max(0, Math.min(1, volume));
    const next = file?.trim() ? file.trim() : null;
    const changed = next !== this.file;
    if (changed) {
      this.file = next;
      this.fileFailed = false;
      this.fileNative = false;
      this.stopFileElement();
    }
    const gen = ++this.applyGen;
    void this.apply(gen, changed);
  }

  /**
   * A file and the chord never play at once. Leaving a file waits until the
   * system player has actually stopped, then the chord starts.
   */
  private async apply(gen: number, changed: boolean): Promise<void> {
    if (this.file && !this.fileFailed) {
      await this.playCustom(gen);
      return;
    }
    this.stopFileElement();
    if ((changed || this.fileNative) && this.onLinux() && isNative()) {
      this.fileNative = false;
      this.nativeHeld = false;
      try {
        await ambientSet(false, 0, true);
      } catch {
        // The chord is next either way.
      }
    }
    this.fileNative = false;
    if (!this.wanted || gen !== this.applyGen) return;
    if (this.onLinux()) void this.tryNative();
    else this.ensure();
  }

  private async playCustom(gen: number): Promise<void> {
    const file = this.file;
    if (!file || !this.wanted || gen !== this.applyGen) return;
    this.stopOscillators();
    this.nativeHeld = false;
    // A file already moving in the web view only needs its volume changed.
    // Restarting it on every slider tick would throw the song back to the start.
    const audio = this.fileAudio;
    if (audio && !this.fileFailed && !this.fileNative && this.fileSrc === fileSrc(file) && !audio.paused && audio.currentTime > 0) {
      audio.volume = this.audible ? this.volume : 0;
      return;
    }
    // The media element is tried first so the slider can ride a file that is
    // actually playing. Linux Web Audio is often silent; a media element is a
    // different path. If it does not advance, the system player takes the file.
    this.fileBlocked = false;
    this.fileNative = false;
    const started = await this.tryFileElement(file, gen);
    if (gen !== this.applyGen || this.file !== file || !this.wanted) return;
    // A refusal is waiting on a click. Starting the system player as well would
    // be two copies once that click arrives.
    if (started || this.fileBlocked) return;
    await this.fileViaSystem(file);
  }

  /** True when the media element has actually started, not merely accepted play(). */
  private async tryFileElement(file: string, gen: number): Promise<boolean> {
    this.startFileElement(file);
    const deadline = Date.now() + 1500;
    while (!this.fileSettled && Date.now() < deadline) {
      if (gen !== this.applyGen || this.file !== file) return false;
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    if (gen !== this.applyGen || this.file !== file || this.fileBlocked || !this.fileSettled) return false;
    await new Promise((resolve) => window.setTimeout(resolve, 400));
    if (gen !== this.applyGen || this.file !== file) return false;
    const audio = this.fileAudio;
    if (!audio || audio.error) return false;
    return !audio.paused && audio.currentTime > 0.05;
  }

  private startFileElement(file: string): void {
    if (!this.fileAudio) {
      const audio = new Audio();
      audio.loop = true;
      audio.preload = 'auto';
      audio.addEventListener('error', () => {
        if (!this.file || this.fileAudio !== audio) return;
        this.fileFailed = true;
        this.stopFileElement();
        if (this.wanted) {
          if (this.onLinux()) void this.tryNative();
          else this.ensure();
        }
      });
      this.fileAudio = audio;
    }
    const audio = this.fileAudio;
    const src = fileSrc(file);
    if (this.fileSrc !== src) {
      this.fileSrc = src;
      audio.src = src;
    }
    audio.volume = this.audible ? this.volume : 0;
    this.fileSettled = false;
    this.fileBlocked = false;
    void audio.play().then(
      () => {
        this.fileBlocked = false;
        this.fileSettled = true;
        if (this.fileNative) this.stopFileElement();
      },
      () => {
        this.fileBlocked = true;
        this.fileSettled = true;
        this.waitForFile();
      },
    );
  }

  private waitForFile(): void {
    if (this.resumeOn) return;
    const go = () => {
      this.removeGesture();
      if (!this.wanted || !this.file || this.fileFailed || this.fileNative) return;
      const file = this.file;
      void this.fileAudio?.play().then(
        async () => {
          this.fileBlocked = false;
          await new Promise((resolve) => window.setTimeout(resolve, 450));
          if (this.file !== file || !this.wanted || this.fileNative) return;
          const audio = this.fileAudio;
          if (audio && !audio.error && audio.currentTime > 0.05) return;
          await this.fileViaSystem(file);
        },
        () => undefined,
      );
    };
    this.resumeOn = go;
    window.addEventListener('pointerdown', go, { once: true });
    window.addEventListener('keydown', go, { once: true });
  }

  /** The system player, when the web view accepted the file and then stayed silent. */
  private async fileViaSystem(file: string): Promise<void> {
    if (!this.onLinux() || !isNative()) {
      this.fileFailed = true;
      this.stopFileElement();
      this.ensure();
      return;
    }
    try {
      const held = await ambientFile(file, this.volume, this.audible);
      if (this.file !== file || !this.wanted) {
        if (held) void ambientSet(false, 0, true).catch(() => undefined);
        return;
      }
      if (held) {
        this.fileNative = true;
        this.fileBlocked = false;
        this.stopFileElement();
        return;
      }
    } catch {
      // Chord below.
    }
    this.fileFailed = true;
    this.stopFileElement();
    if (this.wanted) void this.tryNative();
  }

  private stopFileElement(): void {
    const audio = this.fileAudio;
    if (!audio) return;
    audio.pause();
    audio.removeAttribute('src');
    this.fileSrc = '';
    try {
      audio.load();
    } catch {
      // Already stopped.
    }
  }

  /**
   * Ask the system player first. It answers false when it has nothing to play
   * through, and that is the cue to use the web view instead.
   */
  private async tryNative(): Promise<void> {
    if (!isNative()) {
      this.ensure();
      return;
    }
    try {
      const held = await ambientSet(true, this.volume, true);
      if (!this.wanted) {
        if (held) void ambientSet(false, 0, true).catch(() => undefined);
        return;
      }
      this.nativeHeld = held;
      if (held) this.stopOscillators();
      else this.ensure();
    } catch {
      this.nativeHeld = false;
      if (this.wanted) this.ensure();
    }
  }

  /** Fade to silence, stop the notes, and suspend the audio graph shortly after. */
  stop(): void {
    this.wanted = false;
    this.applyGen += 1;
    this.nativeHeld = false;
    this.fileNative = false;
    this.stopFileElement();
    if (this.onLinux() && isNative()) void ambientSet(false, this.volume, true).catch(() => undefined);
    this.stopOscillators();
  }

  private stopOscillators(): void {
    this.clearTimer();
    this.fadeVoices(this.voices);
    this.fadeVoices(this.padVoices);
    this.voices = [];
    this.padVoices = [];
    this.sparkleIndex = 0;
    this.chordIndex = -1;
    this.removeGesture();
    if (!this.context) return;

    try {
      const now = this.context.currentTime;
      this.master?.gain.cancelScheduledValues(now);
      this.master?.gain.setTargetAtTime(0, now, 0.6);
    } catch {
      // Nothing to fade.
    }

    // Keep the context around so turning the sound back on is quick, but do not
    // leave an idle audio device running in the background.
    window.setTimeout(() => {
      if (!this.wanted) void this.context?.suspend().catch(() => {});
    }, 3000);
  }

  /** Volume, 0 to 1. Safe to call before anything is playing. */
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.file && this.fileNative && !this.fileFailed) {
      void ambientFile(this.file, this.volume, this.audible).catch(() => undefined);
      return;
    }
    if (this.file && this.fileAudio && !this.fileFailed) {
      this.fileAudio.volume = this.audible ? this.volume : 0;
      return;
    }
    if (this.nativeHeld) {
      void ambientSet(this.wanted, this.audible ? this.volume : 0, this.audible).catch(() => undefined);
    }
    if (!this.master || !this.context || !this.wanted) return;
    try {
      this.master.gain.setTargetAtTime(this.volume, this.context.currentTime, 0.7);
    } catch {
      // Leave the last usable value in place.
    }
  }

  /** Whether the window is being looked at, and whether sound may continue away. */
  setFocused(focused: boolean, keepWhenUnfocused: boolean): void {
    // The first reports are often a blur with no focus before it. Honouring
    // that writes silence into the system player and the bars stay still.
    // A blur only counts after the window has actually been focused once.
    if (this.onLinux() && !this.sawFocus) {
      if (focused) this.sawFocus = true;
      else if (typeof document === 'undefined' || document.visibilityState !== 'hidden') focused = true;
    } else if (focused) {
      this.sawFocus = true;
    }
    const audible = focused || keepWhenUnfocused;
    const changed = audible !== this.audible;
    this.audible = audible;
    if (this.file && this.fileNative && !this.fileFailed) {
      if (changed) void ambientFile(this.file, this.volume, this.audible).catch(() => undefined);
      return;
    }
    if (this.file && this.fileAudio && !this.fileFailed) {
      this.fileAudio.volume = this.audible ? this.volume : 0;
      if (this.audible && this.fileAudio.paused) void this.fileAudio.play().catch(() => this.waitForFile());
      return;
    }
    if (this.nativeHeld) {
      void ambientSet(this.wanted, this.audible ? this.volume : 0, this.audible).catch(() => undefined);
      return;
    }
    if (!this.context || !this.master) return;
    const target = !focused && !keepWhenUnfocused ? 0 : this.volume;
    try {
      this.master.gain.setTargetAtTime(target, this.context.currentTime, 0.9);
    } catch {
      // Leave the last usable value in place.
    }
  }

  // ------------------------------------------------------------------ private

  private onLinux(): boolean {
    return typeof navigator !== 'undefined' && /linux/i.test(navigator.userAgent);
  }

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

  /** Soft filtering plus a very slow filter drift keeps the drone from feeling static. */
  private build(): void {
    const ctx = this.context;
    if (!ctx) return;

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    const highpass = ctx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 48;
    highpass.Q.value = 0.35;

    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 1550;
    this.tone.Q.value = 0.3;

    highpass.connect(this.tone).connect(this.master);

    const drift = ctx.createOscillator();
    drift.type = 'sine';
    drift.frequency.value = 0.035;
    const driftAmount = ctx.createGain();
    driftAmount.gain.value = 150;
    drift.connect(driftAmount).connect(this.tone.frequency);
    drift.start();
  }

  private begin(): void {
    if (!this.wanted || !this.context || this.timer !== null) return;

    try {
      this.master?.gain.cancelScheduledValues(this.context.currentTime);
      this.master?.gain.setTargetAtTime(this.volume, this.context.currentTime, 3.5);
    } catch {
      // Leave the last usable value in place.
    }

    this.sparkleIndex = 0;
    this.phraseStartedAt = this.context.currentTime;
    this.beginPad(0);
    // Give the slow chord some space before the first distant glint.
    this.timer = window.setTimeout(() => this.play(), FIRST_SPARKLE_MS);
  }

  private play(): void {
    const ctx = this.context;
    if (!this.wanted || !ctx) return;
    this.timer = null;

    const elapsed = Math.max(0, ctx.currentTime - this.phraseStartedAt);
    const chord = Math.floor(elapsed / CHORD_CHANGE_SECONDS) % CHORDS.length;
    if (chord !== this.chordIndex) this.beginPad(chord);

    const sparkle = SPARKLES[this.sparkleIndex];
    this.pluck(sparkle.semitones, sparkle.level);
    this.sparkleIndex = (this.sparkleIndex + 1) % SPARKLES.length;
    this.timer = window.setTimeout(() => this.play(), sparkle.afterMs);
  }

  /** A soft bell-like sine with a faint octave shimmer and a long, gentle tail. */
  private pluck(semitones: number, level: number): void {
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
    overtoneGain.gain.value = 0.016;
    overtone.connect(overtoneGain);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.043 * level, now + 0.32);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + CHIME_RING_SECONDS);

    fundamental.connect(gain);
    overtoneGain.connect(gain);
    gain.connect(tone);
    fundamental.start(now);
    overtone.start(now);
    fundamental.stop(now + CHIME_RING_SECONDS + 0.15);
    overtone.stop(now + CHIME_RING_SECONDS + 0.15);

    this.voices.push({ oscillators: [fundamental, overtone], gain });
    if (this.voices.length > 20) this.voices = this.voices.slice(-12);
  }

  /** Crossfade a new open chord into the drone over several seconds. */
  private beginPad(chordIndex: number): void {
    const ctx = this.context;
    const tone = this.tone;
    if (!ctx || !tone) return;

    if (this.padVoices.length > 0) this.fadeVoices(this.padVoices, PAD_FADE_SECONDS, 2.2);

    const now = ctx.currentTime;
    this.padVoices = CHORDS[chordIndex].map(({ semitones, level }) => {
      const base = frequency(semitones);
      const first = ctx.createOscillator();
      first.type = 'sine';
      first.frequency.value = base;
      first.detune.value = -3.5;

      const second = ctx.createOscillator();
      second.type = 'sine';
      second.frequency.value = base;
      second.detune.value = 3.5;

      const mix = ctx.createGain();
      mix.gain.value = 0.5;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(level, now + 7);
      first.connect(mix).connect(gain).connect(tone);
      second.connect(mix);
      first.start(now);
      second.start(now);
      return { oscillators: [first, second], gain };
    });
    this.chordIndex = chordIndex;
  }

  private fadeVoices(voices: Voice[], stopAfter = 2.3, timeConstant = 0.6): void {
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

/** One sound for the whole app: two of these would be two atmospheres at once. */
export const ambient = new Ambient();

