import { BarChart3, Command, HardDrive, Library, ListOrdered, NotebookPen, Save, ScrollText, Settings as SettingsIcon, Tv } from 'lucide-react';
import type { Page, Settings } from '../types';
import { Logo } from './ui/Logo';
import { MusicButton } from './MusicButton';
import { cn } from '../utils/cn';

// Sessions follows the library, with Journal before Backlog in the default
// order. The theme button is gone: themes live in Settings.
//
// The order can be rearranged in Settings, so this list is the default and the
// place every page is defined; `orderedTabs` turns it into whatever order the
// player arranged.
export type Tab = { id: Page; label: string; Icon: typeof Library };

export const TABS: Tab[] = [
  { id: 'library', label: 'Library', Icon: Library },
  { id: 'sessions', label: 'Sessions', Icon: ListOrdered },
  { id: 'logs', label: 'Journal', Icon: ScrollText },
  { id: 'backlog', label: 'Backlog', Icon: NotebookPen },
  { id: 'saves', label: 'Saves', Icon: Save },
  { id: 'storage', label: 'Storage', Icon: HardDrive },
];

/** The pages that live inside Statistics rather than beside the library. */
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

export function TopNav({
  page,
  setPage,
  onOpenStatistics,
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
  /** Opens Statistics at the page it was last read on. */
  onOpenStatistics: () => void;
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
  const statsActive = isStatsPage(page);

  return (
    <header className="orbit-topbar sticky top-0 z-30 border-b border-line bg-bg/95 backdrop-blur-xl">
      {/* The bar is the one thing that spans the whole window rather than sitting
          in a column: on a wide screen the mark belongs at the left edge and the
          settings button at the right, not both of them a hand's width in. */}
      <div className="flex h-16 w-full items-center gap-5 px-6">
        <button
          onClick={() => setPage('library')}
          className="orbit-logo flex shrink-0 items-center gap-3 rounded-lg py-1 pr-1 text-left"
          title="Orbit"
          aria-label="Orbit"
        >
          <Logo className="size-7 text-accent" animated />
          <span className="flex flex-col leading-none">
            <span className="text-[15px] font-extrabold tracking-[0.24em]">ORBIT</span>
            <span className="mt-1 hidden text-[9px] font-medium uppercase tracking-[0.18em] text-muted sm:block">
              game observatory
            </span>
          </span>
        </button>

        <span aria-hidden className="hidden h-7 w-px shrink-0 bg-line md:block" />

        {/* Two places, not seven: the library and everything read around it. */}
        <nav className="flex items-stretch gap-0.5 self-stretch">
          {([
            { id: 'library' as const, label: 'Library', Icon: Library, active: page === 'library', onClick: () => setPage('library') },
            { id: 'stats' as const, label: 'Statistics', Icon: BarChart3, active: statsActive, onClick: onOpenStatistics },
          ]).map((item) => (
            <button
              key={item.id}
              data-tab-id={item.id}
              aria-current={item.active ? 'page' : undefined}
              onClick={item.onClick}
              className={cn(
                'relative flex shrink-0 items-center gap-2 px-3 text-[13px] font-medium transition-colors',
                item.active ? 'text-fg' : 'text-muted hover:text-fg',
              )}
            >
              <item.Icon className={cn('size-4', item.active ? 'text-accent' : '')} strokeWidth={1.7} />
              {item.label}
              <span
                aria-hidden
                className={cn(
                  'absolute inset-x-2 bottom-0 h-[2px] rounded-full transition-opacity',
                  item.active ? 'bg-accent opacity-100' : 'bg-transparent opacity-0',
                )}
              />
            </button>
          ))}
        </nav>

        <div className="flex-1" />
        <button
          onClick={onOpenPalette}
          aria-label="Command palette"
          title="Jump to anything · Ctrl K"
          className="rounded-lg p-2 text-muted transition hover:bg-panel hover:text-fg"
        >
          <Command className="size-5" strokeWidth={1.8} />
        </button>
        {/* Beside the sound, because both are about the room rather than the
            library: one is what you hear and the other is what you sit back
            for. */}
        <button
          onClick={onTv}
          aria-label="TV mode"
          title="TV mode"
          className="rounded-lg p-2 text-muted transition hover:bg-panel hover:text-fg"
        >
          <Tv className="size-5" strokeWidth={1.8} />
        </button>
        {showMusic && (
          <MusicButton sound={sound} onChange={setSound} showBars={showBars} onOpenSettings={() => onOpenSettings('orbit-sound')} />
        )}
        <button
          onClick={() => setPage('settings')}
          aria-label="Settings"
          title="Settings"
          className={cn(
            'rounded-lg p-2 transition hover:bg-panel hover:text-fg',
            page === 'settings' ? 'bg-panel text-accent' : 'text-muted',
          )}
        >
          <SettingsIcon className="size-5" strokeWidth={1.8} />
        </button>
      </div>
    </header>
  );
}
