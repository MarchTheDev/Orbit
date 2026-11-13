import { BarChart3, FolderOpen, Gamepad2, Library, Plus, Settings as SettingsIcon, X } from 'lucide-react';
import { useEffect } from 'react';
import type { Page } from '../types';
import { Logo } from './ui/Logo';

/** The small set of routes shown in the main menu. */
export const TABS: { id: Page; label: string; Icon: typeof Library }[] = [
  { id: 'library', label: 'Library', Icon: Library },
  { id: 'sessions', label: 'Statistics', Icon: BarChart3 },
];

/** Old saved orders migrate to the new single Statistics entry. */
export function orderedTabs(order?: Page[]) {
  const next = [...TABS];
  if (!order?.length) return next;
  const rank = new Map(order.map((id, index) => [id, index]));
  return next.sort((a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER));
}

export function TopNav({
  page,
  setPage,
  order,
  drawerOpen = false,
  onClose = () => {},
  onAddGame,
  onAddFolder,
  onConsole,
}: {
  page: Page;
  setPage: (page: Page) => void;
  order?: Page[];
  drawerOpen?: boolean;
  onClose?: () => void;
  onAddGame: () => void;
  onAddFolder: () => void;
  onConsole: () => void;
}) {
  const tabs = orderedTabs(order);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen, onClose]);

  const go = (next: Page) => {
    setPage(next);
    onClose();
  };
  const action = (callback: () => void) => {
    onClose();
    callback();
  };

  return (
    <>
      {drawerOpen && <button type="button" className="orbit-menu-scrim" aria-label="Close Orbit menu" onClick={onClose} />}
      <aside className={`orbit-menu-panel${drawerOpen ? ' is-open' : ''}`} aria-label="Orbit menu" aria-hidden={!drawerOpen}>
        <header className="orbit-menu-heading">
          <div className="orbit-menu-brand"><Logo className="size-8 shrink-0" animated /><span><b>Orbit</b><small>GAME COLLECTION</small></span></div>
          <button type="button" onClick={onClose} className="orbit-menu-close" aria-label="Close menu"><X size={17} /></button>
        </header>
        <nav className="orbit-menu-nav" aria-label="Main menu">
          {tabs.map(({ id, label, Icon }) => <button type="button" key={id} onClick={() => go(id)} aria-current={page === id ? 'page' : undefined} className={`orbit-menu-link${page === id ? ' is-active' : ''}`}><Icon size={17} strokeWidth={1.8} /><span>{label}</span></button>)}
          <div className="orbit-menu-divider" />
          <button type="button" onClick={() => action(onAddGame)} className="orbit-menu-link"><Plus size={17} strokeWidth={1.8} /><span>Add game</span></button>
          <button type="button" onClick={() => action(onAddFolder)} className="orbit-menu-link"><FolderOpen size={17} strokeWidth={1.8} /><span>Add from folder</span></button>
          <div className="orbit-menu-divider" />
          <button type="button" onClick={() => action(onConsole)} className="orbit-menu-link"><Gamepad2 size={17} strokeWidth={1.8} /><span>Console mode</span></button>
          <button type="button" onClick={() => go('settings')} aria-current={page === 'settings' ? 'page' : undefined} className={`orbit-menu-link${page === 'settings' ? ' is-active' : ''}`}><SettingsIcon size={17} strokeWidth={1.8} /><span>Settings</span></button>
        </nav>
      </aside>
    </>
  );
}
