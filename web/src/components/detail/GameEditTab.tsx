import { useEffect, useRef, useState } from 'react';
import {
  Boxes,
  Check,
  Clock3,
  FolderOpen,
  Image as ImageIcon,
  Info,
  Palette,
  Play,
  RotateCcw,
  Save,
  Sparkles,
} from 'lucide-react';
import type { Game, GameStatus, HltbData, MetaData } from '../../types';
import {
  findArtwork,
  findArtworkChoices,
  findBackdropArtwork,
  findSave,
  getReshadeState,
  isNative,
  revealInExplorer,
  saveHintsOf,
  setReshade,
  suggestSaves,
  useReshadeFile,
  type ReshadeState,
} from '../../services/native';
import { say } from '../../utils/toast';
import { fileSrc, pickAnyFile, pickFile, pickFolder } from '../../services/desktop';
import { fetchHltb } from '../../services/hltb';
import { fetchMetadata } from '../../services/metadata';
import { fmtBytes } from '../../utils/format';
import { cn } from '../../utils/cn';
import { LaunchEditor } from './LaunchEditor';
import { ArtworkPicker, type ArtShape } from './ArtworkPicker';
import { Select } from '../ui/Select';
import { btnBrowse, btnGhost, inputCls, labelCls } from '../ui/Modal';
import { WineSettings } from './WineSettings';
import { desktopOs } from '../../utils/platform';

type Tab = 'details' | 'launch' | 'artwork' | 'tools' | 'saves' | 'proton';

/**
 * The game's own page, for changing it.
 *
 * A tab per question rather than a tab per field group: what the game *is*
 * (Details), how it *starts* (Launch), what it *looks like* (Artwork), what
 * runs *with it* (Tools), and where it keeps its *progress* (Saves). Proton
 * appears on its own only when this machine needs it.
 *
 * Three rules hold the page together:
 *
 * - **It saves itself.** Every field writes on a short delay, and closing the
 *   page writes whatever is left. There is no Save button to forget, and no
 *   Cancel to lose an afternoon's typing to.
 * - **Nothing is fetched unasked.** Artwork and completion times are found
 *   when the player presses the button that says so, because both are slow and
 *   both are outside Orbit's control.
 * - **The page is the game's.** Every section shows what this game has now
 *   before it offers to change it, so a visit to check one thing does not start
 *   by clearing any of it.
 */
export function GameEditTab({ game, onUpdate, hideLaunchSettings = false, saveDir = '', onSaveDir, startOn }: {
  game: Game;
  onUpdate: (patch: Partial<Game>) => void;
  hideLaunchSettings?: boolean;
  saveDir?: string;
  onSaveDir?: (path: string) => void;
  /** The page to open on, for a preview that wants to look at one directly. */
  startOn?: Tab;
}) {
  const meta = game.meta;
  const hltb = game.hltb;
  const wineTarget = game.launch.kind === 'wine' ? game.launch : null;
  const [activeTab, setActiveTab] = useState<Tab>(startOn ?? 'details');

  const [title, setTitle] = useState(game.title);
  const [summary, setSummary] = useState(meta?.summary ?? '');
  const [developer, setDeveloper] = useState(meta?.developer ?? '');
  const [releaseYear, setReleaseYear] = useState(meta?.releaseYear ? String(meta.releaseYear) : '');
  const [rating, setRating] = useState(meta?.rating !== null && meta?.rating !== undefined ? String(meta.rating) : '');
  const [genres, setGenres] = useState((meta?.genres ?? []).join(', '));
  const [sizeGb, setSizeGb] = useState(game.sizeBytes > 0 ? String(Math.round((game.sizeBytes / 1e9) * 10) / 10) : '');
  const [status, setStatus] = useState<GameStatus>(game.status);
  const [favorite, setFavorite] = useState(game.favorite);
  const [hidden, setHidden] = useState(!!game.hidden);
  const [main, setMain] = useState(hltb ? String(hltb.main) : '');
  const [mainExtra, setMainExtra] = useState(hltb ? String(hltb.mainExtra) : '');
  const [completionist, setCompletionist] = useState(hltb ? String(hltb.completionist) : '');
  const [coverUrl, setCoverUrl] = useState(meta?.coverUrl ?? '');
  const [backdropUrl, setBackdropUrl] = useState(meta?.backgroundUrl ?? '');
  const [coverPath, setCoverPath] = useState(game.coverPath ?? '');
  const [fit, setFit] = useState<'auto' | 'cover' | 'contain'>(meta?.coverFit ?? 'auto');

  const [looking, setLooking] = useState(false);
  const [reshade, setReshadeState] = useState<ReshadeState | null>(null);
  const [reshadeBusy, setReshadeBusy] = useState(false);

  const [savePath, setSavePath] = useState(saveDir);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuggestions, setSaveSuggestions] = useState<string[]>([]);
  const saveAttempted = useRef(false);

  // A different game is a different form. The fields are reseeded rather than
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
    setFit(game.meta?.coverFit ?? 'auto');
    setMain(game.hltb ? String(game.hltb.main) : '');
    setMainExtra(game.hltb ? String(game.hltb.mainExtra) : '');
    setCompletionist(game.hltb ? String(game.hltb.completionist) : '');
    setSizeGb(game.sizeBytes > 0 ? String(Math.round((game.sizeBytes / 1e9) * 10) / 10) : '');
    setStatus(game.status);
    setFavorite(game.favorite);
    setHidden(!!game.hidden);
  }, [game.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setSavePath(saveDir), [game.id, saveDir]);

  // The Tools switch is drawn from the folder it is about, so opening the page
  // looks at it rather than at whatever was remembered last time.
  useEffect(() => {
    if (activeTab !== 'tools') return;
    let current = true;
    setReshadeBusy(true);
    void getReshadeState(game.id)
      .then((next) => { if (current) setReshadeState(next); })
      .catch((cause: unknown) => say(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => { if (current) setReshadeBusy(false); });
    return () => { current = false; };
  }, [activeTab, game.id]);

  // A save folder is worth finding once, on the first look at the page, and
  // never worth finding behind the player's back every time it opens.
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
      .catch((cause: unknown) => {
        if (current) setSaveError(cause instanceof Error ? cause.message : String(cause));
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
  const dirtyRef = useRef(false);
  dirtyRef.current = formSnap !== initialSnap.current;

  const commit = () => {
    const nextMeta: MetaData = {
      ...(meta ?? { summary: '', genres: [], developer: '', releaseYear: null, rating: null }),
      name: title.trim() || game.title,
      summary: summary.trim(),
      developer: developer.trim(),
      releaseYear: releaseYear.trim() === '' ? null : Number(releaseYear) || null,
      rating: rating.trim() === '' ? null : Number(rating) || null,
      genres: genres.split(',').map((genre) => genre.trim()).filter(Boolean),
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
    const nextHltb: HltbData | null = hoursIn.every((value) => value === null)
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
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  // Typing saves itself: a change that settles for half a second is written.
  useEffect(() => {
    if (!dirtyRef.current) return;
    const timer = window.setTimeout(() => commitRef.current(), 450);
    return () => window.clearTimeout(timer);
  }, [formSnap]);

  useEffect(() => {
    return () => {
      if (dirtyRef.current) commitRef.current();
    };
  }, []);

  // Written out rather than built in a loop: each tab is a decision about
  // where a thing lives, and the two that only exist in some situations say so
  // on the line they are on.
  const tabs: { id: Tab; label: string; icon: typeof Info }[] = [
    { id: 'details', label: 'Details', icon: Info },
    ...(!hideLaunchSettings
      ? [
          { id: 'launch' as const, label: 'Launch', icon: Play },
          { id: 'artwork' as const, label: 'Artwork', icon: ImageIcon },
          { id: 'tools' as const, label: 'Tools', icon: Sparkles },
        ]
      : []),
    ...(desktopOs() === 'linux' && !hideLaunchSettings
      ? [{ id: 'proton' as const, label: 'Proton', icon: Boxes }]
      : []),
    { id: 'saves', label: 'Saves', icon: Save },
  ];
  const shownTab = tabs.some((tab) => tab.id === activeTab) ? activeTab : 'details';

  /** Fill in what the store knows, without touching anything typed here. */
  const lookup = async () => {
    setLooking(true);
    try {
      const found = await fetchMetadata(title.trim() || game.title, meta?.steamAppId ?? undefined);
      if (!found) {
        say('No store page was found for that name.');
        return;
      }
      // Only the empty fields are filled: a name the player typed, or a
      // description they wrote, is theirs and is not replaced by a store's.
      if (!summary.trim() && found.summary) setSummary(found.summary);
      if (!developer.trim() && found.developer) setDeveloper(found.developer);
      if (!releaseYear.trim() && found.releaseYear) setReleaseYear(String(found.releaseYear));
      if (!genres.trim() && found.genres?.length) setGenres(found.genres.join(', '));
      if (!coverUrl.trim() && found.coverUrl) setCoverUrl(found.coverUrl);
      if (!backdropUrl.trim() && found.backgroundUrl) setBackdropUrl(found.backgroundUrl);
      onUpdate({ meta: { ...(meta ?? { summary: '', genres: [], developer: '', releaseYear: null, rating: null }), ...found } });
      say('Details came back from the store.');
    } catch (cause) {
      say(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLooking(false);
    }
  };

  const coverShown = coverPath.trim() ? fileSrc(coverPath.trim()) : coverUrl.trim() || meta?.coverUrl || null;
  const backdropShown = backdropUrl.trim() || meta?.backgroundUrl || meta?.headerUrl || null;

  return (
    <section className="orbit-edit">
      <div className="orbit-edit-tabs" role="tablist" aria-label="Edit game sections">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={shownTab === id} onClick={() => setActiveTab(id)}>
            <Icon className="size-3.5" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {/* ------------------------------------------------------------ details */}
      {shownTab === 'details' && (
        <>
          <section className="orbit-editsection">
            <header className="orbit-editsection-head">
              <h4 className="orbit-editsection-title">The game</h4>
              <p className="orbit-editsection-note">What it is called, who made it, and what it is about.</p>
            </header>
            <div className="orbit-edit-facts">
              <label className="is-span-2">
                <span className={labelCls}>Name</span>
                <input className={inputCls} value={title} onChange={(event) => setTitle(event.target.value)} spellCheck={false} />
              </label>
              <label>
                <span className={labelCls}>Developer</span>
                <input className={inputCls} value={developer} onChange={(event) => setDeveloper(event.target.value)} />
              </label>
              <label>
                <span className={labelCls}>Released</span>
                <input className={inputCls} value={releaseYear} onChange={(event) => setReleaseYear(event.target.value)} placeholder="2019" inputMode="numeric" />
              </label>
              <label>
                <span className={labelCls}>Genres</span>
                <input className={inputCls} value={genres} onChange={(event) => setGenres(event.target.value)} placeholder="Action, RPG" />
              </label>
              <label>
                <span className={labelCls}>Score out of 100</span>
                <input className={inputCls} value={rating} onChange={(event) => setRating(event.target.value)} placeholder="Empty for none" inputMode="numeric" />
              </label>
              <label className="is-span-2">
                <span className={labelCls}>About</span>
                <textarea
                  className={`${inputCls} orbit-edit-about`}
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                  placeholder="What the game is. The store's own words, or yours."
                />
              </label>
            </div>
            <div className="orbit-edit-actions">
              <button type="button" className={btnBrowse} disabled={looking} onClick={() => void lookup()}>
                <RotateCcw className={cn('size-3.5', looking && 'animate-spin')} />
                {looking ? 'Looking…' : 'Fill in from the store'}
              </button>
              <span className="orbit-edit-hint">Only empty fields are filled. Anything you typed stays.</span>
            </div>
          </section>

          <section className="orbit-editsection">
            <header className="orbit-editsection-head">
              <h4 className="orbit-editsection-title"><Palette className="size-3.5" />In the library</h4>
              <p className="orbit-editsection-note">How it is filed, and how much room it takes.</p>
            </header>
            <div className="orbit-edit-facts">
              <label>
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
              <label>
                <span className={labelCls}>Size on disk, in GB</span>
                <input className={inputCls} value={sizeGb} onChange={(event) => setSizeGb(event.target.value)} placeholder="12.5" inputMode="decimal" />
              </label>
            </div>
            <div className="orbit-edit-choices">
              <EditSwitch label="Favorite" hint="Keep this game easy to find." checked={favorite} onChange={setFavorite} />
              <EditSwitch label="Hide from the library" hint="Out of the grid, still searchable, sessions kept." checked={hidden} onChange={setHidden} />
            </div>
            {game.installDir && (
              <p className="orbit-edit-path">
                {game.installDir}
                {game.sizeBytes > 0 ? ` · ${fmtBytes(game.sizeBytes)}` : ''}
              </p>
            )}
          </section>

          <section className="orbit-editsection">
            <header className="orbit-editsection-head">
              <h4 className="orbit-editsection-title"><Clock3 className="size-3.5" />How long it takes</h4>
              <p className="orbit-editsection-note">Hours, from HowLongToBeat. Anything typed here is kept instead; empty means nothing is known.</p>
            </header>
            <div className="orbit-edit-times">
              <label>
                <span className={labelCls}>Main story</span>
                <input className={inputCls} value={main} onChange={(event) => setMain(event.target.value)} inputMode="decimal" />
              </label>
              <label>
                <span className={labelCls}>Main + extras</span>
                <input className={inputCls} value={mainExtra} onChange={(event) => setMainExtra(event.target.value)} inputMode="decimal" />
              </label>
              <label>
                <span className={labelCls}>Completionist</span>
                <input className={inputCls} value={completionist} onChange={(event) => setCompletionist(event.target.value)} inputMode="decimal" />
              </label>
            </div>
            <div className="orbit-edit-actions">
              <button
                type="button"
                className={btnGhost}
                onClick={() => void fetchHltb(title.trim() || game.title).then((found) => {
                  if (!found) return say('HowLongToBeat has no time for that name.');
                  setMain(String(found.main));
                  setMainExtra(String(found.mainExtra));
                  setCompletionist(String(found.completionist));
                  onUpdate({ hltb: found });
                })}
              >
                <RotateCcw className="size-3.5" />
                Look these up
              </button>
            </div>
          </section>
        </>
      )}

      {/* ------------------------------------------------------------ artwork */}
      {shownTab === 'artwork' && (
        <section className="orbit-editsection">
          <header className="orbit-editsection-head">
            <h4 className="orbit-editsection-title"><ImageIcon className="size-3.5" />Artwork</h4>
            <p className="orbit-editsection-note">
              Each slot is a shape, and each is found in its own shape. The picture a game has now is at the top;
              everything under it is a replacement, and choosing one saves it straight away.
            </p>
          </header>

          <ArtSlot
            shape="portrait"
            title={title.trim() || game.title}
            current={coverShown}
            currentLabel={coverPath.trim() ? 'A picture on this machine' : coverUrl.trim() ? 'Chosen earlier' : 'The library’s own art'}
            canReset={Boolean(coverPath.trim() || coverUrl.trim())}
            onReset={() => { setCoverPath(''); setCoverUrl(''); }}
            onUseFile={isNative() ? () => void pickAnyFile('Choose cover art').then((path) => path && setCoverPath(path)) : undefined}
            onChoose={(url, source) => { setCoverUrl(url); setCoverPath(''); say(`Cover set from ${source}.`); onUpdate({ meta: { ...(meta ?? { summary: '', genres: [], developer: '', releaseYear: null, rating: null }), coverUrl: url, coverUrlCustom: true, coverFit: meta?.coverFit } }); }}
            load={(query, page) => (query === game.title ? findArtwork(game.id, page) : findArtworkChoices(query, meta?.steamAppId ?? null, page))}
            fit={{ value: fit, onChange: setFit }}
          />
          <ArtSlot
            shape="wide"
            title={title.trim() || game.title}
            current={backdropShown}
            currentLabel={backdropUrl.trim() ? 'Chosen earlier' : 'The store’s own hero'}
            canReset={Boolean(backdropUrl.trim())}
            onReset={() => setBackdropUrl('')}
            onUseFile={isNative() ? () => void pickAnyFile('Choose a wide backdrop').then((path) => path && setBackdropUrl(fileSrc(path))) : undefined}
            onChoose={(url, source) => { setBackdropUrl(url); say(`Backdrop set from ${source}.`); onUpdate({ meta: { ...(meta ?? { summary: '', genres: [], developer: '', releaseYear: null, rating: null }), backgroundUrl: url, backgroundUrlCustom: true } }); }}
            load={(query, page) => (query === game.title ? findBackdropArtwork(game.id) : findArtworkChoices(query, meta?.steamAppId ?? null, page))}
          />
        </section>
      )}

      {/* ------------------------------------------------------------- launch */}
      {shownTab === 'launch' && !hideLaunchSettings && (
        <LaunchEditor
          game={game}
          saveOnClose
          section="launch"
          onSave={(launch, companions) => onUpdate({ launch, companions })}
        />
      )}

      {/* -------------------------------------------------------------- tools */}
      {shownTab === 'tools' && !hideLaunchSettings && (
        <section className="orbit-editsection orbit-reshade-panel">
          <header className="orbit-editsection-head">
            <h4 className="orbit-editsection-title"><Sparkles className="size-3.5" />ReShade</h4>
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
                      .catch((cause: unknown) => say(cause instanceof Error ? cause.message : String(cause)))
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
                    onClick={() => void pickFile('Choose a ReShade DLL you already have', ['dll'], undefined).then((path) => {
                      if (!path) return;
                      setReshadeBusy(true);
                      void useReshadeFile(game.id, path)
                        .then((state) => {
                          setReshadeState(state);
                          say('ReShade is on, using your own DLL.');
                        })
                        .catch((cause: unknown) => say(cause instanceof Error ? cause.message : String(cause)))
                        .finally(() => setReshadeBusy(false));
                    })}
                  >
                    Use a ReShade DLL I already have
                  </button>
                  <button type="button" className={btnGhost} onClick={() => void revealInExplorer(reshade.folder ?? '')}>
                    <FolderOpen className="size-3.5" />
                    Open the game's folder
                  </button>
                </div>
              )}

              <p className="orbit-reshade-caution">
                Turning it on downloads ReShade once and installs it into the game's own folder. ReShade draws over the
                game, so some anti-cheat systems read it as tampering — worth checking the game's rules before using it
                online.
              </p>
            </div>
          ) : (
            <p className="orbit-reshade-hint">{reshadeBusy ? 'Looking at the game folder…' : 'ReShade was not checked.'}</p>
          )}
        </section>
      )}

      {/* ------------------------------------------------------------- proton */}
      {shownTab === 'proton' && !hideLaunchSettings && (
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
            <div className="orbit-edit-nudge">
              <p className="orbit-edit-nudge-title">This game does not start through Wine yet</p>
              <p className="orbit-edit-hint">Proton builds and compatibility options appear once the game is launched as a Windows program.</p>
              <button type="button" className={btnBrowse} onClick={() => setActiveTab('launch')}>Open Launch</button>
            </div>
          )}
        </section>
      )}

      {/* -------------------------------------------------------------- saves */}
      {shownTab === 'saves' && (
        <section className="orbit-editsection">
          <header className="orbit-editsection-head">
            <h4 className="orbit-editsection-title"><Save className="size-3.5" />Saves</h4>
            <p className="orbit-editsection-note">Where this game keeps its progress, so the folder is one press away.</p>
          </header>
          <label>
            <span className={labelCls}>Folder</span>
            <div className="orbit-edit-row">
              <input
                className={inputCls}
                value={savePath}
                onChange={(event) => { setSavePath(event.target.value); onSaveDir?.(event.target.value); }}
                placeholder="No save folder found yet"
                spellCheck={false}
              />
              {isNative() && (
                <button
                  type="button"
                  className={btnBrowse}
                  onClick={() => void pickFolder('Choose this game’s save folder', savePath || undefined).then((path) => {
                    if (path) { setSavePath(path); onSaveDir?.(path); }
                  })}
                >
                  Browse
                </button>
              )}
            </div>
          </label>
          <div className="orbit-edit-actions">
            <button
              type="button"
              className={btnBrowse}
              disabled={saveBusy}
              onClick={() => {
                setSaveBusy(true);
                setSaveError(null);
                void findSave(game.title, saveHintsOf(game))
                  .then(async (found) => {
                    if (found) { setSavePath(found); onSaveDir?.(found); setSaveSuggestions([]); }
                    else setSaveSuggestions(await suggestSaves(game.title));
                  })
                  .catch((cause: unknown) => setSaveError(cause instanceof Error ? cause.message : String(cause)))
                  .finally(() => setSaveBusy(false));
              }}
            >
              <FolderOpen className="size-3.5" />
              {saveBusy ? 'Searching…' : 'Find save folder'}
            </button>
            {savePath.trim() && (
              <button type="button" disabled={!isNative()} className={btnGhost} onClick={() => void revealInExplorer(savePath)}>
                Open folder
              </button>
            )}
          </div>
          {saveSuggestions.length > 0 && (
            <div className="orbit-edit-suggestions">
              <p className="orbit-edit-hint">PCGamingWiki lists these places for {game.title}:</p>
              {saveSuggestions.map((suggestion) => (
                <button key={suggestion} type="button" className="orbit-edit-suggestion" onClick={() => { setSavePath(suggestion); onSaveDir?.(suggestion); }}>
                  <Check className="size-3" />
                  {suggestion}
                </button>
              ))}
            </div>
          )}
          {saveError && <p role="alert" className="orbit-edit-error">{saveError}</p>}
        </section>
      )}
    </section>
  );
}

/**
 * One shape's worth of artwork: what the game shows now, then the pictures
 * found for it.
 *
 * The current picture sits on its own above the picker, in the slot's real
 * shape, because that is the thing the player came to look at - and the wall
 * below it is a comparison against it.
 */
function ArtSlot({
  shape,
  title,
  current,
  currentLabel,
  canReset,
  onReset,
  onChoose,
  onUseFile,
  load,
  fit,
}: {
  shape: ArtShape;
  title: string;
  current: string | null;
  currentLabel: string;
  canReset: boolean;
  onReset: () => void;
  onChoose: (url: string, source: string) => void;
  onUseFile?: () => void;
  load: (query: string, page: number) => Promise<import('../../services/native').ArtworkFound>;
  fit?: { value: 'auto' | 'cover' | 'contain'; onChange: (next: 'auto' | 'cover' | 'contain') => void };
}) {
  return (
    <article className={cn('orbit-artslot', shape === 'wide' && 'is-wide')}>
      <div className={cn('orbit-artslot-now', shape === 'wide' ? 'is-wide' : 'is-portrait')}>
        {current ? <img src={current} alt="" /> : <span>{shape === 'wide' ? 'No backdrop yet' : 'No cover yet'}</span>}
      </div>
      <div className="orbit-artslot-main">
        <header className="orbit-artslot-head">
          <h5>{shape === 'portrait' ? 'Cover' : 'Wide backdrop'}</h5>
          <p>{currentLabel}</p>
        </header>
        {fit && (
          <div className="orbit-artslot-fit" role="group" aria-label="How the cover fills a tile">
            {([['auto', 'Auto'], ['cover', 'Fill'], ['contain', 'Fit']] as const).map(([id, label]) => (
              <button key={id} type="button" aria-pressed={fit.value === id} onClick={() => fit.onChange(id)}>
                {label}
              </button>
            ))}
          </div>
        )}
        <ArtworkPicker
          shape={shape}
          title={title}
          current={current}
          load={load}
          onChoose={onChoose}
          onReset={onReset}
          canReset={canReset}
          onUseFile={onUseFile}
        />
      </div>
    </article>
  );
}

function EditSwitch({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="orbit-setrow">
      <div className="orbit-setrow-copy">
        <p className="orbit-setrow-label">{label}</p>
        <p className="orbit-setrow-hint">{hint}</p>
      </div>
      <button type="button" role="switch" aria-label={label} aria-checked={checked} onClick={() => onChange(!checked)} className="orbit-switch" data-on={checked || undefined}>
        <i />
      </button>
    </div>
  );
}
