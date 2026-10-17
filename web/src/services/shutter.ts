/**
 * A short chime for a saved picture.
 *
 * It uses the same warm sine tones as the library chord, not a camera click.
 * Recordings stay quiet. The volume is 0 to 100.
 */

const ROOT = 130.8128;

function frequency(semitones: number): number {
  return ROOT * Math.pow(2, semitones / 12);
}

let shared: AudioContext | null = null;

function context(): AudioContext | null {
  if (shared) return shared;
  const Context = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  shared = new Context();
  return shared;
}

/** Call from the click itself, before the picture is saved, so the chime is allowed to play. */
export function primeShutter() {
  const ctx = context();
  if (ctx) void ctx.resume();
}

export function playShutter(volume = 40) {
  const level = Math.min(100, Math.max(0, volume)) / 100;
  if (level <= 0) return;
  const ctx = context();
  if (!ctx) return;
  const now = ctx.currentTime;
  const master = ctx.createGain();
  master.gain.setValueAtTime(level * 0.2, now);
  master.connect(ctx.destination);

  const voice = (semitones: number, peak: number, attack: number, release: number, glide?: number) => {
    const tone = ctx.createOscillator();
    const gain = ctx.createGain();
    tone.type = 'sine';
    tone.frequency.setValueAtTime(frequency(semitones), now);
    if (glide != null) tone.frequency.exponentialRampToValueAtTime(frequency(glide), now + release);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + release);
    tone.connect(gain);
    gain.connect(master);
    tone.start(now);
    tone.stop(now + release + 0.05);
    return tone;
  };

  // C3, a fifth above it, and a quiet high note that falls back into the chord.
  voice(0, 0.42, 0.04, 0.62);
  voice(7, 0.26, 0.06, 0.9);
  voice(24, 0.1, 0.02, 0.48, 19);
  void ctx.resume();
}
