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
  Play,
  Plus,
  Save,
  ScrollText,
  Search,
  Settings as SettingsIcon,
  Tag,
} from 'lucide-react';
import type { Game, Page } from '../types';
import { Cover } from './ui/Cover';
import { fmtMinutes } from '../utils/format';
import { cn } from '../utils/cn';

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  Icon: typeof Search;
  group: PaletteGroup;
  run: () => void;
}

export type PaletteGroup =
  | 'Launch'
  | 'Games'
  | 'Genres'
  | 'Pages'
  | 'Actions'
  | 'Files';

/** The order rows are read in: what you can start, then where you can go. */
const GROUP_ORDER: PaletteGroup[] = ['Launch', 'Games', 'Genres', 'Pages', 'Actions', 'Files'];

const GROUP_TITLE: Record<PaletteGroup, string> = {
  Launch: 'Play now',
  Games: 'Games',
  Genres: 'Genres',
  Pages: 'Pages',
  Actions: 'Actions',
  Files: 'Files',
};

/**
 * The palette's own typing rules, so the screen and the keyboard agree.
 *
 * A query can open with a word that moves it to one kind of thing: `>` for an
 * action, `@` for a genre. Without that, typing "rpg" meant scrolling past
 * every game whose name happens to contain those letters before reaching the
 * one genre that is exactly it.
 */
function scopeOf(query: string): { scope: 'all' | 'actions' | 'genres'; needle: string } {
  const trimmed = query.trim();
  // No prefix required - typing filters everything naturally, like Heronite
  // Keep @ and > as optional hints but never require them
  if (trimmed.startsWith('>')) return { scope: 'all', needle: trimmed.slice(1).trim().toLowerCase() };
  if (trimmed.startsWith('@')) return { scope: 'all', needle: trimmed.slice(1).trim().toLowerCase() };
  return { scope: 'all', needle: trimmed.toLowerCase() };
}

/**
 * Ctrl K: one field over everything the app can open, start or jump to.
 *
 * The palette is about speed, so it does the things a player reaches for
 * mid-session: start a game (or stop the one running), narrow the library to a
 * genre, jump to a page, or reach an action. Typing filters every list at once
 * and Enter runs the first row, so the arrow keys are never required.
 *
 * The ordering is deliberate. What can be *started* comes first, because
 * `Play` is the one command somebody opens this for; then the games themselves;
 * then genres, which are the library's own answer to "what am I in the mood
 * for" - after that the pages and the actions, and the folders last.
 */
export function CommandPalette({
  open,
  games,
  onClose,
  onPage,
  onGame,
  onPlay,
  onGenre,
  runningId,
  onStop,
  onSettings,
  onAdd,
  onAddFolder,
  onTv,
  extra = [],
}: {
  open: boolean;
  games: Game[];
  onClose: () => void;
  onPage: (page: Page) => void;
  /** Opens a game's record; App brings the library forward with it. */
  onGame: (id: string) => void;
  /** Starts a game straight from the palette. */
  onPlay: (id: string) => void;
  /** Narrows the library to one genre and shows it. */
  onGenre: (genre: string) => void;
  /** The game that is running, if one is, so it can be offered as Stop. */
  runningId: string | null;
  onStop: () => void;
  onSettings: () => void;
  onAdd: () => void;
  onAddFolder?: () => void;
  onTv: () => void;
  /** App-specific actions and folders, so this file stays about the frame. */
  extra?: PaletteCommand[];
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

  const commands = useMemo<PaletteCommand[]>(() => {
    const pages: PaletteCommand[] = [
      { id: 'page-library', label: 'Library', hint: 'Everything you own', Icon: Library, group: 'Pages', run: () => onPage('library') },
      { id: 'page-statistics', label: 'Statistics', hint: 'Playtime, journal, backlog', Icon: ChartNoAxesColumn, group: 'Pages', run: () => onPage('statistics') },
      { id: 'page-sessions', label: 'Sessions', hint: 'Tracked playtime', Icon: ListOrdered, group: 'Pages', run: () => onPage('sessions') },
      { id: 'page-logs', label: 'Journal', hint: 'Notes and progress', Icon: ScrollText, group: 'Pages', run: () => onPage('logs') },
      { id: 'page-backlog', label: 'Backlog', hint: 'What comes next', Icon: NotebookPen, group: 'Pages', run: () => onPage('backlog') },
      { id: 'page-saves', label: 'Saves', hint: 'Safe copies', Icon: Save, group: 'Pages', run: () => onPage('saves') },
      { id: 'page-storage', label: 'Storage', hint: 'Drives and files', Icon: HardDrive, group: 'Pages', run: () => onPage('storage') },
      { id: 'page-settings', label: 'Settings', hint: 'Themes, sound, folders', Icon: SettingsIcon, group: 'Pages', run: onSettings },
    ];
    const actions: PaletteCommand[] = [
      { id: 'action-add', label: 'Add a game', hint: 'A program or a folder', Icon: Plus, group: 'Actions', run: onAdd },
      ...(onAddFolder
        ? [{ id: 'action-add-folder', label: 'Add from folder', hint: 'Find the games in a folder', Icon: FolderOpen, group: 'Actions' as const, run: onAddFolder }]
        : []),
      { id: 'action-tv', label: 'Stardeck', hint: 'Read the library from the couch', Icon: Gamepad2, group: 'Actions', run: onTv },
      { id: 'action-settings', label: 'Open Settings', hint: 'Themes, covers, backups', Icon: SettingsIcon, group: 'Actions', run: onSettings },
    ];
    return [...pages, ...actions, ...extra];
  }, [extra, onAdd, onAddFolder, onPage, onSettings, onTv]);

  const { scope, needle } = scopeOf(query);
  const matches = (label: string, hint = '') =>
    needle === '' || label.toLowerCase().includes(needle) || hint.toLowerCase().includes(needle);

  // Rows render grouped, so the run order has to be grouped too, or the index
  // a click carries points at a different row than the one under it.
  const visibleCommands = commands
    .filter((command) => matches(command.label, command.hint))
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));

  /**
   * Games, matched on their name or their developer.
   *
   * An empty field offers nothing here: a palette that opens as a list of every
   * game is the library again, and the library is already one keystroke away.
   * The game that is running is left out of Play now, since it is offered as
   * Stop below.
   */
  const visibleGames = needle
        ? games
            .filter((game) => game.title.toLowerCase().includes(needle) || (game.meta?.developer ?? '').toLowerCase().includes(needle))
            .slice(0, 6)
        : [];

  /** Genres raised from the library itself, so nothing is offered that holds nothing. */
  const visibleGenres = useMemo(() => {
    const counts = new Map<string, number>();
    for (const game of games) {
      for (const genre of game.meta?.genres ?? []) {
        const name = genre.trim();
        if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    const all = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    // With nothing typed, the four biggest genres are always offered: they are
    // the fastest way into a library of any size.
    if (!needle) return all.slice(0, 4).map(([name, count]) => ({ name, count }));
    return all.filter(([name]) => name.toLowerCase().includes(needle)).slice(0, 6).map(([name, count]) => ({ name, count }));
  }, [games, needle, scope]);

  /** Play (or Stop) sits above everything, and only once there is something to match. */
  const launchCommands: PaletteCommand[] = useMemo(() => {
    if (runningId) {
      const running = games.find((game) => game.id === runningId);
      if (!running) return [];
      if (needle && !matches(running.title, 'stop running session')) return [];
      return [{
        id: 'launch-stop',
        label: `Stop ${running.title}`,
        hint: 'End the session and keep the time',
        Icon: Gamepad2,
        group: 'Launch',
        run: onStop,
      }];
    }
    // Nothing is running: the best Play is the game the query found, or else
    // nothing at all. Offering "Play <random game>" would start something the
    // player did not ask for with one Enter.
    const first = visibleGames[0];
    if (!first) return [];
    return [{
      id: `launch-${first.id}`,
      label: `Play ${first.title}`,
      hint: 'Start it and open a session',
      Icon: Play,
      group: 'Launch',
      run: () => onPlay(first.id),
    }];
  }, [games, needle, onPlay, onStop, runningId, scope, visibleGames]);

  const total = launchCommands.length + visibleCommands.length + visibleGames.length + visibleGenres.length;

  useEffect(() => {
    if (cursor >= total) setCursor(Math.max(0, total - 1));
  }, [cursor, total]);

  // Keep the chosen row inside the scrolling list as the arrows move.
  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>(`[data-palette-row="${cursor}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!open) return null;

  // Run order matches render order: Launch, Games, Genres, then Pages/Actions/Files
  const flatCommands = visibleCommands;
  const flatGames = visibleGames;
  const flatGenres = visibleGenres;
  const launchLen = launchCommands.length;
  const gamesLen = flatGames.length;
  const genresLen = flatGenres.length;
  let runAt = 0;
  const choose = (index: number) => {
    if (index < launchLen) {
      const command = launchCommands[index];
      onClose();
      command.run();
      return;
    }
    let offset = launchLen;
    if (index < offset + gamesLen) {
      const game = flatGames[index - offset];
      onClose();
      onPage('library');
      onGame(game.id);
      return;
    }
    offset += gamesLen;
    if (index < offset + genresLen) {
      const genre = flatGenres[index - offset];
      onClose();
      onPage('library');
      onGenre(genre.name);
      return;
    }
    offset += genresLen;
    const command = flatCommands[index - offset];
    if (command) {
      onClose();
      command.run();
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

  /** One row of the list, with the shared selection and hover behaviour. */
  const Row = ({ index, children, onPick }: { index: number; children: React.ReactNode; onPick: () => void }) => (
    <button
      type="button"
      role="option"
      aria-selected={cursor === index}
      data-palette-row={index}
      onMouseMove={() => setCursor(index)}
      onClick={onPick}
      className={cn(
        'flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors',
        cursor === index ? 'bg-panel2 text-fg' : 'text-muted hover:bg-panel2/60 hover:text-fg',
      )}
    >
      {children}
    </button>
  );

  const sections: { title: string; render: () => React.ReactNode }[] = [
    {
      title: GROUP_TITLE.Launch,
      render: () =>
        launchCommands.map((command) => {
          const index = runAt++;
          return (
            <Row key={command.id} index={index} onPick={() => choose(index)}>
              <command.Icon className={cn('size-4 shrink-0', cursor === index ? 'text-accent' : 'text-muted')} strokeWidth={1.8} />
              <span className="min-w-0 flex-1 truncate font-medium">{command.label}</span>
              {command.hint && <span className="hidden shrink-0 text-[11px] text-muted sm:block">{command.hint}</span>}
              {cursor === index && <ArrowRight className="size-3.5 shrink-0 text-muted" />}
            </Row>
          );
        }),
    },
    {
      title: GROUP_TITLE.Games,
      render: () =>
        visibleGames.map((game) => {
          const index = runAt++;
          return (
            <Row key={game.id} index={index} onPick={() => choose(index)}>
              <Cover game={game} className="h-9 w-6 shrink-0 rounded [&_span]:text-[8px]" />
              <span className="min-w-0 flex-1 truncate font-medium">{game.title}</span>
              <span className="hidden shrink-0 text-[11px] text-muted sm:block">
                {game.playSecs > 0 ? fmtMinutes(game.playSecs / 60) : 'Not played'}
              </span>
              {cursor === index && <ArrowRight className="size-3.5 shrink-0 text-muted" />}
            </Row>
          );
        }),
    },
    {
      title: GROUP_TITLE.Genres,
      render: () =>
        visibleGenres.map((entry) => {
          const index = runAt++;
          return (
            <Row key={entry.name} index={index} onPick={() => choose(index)}>
              <Tag className={cn('size-4 shrink-0', cursor === index ? 'text-accent' : 'text-muted')} strokeWidth={1.8} />
              <span className="min-w-0 flex-1 truncate font-medium">{entry.name}</span>
              <span className="hidden shrink-0 text-[11px] text-muted sm:block">
                {entry.count} {entry.count === 1 ? 'game' : 'games'}
              </span>
              {cursor === index && <ArrowRight className="size-3.5 shrink-0 text-muted" />}
            </Row>
          );
        }),
    },
    ...GROUP_ORDER.filter((group) => group !== 'Launch' && group !== 'Games' && group !== 'Genres').map((group) => ({
      title: GROUP_TITLE[group],
      render: () =>
        visibleCommands
          .filter((command) => command.group === group)
          .map((command) => {
            const index = runAt++;
            return (
              <Row key={command.id} index={index} onPick={() => choose(index)}>
                <command.Icon className={cn('size-4 shrink-0', cursor === index ? 'text-accent' : 'text-muted')} strokeWidth={1.8} />
                <span className="min-w-0 flex-1 truncate font-medium">{command.label}</span>
                {command.hint && <span className="hidden shrink-0 text-[11px] text-muted sm:block">{command.hint}</span>}
                {cursor === index && <ArrowRight className="size-3.5 shrink-0 text-muted" />}
              </Row>
            );
          }),
    })),
  ];

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
            placeholder="Play a game, find a genre, or jump somewhere…"
            aria-label="Search games, genres, pages and actions"
            className="h-12 min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted/70"
            spellCheck={false}
            autoComplete="off"
          />
          <kbd className="hidden rounded border border-line px-1.5 py-0.5 text-[10px] font-medium text-muted sm:block">Esc</kbd>
        </div>

        <div ref={list} className="max-h-[52vh] overflow-y-auto py-2" role="listbox" aria-label="Results">
          {sections.map((section) => {
            const rows = section.render();
            const items = Array.isArray(rows) ? rows : [rows];
            if (items.length === 0 || items.every((item) => item === null || item === undefined || item === false)) return null;
            return (
              <div key={section.title} className="mb-1">
                <p className="orbit-kicker px-4 py-1.5">{section.title}</p>
                {items}
              </div>
            );
          })}

          {total === 0 && (
            <p className="px-4 py-8 text-center text-sm text-muted">
              Nothing matches “{query.trim()}”.
              <span className="mt-1 block text-[11px]">Type a game, genre, or page name.</span>
            </p>
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
