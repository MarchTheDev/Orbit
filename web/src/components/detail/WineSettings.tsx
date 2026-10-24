/**
 * Proton and the per-game switches, for a game that runs through Wine.
 *
 * Which Proton a game runs on is the one choice that changes everything: a
 * build from two years ago and the newest GE build are different Windows
 * implementations, and the game that crashes on one runs on the other. So the
 * builds already on this machine are offered by name, and the ones Orbit does
 * not have can be fetched from the same place.
 *
 * The switches underneath are Faugus's, which are Lutris's too, because they
 * are what the pieces under Proton actually read. Every one is written only
 * when it is set, so an untouched game sees exactly what the machine gives it.
 */
import { useEffect, useState } from 'react';
import { Download, Plus, X } from 'lucide-react';
import type { ProtonBuild, WineTweaks } from '../../types';
import { isNative, protonBuilds } from '../../services/native';
import { Checkbox } from '../ui/Checkbox';
import { Select } from '../ui/Select';
import { btnBrowse, btnGhost, inputCls, labelCls } from '../ui/Modal';
import { ProtonManager } from './ProtonManager';

const BLANK: WineTweaks = {
  gamemode: false,
  mangohud: false,
  sdl: false,
  wayland: false,
  wow64: false,
  fsync: null,
  esync: null,
  hud: '',
  gameid: '',
  dllOverrides: '',
  env: [],
};

type Tri = 'auto' | 'on' | 'off';

const triTo = (v: boolean | null | undefined): Tri => (v == null ? 'auto' : v ? 'on' : 'off');
const triFrom = (v: Tri): boolean | null => (v === 'auto' ? null : v === 'on');

export function WineSettings({
  proton,
  tweaks,
  onProton,
  onTweaks,
}: {
  proton: string | null;
  tweaks: WineTweaks | undefined;
  onProton: (path: string | null) => void;
  /** The whole set, so what is stored is always a complete picture. */
  onTweaks: (next: WineTweaks) => void;
}) {
  const t = { ...BLANK, ...(tweaks ?? {}) };
  const [builds, setBuilds] = useState<ProtonBuild[]>([]);
  const [loading, setLoading] = useState(false);
  const [manager, setManager] = useState(false);
  const native = isNative();
  const change = (patch: Partial<WineTweaks>) => onTweaks({ ...t, ...patch });

  const load = () => {
    if (!native) return;
    setLoading(true);
    void protonBuilds()
      .then(setBuilds)
      .catch(() => setBuilds([]))
      .finally(() => setLoading(false));
  };

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps

  // A build can be removed while a game still names it: keep it in the list so
  // the choice stays visible, and say that it is gone.
  const missing = proton && !builds.some((b) => b.path === proton);
  const options = [
    { value: '', label: 'Wine on this machine', hint: 'The Wine in Settings, or the one Orbit fetched' },
    ...builds.map((b) => ({
      value: b.path,
      label: b.name,
      hint: [b.source, b.version && b.version !== b.name ? b.version : '']
        .filter(Boolean)
        .join(' · '),
    })),
    ...(missing ? [{ value: proton!, label: 'A build that is gone', hint: proton! }] : []),
  ];

  const env = t.env ?? [];
  const setEnv = (next: { key: string; value: string }[]) => change({ env: next });

  return (
    <div className="space-y-3 border-t border-line pt-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block min-w-[14rem] flex-1">
          <span className={labelCls}>Proton</span>
          <Select
            value={proton ?? ''}
            onChange={(v) => onProton(v || null)}
            options={options}
            ariaLabel="Proton build"
          />
        </label>
        <button
          type="button"
          className={`${btnBrowse} flex items-center gap-2`}
          onClick={() => setManager(true)}
          disabled={!native}
          title={native ? 'Fetch a Proton-GE build' : 'Only the desktop app can fetch builds'}
        >
          <Download className="size-4" />
          Get Proton-GE…
        </button>
      </div>
      <p className="text-xs text-muted">
        {loading
          ? 'Looking for Proton builds…'
          : `${builds.length} build${builds.length === 1 ? '' : 's'} found on this machine. ` +
            (proton
              ? 'This game runs through the one above, the way Steam runs it.'
              : 'Pick one to run this game through Proton, or leave it on Wine.')}
      </p>

      <div>
        <h4 className="mb-2 mt-1 text-sm font-semibold">Tweaks</h4>
        <p className="mb-2 text-xs text-muted">
          For the game that needs a hand: a pad it will not see, a stutter the
          default profile leaves in. Unchecked means Orbit writes nothing and the
          game sees what your machine normally gives it.
        </p>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Checkbox
            checked={t.mangohud}
            onChange={(v) => change({ mangohud: v })}
            label="MangoHud"
            hint="The frame-rate and frame-time overlay, drawn over the game."
          />
          <Checkbox
            checked={t.gamemode}
            onChange={(v) => change({ gamemode: v })}
            label="GameMode"
            hint="Asks the system for its performance profile while this game runs."
          />
          <Checkbox
            checked={t.sdl}
            onChange={(v) => change({ sdl: v })}
            label="SDL controller"
            hint="PROTON_PREFER_SDL=1, for a pad the game refuses to see."
          />
          <Checkbox
            checked={t.wayland}
            onChange={(v) => change({ wayland: v })}
            label="Wayland driver"
            hint="PROTON_ENABLE_WAYLAND=1, for a desktop where Wine's own driver is smoother."
          />
          <Checkbox
            checked={t.wow64}
            onChange={(v) => change({ wow64: v })}
            label="WOW64"
            hint="PROTON_USE_WOW64=1, for 32-bit games on a 64-bit-only machine."
          />
        </div>

        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="block">
            <span className={labelCls}>fsync</span>
            <Select
              value={triTo(t.fsync)}
              onChange={(v) => change({ fsync: triFrom(v) })}
              options={[
                { value: 'auto', label: 'Leave it to the machine' },
                { value: 'on', label: 'On' },
                { value: 'off', label: 'Off' },
              ]}
              ariaLabel="fsync"
            />
          </label>
          <label className="block">
            <span className={labelCls}>esync</span>
            <Select
              value={triTo(t.esync)}
              onChange={(v) => change({ esync: triFrom(v) })}
              options={[
                { value: 'auto', label: 'Leave it to the machine' },
                { value: 'on', label: 'On' },
                { value: 'off', label: 'Off' },
              ]}
              ariaLabel="esync"
            />
          </label>
          <label className="block">
            <span className={labelCls}>HUD contents</span>
            <input
              className={inputCls}
              value={t.hud}
              onChange={(e) => change({ hud: e.target.value })}
              placeholder="fps,frametimes"
              spellCheck={false}
            />
          </label>
          <label className="block">
            <span className={labelCls}>Game ID for umu</span>
            <input
              className={inputCls}
              value={t.gameid}
              onChange={(e) => change({ gameid: e.target.value })}
              placeholder="umu-2805730"
              spellCheck={false}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className={labelCls}>DLL overrides</span>
            <input
              className={inputCls}
              value={t.dllOverrides}
              onChange={(e) => change({ dllOverrides: e.target.value })}
              placeholder="d3d11=n,b"
              spellCheck={false}
            />
          </label>
        </div>

        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs uppercase tracking-widest text-muted">
              Environment for this game
            </span>
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted hover:text-accent"
              onClick={() => setEnv([...env, { key: '', value: '' }])}
            >
              <Plus className="size-3.5" />
              Add a variable
            </button>
          </div>
          {env.length === 0 ? (
            <p className="text-xs text-muted">
              Nothing extra. Add a name and a value for anything a game needs, such
              as a path or a flag.
            </p>
          ) : (
            <div className="space-y-1.5">
              {env.map((row, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <input
                    className={inputCls}
                    value={row.key}
                    onChange={(e) =>
                      setEnv(env.map((r, n) => (n === i ? { ...r, key: e.target.value } : r)))
                    }
                    placeholder="DXVK_ASYNC"
                    spellCheck={false}
                    aria-label="Variable name"
                  />
                  <span className="text-xs text-muted">=</span>
                  <input
                    className={inputCls}
                    value={row.value}
                    onChange={(e) =>
                      setEnv(env.map((r, n) => (n === i ? { ...r, value: e.target.value } : r)))
                    }
                    placeholder="1"
                    spellCheck={false}
                    aria-label="Variable value"
                  />
                  <button
                    type="button"
                    className={btnGhost + ' px-2 py-1.5'}
                    aria-label="Remove this variable"
                    onClick={() => setEnv(env.filter((_, n) => n !== i))}
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ProtonManager
        open={manager}
        onClose={() => setManager(false)}
        onChanged={load}
      />
    </div>
  );
}
