/**
 * A short, gentle three-note chime for a successfully saved capture—not a song
 * or jingle. The volume is 0 to 100.
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
  try {
    shared = new Context();
    return shared;
  } catch {
    return null;
  }
}

/** Call from the control click, before a capture is saved, so playback is unlocked. */
export function primeShutter() {
  const ctx = context();
  if (!ctx || ctx.state === 'running') return;
  try {
    void ctx.resume().catch(() => undefined);
  } catch {
    // Audio feedback must never interfere with a capture.
  }
}

export function playShutter(volume = 40): void | Promise<void> {
  const level = Math.min(100, Math.max(0, volume)) / 100;
  if (level <= 0) return;
  const ctx = context();
  if (!ctx) return;

  const play = () => {
    // Wait for WebAudio to leave its suspended state before scheduling notes;
    // otherwise a desktop webview can accept the nodes but produce no sound.
    if (ctx.state !== 'running') return;
    try {
      const now = ctx.currentTime;
      const master = ctx.createGain();
      master.gain.setValueAtTime(level * 0.09, now);
      master.connect(ctx.destination);
      let remainingVoices = 3;

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
        tone.onended = () => {
          tone.disconnect();
          gain.disconnect();
          remainingVoices -= 1;
          if (remainingVoices === 0) master.disconnect();
        };
        tone.start(start);
        tone.stop(start + release + 0.05);
      };

      // A soft, unhurried D-major arpeggio; each note blooms and fades independently.
      voice(0, 0.13, 0);
      voice(4, 0.10, 0.11);
      voice(7, 0.075, 0.22);
    } catch {
      // A missing or interrupted audio device should not turn a saved capture into an error.
    }
  };

  if (ctx.state === 'running') {
    play();
    return;
  }
  try {
    return ctx.resume().then(play).catch(() => undefined);
  } catch {
    return;
  }
}
