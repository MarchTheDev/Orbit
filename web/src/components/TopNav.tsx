import { HardDrive, Library, ListOrdered, NotebookPen, Save, ScrollText, Settings as SettingsIcon, Tv, X } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import type { Page } from '../types';
import { Logo } from './ui/Logo';

export type Tab = { id: Page; label: string; Icon: typeof Library };

/** Kept in the player's chosen order inside the menu categories. */
export const TABS: Tab[] = [
  { id: 'library', label: 'Library', Icon: Library },
  { id: 'backlog', label: 'Backlog', Icon: NotebookPen },
  { id: 'sessions', label: 'Sessions', Icon: ListOrdered },
  { id: 'logs', label: 'Journal', Icon: ScrollText },
  { id: 'storage', label: 'Storage', Icon: HardDrive },
  { id: 'saves', label: 'Saves', Icon: Save },
];

const PREVIOUS_DEFAULTS: Page[][] = [
  ['library', 'sessions', 'backlog', 'logs', 'storage', 'saves'],
  ['library', 'sessions', 'backlog', 'logs', 'saves', 'storage'],
];

export function orderedTabs(order: Page[] | undefined): Tab[] {
  if (!order || order.length === 0 || PREVIOUS_DEFAULTS.some((previous) => order.join() === previous.join())) return TABS;
  const known = new Map(TABS.map((tab) => [tab.id, tab]));
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

const GROUP_FOR: Record<Exclude<Page, 'settings'>, string> = {
  library: 'Collection',
  backlog: 'Activity',
  sessions: 'Activity',
  logs: 'Activity',
  storage: 'Manage',
  saves: 'Manage',
};

export function TopNav({
  page,
  setPage,
  order,
  counts = {},
  onTv,
  drawerOpen = false,
  onClose = () => {},
}: {
  page: Page;
  setPage: (page: Page) => void;
  order?: Page[];
  counts?: Partial<Record<Page, number>>;
  onTv: () => void;
  drawerOpen?: boolean;
  onClose?: () => void;
}) {
  const tabs = useMemo(() => orderedTabs(order), [order]);
  const sections = useMemo(() => {
    const result: { label: string; tabs: Tab[] }[] = [];
    for (const tab of tabs) {
      const label = GROUP_FOR[tab.id as Exclude<Page, 'settings'>];
      const current = result.find((section) => section.label === label);
      if (current) current.tabs.push(tab);
      else result.push({ label, tabs: [tab] });
    }
    return result;
  }, [tabs]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [drawerOpen, onClose]);

  const navigate = (next: Page) => {
    setPage(next);
    onClose();
  };

  return (
    <>
      {drawerOpen && <button type="button" className="orbit-menu-scrim" aria-label="Close Orbit menu" onClick={onClose} />}
      <aside className={`orbit-menu-panel${drawerOpen ? ' is-open' : ''}`} aria-label="Orbit menu" aria-hidden={!drawerOpen}>
        <header className="orbit-menu-heading">
          <div className="orbit-menu-brand"><Logo className="size-8 shrink-0" animated /><span><b>Orbit</b><small>GAME COLLECTION</small></span></div>
          <button type="button" onClick={onClose} className="orbit-menu-close" aria-label="Close menu"><X size={17} /></button>
        </header>
        <nav className="orbit-menu-nav" aria-label="Pages">
          {sections.map((section) => (
            <section className="orbit-menu-group" key={section.label}>
              <h2>{section.label}</h2>
              {section.tabs.map(({ id, label, Icon }) => {
                const count = counts[id];
                return <button type="button" key={id} onClick={() => navigate(id)} aria-current={page === id ? 'page' : undefined} aria-label={count === undefined ? label : `${label}, ${count}`} className={`orbit-menu-link${page === id ? ' is-active' : ''}`}>
                  <Icon size={17} strokeWidth={1.8} /><span>{label}</span>{count !== undefined && <small>{count}</small>}
                </button>;
              })}
            </section>
          ))}
        </nav>
        <footer className="orbit-menu-footer">
          <button type="button" onClick={onTv} className="orbit-menu-link"><Tv size={17} strokeWidth={1.8} /><span>TV mode</span></button>
          <button type="button" onClick={() => navigate('settings')} aria-current={page === 'settings' ? 'page' : undefined} className={`orbit-menu-link${page === 'settings' ? ' is-active' : ''}`}><SettingsIcon size={17} strokeWidth={1.8} /><span>Settings</span></button>
        </footer>
      </aside>
    </>
  );
}
