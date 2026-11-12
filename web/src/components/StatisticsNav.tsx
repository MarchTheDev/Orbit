import { BarChart3 } from 'lucide-react';
import type { Page } from '../types';
import { orderedTabs } from './TopNav';
import { cn } from '../utils/cn';

/**
 * The tabs inside Statistics.
 *
 * Sessions, the Journal, the Backlog, Saves and Storage all read around the
 * library rather than being part of it, so they share one place in the bar and
 * one row of tabs here. Library itself is not a tab: it is the page this bar
 * sits under.
 */
export function StatisticsNav({
  page,
  setPage,
  order,
}: {
  page: Page;
  setPage: (page: Page) => void;
  /** The player's own order from Settings; the default when absent. */
  order?: Page[];
}) {
  const tabs = orderedTabs(order).filter((tab) => tab.id !== 'library');

  return (
    <div className="sticky top-16 z-20 border-b border-line/70 bg-bg/85 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1500px] items-center gap-4 overflow-x-auto px-6 py-2.5">
        <span className="orbit-kicker hidden shrink-0 items-center gap-2 sm:flex">
          <BarChart3 className="size-3.5" strokeWidth={1.9} />
          Statistics
        </span>
        <nav className="flex items-center gap-1 rounded-full border border-line/80 bg-panel/50 p-1" aria-label="Statistics pages">
          {tabs.map((tab) => {
            const active = page === tab.id;
            return (
              <button
                key={tab.id}
                data-stats-id={tab.id}
                aria-current={active ? 'page' : undefined}
                onClick={() => setPage(tab.id)}
                className={cn(
                  'flex h-8 shrink-0 items-center gap-2 rounded-full px-3 text-[12.5px] font-medium transition-colors',
                  active ? 'bg-panel2 text-fg shadow-sm shadow-black/20' : 'text-muted hover:text-fg',
                )}
              >
                <tab.Icon className={cn('size-3.5', active ? 'text-accent' : '')} strokeWidth={1.8} />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
