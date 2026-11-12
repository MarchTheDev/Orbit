import {
  HardDrive,
  LayoutGrid,
  Library,
  List,
  ListOrdered,
  NotebookPen,
  Orbit,
  Save,
  Search,
  Settings as SettingsIcon,
  ScrollText,
  Tv,
} from 'lucide-react';
import type { Page, Settings, ViewMode } from '../types';
import { Logo } from './ui/Logo';
import { MusicButton } from './MusicButton';
import { cn } from '../utils/cn';

// Sessions follows the library, with Journal before Backlog in the default
// order. The order can be rearranged in Settings, so this list is the default
// and the place every page is defined; `orderedTabs` turns it into whatever
// order the player arranged.
export type Tab = { id: Page; label: string; Icon: typeof Library };

export const TABS: Tab[] = [
  { id: 'library', label: 'Library', Icon: Library },
  { id: 'sessions', label: 'Sessions', Icon: ListOrdered },
  { id: 'logs', label: 'Journal', Icon: ScrollText },
  { id: 'backlog', label: 'Backlog', Icon: NotebookPen },
  { id: 'saves', label: 'Saves', Icon: Save },
  { id: 'storage', label: 'Storage', Icon: HardDrive },
];

/** The pages that read around the library rather than being part of it. */
export const STATS_PAGES: Page[] = ['sessions', 'logs', 'backlog', 'saves', 'storage'];

export function isStatsPage(page: Page): boolean {
  return STATS_PAGES.includes(page);
}

/**
 * The tabs, in the order the player put them.
 *
 * A saved order that does not mention a tab (because that tab was added later,
 * or the setting is from an older version) leaves it where it was defined rather
 * than dropping it, and an id that no longer exists is ignored, so a stale
 * setting can never hide a page.
 */
const PREVIOUS_DEFAULTS: Page[][] = [
  // The original default had Backlog before Journal and Storage before Saves.
  ['library', 'sessions', 'backlog', 'logs', 'storage', 'saves'],
  // Saves was moved ahead of Storage before the Journal/Backlog change.
  ['library', 'sessions', 'backlog', 'logs', 'saves', 'storage'],
];

export function orderedTabs(order: Page[] | undefined): Tab[] {
  // A saved copy of either previous default is still the default list, not a
  // player choice, so migrate it to the current Journal-before-Backlog order.
  if (!order || order.length === 0 || PREVIOUS_DEFAULTS.some((previous) => order.join() === previous.join())) return TABS;
  const known = new Map(TABS.map((t) => [t.id, t]));
  const seen = new Set<Page>();
  const out: Tab[] = [];
  for (const id of order) {
    const tab = known.get(id);
    if (tab && !seen.has(id)) {
      out.push(tab);
      seen.add(id);
    }
  }
  for (const tab of TABS) if (!seen.has(tab.id)) out.push(tab);
  return out;
}

const PAGE_META: Record<Page, { label: string; group: string }> = {
  library: { label: 'Library', group: 'Collection' },
  sessions: { label: 'Sessions', group: 'Activity' },
  logs: { label: 'Journal', group: 'Activity' },
  backlog: { label: 'Backlog', group: 'Activity' },
  saves: { label: 'Saves', group: 'Vault' },
  storage: { label: 'Storage', group: 'Vault' },
  settings: { label: 'Settings', group: 'System' },
};

/**
 * The app is split into categories rather than one long bar: what you own,
 * what you have been doing, and what keeps the files safe. The library gets
 * its own room at the top of the shelf because it is the front door.
 */
const NAV_GROUPS: { label: string; ids: Page[] }[] = [
  { label: 'Collection', ids: ['library'] },
  { label: 'Activity', ids: ['sessions', 'logs', 'backlog'] },
  { label: 'Vault', ids: ['saves', 'storage'] },
];

function orderedGroup(ids: Page[], order: Page[] | undefined): Tab[] {
  const tabs = orderedTabs(order);
  return ids
    .map((id) => tabs.find((tab) => tab.id === id))
    .filter((tab): tab is Tab => !!tab);
}

/**
 * The shelf on the left: where you are, and every other room in the app.
 *
 * It is fixed rather than part of the page, so the library scrolls under it
 * and a long session list never drags the navigation out of reach.
 */
export function Sidebar({
  page,
  setPage,
  order,
  gameCount,
  runningTitle,
  version,
  onTv,
  onOpenSettings,
}: {
  page: Page;
  setPage: (page: Page) => void;
  /** The player's order for the pages that read around the library. */
  order?: Page[];
  gameCount: number;
  runningTitle: string | null;
  /** The app's own version, read from the one VERSION file at build time. */
  version: string;
  onTv: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <aside className="orbit-sidebar fixed inset-y-0 left-0 z-40 hidden w-[232px] flex-col lg:flex">
      <button
        onClick={() => setPage('library')}
        className="orbit-logo flex h-16 shrink-0 items-center gap-2.5 px-5 text-left"
        title="Orbit"
        aria-label="Orbit"
      >
        <Logo className="size-7 text-accent" animated />
        <span className="text-[15px] font-extrabold tracking-[0.18em]">ORBIT</span>
        <span className="orbit-num ml-auto rounded-md border border-line/70 px-1.5 py-0.5 text-[10px] font-semibold tracking-normal text-muted">
          v{version}
        </span>
      </button>

      <nav className="flex-1 overflow-y-auto px-3 py-5" aria-label="Main">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="orbit-nav-group">
            <p className="orbit-kicker mb-2 px-2.5">{group.label}</p>
            <div className="space-y-0.5">
              {orderedGroup(group.ids, order).map((tab) => (
                <button
                  key={tab.id}
                  data-tab-id={tab.id}
                  aria-current={page === tab.id ? 'page' : undefined}
                  onClick={() => setPage(tab.id)}
                  className="orbit-nav-item"
                >
                  <tab.Icon className="size-[17px] shrink-0" strokeWidth={1.8} />
                  <span className="truncate">{tab.label}</span>
                  {tab.id === 'library' && gameCount > 0 && (
                    <span className="orbit-count">{gameCount}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-line/60 px-3 py-3">
        {runningTitle && (
          <div className="mb-2 flex items-center gap-2.5 rounded-lg bg-panel2/70 px-2.5 py-2">
            <span className="orbit-pulse size-1.5 shrink-0 rounded-full bg-emerald-400" />
            <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted">{runningTitle}</span>
          </div>
        )}
        <button
          onClick={onTv}
          aria-label="TV mode"
          className="orbit-nav-item"
        >
          <Tv className="size-[17px] shrink-0" strokeWidth={1.8} />
          TV mode
        </button>
        <button
          onClick={onOpenSettings}
          aria-current={page === 'settings' ? 'page' : undefined}
          className="orbit-nav-item"
        >
          <SettingsIcon className="size-[17px] shrink-0" strokeWidth={1.8} />
          Settings
        </button>
      </div>
    </aside>
  );
}

/**
 * The page's own bar: which room and page you are reading, the library's view
 * switch, search, TV mode and the sound.
 */
export function TopNav({
  page,
  setPage,
  view,
  setView,
  onOpenPalette,
  sound,
  setSound,
  showMusic,
  showBars,
  onOpenSettings,
  onTv,
}: {
  page: Page;
  setPage: (p: Page) => void;
  /** How the library is drawn. The switch only exists on that page. */
  view: ViewMode;
  setView: (v: ViewMode) => void;
  /** Opens the command palette. */
  onOpenPalette: () => void;
  /**
   * Opens Settings, optionally at one of its cards.
   *
   * Settings is a long page, and somebody pressing a button about the music
   * wants to arrive at the music rather than at the top of everything.
   */
  onOpenSettings: (at?: string) => void;
  /** The background music, so the bar can play it, hush it and set its level. */
  sound: Settings['sound'];
  setSound: (next: Settings['sound']) => void;
  /** Whether the controls are drawn at all. Settings decides. */
  showMusic: boolean;
  /** Whether the controls dance while the music plays. */
  showBars: boolean;
  /** Fills the screen with TV mode, the library as a couch sees it. */
  onTv: () => void;
}) {
  const meta = PAGE_META[page];

  return (
    <header className="orbit-topbar sticky top-0 z-30 border-b border-line/60 bg-bg/80 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button
          onClick={() => setPage('library')}
          className="orbit-logo grid size-9 shrink-0 place-items-center lg:hidden"
          aria-label="Orbit"
          title="Orbit"
        >
          <Logo className="size-7 text-accent" animated />
        </button>

        <div className="min-w-0 lg:w-52 lg:shrink-0">
          <p className="orbit-kicker hidden sm:block">{meta.group}</p>
          <h1 className="truncate text-[17px] font-semibold tracking-tight">{meta.label}</h1>
        </div>

        <div className="flex-1" />

        {page === 'library' && (
          <div
            className="hidden items-center gap-0.5 rounded-xl border border-line/70 bg-panel/60 p-1 sm:flex"
            role="group"
            aria-label="How the library is drawn"
          >
            {(
              [
                ['focus', Orbit, 'Focus'],
                ['grid', LayoutGrid, 'Catalogue'],
                ['list', List, 'List'],
              ] as const
            ).map(([mode, Icon, label]) => (
              <button
                key={mode}
                onClick={() => setView(mode)}
                title={label}
                aria-label={label}
                aria-pressed={view === mode}
                className={cn(
                  'grid size-8 place-items-center rounded-lg transition duration-150',
                  view === mode ? 'bg-panel2 text-fg' : 'text-muted hover:text-fg',
                )}
              >
                <Icon className={cn('size-4', view === mode && 'text-accent')} strokeWidth={1.8} />
              </button>
            ))}
          </div>
        )}

        {/* Search lives in the bar because it is the fastest way into a library
            of any size. It opens the palette rather than being a second field
            with a second set of results. */}
        <button
          onClick={onOpenPalette}
          aria-label="Search and command palette"
          title="Search everything · Ctrl K"
          className="flex h-9 items-center gap-2.5 rounded-xl border border-line/70 bg-panel/50 px-2.5 text-[12px] text-muted transition hover:border-line hover:text-fg md:w-56 md:pl-3"
        >
          <Search className="size-4" strokeWidth={1.9} />
          <span className="hidden flex-1 text-left md:inline">Search</span>
          <kbd className="hidden rounded-md border border-line/70 px-1.5 py-0.5 text-[9.5px] font-semibold tracking-wide text-muted/80 md:inline">
            Ctrl K
          </kbd>
        </button>

        {/* Beside the sound, because both are about the room rather than the
            library: one is what you hear and the other is what you sit back
            for. */}
        <button
          onClick={onTv}
          aria-label="TV mode"
          title="TV mode"
          className="grid size-9 shrink-0 place-items-center rounded-xl text-muted transition hover:bg-panel hover:text-fg"
        >
          <Tv className="size-[18px]" strokeWidth={1.8} />
        </button>
        {showMusic && (
          <MusicButton sound={sound} onChange={setSound} showBars={showBars} onOpenSettings={() => onOpenSettings('orbit-sound')} />
        )}
      </div>

      {/* Below the shelf's breakpoint the same categories become one row that
          can be swiped, so no page and no control is ever out of reach. */}
      <nav className="flex items-center gap-1 overflow-x-auto border-t border-line/50 px-4 py-2 lg:hidden" aria-label="Pages">
        {orderedTabs(undefined).map((tab) => (
          <button
            key={tab.id}
            aria-current={page === tab.id ? 'page' : undefined}
            onClick={() => setPage(tab.id)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition',
              page === tab.id ? 'bg-panel2 text-fg' : 'text-muted',
            )}
          >
            <tab.Icon className={cn('size-3.5', page === tab.id && 'text-accent')} strokeWidth={1.9} />
            {tab.label}
          </button>
        ))}
        <button
          aria-current={page === 'settings' ? 'page' : undefined}
          onClick={() => setPage('settings')}
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition',
            page === 'settings' ? 'bg-panel2 text-fg' : 'text-muted',
          )}
        >
          <SettingsIcon className={cn('size-3.5', page === 'settings' && 'text-accent')} strokeWidth={1.9} />
          Settings
        </button>
      </nav>
    </header>
  );
}
