import {
  Library,
  ListOrdered,
  NotebookPen,
  Orbit,
  Save,
  Settings as SettingsIcon,
  ScrollText,
  Tv,
  HardDrive,
} from 'lucide-react';
import type { Page, Settings } from '../types';
import { Logo } from './ui/Logo';
import { MusicButton } from './MusicButton';
import { cn } from '../utils/cn';

/** Whole hours, the way the profile card reads: `248 hours`. */
function fmtHours(secs: number): string {
  const h = Math.round(Math.max(0, secs) / 3600);
  return `${h} ${h === 1 ? 'hour' : 'hours'}`;
}

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
 * The player's space, along the left edge of the window.
 *
 * The design the player drew in Figma is one column: the brand, the rooms of
 * the library under "Your space", and at the bottom the controls that belong
 * to the room (TV, sound, Settings) above a small card that says how much
 * library there is. The page itself never carries navigation.
 */
export function TopNav({
  page,
  setPage,
  order,
  gamesCount,
  backlogCount,
  totalSecs,
  sound,
  setSound,
  showMusic,
  showBars,
  onOpenSettings,
  onTv,
  open,
  onClose,
}: {
  page: Page;
  setPage: (p: Page) => void;
  /** The player's order for the pages. */
  order?: Page[];
  /** How many games the library holds, for the profile card. */
  gamesCount: number;
  /** How many entries wait on the Backlog page, for the nav badge. */
  backlogCount: number;
  /** Everything played, in seconds, for the profile card. */
  totalSecs: number;
  /** The background music, so the shelf can play it, hush it and set its level. */
  sound: Settings['sound'];
  setSound: (next: Settings['sound']) => void;
  /** Whether the controls are drawn at all. Settings decides. */
  showMusic: boolean;
  /** Whether the controls dance while the music plays. */
  showBars: boolean;
  /**
   * Opens Settings, optionally at one of its cards.
   *
   * Settings is a long page, and somebody pressing a button about the music
   * wants to arrive at the music rather than at the top of everything.
   */
  onOpenSettings: (at?: string) => void;
  /** Fills the screen with TV mode, the library as a couch sees it. */
  onTv: () => void;
  /** Below the drawer breakpoint the sidebar slides in over the page. */
  open?: boolean;
  onClose?: () => void;
}) {
  const tabs = orderedTabs(order);

  return (
    <>
      {open && <div className="orbit-side-veil md:hidden" onClick={onClose} aria-hidden />}
      <aside className={cn('orbit-side', open && 'is-open')} aria-label="Sidebar">
        <button
          onClick={() => {
            setPage('library');
            onClose?.();
          }}
          className="orbit-side-brand"
          title="Orbit"
          aria-label="Orbit"
        >
          <Logo className="size-7 shrink-0 text-accent" animated />
          <span>ORBIT</span>
        </button>

        <nav className="orbit-side-nav" aria-label="Main">
          <p className="orbit-side-caption">Your space</p>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              data-tab-id={tab.id}
              aria-current={page === tab.id ? 'page' : undefined}
              onClick={() => {
                setPage(tab.id);
                onClose?.();
              }}
              className="orbit-side-item"
            >
              <tab.Icon className="size-[17px] shrink-0" strokeWidth={1.8} />
              <span>{tab.label}</span>
              {tab.id === 'backlog' && <span className="orbit-side-count">{backlogCount}</span>}
            </button>
          ))}
        </nav>

        <div className="orbit-side-bottom">
          <div className="orbit-side-tools">
            {/* Beside the sound, because both are about the room rather than
                the library: one is what you hear and the other is what you sit
                back for. */}
            <button
              onClick={onTv}
              aria-label="TV mode"
              title="TV mode"
              className="orbit-side-item"
            >
              <Tv className="size-[17px] shrink-0" strokeWidth={1.8} />
              <span>TV mode</span>
            </button>
            {showMusic && (
              <MusicButton sound={sound} onChange={setSound} showBars={showBars} onOpenSettings={() => onOpenSettings('orbit-sound')} />
            )}
          </div>
          <button
            onClick={() => {
              onOpenSettings();
              onClose?.();
            }}
            aria-current={page === 'settings' ? 'page' : undefined}
            className="orbit-side-item"
          >
            <SettingsIcon className="size-[17px] shrink-0" strokeWidth={1.8} />
            <span>Settings</span>
          </button>
          <div className="orbit-side-profile">
            <div className="orbit-side-avatar" aria-hidden>
              <Orbit className="size-4" strokeWidth={2} />
            </div>
            <div>
              <strong>My library</strong>
              <span>
                {gamesCount} {gamesCount === 1 ? 'game' : 'games'} · {fmtHours(totalSecs)} played
              </span>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
