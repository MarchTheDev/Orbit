import { Menu, Plus, Search } from 'lucide-react';
import { cn } from '../utils/cn';

/**
 * The strip along the top of the workspace: the way into the sidebar on small
 * windows, the one search field, a quiet health line, and the add button.
 *
 * Search opens the palette rather than being a second field with a second set
 * of results: it is the fastest way into a library of any size, and the grid
 * and list views keep their own live filter underneath it.
 */
export function WorkspaceBar({
  onMenu,
  onOpenPalette,
  runningTitle,
  onAdd,
}: {
  /** Opens the sidebar drawer below its breakpoint. */
  onMenu: () => void;
  /** Opens the command palette. */
  onOpenPalette: () => void;
  /** The game being played right now, when one is. */
  runningTitle: string | null;
  onAdd: () => void;
}) {
  return (
    <header className="orbit-workbar">
      <button
        onClick={onMenu}
        aria-label="Open menu"
        title="Menu"
        className="orbit-square-btn orbit-menu-btn"
      >
        <Menu className="size-[18px]" strokeWidth={1.8} />
      </button>

      <button
        onClick={onOpenPalette}
        aria-label="Search and command palette"
        title="Search everything · Ctrl K"
        className="orbit-search-trigger"
      >
        <Search className="size-4 shrink-0" strokeWidth={1.9} />
        <span className="flex-1 truncate text-left">Search your library</span>
        <kbd>Ctrl K</kbd>
      </button>

      <div className="orbit-workbar-actions">
        <span className={cn('orbit-ready', runningTitle && 'is-running')} role="status">
          <i aria-hidden />
          {runningTitle ? `Playing ${runningTitle}` : 'All systems ready'}
        </span>
        <button
          onClick={onAdd}
          className="orbit-square-btn"
          title="Add game"
          aria-label="Add game"
        >
          <Plus className="size-[18px]" strokeWidth={1.9} />
        </button>
      </div>
    </header>
  );
}
