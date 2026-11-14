import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Gamepad2, Library, Plus, Search, Settings, Tv, X } from 'lucide-react';
import type { Game, Page } from '../types';

interface Result {
  id: string;
  label: string;
  hint: string;
  Icon: typeof Search;
  run: () => void;
}

export function CommandPalette({
  open,
  games,
  onClose,
  onPage,
  onAdd,
  onAddFolder,
  onSettings,
  onConsole,
  onLaunch,
  onGameDetails,
}: {
  open: boolean;
  games: Game[];
  onClose: () => void;
  onPage: (page: Page) => void;
  onAdd: () => void;
  onAddFolder: () => void;
  onSettings: () => void;
  onConsole: () => void;
  onLaunch: (game: Game) => void;
  onGameDetails: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const results = useMemo<Result[]>(() => {
    const commands: Result[] = [
      { id: 'page-library', label: 'Library', hint: 'Browse your games', Icon: Library, run: () => onPage('library') },
      { id: 'page-statistics', label: 'Statistics', hint: 'Sessions, Backlog, Journal and Album', Icon: ArrowRight, run: () => onPage('sessions') },
      { id: 'page-storage', label: 'Storage', hint: 'Installed games and drives', Icon: ArrowRight, run: () => onPage('storage') },
      { id: 'page-saves', label: 'Saves', hint: 'Backups and cloud copies', Icon: ArrowRight, run: () => onPage('saves') },
      { id: 'action-add-game', label: 'Add a game', hint: 'Add a game manually', Icon: Plus, run: onAdd },
      { id: 'action-add-folder', label: 'Add games from folder', hint: 'Manually scan a folder', Icon: Plus, run: onAddFolder },
      { id: 'action-console', label: 'Open Launchpad', hint: 'Controller-friendly full-screen library', Icon: Tv, run: onConsole },
      { id: 'page-settings', label: 'Settings', hint: 'Configure Orbit', Icon: Settings, run: onSettings },
    ];
    const term = query.trim().toLocaleLowerCase();
    const commandResults = commands.filter((row) => !term || `${row.label} ${row.hint}`.toLocaleLowerCase().includes(term));
    if (!term) return commandResults;
    const normalize = (value: string) => value.toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    const gameResults = games.flatMap((game) => {
      const genres = game.meta?.genres ?? [];
      if (!normalize(`${game.title} ${genres.join(' ')}`).includes(normalize(term))) return [];
      const genreHint = genres.length ? genres.join(' · ') : 'Game in your library';
      const actions: Result[] = [];
      if (!game.planned && game.launch.kind !== 'none') actions.push({ id: `launch-${game.id}`, label: `Play ${game.title}`, hint: genreHint, Icon: Gamepad2, run: () => onLaunch(game) });
      actions.push({ id: `details-${game.id}`, label: `${game.title} · Details`, hint: genreHint, Icon: Library, run: () => onGameDetails(game.id) });
      return actions;
    }).slice(0, 12);
    return [...commandResults, ...gameResults];
  }, [games, onAdd, onAddFolder, onConsole, onGameDetails, onLaunch, onPage, onSettings, query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setCursor(0);
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);
  useEffect(() => setCursor((at) => Math.min(at, Math.max(0, results.length - 1))), [results.length]);
  if (!open) return null;

  const choose = (index: number) => {
    const result = results[index];
    if (!result) return;
    onClose();
    result.run();
  };
  return <div className="command-palette-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={(event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setCursor((at) => results.length ? (at + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length : 0);
      } else if (event.key === 'Enter') { event.preventDefault(); choose(cursor); }
      else if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    }}>
      <div className="command-palette-search"><Search size={17} /><input ref={input} value={query} onChange={(event) => { setQuery(event.target.value); setCursor(0); }} placeholder="Search games, genres, pages, actions…" aria-label="Search commands" /><kbd>ESC</kbd><button type="button" onClick={onClose} aria-label="Close command palette"><X size={16} /></button></div>
      <div className="command-palette-results" role="listbox" aria-label="Results">
        {results.length ? results.map((result, index) => <button type="button" role="option" aria-selected={cursor === index} key={result.id} onMouseEnter={() => setCursor(index)} onClick={() => choose(index)}><result.Icon size={16} /><span><b>{result.label}</b><small>{result.hint}</small></span><ArrowRight size={14} /></button>) : <p>No matching pages, commands, games or genres.</p>}
      </div>
      <footer><span>↑↓ navigate</span><span>↵ run</span><span>Searches titles and genres</span></footer>
    </section>
  </div>;
}
