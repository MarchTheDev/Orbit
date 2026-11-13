import { HardDrive, Library, ListOrdered, NotebookPen, Save, ScrollText, Settings as SettingsIcon, Tv } from 'lucide-react';
import { useMemo } from 'react';
import type { Page, Settings } from '../types';
import { Logo } from './ui/Logo';
import { MusicButton } from './MusicButton';

export type Tab = { id: Page; label: string; Icon: typeof Library };

/** Kept in the player's chosen order. The sidebar groups these routes below. */
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
  backlog: 'Collection',
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
  sound,
  setSound,
  showMusic,
  showBars,
  onOpenSettings,
  onTv,
  drawerOpen = false,
  onClose = () => {},
}: {
  page: Page;
  setPage: (page: Page) => void;
  onOpenSettings: (at?: string) => void;
  order?: Page[];
  counts?: Partial<Record<Page, number>>;
  sound: Settings['sound'];
  setSound: (next: Settings['sound']) => void;
  showMusic: boolean;
  showBars: boolean;
  onTv: () => void;
  drawerOpen?: boolean;
  onClose?: () => void;
}) {
  const tabs = useMemo(() => orderedTabs(order), [order]);
  const sections = useMemo(() => {
    const result: { label: string; tabs: Tab[] }[] = [];
    for (const tab of tabs) {
      const label = GROUP_FOR[tab.id as Exclude<Page, 'settings'>];
      const current = result[result.length - 1];
      if (current?.label === label) current.tabs.push(tab);
      else result.push({ label, tabs: [tab] });
    }
    return result;
  }, [tabs]);

  return (
    <>
      {drawerOpen && <button type="button" className="orbit-nav-scrim" aria-label="Close Orbit navigation" onClick={onClose} />}
      <aside className={`orbit-sidebar${drawerOpen ? ' is-open' : ''}`} aria-label="Orbit navigation">
      <button
        type="button"
        onClick={() => setPage('library')}
        className="orbit-brand"
        title="Orbit Library"
        aria-label="Orbit Library"
      >
        <Logo className="size-9 shrink-0 text-fg" animated />
        <span className="orbit-brand-copy">
          <b>Orbit</b>
          <small>GAME COLLECTION</small>
        </span>
      </button>

      <nav className="orbit-side-nav" aria-label="Pages">
        {sections.map((section, sectionIndex) => (
          <section className="orbit-nav-group" key={`${section.label}-${sectionIndex}`}>
            <h2 className="orbit-side-label">{section.label}</h2>
            <div className="orbit-nav-items">
              {section.tabs.map(({ id, label, Icon }) => {
                const count = counts[id];
                return (
                  <button
                    type="button"
                    key={id}
                    onClick={() => setPage(id)}
                    aria-current={page === id ? 'page' : undefined}
                    aria-label={count === undefined ? label : `${label}, ${count}`}
                    title={label}
                    className={`orbit-side-link${page === id ? ' is-active' : ''}`}
                  >
                    <Icon className="size-[18px] shrink-0" strokeWidth={1.8} />
                    <span>{label}</span>
                    {count !== undefined && <small className="orbit-side-count">{count}</small>}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </nav>

      <div className="orbit-side-footer">
        <p className="orbit-side-label">Orbit</p>
        <button type="button" onClick={onTv} aria-label="TV mode" className="orbit-side-link" title="TV mode">
          <Tv className="size-[18px] shrink-0" strokeWidth={1.8} />
          <span>TV mode</span>
        </button>
        {showMusic && (
          <div className="orbit-side-music">
            <MusicButton sound={sound} onChange={setSound} showBars={showBars} onOpenSettings={() => onOpenSettings('orbit-sound')} />
            <span>Music</span>
          </div>
        )}
        <button
          type="button"
          onClick={() => setPage('settings')}
          aria-current={page === 'settings' ? 'page' : undefined}
          className={`orbit-side-link${page === 'settings' ? ' is-active' : ''}`}
          title="Settings"
        >
          <SettingsIcon className="size-[18px] shrink-0" strokeWidth={1.8} />
          <span>Settings</span>
        </button>
      </div>
      </aside>
    </>
  );
}
