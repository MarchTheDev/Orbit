import { useEffect, useRef, useState } from 'react';
import { Minus, Plus, Volume2, VolumeX } from 'lucide-react';
import { audioApps, audioSet, type AppAudio } from '../services/native';

type Pending = { volume: number; muted: boolean };

/**
 * The same list as the system volume mixer: the speakers, then each program
 * that is playing sound. A controller uses the quieter and louder buttons.
 * Left and right, while one of those is highlighted, change it too.
 */
export function AppMixer({ pad = false }: { pad?: boolean }) {
  const [apps, setApps] = useState<AppAudio[]>([]);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<Record<string, Pending>>({});
  const appsRef = useRef(apps);
  appsRef.current = apps;
  const nudgeRef = useRef<(id: string, delta: number) => void>(() => undefined);

  const refresh = () => {
    void audioApps()
      .then((next) => {
        setApps(next.map((app) => {
          const held = pending.current[app.id];
          return held ? { ...app, volume: held.volume, muted: held.muted } : app;
        }));
        setError(null);
      })
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : String(reason));
      });
  };

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 2000);
    const onMix = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; delta?: number }>).detail;
      if (!detail?.id || typeof detail.delta !== 'number') return;
      nudgeRef.current(detail.id, detail.delta);
    };
    if (pad) window.addEventListener('orbit-mix', onMix);
    return () => {
      window.clearInterval(timer);
      if (pad) window.removeEventListener('orbit-mix', onMix);
    };
  }, [pad]);

  const remember = (id: string, volume: number, muted: boolean) => {
    pending.current[id] = { volume, muted };
    setApps((current) => current.map((item) => (item.id === id ? { ...item, volume, muted } : item)));
    void audioSet(id, volume, muted).finally(() => {
      const held = pending.current[id];
      if (held && held.volume === volume && held.muted === muted) delete pending.current[id];
    });
  };

  const nudge = (id: string, delta: number) => {
    const app = appsRef.current.find((item) => item.id === id);
    if (!app) return;
    const base = pending.current[id]?.volume ?? app.volume;
    remember(id, Math.min(100, Math.max(0, base + delta)), app.muted);
  };
  nudgeRef.current = nudge;

  const setVolume = (id: string, volume: number, muted: boolean) => {
    remember(id, Math.min(100, Math.max(0, Math.round(volume))), muted);
  };

  if (error && apps.length === 0) {
    return <p className="text-xs leading-relaxed text-muted">{error}</p>;
  }

  return (
    <div className="space-y-2">
      {apps.length === 0 && <p className="text-xs text-muted">No apps are playing sound.</p>}
      {apps.map((app) => (
        <div key={app.id} className="rounded-xl border border-line bg-panel2 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm">{app.name}</span>
            <button
              type="button"
              data-overlay={pad ? '' : undefined}
              data-mix={app.id}
              aria-label={app.muted ? `Unmute ${app.name}` : `Mute ${app.name}`}
              onClick={() => setVolume(app.id, app.volume, !app.muted)}
              className="grid size-7 shrink-0 place-items-center rounded-lg border border-line text-muted hover:border-accent hover:text-fg"
            >
              {app.muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
            </button>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              data-overlay={pad ? '' : undefined}
              data-mix={app.id}
              aria-label={`Quieter ${app.name}`}
              onClick={() => nudge(app.id, -1)}
              className="grid size-7 shrink-0 place-items-center rounded-lg border border-line text-muted hover:border-accent hover:text-fg"
            >
              <Minus className="size-3.5" />
            </button>
            <input
              tabIndex={-1}
              type="range"
              min={0}
              max={100}
              value={app.volume}
              aria-label={`${app.name} volume`}
              onChange={(event) => setVolume(app.id, Number(event.target.value), app.muted)}
              className="min-w-0 flex-1 accent-[var(--c-accent)]"
            />
            <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-muted">{app.volume}</span>
            <button
              type="button"
              data-overlay={pad ? '' : undefined}
              data-mix={app.id}
              aria-label={`Louder ${app.name}`}
              onClick={() => nudge(app.id, 1)}
              className="grid size-7 shrink-0 place-items-center rounded-lg border border-line text-muted hover:border-accent hover:text-fg"
            >
              <Plus className="size-3.5" />
            </button>
          </div>
        </div>
      ))}
      {error && <p className="text-xs text-muted">{error}</p>}
    </div>
  );
}
