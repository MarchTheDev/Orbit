import { HardDrive, Library, ListOrdered, NotebookPen, ScrollText, Settings as SettingsIcon } from 'lucide-react';
import type { Page, Settings } from '../types';
import { Logo } from './ui/Logo';
import { MusicButton } from './MusicButton';

// Sessions sits right after the library, because that is the tab anyone reaches
// for next. The theme button is gone: themes live in Settings.
//
// The order can be rearranged in Settings, so this list is the default and the
// place every tab is defined; `orderedTabs` turns it into whatever order the
// player arranged.
export type Tab = { id: Page; label: string; Icon: typeof Library };

export const TABS: Tab[] = [
  { id: 'library', label: 'Library', Icon: Library },
  { id: 'sessions', label: 'Sessions', Icon: ListOrdered },
  { id: 'backlog', label: 'Backlog', Icon: NotebookPen },
  { id: 'logs', label: 'Journal', Icon: ScrollText },
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
export function orderedTabs(order: Page[] | undefined): Tab[] {
  if (!order || order.length === 0) return TABS;
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
  order,
  sound,
  setSound,
  showMusic,
  showBars,
  onOpenSettings,
}: {
  page: Page;
  setPage: (p: Page) => void;
  /**
   * Opens Settings, optionally at one of its cards.
   *
   * Settings is a long page, and somebody pressing a button about the music
   * wants to arrive at the music rather than at the top of everything.
   */
  onOpenSettings: (at?: string) => void;
  /** The player's own tab order from Settings; the default when absent. */
  order?: Page[];
  /** The background music, so the bar can play it, hush it and set its level. */
  sound: Settings['sound'];
  setSound: (next: Settings['sound']) => void;
  /** Whether the controls are drawn at all. Settings decides. */
  showMusic: boolean;
  /** Whether the controls dance while the music plays. */
  showBars: boolean;
}) {
  const tabs = orderedTabs(order);
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-base/80 backdrop-blur-xl">
      {/* The bar is the one thing that spans the whole window rather than sitting
          in a column: on a wide screen the logo belongs at the left edge and the
          settings button at the right, not both of them a hand's width in. */}
      <div className="flex w-full items-center gap-5 px-6 py-3">
        <button
          onClick={() => setPage('library')}
          className="flex items-center gap-2.5"
          title="Orbit"
          aria-label="Orbit"
        >
          <Logo className="size-7 drop-shadow-[0_2px_8px_var(--c-accent)]" animated />
          <span className="text-lg font-bold tracking-tight">Orbit</span>
        </button>

        <nav className="flex items-center gap-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setPage(t.id)}
              className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                page === t.id
                  ? 'bg-panel2 text-fg shadow-sm ring-1 ring-accent/40'
                  : 'text-muted hover:bg-panel/70 hover:text-fg'
              }`}
            >
              <t.Icon className="size-4" strokeWidth={1.8} />
              {t.label}
            </button>
          ))}
        </nav>

        <div className="flex-1" />
        {showMusic && (
          <MusicButton sound={sound} onChange={setSound} showBars={showBars} onOpenSettings={() => onOpenSettings('orbit-sound')} />
        )}
        <button
          onClick={() => setPage('settings')}
          aria-label="Settings"
          title="Settings"
          className={`rounded-full p-2 text-muted transition hover:bg-panel/70 hover:text-fg ${
            page === 'settings' ? 'text-fg ring-1 ring-accent/40' : ''
          }`}
        >
          <SettingsIcon className="size-5" strokeWidth={1.8} />
        </button>
      </div>
    </header>
  );
}
