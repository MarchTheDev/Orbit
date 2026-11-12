import { HardDrive, Library, ListOrdered, NotebookPen, Save, ScrollText, Settings as SettingsIcon, Tv } from 'lucide-react';
import { useMemo } from 'react';
import type { Page, Settings } from '../types';
import { Logo } from './ui/Logo';
import { MusicButton } from './MusicButton';

export type Tab = { id: Page; label: string; Icon: typeof Library };

export const TABS: Tab[] = [
  { id: 'library', label: 'Library', Icon: Library },
  { id: 'sessions', label: 'Sessions', Icon: ListOrdered },
  { id: 'logs', label: 'Journal', Icon: ScrollText },
  { id: 'backlog', label: 'Backlog', Icon: NotebookPen },
  { id: 'saves', label: 'Saves', Icon: Save },
  { id: 'storage', label: 'Storage', Icon: HardDrive },
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

export function TopNav({
  page,
  setPage,
  order,
  sound,
  setSound,
  showMusic,
  showBars,
  onOpenSettings,
  onTv,
}: {
  page: Page;
  setPage: (page: Page) => void;
  onOpenSettings: (at?: string) => void;
  order?: Page[];
  sound: Settings['sound'];
  setSound: (next: Settings['sound']) => void;
  showMusic: boolean;
  showBars: boolean;
  onTv: () => void;
}) {
  const tabs = useMemo(() => orderedTabs(order), [order]);

  return (
    <aside className="orbit-sidebar" aria-label="Orbit navigation">
      <button
        type="button"
        onClick={() => setPage('library')}
        className="orbit-brand"
        title="Orbit Library"
        aria-label="Orbit Library"
      >
        <Logo className="size-8 shrink-0 text-fg" animated />
        <span>Orbit</span>
      </button>

      <nav className="orbit-side-nav" aria-label="Pages">
        <p className="orbit-side-label">Collection</p>
        {tabs.map(({ id, label, Icon }) => (
          <button
            type="button"
            key={id}
            onClick={() => setPage(id)}
            aria-current={page === id ? 'page' : undefined}
            title={label}
            className={`orbit-side-link${page === id ? ' is-active' : ''}`}
          >
            <Icon className="size-[18px] shrink-0" strokeWidth={1.8} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="orbit-side-footer">
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
  );
}
