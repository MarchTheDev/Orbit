/**
 * A page of the reworked surfaces, with sample data, for looking at them.
 *
 * Development only, reached at `/preview.html` on the dev server. Orbit's own
 * window is the real test, but it needs the desktop shell to have a library;
 * this renders whatever is finished so the shapes, spacing and type can be seen
 * in a browser before a build is made.
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Game, Settings } from '../types';
import { DEFAULT_SETTINGS, SAMPLE_GAMES } from '../data/sampleGames';
import { applyTheme } from '../data/themes';
import { StatisticsView, type StatsTab } from '../components/StatisticsView';
import { SettingsView } from '../components/SettingsView';
import { LogsView } from '../components/LogsView';
import { GameEditDialog } from '../components/detail/GameEditDialog';
import { AddGameModal } from '../components/modals/AddGameModal';
import { TvMode } from '../components/TvMode';
import '../index.css';

const games = SAMPLE_GAMES;
const settings: Settings = { ...DEFAULT_SETTINGS };

const TABS = ['stardeck', 'statistics', 'settings', 'journal', 'editor', 'add'] as const;
type Surface = (typeof TABS)[number];

function Preview() {
  const [surface, setSurface] = useState<Surface>('statistics');
  const [tab, setTab] = useState<StatsTab>('overview');
  const [editing, setEditing] = useState<Game | null>(null);
  const [localSettings, setLocalSettings] = useState<Settings>(settings);

  applyTheme(localSettings.theme);

  return (
    <div className="orbit-page">
      <div className="orbit-statsbar" style={{ marginBottom: 18 }}>
        <div className="orbit-period" role="group" aria-label="Surface">
          {TABS.map((id) => (
            <button key={id} aria-pressed={surface === id} onClick={() => setSurface(id)}>
              {id}
            </button>
          ))}
        </div>
        <span className="orbit-statsbar-lede">Development preview of the reworked surfaces, with sample data.</span>
      </div>

      {surface === 'stardeck' && (
        <div className="orbit-deck-preview" style={{ position: 'relative', height: '82vh', borderRadius: 18, overflow: 'hidden' }}>
          <TvMode
            games={games}
            onPlay={() => undefined}
            onStop={() => undefined}
            onDetails={() => undefined}
            onExit={() => setSurface('statistics')}
            runningId={null}
            sound={localSettings.sound}
            setSound={(sound) => setLocalSettings((current) => ({ ...current, sound }))}
            showMusic={false}
            showBars={false}
            onOpenSettings={() => setSurface('settings')}
          />
        </div>
      )}

      {surface === 'statistics' && (
        <StatisticsView
          games={games}
          journalGames={games}
          allGames={games}
          settings={localSettings}
          setSettings={(patch) => setLocalSettings((current) => ({ ...current, ...patch }))}
          onChanged={() => undefined}
          onOpenGame={() => undefined}
          onEditGame={(id) => setEditing(games.find((game) => game.id === id) ?? null)}
          onUpdate={() => undefined}
          onAddPlanned={() => undefined}
          onRemove={() => undefined}
          onBacklogStatus={() => undefined}
          onBacklogMembership={() => undefined}
          onJournalMembership={() => undefined}
          fetchMetadata
          tab={tab}
          onTab={setTab}
        />
      )}

      {surface === 'settings' && (
        <SettingsView
          settings={localSettings}
          setSettings={(patch) => setLocalSettings((current) => ({ ...current, ...patch }))}
          replaceSettings={() => undefined}
          onImportLauncher={() => undefined}
          onScanDrive={() => undefined}
          onOpenThemeManager={() => undefined}
          onClearLibrary={() => undefined}
          onReset={() => undefined}
          onLibraryChanged={() => undefined}
          update={null}
          onFoundUpdate={() => undefined}
          onOpenAlbum={() => undefined}
          section="orbit-details"
        />
      )}

      {surface === 'journal' && (
        <LogsView
          games={games.slice(0, 8)}
          allGames={games}
          onJournalMembership={() => undefined}
          onUpdate={() => undefined}
          onEditGame={(id) => setEditing(games.find((game) => game.id === id) ?? null)}
        />
      )}

      {surface === 'editor' && (
        <div>
          <p className="orbit-panelhint">Pick a game to open its editor.</p>
          <div className="orbit-topgames" style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))' }}>
            {games.slice(0, 6).map((game) => (
              <button key={game.id} className="orbit-topgame" onClick={() => setEditing(game)}>
                <b>{game.title}</b>
              </button>
            ))}
          </div>
        </div>
      )}

      {editing && (
        <GameEditDialog game={editing} onUpdate={() => undefined} onClose={() => setEditing(null)} />
      )}

      {surface === 'add' && (
        <AddGameModal
          onClose={() => setSurface('statistics')}
          onAdd={() => undefined}
          onImportLauncher={() => undefined}
          onScanFolder={() => undefined}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Preview />);
