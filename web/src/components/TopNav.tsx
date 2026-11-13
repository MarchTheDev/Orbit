import { useEffect, useRef, useState } from 'react';
import {
  ChartNoAxesColumn,
  FolderOpen,
  Gamepad2,
  HardDrive,
  Library,
  ListOrdered,
  NotebookPen,
  Plus,
  Save,
  ScrollText,
  Search,
  Settings as SettingsIcon,
} from 'lucide-react';
import type { Page, Settings } from '../types';
import { Logo } from './ui/Logo';
import { MusicButton } from './MusicButton';

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
 * One bar across the top of the window.
 *
 * The app's rooms live behind the burger rather than along an edge, so the
 * library gets the whole width. The search in the middle opens the palette
 * instead of owning a field: one field over every page and game is faster than
 * a field per page. Sound stays out here because a switch for something you can
 * hear belongs where the sound is.
 */
export function TopNav({
  page,
  onNavigate,
  onOpenPalette,
  sound,
  setSound,
  showMusic,
  showBars,
  onOpenSettings,
  onAdd,
  onAddFolder,
  onTv,
}: {
  page: Page;
  onNavigate: (next: Page) => void;
  onOpenPalette: () => void;
  /** The background music, so the bar can play it, hush it and set its level. */
  sound: Settings['sound'];
  setSound: (next: Settings['sound']) => void;
  /** Whether the sound controls are drawn at all. Settings decides. */
  showMusic: boolean;
  /** Whether the controls dance while the music plays. */
  showBars: boolean;
  onOpenSettings: () => void;
  onAdd: () => void;
  onAddFolder: () => void;
  /** Fills the screen with console mode, the library as a couch sees it. */
  onTv: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const burger = useRef<HTMLButtonElement>(null);

  // The menu belongs to the page it was opened on; navigating is how it closes.
  useEffect(() => setOpen(false), [page]);

  useEffect(() => {
    if (!open) return;
    const first = window.requestAnimationFrame(() => {
      menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    });
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menu.current?.contains(target) || burger.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      burger.current?.focus();
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.cancelAnimationFrame(first);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const go = (next: Page) => {
    onNavigate(next);
    setOpen(false);
  };
  const act = (run: () => void) => {
    setOpen(false);
    run();
  };

  return (
    <>
      <header className="orbit-topbar">
        <div className="orbit-topbar-left">
          <button className="orbit-brand" onClick={() => go('library')} title="Orbit" aria-label="Orbit">
            <Logo className="size-7 shrink-0 text-accent" animated />
            <span>ORBIT</span>
          </button>
          <button
            ref={burger}
            className="orbit-burger"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            aria-haspopup="menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            title={open ? 'Close menu' : 'Menu'}
          >
            <i /><i /><i />
          </button>
        </div>

        <button className="orbit-search" onClick={onOpenPalette} aria-label="Search games, pages and actions">
          <Search className="size-4 shrink-0" strokeWidth={1.8} />
          <span>Search games, pages and actions</span>
          <kbd>Ctrl K</kbd>
        </button>

        <div className="orbit-topbar-right">
          {showMusic && (
            <MusicButton sound={sound} onChange={setSound} showBars={showBars} onOpenSettings={onOpenSettings} />
          )}
        </div>
      </header>

      {open && (
        <div ref={menu} className="orbit-menu" role="menu" aria-label="Orbit">
          <button role="menuitem" className="orbit-menu-item" aria-current={page === 'library' ? 'page' : undefined} onClick={() => go('library')}>
            <Library className="size-[17px] shrink-0" strokeWidth={1.8} />
            Library
          </button>
          <button
            role="menuitem"
            className="orbit-menu-item"
            aria-current={page === 'statistics' ? 'page' : undefined}
            onClick={() => go('statistics')}
          >
            <ChartNoAxesColumn className="size-[17px] shrink-0" strokeWidth={1.8} />
            Statistics
            <small>Playtime, journal, backlog</small>
          </button>

          <div className="orbit-menu-sep" role="separator" />

          <button role="menuitem" className="orbit-menu-item" onClick={() => act(onAdd)}>
            <Plus className="size-[17px] shrink-0" strokeWidth={1.9} />
            Add game
          </button>
          <button role="menuitem" className="orbit-menu-item" onClick={() => act(onAddFolder)}>
            <FolderOpen className="size-[17px] shrink-0" strokeWidth={1.8} />
            Add from folder
          </button>

          <div className="orbit-menu-sep" role="separator" />

          <button
            role="menuitem"
            className="orbit-menu-item"
            onClick={onTv}
            aria-label="Console mode"
            title="Console mode"
          >
            <Gamepad2 className="size-[17px] shrink-0" strokeWidth={1.8} />
            Console mode
          </button>
          <button role="menuitem" className="orbit-menu-item" onClick={() => act(onOpenSettings)}>
            <SettingsIcon className="size-[17px] shrink-0" strokeWidth={1.8} />
            Settings
          </button>

          <div className="orbit-menu-sep" role="separator" />
          {/* Two rooms the menu deliberately leaves out: Saves and Storage are
              picked up when needed rather than browsed. */}
          <div className="orbit-menu-more">
            <button onClick={() => go('saves')} aria-current={page === 'saves' ? 'page' : undefined}>Saves</button>
            <button onClick={() => go('storage')} aria-current={page === 'storage' ? 'page' : undefined}>Storage</button>
          </div>
        </div>
      )}
    </>
  );
}
