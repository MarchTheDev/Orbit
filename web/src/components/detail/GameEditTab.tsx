import { useEffect, useRef, useState } from 'react';
import {
  Boxes,
  Check,
  Clock3,
  FolderOpen,
  Image as ImageIcon,
  Info,
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
import { ArtworkSearch, type ArtShape } from './ArtworkPicker';
import { Select } from '../ui/Select';
import { inputCls } from '../ui/Modal';
import { WineSettings } from './WineSettings';
import { desktopOs } from '../../utils/platform';

type Tab = 'details' | 'launch' | 'artwork' | 'tools' | 'proton' | 'saves';

/**
 * A game's own page, for changing it.
 *
 * The page is one column of rows rather than a stack of cards. A card per
 * subject made every field look like a separate decision and every page look
 * like a form to be filled in; a row is a line you read, with the label on the
 * left and its control on the right, which is how a settings page the player
 * already knows how to use looks.
 *
 * Three rules hold it together:
 *
 * - **It saves itself.** Every field writes a moment after it settles, and
 *   closing the page writes whatever is left. There is no Save button to
 *   forget, and no Cancel to lose an afternoon's typing to.
 * - **Nothing is fetched unasked.** Artwork and completion times are found when
 *   the button that says so is pressed, because both are slow and both are
 *   outside Orbit's control.
 * - **The page is the game's.** What the game has now is on the page before
 *   anything offers to change it.
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
  /** The search that has been opened, and for which slot. */
  const [searching, setSearching] = useState<ArtShape | null>(null);

  const [title, setTitle] = useState(game.title);
  const [summary, setSummary] = useState(meta?.summary ?? '');
  const [developer, setDeveloper] = useState(meta?.developer ?? '');
  const [releaseYear, setReleaseYear] = useState(meta?.releaseYear ? String(meta.releaseYear) : '');
  const [genres, setGenres] = useState((meta?.genres ?? []).join(', '));
  const [rating, setRating] = useState(meta?.rating !== null && meta?.rating !== undefined ? String(meta.rating) : '');
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
    setGenres((game.meta?.genres ?? []).join(', '));
    setRating(game.meta?.rating !== null && game.meta?.rating !== undefined ? String(game.meta.rating) : '');
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
    setSearching(null);
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

  const saveArt = (shape: ArtShape, url: string) => {
    const base = meta ?? { summary: '', genres: [], developer: '', releaseYear: null, rating: null };
    if (shape === 'portrait') {
      setCoverUrl(url);
      setCoverPath('');
      onUpdate({ meta: { ...base, coverUrl: url, coverUrlCustom: true } });
    } else {
      setBackdropUrl(url);
      onUpdate({ meta: { ...base, backgroundUrl: url, backgroundUrlCustom: true } });
    }
  };

  /** The search for one slot, wired to the picture that slot holds. */
  const artworkSearch = searching && (
    <ArtworkSearch
      shape={searching}
      title={title.trim() || game.title}
      current={searching === 'portrait' ? coverShown : backdropShown}
      onClose={() => setSearching(null)}
      onUseFile={
        isNative()
          ? () => {
              const wide = searching === 'wide';
              void pickAnyFile(wide ? 'Choose a wide backdrop' : 'Choose cover art').then((path) => {
                if (!path) return;
                if (wide) setBackdropUrl(fileSrc(path));
                else setCoverPath(path);
                setSearching(null);
              });
            }
          : undefined
      }
      onChoose={(url, source) => {
        saveArt(searching, url);
        setSearching(null);
        say(`${searching === 'portrait' ? 'Cover' : 'Backdrop'} set from ${source}.`);
      }}
      load={(query, page) => {
        // The game's own record is the fastest, most accurate source; a name
        // typed into the box is asked about by name instead.
        if (query === game.title) {
          return searching === 'portrait' ? findArtwork(game.id, page) : findBackdropArtwork(game.id);
        }
        return findArtworkChoices(query, meta?.steamAppId ?? null, page);
      }}
    />
  );

  return (
    <section className="orbit-edit">
      <div className="orbit-edit-tabs" role="tablist" aria-label="Edit game sections">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={shownTab === id} onClick={() => setActiveTab(id)}>
            <Icon className="size-3.5" aria-hidden />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* The pages cross-fade in the direction they are read, so a tab is a
          place that was walked to rather than a block of the form swapped out. */}
      <div key={shownTab} className="orbit-edit-page" data-page={shownTab} role="tabpanel">

        {/* ------------------------------------------------------------ details */}
        {shownTab === 'details' && (
          <>
            <div className="orbit-edit-facts">
              <label className="orbit-row is-span-2">
                <span className="orbit-row-label">Name</span>
                <input className={inputCls} value={title} onChange={(event) => setTitle(event.target.value)} spellCheck={false} />
              </label>
              <label className="orbit-row">
                <span className="orbit-row-label">Developer</span>
                <input className={inputCls} value={developer} onChange={(event) => setDeveloper(event.target.value)} />
              </label>
              <label className="orbit-row">
                <span className="orbit-row-label">Released</span>
                <input className={inputCls} value={releaseYear} onChange={(event) => setReleaseYear(event.target.value)} placeholder="2019" inputMode="numeric" />
              </label>
              <label className="orbit-row">
                <span className="orbit-row-label">Genres</span>
                <input className={inputCls} value={genres} onChange={(event) => setGenres(event.target.value)} placeholder="Action, RPG" />
              </label>
              <label className="orbit-row">
                <span className="orbit-row-label">Score</span>
                <input className={inputCls} value={rating} onChange={(event) => setRating(event.target.value)} placeholder="Out of 100" inputMode="numeric" />
              </label>
            </div>

            <label className="orbit-row is-stacked">
              <span className="orbit-row-label">About</span>
              <textarea
                className={`${inputCls} orbit-edit-about`}
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                placeholder="What the game is. The store's own words, or yours."
              />
            </label>

            <div className="orbit-edit-actions">
              <button type="button" className="orbit-edit-action" disabled={looking} onClick={() => void lookup()}>
                <RotateCcw className={cn('size-3.5', looking && 'animate-spin')} />
                {looking ? 'Looking…' : 'Fill the empty fields from the store'}
              </button>
            </div>

            <div className="orbit-edit-facts">
              <div className="orbit-row">
                <span className="orbit-row-label">Status</span>
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
              </div>
              <label className="orbit-row">
                <span className="orbit-row-label">Size on disk</span>
                <span className="orbit-row-unit">
                  <input className={inputCls} value={sizeGb} onChange={(event) => setSizeGb(event.target.value)} placeholder="12.5" inputMode="decimal" />
                  <i>GB</i>
                </span>
              </label>
            </div>

            <div className="orbit-edit-switches">
              <EditSwitch label="Favorite" checked={favorite} onChange={setFavorite} />
              <EditSwitch label="Hide from the library" checked={hidden} onChange={setHidden} />
            </div>

            {game.installDir && (
              <p className="orbit-edit-path">
                {game.installDir}
                {game.sizeBytes > 0 ? ` · ${fmtBytes(game.sizeBytes)}` : ''}
              </p>
            )}

            {/* Completion times are three numbers and one lookup: a hundred
                pixels of the page, not a section with a heading of its own. */}
            <div className="orbit-edit-times">
              <span className="orbit-edit-times-label"><Clock3 className="size-3.5" />Hours</span>
              <label className="orbit-edit-time">
                <span>Main</span>
                <input className={inputCls} value={main} onChange={(event) => setMain(event.target.value)} inputMode="decimal" />
              </label>
              <label className="orbit-edit-time">
                <span>+ extras</span>
                <input className={inputCls} value={mainExtra} onChange={(event) => setMainExtra(event.target.value)} inputMode="decimal" />
              </label>
              <label className="orbit-edit-time">
                <span>Complete</span>
                <input className={inputCls} value={completionist} onChange={(event) => setCompletionist(event.target.value)} inputMode="decimal" />
              </label>
              <button
                type="button"
                className="orbit-edit-lookup"
                title="Ask HowLongToBeat"
                onClick={() => void fetchHltb(title.trim() || game.title).then((found) => {
                  if (!found) return say('HowLongToBeat has no time for that name.');
                  setMain(String(found.main));
                  setMainExtra(String(found.mainExtra));
                  setCompletionist(String(found.completionist));
                  onUpdate({ hltb: found });
                })}
              >
                <RotateCcw className="size-3.5" />
                Look up
              </button>
            </div>
          </>
        )}

        {/* ------------------------------------------------------------ artwork */}
        {shownTab === 'artwork' && (
          <div className="orbit-artpage">
            <ArtRow
              shape="portrait"
              title="Cover"
              picture={coverShown}
              caption={coverPath.trim() ? 'A picture on this machine' : coverUrl.trim() ? 'Chosen earlier' : 'The library’s own art'}
              custom={Boolean(coverPath.trim() || coverUrl.trim())}
              onSearch={() => setSearching('portrait')}
              onReset={() => { setCoverPath(''); setCoverUrl(''); }}
            >
              <div className="orbit-artpage-fit" role="group" aria-label="How the cover fills a tile">
                {([['auto', 'Auto'], ['cover', 'Fill'], ['contain', 'Fit']] as const).map(([id, label]) => (
                  <button key={id} type="button" aria-pressed={fit === id} onClick={() => setFit(id)}>{label}</button>
                ))}
              </div>
            </ArtRow>

            <ArtRow
              shape="wide"
              title="Wide backdrop"
              picture={backdropShown}
              caption={backdropUrl.trim() ? 'Chosen earlier' : 'The store’s own hero'}
              custom={Boolean(backdropUrl.trim())}
              onSearch={() => setSearching('wide')}
              onReset={() => setBackdropUrl('')}
            />
          </div>
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
          <div className="orbit-toolspage">
            {reshade ? (
              <>
                <div className="orbit-row is-stacked">
                  <div className="orbit-reshade-row">
                    <div className="min-w-0">
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
                              ? `${reshade.folder}${reshade.backup ? ' · the original file is kept beside it' : ''}`
                              : reshade.state === 'off'
                                ? 'The game starts exactly as it did before.'
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
                </div>

                {reshade.supported && reshade.folder && (
                  <div className="orbit-edit-actions">
                    <button
                      type="button"
                      className="orbit-edit-action"
                      disabled={reshadeBusy}
                      onClick={() => void pickFile('Choose a ReShade DLL you already have', ['dll'], undefined).then((path) => {
                        if (!path) return;
                        setReshadeBusy(true);
                        void useReshadeFile(game.id, path)
                          .then((state) => setReshadeState(state))
                          .catch((cause: unknown) => say(cause instanceof Error ? cause.message : String(cause)))
                          .finally(() => setReshadeBusy(false));
                      })}
                    >
                      Use a ReShade DLL I already have
                    </button>
                    <button type="button" className="orbit-edit-action" onClick={() => void revealInExplorer(reshade.folder ?? '')}>
                      <FolderOpen className="size-3.5" />
                      Open the game's folder
                    </button>
                  </div>
                )}

                <p className="orbit-edit-hint">
                  Turning it on downloads ReShade once and installs it into the game's own folder. Some anti-cheat
                  systems read it as tampering, so it is worth checking the game's rules before using it online.
                </p>
              </>
            ) : (
              <p className="orbit-edit-hint">{reshadeBusy ? 'Looking at the game folder…' : 'ReShade was not checked.'}</p>
            )}
          </div>
        )}

        {/* ------------------------------------------------------------- proton */}
        {shownTab === 'proton' && !hideLaunchSettings && (
          wineTarget ? (
            <WineSettings
              proton={wineTarget.proton ?? null}
              tweaks={wineTarget.tweaks}
              onProton={(proton) => onUpdate({ launch: { ...wineTarget, proton } })}
              onTweaks={(tweaks) => onUpdate({ launch: { ...wineTarget, tweaks } })}
            />
          ) : (
            <div className="orbit-edit-nudge">
              <p className="orbit-edit-nudge-title">This game does not start through Wine yet</p>
              <p className="orbit-edit-hint">Proton builds appear once the game is launched as a Windows program.</p>
              <button type="button" className="orbit-edit-action" onClick={() => setActiveTab('launch')}>Open Launch</button>
            </div>
          )
        )}

        {/* -------------------------------------------------------------- saves */}
        {shownTab === 'saves' && (
          <>
            <label className="orbit-row is-stacked">
              <span className="orbit-row-label">Save folder</span>
              <span className="orbit-edit-row">
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
                    className="orbit-edit-action"
                    onClick={() => void pickFolder('Choose this game’s save folder', savePath || undefined).then((path) => {
                      if (path) { setSavePath(path); onSaveDir?.(path); }
                    })}
                  >
                    Browse
                  </button>
                )}
              </span>
            </label>
            <div className="orbit-edit-actions">
              <button
                type="button"
                className="orbit-edit-action"
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
                <button type="button" className="orbit-edit-action" onClick={() => void revealInExplorer(savePath)}>
                  Open folder
                </button>
              )}
            </div>
            {saveSuggestions.length > 0 && (
              <div className="orbit-edit-suggestions">
                {saveSuggestions.map((suggestion) => (
                  <button key={suggestion} type="button" className="orbit-edit-suggestion" onClick={() => { setSavePath(suggestion); onSaveDir?.(suggestion); }}>
                    <Check className="size-3" />
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
            {saveError && <p role="alert" className="orbit-edit-error">{saveError}</p>}
          </>
        )}
      </div>

      {artworkSearch}
    </section>
  );
}

/**
 * One slot's artwork, as a row.
 *
 * The picture the game has now, in its own shape, then the two things worth
 * doing to it: look for another one, or go back to what the library would draw.
 * Everything about searching lives in the dialog that opens from here.
 */
function ArtRow({
  shape,
  title,
  picture,
  caption,
  custom,
  onSearch,
  onReset,
  children,
}: {
  shape: ArtShape;
  title: string;
  picture: string | null;
  caption: string;
  custom: boolean;
  onSearch: () => void;
  onReset: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn('orbit-artrow', shape === 'wide' && 'is-wide')}>
      <div className={cn('orbit-artrow-frame', shape === 'wide' ? 'is-wide' : 'is-portrait')}>
        {picture ? <img src={picture} alt="" /> : <span>{shape === 'wide' ? 'No backdrop yet' : 'No cover yet'}</span>}
      </div>
      <div className="orbit-artrow-main">
        <p className="orbit-artrow-title">{title}</p>
        <p className="orbit-artrow-caption">{caption}</p>
        {children}
        <div className="orbit-artrow-actions">
          <button type="button" className="orbit-edit-action is-primary" onClick={onSearch}>
            <ImageIcon className="size-3.5" />
            Find another
          </button>
          {custom && (
            <button type="button" className="orbit-edit-action" onClick={onReset}>
              Use the library's own
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * A switch with its name beside it, and nothing else.
 *
 * A description under every switch is a paragraph nobody reads twice; the two
 * that need one say it in the sentence above the pair instead.
 */
function EditSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="orbit-edit-toggle">
      <span>{label}</span>
      <span className="orbit-switch" data-on={checked || undefined} aria-hidden>
        <i />
      </span>
    </button>
  );
}
