import { useEffect, useRef, useState } from 'react';
import { Piano, Volume2, VolumeX } from 'lucide-react';
import type { Settings } from '../types';
import { cn } from '../utils/cn';
import { CheckboxInline } from './ui/Checkbox';

type SoundSettings = Settings['sound'];

/**
 * The music, where the sound is.
 *
 * A switch for something you can hear belongs beside the thing playing it: the
 * top bar can start and stop the music, set how loud it is, and say whether it
 * carries on when Orbit is not the window in front. Settings still has all of
 * it, because that is where somebody goes when they do not know where anything
 * is.
 *
 * While it plays, the button carries a few bars that move with it, which is the
 * quickest way to answer "is that noise Orbit?" without clicking anything.
 */
export function MusicButton({
  sound,
  onChange,
  showBars,
  onOpenSettings,
}: {
  sound: SoundSettings | undefined;
  onChange: (next: SoundSettings) => void;
  /** Whether the little visualizer is drawn. Settings decides. */
  showBars: boolean;
  onOpenSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  const playing = sound?.enabled === true;
  const volume = sound?.volume ?? 0.35;
  const unfocused = sound?.unfocused === true;

  /** Anything pressed outside the panel closes it. */
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', away);
    return () => window.removeEventListener('mousedown', away);
  }, [open]);

  return (
    <div className="relative" ref={box}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Music"
        aria-expanded={open}
        title={playing ? 'Music is on' : 'Music is off'}
        className={cn(
          'flex items-center gap-2 rounded-full p-2 text-muted transition hover:bg-panel/70 hover:text-fg',
          playing && 'text-accent hover:text-accent',
        )}
      >
        {playing ? <Piano className="size-5" strokeWidth={1.8} /> : <VolumeX className="size-5" strokeWidth={1.8} />}
        {playing && showBars && (
          <span className="orbit-bars" aria-hidden>
            <i />
            <i />
            <i />
            <i />
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-64 space-y-3 rounded-2xl border border-line bg-panel/95 p-4 text-sm shadow-2xl backdrop-blur-xl">
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 font-medium">
              <Volume2 className="size-4 text-accent" />
              Background music
            </span>
            <button
              onClick={() => onChange({ enabled: !playing, volume, unfocused })}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition',
                playing ? 'border-accent/60 text-accent' : 'border-line text-muted hover:border-accent/60 hover:text-fg',
              )}
            >
              {playing ? 'Turn off' : 'Turn on'}
            </button>
          </div>

          <label className={cn('block space-y-1', !playing && 'opacity-50')}>
            <span className="flex items-center justify-between text-xs text-muted">
              <span>Volume</span>
              <span className="font-mono">{Math.round(volume * 100)}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              disabled={!playing}
              onChange={(e) => onChange({ enabled: true, volume: Number(e.target.value) / 100, unfocused })}
              className="orbit-range w-full"
              aria-label="Music volume"
            />
          </label>

          <CheckboxInline
            checked={unfocused}
            onChange={(v) => onChange({ enabled: playing, volume, unfocused: v })}
            label="Keep playing when Orbit is not in front"
          />

          <button
            onClick={() => {
              setOpen(false);
              onOpenSettings();
            }}
            className="text-xs text-muted underline decoration-dotted hover:text-accent"
          >
            All sound settings
          </button>
        </div>
      )}
    </div>
  );
}
