import { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Volume2, VolumeX } from 'lucide-react';
import { audioApps, audioDevices, audioSet, audioUseDevice, type AppAudio, type AudioDevice } from '../services/native';

type Pending = { volume: number; muted: boolean };

/**
 * The same list as the system volume mixer: the speakers, then each program
 * that is playing sound. A controller uses the quieter and louder buttons.
 * Left and right, while one of those is highlighted, change it too.
 */
function fold(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function matchGame(apps: AppAudio[], game: string): AppAudio | undefined {
  const needle = fold(game);
  if (needle.length < 3) return undefined;
  return apps.find((app) => {
    if (app.device) return false;
    const name = fold(app.name);
    return name.length >= 3 && (name.includes(needle) || needle.includes(name));
  });
}

/**
 * The overlay shows the game, the speakers, and one other source.
 * More opens the rest. Settings shows the whole list.
 */
export function AppMixer({ pad = false, game = '', compact = false }: { pad?: boolean; game?: string; compact?: boolean }) {
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

  const [more, setMore] = useState(false);
  const arranged = useMemo(() => {
    if (!compact) return { top: apps, rest: [] as AppAudio[], missing: false };
    const speakers = apps.find((app) => app.device);
    const others = apps.filter((app) => !app.device);
    const gameApp = matchGame(others, game);
    const top: AppAudio[] = [];
    if (gameApp) top.push(gameApp);
    if (speakers) top.push(speakers);
    for (const app of others) {
      if (top.length >= 3) break;
      if (top.some((item) => item.id === app.id)) continue;
      top.push(app);
    }
    const ids = new Set(top.map((app) => app.id));
    return { top, rest: apps.filter((app) => !ids.has(app.id)), missing: Boolean(game.trim()) && !gameApp };
  }, [apps, compact, game]);
  const shown = !compact ? apps : more ? [...arranged.top, ...arranged.rest] : arranged.top;

  if (error && apps.length === 0) {
    return <p className="text-xs leading-relaxed text-muted">{error}</p>;
  }

  return (
    <div className="space-y-2">
      <DevicePick pad={pad} />
      {apps.length === 0 && <p className="text-xs text-muted">No apps are playing sound.</p>}
      {arranged.missing && (
        <p className="rounded-xl border border-line bg-panel2 px-3 py-2 text-sm">
          {game}
          <span className="text-muted"> · not playing sound</span>
        </p>
      )}
      {shown.map((app) => (
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
      {compact && arranged.rest.length > 0 && (
        <button
          type="button"
          data-overlay={pad ? '' : undefined}
          onClick={() => setMore((open) => !open)}
          className="w-full rounded-xl border border-line px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-fg"
        >
          {more ? 'Less' : `More · ${arranged.rest.length}`}
        </button>
      )}
      {error && <p className="text-xs text-muted">{error}</p>}
    </div>
  );
}

function DevicePick({ pad }: { pad: boolean }) {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [error, setError] = useState('');

  const refresh = () => {
    void audioDevices()
      .then((next) => {
        setDevices(next);
        setError('');
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  };

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 4000);
    return () => window.clearInterval(timer);
  }, []);

  const choose = (kind: string, id: string) => {
    setDevices((list) => list.map((item) => (item.kind === kind ? { ...item, current: item.id === id } : item)));
    void audioUseDevice(id, kind).then(refresh).catch((reason) => {
      setError(reason instanceof Error ? reason.message : String(reason));
      refresh();
    });
  };

  const outputs = devices.filter((item) => item.kind === 'output');
  const inputs = devices.filter((item) => item.kind === 'input');
  if (outputs.length === 0 && inputs.length === 0 && !error) return null;

  return (
    <div className="space-y-2">
      <DeviceSelect label="Output" devices={outputs} pad={pad} onChoose={(id) => choose('output', id)} />
      <DeviceSelect label="Microphone" devices={inputs} pad={pad} onChoose={(id) => choose('input', id)} />
      {error && <p className="text-[11px] text-muted">{error}</p>}
    </div>
  );
}

function DeviceSelect({
  label,
  devices,
  pad,
  onChoose,
}: {
  label: string;
  devices: AudioDevice[];
  pad: boolean;
  onChoose: (id: string) => void;
}) {
  if (devices.length === 0) return null;
  const current = devices.find((item) => item.current)?.id ?? devices[0].id;
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-muted">{label}</span>
      <select
        value={current}
        aria-label={label}
        data-overlay={pad ? '' : undefined}
        onChange={(event) => onChoose(event.target.value)}
        className="w-full rounded-xl border border-line bg-panel2 px-2 py-1.5 text-xs text-fg"
      >
        {devices.map((item) => (
          <option key={item.id} value={item.id}>{item.name}</option>
        ))}
      </select>
    </label>
  );
}
