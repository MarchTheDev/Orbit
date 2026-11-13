import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  ArrowRight,
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
import type { Game, Page } from '../types';
import { Cover } from './ui/Cover';
import { cn } from '../utils/cn';

interface Command {
  id: string;
  label: string;
  hint?: string;
  Icon: typeof Search;
  group: 'Pages' | 'Actions';
  run: () => void;
}

/**
 * Ctrl K: one field over everything the app can open.
 *
 * The palette is about speed, so it does the three things a player reaches for
 * mid-session: jump to a page, start something, or open a game's record. Typing
 * filters both the commands and the library at once, and Enter runs the first
 * result. Nothing here is the only way to do something: the bar, the toolbar
 * and the library all still work the way they did.
 */
export function CommandPalette({
  open,
  games,
  onClose,
  onPage,
  onGame,
  onSettings,
  onAdd,
  onAddFolder,
  onTv,
}: {
  open: boolean;
  games: Game[];
  onClose: () => void;
  onPage: (page: Page) => void;
  /** Opens a game's record; App brings the library forward with it. */
  onGame: (id: string) => void;
  onSettings: () => void;
  onAdd: () => void;
  onAddFolder?: () => void;
  onTv: () => void;
}) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setCursor(0);
    // Focus after the panel has mounted, so the browser does not move it back
    // to the button that opened the palette.
    const frame = window.requestAnimationFrame(() => input.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const pages: Command[] = [
      { id: 'page-library', label: 'Library', hint: 'Everything you own', Icon: Library, group: 'Pages', run: () => onPage('library') },
      { id: 'page-statistics', label: 'Statistics', hint: 'Playtime, journal, backlog', Icon: ChartNoAxesColumn, group: 'Pages', run: () => onPage('statistics') },
      { id: 'page-sessions', label: 'Sessions', hint: 'Tracked playtime', Icon: ListOrdered, group: 'Pages', run: () => onPage('sessions') },
      { id: 'page-logs', label: 'Journal', hint: 'Notes and progress', Icon: ScrollText, group: 'Pages', run: () => onPage('logs') },
      { id: 'page-backlog', label: 'Backlog', hint: 'What comes next', Icon: NotebookPen, group: 'Pages', run: () => onPage('backlog') },
      { id: 'page-saves', label: 'Saves', hint: 'Safe copies', Icon: Save, group: 'Pages', run: () => onPage('saves') },
      { id: 'page-storage', label: 'Storage', hint: 'Drives and files', Icon: HardDrive, group: 'Pages', run: () => onPage('storage') },
      { id: 'page-settings', label: 'Settings', hint: 'Themes, sound, folders', Icon: SettingsIcon, group: 'Pages', run: onSettings },
    ];
    const actions: Command[] = [
      { id: 'action-add', label: 'Add a game', hint: 'A program or a folder', Icon: Plus, group: 'Actions', run: onAdd },
      ...(onAddFolder
        ? [{ id: 'action-add-folder', label: 'Add from folder', hint: 'Find the games in a folder', Icon: FolderOpen, group: 'Actions' as const, run: onAddFolder }]
        : []),
      { id: 'action-tv', label: 'Console mode', hint: 'Read the library from the couch', Icon: Gamepad2, group: 'Actions', run: onTv },
    ];
    return [...pages, ...actions];
  }, [onAdd, onAddFolder, onPage, onSettings, onTv]);

  const needle = query.trim().toLowerCase();
  const matches = (label: string, hint = '') =>
    needle === '' || label.toLowerCase().includes(needle) || hint.toLowerCase().includes(needle);

  const visibleCommands = commands.filter((command) => matches(command.label, command.hint));
  // Games only once there is something to match: an empty palette should be a
  // short menu, not the whole library.
  const visibleGames = needle
    ? games
        .filter((game) => game.title.toLowerCase().includes(needle))
        .slice(0, 6)
    : [];
  const total = visibleCommands.length + visibleGames.length;

  useEffect(() => {
    if (cursor >= total) setCursor(Math.max(0, total - 1));
  }, [cursor, total]);

  // Keep the chosen row inside the scrolling list as the arrows move.
  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>(`[data-palette-row="${cursor}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!open) return null;

  const choose = (index: number) => {
    const command = visibleCommands[index];
    if (command) {
      onClose();
      command.run();
      return;
    }
    const game = visibleGames[index - visibleCommands.length];
    if (game) {
      onClose();
      onPage('library');
      onGame(game.id);
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setCursor((index) => (total === 0 ? 0 : (index + 1) % total));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((index) => (total === 0 ? 0 : (index - 1 + total) % total));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(cursor);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  const groups: { title: string; rows: Command[] }[] = [
    { title: 'Pages', rows: visibleCommands.filter((command) => command.group === 'Pages') },
    { title: 'Actions', rows: visibleCommands.filter((command) => command.group === 'Actions') },
  ];

  let row = 0;
  return (
    <div
      className="fixed inset-0 z-[55] bg-black/60 px-4 pt-[12vh]"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="palette-enter mx-auto w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl shadow-black/60"
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search className="size-4 shrink-0 text-muted" strokeWidth={1.8} />
          <input
            ref={input}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(0);
            }}
            placeholder="Jump to a page, a game, or an action…"
            aria-label="Search pages, games and actions"
            className="h-12 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted/70"
            spellCheck={false}
            autoComplete="off"
          />
          <kbd className="hidden rounded border border-line px-1.5 py-0.5 text-[10px] font-medium text-muted sm:block">Esc</kbd>
        </div>

        <div ref={list} className="max-h-[52vh] overflow-y-auto py-2" role="listbox" aria-label="Results">
          {groups.map((group) => {
            if (group.rows.length === 0) return null;
            return (
              <div key={group.title} className="mb-1">
                <p className="orbit-kicker px-4 py-1.5">{group.title}</p>
                {group.rows.map((command) => {
                  const index = row++;
                  return (
                    <button
                      key={command.id}
                      type="button"
                      role="option"
                      aria-selected={cursor === index}
                      data-palette-row={index}
                      onMouseMove={() => setCursor(index)}
                      onClick={() => choose(index)}
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors',
                        cursor === index ? 'bg-panel2 text-fg' : 'text-muted hover:bg-panel2/60 hover:text-fg',
                      )}
                    >
                      <command.Icon className={cn('size-4 shrink-0', cursor === index ? 'text-accent' : 'text-muted')} strokeWidth={1.8} />
                      <span className="min-w-0 flex-1 truncate font-medium">{command.label}</span>
                      {command.hint && <span className="hidden shrink-0 text-[11px] text-muted sm:block">{command.hint}</span>}
                      {cursor === index && <ArrowRight className="size-3.5 shrink-0 text-muted" />}
                    </button>
                  );
                })}
              </div>
            );
          })}

          {visibleGames.length > 0 && (
            <div>
              <p className="orbit-kicker px-4 py-1.5">Games</p>
              {visibleGames.map((game) => {
                const index = row++;
                return (
                  <button
                    key={game.id}
                    type="button"
                    role="option"
                    aria-selected={cursor === index}
                    data-palette-row={index}
                    onMouseMove={() => setCursor(index)}
                    onClick={() => choose(index)}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-1.5 text-left text-sm transition-colors',
                      cursor === index ? 'bg-panel2 text-fg' : 'text-muted hover:bg-panel2/60 hover:text-fg',
                    )}
                  >
                    <Cover game={game} className="h-9 w-6 shrink-0 rounded [&_span]:text-[8px]" />
                    <span className="min-w-0 flex-1 truncate font-medium">{game.title}</span>
                    {cursor === index && <ArrowRight className="size-3.5 shrink-0 text-muted" />}
                  </button>
                );
              })}
            </div>
          )}

          {total === 0 && (
            <p className="px-4 py-8 text-center text-sm text-muted">Nothing matches “{query.trim()}”.</p>
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-line px-4 py-2 text-[10px] text-muted">
          <span className="flex items-center gap-1"><kbd className="rounded border border-line px-1 py-0.5">↑</kbd><kbd className="rounded border border-line px-1 py-0.5">↓</kbd> move</span>
          <span className="flex items-center gap-1"><kbd className="rounded border border-line px-1 py-0.5">Enter</kbd> open</span>
          <span className="ml-auto">Ctrl K</span>
        </div>
      </div>
    </div>
  );
}
