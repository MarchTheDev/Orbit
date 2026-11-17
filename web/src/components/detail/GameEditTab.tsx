import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
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

type Tab = 'game' | 'actions' | 'launch' | 'tools' | 'proton' | 'saves';

/** Every page, in the order they are read. */
const PAGES: { id: Tab; label: string }[] = [
  { id: 'game', label: 'Game' },
  { id: 'actions', label: 'Play' },
  { id: 'launch', label: 'Launch' },
  { id: 'tools', label: 'Tools' },
  { id: 'proton', label: 'Wine' },
  { id: 'saves', label: 'Saves' },
];

/**
 * A game's settings, as a drawer beside the library.
 *
 * The shape is Heronite's, because it is the one that stops feeling like a form:
 *
 * - **A drawer, not a dialog.** It slides in from the right at the height of the
 *   window, with the library still visible on its left. Looking something up -
 *   "what did the store say this was called" - no longer means losing the game
 *   you were looking at, and the page is a place you are in rather than a modal
 *   you are trapped in.
 * - **A rail of pages, not a row of tabs.** Each page is a name and a one-word
 *   summary of what it holds, so the shape of the whole game is visible at once
 *   and the page you want is one click, not a hunt through a tab strip.
 * - **Fields in grey panels of rows.** A field is a label and its control, in a
 *   block that belongs to its heading. No numbered sections, no paragraph of
 *   explanation before every group: the label says what it is, and the panel
 *   says what it is about.
 * - **It saves itself.** Every field writes a moment after it settles. There is
 *   no Save button, because there is nothing to save: the game is already
 *   updated by the time the pointer leaves the field.
 *
 * The artwork slots follow the same logic as the covers dialog: a slot per
 * shape, showing the picture it has now, with a way into the search for a
 * better one.
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
  const [page, setPage] = useState<Tab>(startOn ?? 'game');
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

  // A different game is a different drawer: every field is reseeded rather than
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
    if (page !== 'tools') return;
    let live = true;
    setReshadeBusy(true);
    void getReshadeState(game.id)
      .then((next) => { if (live) setReshadeState(next); })
      .catch((cause: unknown) => say(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => { if (live) setReshadeBusy(false); });
    return () => { live = false; };
  }, [page, game.id]);

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

  const pages = PAGES.filter((entry) => {
    if (entry.id === 'launch' || entry.id === 'tools') return !hideLaunchSettings;
    if (entry.id === 'proton') return !hideLaunchSettings && desktopOs() === 'linux';
    return true;
  });
  const shown = pages.some((entry) => entry.id === page) ? page : 'game';

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

  /** What the library page needs to know about this game, at the top of the rail. */
  const facts = [
    game.meta?.releaseYear ? String(game.meta.releaseYear) : null,
    game.sizeBytes > 0 ? fmtBytes(game.sizeBytes) : null,
    game.playSecs > 0 ? `${Math.round(game.playSecs / 3600)}h played` : null,
  ].filter(Boolean).join(' · ');

  return (
    <div className="orbit-drawer">
      <nav className="orbit-drawerrail" aria-label="Game settings pages">
        <div className="orbit-drawer-card">
          <div className="orbit-drawer-poster">
            {coverShown ? <img src={coverShown} alt="" /> : <span>{game.title.slice(0, 1)}</span>}
          </div>
          <p className="orbit-drawer-title">{title.trim() || game.title}</p>
          {facts && <p className="orbit-drawer-facts">{facts}</p>}
        </div>

        <div className="orbit-drawer-pages" role="tablist" aria-orientation="vertical">
          {pages.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={shown === entry.id}
              onClick={() => setPage(entry.id)}
            >
              <span>{entry.label}</span>
              <i>{PAGE_HINT[entry.id]}</i>
            </button>
          ))}
        </div>
      </nav>

      <div key={shown} className="orbit-drawer-page" role="tabpanel" data-page={shown}>
        {/* ------------------------------------------------------------ game */}
        {shown === 'game' && (
          <>
            <Section title="What it is">
              <Field label="Name">
                <input className="orbit-input" value={title} onChange={(event) => setTitle(event.target.value)} spellCheck={false} />
              </Field>
              <Field label="Developer">
                <input className="orbit-input" value={developer} onChange={(event) => setDeveloper(event.target.value)} />
              </Field>
              <Field label="Released">
                <input className="orbit-input" value={releaseYear} onChange={(event) => setReleaseYear(event.target.value)} placeholder="2019" inputMode="numeric" />
              </Field>
              <Field label="Genres">
                <input className="orbit-input" value={genres} onChange={(event) => setGenres(event.target.value)} placeholder="Action, RPG" />
              </Field>
              <Field label="Score">
                <input className="orbit-input" value={rating} onChange={(event) => setRating(event.target.value)} placeholder="Out of 100" inputMode="numeric" />
              </Field>
              <Field label="About" stacked>
                <textarea
                  className="orbit-input orbit-textarea"
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                  placeholder="What the game is. The store's own words, or yours."
                />
              </Field>
              <Foot>
                <button type="button" className="orbit-pill" disabled={looking} onClick={() => void lookup()}>
                  {looking ? 'Looking…' : 'Fill the empty fields from the store'}
                </button>
              </Foot>
            </Section>

            <Section title="In the library">
              <Field label="Status">
                <Segmented
                  value={status}
                  onChange={(value) => setStatus(value as GameStatus)}
                  options={[
                    { value: 'backlog', label: 'Backlog' },
                    { value: 'playing', label: 'Playing' },
                    { value: 'completed', label: 'Completed' },
                    { value: 'dropped', label: 'Dropped' },
                  ]}
                />
              </Field>
              <Field label="Size on disk">
                <div className="orbit-unit">
                  <input className="orbit-input" value={sizeGb} onChange={(event) => setSizeGb(event.target.value)} placeholder="12.5" inputMode="decimal" />
                  <span>GB</span>
                </div>
              </Field>
              <Field label="Favorite">
                <Toggle checked={favorite} onChange={setFavorite} label="Favorite" />
              </Field>
              <Field label="Hidden">
                <Toggle checked={hidden} onChange={setHidden} label="Hide from the library" />
              </Field>
            </Section>

            <Section title="How long it takes" aside="Hours">
              <Field label="Main story">
                <input className="orbit-input" value={main} onChange={(event) => setMain(event.target.value)} inputMode="decimal" placeholder="—" />
              </Field>
              <Field label="Main + extras">
                <input className="orbit-input" value={mainExtra} onChange={(event) => setMainExtra(event.target.value)} inputMode="decimal" placeholder="—" />
              </Field>
              <Field label="Completionist">
                <input className="orbit-input" value={completionist} onChange={(event) => setCompletionist(event.target.value)} inputMode="decimal" placeholder="—" />
              </Field>
              <Foot>
                <button
                  type="button"
                  className="orbit-pill"
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
              </Foot>
            </Section>
          </>
        )}

        {/* --------------------------------------------------------- artwork */}
        {shown === 'game' && (
          <Section title="Artwork">
            <Slot
              shape="portrait"
              name="Cover"
              picture={coverShown}
              caption={coverPath.trim() ? 'A picture on this machine' : coverUrl.trim() ? 'Chosen earlier' : 'The library’s own art'}
              custom={Boolean(coverPath.trim() || coverUrl.trim())}
              onSearch={() => setSearching('portrait')}
              onReset={() => { setCoverPath(''); setCoverUrl(''); }}
              extra={
                <div className="orbit-seg is-small" role="group" aria-label="How the cover fills a tile">
                  {([['auto', 'Auto'], ['cover', 'Fill'], ['contain', 'Fit']] as const).map(([id, label]) => (
                    <button key={id} type="button" aria-pressed={fit === id} onClick={() => setFit(id)}>{label}</button>
                  ))}
                </div>
              }
            />
            <Slot
              shape="wide"
              name="Wide backdrop"
              picture={backdropShown}
              caption={backdropUrl.trim() ? 'Chosen earlier' : 'The store’s own hero'}
              custom={Boolean(backdropUrl.trim())}
              onSearch={() => setSearching('wide')}
              onReset={() => setBackdropUrl('')}
            />
          </Section>
        )}

        {/* ----------------------------------------------------------- play */}
        {shown === 'actions' && (
          <>
            {game.installDir && (
              <Section title="Install">
                <Field label="Folder" stacked>
                  <div className="orbit-inline">
                    <input className="orbit-input" value={game.installDir} readOnly spellCheck={false} />
                    <button type="button" className="orbit-pill" onClick={() => void revealInExplorer(game.installDir!)}>
                      Open
                    </button>
                  </div>
                </Field>
                {game.sizeBytes > 0 && <Field label="On disk"><p className="orbit-value">{fmtBytes(game.sizeBytes)}</p></Field>}
              </Section>
            )}

            <Section title="Progress">
              <Field label="Status">
                <Segmented
                  value={status}
                  onChange={(value) => setStatus(value as GameStatus)}
                  options={[
                    { value: 'backlog', label: 'Backlog' },
                    { value: 'playing', label: 'Playing' },
                    { value: 'completed', label: 'Completed' },
                    { value: 'dropped', label: 'Dropped' },
                  ]}
                />
              </Field>
              <Field label="Played">
                <p className="orbit-value">
                  {game.playSecs > 0 ? `${(game.playSecs / 3600).toFixed(1)} hours` : 'Never started from Orbit'}
                  {game.lastPlayed ? ` · last on ${new Date(game.lastPlayed).toLocaleDateString()}` : ''}
                </p>
              </Field>
              {hltb && (
                <Field label="Story left">
                  <p className="orbit-value">
                    {Math.max(0, hltb.main - game.playSecs / 3600).toFixed(1)} of {hltb.main} hours
                  </p>
                </Field>
              )}
            </Section>
          </>
        )}

        {/* --------------------------------------------------------- launch */}
        {shown === 'launch' && !hideLaunchSettings && (
          <Section title="How Orbit starts it" bare>
            <LaunchEditor
              game={game}
              saveOnClose
              section="launch"
              onSave={(launch, companions) => onUpdate({ launch, companions })}
            />
          </Section>
        )}

        {/* ---------------------------------------------------------- tools */}
        {shown === 'tools' && !hideLaunchSettings && (
          <Section title="ReShade">
            {reshade ? (
              <>
                <Field label={reshade.state === 'on' ? 'On' : reshade.state === 'off' ? 'Off' : 'Not set up'}>
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
                </Field>
                <Field label="Where" stacked>
                  <p className="orbit-note">
                    {!reshade.supported
                      ? reshade.reason ?? 'ReShade is a Windows graphics tool, so this needs a Windows or Wine game.'
                      : !reshade.folder
                        ? reshade.reason ?? 'Orbit cannot see a folder for this game yet.'
                        : `${reshade.folder}${reshade.backup ? ' · the original file is kept beside it' : ''}`}
                  </p>
                </Field>
                {reshade.supported && reshade.folder && (
                  <Foot>
                    <button
                      type="button"
                      className="orbit-pill"
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
                    <button type="button" className="orbit-pill" onClick={() => void revealInExplorer(reshade.folder ?? '')}>
                      Open the game's folder
                    </button>
                  </Foot>
                )}
                <p className="orbit-note">
                  Turning it on downloads ReShade once into the game's own folder. Some anti-cheat systems read it as
                  tampering, so check the game's rules before using it online.
                </p>
              </>
            ) : (
              <p className="orbit-note">{reshadeBusy ? 'Looking at the game folder…' : 'ReShade was not checked.'}</p>
            )}
          </Section>
        )}

        {/* --------------------------------------------------------- proton */}
        {shown === 'proton' && !hideLaunchSettings && (
          <Section title="Wine and Proton">
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
                <Foot>
                  <button type="button" className="orbit-pill" onClick={() => setPage('launch')}>
                    Make it a Windows program instead
                  </button>
                </Foot>
              </>
            )}
          </Section>
        )}

        {/* ---------------------------------------------------------- saves */}
        {shown === 'saves' && (
          <Section title="Save folder">
            <Field label="Folder" stacked>
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
                    className="orbit-pill"
                    onClick={() => void pickFolder('Choose this game’s save folder', savePath || undefined).then((path) => {
                      if (path) { setSavePath(path); onSaveDir?.(path); }
                    })}
                  >
                    Browse
                  </button>
                )}
              </div>
            </Field>
            <Foot>
              <button
                type="button"
                className="orbit-pill"
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
                <button type="button" className="orbit-pill" onClick={() => void revealInExplorer(savePath)}>
                  Open the folder
                </button>
              )}
            </Foot>
            {saveSuggestions.length > 0 && (
              <Field label="PCGamingWiki suggests" stacked>
                <div className="orbit-suggestions">
                  {saveSuggestions.map((suggestion) => (
                    <button key={suggestion} type="button" onClick={() => { setSavePath(suggestion); onSaveDir?.(suggestion); }}>
                      {suggestion}
                    </button>
                  ))}
                </div>
              </Field>
            )}
            {saveError && <p role="alert" className="orbit-note is-error">{saveError}</p>}
          </Section>
        )}
      </div>

      {/* The artwork search, over the drawer, in its own room. */}
      {searching && (
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
          load={(query, pageNumber) => {
            // The game's own record is the fastest, most accurate source; a name
            // typed into the box is asked about by name instead.
            if (query === game.title) {
              return searching === 'portrait' ? findArtwork(game.id, pageNumber) : findBackdropArtwork(game.id);
            }
            return findArtworkChoices(query, meta?.steamAppId ?? null, pageNumber);
          }}
        />
      )}
    </div>
  );
}

const PAGE_HINT: Record<Tab, string> = {
  game: 'Name, art, times',
  actions: 'Library facts',
  launch: 'Program, tools',
  tools: 'ReShade',
  proton: 'On Linux',
  saves: 'Where progress lives',
};

/** A grey panel of rows under a small heading. */
function Section({ title, aside, bare = false, children }: { title: string; aside?: string; bare?: boolean; children: React.ReactNode }) {
  return (
    <section className={cn('orbit-slab', bare && 'is-bare')}>
      <header className="orbit-slab-head">
        <h3>{title}</h3>
        {aside && <span>{aside}</span>}
      </header>
      {children}
    </section>
  );
}

/** A label and its control: the row every field is made of. */
function Field({ label, stacked = false, children }: { label: string; stacked?: boolean; children: React.ReactNode }) {
  return (
    <label className={cn('orbit-field', stacked && 'is-stacked')}>
      <span className="orbit-field-label">{label}</span>
      <span className="orbit-field-control">{children}</span>
    </label>
  );
}

/** The row of buttons a panel ends with. */
function Foot({ children }: { children: React.ReactNode }) {
  return <div className="orbit-slab-foot">{children}</div>;
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

/** Heronite's switch: an accent pill with a white knob that slides. */
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

/** One picture slot: what it shows now, and the way to change it. */
function Slot({ shape, name, picture, caption, custom, onSearch, onReset, extra }: {
  shape: ArtShape;
  name: string;
  picture: string | null;
  caption: string;
  custom: boolean;
  onSearch: () => void;
  onReset: () => void;
  extra?: React.ReactNode;
}) {
  return (
    <div className={cn('orbit-slot', shape === 'wide' && 'is-wide')}>
      <div className={cn('orbit-slot-picture', shape === 'wide' ? 'is-wide' : 'is-portrait')}>
        {picture ? <img src={picture} alt="" /> : <span>{shape === 'wide' ? 'None' : 'None'}</span>}
      </div>
      <div className="orbit-slot-body">
        <p className="orbit-field-label">{name}</p>
        <p className="orbit-note">{caption}</p>
        {extra}
        <div className="orbit-slab-foot">
          <button type="button" className="orbit-pill is-accent" onClick={onSearch}>Find another</button>
          {custom && <button type="button" className="orbit-pill" onClick={onReset}>Use the library's own</button>}
        </div>
      </div>
    </div>
  );
}

/**
 * The drawer's backdrop: a dim of the library, and the frame around it.
 *
 * It is a sibling of the page rather than a wrapper, so pressing the dimmed
 * library closes the drawer and pressing the drawer does not.
 */
export function EditDrawerFrame({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (document.querySelector('[data-overlay-hit]')) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div className="orbit-drawerwrap" data-overlay-hit="1" role="dialog" aria-modal="true" aria-label="Game settings">
      <button type="button" tabIndex={-1} aria-label="Close game settings" className="orbit-drawer-scrim" onClick={onClose} />
      <div className="orbit-drawer-panel">
        <button type="button" className="orbit-drawer-close" onClick={onClose} aria-label="Close">
          <X className="size-4" />
        </button>
        {children}
      </div>
    </div>,
    document.body,
  );
}
