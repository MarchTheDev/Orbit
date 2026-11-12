import {
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
  HardDrive,
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

/**
 * The whole app's bar, at the top of the window.
 *
 * Heronite's room has one bar: the brand, the rooms you can walk into, and the
 * controls that belong to the room rather than to a page. Orbit keeps that
 * shape, so the library's artwork can run the full width of the window instead
 * of stopping at a shelf.
 */
export function TopNav({
  page,
  setPage,
  order,
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
  /** The player's order for the pages. */
  order?: Page[];
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
  const tabs = orderedTabs(order);

  return (
    <header className="orbit-topbar sticky top-0 z-30 border-b border-line/50 bg-bg/55 backdrop-blur-2xl">
      <div className="flex h-16 items-center gap-1 px-4 sm:gap-2 sm:px-6">
        <button
          onClick={() => setPage('library')}
          className="orbit-logo mr-1 flex shrink-0 items-center gap-2.5 pr-1 text-left"
          title="Orbit"
          aria-label="Orbit"
        >
          <Logo className="size-7 text-accent" animated />
          <span className="hidden text-[14px] font-extrabold tracking-[0.19em] sm:inline">ORBIT</span>
        </button>

        {/* The rooms, named the way the player named them. A long custom order
            scrolls rather than pushing the search field off the bar. */}
        <nav className="hidden min-w-0 flex-1 items-stretch self-stretch overflow-x-auto md:flex" aria-label="Main">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              data-tab-id={tab.id}
              aria-current={page === tab.id ? 'page' : undefined}
              aria-label={tab.label}
              title={tab.label}
              onClick={() => setPage(tab.id)}
              className={cn(
                'orbit-topnav-item flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-[13px]',
                page === tab.id
                  ? 'border-accent font-semibold text-fg'
                  : 'border-transparent font-medium text-muted hover:text-fg',
              )}
            >
              <tab.Icon className="size-3.5 shrink-0" strokeWidth={1.9} />
              <span className="hidden xl:inline">{tab.label}</span>
            </button>
          ))}
        </nav>

        <div className="flex-1 md:hidden" />

        {page === 'library' && (
          <div
            className="hidden items-center rounded-xl border border-line/60 bg-panel/40 p-0.5 sm:flex"
            role="group"
            aria-label="How the library is drawn"
          >
            {(
              [
                ['focus', Orbit, 'Focus'],
                ['grid', LayoutGrid, 'Grid'],
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
                  'flex h-8 items-center gap-1.5 rounded-[10px] px-2.5 text-[11.5px] font-medium transition duration-150',
                  view === mode ? 'bg-panel2 text-fg shadow-sm' : 'text-muted hover:text-fg',
                )}
              >
                <Icon className={cn('size-3.5', view === mode && 'text-accent')} strokeWidth={1.8} />
                <span className="hidden lg:inline">{label}</span>
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
          className="flex h-9 shrink-0 items-center gap-2.5 rounded-full border border-line/60 bg-panel/40 px-3 text-[12px] text-muted transition hover:border-line hover:text-fg lg:w-56 lg:pl-3.5"
        >
          <Search className="size-4" strokeWidth={1.9} />
          <span className="hidden flex-1 text-left lg:inline">Search games</span>
          <kbd className="hidden rounded-md border border-line/60 px-1.5 py-0.5 text-[9.5px] font-semibold tracking-wide text-muted/80 lg:inline">
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
          className="grid size-9 shrink-0 place-items-center rounded-full text-muted transition hover:bg-panel hover:text-fg"
        >
          <Tv className="size-[18px]" strokeWidth={1.8} />
        </button>
        {showMusic && (
          <MusicButton sound={sound} onChange={setSound} showBars={showBars} onOpenSettings={() => onOpenSettings('orbit-sound')} />
        )}
        <button
          onClick={() => onOpenSettings()}
          aria-label="Settings"
          title="Settings"
          aria-current={page === 'settings' ? 'page' : undefined}
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-full transition hover:bg-panel',
            page === 'settings' ? 'text-fg' : 'text-muted hover:text-fg',
          )}
        >
          <SettingsIcon className="size-[18px]" strokeWidth={1.8} />
        </button>
      </div>

      {/* Below the breakpoint the rooms become one row that can be swiped, so
          no page is ever out of reach. */}
      <nav className="flex items-center gap-1 overflow-x-auto border-t border-line/40 px-3 py-1.5 md:hidden" aria-label="Pages">
        {tabs.map((tab) => (
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
      </nav>
    </header>
  );
}
