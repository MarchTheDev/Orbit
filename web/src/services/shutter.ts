/**
 * A short, gentle three-note chime for a saved picture—not a song or jingle.
 * The volume is 0 to 100.
 */

const ROOT = 293.66; // D4

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
  master.gain.setValueAtTime(level * 0.09, now);
  master.connect(ctx.destination);

  const voice = (semitones: number, peak: number, delay: number) => {
    const start = now + delay;
    const attack = 0.035;
    const release = 0.58;
    const tone = ctx.createOscillator();
    const gain = ctx.createGain();
    tone.type = 'sine';
    tone.frequency.setValueAtTime(frequency(semitones), start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + release);
    tone.connect(gain);
    gain.connect(master);
    tone.start(start);
    tone.stop(start + release + 0.05);
  };

  // A soft, unhurried D-major arpeggio; each note blooms and fades independently.
  voice(0, 0.13, 0);
  voice(4, 0.10, 0.11);
  voice(7, 0.075, 0.22);
  void ctx.resume();
}
