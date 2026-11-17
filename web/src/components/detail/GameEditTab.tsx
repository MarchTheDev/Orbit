import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Image, RotateCcw, Sparkles } from 'lucide-react';
import type { Game, GameStatus, HltbData, MetaData } from '../../types';
import { findArtwork, findBackdropArtwork, findSave, getReshadeState, isNative, revealInExplorer, saveHintsOf, setReshade, suggestSaves, useReshadeFile, type ReshadeState } from '../../services/native';
import { say } from '../../utils/toast';
import { fileSrc, pickAnyFile, pickFile, pickFolder } from '../../services/desktop';
import { fetchHltb } from '../../services/hltb';
import { fmtBytes } from '../../utils/format';
import { cn } from '../../utils/cn';
import { LaunchEditor } from './LaunchEditor';
import { Select } from '../ui/Select';
import { btnBrowse, btnGhost, inputCls, labelCls } from '../ui/Modal';
import { PortraitBrowser } from '../ui/PortraitBrowser';
import { WineSettings } from './WineSettings';
import { desktopOs } from '../../utils/platform';

/**
 * Everything about a game, in one place.
 *
 * The rest of the drawer shows a game; this edits it. It is deliberately one
 * form rather than several, because the fields are not independent: a cover is
 * artwork, an author is text, and a completion time is a number, and a player
 * who wants to fix one of them should not have to work out which page it lives
 * on. Closing this editor keeps the fields. There is no separate save step.
 */
export function GameEditTab({ game, onUpdate, hideLaunchSettings = false, saveDir = '', onSaveDir, startOn }: {
  game: Game;
  onUpdate: (patch: Partial<Game>) => void;
  hideLaunchSettings?: boolean;
  saveDir?: string;
  onSaveDir?: (path: string) => void;
  /** The page to open on, for a preview that wants to look at one directly. */
  startOn?: 'details' | 'launch' | 'tools' | 'saves' | 'proton';
}) {
  const meta = game.meta;
  const hltb = game.hltb;
  const wineTarget = game.launch.kind === 'wine' ? game.launch : null;
  const [activeTab, setActiveTab] = useState<'details' | 'launch' | 'tools' | 'saves' | 'proton'>(startOn ?? 'details');
  const [savePath, setSavePath] = useState(saveDir);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuggestions, setSaveSuggestions] = useState<string[]>([]);
  const [reshadeBusy, setReshadeBusy] = useState(false);
  const [reshade, setReshadeState] = useState<ReshadeState | null>(null);
  const saveAttempted = useRef(false);

  const [title, setTitle] = useState(game.title);
  const [summary, setSummary] = useState(meta?.summary ?? '');
  const [developer, setDeveloper] = useState(meta?.developer ?? '');
  const [releaseYear, setReleaseYear] = useState(meta?.releaseYear ? String(meta.releaseYear) : '');
  const [rating, setRating] = useState(meta?.rating !== null && meta?.rating !== undefined ? String(meta.rating) : '');
  const [genres, setGenres] = useState((meta?.genres ?? []).join(', '));
  const [coverUrl, setCoverUrl] = useState(meta?.coverUrl ?? '');
  const [backdropUrl, setBackdropUrl] = useState(meta?.backgroundUrl ?? '');
  const [coverPath, setCoverPath] = useState(game.coverPath ?? '');
  const [main, setMain] = useState(hltb ? String(hltb.main) : '');
  const [mainExtra, setMainExtra] = useState(hltb ? String(hltb.mainExtra) : '');
  const [completionist, setCompletionist] = useState(hltb ? String(hltb.completionist) : '');
  const [sizeGb, setSizeGb] = useState(game.sizeBytes > 0 ? String(Math.round((game.sizeBytes / 1e9) * 10) / 10) : '');
  const [fit, setFit] = useState<'auto' | 'cover' | 'contain'>(meta?.coverFit ?? 'auto');
  const [status, setStatus] = useState<GameStatus>(game.status);
  const [favorite, setFavorite] = useState(game.favorite);
  const [hidden, setHidden] = useState(!!game.hidden);

  // A different game means a different form; the fields are reseeded rather than
  // carrying the last game's title into this one's.
  useEffect(() => {
    setTitle(game.title);
    setSummary(game.meta?.summary ?? '');
    setDeveloper(game.meta?.developer ?? '');
    setReleaseYear(game.meta?.releaseYear ? String(game.meta.releaseYear) : '');
    setRating(game.meta?.rating !== null && game.meta?.rating !== undefined ? String(game.meta.rating) : '');
    setGenres((game.meta?.genres ?? []).join(', '));
    setCoverUrl(game.meta?.coverUrl ?? '');
    setBackdropUrl(game.meta?.backgroundUrl ?? '');
    setCoverPath(game.coverPath ?? '');
    setMain(game.hltb ? String(game.hltb.main) : '');
    setMainExtra(game.hltb ? String(game.hltb.mainExtra) : '');
    setCompletionist(game.hltb ? String(game.hltb.completionist) : '');
    setSizeGb(game.sizeBytes > 0 ? String(Math.round((game.sizeBytes / 1e9) * 10) / 10) : '');
    setFit(game.meta?.coverFit ?? 'auto');
    setStatus(game.status);
    setFavorite(game.favorite);
    setHidden(!!game.hidden);
  }, [game.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setSavePath(saveDir), [game.id, saveDir]);
  // Opening Tools looks at the folder, so the switch is drawn in whatever state
  // the game is actually in rather than the one Orbit last remembered.
  useEffect(() => {
    if (activeTab !== 'tools') return;
    let current = true;
    setReshadeBusy(true);
    void getReshadeState(game.id)
      .then((next) => { if (current) setReshadeState(next); })
      .catch((error: unknown) => say(error instanceof Error ? error.message : String(error)))
      .finally(() => { if (current) setReshadeBusy(false); });
    return () => { current = false; };
  }, [activeTab, game.id]);
  useEffect(() => {
    if (activeTab !== 'saves' || saveDir.trim() || saveAttempted.current || !isNative()) return;
    saveAttempted.current = true;
    let current = true;
    setSaveBusy(true);
    setSaveError(null);
    void findSave(game.title, saveHintsOf(game))
      .then((found) => {
        if (!current) return;
        if (found) {
          setSavePath(found);
          onSaveDir?.(found);
          return;
        }
        return suggestSaves(game.title).then((suggestions) => {
          if (current) setSaveSuggestions(suggestions);
        });
      })
      .catch((error: unknown) => {
        if (current) setSaveError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => { if (current) setSaveBusy(false); });
    return () => { current = false; };
  }, [activeTab, game, onSaveDir, saveDir]);

  /** A number field, where empty means "no value" rather than zero. */
  const hours = (value: string): number | null => {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed.replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const formSnap = JSON.stringify({
    title, status, favorite, hidden, coverPath, coverUrl, backdropUrl,
    summary, developer, releaseYear, rating, genres, fit, sizeGb, main, mainExtra, completionist,
  });
  const initialSnap = useRef<string | null>(null);
  if (initialSnap.current === null) initialSnap.current = formSnap;
  const openedTimes = useRef({ main, mainExtra, completionist });
  const timesTouched = main !== openedTimes.current.main
    || mainExtra !== openedTimes.current.mainExtra
    || completionist !== openedTimes.current.completionist;
  // Compared with the form as it opened, not with later background writes, so
  // closing an untouched editor does not mark the game as edited by hand.
  const dirtyRef = useRef(false);
  dirtyRef.current = formSnap !== initialSnap.current;
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const commit = () => {
    const nextMeta: MetaData = {
      ...(meta ?? { summary: '', genres: [], developer: '', releaseYear: null, rating: null }),
      name: title.trim() || game.title,
      summary: summary.trim(),
      developer: developer.trim(),
      releaseYear: releaseYear.trim() === '' ? null : Number(releaseYear) || null,
      rating: rating.trim() === '' ? null : Number(rating) || null,
      genres: genres
        .split(',')
        .map((g) => g.trim())
        .filter(Boolean),
      coverUrl: coverUrl.trim() || null,
      backgroundUrl: backdropUrl.trim() || null,
      coverUrlCustom: Boolean(coverUrl.trim()) && (meta?.coverUrlCustom === true || coverUrl.trim() !== (meta?.coverUrl ?? '')),
      backgroundUrlCustom: Boolean(backdropUrl.trim()) && (meta?.backgroundUrlCustom === true || backdropUrl.trim() !== (meta?.backgroundUrl ?? '')),
      coverFit: fit === 'auto' ? undefined : fit,
      headerUrl: meta?.headerUrl ?? null,
      steamAppId: meta?.steamAppId ?? null,
      // A source is where the details came from. A game nobody has looked up
      // has none, rather than being called a Steam game by default.
      source: meta?.source,
    };

    const hoursIn = [hours(main), hours(mainExtra), hours(completionist)];
    const nextHltb: HltbData | null =
      hoursIn.every((h) => h === null)
        ? null
        : {
            main: hoursIn[0] ?? 0,
            mainExtra: hoursIn[1] ?? 0,
            completionist: hoursIn[2] ?? 0,
            // A time the player typed is theirs, so it is not marked as an
            // estimate from anywhere.
            source: 'hltb',
          };

    const gb = Number(sizeGb.replace(',', '.'));
    onUpdateRef.current({
      title: title.trim() || game.title,
      status,
      favorite,
      hidden,
      coverPath: coverPath.trim() || null,
      sizeBytes: Number.isFinite(gb) && gb > 0 ? Math.round(gb * 1e9) : 0,
      sizeGb: Number.isFinite(gb) && gb > 0 ? gb : 0,
      meta: nextMeta,
      // A refresh writes the times on its own. Closing must not put the old
      // numbers back over that unless the fields themselves were edited.
      ...(timesTouched ? { hltb: nextHltb ?? undefined } : {}),
    });
  };
  const commitRef = useRef(commit);
  commitRef.current = commit;

  useEffect(() => {
    return () => {
      if (dirtyRef.current) commitRef.current();
    };
  }, []);

  return (
    <section className="orbit-edit">
      <div className="orbit-edit-tabs" role="tablist" aria-label="Edit game sections">
        {([
          ['details', 'Details'],
          ...(!hideLaunchSettings ? [['launch', 'Launch'], ['tools', 'Tools']] as const : []),
          ...(desktopOs() === 'linux' && !hideLaunchSettings ? [['proton', 'Proton']] as const : []),
          ['saves', 'Saves'],
        ] as const).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={activeTab === id} onClick={() => setActiveTab(id)}>
            {label}
          </button>
        ))}
      </div>

      <section className="orbit-editsection" hidden={activeTab !== 'details'}>
        <header className="orbit-editsection-head">
          <h4 className="orbit-editsection-title">Game details</h4>
          <p className="orbit-editsection-note">Name, description and useful library information.</p>
        </header>
        <div className="orbit-edit-facts">
        <label className="block sm:col-span-2">
          <span className={labelCls}>Game name</span>
          <input className={inputCls} value={title} onChange={(event) => setTitle(event.target.value)} spellCheck={false} />
        </label>
        <label className="block">
          <span className={labelCls}>Author / developer</span>
          <input className={inputCls} value={developer} onChange={(e) => setDeveloper(e.target.value)} />
        </label>

        <label className="block">
          <span className={labelCls}>Released</span>
          <input
            className={inputCls}
            value={releaseYear}
            onChange={(e) => setReleaseYear(e.target.value)}
            placeholder="2019"
            inputMode="numeric"
          />
        </label>

        <label className="block">
          <span className={labelCls}>Score out of 100</span>
          <input
            className={inputCls}
            value={rating}
            onChange={(e) => setRating(e.target.value)}
            placeholder="Leave empty for none"
            inputMode="numeric"
          />
        </label>

        <label className="block">
          <span className={labelCls}>Size in GB</span>
          <input
            className={inputCls}
            value={sizeGb}
            onChange={(e) => setSizeGb(e.target.value)}
            placeholder="12.5"
            inputMode="decimal"
          />
        </label>

        <label className="block sm:col-span-2">
          <span className={labelCls}>Genres, comma separated</span>
          <input className={inputCls} value={genres} onChange={(e) => setGenres(e.target.value)} placeholder="Action, RPG" />
        </label>

        <label className="block sm:col-span-2">
          <span className={labelCls}>About</span>
          <textarea
            className={`${inputCls} h-28 resize-y`}
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="What the game is, in your own words if you like."
          />
        </label>
      </div>
      </section>

      <section className="orbit-editsection" hidden={activeTab !== 'details'}>
        <header className="orbit-editsection-head">
          <h4 className="orbit-editsection-title"><Image className="size-3.5" />Artwork</h4>
          <p className="orbit-editsection-note">Choose a cover and a wide Stardeck backdrop. A preview stays beside each choice.</p>
        </header>
        <div className="orbit-art-workbench">
          <article className="orbit-art-choice">
            <div className="orbit-art-choice-preview is-cover">
              {(coverPath.trim() ? fileSrc(coverPath.trim()) : coverUrl.trim() || game.meta?.coverUrl) ?
                <img src={coverPath.trim() ? fileSrc(coverPath.trim()) : coverUrl.trim() || game.meta?.coverUrl || ''} alt="Cover preview" /> :
                <span>{game.title}</span>}
            </div>
            <div className="orbit-art-choice-copy">
              <h5>Cover</h5><p>The poster shown on library tiles.</p>
              <div className="flex flex-wrap gap-2">
                {isNative() && <button type="button" className={btnBrowse} onClick={() => void pickAnyFile('Choose cover art').then((path) => path && setCoverPath(path))}><FolderOpen className="size-3.5" />Choose file</button>}
                <PortraitBrowser resetKey={game.id} selected={coverUrl} load={(page) => findArtwork(game.id, page)} onChoose={(pick) => { setCoverUrl(pick.url); setCoverPath(''); say('Cover updated.'); }} />
                {(coverPath || coverUrl) && <button type="button" className={btnGhost} onClick={() => { setCoverPath(''); setCoverUrl(''); }}>Use library art</button>}
              </div>
              <details className="orbit-art-url"><summary>Enter a cover URL</summary><input className={inputCls} type="url" value={coverUrl} onChange={(event) => { setCoverUrl(event.target.value); setCoverPath(''); }} placeholder="https://…" spellCheck={false} /></details>
              <details className="orbit-art-url">
                <summary>Fit in the library tile</summary>
                <div className="flex w-fit rounded-lg border border-line p-0.5">
                  {([['auto', 'Auto'], ['cover', 'Fill'], ['contain', 'Fit']] as const).map(([id, label]) => <button key={id} type="button" aria-pressed={fit === id} onClick={() => setFit(id)} className="orbit-art-fit">{label}</button>)}
                </div>
              </details>
            </div>
          </article>
          <article className="orbit-art-choice is-wide">
            <div className="orbit-art-choice-preview is-backdrop">
              {(backdropUrl.trim() || game.meta?.headerUrl || game.meta?.backgroundUrl) ? <img src={backdropUrl.trim() || game.meta?.headerUrl || game.meta?.backgroundUrl || ''} alt="Backdrop preview" /> : <span>Stardeck backdrop</span>}
            </div>
            <div className="orbit-art-choice-copy">
              <h5>Wide backdrop</h5><p>The atmospheric image behind the selected game in Stardeck.</p>
              <div className="flex flex-wrap gap-2">
                {isNative() && <button type="button" className={btnBrowse} onClick={() => void pickAnyFile('Choose a wide backdrop').then((path) => path && setBackdropUrl(fileSrc(path)))}><FolderOpen className="size-3.5" />Choose file</button>}
                <PortraitBrowser shape="wide" actionLabel="Browse backdrops" emptyLabel="No wide artwork was found." resetKey={`${game.id}:backdrop`} selected={backdropUrl} load={() => findBackdropArtwork(game.id)} onChoose={(pick) => { setBackdropUrl(pick.url); say(`Backdrop selected · ${pick.label}`); }} />
                {backdropUrl && <button type="button" className={btnGhost} onClick={() => setBackdropUrl('')}>Use automatic art</button>}
              </div>
              <details className="orbit-art-url"><summary>Enter a backdrop URL</summary><input className={inputCls} type="url" value={backdropUrl} onChange={(event) => setBackdropUrl(event.target.value)} placeholder="https://…" spellCheck={false} /></details>
            </div>
          </article>
        </div>
      </section>
      <section className="orbit-editsection orbit-editsection-centered" hidden={activeTab !== 'details'}>
        <header className="orbit-editsection-head">
          <h4 className="orbit-editsection-title">In the library</h4>
          <p className="orbit-editsection-note">
            Where the game sits on the shelf, and whether it is one you want to see first.
          </p>
        </header>
        <label className="block max-w-sm">
          <span className={labelCls}>Status</span>
          <Select
            value={status}
            onChange={(value) => setStatus(value as GameStatus)}
            ariaLabel="Game status"
            options={[
              { value: 'backlog', label: 'Backlog' },
              { value: 'playing', label: 'Playing' },
              { value: 'completed', label: 'Completed' },
              { value: 'dropped', label: 'Dropped' },
            ]}
          />
        </label>
        <div className="orbit-edit-choices">
          <EditSwitch label="Favorite" hint="Keep this game easy to find." checked={favorite} onChange={setFavorite} />
          <EditSwitch label="Hide from Library" hint="Keep it out of the Library grid; it remains searchable." checked={hidden} onChange={setHidden} />
        </div>
      </section>

      {activeTab === 'tools' && !hideLaunchSettings && (
        <section className="orbit-editsection orbit-reshade-panel">
          <header className="orbit-editsection-head">
            <h4 className="orbit-editsection-title">
              <Sparkles className="size-3.5" />
              ReShade
            </h4>
            <p className="orbit-editsection-note">
              One switch. Orbit reads the game's own program to know which file it loads, keeps whatever was there
              first, and puts it back when the switch goes off.
            </p>
          </header>

          {reshade ? (
            <div className="orbit-reshade" data-state={reshade.state}>
              <div className="orbit-reshade-row">
                <div className="orbit-reshade-copy">
                  <p className="orbit-reshade-label">
                    {reshade.state === 'on' ? 'ReShade is on' : reshade.state === 'off' ? 'ReShade is off' : 'No ReShade here'}
                    {reshade.proxy ? <span className="orbit-reshade-file">{reshade.proxy}.dll</span> : null}
                  </p>
                  <p className="orbit-reshade-hint">
                    {!reshade.supported
                      ? reshade.reason ?? 'ReShade is a Windows graphics tool, so this needs a Windows or Wine game.'
                      : !reshade.folder
                        ? reshade.reason ?? 'Orbit cannot see a folder for this game yet.'
                        : reshade.state === 'on'
                          ? `In ${reshade.folder}${reshade.backup ? ' · the original file is kept beside it' : ''}`
                          : reshade.state === 'off'
                            ? 'Turned off: the game starts exactly as it did before.'
                            : `Ready to go into ${reshade.folder}. Home opens ReShade in game.`}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={reshade.state === 'on'}
                  aria-label="Use ReShade with this game"
                  disabled={reshadeBusy || !reshade.supported || !reshade.folder}
                  onClick={() => {
                    const next = reshade.state !== 'on';
                    setReshadeBusy(true);
                    void setReshade(game.id, next)
                      .then((state) => {
                        setReshadeState(state);
                        say(next ? 'ReShade is on. Press Home in game to open it.' : 'ReShade is off. The game is as it was.');
                      })
                      .catch((error: unknown) => say(error instanceof Error ? error.message : String(error)))
                      .finally(() => setReshadeBusy(false));
                  }}
                  className="orbit-switch"
                  data-on={reshade.state === 'on' || undefined}
                >
                  <i />
                </button>
              </div>

              {reshade.supported && reshade.folder && (
                <div className="orbit-reshade-foot">
                  <button
                    type="button"
                    className={btnGhost}
                    disabled={reshadeBusy}
                    onClick={() =>
                      void pickFile('Choose a ReShade DLL you already have', ['dll'], undefined).then((path) => {
                        if (!path) return;
                        setReshadeBusy(true);
                        void useReshadeFile(game.id, path)
                          .then((state) => {
                            setReshadeState(state);
                            say('ReShade is on, using your own DLL.');
                          })
                          .catch((error: unknown) => say(error instanceof Error ? error.message : String(error)))
                          .finally(() => setReshadeBusy(false));
                      })
                    }
                  >
                    Use a ReShade DLL I already have
                  </button>
                  <button
                    type="button"
                    className={btnGhost}
                    onClick={() => void revealInExplorer(reshade.folder ?? '')}
                  >
                    <FolderOpen className="size-3.5" />
                    Open the game's folder
                  </button>
                </div>
              )}

              <p className="orbit-reshade-caution">
                Turning it on downloads ReShade once and installs it into the game's own folder. ReShade
                draws over the game, so some anti-cheat systems read it as tampering — worth checking the game's rules
                before using it online.
              </p>
            </div>
          ) : (
            <p className="orbit-reshade-hint">{reshadeBusy ? 'Looking at the game folder…' : 'ReShade was not checked.'}</p>
          )}
        </section>
      )}

      {activeTab === 'proton' && !hideLaunchSettings && (
        <section className="orbit-editsection orbit-proton-page">
          <header className="orbit-editsection-head">
            <h4 className="orbit-editsection-title">Proton for this game</h4>
            <p className="orbit-editsection-note">Choose a compatibility build and tune the environment this Windows game uses on Linux.</p>
          </header>
          {wineTarget ? (
            <WineSettings
              proton={wineTarget.proton ?? null}
              tweaks={wineTarget.tweaks}
              onProton={(proton) => onUpdate({ launch: { ...wineTarget, proton } })}
              onTweaks={(tweaks) => onUpdate({ launch: { ...wineTarget, tweaks } })}
            />
          ) : (
            <div className="mx-auto max-w-xl rounded-xl border border-line bg-panel2 p-4 text-center">
              <p className="text-sm font-semibold">Set the launch type to Wine first</p>
              <p className="mt-1 text-xs text-muted">Proton builds and compatibility options become available when this game launches through Wine.</p>
              <button type="button" className={`${btnBrowse} mt-3`} onClick={() => setActiveTab('launch')}>Open Launch settings</button>
            </div>
          )}
        </section>
      )}

      {!hideLaunchSettings && activeTab === 'launch' && (
        <LaunchEditor
          game={game}
          saveOnClose
          section="launch"
          onSave={(launch, companions) => onUpdate({ launch, companions })}
        />
      )}

      {activeTab === 'saves' && (
        <section className="orbit-editsection">
          <header className="orbit-editsection-head">
            <h4 className="orbit-editsection-title">Save location</h4>
          </header>
          <label className="block">
            <span className={labelCls}>Detected or chosen folder</span>
            <div className="flex gap-2">
              <input className={inputCls} value={savePath} onChange={(event) => { setSavePath(event.target.value); onSaveDir?.(event.target.value); }} placeholder="No save folder found yet" spellCheck={false} />
              {isNative() && <button type="button" className={btnBrowse} onClick={() => void pickFolder('Choose this game’s save folder', savePath || undefined).then((path) => { if (path) { setSavePath(path); onSaveDir?.(path); } })}>Browse</button>}
            </div>
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={cn(btnBrowse, 'inline-flex items-center gap-2')} disabled={saveBusy} onClick={() => {
              setSaveBusy(true); setSaveError(null);
              void findSave(game.title, saveHintsOf(game)).then(async (found) => {
                if (found) { setSavePath(found); onSaveDir?.(found); setSaveSuggestions([]); }
                else setSaveSuggestions(await suggestSaves(game.title));
              }).catch((error: unknown) => setSaveError(error instanceof Error ? error.message : String(error))).finally(() => setSaveBusy(false));
            }}>
              <FolderOpen className="size-3.5" /> {saveBusy ? 'Searching…' : 'Find save folder'}
            </button>
            {savePath.trim() && <button type="button" disabled={!isNative()} className={btnGhost} onClick={() => void revealInExplorer(savePath)}>Open folder</button>}
          </div>
          {saveSuggestions.length > 0 && <div className="space-y-2 rounded-xl border border-line bg-panel p-3"><p className="text-xs font-semibold">PCGamingWiki lists these candidate locations for {game.title}:</p>{saveSuggestions.map((suggestion) => <p key={suggestion} className="break-all font-mono text-xs text-muted" title={suggestion}>{suggestion}</p>)}</div>}
          {saveError && <p role="alert" className="text-xs text-rose-300">{saveError}</p>}
        </section>
      )}

      <section className="orbit-editsection orbit-editsection-centered" hidden={activeTab !== 'details'}>
        <header className="orbit-editsection-head">
          <h4 className="orbit-editsection-title">
            <Sparkles className="size-3.5" />
            How long it takes
          </h4>
          <p className="orbit-editsection-note">
            From a HowLongToBeat lookup, in hours. Anything typed here is kept instead; empty means no time
            is known.
          </p>
        </header>
        <div className="orbit-edit-times">
          <label className="block">
            <span className={labelCls}>Main story</span>
            <input className={inputCls} value={main} onChange={(e) => setMain(e.target.value)} inputMode="decimal" />
          </label>
          <label className="block">
            <span className={labelCls}>Main + extras</span>
            <input className={inputCls} value={mainExtra} onChange={(e) => setMainExtra(e.target.value)} inputMode="decimal" />
          </label>
          <label className="block">
            <span className={labelCls}>Completionist</span>
            <input
              className={inputCls}
              value={completionist}
              onChange={(e) => setCompletionist(e.target.value)}
              inputMode="decimal"
            />
          </label>
        </div>
        <button
          type="button"
          className={`${btnGhost} flex w-fit items-center gap-2 text-xs`}
          onClick={() => void fetchHltb(title || game.title).then((h) => h && onUpdate({ hltb: h }))}
        >
          <RotateCcw className="size-3.5" />
          Look these up again
        </button>
      </section>

      {activeTab === 'details' && game.installDir && (
        <p className="orbit-edit-path">
          {game.installDir}
          {game.sizeBytes > 0 ? ` · ${fmtBytes(game.sizeBytes)}` : ''}
        </p>
      )}


    </section>
  );
}


function EditSwitch({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return <div className="orbit-setrow"><div className="orbit-setrow-copy"><p className="orbit-setrow-label">{label}</p><p className="orbit-setrow-hint">{hint}</p></div><button type="button" role="switch" aria-label={label} aria-checked={checked} onClick={() => onChange(!checked)} className="orbit-switch" data-on={checked || undefined}><i /></button></div>;
}
