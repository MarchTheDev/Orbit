import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Check,
  ChevronRight,
  Clock,
  CornerDownLeft,
  Dices,
  Eye,
  EyeOff,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Heart,
  Library,
  ListChecks,
  NotebookPen,
  Palette,
  Pencil,
  Play,
  Plus,
  Save,
  Search,
  Settings,
  SlidersHorizontal,
  Square,
  Star,
  Tag,
  Tv,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { Game, GameStatus, Page } from '../types';
import { THEMES, type Theme } from '../data/themes';
import { fmtDate, fmtMinutes } from '../utils/format';
import { inLibraryShelf } from '../utils/library';
import { Cover } from './ui/Cover';

function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return 'Never';
  const diffDays = Math.floor((Date.now() - ts) / 86_400_000);
  if (diffDays <= 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 14) return `${diffDays}d ago`;
  return fmtDate(iso);
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-panel2 px-1.5 py-0.5 font-mono text-[10px] text-muted">
      {children}
    </kbd>
  );
}

/** Extra entries App hands in for actions only App has the state to run. */
export interface ExtraCommand {
  id: string;
  label: string;
  hint: string;
  Icon: LucideIcon;
  group: 'Pages' | 'Actions' | 'Files';
  keywords?: string[];
  secondary?: boolean;
  shortcut?: string;
  run: () => void;
}

type FilterKind = 'all' | 'pages' | 'actions' | 'games';

const FILTERS: { id: FilterKind; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'pages', label: 'Pages' },
  { id: 'actions', label: 'Actions' },
  { id: 'games', label: 'Games' },
];

type VerbKind = 'play' | 'stop' | 'edit' | 'folder' | 'fav' | 'hide' | 'journal' | 'genre' | 'theme';

const VERB_LABELS: Record<VerbKind, string> = {
  play: 'Play game',
  stop: 'Stop game',
  edit: 'Edit game',
  folder: 'Open game folder',
  fav: 'Toggle favourite',
  hide: 'Hide or unhide',
  journal: 'Open in Journal',
  genre: 'Filter genre',
  theme: 'Switch theme',
};

interface PaletteRow {
  id: string;
  recentKey?: string;
  group: string;
  filterCat: 'pages' | 'actions' | 'games';
  label: string;
  hint: string;
  keywords?: string[];
  secondary?: boolean;
  shortcut?: string;
  game?: Game;
  /** True when pressing Right or clicking the chevron can drill into this game's actions. */
  drillGame?: Game;
  /** Keep the palette open after running (used for drilling into Level 2). */
  keepOpen?: boolean;
  checked?: boolean;
  accentDot?: string;
  Icon?: LucideIcon;
  run: () => void;
}

const RECENT_STORAGE_KEY = 'orbit.palette.recent';
const PINNED_STORAGE_KEY = 'orbit.palette.pinned';
const MAX_RECENT = 8;

function loadPinned(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(PINNED_STORAGE_KEY) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}


function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function saveRecent(key: string) {
  try {
    const next = [key, ...loadRecent().filter((item) => item !== key)].slice(0, MAX_RECENT);
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage failures in private contexts.
  }
}

/** Fold accents & case so queries like "pokemon" match "Pokémon". */
function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Multi-token fuzzy scorer:
 * rewards exact prefix, word-boundary starts, contiguous runs, and keyword hits.
 */
function scoreText(query: string, candidate: string): number | null {
  const q = fold(query).trim();
  if (!q) return 0;
  const hay = fold(candidate);
  if (!hay) return null;
  if (hay === q) return 400;
  if (hay.startsWith(q)) return 300 - Math.min(60, hay.length - q.length);

  const words = hay.split(/[\s\-_:./()[\]]+/).filter(Boolean);
  const tokens = q.split(/\s+/).filter(Boolean);

  let total = 0;
  for (const tok of tokens) {
    if (words.some((w) => w === tok)) {
      total += 160;
      continue;
    }
    if (words.some((w) => w.startsWith(tok))) {
      total += 130;
      continue;
    }
    const idx = hay.indexOf(tok);
    if (idx >= 0) {
      total += 95 - Math.min(35, idx);
      continue;
    }
    // Initials match (e.g. "hk" -> "Hollow Knight")
    const initials = words.map((w) => w[0] ?? '').join('');
    if (initials.includes(tok)) {
      total += 110;
      continue;
    }
    // Ordered subsequence fallback
    let pos = 0;
    let gaps = 0;
    let matched = true;
    for (let i = 0; i < tok.length; i += 1) {
      const found = hay.indexOf(tok[i]!, pos);
      if (found < 0) {
        matched = false;
        break;
      }
      if (found > pos) gaps += found - pos;
      pos = found + 1;
    }
    if (!matched || gaps > tok.length * 4 + 6) return null;
    total += Math.max(20, 65 - gaps * 2);
  }
  return total;
}

function scoreRow(query: string, row: PaletteRow): number | null {
  const labelScore = scoreText(query, row.label);
  const hintScore = row.hint ? scoreText(query, row.hint) : null;
  let kwBest: number | null = null;
  if (row.keywords) {
    for (const kw of row.keywords) {
      const s = scoreText(query, kw);
      if (s !== null && (kwBest === null || s > kwBest)) kwBest = s;
    }
  }
  const candidates = [
    labelScore !== null ? labelScore + 40 : null,
    kwBest !== null ? kwBest + 10 : null,
    hintScore,
  ].filter((v): v is number => v !== null);
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

/**
 * Parse smart command prefixes and leading/trailing verbs:
 * - Colon prefixes work immediately even with empty remainder (`play:`, `edit:`, `fav:`, `folder:`, `hide:`, `log:`, `genre:`, `theme:`, `stop:`)
 * - `@<genre>` -> genre mode, `><cmd>` -> actions mode
 * - Space-separated `<verb> <game>` (e.g. `play hades`, `open hollow folder`) or `<game> <verb>` (e.g. `hades settings`)
 */
function parseSmartIntent(raw: string): {
  verb: VerbKind | null;
  actionsOnly: boolean;
  rest: string;
  explicitPrefix: boolean;
} {
  const trimmedLeft = raw.trimStart();
  if (!trimmedLeft) return { verb: null, actionsOnly: false, rest: '', explicitPrefix: false };

  if (trimmedLeft.startsWith('>')) {
    return { verb: null, actionsOnly: true, rest: trimmedLeft.slice(1).trim(), explicitPrefix: true };
  }
  if (trimmedLeft.startsWith('@')) {
    return { verb: 'genre', actionsOnly: false, rest: trimmedLeft.slice(1).trim(), explicitPrefix: true };
  }

  // Colon prefix: `play:`, `play: elden`, `launch:`, `settings:`, `edit:`, `folder:`, `fav:`, `hide:`, `log:`, `genre:`, `theme:`, `stop:`
  const colonMatch = /^([a-zA-Z]+)\s*:\s*(.*)$/.exec(trimmedLeft);
  if (colonMatch) {
    const head = colonMatch[1]!.toLowerCase();
    const tail = colonMatch[2]!.trim();
    const colonMap: Record<string, VerbKind> = {
      play: 'play',
      launch: 'play',
      start: 'play',
      run: 'play',
      stop: 'stop',
      quit: 'stop',
      edit: 'edit',
      settings: 'edit',
      config: 'edit',
      configure: 'edit',
      folder: 'folder',
      dir: 'folder',
      open: 'folder',
      explore: 'folder',
      fav: 'fav',
      favorite: 'fav',
      favourite: 'fav',
      star: 'fav',
      hide: 'hide',
      unhide: 'hide',
      log: 'journal',
      logs: 'journal',
      journal: 'journal',
      notes: 'journal',
      genre: 'genre',
      tag: 'genre',
      theme: 'theme',
    };
    const mapped = colonMap[head];
    if (mapped) {
      return { verb: mapped, actionsOnly: false, rest: tail, explicitPrefix: true };
    }
  }

  // Trailing space after an exact command word (`"play "` or `"launch "`) also triggers game picker immediately
  if (/\s$/.test(raw)) {
    const single = trimmedLeft.trim().toLowerCase();
    if (single === 'play' || single === 'launch' || single === 'run') {
      return { verb: 'play', actionsOnly: false, rest: '', explicitPrefix: true };
    }
  }

  // Multi-word verb queries: `play elden`, `elden settings`, `open hades folder`, `fav celeste`
  const toks = trimmedLeft.trim().split(/\s+/);
  if (toks.length >= 2) {
    const first = toks[0]!.toLowerCase();
    const last = toks[toks.length - 1]!.toLowerCase();

    if (first === 'play' || first === 'launch' || first === 'start' || first === 'run') {
      return { verb: 'play', actionsOnly: false, rest: toks.slice(1).join(' '), explicitPrefix: false };
    }
    if (first === 'stop' || first === 'quit') {
      return { verb: 'stop', actionsOnly: false, rest: toks.slice(1).join(' '), explicitPrefix: false };
    }
    if (first === 'fav' || first === 'favorite' || first === 'favourite') {
      return { verb: 'fav', actionsOnly: false, rest: toks.slice(1).join(' '), explicitPrefix: false };
    }
    if (first === 'hide' || first === 'unhide') {
      return { verb: 'hide', actionsOnly: false, rest: toks.slice(1).join(' '), explicitPrefix: false };
    }
    if (first === 'edit' || first === 'configure') {
      return { verb: 'edit', actionsOnly: false, rest: toks.slice(1).join(' '), explicitPrefix: false };
    }
    if ((first === 'open' || first === 'reveal') && (last === 'folder' || last === 'dir' || last === 'files') && toks.length >= 3) {
      return { verb: 'folder', actionsOnly: false, rest: toks.slice(1, -1).join(' '), explicitPrefix: false };
    }
    if (first === 'folder' || first === 'dir') {
      return { verb: 'folder', actionsOnly: false, rest: toks.slice(1).join(' '), explicitPrefix: false };
    }
    if (first === 'genre') {
      return { verb: 'genre', actionsOnly: false, rest: toks.slice(1).join(' '), explicitPrefix: false };
    }
    if (first === 'theme') {
      return { verb: 'theme', actionsOnly: false, rest: toks.slice(1).join(' '), explicitPrefix: false };
    }
    if (last === 'settings' || last === 'config') {
      const target = toks.slice(0, -1).join(' ');
      if (target.toLowerCase() !== 'app' && target.toLowerCase() !== 'orbit') {
        return { verb: 'edit', actionsOnly: false, rest: target, explicitPrefix: false };
      }
    }
    if (last === 'folder' || last === 'files') {
      const target = toks.slice(0, -1).join(' ');
      if (!['captures', 'data', 'logs', 'orbit'].includes(target.toLowerCase())) {
        return { verb: 'folder', actionsOnly: false, rest: target, explicitPrefix: false };
      }
    }
  }

  return { verb: null, actionsOnly: false, rest: trimmedLeft.trim(), explicitPrefix: false };
}

const STATUS_DOT: Record<GameStatus, { label: string; color: string }> = {
  playing: { label: 'Playing', color: '#34d399' },
  completed: { label: 'Completed', color: 'var(--c-accent)' },
  backlog: { label: 'Backlog', color: '#60a5fa' },
  dropped: { label: 'Dropped', color: '#94a3b8' },
};

function launcherLabel(game: Game): string {
  if (game.planned) return game.planPlatform ? `Planned · ${game.planPlatform}` : 'Planned';
  switch (game.launch.kind) {
    case 'steam':
      return 'Steam';
    case 'lutris':
      return 'Lutris';
    case 'wine':
      return 'Wine / Proton';
    case 'executable':
      return 'Installed';
    default:
      return game.installDir || game.exePath ? 'Installed' : 'Timer only';
  }
}

export function CommandPalette({
  open,
  initialQuery = '',
  games,
  customThemes = [],
  currentThemeId,
  onClose,
  onPage,
  onGame,
  onEditGame,
  onToggleFavorite,
  onUpdateGame,
  onRevealGame,
  onOpenJournal,
  onSettings,
  onSettingsSection,
  onSelectTheme,
  onAdd,
  onAddFolder,
  onTv,
  runningId,
  onStop,
  onPlay,
  onGenre,
  extra = [],
}: {
  open: boolean;
  initialQuery?: string;
  games: Game[];
  customThemes?: Theme[];
  currentThemeId?: string;
  onClose: () => void;
  onPage: (p: Page) => void;
  onGame: (id: string) => void;
  onEditGame?: (id: string) => void;
  onToggleFavorite?: (id: string) => void;
  onUpdateGame?: (id: string, patch: Partial<Game>) => void;
  onRevealGame?: (game: Game) => void;
  onOpenJournal?: (id: string) => void;
  onSettings: () => void;
  onSettingsSection?: (sectionId: string) => void;
  onSelectTheme?: (themeId: string) => void;
  onAdd: () => void;
  onAddFolder: () => void;
  onTv?: () => void;
  runningId?: string | null;
  onStop?: () => void;
  onPlay?: (id: string) => void;
  onGenre?: (genre: string) => void;
  extra?: ExtraCommand[];
}) {
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<FilterKind>('all');
  const [active, setActive] = useState(0);
  /** Level 2: drilled into one specific game's actions, with saved Level 1 state. */
  const [gameLevel, setGameLevel] = useState<{
    gameId: string;
    savedQuery: string;
    savedActive: number;
  } | null>(null);
  const [recentKeys, setRecentKeys] = useState<string[]>(() => loadRecent());
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => loadPinned());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; row: PaletteRow } | null>(null);
  const lastHoverPosition = useRef<{ x: number; y: number } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery);
    setFilter('all');
    setActive(0);
    setGameLevel(null);
    setRecentKeys(loadRecent());
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open, initialQuery]);

  const playableGames = useMemo(
    () =>
      games
        .filter((g) => !g.planned && inLibraryShelf(g))
        .sort((a, b) => {
          const aTime = a.lastPlayed ? Date.parse(a.lastPlayed) || 0 : 0;
          const bTime = b.lastPlayed ? Date.parse(b.lastPlayed) || 0 : 0;
          if (bTime !== aTime) return bTime - aTime;
          if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
          return a.title.localeCompare(b.title);
        }),
    [games],
  );

  const genres = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>();
    for (const g of games) {
      if (g.hidden || g.planned) continue;
      for (const raw of g.meta?.genres ?? []) {
        const name = raw.trim();
        if (!name) continue;
        const key = name.toLowerCase();
        const prev = counts.get(key);
        if (prev) prev.count += 1;
        else counts.set(key, { name, count: 1 });
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [games]);

  const runningGame = runningId ? games.find((g) => g.id === runningId) ?? null : null;
  const levelGame = gameLevel ? games.find((g) => g.id === gameLevel.gameId) ?? null : null;

  const enterGameLevel = (game: Game) => {
    setGameLevel({ gameId: game.id, savedQuery: query, savedActive: active });
    setQuery('');
    setActive(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const exitGameLevel = () => {
    if (!gameLevel) return;
    const prev = gameLevel;
    setGameLevel(null);
    setQuery(prev.savedQuery);
    setActive(prev.savedActive);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const buildSingleGameActions = (g: Game, groupPrefix = false): PaletteRow[] => {
    const items: PaletteRow[] = [];
    const isRunning = runningId === g.id;
    const hasFolder = Boolean(g.installDir || g.exePath);

    if (!g.planned) {
      if (isRunning && onStop) {
        items.push({
          id: `gact-stop-${g.id}`,
          recentKey: `stop:${g.id}`,
          group: groupPrefix ? g.title : 'Actions',
          filterCat: 'actions',
          label: groupPrefix ? `Stop ${g.title}` : 'Stop game',
          hint: 'Running now',
          keywords: ['quit', 'exit', 'close', g.title],
          game: g,
          Icon: Square,
          run: onStop,
        });
      } else if (onPlay && !runningId) {
        items.push({
          id: `gact-play-${g.id}`,
          recentKey: `play:${g.id}`,
          group: groupPrefix ? g.title : 'Actions',
          filterCat: 'actions',
          label: groupPrefix ? `Play ${g.title}` : 'Play',
          hint: g.playSecs > 0 ? `${fmtMinutes(g.playSecs / 60)} played` : launcherLabel(g),
          keywords: ['launch', 'start', 'run', g.title],
          game: g,
          Icon: Play,
          run: () => onPlay(g.id),
        });
      }
    }

    items.push({
      id: `gact-open-${g.id}`,
      recentKey: `game:${g.id}`,
      group: groupPrefix ? g.title : 'Actions',
      filterCat: 'actions',
      label: groupPrefix ? `Open ${g.title}` : 'Open game details',
      hint: 'View overview, sessions, saves, and notes',
      keywords: ['details', 'view', 'page', g.title],
      game: g,
      Icon: Library,
      run: () => onGame(g.id),
    });

    if (onEditGame) {
      items.push({
        id: `gact-edit-${g.id}`,
        recentKey: `edit:${g.id}`,
        group: groupPrefix ? g.title : 'Actions',
        filterCat: 'actions',
        label: groupPrefix ? `${g.title} settings…` : 'Edit game settings…',
        hint: 'Launch target, artwork, metadata, and paths',
        keywords: ['edit', 'settings', 'configure', 'artwork', 'exe', g.title],
        game: g,
        Icon: SlidersHorizontal,
        run: () => onEditGame(g.id),
      });
    }

    if (onToggleFavorite && !g.planned) {
      items.push({
        id: `gact-fav-${g.id}`,
        recentKey: `fav:${g.id}`,
        group: groupPrefix ? g.title : 'Actions',
        filterCat: 'actions',
        label: g.favorite
          ? groupPrefix ? `Remove ${g.title} from favourites` : 'Remove from favourites'
          : groupPrefix ? `Add ${g.title} to favourites` : 'Add to favourites',
        hint: g.favorite ? 'Favourited' : 'Pin to Favourites',
        keywords: ['favorite', 'favourite', 'heart', 'star', g.title],
        game: g,
        Icon: Heart,
        run: () => onToggleFavorite(g.id),
      });
    }

    if (onRevealGame && hasFolder) {
      items.push({
        id: `gact-folder-${g.id}`,
        recentKey: `folder:${g.id}`,
        group: groupPrefix ? g.title : 'Actions',
        filterCat: 'actions',
        label: groupPrefix ? `Open ${g.title} folder` : 'Open install folder',
        hint: g.installDir ?? g.exePath ?? 'Show in file manager',
        keywords: ['folder', 'directory', 'explorer', 'files', g.title],
        game: g,
        Icon: FolderOpen,
        run: () => onRevealGame(g),
      });
    }

    if (onOpenJournal && !g.planned && inLibraryShelf(g)) {
      items.push({
        id: `gact-journal-${g.id}`,
        recentKey: `journal:${g.id}`,
        group: groupPrefix ? g.title : 'Actions',
        filterCat: 'actions',
        label: groupPrefix ? `Open ${g.title} in Journal` : 'Open in Journal',
        hint: 'Entries, playthroughs, and notes',
        keywords: ['journal', 'log', 'logs', 'notes', g.title],
        game: g,
        Icon: NotebookPen,
        run: () => onOpenJournal(g.id),
      });
    }

    if (onUpdateGame && !g.planned) {
      items.push({
        id: `gact-hide-${g.id}`,
        group: groupPrefix ? g.title : 'Actions',
        filterCat: 'actions',
        label: g.hidden
          ? groupPrefix ? `Unhide ${g.title}` : 'Unhide game'
          : groupPrefix ? `Hide ${g.title}` : 'Hide from shelf',
        hint: g.hidden ? 'Currently hidden' : 'Keep in Orbit, out of main shelf',
        keywords: ['hide', 'unhide', 'visibility', g.title],
        game: g,
        Icon: g.hidden ? Eye : EyeOff,
        run: () => onUpdateGame(g.id, { hidden: !g.hidden }),
      });

      if (!groupPrefix) {
        const statuses: { id: GameStatus; label: string }[] = [
          { id: 'playing', label: 'Status: Playing' },
          { id: 'completed', label: 'Status: Completed' },
          { id: 'backlog', label: 'Status: Backlog' },
          { id: 'dropped', label: 'Status: Dropped' },
        ];
        for (const st of statuses) {
          items.push({
            id: `gact-status-${g.id}-${st.id}`,
            group: 'Set status',
            filterCat: 'actions',
            label: st.label,
            hint: g.status === st.id ? 'Current status' : `Mark ${g.title} as ${st.id}`,
            keywords: ['status', st.id],
            game: g,
            checked: g.status === st.id,
            accentDot: STATUS_DOT[st.id].color,
            run: () => onUpdateGame(g.id, { status: st.id }),
          });
        }
      }
    }

    return items;
  };

  /** Core navigation pages + settings subsections + global actions. */
  const staticRows = useMemo<PaletteRow[]>(() => {
    const pages: PaletteRow[] = [
      { id: 'nav-library', recentKey: 'page:library', group: 'Go to', filterCat: 'pages', label: 'Library', hint: 'Shelves, covers, and game pages', keywords: ['home', 'shelf', 'games', 'observatory'], Icon: Library, run: () => onPage('library') },
      { id: 'nav-statistics', recentKey: 'page:statistics', group: 'Go to', filterCat: 'pages', label: 'Statistics', hint: 'Hours, streaks, and activity charts', keywords: ['stats', 'charts', 'hours', 'playtime'], Icon: BarChart3, run: () => onPage('statistics') },
      { id: 'nav-sessions', recentKey: 'page:sessions', group: 'Go to', filterCat: 'pages', label: 'Sessions', hint: 'Every recorded play session', keywords: ['history', 'clock', 'time'], Icon: Clock, run: () => onPage('sessions') },
      { id: 'nav-logs', recentKey: 'page:logs', group: 'Go to', filterCat: 'pages', label: 'Journal', hint: 'Notes, milestones, and playthroughs', keywords: ['logs', 'notes', 'diary', 'playthrough'], Icon: NotebookPen, run: () => onPage('logs') },
      { id: 'nav-backlog', recentKey: 'page:backlog', group: 'Go to', filterCat: 'pages', label: 'Backlog', hint: 'Games queued up to play next', keywords: ['todo', 'planned', 'queue'], Icon: ListChecks, run: () => onPage('backlog') },
      { id: 'nav-saves', recentKey: 'page:saves', group: 'Go to', filterCat: 'pages', label: 'Saves', hint: 'Save backups and cloud sync', keywords: ['backups', 'cloud'], Icon: Save, run: () => onPage('saves') },
      { id: 'nav-storage', recentKey: 'page:storage', group: 'Go to', filterCat: 'pages', label: 'Storage', hint: 'Disk usage and moving installs', keywords: ['disk', 'drives', 'space', 'move'], Icon: HardDrive, run: () => onPage('storage') },
      { id: 'nav-settings', recentKey: 'page:settings', group: 'Go to', filterCat: 'pages', label: 'Settings', hint: 'Appearance, libraries, metadata, and overlay', keywords: ['preferences', 'options', 'config'], shortcut: 'Ctrl+,', Icon: Settings, run: onSettings },
    ];

    const settingsSections: { id: string; label: string; hint: string; keywords: string[] }[] = [
      { id: 'orbit-appearance', label: 'Settings › Appearance', hint: 'Themes, fonts, glass, and background blur', keywords: ['theme', 'font', 'glass', 'blur', 'colours', 'colors'] },
      { id: 'orbit-libraries', label: 'Settings › Libraries', hint: 'Steam, Lutris, Epic, GOG, and folder scanning', keywords: ['steam', 'epic', 'gog', 'lutris', 'import', 'scan'] },
      { id: 'orbit-metadata', label: 'Settings › Metadata', hint: 'SteamGridDB, HowLongToBeat, IGDB, and artwork sources', keywords: ['steamgriddb', 'hltb', 'howlongtobeat', 'igdb', 'protondb', 'covers', 'icons'] },
      { id: 'orbit-overlay', label: 'Settings › In-game overlay', hint: 'HUD boxes, FPS counter, and overlay layout', keywords: ['hud', 'fps', 'overlay'] },
      { id: 'orbit-captures', label: 'Settings › Captures', hint: 'Screenshots, recordings, and instant replay', keywords: ['screenshots', 'recording', 'replay', 'video'] },
      { id: 'orbit-shortcuts', label: 'Settings › Shortcuts', hint: 'Keyboard and controller chords', keywords: ['hotkeys', 'keybinds', 'gamepad', 'controller'] },
      { id: 'orbit-sound', label: 'Settings › Sound & music', hint: 'UI sounds and ambient music', keywords: ['audio', 'music', 'volume', 'mute'] },
      { id: 'orbit-copy', label: 'Settings › Saves & backups', hint: 'Automatic save snapshots and cloud folders', keywords: ['backups', 'saves', 'cloud'] },
      { id: 'orbit-updates', label: 'Settings › Updates', hint: 'Check for new Orbit releases', keywords: ['version', 'upgrade', 'release'] },
    ];

    if (onSettingsSection) {
      for (const sec of settingsSections) {
        pages.push({
          id: `nav-sec-${sec.id}`,
          recentKey: `sec:${sec.id}`,
          group: 'Settings',
          filterCat: 'pages',
          label: sec.label,
          hint: sec.hint,
          keywords: sec.keywords,
          secondary: true,
          Icon: Settings,
          run: () => onSettingsSection(sec.id),
        });
      }
    }

    const actions: PaletteRow[] = [];
    if (runningGame && onStop) {
      actions.push({
        id: 'act-stop-running',
        recentKey: `stop:${runningGame.id}`,
        group: 'Now running',
        filterCat: 'actions',
        label: `Stop ${runningGame.title}`,
        hint: 'End the active session',
        keywords: ['stop', 'quit', 'close', runningGame.title],
        game: runningGame,
        Icon: Square,
        run: onStop,
      });
    }

    actions.push(
      { id: 'act-add', recentKey: 'act:add', group: 'Actions', filterCat: 'actions', label: 'Add a game', hint: 'Executable, shortcut, or manual entry', keywords: ['new', 'create', 'exe'], Icon: Plus, run: onAdd },
      { id: 'act-scan', recentKey: 'act:scan', group: 'Actions', filterCat: 'actions', label: 'Scan a folder for games', hint: 'Import installed games in bulk', keywords: ['import', 'directory', 'discover'], Icon: FolderPlus, run: onAddFolder },
    );

    if (onTv) {
      actions.push({
        id: 'act-tv',
        recentKey: 'act:tv',
        group: 'Actions',
        filterCat: 'actions',
        label: 'Enter TV mode',
        hint: 'Fullscreen controller-friendly shelf',
        keywords: ['fullscreen', 'couch', 'big picture', 'gamepad'],
        Icon: Tv,
        run: onTv,
      });
    }

    // Random game pickers
    const shelfPool = playableGames.filter((g) => !g.hidden);
    if (shelfPool.length > 0) {
      actions.push({
        id: 'act-random-any',
        recentKey: 'act:random-any',
        group: 'Actions',
        filterCat: 'actions',
        label: 'Pick a random game',
        hint: `From ${shelfPool.length} games in your library`,
        keywords: ['random', 'surprise', 'shuffle', 'dice', 'pick'],
        Icon: Dices,
        run: () => {
          const pick = shelfPool[Math.floor(Math.random() * shelfPool.length)];
          if (pick) onGame(pick.id);
        },
      });
    }
    const unplayedPool = shelfPool.filter((g) => g.playSecs === 0);
    if (unplayedPool.length > 0) {
      actions.push({
        id: 'act-random-unplayed',
        group: 'Actions',
        filterCat: 'actions',
        label: 'Pick a random unplayed game',
        hint: `${unplayedPool.length} untouched in your library`,
        keywords: ['random', 'unplayed', 'fresh', 'new', 'dice'],
        secondary: true,
        Icon: Dices,
        run: () => {
          const pick = unplayedPool[Math.floor(Math.random() * unplayedPool.length)];
          if (pick) onGame(pick.id);
        },
      });
    }
    const backlogPool = games.filter((g) => g.status === 'backlog' && !g.hidden);
    if (backlogPool.length > 0) {
      actions.push({
        id: 'act-random-backlog',
        group: 'Actions',
        filterCat: 'actions',
        label: 'Pick a random backlog game',
        hint: `${backlogPool.length} waiting in Backlog`,
        keywords: ['random', 'backlog', 'next', 'dice'],
        secondary: true,
        Icon: Dices,
        run: () => {
          const pick = backlogPool[Math.floor(Math.random() * backlogPool.length)];
          if (pick) onGame(pick.id);
        },
      });
    }

    for (const item of extra) {
      const cat: 'pages' | 'actions' = item.group === 'Pages' ? 'pages' : 'actions';
      actions.push({
        id: `extra-${item.id}`,
        recentKey: `extra:${item.id}`,
        group: item.group === 'Pages' ? 'Go to' : item.group,
        filterCat: cat,
        label: item.label,
        hint: item.hint,
        keywords: item.keywords,
        secondary: item.secondary,
        shortcut: item.shortcut,
        Icon: item.Icon,
        run: item.run,
      });
    }

    return [...pages, ...actions];
  }, [extra, games, onAdd, onAddFolder, onGame, onPage, onSettings, onSettingsSection, onStop, onTv, playableGames, runningGame]);

  const parsed = useMemo(() => parseSmartIntent(query), [query]);

  /** Compute visible ranked rows for either Level 2 (single game) or Level 1 (smart root). */
  const rows = useMemo<PaletteRow[]>(() => {
    // LEVEL 2: Inside one game's action menu
    if (levelGame) {
      const all = buildSingleGameActions(levelGame, false);
      const q = query.trim();
      if (!q) return all;
      return all
        .map((row) => ({ row, score: scoreRow(q, row) }))
        .filter((x): x is { row: PaletteRow; score: number } => x.score !== null)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.row);
    }

    // LEVEL 1: Smart Verb Mode (`play:`, `play <game>`, `edit:`, `folder:`, `fav:`, `hide:`, `log:`, `genre:`, `theme:`, `stop:`)
    if (parsed.verb) {
      const v = parsed.verb;
      const sub = parsed.rest;
      let candidates: PaletteRow[] = [];

      if (v === 'play') {
        candidates = playableGames.map((g) => ({
          id: `verb-play-${g.id}`,
          recentKey: `play:${g.id}`,
          group: sub ? 'Matching games to play' : 'Select a game to play',
          filterCat: 'actions',
          label: `Play ${g.title}`,
          hint:
            runningId === g.id
              ? 'Currently running'
              : g.playSecs > 0
                ? `${fmtMinutes(g.playSecs / 60)} · ${launcherLabel(g)}`
                : launcherLabel(g),
          keywords: [g.title, ...(g.meta?.genres ?? [])],
          game: g,
          drillGame: g,
          Icon: Play,
          run: () => {
            if (runningId === g.id) onGame(g.id);
            else if (onPlay) onPlay(g.id);
            else onGame(g.id);
          },
        }));
      } else if (v === 'stop') {
        if (runningGame && onStop) {
          candidates = [
            {
              id: `verb-stop-${runningGame.id}`,
              recentKey: `stop:${runningGame.id}`,
              group: 'Now running',
              filterCat: 'actions',
              label: `Stop ${runningGame.title}`,
              hint: 'End the active session',
              keywords: [runningGame.title, 'stop', 'quit'],
              game: runningGame,
              Icon: Square,
              run: onStop,
            },
          ];
        }
      } else if (v === 'edit' && onEditGame) {
        candidates = games.map((g) => ({
          id: `verb-edit-${g.id}`,
          recentKey: `edit:${g.id}`,
          group: 'Select a game to configure',
          filterCat: 'actions',
          label: `${g.title} settings…`,
          hint: launcherLabel(g),
          keywords: [g.title],
          game: g,
          drillGame: g,
          Icon: SlidersHorizontal,
          run: () => onEditGame(g.id),
        }));
      } else if (v === 'folder' && onRevealGame) {
        candidates = games
          .filter((g) => Boolean(g.installDir || g.exePath))
          .map((g) => ({
            id: `verb-folder-${g.id}`,
            recentKey: `folder:${g.id}`,
            group: 'Select a game folder to open',
            filterCat: 'actions',
            label: `Open ${g.title} folder`,
            hint: g.installDir ?? g.exePath ?? '',
            keywords: [g.title],
            game: g,
            Icon: FolderOpen,
            run: () => onRevealGame(g),
          }));
      } else if (v === 'fav' && onToggleFavorite) {
        candidates = playableGames.map((g) => ({
          id: `verb-fav-${g.id}`,
          recentKey: `fav:${g.id}`,
          group: 'Toggle favourite',
          filterCat: 'actions',
          label: g.favorite ? `Remove ${g.title} from favourites` : `Add ${g.title} to favourites`,
          hint: g.favorite ? 'Favourited' : 'Not in favourites',
          keywords: [g.title],
          game: g,
          Icon: Heart,
          run: () => onToggleFavorite(g.id),
        }));
      } else if (v === 'hide' && onUpdateGame) {
        candidates = games
          .filter((g) => !g.planned)
          .map((g) => ({
            id: `verb-hide-${g.id}`,
            group: 'Hide or unhide game',
            filterCat: 'actions',
            label: g.hidden ? `Unhide ${g.title}` : `Hide ${g.title}`,
            hint: g.hidden ? 'Hidden from shelf' : 'Visible on shelf',
            keywords: [g.title],
            game: g,
            Icon: g.hidden ? Eye : EyeOff,
            run: () => onUpdateGame(g.id, { hidden: !g.hidden }),
          }));
      } else if (v === 'journal' && onOpenJournal) {
        candidates = playableGames.map((g) => ({
          id: `verb-journal-${g.id}`,
          recentKey: `journal:${g.id}`,
          group: 'Open in Journal',
          filterCat: 'actions',
          label: `Open ${g.title} in Journal`,
          hint: 'Entries, playthroughs, and notes',
          keywords: [g.title],
          game: g,
          Icon: NotebookPen,
          run: () => onOpenJournal(g.id),
        }));
      } else if (v === 'genre' && onGenre) {
        candidates = genres.map((genre) => ({
          id: `verb-genre-${genre.name}`,
          recentKey: `genre:${genre.name}`,
          group: 'Genres',
          filterCat: 'actions',
          label: genre.name,
          hint: `${genre.count} ${genre.count === 1 ? 'game' : 'games'}`,
          keywords: ['genre', genre.name],
          Icon: Tag,
          run: () => onGenre(genre.name),
        }));
      } else if (v === 'theme' && onSelectTheme) {
        const allThemes = [...THEMES, ...customThemes];
        candidates = allThemes.map((t) => ({
          id: `verb-theme-${t.id}`,
          recentKey: `theme:${t.id}`,
          group: 'Themes',
          filterCat: 'actions',
          label: `Theme: ${t.name}`,
          hint: currentThemeId === t.id ? 'Active theme' : 'Apply theme',
          keywords: ['theme', t.name, t.id],
          checked: currentThemeId === t.id,
          accentDot: t.accent,
          Icon: Palette,
          run: () => onSelectTheme(t.id),
        }));
      }

      if (!sub) return candidates.slice(0, 40);

      const matched = candidates
        .map((row) => {
          const targetScore = row.game ? scoreText(sub, row.game.title) : scoreRow(sub, row);
          return targetScore !== null ? { row, score: targetScore } : null;
        })
        .filter((x): x is { row: PaletteRow; score: number } => x !== null)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.row);

      if (matched.length > 0 || parsed.explicitPrefix) return matched.slice(0, 30);
      // If not an explicit colon prefix and nothing matched the verb guess, fall through to general fuzzy search!
    }

    const effectiveFilter: FilterKind = parsed.actionsOnly ? 'actions' : filter;
    const q = parsed.actionsOnly ? parsed.rest : query.trim();

    // Build game rows — clicking or pressing Enter opens all per-game actions inside the palette
    const gameRows: PaletteRow[] = games.map((g) => ({
      id: `game-${g.id}`,
      recentKey: `game:${g.id}`,
      group: 'Games',
      filterCat: 'games',
      label: g.title,
      hint: g.planned
        ? `Planned${g.planPlatform ? ` · ${g.planPlatform}` : ''}`
        : `${g.playSecs > 0 ? fmtMinutes(g.playSecs / 60) : 'Unplayed'} · ${fmtRelative(g.lastPlayed)}`,
      keywords: [...(g.meta?.genres ?? []), g.meta?.developer ?? '', g.status],
      game: g,
      drillGame: g,
      keepOpen: true,
      run: () => enterGameLevel(g),
    }));
    const pinnedBrowseRows = pinnedIds
      .map((id) => gameRows.find((candidate) => candidate.game?.id === id))
      .filter((row): row is PaletteRow => Boolean(row))
      .map((row) => ({ ...row, id: `pinned-${row.id}`, group: 'Pinned' }));

    // Empty-query smart browse layout
    if (!q) {
      if (effectiveFilter === 'pages') return [...pinnedBrowseRows, ...staticRows.filter((r) => r.filterCat === 'pages')];
      if (effectiveFilter === 'actions') return [...pinnedBrowseRows, ...staticRows.filter((r) => r.filterCat === 'actions' && !r.secondary)];
      if (effectiveFilter === 'games') {
        const visibleGames = playableGames.slice(0, 30).map((g) => gameRows.find((r) => r.game?.id === g.id)!).filter(Boolean);
        const pinnedIdsSet = new Set(pinnedIds);
        return [...pinnedBrowseRows, ...visibleGames.filter((row) => !pinnedIdsSet.has(row.game?.id ?? ''))];
      }

      const out: PaletteRow[] = [];
      const seenIds = new Set<string>();
      const pushRow = (r: PaletteRow) => {
        if (seenIds.has(r.id)) return;
        seenIds.add(r.id);
        out.push(r);
      };

      // Pinned games are always the first section in browse mode.
      for (const id of pinnedIds) {
        const row = gameRows.find((candidate) => candidate.game?.id === id);
        if (row) pushRow({ ...row, id: `pinned-${row.id}`, group: 'Pinned' });
      }

      // Running-game actions follow pinned games.
      for (const r of staticRows.filter((x) => x.group === 'Now running')) pushRow(r);

      // Recent commands / games from palette history
      const allLookup = [...staticRows, ...gameRows];
      for (const rKey of recentKeys.slice(0, 5)) {
        const found = allLookup.find((r) => r.recentKey === rKey);
        if (found) pushRow({ ...found, id: `recent-${found.id}`, group: 'Recent' });
      }

      // 4. Recently played games
      const recentPlayed = playableGames.filter((g) => g.lastPlayed || g.playSecs > 0).slice(0, 5);
      for (const g of recentPlayed) {
        const gr = gameRows.find((r) => r.game?.id === g.id);
        if (gr) pushRow({ ...gr, group: 'Recently played' });
      }

      // 5. Primary Pages & Actions + smart command hints
      for (const r of staticRows.filter((x) => !x.secondary)) pushRow(r);

      // 6. Smart command mode shortcuts so users also discover `play:`, `genre:`, `theme:`
      if (playableGames.length > 0 && onPlay) {
        pushRow({
          id: 'mode-play',
          group: 'Smart commands',
          filterCat: 'actions',
          label: 'Play a game…',
          hint: 'Type play: to pick and launch any game',
          keywords: ['play:', 'launch:', 'start'],
          keepOpen: true,
          Icon: Play,
          run: () => {
            setQuery('play: ');
            setActive(0);
            requestAnimationFrame(() => inputRef.current?.focus());
          },
        });
      }
      if (genres.length > 0 && onGenre) {
        pushRow({
          id: 'mode-genre',
          group: 'Smart commands',
          filterCat: 'actions',
          label: 'Filter shelf by genre…',
          hint: 'Type genre: or @ to pick a genre',
          keywords: ['genre:', '@'],
          keepOpen: true,
          Icon: Tag,
          run: () => {
            setQuery('genre: ');
            setActive(0);
            requestAnimationFrame(() => inputRef.current?.focus());
          },
        });
      }

      return out;
    }

    // Non-empty general query: fuzzy-score across active filter categories
    const pool: PaletteRow[] = [];
    if (effectiveFilter === 'all' || effectiveFilter === 'pages') {
      pool.push(...staticRows.filter((r) => r.filterCat === 'pages'));
    }
    if (effectiveFilter === 'all' || effectiveFilter === 'actions') {
      pool.push(...staticRows.filter((r) => r.filterCat === 'actions'));
      // Include genres & themes when searching!
      if (onGenre) {
        for (const genre of genres) {
          pool.push({
            id: `genre-${genre.name}`,
            recentKey: `genre:${genre.name}`,
            group: 'Genres',
            filterCat: 'actions',
            label: `${genre.name} games`,
            hint: `${genre.count} on shelf`,
            keywords: ['genre', genre.name],
            Icon: Tag,
            run: () => onGenre(genre.name),
          });
        }
      }
      if (onSelectTheme) {
        for (const t of [...THEMES, ...customThemes]) {
          pool.push({
            id: `theme-${t.id}`,
            recentKey: `theme:${t.id}`,
            group: 'Themes',
            filterCat: 'actions',
            label: `Theme: ${t.name}`,
            hint: currentThemeId === t.id ? 'Active theme' : 'Apply theme',
            keywords: ['theme', 'appearance', t.name],
            checked: currentThemeId === t.id,
            accentDot: t.accent,
            Icon: Palette,
            run: () => onSelectTheme(t.id),
          });
        }
      }
    }
    if (effectiveFilter === 'all' || effectiveFilter === 'games') {
      pool.push(...gameRows);
    }

    const recentSet = new Map(recentKeys.map((k, idx) => [k, idx]));
    const scored = pool
      .map((row) => {
        const base = scoreRow(q, row);
        if (base === null) return null;
        const recIdx = row.recentKey !== undefined ? recentSet.get(row.recentKey) : undefined;
        const recBoost = recIdx !== undefined ? Math.max(4, 18 - recIdx * 2) : 0;
        const favBoost = row.game?.favorite ? 6 : 0;
        return { row, score: base + recBoost + favBoost };
      })
      .filter((x): x is { row: PaletteRow; score: number } => x !== null)
      .sort((a, b) => b.score - a.score);

    const topList = scored.slice(0, 24).map((x) => x.row);

    // Inline verbs for the best-matching game
    if (effectiveFilter === 'all') {
      const topGameHit = scored.find((x) => x.row.filterCat === 'games' && x.row.game && !x.row.game.planned);
      if (topGameHit?.row.game && topGameHit.score >= 120) {
        const g = topGameHit.row.game;
        const inlineVerbs = buildSingleGameActions(g, true).slice(0, 3);
        inlineVerbs.push({
          id: `inline-more-${g.id}`,
          group: g.title,
          filterCat: 'actions',
          label: `All actions for ${g.title}…`,
          hint: 'Status, folder, journal, settings',
          game: g,
          drillGame: g,
          keepOpen: true,
          Icon: ChevronRight,
          run: () => enterGameLevel(g),
        });
        // Insert right after the top game hits
        const insertAt = Math.min(topList.length, 3);
        topList.splice(insertAt, 0, ...inlineVerbs);
      }
    }

    const pinnedRows = pinnedIds
      .map((id) => gameRows.find((row) => row.game?.id === id))
      .filter((row): row is PaletteRow => Boolean(row))
      .filter((row) => scoreRow(q, row) !== null)
      .map((row) => ({ ...row, id: `pinned-${row.id}`, group: 'Pinned' }));
    return [...pinnedRows, ...topList.filter((row) => !pinnedIds.includes(row.game?.id ?? ''))].slice(0, 24);
  }, [
    customThemes,
    pinnedIds,
    currentThemeId,
    filter,
    games,
    genres,
    levelGame,
    onEditGame,
    onGame,
    onGenre,
    onOpenJournal,
    onPlay,
    onRevealGame,
    onSelectTheme,
    onStop,
    onToggleFavorite,
    onUpdateGame,
    parsed,
    playableGames,
    query,
    recentKeys,
    runningGame,
    runningId,
    staticRows,
  ]);

  useEffect(() => {
    setActive(0);
  }, [query, filter, gameLevel?.gameId]);

  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const el = container.querySelector<HTMLElement>(`[data-palette-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active, rows]);

  if (!open) return null;

  const safeActive = rows.length > 0 ? Math.min(active, rows.length - 1) : 0;
  const activeRow = rows[safeActive] ?? null;

  const executeRow = (row: PaletteRow) => {
    if (row.recentKey) {
      saveRecent(row.recentKey);
      setRecentKeys(loadRecent());
    }
    row.run();
    if (!row.keepOpen) onClose();
  };

  const togglePinned = (row: PaletteRow) => {
    const id = row.game?.id;
    if (!id) return;
    const next = pinnedIds.includes(id) ? pinnedIds.filter((value) => value !== id) : [id, ...pinnedIds];
    setPinnedIds(next);
    try { localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(next)); } catch { /* private mode */ }
    setContextMenu(null);
  };

  // Group only adjacent rows. Hoisting a repeated group name above intervening
  // rows makes visual order disagree with keyboard row indices.
  const grouped: { group: string; items: { row: PaletteRow; index: number }[] }[] = [];
  rows.forEach((row, index) => {
    const last = grouped[grouped.length - 1];
    if (last?.group === row.group) last.items.push({ row, index });
    else grouped.push({ group: row.group, items: [{ row, index }] });
  });

  const cycleFilter = (delta: 1 | -1) => {
    const idx = FILTERS.findIndex((f) => f.id === filter);
    const next = FILTERS[(idx + delta + FILTERS.length) % FILTERS.length]!;
    setFilter(next.id);
  };

  return (
    <div
      className="orbit-rise fixed inset-0 z-50 flex items-start justify-center bg-black/65 p-4 pt-[11vh] backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="orbit-pop flex w-full max-w-[780px] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            if (levelGame) exitGameLevel();
            else onClose();
            return;
          }
          if (e.key === 'Tab' && !levelGame && !parsed.verb) {
            e.preventDefault();
            cycleFilter(e.shiftKey ? -1 : 1);
            return;
          }
          if (e.key === 'Backspace' && query === '') {
            if (levelGame) {
              e.preventDefault();
              exitGameLevel();
              return;
            }
          }
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            e.stopPropagation();
            if (rows.length > 0) setActive((i) => (i + 1) % rows.length);
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            if (rows.length > 0) setActive((i) => (i - 1 + rows.length) % rows.length);
            return;
          }
          if (
            (e.key === 'ArrowRight' &&
              !levelGame &&
              activeRow?.drillGame &&
              (inputRef.current?.selectionStart ?? 0) >= query.length) ||
            (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !levelGame && activeRow?.drillGame)
          ) {
            e.preventDefault();
            enterGameLevel(activeRow.drillGame);
            return;
          }
          if (e.key === 'Enter' && activeRow) {
            e.preventDefault();
            executeRow(activeRow);
          }
        }}
      >
        {/* Top search & smart mode bar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <Search className="size-4 shrink-0 text-muted" />

          {levelGame && (
            <button
              type="button"
              onClick={exitGameLevel}
              className="inline-flex max-w-[13rem] items-center gap-1.5 rounded-lg border border-accent/50 bg-accent/12 px-2.5 py-1 text-xs font-semibold text-fg transition hover:border-accent"
              title="Back to all results (Backspace or Esc)"
            >
              <Cover game={levelGame} className="size-4 shrink-0 rounded-sm" />
              <span className="truncate">{levelGame.title}</span>
              <X className="size-3 shrink-0 text-muted" />
            </button>
          )}

          {!levelGame && parsed.verb && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-accent/50 bg-accent/12 px-2 py-0.5 text-[11px] font-semibold text-accent">
              {VERB_LABELS[parsed.verb]}
            </span>
          )}

          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              levelGame
                ? `Action for ${levelGame.title}…`
                : 'Search games, pages, or commands (play:, edit:, fav:, folder:, genre:)…'
            }
            aria-label="Command palette search"
            className="min-w-[160px] flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted"
          />

          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
              className="rounded-md p-1 text-muted hover:bg-panel2 hover:text-fg"
            >
              <X className="size-3.5" />
            </button>
          )}

          {!levelGame && !parsed.verb && (
            <div className="hidden sm:flex items-center gap-1 rounded-lg border border-line bg-bg/50 p-0.5" role="tablist" aria-label="Palette category">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="tab"
                  aria-selected={filter === f.id}
                  onClick={() => {
                    setFilter(f.id);
                    inputRef.current?.focus();
                  }}
                  className={`rounded-md px-2 py-1 text-[11px] font-semibold transition ${
                    filter === f.id ? 'bg-accent text-onaccent' : 'text-muted hover:text-fg'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Main body: ranked list plus side preview */}
        <div className="flex max-h-[62vh] min-h-[280px] divide-x divide-line">
          <div ref={listRef} className="min-w-0 flex-1 overflow-y-auto p-2">
            {grouped.length === 0 ? (
              <div className="px-4 py-12 text-center">
                <p className="text-sm font-medium text-fg">
                  {parsed.verb === 'stop' && !runningGame
                    ? 'No game is currently running'
                    : `Nothing matches “${query.trim()}”`}
                </p>
                <p className="mt-1 text-xs text-muted">
                  Try <code className="rounded bg-panel2 px-1.5 py-0.5 text-fg">play:</code> to launch a game,{' '}
                  <code className="rounded bg-panel2 px-1.5 py-0.5 text-fg">edit:</code> for game settings, or{' '}
                  <code className="rounded bg-panel2 px-1.5 py-0.5 text-fg">genre:</code> to filter.
                </p>
              </div>
            ) : (
              grouped.map((grp) => (
                <div key={`${grp.group}-${grp.items[0]?.index ?? 0}`} className="mb-2 last:mb-0">
                  <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-widest text-muted">
                    {grp.group}
                  </p>
                  {grp.items.map(({ row, index }) => {
                    const isSelected = index === safeActive;
                    const Icon = row.Icon;
                    return (
                      <div
                        key={row.id}
                        data-palette-idx={index}
                        onMouseEnter={(event) => {
                          const point = { x: event.clientX, y: event.clientY };
                          const previous = lastHoverPosition.current;
                          lastHoverPosition.current = point;
                          if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > 2) setActive(index);
                        }}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setContextMenu({ x: event.clientX, y: event.clientY, row });
                        }}
                        className={`group flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm transition ${
                          isSelected ? 'bg-accent/14 text-fg' : 'text-fg/90 hover:bg-panel2/70'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => executeRow(row)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          {row.game && !Icon ? (
                            <Cover
                              game={row.game}
                              className="h-9 w-7 shrink-0 rounded-md [&_span]:text-[9px]"
                              fit="cover"
                            />
                          ) : row.game && Icon ? (
                            <span className="relative h-9 w-7 shrink-0">
                              <Cover
                                game={row.game}
                                className="size-full rounded-md [&_span]:text-[9px]"
                                fit="cover"
                              />
                              <span className="absolute -bottom-1 -right-1 grid size-4 place-items-center rounded-full border border-line bg-panel text-accent shadow">
                                <Icon className="size-2.5" />
                              </span>
                            </span>
                          ) : row.accentDot && !Icon ? (
                            <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-panel2">
                              <span
                                className="size-2.5 rounded-full"
                                style={{ background: row.accentDot }}
                              />
                            </span>
                          ) : (
                            <span
                              className={`grid size-8 shrink-0 place-items-center rounded-lg border transition ${
                                isSelected
                                  ? 'border-accent/40 bg-accent/15 text-accent'
                                  : 'border-line bg-panel2 text-muted'
                              }`}
                            >
                              {Icon ? <Icon className="size-4" /> : <BookOpen className="size-4" />}
                            </span>
                          )}

                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate font-medium">{row.label}</span>
                              {row.game && runningId === row.game.id && (
                                <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-emerald-300">
                                  Running
                                </span>
                              )}
                              {row.checked && <Check className="size-3.5 shrink-0 text-accent" />}
                            </span>
                            {row.hint && (
                              <span className="block truncate text-[11.5px] text-muted">{row.hint}</span>
                            )}
                          </span>

                          {row.shortcut && <Kbd>{row.shortcut}</Kbd>}
                        </button>

                        {!levelGame && row.drillGame && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              enterGameLevel(row.drillGame!);
                            }}
                            title={`Actions for ${row.drillGame.title} (→)`}
                            aria-label={`Actions for ${row.drillGame.title}`}
                            className="grid size-7 shrink-0 place-items-center rounded-lg text-muted opacity-70 transition hover:bg-panel hover:text-fg group-hover:opacity-100"
                          >
                            <ChevronRight className="size-4" />
                          </button>
                        )}
                        {isSelected && (!row.drillGame || levelGame) && (
                          <CornerDownLeft className="size-3.5 shrink-0 text-accent" />
                        )}
                      </div>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {/* Side preview pane on desktop */}
          <aside className="hidden w-60 shrink-0 flex-col justify-between bg-bg/35 p-4 md:flex">
            {activeRow?.game ? (
              <GamePreview game={activeRow.game} running={runningId === activeRow.game.id} onToggleFavorite={onToggleFavorite} />
            ) : activeRow ? (
              <ActionPreview row={activeRow} />
            ) : (
              <div className="my-auto text-center text-xs text-muted">
                Type a command or game name
              </div>
            )}
          </aside>
        </div>

        {contextMenu && (
          <div className="fixed inset-0 z-[70]" onMouseDown={() => setContextMenu(null)}>
            <div
              role="menu"
              className="absolute w-44 rounded-lg border border-line bg-panel p-1.5 text-sm shadow-xl"
              style={{ left: Math.min(contextMenu.x, window.innerWidth - 176), top: Math.min(contextMenu.y, window.innerHeight - 190) }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              {contextMenu.row.game ? (
                <>
                  <button role="menuitem" type="button" className="w-full rounded-md px-2.5 py-2 text-left text-[13px] hover:bg-panel2" onClick={() => { onGame(contextMenu.row.game!.id); setContextMenu(null); onClose(); }}>
                    Open game details
                  </button>
                  {onPlay && !contextMenu.row.game.planned && <button role="menuitem" type="button" className="w-full rounded-md px-2.5 py-2 text-left text-[13px] hover:bg-panel2" onClick={() => { onPlay(contextMenu.row.game!.id); setContextMenu(null); onClose(); }}>Run game</button>}
                  <button role="menuitem" type="button" className="w-full rounded-md px-2.5 py-2 text-left text-[13px] hover:bg-panel2" onClick={() => togglePinned(contextMenu.row)}>
                    {pinnedIds.includes(contextMenu.row.game.id) ? 'Unpin from top' : 'Pin to top'}
                  </button>
                  {onEditGame && <button role="menuitem" type="button" className="w-full rounded-md px-2.5 py-2 text-left text-[13px] hover:bg-panel2" onClick={() => { onEditGame(contextMenu.row.game!.id); setContextMenu(null); onClose(); }}>Edit game</button>}
                </>
              ) : (
                <button role="menuitem" type="button" className="w-full rounded-md px-2.5 py-2 text-left text-[13px] hover:bg-panel2" onClick={() => { executeRow(contextMenu.row); setContextMenu(null); }}>
                  Open / Run
                </button>
              )}
              {contextMenu.row.recentKey && <button role="menuitem" type="button" className="w-full rounded-md px-2.5 py-2 text-left text-[13px] text-red-300 hover:bg-panel2" onClick={() => { const next = recentKeys.filter((key) => key !== contextMenu.row.recentKey); setRecentKeys(next); try { localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(next)); } catch { /* private mode */ } setContextMenu(null); }}>Remove from Recent</button>}
            </div>
          </div>
        )}

        {/* Footer keyboard hints */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-bg/40 px-4 py-2 text-[11px] text-muted">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <Kbd>↑↓</Kbd> navigate
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd>↵</Kbd> run
            </span>
            {!levelGame && activeRow?.drillGame && (
              <span className="inline-flex items-center gap-1">
                <Kbd>→</Kbd> game actions
              </span>
            )}
            {!levelGame && !parsed.verb && (
              <span className="hidden sm:inline-flex items-center gap-1">
                <Kbd>Tab</Kbd> filter
              </span>
            )}
            {levelGame && (
              <span className="inline-flex items-center gap-1">
                <Kbd>⌫</Kbd> back
              </span>
            )}
          </div>
          <span className="hidden sm:inline text-muted/80">
            Prefixes: <code className="text-fg/85">play:</code> <code className="text-fg/85">edit:</code>{' '}
            <code className="text-fg/85">fav:</code> <code className="text-fg/85">folder:</code>{' '}
            <code className="text-fg/85">genre:</code> <code className="text-fg/85">theme:</code>
          </span>
        </div>
      </div>
    </div>
  );
}

function GamePreview({ game, running, onToggleFavorite }: { game: Game; running: boolean; onToggleFavorite?: (id: string) => void }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="w-28 aspect-[2/3] overflow-hidden rounded-xl border border-line shadow-lg">
        <Cover game={game} className="size-full" fit="cover" />
      </div>
      <div className="mt-3 flex w-full items-start justify-center gap-1.5">
        <h4 className="line-clamp-2 min-w-0 flex-1 text-sm font-bold text-fg">{game.title}</h4>
        {onToggleFavorite && !game.planned && (
          <button
            type="button"
            aria-label={game.favorite ? `Remove ${game.title} from favorites` : `Add ${game.title} to favorites`}
            aria-pressed={game.favorite}
            title={game.favorite ? 'Remove favorite' : 'Add favorite'}
            onClick={() => onToggleFavorite(game.id)}
            className="grid size-7 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-panel2 hover:text-amber-300"
          >
            <Star className="size-4" fill={game.favorite ? 'currentColor' : 'none'} />
          </button>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5">
        {launcherLabel(game) !== 'Installed' && (
          <span className="rounded-md border border-line bg-panel px-2 py-0.5 text-[10.5px] font-medium text-muted">
            {launcherLabel(game)}
          </span>
        )}
        {running && (
          <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-300">
            Running
          </span>
        )}
      </div>

      <div className="mt-4 w-full space-y-1.5 border-t border-line pt-3 text-left text-[11.5px]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted">Played</span>
          <span className="font-semibold text-fg orbit-num">
            {game.playSecs > 0 ? fmtMinutes(game.playSecs / 60) : 'Never'}
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted">Last played</span>
          <span className="font-medium text-fg">{fmtRelative(game.lastPlayed)}</span>
        </div>
      </div>

      {(game.meta?.genres?.length ?? 0) > 0 && (
        <div className="mt-3 flex flex-wrap justify-center gap-1">
          {game.meta!.genres.slice(0, 3).map((g) => (
            <span key={g} className="rounded-full bg-panel2 px-2 py-0.5 text-[10px] text-muted">
              {g}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ActionPreview({ row }: { row: PaletteRow }) {
  const Icon = row.Icon ?? Pencil;
  return (
    <div className="my-auto flex flex-col items-center text-center">
      <div className="grid size-12 place-items-center rounded-2xl border border-line bg-panel2 text-accent">
        <Icon className="size-5" />
      </div>
      <h4 className="mt-3 text-sm font-bold text-fg">{row.label}</h4>
      <p className="mt-1 text-xs leading-relaxed text-muted">{row.hint}</p>
      {row.shortcut && (
        <div className="mt-3">
          <Kbd>{row.shortcut}</Kbd>
        </div>
      )}
    </div>
  );
}
