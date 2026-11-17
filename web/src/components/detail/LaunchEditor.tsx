import { useEffect, useRef, useState } from 'react';
import { AppWindow, FolderOpen, Layers, Plus, Timer, Wine, X } from 'lucide-react';
import type { Companion, Game, LaunchTarget } from '../../types';
import { isNative } from '../../services/native';
import { pickFile, pickFolder } from '../../services/desktop';
import { desktopOs } from '../../utils/platform';
import { btnBrowse, btnGhost, inputCls, labelCls } from '../ui/Modal';
import { say } from '../../utils/toast';
import { cn } from '../../utils/cn';

// Emulator and Steam used to be choices here. Both are gone: an emulator is just
// a program with a ROM as an argument, and Steam is not something the player
// should have to type an app id for, games imported from a Steam library carry
// that with them.
const KINDS: { kind: LaunchTarget['kind']; label: string; hint: string; icon: typeof Timer }[] = [
  { kind: 'executable', label: 'A program', hint: 'Orbit starts this program.', icon: AppWindow },
  {
    kind: 'wine',
    label: 'A Windows program',
    hint: 'An .exe, run through Wine or a Proton build.',
    icon: Wine,
  },
  { kind: 'none', label: 'Nothing, just time it', hint: 'You start the game; Orbit keeps the clock.', icon: Timer },
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

const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

const isProfile = (companion: Companion) => companion.when === 'alternative';

/**
 * How Orbit starts this game, and every other way it can be started.
 *
 * There are two kinds of "and something else", and they are not the same thing,
 * so they are not in the same list:
 *
 * - **Starting alongside.** A tool that has to be running with the game -
 *   Lossless Scaling, a frame-rate cap, a mod manager, a wiki in the browser.
 *   It comes with every launch and is never a way to play on its own.
 * - **As an alternative launch.** The same game started differently: another
 *   save folder, other arguments, a mod loader in front of it. It is named, and
 *   it is picked from the arrow beside Play instead of the plain one.
 *
 * Both are one entry in the same saved list, told apart by `when`, because they
 * are the same shape underneath - a program, its arguments and whether it rides
 * along. Keeping them apart in the page is the whole point: a player who wants
 * "also start my mod manager" should never be asked to name a launch profile.
 */
export function LaunchEditor({
  game,
  onSave,
  saveOnClose = false,
  section = 'all',
}: {
  game: Game;
  onSave: (launch: LaunchTarget, companions: Companion[]) => void;
  /** The edit dialog keeps launch changes when it closes, so it has no button. */
  saveOnClose?: boolean;
  section?: 'all' | 'launch' | 'tools';
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
   * applied, so "Nothing, just time it" followed by Play still started the game,
   * because nothing had been written down. A choice from this row is a decision,
   * and it is kept the moment it is made.
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
      if (picked.path.trim()) {
        onSave(
          { kind: 'executable', path: picked.path, args, workingDir: parentOf(picked.path) },
          companions,
        );
        say(`${game.title} starts ${baseName(picked.path)}`);
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
  const removeCompanion = (i: number) => setCompanions((list) => list.filter((_, n) => n !== i));

  /** An entry that rides with the game: a program, a script, or a web page. */
  const addAlongside = (web: boolean) =>
    setCompanions((list) => [...list, { path: '', args: '', url: web ? '' : null, when: 'alongside' }]);

  /**
   * Another way to start the same game.
   *
   * It starts life with a name and nothing else, which is already useful - "no
   * intro videos" is only arguments - and everything else is optional.
   */
  const addProfile = () =>
    setCompanions((list) => [
      ...list,
      { path: '', args: '', url: null, when: 'alternative', name: '', starts: [], extraArgs: '', workingDir: null },
    ]);

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

  const alongside = companions.map((companion, index) => ({ companion, index })).filter(({ companion }) => !isProfile(companion));
  const profiles = companions.map((companion, index) => ({ companion, index })).filter(({ companion }) => isProfile(companion));

  return (
    <div className="orbit-launchpage">
      {section !== 'tools' && (
        <>
          <section className="orbit-launchcard">
            <header className="orbit-launchcard-head">
              <h3>When you press Play</h3>
              <p>
                {target.kind === 'none'
                  ? 'Orbit keeps the time and starts nothing. You launch the game yourself.'
                  : `Orbit starts the ${target.kind === 'wine' ? 'Windows program' : 'program'} below, and the clock starts with it.`}
              </p>
            </header>

            <div className="orbit-launchkinds" role="radiogroup" aria-label="How Orbit starts this game">
              {kinds.map((k) => (
                <button
                  key={k.kind}
                  type="button"
                  role="radio"
                  aria-checked={target.kind === k.kind}
                  onClick={() => switchKind(k.kind)}
                  className={cn('orbit-launchkind', target.kind === k.kind && 'is-on')}
                  title={k.hint}
                >
                  <k.icon className="size-4" />
                  <span>{k.label}</span>
                </button>
              ))}
            </div>

            {(target.kind === 'executable' || target.kind === 'wine') && (
              <div className="orbit-launchfields">
                <label className="orbit-launchfield is-wide">
                  <span className={labelCls}>{target.kind === 'wine' ? 'Windows program' : 'Program'}</span>
                  <span className="orbit-launchfield-row">
                    <input
                      className={inputCls}
                      value={target.path}
                      onChange={(e) => setTarget({ ...target, path: e.target.value })}
                      spellCheck={false}
                      placeholder="The .exe or script Orbit should start"
                    />
                    {native && (
                      <button
                        type="button"
                        className={btnBrowse}
                        onClick={() =>
                          void pickFile(
                            'Choose the program or script',
                            target.kind === 'wine' ? ['exe', 'bat'] : ['exe', 'bat', 'cmd', 'ps1', 'sh', 'AppImage'],
                            target.path || undefined,
                          ).then((p) => p && setTarget({ ...target, path: p }))
                        }
                      >
                        <FolderOpen className="size-4" />
                        Browse
                      </button>
                    )}
                  </span>
                </label>

                <label className="orbit-launchfield is-wide">
                  <span className={labelCls}>Arguments</span>
                  <input
                    className={inputCls}
                    value={args}
                    onChange={(e) => setArgs(e.target.value)}
                    placeholder="Leave empty for none, such as -windowed"
                    spellCheck={false}
                  />
                </label>

                {target.kind === 'wine' && (
                  <>
                    <label className="orbit-launchfield is-wide">
                      <span className={labelCls}>Wine prefix</span>
                      <input
                        className={inputCls}
                        value={target.prefix ?? ''}
                        onChange={(e) => setTarget({ ...target, prefix: e.target.value || null })}
                        placeholder="Leave empty for Wine's own, or this game's Proton bottle"
                        spellCheck={false}
                      />
                    </label>
                    <label className="orbit-launchfield is-wide">
                      <span className={labelCls}>Wine program for this game</span>
                      <input
                        className={inputCls}
                        value={target.wine ?? ''}
                        onChange={(e) => setTarget({ ...target, wine: e.target.value || null })}
                        placeholder="Leave empty. Orbit finds Wine, or gets a copy if it is missing"
                        spellCheck={false}
                      />
                    </label>
                  </>
                )}
              </div>
            )}

            {target.kind === 'lutris' && (
              <p className="orbit-launchnote">
                Came in from Lutris{target.slug ? ` (${target.slug})` : ''}. Play asks Lutris to start it, and uses Wine
                directly when the install recorded a program and a prefix. Pick{' '}
                <button type="button" className="text-accent hover:underline" onClick={() => switchKind('wine')}>
                  a Windows program
                </button>{' '}
                to choose those yourself.
              </p>
            )}

            {target.kind === 'steam' && (
              <p className="orbit-launchnote">
                This came in from Steam, so Play hands it back to Steam (app {target.appId}). Pick{' '}
                <button type="button" className="text-accent hover:underline" onClick={() => switchKind('executable')}>
                  a program
                </button>{' '}
                to point Orbit at an .exe instead.
              </p>
            )}
          </section>

          {/* --------------------------------------------------- alongside */}
          <section className="orbit-launchcard">
            <header className="orbit-launchcard-head">
              <div className="orbit-launchcard-title">
                <h3>Start alongside</h3>
                <span className="orbit-launchcount">{alongside.length}</span>
              </div>
              <p>
                Things that need to be running with the game: a mod manager, a frame-rate tool, a script, or a page you
                keep open. They start every time, and closing one never ends the session.
              </p>
              <div className="orbit-launchadd">
                <button type="button" onClick={() => addAlongside(false)} className="orbit-launchaddbtn">
                  <Plus className="size-3.5" /> Program or script
                </button>
                <button type="button" onClick={() => addAlongside(true)} className="orbit-launchaddbtn">
                  <Plus className="size-3.5" /> Web page
                </button>
              </div>
            </header>

            {alongside.length === 0 ? (
              <p className="orbit-launchempty">
                Nothing yet. Add a tool here if {game.title} needs something else running beside it.
              </p>
            ) : (
              <div className="orbit-launchlist">
                {alongside.map(({ companion: c, index: i }) => (
                  <article key={`along-${i}`} className="orbit-launchentry">
                    <div className="orbit-launchentry-head">
                      <span className="orbit-launchentry-icon" aria-hidden>
                        {c.url !== undefined && c.url !== null ? (
                          <Layers className="size-3.5" />
                        ) : (
                          <AppWindow className="size-3.5" />
                        )}
                      </span>
                      <h4>{c.url !== undefined && c.url !== null ? 'Web page' : baseName(c.path) || 'Program'}</h4>
                      <button
                        type="button"
                        onClick={() => removeCompanion(i)}
                        className="orbit-launchentry-remove"
                        aria-label={`Remove ${c.url || c.path || 'this entry'}`}
                        title="Remove"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>
                    {c.url !== undefined && c.url !== null ? (
                      <label className="orbit-launchfield">
                        <span className={labelCls}>Web address</span>
                        <input
                          className={inputCls}
                          type="url"
                          value={c.url ?? ''}
                          onChange={(event) => setCompanion(i, { url: event.target.value })}
                          placeholder="https://example.com/this-game"
                          spellCheck={false}
                        />
                      </label>
                    ) : (
                      <>
                        <label className="orbit-launchfield is-wide">
                          <span className={labelCls}>Program or script</span>
                          <span className="orbit-launchfield-row">
                            <input
                              className={inputCls}
                              value={c.path}
                              onChange={(event) => setCompanion(i, { path: event.target.value })}
                              placeholder={desktopOs() === 'linux' ? '/home/you/Tools/tool.AppImage' : 'C:\\Tools\\LosslessScaling\\LosslessScaling.exe'}
                              spellCheck={false}
                            />
                            {native && (
                              <button
                                type="button"
                                className={btnBrowse}
                                onClick={() =>
                                  void pickFile(
                                    'Choose a program or script',
                                    desktopOs() === 'linux' ? ['sh', 'exe', 'AppImage'] : ['exe', 'bat', 'cmd', 'ps1'],
                                    c.path || undefined,
                                  ).then((path) => path && setCompanion(i, { path }))
                                }
                              >
                                <FolderOpen className="size-4" />
                                Browse
                              </button>
                            )}
                          </span>
                        </label>
                        <label className="orbit-launchfield is-wide">
                          <span className={labelCls}>Arguments</span>
                          <input
                            className={inputCls}
                            value={c.args}
                            onChange={(event) => setCompanion(i, { args: event.target.value })}
                            placeholder="Optional"
                            spellCheck={false}
                          />
                        </label>
                      </>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* ----------------------------------------------- alternative */}
          <section className="orbit-launchcard">
            <header className="orbit-launchcard-head">
              <div className="orbit-launchcard-title">
                <h3>Another way to launch it</h3>
                <span className="orbit-launchcount">{profiles.length}</span>
              </div>
              <p>
                The same game started differently: another save folder, other arguments, a mod loader in front. Each one
                gets a name and appears in the arrow beside Play, so nothing about it has to be remembered later.
              </p>
              <div className="orbit-launchadd">
                <button type="button" onClick={addProfile} className="orbit-launchaddbtn">
                  <Plus className="size-3.5" /> Add a launch
                </button>
              </div>
            </header>

            {profiles.length === 0 ? (
              <p className="orbit-launchempty">
                No other launches. One is worth adding if you sometimes start {game.title} with a different setup — a
                second install, a mod manager, or a set of arguments for testing.
              </p>
            ) : (
              <div className="orbit-launchlist">
                {profiles.map(({ companion: c, index: i }) => (
                  <article key={`profile-${i}`} className="orbit-launchentry is-profile">
                    <div className="orbit-launchentry-head">
                      <span className="orbit-launchentry-icon" aria-hidden>
                        <Layers className="size-3.5" />
                      </span>
                      <label className="orbit-launchentry-name">
                        <span className="sr-only">Name shown in the Play arrow</span>
                        <input
                          className="orbit-launchentry-nameinput"
                          value={c.name ?? ''}
                          onChange={(event) => setCompanion(i, { name: event.target.value })}
                          placeholder="Name it, such as Modded"
                          spellCheck={false}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={() => removeCompanion(i)}
                        className="orbit-launchentry-remove"
                        aria-label={`Remove the ${c.name || 'unnamed'} launch`}
                        title="Remove"
                      >
                        <X className="size-3.5" />
                      </button>
                    </div>

                    <label className="orbit-launchfield is-wide">
                      <span className={labelCls}>Extra arguments, added to the game's own</span>
                      <input
                        className={inputCls}
                        value={c.extraArgs ?? ''}
                        onChange={(event) => setCompanion(i, { extraArgs: event.target.value })}
                        placeholder="Leave empty to start with the same arguments"
                        spellCheck={false}
                      />
                    </label>

                    <label className="orbit-launchfield is-wide">
                      <span className={labelCls}>Start in a different folder</span>
                      <span className="orbit-launchfield-row">
                        <input
                          className={inputCls}
                          value={c.workingDir ?? ''}
                          onChange={(event) => setCompanion(i, { workingDir: event.target.value || null })}
                          placeholder="Leave empty for the game's own folder"
                          spellCheck={false}
                        />
                        {native && (
                          <button
                            type="button"
                            className={btnBrowse}
                            onClick={() =>
                              void pickFolder('Choose the folder this launch starts in', c.workingDir || undefined).then(
                                (path) => path && setCompanion(i, { workingDir: path }),
                              )
                            }
                          >
                            <FolderOpen className="size-4" />
                            Browse
                          </button>
                        )}
                      </span>
                    </label>

                    <div className="orbit-launchfield is-wide">
                      <span className={labelCls}>Also start these, before the game</span>
                      {(c.starts ?? []).map((entry, n) => (
                        <span key={n} className="orbit-launchfield-row">
                          <input
                            className={inputCls}
                            value={entry}
                            onChange={(event) =>
                              setCompanion(i, {
                                starts: (c.starts ?? []).map((value, at) => (at === n ? event.target.value : value)),
                              })
                            }
                            placeholder="A program, or a https:// page"
                            spellCheck={false}
                          />
                          <button
                            type="button"
                            className={`${btnGhost} shrink-0`}
                            aria-label="Remove this program from the launch"
                            onClick={() =>
                              setCompanion(i, { starts: (c.starts ?? []).filter((_, at) => at !== n) })
                            }
                          >
                            <X className="size-3.5" />
                          </button>
                        </span>
                      ))}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="orbit-launchaddbtn"
                          onClick={() => setCompanion(i, { starts: [...(c.starts ?? []), ''] })}
                        >
                          <Plus className="size-3.5" /> Add a program
                        </button>
                        {native && (
                          <button
                            type="button"
                            className="orbit-launchaddbtn"
                            onClick={() =>
                              void pickFile('Choose a program to start with this launch', ['exe', 'bat', 'sh', 'AppImage'], undefined).then(
                                (path) => path && setCompanion(i, { starts: [...(c.starts ?? []), path] }),
                              )
                            }
                          >
                            <FolderOpen className="size-3.5" /> Browse
                          </button>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>

          <div className="orbit-launchfooter">
            <span className="text-[11px] text-muted">{dirty ? 'Saving…' : 'Saved'}</span>
          </div>
        </>
      )}

      {section === 'tools' && (
        <p className="orbit-launchempty">
          Tools that start with the game are on the Launch page, under “Start alongside”.
        </p>
      )}
    </div>
  );
}
