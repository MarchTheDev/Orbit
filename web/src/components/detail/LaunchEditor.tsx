import { useEffect, useRef, useState } from 'react';
import { AppWindow, FolderOpen, Plus, Timer, Wine, X } from 'lucide-react';
import type { Companion, Game, LaunchTarget } from '../../types';
import { isNative } from '../../services/native';
import { pickFile } from '../../services/desktop';
import { desktopOs } from '../../utils/platform';
import { btnBrowse, inputCls, labelCls } from '../ui/Modal';
import { WineSettings } from './WineSettings';
import { buildName } from '../../utils/proton';
import { say } from '../../utils/toast';

// Emulator and Steam used to be choices here. Both are gone: an emulator is just
// a program with a ROM as an argument, and Steam is not something the player
// should have to type an app id for, games imported from a Steam library carry
// that with them.
const KINDS: { kind: LaunchTarget['kind']; label: string; hint: string; icon: typeof Timer }[] = [
  { kind: 'executable', label: 'Program', hint: 'The game is a program on this machine.', icon: AppWindow },
  {
    kind: 'wine',
    label: 'Wine',
    hint: 'A Windows .exe, through Wine or a Proton build. Name a prefix if the game has one.',
    icon: Wine,
  },
  { kind: 'none', label: 'Timer only', hint: 'Orbit keeps the clock but does not start anything.', icon: Timer },
];

/** Windows starts a program. Linux can start a native program, or a Windows .exe through Wine. */
function kindsForThisMachine() {
  const want = desktopOs() === 'linux' ? ['executable', 'wine', 'none'] : ['executable', 'none'];
  return KINDS.filter((kind) => want.includes(kind.kind));
}

/** The folder a program lives in, which is where it expects to be started. */
function parentOf(path: string): string | null {
  const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return cut > 0 ? path.slice(0, cut) : null;
}

/** The one path each kind needs, so it can be summarised in one line. */
function summarise(t: LaunchTarget, companions: Companion[]): string {
  const extra = companions.length ? ` + ${companions.length} alongside` : '';
  switch (t.kind) {
    case 'executable':
      // Chosen but not yet pointed at anything: say so rather than show a
      // blank line where the program should be.
      return t.path.trim() ? `${t.path}${extra}` : `No program chosen yet${extra}`;
    case 'wine': {
      // Which build it runs on matters as much as which program it is.
      const build = buildName(t.proton);
      const through = build ? `Proton ${build}` : 'Wine';
      return t.path.trim() ? `${through} · ${t.path}${extra}` : `${through}, no program chosen yet${extra}`;
    }
    case 'steam':
      return `Steam app ${t.appId}${extra}`;
    case 'lutris':
      return t.slug ? `Lutris · ${t.slug}${extra}` : `Lutris${extra}`;
    default:
      return `Timer only, nothing is launched${extra}`;
  }
}

/**
 * How Orbit starts this game, and what it runs when the clock starts.
 *
 * "Alongside" is the point of the second half: a game and the tool that has to
 * be running with it, such as Assetto Corsa and Lossless Scaling. Those programs
 * are started with the game and never watched, so closing one does not end the
 * session.
 */
export function LaunchEditor({
  game,
  onSave,
  saveOnClose = false,
}: {
  game: Game;
  onSave: (t: LaunchTarget, companions: Companion[]) => void;
  /** The edit dialog keeps launch changes when it closes, so it has no button. */
  saveOnClose?: boolean;
}) {
  const [target, setTarget] = useState<LaunchTarget>(game.launch ?? { kind: 'none' });
  const [args, setArgs] = useState(
    target.kind === 'executable' || target.kind === 'wine' ? (target.args ?? '') : '',
  );
  const [companions, setCompanions] = useState<Companion[]>(game.companions ?? []);
  const native = isNative();
  const offered = kindsForThisMachine();
  const kinds = offered.some((kind) => kind.kind === target.kind)
    ? offered
    : [...offered, ...KINDS.filter((kind) => kind.kind === target.kind)];

  /**
   * Pick a way to start the game, and save it straight away.
   *
   * Choosing a kind and then having to press Save was a trap: the chip looked
   * applied, so "Timer only" followed by Play still started the game, because
   * nothing had been written down. A choice from this row is a decision, and it
   * is kept the moment it is made.
   */
  const switchKind = (kind: LaunchTarget['kind']) => {
    if (kind === 'none') {
      setTarget({ kind: 'none' });
      onSave({ kind: 'none' }, companions);
      say(`${game.title} is timed only: Orbit starts nothing`);
      return;
    }
    if (kind === 'executable') {
      const picked: LaunchTarget = {
        kind: 'executable',
        path: game.exePath ?? '',
        args: '',
        workingDir: game.installDir,
      };
      setTarget(picked);
      // Without a program there is nothing to save yet: the Browse button and
      // the Save button below are the way through.
      if (picked.path.trim()) {
        onSave(
          { kind: 'executable', path: picked.path, args, workingDir: parentOf(picked.path) },
          companions,
        );
        say(`${game.title} starts ${picked.path.split(/[\\/]/).pop()}`);
      }
      return;
    }
    if (kind === 'wine') {
      const picked: LaunchTarget = {
        kind: 'wine',
        path: game.exePath ?? '',
        args: '',
        // The install folder is not the bottle. Wine finds the bottle from the
        // program when it sits in drive_c; otherwise the default bottle is used.
        prefix: null,
        wine: null,
      };
      setTarget(picked);
      if (picked.path.trim()) {
        onSave(picked, companions);
        say(`${game.title} starts through Wine`);
      }
    }
  };

  const save = (announce = true) => {
    if (target.kind === 'executable') {
      if (!target.path.trim()) return;
      onSave({ kind: 'executable', path: target.path, args, workingDir: parentOf(target.path) }, companions);
    } else if (target.kind === 'wine') {
      if (!target.path.trim()) return;
      onSave({ ...target, args }, companions);
    } else if (target.kind === 'steam') {
      onSave({ kind: 'steam', appId: Number(target.appId) || 0 }, companions);
    } else if (target.kind === 'lutris') {
      onSave(target, companions);
    } else {
      onSave({ kind: 'none' }, companions);
    }
    if (announce) say('Launch settings saved');
  };

  const setCompanion = (i: number, patch: Partial<Companion>) => {
    setCompanions((list) => list.map((c, n) => (n === i ? { ...c, ...patch } : c)));
  };

  const savedArgs = game.launch && (game.launch.kind === 'executable' || game.launch.kind === 'wine') ? game.launch.args ?? '' : '';
  const dirty =
    JSON.stringify(target) !== JSON.stringify(game.launch ?? { kind: 'none' }) ||
    JSON.stringify(companions) !== JSON.stringify(game.companions ?? []) ||
    ((target.kind === 'executable' || target.kind === 'wine') && args !== savedArgs);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const saveRef = useRef(save);
  saveRef.current = save;
  // Typing saves itself: a change that settles for a blink is written, with no
  // button to remember and no toast to shout over every pause. A switch of
  // kind or a picked file is written on the spot, above.
  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => saveRef.current(false), 400);
    return () => window.clearTimeout(timer);
  }, [dirty, target, args, companions]);
  useEffect(() => {
    if (!saveOnClose) return;
    return () => {
      if (dirtyRef.current) saveRef.current(false);
    };
  }, [saveOnClose]);

  return (
    <section className="space-y-4 rounded-xl border border-line bg-panel2 p-4">
      <div>
        <h3 className="mb-2 text-sm font-semibold">Launching</h3>

        <div className="mb-3 flex flex-wrap gap-1.5">
          {kinds.map((k) => (
            <button
              key={k.kind}
              onClick={() => switchKind(k.kind)}
              className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
                target.kind === k.kind ? 'border-accent bg-accent/15 text-fg' : 'border-line text-muted hover:border-accent/60'
              }`}
            >
              <k.icon className="size-3.5" />
              {k.label}
            </button>
          ))}
        </div>

        <p className="mb-3 text-xs text-muted">{kinds.find((k) => k.kind === target.kind)?.hint}</p>

        {target.kind === 'executable' && (
          <div className="space-y-3">
            <div className="flex min-w-0 gap-2">
              <label className="block min-w-0 flex-1">
                <span className={labelCls}>Program</span>
                <input
                  className={inputCls}
                  value={target.path}
                  onChange={(e) => setTarget({ ...target, path: e.target.value })}
                  spellCheck={false}
                />
              </label>
              {native && (
                <button
                  className={`${btnBrowse} mt-5 flex items-center gap-2`}
                  onClick={() =>
                    void pickFile('Choose the program', ['exe', 'bat', 'cmd'], target.path || undefined).then(
                      (p) => p && setTarget({ ...target, path: p }),
                    )
                  }
                >
                  <FolderOpen className="size-4" />
                  Browse…
                </button>
              )}
            </div>
            <label className="block">
              <span className={labelCls}>Arguments</span>
              <input className={inputCls} value={args} onChange={(e) => setArgs(e.target.value)} placeholder="-windowed" spellCheck={false} />
            </label>
          </div>
        )}

        {target.kind === 'wine' && (
          <div className="space-y-3">
            <div className="flex min-w-0 gap-2">
              <label className="block min-w-0 flex-1">
                <span className={labelCls}>Windows program</span>
                <input
                  className={inputCls}
                  value={target.path}
                  onChange={(e) => setTarget({ ...target, path: e.target.value })}
                  spellCheck={false}
                />
              </label>
              {native && (
                <button
                  className={`${btnBrowse} mt-5 flex items-center gap-2`}
                  onClick={() =>
                    void pickFile('Choose the .exe', ['exe', 'bat'], target.path || undefined).then(
                      (p) => p && setTarget({ ...target, path: p }),
                    )
                  }
                >
                  <FolderOpen className="size-4" />
                  Browse…
                </button>
              )}
            </div>
            <label className="block">
              <span className={labelCls}>Wine prefix</span>
              <input
                className={inputCls}
                value={target.prefix ?? ''}
                onChange={(e) => setTarget({ ...target, prefix: e.target.value || null })}
                placeholder="Leave empty for Wine's default prefix, or this game's own Proton bottle"
                spellCheck={false}
              />
            </label>
            <label className="block">
              <span className={labelCls}>Wine program for this game</span>
              <input
                className={inputCls}
                value={target.wine ?? ''}
                onChange={(e) => setTarget({ ...target, wine: e.target.value || null })}
                placeholder="Leave blank. Orbit finds Wine, or gets a copy if it is missing"
                spellCheck={false}
              />
            </label>
            <label className="block">
              <span className={labelCls}>Arguments</span>
              <input className={inputCls} value={args} onChange={(e) => setArgs(e.target.value)} spellCheck={false} />
            </label>
            <WineSettings
              proton={target.proton ?? null}
              tweaks={target.tweaks}
              onProton={(path) => setTarget({ ...target, proton: path })}
              onTweaks={(next) => setTarget({ ...target, tweaks: next })}
            />
          </div>
        )}

        {target.kind === 'lutris' && (
          <p className="rounded-lg border border-line bg-panel px-3 py-2 text-xs text-muted">
            Imported from Lutris{target.slug ? ` (${target.slug})` : ''}. Play asks Lutris to start it, and uses Wine
            directly when the install recorded a program and a prefix. Pick{' '}
            <button className="text-accent hover:underline" onClick={() => switchKind('wine')}>
              Wine
            </button>{' '}
            to choose those yourself.
          </p>
        )}

        {target.kind === 'steam' && (
          <p className="rounded-lg border border-line bg-panel px-3 py-2 text-xs text-muted">
            This game was imported from Steam, so Orbit starts it through Steam (app {target.appId}). Pick{' '}
            <button className="text-accent hover:underline" onClick={() => switchKind('executable')}>
              Program
            </button>{' '}
            to point at an .exe instead.
          </p>
        )}
      </div>

      {/* Started with the game, never watched. */}
      <div className="border-t border-line pt-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Start alongside</h3>
          <button
            onClick={() => setCompanions((list) => [...list, { path: '', args: '' }])}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-accent"
          >
            <Plus className="size-3.5" />
            Add a program
          </button>
        </div>
        <p className="mb-3 text-xs text-muted">
          For anything that has to be running with the game: a frame-rate tool, a controller mapper, a mod loader.
          Orbit starts these at the same moment and then forgets about them.
        </p>

        {companions.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line px-3 py-2 text-xs text-muted">
            Nothing yet, add here something to start together with {game.title}.
          </p>
        ) : (
          <div className="space-y-2">
            {companions.map((c, i) => (
              <div key={i} className="rounded-lg border border-line bg-panel p-2.5">
                <div className="flex min-w-0 gap-2">
                  <label className="block min-w-0 flex-1">
                    <span className={labelCls}>Program</span>
                    <input
                      className={inputCls}
                      value={c.path}
                      onChange={(e) => setCompanion(i, { path: e.target.value })}
                      placeholder={'C:\Tools\Lossless Scaling\LosslessScaling.exe'}
                      spellCheck={false}
                    />
                  </label>
                  {native && (
                    <button
                      className={`${btnBrowse} mt-5 flex items-center gap-2`}
                      onClick={() =>
                        void pickFile('Choose the program', ['exe', 'bat', 'cmd'], c.path || undefined).then(
                          (p) => p && setCompanion(i, { path: p }),
                        )
                      }
                    >
                      <FolderOpen className="size-4" />
                      Browse…
                    </button>
                  )}
                  <button
                    onClick={() => setCompanions((list) => list.filter((_, n) => n !== i))}
                    className="mt-5 rounded-lg border border-line px-2 text-muted hover:border-rose-400 hover:text-rose-400"
                    aria-label="Remove this program"
                    title="Remove"
                  >
                    <X className="size-4" />
                  </button>
                </div>
                <label className="mt-2 block">
                  <span className={labelCls}>Arguments</span>
                  <input
                    className={inputCls}
                    value={c.args}
                    onChange={(e) => setCompanion(i, { args: e.target.value })}
                    placeholder="Optional"
                    spellCheck={false}
                  />
                </label>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <span className="text-[11px] text-muted">{dirty ? 'Saving…' : 'Saved'}</span>
        <span className="truncate font-mono text-[11px] text-muted">{summarise(target, companions)}</span>
      </div>
    </section>
  );
}
