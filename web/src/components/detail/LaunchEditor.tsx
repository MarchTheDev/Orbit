import { useState } from 'react';
import type { Game, LaunchTarget } from '../../types';
import { isNative } from '../../services/native';
import { pickAnyFile, pickFile, pickFolder } from '../../services/desktop';
import { btnBrowse, btnGhost, inputCls, labelCls } from '../ui/Modal';

const KINDS: { kind: LaunchTarget['kind']; label: string; hint: string }[] = [
  { kind: 'none', label: 'Timer only', hint: 'Orbit keeps the clock but does not start anything.' },
  { kind: 'executable', label: 'Program', hint: 'The game is a .exe on this machine.' },
  { kind: 'steam', label: 'Steam', hint: 'Ask Steam to run an app you own.' },
  { kind: 'emulator', label: 'Emulator', hint: 'Run a ROM through an emulator.' },
];

/** The one path each kind needs, so it can be summarised in one line. */
function summarise(t: LaunchTarget): string {
  switch (t.kind) {
    case 'executable':
      return t.path;
    case 'steam':
      return `Steam app ${t.appId}`;
    case 'emulator':
      return `${t.emulatorPath} · ${t.romPath}`;
    default:
      return 'Timer only, nothing is launched';
  }
}

/**
 * How Orbit starts this game, and what it runs when the clock starts.
 *
 * This is where emulator and Steam games get fixed up, which is why it is on the
 * game itself rather than buried in settings.
 */
export function LaunchEditor({ game, onSave }: { game: Game; onSave: (t: LaunchTarget) => void }) {
  const [target, setTarget] = useState<LaunchTarget>(game.launch ?? { kind: 'none' });
  const [args, setArgs] = useState(target.kind === 'executable' ? (target.args ?? '') : '');
  const [workingDir, setWorkingDir] = useState(target.kind === 'executable' ? (target.workingDir ?? '') : '');
  const [romPath, setRomPath] = useState(target.kind === 'emulator' ? target.romPath : '');
  const [argsTemplate, setArgsTemplate] = useState(target.kind === 'emulator' ? (target.argsTemplate ?? '{rom}') : '{rom}');
  const native = isNative();

  const switchKind = (kind: LaunchTarget['kind']) => {
    if (kind === 'none') setTarget({ kind: 'none' });
    else if (kind === 'executable') setTarget({ kind: 'executable', path: game.exePath ?? '', args: '', workingDir: game.installDir });
    else if (kind === 'steam') setTarget({ kind: 'steam', appId: 0 });
    else setTarget({ kind: 'emulator', emulatorPath: '', romPath: '', argsTemplate: '{rom}' });
  };

  const save = () => {
    if (target.kind === 'executable') {
      onSave({ kind: 'executable', path: target.path, args, workingDir: workingDir || null });
    } else if (target.kind === 'steam') {
      onSave({ kind: 'steam', appId: Number(target.appId) || 0 });
    } else if (target.kind === 'emulator') {
      onSave({ kind: 'emulator', emulatorPath: target.emulatorPath, romPath, argsTemplate });
    } else {
      onSave({ kind: 'none' });
    }
  };

  const dirty =
    JSON.stringify(target) !== JSON.stringify(game.launch ?? { kind: 'none' }) ||
    (target.kind === 'executable' && (args !== (game.launch?.kind === 'executable' ? game.launch.args ?? '' : '') ||
      workingDir !== (game.launch?.kind === 'executable' ? game.launch.workingDir ?? '' : ''))) ||
    (target.kind === 'emulator' && (romPath !== (game.launch?.kind === 'emulator' ? game.launch.romPath : '') ||
      argsTemplate !== (game.launch?.kind === 'emulator' ? game.launch.argsTemplate ?? '{rom}' : '{rom}')));

  return (
    <section className="rounded-xl border border-line bg-panel2 p-4">
      <h3 className="mb-2 text-sm font-semibold">Launching</h3>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {KINDS.map((k) => (
          <button
            key={k.kind}
            onClick={() => switchKind(k.kind)}
            className={`rounded-full border px-3 py-1 text-xs ${
              target.kind === k.kind ? 'border-accent bg-accent/15 text-fg' : 'border-line text-muted hover:border-accent/60'
            }`}
          >
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
                className={`${btnBrowse} mt-5`}
                onClick={() => void pickFile('Choose the program', ['exe', 'bat', 'cmd'], target.path || undefined).then((p) => p && setTarget({ ...target, path: p }))}
              >
                Browse…
              </button>
            )}
          </div>
          <label className="block">
            <span className={labelCls}>Arguments</span>
            <input className={inputCls} value={args} onChange={(e) => setArgs(e.target.value)} placeholder="-windowed" spellCheck={false} />
          </label>
          <div className="flex gap-2">
            <label className="block flex-1">
              <span className={labelCls}>Start in</span>
              <input className={inputCls} value={workingDir} onChange={(e) => setWorkingDir(e.target.value)} placeholder="Leave empty for the program's own folder" spellCheck={false} />
            </label>
            {native && (
              <button
                className={`${btnBrowse} mt-5`}
                onClick={() => void pickFolder('Choose the working folder', workingDir || undefined).then((p) => p && setWorkingDir(p))}
              >
                Browse…
              </button>
            )}
          </div>
        </div>
      )}

      {target.kind === 'steam' && (
        <label className="block">
          <span className={labelCls}>Steam app id</span>
          <input
            className={inputCls}
            inputMode="numeric"
            value={String(target.appId || '')}
            onChange={(e) => setTarget({ kind: 'steam', appId: Number(e.target.value.replace(/\D/g, '')) || 0 })}
            placeholder="620"
          />
        </label>
      )}

      {target.kind === 'emulator' && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <label className="block flex-1">
              <span className={labelCls}>Emulator</span>
              <input className={inputCls} value={target.emulatorPath} onChange={(e) => setTarget({ ...target, emulatorPath: e.target.value })} spellCheck={false} />
            </label>
            {native && (
              <button
                className={`${btnBrowse} mt-5`}
                onClick={() => void pickFile('Choose the emulator', ['exe', 'bat', 'cmd']).then((p) => p && setTarget({ ...target, emulatorPath: p }))}
              >
                Browse…
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <label className="block flex-1">
              <span className={labelCls}>ROM or ISO</span>
              <input className={inputCls} value={romPath} onChange={(e) => setRomPath(e.target.value)} spellCheck={false} />
            </label>
            {native && (
              <button
                className={`${btnBrowse} mt-5`}
                onClick={() => void pickAnyFile('Choose the ROM', target.emulatorPath || undefined).then((p) => p && setRomPath(p))}
              >
                Browse…
              </button>
            )}
          </div>
          <label className="block">
            <span className={labelCls}>Arguments</span>
            <input className={inputCls} value={argsTemplate} onChange={(e) => setArgsTemplate(e.target.value)} spellCheck={false} />
            <p className="mt-1 text-[11px] text-muted">
              <code>{'{rom}'}</code> is replaced with the ROM path. Put the flags your emulator needs around it.
            </p>
          </label>
        </div>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button className={`${btnGhost} !py-1.5`} onClick={save} disabled={!dirty}>
          Save launch settings
        </button>
        <span className="truncate font-mono text-[11px] text-muted">{summarise(target)}</span>
      </div>
    </section>
  );
}