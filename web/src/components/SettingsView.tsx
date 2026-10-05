import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { Settings } from '../types';
import { THEMES } from '../data/themes';
import { dataDir, dataDirSize, isNative, listDrives, revealInExplorer, type DriveInfo } from '../services/native';
import { pickFolder } from '../services/desktop';
import { fmtBytes } from '../utils/format';
import { cn } from '../utils/cn';
import { btnBrowse, inputCls, labelCls } from './ui/Modal';

export function SettingsView({
  settings,
  setSettings,
  onClearLibrary,
  onReset,
}: {
  settings: Settings;
  /** Takes a patch, so each field saves on its own. */
  setSettings: (patch: Partial<Settings>) => void;
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
        <h2 className="mb-3 font-semibold">Theme</h2>
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
        <h2 className="font-semibold">Artwork and details</h2>
        <label className="flex items-start gap-3 rounded-xl border border-line bg-panel2/50 p-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={settings.fetchMetadata}
            onChange={(e) => setSettings({ fetchMetadata: e.target.checked })}
          />
          <span>
            Look games up on IGDB when they are added
            <span className="block text-xs text-muted">
              Adds a summary, genres and cover art. Needs credentials below. Turn it off to keep adding games offline.
            </span>
          </span>
        </label>

        <h3 className="pt-1 text-sm font-semibold">IGDB integration</h3>
        <p className="text-sm text-muted">
          Create an app at dev.twitch.tv to get a Client ID and an App Access Token. Both are stored on this machine only.
        </p>
        <label className="block">
          <span className={labelCls}>Client ID</span>
          <input value={settings.igdbClientId} onChange={(e) => setSettings({ igdbClientId: e.target.value })} placeholder="Client ID" className={inputCls} />
        </label>
        <label className="block">
          <span className={labelCls}>Access token</span>
          <input
            type="password"
            value={settings.igdbToken}
            onChange={(e) => setSettings({ igdbToken: e.target.value })}
            placeholder="Access token"
            className={inputCls}
          />
        </label>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">Library folders</h2>
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
          {settings.libraryFolders.length === 0 && <span className="text-sm text-muted">None yet — add one below.</span>}
        </div>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); addFolder(folder); }}>
          <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="D:\Games" className={`${inputCls} flex-1 font-mono`} />
          {isNative() && (
            <button type="button" className={btnBrowse} onClick={() => void pickFolder('Choose a library folder', folder || undefined).then((p) => p && addFolder(p))}>
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

      <section className="space-y-2">
        <h2 className="font-semibold">About</h2>
        <p className="text-sm text-muted">Orbit v0.1.0 · running in {isNative() ? 'desktop (Tauri)' : 'browser preview'} mode</p>
        {where && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <span className="break-all font-mono text-xs">{where.path}</span>
            <span className="shrink-0">{fmtBytes(where.size)}</span>
            <button
              onClick={() => void revealInExplorer(where.path)}
              className="shrink-0 rounded-lg border border-line px-2 py-0.5 text-xs hover:border-accent"
            >
              Open
            </button>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => {
              if (confirm('Delete every game, session and note, and put the settings back to how they were on first run?')) onReset();
            }}
            className="rounded-lg border border-rose-400/50 px-4 py-2 text-sm text-rose-400"
          >
            Reset everything
          </button>
          <button
            onClick={() => {
              if (confirm('Delete every game and session from Orbit? Your settings are kept.')) onClearLibrary();
            }}
            className="rounded-lg border border-line px-4 py-2 text-sm text-muted hover:border-rose-400/50 hover:text-rose-400"
          >
            Delete games only
          </button>
        </div>
      </section>
    </div>
  );
}