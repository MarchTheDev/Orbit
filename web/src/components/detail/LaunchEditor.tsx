import { useEffect, useMemo, useState } from 'react';
import { AppWindow, FolderOpen, Globe, Layers, Plus, Timer, Trash2, Wine } from 'lucide-react';
import type { Companion, Game, LaunchTarget } from '../../types';
import { isNative } from '../../services/native';
import { pickFile, pickFolder } from '../../services/desktop';
import { desktopOs } from '../../utils/platform';
import { inputCls } from '../ui/Modal';
import { say } from '../../utils/toast';
import { cn } from '../../utils/cn';
import {
  draftFromGame,
  isAlternative,
  launchProblems,
  normalizeDraft,
  type LaunchDraft,
} from '../../utils/launchProfiles';

/**
 * How Orbit starts a game, restyled as three plain questions.
 *
 * 1. **Default launch** — what Play does when nothing else is chosen.
 * 2. **Alternative launch** — named alternatives that replace the default for
 *    one play: a modded executable, different arguments, another working folder.
 * 3. **Starts with the game** — tools and pages that ride along every time and
 *    are never a way to start the game on their own.
 *
 * Nothing is written while a row is half typed. The editor either applies a
 * validated draft (standalone) or hands the draft to the game editor, which
 * saves it with the rest of the game's settings.
 */

const KINDS: { kind: LaunchTarget['kind']; label: string; hint: string; icon: typeof Timer }[] = [
  { kind: 'executable', label: 'Program', hint: 'Run an .exe, script or AppImage', icon: AppWindow },
  { kind: 'wine', label: 'Windows program', hint: 'Run through Wine or Proton', icon: Wine },
  { kind: 'none', label: 'Timer only', hint: 'Orbit tracks time; you start the game', icon: Timer },
];

function kindsForThisMachine() {
  const want = desktopOs() === 'linux' ? ['executable', 'wine', 'none'] : ['executable', 'none'];
  return KINDS.filter((kind) => want.includes(kind.kind));
}

const parentOf = (path: string): string | null => {
  const cut = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return cut > 0 ? path.slice(0, cut) : null;
};
const baseName = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;

export function LaunchEditor({
  game,
  onSave,
  section = 'all',
  draft,
  onDraftChange,
  embedded = false,
}: {
  game: Game;
  onSave?: (launch: LaunchTarget, companions: Companion[]) => void;
  /** Kept for older callers; saving is explicit now, never on a timer. */
  saveOnClose?: boolean;
  section?: 'all' | 'launch' | 'extra';
  /** Controlled draft, owned by the game editor. */
  draft?: LaunchDraft;
  onDraftChange?: (next: LaunchDraft) => void;
  /** When true the parent owns the Save button, so this page draws no footer. */
  embedded?: boolean;
}) {
  const [internal, setInternal] = useState<LaunchDraft>(() => draftFromGame(game));
  const [errors, setErrors] = useState<string[]>([]);
  const current = draft ?? internal;
  const native = isNative();

  useEffect(() => {
    if (!draft) setInternal(draftFromGame(game));
    // A different game is a different draft. Updates to the same game after a
    // save are reflected by the parent's controlled draft or by the new props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id]);

  const update = (next: LaunchDraft) => {
    setErrors([]);
    if (onDraftChange) onDraftChange(next);
    else setInternal(next);
  };

  const target = current.launch;
  const offered = kindsForThisMachine();
  const kinds = offered.some((kind) => kind.kind === target.kind)
    ? offered
    : [...offered, ...KINDS.filter((kind) => kind.kind === target.kind)];

  const switchKind = (kind: LaunchTarget['kind']) => {
    if (kind === 'none') {
      update({ ...current, launch: { kind: 'none' } });
      return;
    }
    if (kind === 'executable') {
      update({
        ...current,
        launch: { kind: 'executable', path: game.exePath ?? '', args: '', workingDir: game.installDir ?? parentOf(game.exePath ?? '') },
      });
      return;
    }
    if (kind === 'wine') {
      update({
        ...current,
        launch: { kind: 'wine', path: game.exePath ?? '', args: '', prefix: null, wine: null },
      });
    }
  };

  const setTarget = (next: LaunchTarget) => update({ ...current, launch: next });
  const setCompanion = (index: number, patch: Partial<Companion>) =>
    update({ ...current, companions: current.companions.map((c, n) => (n === index ? { ...c, ...patch } : c)) });
  const removeCompanion = (index: number) =>
    update({ ...current, companions: current.companions.filter((_, n) => n !== index) });

  const addProfile = () =>
    update({
      ...current,
      companions: [
        ...current.companions,
        { path: '', args: '', url: null, when: 'alternative', name: '', starts: [], extraArgs: '', workingDir: null },
      ],
    });
  const addAlongside = (web: boolean) =>
    update({ ...current, companions: [...current.companions, { path: '', args: '', url: web ? '' : null, when: 'alongside' }] });

  const apply = (): boolean => {
    const problems = launchProblems(current);
    if (problems.length > 0) {
      setErrors(problems.map((problem) => problem.message));
      return false;
    }
    const clean = normalizeDraft(current);
    onSave?.(clean.launch, clean.companions);
    if (!embedded) say('Launch settings saved');
    return true;
  };

  const dirty = useMemo(
    () => JSON.stringify(normalizeDraft(current)) !== JSON.stringify(normalizeDraft(draftFromGame(game))),
    [current, game],
  );

  const launchable = target.kind === 'executable' || target.kind === 'wine' ? target : null;
  const exeTarget = target.kind === 'executable' ? target : null;
  const wineTarget = target.kind === 'wine' ? target : null;
  /** Changing the program keeps an executable's working folder beside it. */
  const setPath = (path: string) => {
    if (target.kind === 'executable') setTarget({ ...target, path, workingDir: parentOf(path) ?? target.workingDir });
    else if (target.kind === 'wine') setTarget({ ...target, path });
  };
  const alternatives = current.companions.map((companion, index) => ({ companion, index })).filter(({ companion }) => isAlternative(companion));
  const alongside = current.companions.map((companion, index) => ({ companion, index })).filter(({ companion }) => !isAlternative(companion));
  const canOverrideProgram = target.kind === 'executable' || target.kind === 'wine' || target.kind === 'none';

  return (
    <div className="orbit-launchpage">
      {(section === 'all' || section === 'launch') && (
        <>
          <section className="orbit-launchpanel" aria-label="Default launch">
            <header className="orbit-launchpanel-head">
              <div>
                <p className="orbit-launchpanel-title">Default launch</p>
                <p className="orbit-launchnote is-quiet">What the Play button does when no launch option is chosen.</p>
              </div>
            </header>

            <div className="orbit-launchkinds" role="radiogroup" aria-label="How Orbit starts this game">
              {kinds.map((kind) => (
                <button
                  key={kind.kind}
                  type="button"
                  role="radio"
                  aria-checked={target.kind === kind.kind}
                  onClick={() => switchKind(kind.kind)}
                  className={cn('orbit-launchkind', target.kind === kind.kind && 'is-on')}
                >
                  <kind.icon className="size-4" />
                  <span>{kind.label}</span>
                </button>
              ))}
            </div>

            {target.kind === 'none' && (
              <p className="orbit-launchnote">Orbit starts nothing. Press Play to open a session, start the game yourself, and stop the session when you are done.</p>
            )}
            {(target.kind === 'steam' || target.kind === 'lutris') && (
              <p className="orbit-launchnote">This game is started by its launcher. Orbit hands it over and tracks the session; change the launcher’s own options for arguments or mods.</p>
            )}

            {launchable && (
              <div className="orbit-launchrows">
                <Field label={target.kind === 'wine' ? 'Windows program' : 'Program'}>
                  <input
                    className={inputCls}
                    value={launchable.path}
                    onChange={(event) => setPath(event.target.value)}
                    spellCheck={false}
                    placeholder="The .exe or script Orbit should start"
                  />
                  {native && (
                    <BrowseButton
                      label="Choose the program"
                      onClick={() => void pickFile('Choose the program or script', target.kind === 'wine' ? ['exe', 'bat'] : ['exe', 'bat', 'cmd', 'ps1', 'sh', 'AppImage'], launchable.path || undefined)
                        .then((path) => path && setPath(path))}
                    />
                  )}
                </Field>
                <Field label="Arguments">
                  <input className={inputCls} value={launchable.args} onChange={(event) => setTarget({ ...launchable, args: event.target.value })} placeholder="Optional, e.g. -windowed" spellCheck={false} />
                </Field>
                <details className="orbit-launch-advanced">
                  <summary>{target.kind === 'wine' ? 'Wine prefix and program' : 'Working folder'}</summary>
                  {exeTarget && (
                    <Field label="Starts in">
                      <input className={inputCls} value={exeTarget.workingDir ?? ''} onChange={(event) => setTarget({ ...exeTarget, workingDir: event.target.value || null })} placeholder="The program’s own folder" spellCheck={false} />
                      {native && <BrowseButton label="Choose the working folder" onClick={() => void pickFolder('Choose the working folder', exeTarget.workingDir || undefined).then((path) => path && setTarget({ ...exeTarget, workingDir: path }))} />}
                    </Field>
                  )}
                  {wineTarget && (
                    <>
                      <Field label="Wine prefix">
                        <input className={inputCls} value={wineTarget.prefix ?? ''} onChange={(event) => setTarget({ ...wineTarget, prefix: event.target.value || null })} placeholder="Wine’s default, or this game’s bottle" spellCheck={false} />
                      </Field>
                      <Field label="Wine program">
                        <input className={inputCls} value={wineTarget.wine ?? ''} onChange={(event) => setTarget({ ...wineTarget, wine: event.target.value || null })} placeholder="Orbit finds Wine, or uses Settings" spellCheck={false} />
                      </Field>
                    </>
                  )}
                </details>
              </div>
            )}
          </section>

          <section className="orbit-launchpanel" aria-label="Alternative launch">
            <header className="orbit-launchpanel-head">
              <div>
                <p className="orbit-launchpanel-title">Alternative launch {alternatives.length > 0 && <span className="orbit-launchbadge">{alternatives.length}</span>}</p>
                <p className="orbit-launchnote is-quiet">Another way to start the same game, picked from the arrow beside Play. Choosing one replaces the default launch for that play.</p>
              </div>
              <button type="button" onClick={addProfile} className="orbit-launchaddbtn"><Plus className="size-3.5" /> Add</button>
            </header>

            {alternatives.length === 0 ? (
              <p className="orbit-launchempty">No alternatives yet. Add one for a modded build, a different save folder, or a separate set of arguments.</p>
            ) : (
              <div className="orbit-launchlist">
                {alternatives.map(({ companion, index }) => (
                  <article key={`profile-${index}`} className="orbit-launchentry is-profile">
                    <div className="orbit-launchentry-head">
                      <span className="orbit-launchentry-icon" aria-hidden><Layers className="size-3.5" /></span>
                      <label className="orbit-launchentry-name">
                        <span className="sr-only">Name shown in the Play arrow</span>
                        <input
                          className="orbit-launchentry-nameinput"
                          value={companion.name ?? ''}
                          onChange={(event) => setCompanion(index, { name: event.target.value })}
                          placeholder="Name it, e.g. Modded"
                          spellCheck={false}
                        />
                      </label>
                      <button type="button" onClick={() => removeCompanion(index)} className="orbit-launchentry-remove" aria-label={`Remove ${companion.name || 'this launch option'}`}><Trash2 className="size-3.5" /></button>
                    </div>

                    {canOverrideProgram && (
                      <Field label="Program">
                        <input className={inputCls} value={companion.path} onChange={(event) => setCompanion(index, { path: event.target.value })} placeholder="Same as the default launch" spellCheck={false} />
                        {native && <BrowseButton label="Choose this option’s program" onClick={() => void pickFile('Choose the program for this launch option', ['exe', 'bat', 'sh', 'AppImage'], companion.path || undefined).then((path) => path && setCompanion(index, { path }))} />}
                      </Field>
                    )}
                    <Field label="Extra arguments">
                      <input className={inputCls} value={companion.extraArgs ?? ''} onChange={(event) => setCompanion(index, { extraArgs: event.target.value })} placeholder="Added to the game’s own arguments" spellCheck={false} />
                    </Field>
                    <Field label="Starts in">
                      <input className={inputCls} value={companion.workingDir ?? ''} onChange={(event) => setCompanion(index, { workingDir: event.target.value || null })} placeholder="The game’s own folder" spellCheck={false} />
                      {native && <BrowseButton label="Choose this option’s working folder" onClick={() => void pickFolder('Choose the working folder for this launch option', companion.workingDir || undefined).then((path) => path && setCompanion(index, { workingDir: path }))} />}
                    </Field>

                    <div className="orbit-launchrow is-stacked">
                      <span className="orbit-launchrow-label">Start first</span>
                      <div className="orbit-launchrow-control is-column">
                        {(companion.starts ?? []).map((entry, n) => (
                          <span key={n} className="orbit-launchrow-control">
                            <input className={inputCls} value={entry} onChange={(event) => setCompanion(index, { starts: (companion.starts ?? []).map((value, at) => (at === n ? event.target.value : value)) })} placeholder="A program, or an https:// page" spellCheck={false} />
                            <button type="button" className="orbit-launchbrowse" aria-label="Remove this entry" onClick={() => setCompanion(index, { starts: (companion.starts ?? []).filter((_, at) => at !== n) })}><Trash2 className="size-3.5" /></button>
                          </span>
                        ))}
                        <span className="orbit-launchadds">
                          <button type="button" className="orbit-launchaddbtn is-quiet" onClick={() => setCompanion(index, { starts: [...(companion.starts ?? []), ''] })}><Plus className="size-3.5" /> Program or page</button>
                          {native && <BrowseButton label="Browse for a program to start first" onClick={() => void pickFile('Choose a program to start first', ['exe', 'bat', 'sh', 'AppImage'], undefined).then((path) => path && setCompanion(index, { starts: [...(companion.starts ?? []), path] }))} />}
                        </span>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {(section === 'all' || section === 'launch' || section === 'extra') && (
        <section className="orbit-launchpanel" aria-label="Starts with the game">
          <header className="orbit-launchpanel-head">
            <div>
              <p className="orbit-launchpanel-title">Starts with the game {alongside.length > 0 && <span className="orbit-launchbadge">{alongside.length}</span>}</p>
              <p className="orbit-launchnote is-quiet">Tools and pages that open with every launch. They never start the game on their own.</p>
            </div>
            <span className="orbit-launchadds">
              <button type="button" onClick={() => addAlongside(false)} className="orbit-launchaddbtn"><Plus className="size-3.5" /> Program</button>
              <button type="button" onClick={() => addAlongside(true)} className="orbit-launchaddbtn is-quiet"><Globe className="size-3.5" /> Web page</button>
            </span>
          </header>

          {alongside.length === 0 ? (
            <p className="orbit-launchempty">Nothing rides along yet. Add a frame-rate tool, a mod manager, or a wiki page.</p>
          ) : (
            <div className="orbit-launchlist">
              {alongside.map(({ companion, index }) => {
                const web = companion.url !== undefined && companion.url !== null;
                return (
                  <article key={`along-${index}`} className="orbit-launchentry">
                    <div className="orbit-launchentry-head">
                      <span className="orbit-launchentry-icon" aria-hidden>{web ? <Globe className="size-3.5" /> : <AppWindow className="size-3.5" />}</span>
                      <h4>{web ? 'Web page' : baseName(companion.path) || 'Program'}</h4>
                      <button type="button" onClick={() => removeCompanion(index)} className="orbit-launchentry-remove" aria-label={`Remove ${companion.url || companion.path || 'this companion'}`}><Trash2 className="size-3.5" /></button>
                    </div>
                    {web ? (
                      <Field label="Address">
                        <input className={inputCls} type="url" value={companion.url ?? ''} onChange={(event) => setCompanion(index, { url: event.target.value })} placeholder="https://example.com/this-game" spellCheck={false} />
                      </Field>
                    ) : (
                      <>
                        <Field label="Program">
                          <input className={inputCls} value={companion.path} onChange={(event) => setCompanion(index, { path: event.target.value })} placeholder={desktopOs() === 'linux' ? '/home/you/Tools/tool.AppImage' : 'C:\\Tools\\cap\\cap.exe'} spellCheck={false} />
                          {native && <BrowseButton label="Choose a companion program" onClick={() => void pickFile('Choose a program or script', desktopOs() === 'linux' ? ['sh', 'exe', 'AppImage'] : ['exe', 'bat', 'cmd', 'ps1'], companion.path || undefined).then((path) => path && setCompanion(index, { path }))} />}
                        </Field>
                        <Field label="Arguments">
                          <input className={inputCls} value={companion.args} onChange={(event) => setCompanion(index, { args: event.target.value })} placeholder="Optional" spellCheck={false} />
                        </Field>
                      </>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {!embedded && (
        <footer className="orbit-launchfooter">
          <button type="button" className="orbit-btn is-accent" disabled={!dirty} onClick={() => apply()}>Apply launch settings</button>
          <button type="button" className="orbit-btn is-quiet" disabled={!dirty} onClick={() => { setInternal(draftFromGame(game)); setErrors([]); }}>Reset</button>
          {errors.length > 0 && <div className="orbit-launcherrors" role="alert">{errors.map((error) => <p key={error}>{error}</p>)}</div>}
        </footer>
      )}
      {embedded && errors.length > 0 && <div className="orbit-launcherrors" role="alert">{errors.map((error) => <p key={error}>{error}</p>)}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="orbit-launchrow">
      <span className="orbit-launchrow-label">{label}</span>
      <span className="orbit-launchrow-control">{children}</span>
    </div>
  );
}

function BrowseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="orbit-launchbrowse" aria-label={label} title={label} onClick={onClick}>
      <FolderOpen className="size-4" />
    </button>
  );
}
