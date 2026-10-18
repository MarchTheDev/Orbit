/**
 * A short chime for a saved picture.
 *
 * It sits a couple of octaves above the library chord, so it is light rather
 * than a low bell. Recordings stay quiet. The volume is 0 to 100.
 */

const ROOT = 523.2511;

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

  // A short major chord an octave higher than a low C, with a quiet note that lifts.
  voice(0, 0.34, 0.012, 0.28);
  voice(4, 0.2, 0.02, 0.34);
  voice(12, 0.1, 0.01, 0.22, 7);
  void ctx.resume();
}
