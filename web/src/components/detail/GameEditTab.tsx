import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Image as ImageIcon, RefreshCw, Trash2 } from 'lucide-react';
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
import { WineSettings } from './WineSettings';
import { desktopOs } from '../../utils/platform';

/**
 * The editor's pages.
 *
 * One page, one question. What the game *is* (its facts and art), how Play
 * starts it, what rides along with a launch, the tools that go in the game's
 * own folder, and where it keeps its progress. Grouping these differently - a
 * page of "launch and tools", a page of "artwork and details" - is what made the
 * old form read like a list of fields rather than a game being described.
 */
type Page = 'game' | 'launch' | 'extra' | 'tools' | 'wine' | 'saves';

/**
 * One game's settings, in the middle of the window.
 *
 * The shape is deliberate, because it stops reading like a form:
 *
 * - **A picture, then the facts, then the controls.** The first thing on the
 *   page is the game itself - its cover and its backdrop, large, side by side -
 *   because "which game am I editing" should be answered by looking, not by
 *   reading the title of a dialog. Under it sits what can be said about the
 *   game in one block of fields, and under that, the switches.
 * - **Four pages, told apart by what they are about**: the game, how it starts,
 *   what runs with it, and where it keeps its progress. No page is a dump of
 *   leftover settings.
 * - **Rows, not a card per field.** A label and its control on one line, in a
 *   grey panel that belongs to a heading. The panel says what the group is
 *   about; the label says what the line is. Nothing else is written.
 * - **It saves itself.** Every field writes half a second after it settles, so
 *   there is no Save button to forget and no Cancel to lose typing to.
 */
export function GameEditTab({ game, onUpdate, hideLaunchSettings = false, saveDir = '', onSaveDir, startOn }: {
  game: Game;
  onUpdate: (patch: Partial<Game>) => void;
  hideLaunchSettings?: boolean;
  saveDir?: string;
  onSaveDir?: (path: string) => void;
  /** The page to open on, for a preview that wants to look at one directly. */
  startOn?: Page | 'proton' | 'actions' | 'artwork';
}) {
  const meta = game.meta;
  const hltb = game.hltb;
  const wineTarget = game.launch.kind === 'wine' ? game.launch : null;
  const [page, setPage] = useState<Page>(() => {
    if (startOn === 'tools') return 'tools';
    if (startOn === 'proton') return 'wine';
    if (startOn === 'actions') return 'extra';
    if (startOn === 'artwork' || startOn === 'game') return 'game';
    return (startOn as Page) ?? 'game';
  });
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

  // A different game is a different page: every field is reseeded rather than
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

  // The ReShade switch is drawn from the folder it is about, so opening the
  // page looks at it rather than at whatever was remembered last time.
  useEffect(() => {
    if (page !== 'launch' || hideLaunchSettings) return;
    let live = true;
    setReshadeBusy(true);
    void getReshadeState(game.id)
      .then((next) => { if (live) setReshadeState(next); })
      .catch((cause: unknown) => say(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => { if (live) setReshadeBusy(false); });
    return () => { live = false; };
  }, [page, game.id, hideLaunchSettings]);

  // A save folder is worth finding once, the first time the page is looked at,
  // and never worth looking for behind the player's back afterwards.
  useEffect(() => {
    if (page !== 'saves' || saveDir.trim() || saveAttempted.current || !isNative()) return;
    saveAttempted.current = true;
    let live = true;
    setSaveBusy(true);
    setSaveError(null);
    void findSave(game.title, saveHintsOf(game))
      .then((found) => {
        if (!live) return;
        if (found) {
          setSavePath(found);
          onSaveDir?.(found);
          return;
        }
        return suggestSaves(game.title).then((suggestions) => {
          if (live) setSaveSuggestions(suggestions);
        });
      })
      .catch((cause: unknown) => {
        if (live) setSaveError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => { if (live) setSaveBusy(false); });
    return () => { live = false; };
  }, [page, game, onSaveDir, saveDir]);

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
  const opened = useRef<string | null>(null);
  if (opened.current === null) opened.current = formSnap;
  const openedTimes = useRef({ main, mainExtra, completionist });
  const timesTouched = main !== openedTimes.current.main
    || mainExtra !== openedTimes.current.mainExtra
    || completionist !== openedTimes.current.completionist;
  const dirtyRef = useRef(false);
  dirtyRef.current = formSnap !== opened.current;

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
    const timer = window.setTimeout(() => commitRef.current(), 500);
    return () => window.clearTimeout(timer);
  }, [formSnap]);

  useEffect(() => {
    return () => {
      if (dirtyRef.current) commitRef.current();
    };
  }, []);

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

  /**
   * The picture at the top of the page.
   *
   * A game page should open on the game's own art, and so does this: the
   * cover and the backdrop are the two things a player recognises a game by, and
   * they are also the two things most often wrong - a cropped capsule, a poster
   * that is a logo. Putting them first makes fixing them one press away, and
   * makes the rest of the page read as facts about the game that is pictured.
   */
  const hero = (
    <div className="orbit-gameart">
      <button
        type="button"
        className="orbit-gameart-cover"
        onClick={() => setSearching('portrait')}
        title="Find another cover"
      >
        {coverShown ? <img src={coverShown} alt="" /> : <span><ImageIcon className="size-4" />No cover</span>}
        <i>Cover</i>
      </button>
      <button
        type="button"
        className="orbit-gameart-wide"
        onClick={() => setSearching('wide')}
        title="Find another backdrop"
      >
        {backdropShown ? <img src={backdropShown} alt="" /> : <span><ImageIcon className="size-4" />No backdrop</span>}
        <i>Backdrop</i>
      </button>
    </div>
  );

  const pages: { id: Page; label: string; hidden?: boolean }[] = [
    { id: 'game', label: 'Game' },
    { id: 'launch', label: 'Launch', hidden: hideLaunchSettings },
    { id: 'extra', label: 'Extra', hidden: hideLaunchSettings },
    { id: 'tools', label: 'Tools', hidden: hideLaunchSettings },
    { id: 'wine', label: 'Wine', hidden: hideLaunchSettings || desktopOs() !== 'linux' },
    { id: 'saves', label: 'Saves' },
  ];

  return (
    <section className="orbit-settings" aria-label={`Settings for ${game.title}`}>
      {hero}

      <header className="orbit-settings-head">
        <input
          className="orbit-settings-title"
          value={title}
          aria-label="Game name"
          onChange={(event) => setTitle(event.target.value)}
          spellCheck={false}
        />
        <div className="orbit-settings-strip">
          <Segmented
            value={status}
            onChange={(value) => setStatus(value as GameStatus)}
            options={[
              { value: 'backlog', label: 'Backlog' },
              { value: 'playing', label: 'Playing' },
              { value: 'completed', label: 'Done' },
              { value: 'dropped', label: 'Dropped' },
            ]}
          />
          <Toggle checked={favorite} onChange={setFavorite} label="Favorite" />
          <span className="orbit-settings-strip-label">Favorite</span>
          <Toggle checked={hidden} onChange={setHidden} label="Hidden from the library" />
          <span className="orbit-settings-strip-label">Hidden</span>
        </div>
      </header>

      <nav className="orbit-settings-tabs" role="tablist" aria-label="Settings pages">
        {pages.filter((entry) => !entry.hidden).map((entry) => (
          <button key={entry.id} type="button" role="tab" aria-selected={page === entry.id} onClick={() => setPage(entry.id)}>
            {entry.label}
          </button>
        ))}
      </nav>

      <div key={page} className="orbit-settings-page" role="tabpanel" data-page={page}>
        {/* ---------------------------------------------------------- game */}
        {page === 'game' && (
          <>
            <Panel title="Details" action={
              <button type="button" className="orbit-btn is-quiet" disabled={looking} onClick={() => void lookup()}>
                <RefreshCw className={cn('size-3.5', looking && 'animate-spin')} />
                {looking ? 'Looking…' : 'Fill empty fields'}
              </button>
            }>
              <Row label="Developer">
                <input className="orbit-input" value={developer} onChange={(event) => setDeveloper(event.target.value)} />
              </Row>
              <Row label="Released">
                <input className="orbit-input" value={releaseYear} onChange={(event) => setReleaseYear(event.target.value)} placeholder="2019" inputMode="numeric" />
              </Row>
              <Row label="Genres">
                <input className="orbit-input" value={genres} onChange={(event) => setGenres(event.target.value)} placeholder="Action, RPG" />
              </Row>
              <Row label="Score">
                <input className="orbit-input" value={rating} onChange={(event) => setRating(event.target.value)} placeholder="Out of 100" inputMode="numeric" />
              </Row>
              <Row label="Size on disk">
                <div className="orbit-unit">
                  <input className="orbit-input" value={sizeGb} onChange={(event) => setSizeGb(event.target.value)} placeholder="12.5" inputMode="decimal" />
                  <span>GB</span>
                </div>
              </Row>
              <Row label="About" stacked>
                <textarea
                  className="orbit-input orbit-textarea"
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                  placeholder="What the game is. The store's own words, or yours."
                />
              </Row>
            </Panel>

            <Panel title="How long it takes" action={
              <button
                type="button"
                className="orbit-btn is-quiet"
                onClick={() => void fetchHltb(title.trim() || game.title).then((found) => {
                  if (!found) return say('HowLongToBeat has no time for that name.');
                  setMain(String(found.main));
                  setMainExtra(String(found.mainExtra));
                  setCompletionist(String(found.completionist));
                  onUpdate({ hltb: found });
                })}
              >
                Ask HowLongToBeat
              </button>
            }>
              <div className="orbit-times">
                <label>
                  <span>Main story</span>
                  <input className="orbit-input" value={main} onChange={(event) => setMain(event.target.value)} inputMode="decimal" placeholder="—" />
                </label>
                <label>
                  <span>Main + extras</span>
                  <input className="orbit-input" value={mainExtra} onChange={(event) => setMainExtra(event.target.value)} inputMode="decimal" placeholder="—" />
                </label>
                <label>
                  <span>Completionist</span>
                  <input className="orbit-input" value={completionist} onChange={(event) => setCompletionist(event.target.value)} inputMode="decimal" placeholder="—" />
                </label>
              </div>
            </Panel>

            <Panel title="Artwork">
              <Row label="Cover">
                <div className="orbit-artline">
                  <div className="orbit-artline-frame is-portrait">
                    {coverShown ? <img src={coverShown} alt="" /> : <span>None</span>}
                  </div>
                  <div className="orbit-artline-copy">
                    <p>{coverPath.trim() ? 'A picture on this machine' : coverUrl.trim() ? 'Chosen earlier' : 'The library’s own art'}</p>
                    <div className="orbit-seg is-small" role="group" aria-label="How the cover fills a tile">
                      {([['auto', 'Auto'], ['cover', 'Fill'], ['contain', 'Fit']] as const).map(([id, label]) => (
                        <button key={id} type="button" aria-pressed={fit === id} onClick={() => setFit(id)}>{label}</button>
                      ))}
                    </div>
                  </div>
                  <div className="orbit-btnrow">
                    <button type="button" className="orbit-btn is-accent" onClick={() => setSearching('portrait')}>Find another</button>
                    {(coverPath || coverUrl) && (
                      <button type="button" className="orbit-btn" onClick={() => { setCoverPath(''); setCoverUrl(''); }}>Library's own</button>
                    )}
                  </div>
                </div>
              </Row>
              <Row label="Wide backdrop">
                <div className="orbit-artline">
                  <div className="orbit-artline-frame is-wide">
                    {backdropShown ? <img src={backdropShown} alt="" /> : <span>None</span>}
                  </div>
                  <div className="orbit-artline-copy">
                    <p>{backdropUrl.trim() ? 'Chosen earlier' : 'The store’s own hero'}</p>
                  </div>
                  <div className="orbit-btnrow">
                    <button type="button" className="orbit-btn is-accent" onClick={() => setSearching('wide')}>Find another</button>
                    {backdropUrl.trim() && (
                      <button type="button" className="orbit-btn" onClick={() => setBackdropUrl('')}>Library's own</button>
                    )}
                  </div>
                </div>
              </Row>
            </Panel>
          </>
        )}

        {/* -------------------------------------------------------- launch */}
        {page === 'launch' && !hideLaunchSettings && (
          <Panel title="How Orbit starts it">
            <LaunchEditor
              game={game}
              saveOnClose
              section="launch"
              onSave={(launch, companions) => onUpdate({ launch, companions })}
            />
            {/* The reshade copy says what it does once. The closing note under
                it explained the same thing a second time, which is the kind of
                paragraph that makes a settings page feel like a manual. */}
          </Panel>
        )}

        {/* ----------------------------------------------------------- extra */}
        {page === 'extra' && !hideLaunchSettings && (
          <Panel title="Runs with the game">
            <LaunchEditor
              game={game}
              saveOnClose
              section="extra"
              onSave={(launch, companions) => onUpdate({ launch, companions })}
            />
          </Panel>
        )}

        {/* ----------------------------------------------------------- tools */}
        {page === 'tools' && !hideLaunchSettings && (
          <Panel title="ReShade">
              {reshade ? (
                <>
                  <Row label={reshade.state === 'on' ? 'On' : reshade.state === 'off' ? 'Off' : 'Not set up'}>
                    <div className="orbit-inline">
                      {reshade.proxy && <span className="orbit-chip">{reshade.proxy}.dll</span>}
                      <Toggle
                        checked={reshade.state === 'on'}
                        disabled={reshadeBusy || !reshade.supported || !reshade.folder}
                        label="Use ReShade with this game"
                        onChange={(next) => {
                          setReshadeBusy(true);
                          void setReshade(game.id, next)
                            .then((state) => {
                              setReshadeState(state);
                              say(next ? 'ReShade is on. Press Home in game to open it.' : 'ReShade is off. The game is as it was.');
                            })
                            .catch((cause: unknown) => say(cause instanceof Error ? cause.message : String(cause)))
                            .finally(() => setReshadeBusy(false));
                        }}
                      />
                    </div>
                  </Row>
                  <Row label="Where" stacked>
                    <p className="orbit-note">
                      {!reshade.supported
                        ? reshade.reason ?? 'ReShade is a Windows graphics tool, so this needs a Windows or Wine game.'
                        : !reshade.folder
                          ? reshade.reason ?? 'Orbit cannot see a folder for this game yet.'
                          : `${reshade.folder}${reshade.backup ? ' · the original file is kept beside it' : ''}`}
                    </p>
                  </Row>
                  {reshade.supported && reshade.folder && (
                    <div className="orbit-panel-foot">
                      <button
                        type="button"
                        className="orbit-btn"
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
                        Use a DLL I already have
                      </button>
                      <button type="button" className="orbit-btn" onClick={() => void revealInExplorer(reshade.folder ?? '')}>
                        Open the folder
                      </button>
                    </div>
                  )}
                  <p className="orbit-note">
                    The original file is kept beside ReShade's, so turning it off puts the game back. Some anti-cheat
                    systems read it as tampering.
                  </p>
                </>
              ) : (
                <p className="orbit-note">{reshadeBusy ? 'Looking at the game folder…' : 'ReShade was not checked.'}</p>
              )}
          </Panel>
        )}

        {/* ---------------------------------------------------------- wine */}
        {page === 'wine' && !hideLaunchSettings && (
          <Panel title="Wine and Proton">
            {wineTarget ? (
              <WineSettings
                proton={wineTarget.proton ?? null}
                tweaks={wineTarget.tweaks}
                onProton={(proton) => onUpdate({ launch: { ...wineTarget, proton } })}
                onTweaks={(tweaks) => onUpdate({ launch: { ...wineTarget, tweaks } })}
              />
            ) : (
              <>
                <p className="orbit-note">This game does not start through Wine, so there is nothing to choose here.</p>
                <div className="orbit-panel-foot">
                  <button type="button" className="orbit-btn" onClick={() => setPage('launch')}>Change how it starts</button>
                </div>
              </>
            )}
          </Panel>
        )}

        {/* --------------------------------------------------------- saves */}
        {page === 'saves' && (
          <>
            <Panel title="Save folder">
              <Row label="Folder" stacked>
                <div className="orbit-inline">
                  <input
                    className="orbit-input"
                    value={savePath}
                    onChange={(event) => { setSavePath(event.target.value); onSaveDir?.(event.target.value); }}
                    placeholder="No save folder found yet"
                    spellCheck={false}
                  />
                  {isNative() && (
                    <button
                      type="button"
                      className="orbit-btn"
                      onClick={() => void pickFolder('Choose this game’s save folder', savePath || undefined).then((path) => {
                        if (path) { setSavePath(path); onSaveDir?.(path); }
                      })}
                    >
                      <FolderOpen className="size-3.5" />
                      Browse
                    </button>
                  )}
                </div>
              </Row>
              <div className="orbit-panel-foot">
                <button
                  type="button"
                  className="orbit-btn is-accent"
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
                  {saveBusy ? 'Searching…' : 'Find it for me'}
                </button>
                {savePath.trim() && (
                  <button type="button" className="orbit-btn" onClick={() => void revealInExplorer(savePath)}>
                    Open the folder
                  </button>
                )}
              </div>
            </Panel>

            {saveSuggestions.length > 0 && (
              <Panel title="PCGamingWiki suggests">
                <div className="orbit-suggestions">
                  {saveSuggestions.map((suggestion) => (
                    <button key={suggestion} type="button" onClick={() => { setSavePath(suggestion); onSaveDir?.(suggestion); }}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              </Panel>
            )}

            {game.installDir && (
              <Panel title="Install">
                <Row label="Folder" stacked>
                  <p className="orbit-note">{game.installDir}{game.sizeBytes > 0 ? ` · ${fmtBytes(game.sizeBytes)}` : ''}</p>
                </Row>
                <div className="orbit-panel-foot">
                  <button type="button" className="orbit-btn" onClick={() => void revealInExplorer(game.installDir!)}>
                    Open the game's folder
                  </button>
                </div>
              </Panel>
            )}

            {saveError && <p role="alert" className="orbit-note is-error">{saveError}</p>}
          </>
        )}
      </div>

      {searching && (
        <ArtworkSearch
          shape={searching}
          title={title.trim() || game.title}
          current={{ portrait: coverShown, wide: backdropShown }}
          onClose={() => setSearching(null)}
          onUseFile={isNative() ? (which) => {
            const wide = which === 'wide';
            void pickAnyFile(wide ? 'Choose a wide backdrop' : 'Choose cover art').then((path) => {
              if (!path) return;
              if (wide) setBackdropUrl(fileSrc(path));
              else setCoverPath(path);
            });
          } : undefined}
          // The dialog stays open after a choice: the next slot is one click
          // away, and a game with a bad cover and a bad backdrop is fixed in one
          // visit rather than two.
          onChoose={(which, url, source) => {
            saveArt(which, url);
            setSearching(which);
            say(`${which === 'portrait' ? 'Cover' : 'Backdrop'} set from ${source}.`);
          }}
          onPickSlot={(which) => setSearching(which)}
          load={(which, query, pageNumber) => {
            // The game's own record is the fastest, most accurate source; a name
            // typed into the box is asked about by name instead.
            if (query === game.title) {
              return which === 'portrait' ? findArtwork(game.id, pageNumber) : findBackdropArtwork(game.id);
            }
            return findArtworkChoices(query, meta?.steamAppId ?? null, pageNumber);
          }}
        />
      )}
    </section>
  );
}

/** A grey panel: a heading with the rows that belong to it. */
function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="orbit-panelbox">
      <header className="orbit-panelbox-head">
        <h3>{title}</h3>
        {action}
      </header>
      {children}
    </section>
  );
}

/** A label and its control: the one row every field is made of. */
function Row({ label, stacked = false, children }: { label: string; stacked?: boolean; children: React.ReactNode }) {
  return (
    <label className={cn('orbit-row2', stacked && 'is-stacked')}>
      <span className="orbit-row2-label">{label}</span>
      <span className="orbit-row2-control">{children}</span>
    </label>
  );
}

/** A row of choices where one is on. */
function Segmented<T extends string>({ value, onChange, options }: {
  value: T;
  onChange: (next: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="orbit-seg" role="group">
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** The switch: an accent pill with a white knob that slides. */
function Toggle({ checked, onChange, label, disabled }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="orbit-toggle"
      data-on={checked || undefined}
    >
      <i />
    </button>
  );
}

/** Kept exported for callers that only wanted the close affordance. */
export const EditRemoveIcon = Trash2;
