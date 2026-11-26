import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, FolderOpen, Image as ImageIcon, RefreshCw, Search, Star, Trash2 } from 'lucide-react';
import type { Game, HltbData, MetaData } from '../../types';
import {
  findArtwork,
  findArtworkChoices,
  findBackdropArtwork,
  findSave,
  findWebWideArt,
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
import { fetchMetadata, searchGames } from '../../services/metadata';
import { baseMeta } from '../../utils/metadataMerge';
import { fmtBytes } from '../../utils/format';
import { cn } from '../../utils/cn';
import { LaunchEditor } from './LaunchEditor';
import { ArtworkSearch, type ArtShape } from './ArtworkPicker';
import { WineSettings } from './WineSettings';
import { desktopOs } from '../../utils/platform';
import { draftFromGame, launchProblems, normalizeDraft, type LaunchDraft } from '../../utils/launchProfiles';

/**
 * One game's settings, as a small page with a Save button.
 *
 * The old editor saved every keystroke on a timer, which made a half-typed
 * launch option live before it was valid and made "did that apply?" a guessing
 * game. This one keeps a draft, says when it is dirty, and writes once when the
 * player asks. Metadata is field-level: refreshing fills what the player has not
 * corrected, and correcting a field locks just that field.
 *
 * The picture comes first — cover and backdrop, large, side by side — because
 * "which game am I editing" should be answered by looking. Under it the name and
 * what it is matched to, then a few pages told apart by what they are about.
 */

type Page = 'game' | 'launch' | 'tools' | 'wine' | 'saves';

const GAME_GENRES = [
  'Action', 'Adventure', 'Arcade', 'Board game', 'Card game', 'Fighting', 'Horror',
  'Indie', 'Music', 'Platformer', 'Puzzle', 'Racing', 'Role-playing', 'Shooter',
  'Simulation', 'Sports', 'Strategy', 'Survival', 'Visual novel',
];

export function GameEditTab({
  game,
  onUpdate,
  hideLaunchSettings = false,
  saveDir = '',
  onSaveDir,
  startOn,
  onDirtyChange,
  registerSave,
}: {
  game: Game;
  onUpdate: (patch: Partial<Game>) => void;
  hideLaunchSettings?: boolean;
  saveDir?: string;
  onSaveDir?: (path: string) => void;
  startOn?: Page | 'proton' | 'actions' | 'artwork' | 'extra';
  onDirtyChange?: (dirty: boolean) => void;
  registerSave?: (save: () => boolean) => void;
}) {
  const initialMeta = baseMeta(game.meta);
  const [page, setPage] = useState<Page>(() => {
    if (startOn === 'tools') return 'tools';
    if (startOn === 'proton') return 'wine';
    if (startOn === 'actions' || startOn === 'extra') return 'launch';
    if (startOn === 'artwork' || startOn === 'game') return 'game';
    return (startOn as Page) ?? 'game';
  });

  const [title, setTitle] = useState(game.title);
  const [summary, setSummary] = useState(initialMeta.summary);
  const [developer, setDeveloper] = useState(initialMeta.developer);
  const [releaseYear, setReleaseYear] = useState(initialMeta.releaseYear ? String(initialMeta.releaseYear) : '');
  const [genres, setGenres] = useState((initialMeta.genres ?? [])[0] ?? '');
  const [customGenre, setCustomGenre] = useState(() => Boolean(initialMeta.genres?.[0] && !GAME_GENRES.includes(initialMeta.genres[0])));
  const [rating, setRating] = useState(initialMeta.rating != null ? String(initialMeta.rating) : '');
  const [sizeGb, setSizeGb] = useState(game.sizeBytes > 0 ? String(Math.round((game.sizeBytes / 1e9) * 10) / 10) : '');
  const [favorite, setFavorite] = useState(game.favorite);
  const [hidden, setHidden] = useState(!!game.hidden);
  const [main, setMain] = useState(game.hltb ? String(game.hltb.main) : '');
  const [mainExtra, setMainExtra] = useState(game.hltb ? String(game.hltb.mainExtra) : '');
  const [completionist, setCompletionist] = useState(game.hltb ? String(game.hltb.completionist) : '');
  const [coverUrl, setCoverUrl] = useState(initialMeta.coverUrl ?? '');
  const [backdropUrl, setBackdropUrl] = useState(initialMeta.backgroundUrl ?? '');
  const [coverPath, setCoverPath] = useState(game.coverPath ?? '');
  const [fit, setFit] = useState<'auto' | 'cover' | 'contain'>(initialMeta.coverFit ?? 'auto');
  const [steamAppId, setSteamAppId] = useState<number | null>(initialMeta.steamAppId ?? null);
  const [matchTitle, setMatchTitle] = useState<string | null>(initialMeta.matchTitle ?? initialMeta.name ?? null);
  const [locked, setLocked] = useState<Set<string>>(() => new Set(initialMeta.lockedFields ?? []));
  const [fieldSources, setFieldSources] = useState<Record<string, string>>(initialMeta.fieldSources ?? {});
  const [launchDraft, setLaunchDraft] = useState<LaunchDraft>(() => draftFromGame(game));
  const [launchErrors, setLaunchErrors] = useState<string[]>([]);

  const [looking, setLooking] = useState(false);
  const [matching, setMatching] = useState(false);
  const [matchQuery, setMatchQuery] = useState('');
  const [matches, setMatches] = useState<{ appId: number; name: string; coverUrl: string | null }[]>([]);
  const [searching, setSearching] = useState<ArtShape | null>(null);
  const [reshade, setReshadeState] = useState<ReshadeState | null>(null);
  const [reshadeBusy, setReshadeBusy] = useState(false);
  const [savePath, setSavePath] = useState(saveDir);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuggestions, setSaveSuggestions] = useState<string[]>([]);
  const saveAttempted = useRef(false);

  const lock = useCallback((field: string) => {
    setLocked((have) => {
      if (have.has(field)) return have;
      const next = new Set(have);
      next.add(field);
      return next;
    });
  }, []);

  const baseline = useMemo(() => JSON.stringify({
    title: game.title, summary: initialMeta.summary, developer: initialMeta.developer,
    releaseYear: initialMeta.releaseYear ? String(initialMeta.releaseYear) : '',
    genres: (initialMeta.genres ?? [])[0] ?? '', rating: initialMeta.rating != null ? String(initialMeta.rating) : '',
    sizeGb: game.sizeBytes > 0 ? String(Math.round((game.sizeBytes / 1e9) * 10) / 10) : '',
    favorite: game.favorite, hidden: !!game.hidden,
    main: game.hltb ? String(game.hltb.main) : '', mainExtra: game.hltb ? String(game.hltb.mainExtra) : '', completionist: game.hltb ? String(game.hltb.completionist) : '',
    coverUrl: initialMeta.coverUrl ?? '', backdropUrl: initialMeta.backgroundUrl ?? '', coverPath: game.coverPath ?? '',
    fit: initialMeta.coverFit ?? 'auto', steamAppId: initialMeta.steamAppId ?? null,
    launch: draftFromGame(game), locked: [...(initialMeta.lockedFields ?? [])].sort(),
  }), [game, initialMeta]);

  const snapshot = JSON.stringify({
    title, summary, developer, releaseYear, genres, rating, sizeGb, favorite, hidden,
    main, mainExtra, completionist, coverUrl, backdropUrl, coverPath, fit, steamAppId,
    launch: launchDraft, locked: [...locked].sort(),
  });
  const dirty = snapshot !== baseline;

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const hours = (value: string): number | null => {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed.replace(',', '.'));
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const commit = useCallback((): boolean => {
    if (!hideLaunchSettings) {
      const problems = launchProblems(launchDraft);
      if (problems.length > 0) {
        setLaunchErrors(problems.map((problem) => problem.message));
        setPage('launch');
        return false;
      }
    }
    const nextMeta: MetaData = {
      ...initialMeta,
      name: title.trim() || game.title,
      summary: summary.trim(),
      developer: developer.trim(),
      releaseYear: releaseYear.trim() === '' ? null : Number(releaseYear) || null,
      rating: rating.trim() === '' ? null : Number(rating) || null,
      genres: genres.trim() ? [genres.trim()] : [],
      coverUrl: coverUrl.trim() || null,
      backgroundUrl: backdropUrl.trim() || null,
      coverUrlCustom: Boolean(coverUrl.trim()) && (initialMeta.coverUrlCustom === true || coverUrl.trim() !== (initialMeta.coverUrl ?? '')),
      backgroundUrlCustom: Boolean(backdropUrl.trim()) && (initialMeta.backgroundUrlCustom === true || backdropUrl.trim() !== (initialMeta.backgroundUrl ?? '')),
      coverFit: fit === 'auto' ? undefined : fit,
      steamAppId,
      matchTitle,
      lockedFields: [...locked],
      fieldSources,
      edited: locked.size > 0,
    };
    const hoursIn = [hours(main), hours(mainExtra), hours(completionist)];
    const nextHltb: HltbData | null = hoursIn.every((value) => value === null) ? null : {
      main: hoursIn[0] ?? 0, mainExtra: hoursIn[1] ?? 0, completionist: hoursIn[2] ?? 0, source: 'hltb',
    };
    const gb = Number(sizeGb.replace(',', '.'));
    const cleanLaunch = normalizeDraft(launchDraft);
    onUpdate({
      title: title.trim() || game.title,
      favorite,
      hidden,
      coverPath: coverPath.trim() || null,
      sizeBytes: Number.isFinite(gb) && gb > 0 ? Math.round(gb * 1e9) : 0,
      sizeGb: Number.isFinite(gb) && gb > 0 ? gb : 0,
      meta: nextMeta,
      ...(nextHltb ? { hltb: nextHltb } : {}),
      ...(hideLaunchSettings ? {} : { launch: cleanLaunch.launch, companions: cleanLaunch.companions }),
    });
    setLaunchErrors([]);
    say('Game settings saved');
    return true;
  }, [hideLaunchSettings, launchDraft, initialMeta, title, game.title, summary, developer, releaseYear, rating, genres, coverUrl, backdropUrl, fit, steamAppId, matchTitle, locked, fieldSources, main, mainExtra, completionist, sizeGb, favorite, hidden, coverPath, onUpdate]);

  useEffect(() => { registerSave?.(commit); }, [commit, registerSave]);

  // ReShade and save-folder discovery are native operations, not draft fields;
  // they keep their own immediate behaviour.
  useEffect(() => {
    if (page !== 'tools' || hideLaunchSettings) return;
    let live = true;
    setReshadeBusy(true);
    void getReshadeState(game.id)
      .then((next) => { if (live) setReshadeState(next); })
      .catch((cause: unknown) => say(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => { if (live) setReshadeBusy(false); });
    return () => { live = false; };
  }, [page, game.id, hideLaunchSettings]);

  useEffect(() => { setSavePath(saveDir); }, [game.id, saveDir]);
  useEffect(() => {
    if (page !== 'saves' || saveDir.trim() || saveAttempted.current || !isNative()) return;
    saveAttempted.current = true;
    let live = true;
    setSaveBusy(true);
    setSaveError(null);
    void findSave(game.title, saveHintsOf(game))
      .then((found) => {
        if (!live) return;
        if (found) { setSavePath(found); onSaveDir?.(found); return; }
        return suggestSaves(game.title).then((suggestions) => { if (live) setSaveSuggestions(suggestions); });
      })
      .catch((cause: unknown) => { if (live) setSaveError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (live) setSaveBusy(false); });
    return () => { live = false; };
  }, [page, game, onSaveDir, saveDir]);

  const applyFound = useCallback((found: MetaData, appId: number | null) => {
    const fill = (field: string, value: string | null | undefined, set: (value: string) => void) => {
      if (locked.has(field) || !value) return;
      set(value);
      const source = found.fieldSources?.[field] ?? found.source;
      if (source) setFieldSources((have) => ({ ...have, [field]: source }));
    };
    fill('summary', found.summary, setSummary);
    fill('developer', found.developer, setDeveloper);
    fill('releaseYear', found.releaseYear ? String(found.releaseYear) : null, setReleaseYear);
    if (!locked.has('genres') && found.genres?.length) {
      const foundGenre = found.genres[0];
      setGenres(foundGenre);
      setCustomGenre(!GAME_GENRES.includes(foundGenre));
      setFieldSources((have) => ({ ...have, genres: found.source ?? 'steam' }));
    }
    fill('coverUrl', found.coverUrl, setCoverUrl);
    fill('backgroundUrl', found.backgroundUrl, setBackdropUrl);
    if (appId) setSteamAppId(appId);
    setMatchTitle(found.name ?? found.matchTitle ?? null);
  }, [locked]);

  const lookup = async (appIdOverride?: number | null) => {
    setLooking(true);
    try {
      const appId = appIdOverride ?? steamAppId;
      const found = await fetchMetadata(title.trim() || game.title, appId, { force: true });
      if (!found) { say('No store page was found for that name.'); return; }
      applyFound(found, found.steamAppId ?? appId ?? null);
      say('Details refreshed from the store. Save to keep them.');
    } catch (cause) {
      say(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLooking(false);
    }
  };

  const findMatches = async () => {
    setMatching(true);
    setMatchQuery(title.trim() || game.title);
    try {
      setMatches(await searchGames(title.trim() || game.title));
    } catch (cause) {
      say(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const coverShown = coverPath.trim() ? fileSrc(coverPath.trim()) : coverUrl.trim() || initialMeta.coverUrl || null;
  const backdropShown = backdropUrl.trim() || initialMeta.backgroundUrl || initialMeta.headerUrl || null;

  const saveArt = (shape: ArtShape, url: string) => {
    if (shape === 'portrait') { setCoverUrl(url); setCoverPath(''); lock('coverUrl'); }
    else { setBackdropUrl(url); lock('backgroundUrl'); }
  };

  const pages: { id: Page; label: string; hidden?: boolean }[] = [
    { id: 'game', label: 'Game' },
    { id: 'launch', label: 'Launch', hidden: hideLaunchSettings },
    { id: 'tools', label: 'Tools', hidden: hideLaunchSettings },
    { id: 'wine', label: 'Wine', hidden: hideLaunchSettings || desktopOs() !== 'linux' },
    { id: 'saves', label: 'Saves' },
  ];
  const wineTarget = launchDraft.launch.kind === 'wine' ? launchDraft.launch : null;

  return (
    <section className="orbit-settings" aria-label={`Settings for ${game.title}`}>
      <div className="orbit-gameart">
        <button type="button" className="orbit-gameart-cover" onClick={() => setSearching('portrait')} title="Find another cover">
          {coverShown ? <img src={coverShown} alt="" /> : <span><ImageIcon className="size-4" />No cover</span>}<i>Cover</i>
        </button>
        <button type="button" className="orbit-gameart-wide" onClick={() => setSearching('wide')} title="Find another backdrop">
          {backdropShown ? <img src={backdropShown} alt="" /> : <span><ImageIcon className="size-4" />No backdrop</span>}<i>Backdrop</i>
        </button>
      </div>

      <header className="orbit-settings-head">
        <div className="orbit-settings-name">
          <input className="orbit-settings-title" value={title} aria-label="Game name" onChange={(event) => { setTitle(event.target.value); lock('name'); }} spellCheck={false} />
          <p className="orbit-settings-sub">
            {matchTitle ? `Matched to ${matchTitle}` : 'Not matched to a catalogue yet'}
            {steamAppId ? ` · Steam ${steamAppId}` : ''}
          </p>
        </div>
        <div className="orbit-settings-flags">
          <button type="button" className="orbit-settings-flag" aria-pressed={favorite} onClick={() => setFavorite(!favorite)} title={favorite ? 'Remove from favourites' : 'Add to favourites'} aria-label={favorite ? 'Remove from favourites' : 'Add to favourites'}>
            <Star className="size-4" fill={favorite ? 'currentColor' : 'none'} />
          </button>
          <button type="button" className="orbit-settings-flag" aria-pressed={hidden} onClick={() => setHidden(!hidden)} title={hidden ? 'Show in the library' : 'Hide from the library'} aria-label={hidden ? 'Show in the library' : 'Hide from the library'}>
            {hidden ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </header>

      <nav className="orbit-settings-tabs" role="tablist" aria-label="Settings pages">
        {pages.filter((entry) => !entry.hidden).map((entry) => (
          <button key={entry.id} type="button" role="tab" aria-selected={page === entry.id} onClick={() => setPage(entry.id)}>{entry.label}</button>
        ))}
      </nav>

      <div key={page} className="orbit-settings-page" role="tabpanel" data-page={page}>
        {page === 'game' && (
          <>
            <Panel title="Catalogue match" action={
              <button type="button" className="orbit-btn is-quiet" disabled={looking} onClick={() => void lookup()}>
                <RefreshCw className={cn('size-3.5', looking && 'animate-spin')} /> {looking ? 'Refreshing…' : 'Refresh details'}
              </button>
            }>
              <p className="orbit-note">Orbit fills empty fields from the matched store page. Fields you edit are locked and will not be replaced by a background lookup.</p>
              <div className="orbit-panel-foot">
                <button type="button" className="orbit-btn" onClick={() => void findMatches()}><Search className="size-3.5" /> Change match</button>
              </div>
              {matching && (
                <div className="orbit-matchpicker">
                  <div className="orbit-inline">
                    <input className="orbit-input" value={matchQuery} onChange={(event) => setMatchQuery(event.target.value)} placeholder="Search the catalogue" aria-label="Search the catalogue" />
                    <button type="button" className="orbit-btn" onClick={() => void searchGames(matchQuery).then(setMatches).catch((cause) => say(String(cause)))}>Search</button>
                  </div>
                  <div className="orbit-matchlist">
                    {matches.map((match) => (
                      <button key={match.appId} type="button" onClick={() => { setSteamAppId(match.appId); setMatchTitle(match.name); setMatching(false); void lookup(match.appId); }}>
                        {match.coverUrl ? <img src={match.coverUrl} alt="" /> : <span />}
                        <b>{match.name}</b>
                        <small>Steam {match.appId}</small>
                      </button>
                    ))}
                    {matches.length === 0 && <p className="orbit-note">No matches yet. Search for the game’s store name.</p>}
                  </div>
                </div>
              )}
            </Panel>

            <Panel title="Details">
              <Row label="Developer"><input className="orbit-input" value={developer} onChange={(event) => { setDeveloper(event.target.value); lock('developer'); }} /></Row>
              <Row label="Released"><input className="orbit-input" value={releaseYear} onChange={(event) => { setReleaseYear(event.target.value); lock('releaseYear'); }} placeholder="2019" inputMode="numeric" /></Row>
              <Row label="Genre">
                <div className="flex min-w-0 gap-2">
                  {customGenre ? (
                    <input className="orbit-input min-w-0 flex-1" aria-label="Custom genre" value={genres} onChange={(event) => { setGenres(event.target.value); lock('genres'); }} placeholder="Custom genre" />
                  ) : (
                    <select
                      className="orbit-input min-w-0 flex-1"
                      aria-label="Genre"
                      value={genres}
                      onChange={(event) => {
                        lock('genres');
                        if (event.target.value === '__custom__') { setCustomGenre(true); setGenres(''); }
                        else setGenres(event.target.value);
                      }}
                    >
                      <option value="">No genre</option>
                      {genres && !GAME_GENRES.includes(genres) && <option value={genres}>{genres}</option>}
                      {GAME_GENRES.map((genre) => <option key={genre} value={genre}>{genre}</option>)}
                      <option value="__custom__">Create custom…</option>
                    </select>
                  )}
                  {customGenre && <button type="button" className="orbit-btn is-quiet" onClick={() => { setCustomGenre(false); setGenres(''); }}>Choose</button>}
                </div>
              </Row>
              <Row label="Score"><input className="orbit-input" value={rating} onChange={(event) => { setRating(event.target.value); lock('rating'); }} placeholder="Out of 100" inputMode="numeric" /></Row>
              <Row label="Size on disk">
                <div className="orbit-unit"><input className="orbit-input" value={sizeGb} onChange={(event) => setSizeGb(event.target.value)} placeholder="12.5" inputMode="decimal" /><span>GB</span></div>
              </Row>
              <Row label="Cover fit">
                <div className="orbit-seg">
                  {(['auto', 'cover', 'contain'] as const).map((option) => (
                    <button key={option} type="button" aria-pressed={fit === option} onClick={() => { setFit(option); lock('coverUrl'); }}>{option === 'auto' ? 'Auto' : option === 'cover' ? 'Fill' : 'Fit'}</button>
                  ))}
                </div>
              </Row>
              <Row label="About" stacked>
                <textarea className="orbit-input orbit-textarea" value={summary} onChange={(event) => { setSummary(event.target.value); lock('summary'); }} placeholder="What the game is. The store’s words, or yours." />
              </Row>
            </Panel>

            <Panel title="How long it takes" action={
              <button type="button" className="orbit-btn is-quiet" onClick={() => void fetchHltb(title.trim() || game.title).then((found) => {
                if (!found) return say('HowLongToBeat has no time for that name.');
                setMain(String(found.main)); setMainExtra(String(found.mainExtra)); setCompletionist(String(found.completionist));
              })}>Ask HowLongToBeat</button>
            }>
              <div className="orbit-times">
                <label><span>Main story</span><input className="orbit-input" value={main} onChange={(event) => setMain(event.target.value)} inputMode="decimal" placeholder="—" /></label>
                <label><span>Main + extras</span><input className="orbit-input" value={mainExtra} onChange={(event) => setMainExtra(event.target.value)} inputMode="decimal" placeholder="—" /></label>
                <label><span>Completionist</span><input className="orbit-input" value={completionist} onChange={(event) => setCompletionist(event.target.value)} inputMode="decimal" placeholder="—" /></label>
              </div>
            </Panel>
          </>
        )}

        {page === 'launch' && !hideLaunchSettings && (
          <Panel title="How Orbit starts it">
            <LaunchEditor game={game} draft={launchDraft} onDraftChange={setLaunchDraft} embedded section="all" />
            {launchErrors.length > 0 && <div className="orbit-launcherrors" role="alert">{launchErrors.map((error) => <p key={error}>{error}</p>)}</div>}
          </Panel>
        )}

        {page === 'tools' && !hideLaunchSettings && (
          <Panel title="ReShade">
            {reshade ? (
              <>
                <Row label={reshade.state === 'on' ? 'On' : reshade.state === 'off' ? 'Off' : 'Not set up'}>
                  <div className="orbit-inline">
                    {reshade.proxy && <span className="orbit-chip">{reshade.proxy}.dll</span>}
                    <Toggle checked={reshade.state === 'on'} disabled={reshadeBusy || !reshade.supported || !reshade.folder} label="Use ReShade with this game" onChange={(next) => {
                      setReshadeBusy(true);
                      void setReshade(game.id, next)
                        .then((state) => { setReshadeState(state); say(next ? 'ReShade is on. Press Home in game to open it.' : 'ReShade is off.'); })
                        .catch((cause: unknown) => say(cause instanceof Error ? cause.message : String(cause)))
                        .finally(() => setReshadeBusy(false));
                    }} />
                  </div>
                </Row>
                <Row label="Where" stacked>
                  <p className="orbit-note">{!reshade.supported ? reshade.reason ?? 'ReShade needs a Windows or Wine game.' : !reshade.folder ? reshade.reason ?? 'Orbit cannot see a folder for this game yet.' : reshade.folder}</p>
                </Row>
                {reshade.supported && reshade.folder && (
                  <div className="orbit-panel-foot">
                    <button type="button" className="orbit-btn" disabled={reshadeBusy} onClick={() => void pickFile('Choose a ReShade DLL you already have', ['dll'], undefined).then((path) => {
                      if (!path) return;
                      setReshadeBusy(true);
                      void useReshadeFile(game.id, path).then(setReshadeState).catch((cause: unknown) => say(String(cause))).finally(() => setReshadeBusy(false));
                    })}>Use a DLL I already have</button>
                    <button type="button" className="orbit-btn" onClick={() => void revealInExplorer(reshade.folder ?? '')}>Open the folder</button>
                  </div>
                )}
                <p className="orbit-note">The original file is kept beside ReShade’s, so turning it off puts the game back. Some anti-cheat systems read it as tampering.</p>
              </>
            ) : <p className="orbit-note">{reshadeBusy ? 'Looking at the game folder…' : 'ReShade was not checked.'}</p>}
          </Panel>
        )}

        {page === 'wine' && !hideLaunchSettings && (
          <Panel title="Wine and Proton">
            {wineTarget ? (
              <WineSettings
                proton={wineTarget.proton ?? null}
                tweaks={wineTarget.tweaks}
                onProton={(proton) => setLaunchDraft({ ...launchDraft, launch: { ...wineTarget, proton } })}
                onTweaks={(tweaks) => setLaunchDraft({ ...launchDraft, launch: { ...wineTarget, tweaks } })}
              />
            ) : (
              <>
                <p className="orbit-note">This game does not start through Wine, so there is nothing to choose here.</p>
                <div className="orbit-panel-foot"><button type="button" className="orbit-btn" onClick={() => setPage('launch')}>Change how it starts</button></div>
              </>
            )}
          </Panel>
        )}

        {page === 'saves' && (
          <>
            <Panel title="Save folder">
              <Row label="Folder" stacked>
                <div className="orbit-inline">
                  <input className="orbit-input" value={savePath} onChange={(event) => { setSavePath(event.target.value); onSaveDir?.(event.target.value); }} placeholder="No save folder found yet" spellCheck={false} />
                  {isNative() && <button type="button" className="orbit-btn" onClick={() => void pickFolder('Choose this game’s save folder', savePath || undefined).then((path) => { if (path) { setSavePath(path); onSaveDir?.(path); } })}><FolderOpen className="size-3.5" /> Browse</button>}
                </div>
              </Row>
              <div className="orbit-panel-foot">
                <button type="button" className="orbit-btn is-accent" disabled={saveBusy} onClick={() => {
                  setSaveBusy(true); setSaveError(null);
                  void findSave(game.title, saveHintsOf(game))
                    .then(async (found) => { if (found) { setSavePath(found); onSaveDir?.(found); setSaveSuggestions([]); } else setSaveSuggestions(await suggestSaves(game.title)); })
                    .catch((cause: unknown) => setSaveError(cause instanceof Error ? cause.message : String(cause)))
                    .finally(() => setSaveBusy(false));
                }}>{saveBusy ? 'Searching…' : 'Find it for me'}</button>
                {savePath.trim() && <button type="button" className="orbit-btn" onClick={() => void revealInExplorer(savePath)}>Open the folder</button>}
              </div>
            </Panel>
            {saveSuggestions.length > 0 && (
              <Panel title="PCGamingWiki suggests">
                <div className="orbit-suggestions">{saveSuggestions.map((suggestion) => <button key={suggestion} type="button" onClick={() => { setSavePath(suggestion); onSaveDir?.(suggestion); }}>{suggestion}</button>)}</div>
              </Panel>
            )}
            {game.installDir && (
              <Panel title="Install">
                <Row label="Folder" stacked><p className="orbit-note">{game.installDir}{game.sizeBytes > 0 ? ` · ${fmtBytes(game.sizeBytes)}` : ''}</p></Row>
                <div className="orbit-panel-foot"><button type="button" className="orbit-btn" onClick={() => void revealInExplorer(game.installDir!)}>Open the game’s folder</button></div>
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
              if (wide) { setBackdropUrl(fileSrc(path)); lock('backgroundUrl'); }
              else { setCoverPath(path); lock('coverUrl'); }
            });
          } : undefined}
          onChoose={(which, url, source) => { saveArt(which, url); setSearching(which); say(`${which === 'portrait' ? 'Cover' : 'Backdrop'} set from ${source}. Save to keep it.`); }}
          onPickSlot={(which) => setSearching(which)}
          load={async (which, query, pageNumber) => {
            if (which === 'wide') {
              const [own, web] = await Promise.all([
                query === game.title ? findBackdropArtwork(game.id).catch(() => ({ appId: null, picks: [] })) : findArtworkChoices(query, steamAppId, pageNumber),
                findWebWideArt(query).catch(() => ({ appId: null, picks: [] })),
              ]);
              const seen = new Set<string>();
              const picks = [...own.picks, ...web.picks].filter((pick) => { if (seen.has(pick.url)) return false; seen.add(pick.url); return true; });
              return { appId: own.appId ?? null, picks, hasMore: false };
            }
            if (query === game.title) return findArtwork(game.id, pageNumber);
            return findArtworkChoices(query, steamAppId, pageNumber);
          }}
        />
      )}
    </section>
  );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="orbit-panelbox">
      <header className="orbit-panelbox-head"><h3>{title}</h3>{action}</header>
      {children}
    </section>
  );
}

function Row({ label, stacked = false, children }: { label: string; stacked?: boolean; children: React.ReactNode }) {
  return (
    <label className={cn('orbit-row2', stacked && 'is-stacked')}>
      <span className="orbit-row2-label">{label}</span>
      <span className="orbit-row2-control">{children}</span>
    </label>
  );
}

function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className="orbit-toggle" data-on={checked || undefined}><i /></button>
  );
}

export const EditRemoveIcon = Trash2;
