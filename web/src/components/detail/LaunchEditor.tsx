import { useState } from 'react';
import { AppWindow, FolderOpen, Plus, Timer, X } from 'lucide-react';
import type { Companion, Game, LaunchTarget } from '../../types';
import { isNative } from '../../services/native';
import { pickFile } from '../../services/desktop';
import { btnBrowse, inputCls, labelCls } from '../ui/Modal';
import { SaveButton } from '../ui/SaveButton';
import { say } from '../../utils/toast';

// Emulator and Steam used to be choices here. Both are gone: an emulator is just
// a program with a ROM as an argument, and Steam is not something the player
// should have to type an app id for, games imported from a Steam library carry
// that with them.
const KINDS: { kind: LaunchTarget['kind']; label: string; hint: string; icon: typeof Timer }[] = [
  { kind: 'executable', label: 'Program', hint: 'The game is a .exe on this machine.', icon: AppWindow },
  { kind: 'none', label: 'Timer only', hint: 'Orbit keeps the clock but does not start anything.', icon: Timer },
];

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
    case 'steam':
      return `Steam app ${t.appId}${extra}`;
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
}: {
  game: Game;
  onSave: (t: LaunchTarget, companions: Companion[]) => void;
}) {
  const [target, setTarget] = useState<LaunchTarget>(game.launch ?? { kind: 'none' });
  const [args, setArgs] = useState(target.kind === 'executable' ? (target.args ?? '') : '');
  const [companions, setCompanions] = useState<Companion[]>(game.companions ?? []);
  const native = isNative();

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
    }
  };

  const save = () => {
    if (target.kind === 'executable') {
      if (!target.path.trim()) return;
      onSave({ kind: 'executable', path: target.path, args, workingDir: parentOf(target.path) }, companions);
    } else if (target.kind === 'steam') {
      onSave({ kind: 'steam', appId: Number(target.appId) || 0 }, companions);
    } else {
      onSave({ kind: 'none' }, companions);
    }
    say('Launch settings saved');
  };

  const setCompanion = (i: number, patch: Partial<Companion>) => {
    setCompanions((list) => list.map((c, n) => (n === i ? { ...c, ...patch } : c)));
  };

  const dirty =
    JSON.stringify(target) !== JSON.stringify(game.launch ?? { kind: 'none' }) ||
    JSON.stringify(companions) !== JSON.stringify(game.companions ?? []) ||
    (target.kind === 'executable' && args !== (game.launch?.kind === 'executable' ? game.launch.args ?? '' : ''));

  return (
    <section className="space-y-4 rounded-xl border border-line bg-panel2 p-4">
      <div>
        <h3 className="mb-2 text-sm font-semibold">Launching</h3>

        <div className="mb-3 flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
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

        <p className="mb-3 text-xs text-muted">{KINDS.find((k) => k.kind === target.kind)?.hint}</p>

        {target.kind === 'executable' && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <label className="block flex-1">
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
                <div className="flex gap-2">
                  <label className="block flex-1">
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
        <SaveButton
          onSave={save}
          label="Save launch settings"
          savedLabel="Launch settings saved"
          className="!px-3 !py-1.5 !text-xs"
        />
        {!dirty && <span className="text-[11px] text-muted">Nothing to change</span>}
        <span className="truncate font-mono text-[11px] text-muted">{summarise(target, companions)}</span>
      </div>
    </section>
  );
}
