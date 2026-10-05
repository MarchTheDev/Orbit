import { useEffect, useState } from 'react';
import {
  Database,
  Download,
  FolderOpen,
  GitBranch,
  HardDrive,
  Heart,
  Palette,
  RefreshCw,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import type { Settings } from '../types';
import { THEMES } from '../data/themes';
import { dataDir, dataDirSize, isNative, listDrives, revealInExplorer, type DriveInfo } from '../services/native';
import { openExternal } from '../services/desktop';
import { pickFolder } from '../services/desktop';
import { fmtBytes } from '../utils/format';
import { cn } from '../utils/cn';
import { btnBrowse, inputCls } from './ui/Modal';
import { Checkbox } from './ui/Checkbox';

export function SettingsView({
  settings,
  setSettings,
  onImportSteam,
  onClearLibrary,
  onReset,
}: {
  settings: Settings;
  /** Takes a patch, so each field saves on its own. */
  setSettings: (patch: Partial<Settings>) => void;
  /** Opens the Steam import dialog. */
  onImportSteam: () => void;
  onClearLibrary: () => void;
  /** Games, sessions, notes and settings all returned to a fresh install. */
  onReset: () => void;
}) {
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [folder, setFolder] = useState('');
  const [where, setWhere] = useState<{ path: string; size: number } | null>(null);

  useEffect(() => {
    if (!isNative()) return;
    void listDrives().then(setDrives);
    void dataDir().then(async (path) => {
      if (!path) return;
      setWhere({ path, size: await dataDirSize() });
    });
  }, []);

  const addFolder = (path: string) => {
    const clean = path.trim().replace(/[\\/]+$/, '');
    if (!clean) return;
    if (!settings.libraryFolders.some((f) => f.toLowerCase() === clean.toLowerCase())) {
      setSettings({ libraryFolders: [...settings.libraryFolders, clean] });
    }
    setFolder('');
  };

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-8">
      <h1 className="text-2xl font-bold">Settings</h1>

      <section>
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <Palette className="size-4 text-accent" />
          Theme
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => setSettings({ theme: t.id })}
              className={cn(
                'overflow-hidden rounded-xl border-2 text-left transition',
                settings.theme === t.id ? 'border-accent' : 'border-line hover:border-muted',
              )}
            >
              <div className="flex h-16 items-center justify-center gap-2" style={{ background: t.bg }}>
                <span className="size-7 rounded-full" style={{ background: `linear-gradient(135deg, ${t.accent}, ${t.accent2})` }} />
                <span className="h-3 w-16 rounded" style={{ background: t.panel2 }} />
              </div>
              <div className="bg-panel px-3 py-2 text-sm font-medium">{t.name}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Sparkles className="size-4 text-accent" />
          Artwork and details
        </h2>
        <p className="text-sm text-muted">
          Orbit looks a game up by its title. The Steam catalogue answers with no key and nothing to set up, which is
          where descriptions, genres, release years and cover art come from by default.
        </p>

        <Checkbox
          checked={settings.fetchMetadata}
          onChange={(v) => setSettings({ fetchMetadata: v })}
          label="Look games up when they are added"
          hint="Fills in a summary, genres, cover art and HowLongToBeat times. Turn it off to add games offline."
        />

        <Checkbox
          checked={settings.autoFetchMetadata}
          onChange={(v) => setSettings({ autoFetchMetadata: v })}
          label="Fill in the gaps in the background"
          hint="Games already in the library, or ones added while offline, are looked up quietly, a few at a time."
        />

      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Download className="size-4 text-accent" />
          Steam library
        </h2>
        <p className="text-sm text-muted">
          Orbit can read the Steam library installed on this PC and bring games over. Nothing arrives without you
          asking: open the dialog below, tick what you want, and that is what is added. It is also where games that
          came in from Steam can be taken back out again.
        </p>
        <Checkbox
          checked={settings.steamOnLaunch}
          onChange={(v) => setSettings({ steamOnLaunch: v })}
          label="Check Steam for new games when Orbit starts"
          hint="Adds anything installed on Steam that is not in the library yet. It never removes or changes a game, and a game you removed by hand comes back the next time you launch. Off by default."
        />
        <button
          onClick={onImportSteam}
          className="flex items-center gap-2 rounded-lg border border-line bg-panel2 px-4 py-2 text-sm hover:border-accent"
        >
          <Download className="size-4" />
          Import from Steam…
        </button>
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <HardDrive className="size-4 text-accent" />
          Library folders
        </h2>
        <p className="text-sm text-muted">
          Games inside these folders are yours as far as Orbit is concerned: it can report what they take and move them
          between the folders you list. Anything added from elsewhere is listed but never touched.
        </p>
        <div className="flex flex-wrap gap-2">
          {settings.libraryFolders.map((f) => (
            <span key={f} className="flex items-center gap-2 rounded-lg border border-line bg-panel px-3 py-1.5 font-mono text-sm">
              {f}
              <button
                onClick={() => setSettings({ libraryFolders: settings.libraryFolders.filter((x) => x !== f) })}
                className="text-muted hover:text-rose-400"
                aria-label={`Remove ${f}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          {settings.libraryFolders.length === 0 && <span className="text-sm text-muted">None yet, add one below.</span>}
        </div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addFolder(folder); }}>
          <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="D:\Games" className={`${inputCls} flex-1 font-mono`} />
          {isNative() && (
            <button type="button" className={`${btnBrowse} flex items-center gap-2`} onClick={() => void pickFolder('Choose a library folder', folder || undefined).then((p) => p && addFolder(p))}>
              <FolderOpen className="size-4" />
              Browse…
            </button>
          )}
          <button className="rounded-lg bg-accent px-4 text-sm text-white">Add folder</button>
        </form>
        {drives.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {drives.map((d) => (
              <button
                key={d.drive}
                onClick={() => addFolder(`${d.drive}\\Games`)}
                className="rounded-lg border border-line bg-panel2 px-3 py-1.5 text-xs hover:border-accent"
              >
                Use {d.drive}\Games · {fmtBytes(d.free)} free
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Wand2 className="size-4 text-accent" />
          Other tools
        </h2>
        <p className="text-sm text-muted">
          Programs made alongside Orbit. They install separately and Orbit only opens the page for them.
        </p>
        <button
          onClick={() => void openExternal('https://github.com/MarchTheDev/GhostHunterPro')}
          className="flex w-full items-start gap-3 rounded-xl border border-line bg-panel2 p-3 text-left transition hover:border-accent sm:w-auto sm:min-w-[24rem]"
        >
          <Wand2 className="mt-0.5 size-5 shrink-0 text-accent" />
          <span>
            <span className="block text-sm font-semibold">Ghost Hunter Pro</span>
            <span className="block text-xs text-muted">
              Find and clean out game save files and leftover data. Opens on GitHub.
            </span>
          </span>
        </button>
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <Database className="size-4 text-accent" />
          About
        </h2>
        <p className="text-sm text-muted">Orbit v0.1.0 · running in {isNative() ? 'desktop (Tauri)' : 'browser preview'} mode</p>
        {where && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <span className="break-all font-mono text-xs">{where.path}</span>
            <span className="shrink-0">{fmtBytes(where.size)}</span>
            <button
              onClick={() => void revealInExplorer(where.path)}
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2 py-0.5 text-xs hover:border-accent"
            >
              <FolderOpen className="size-3" />
              Open
            </button>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              if (confirm('Delete every game, session and note, and put the settings back to how they were on first run?')) onReset();
            }}
            className="flex items-center gap-2 rounded-lg border border-rose-400/50 px-4 py-2 text-sm text-rose-400"
          >
            <RefreshCw className="size-4" />
            Reset everything
          </button>
          <button
            onClick={() => {
              if (confirm('Delete every game and session from Orbit? Your settings are kept.')) onClearLibrary();
            }}
            className="flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm text-muted hover:border-rose-400/50 hover:text-rose-400"
          >
            <Trash2 className="size-4" />
            Delete games only
          </button>
        </div>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6 text-sm text-muted">
        <p className="flex items-center gap-1.5">
          Made with <Heart className="size-3.5 text-rose-400" fill="currentColor" strokeWidth={0} /> by TheMarch88
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void openExternal('https://github.com/MarchTheDev/Orbit')}
            className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 hover:border-accent hover:text-fg"
          >
            <GitBranch className="size-4" />
            Orbit on GitHub
          </button>
          <button
            onClick={() => void openExternal('https://github.com/MarchTheDev')}
            className="text-xs hover:text-fg hover:underline"
          >
            Everything else TheMarch88 has made
          </button>
        </div>
      </footer>
    </div>
  );
}