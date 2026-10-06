import { useEffect, useRef, useState } from 'react';
import {
  Database,
  Download,
  FolderOpen,
  Ghost,
  GitBranch,
  GripVertical,
  HardDrive,
  Heart,
  Monitor,
  Palette,
  RefreshCw,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import type { Page, Settings } from '../types';
import { THEMES } from '../data/themes';
import { dataDir, dataDirSize, isNative, listDrives, revealInExplorer, type DriveInfo } from '../services/native';
import { openExternal } from '../services/desktop';
import { pickFolder } from '../services/desktop';
import { fmtBytes } from '../utils/format';
import { cn } from '../utils/cn';
import { btnBrowse, inputCls } from './ui/Modal';
import { Checkbox } from './ui/Checkbox';
import { Select } from './ui/Select';
import { btnAccent } from './ui/buttons';
import { APP_VERSION } from '../version';
import {
  RELEASES_URL,
  checkForUpdate,
  installUpdate,
  type InstallStep,
  type ReleaseInfo,
} from '../services/updates';
import { orderedTabs } from './TopNav';
import { useDragReorder } from '../hooks/useDragReorder';
import { moveInOrder } from '../utils/reorder';

/**
 * One setting, as a dropdown with the meaning of the choice underneath.
 *
 * Four rows of radios per setting took up most of the page to say what one line
 * and a dropdown say, and the hint under it changes with the choice rather than
 * listing every possibility at once.
 */
function Setting<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; hint: string }[];
}) {
  const current = options.find((o) => o.value === value) ?? options[0];
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{label}</p>
      <Select
        value={value}
        onChange={onChange}
        options={options}
        className="max-w-sm"
        menuClassName="max-w-sm"
        ariaLabel={label}
      />
      <p className="text-xs text-muted">{current.hint}</p>
    </div>
  );
}

/**
 * The tabs, in their current order, dragged about.
 *
 * The same pointer-based reordering the library and the backlog use, because
 * the webview reserves HTML5 drags for files dragged in from the desktop. Each
 * row shows what the tab is called in the bar, so the effect of a move is
 * visible here rather than only up top.
 */
function TabOrder({ order, onChange }: { order: Page[]; onChange: (next: Page[]) => void }) {
  const list = useRef<HTMLDivElement>(null);
  const { bind, dragging, over, active } = useDragReorder(
    (fromId, toId, after) => onChange(moveInOrder(order, fromId, toId, after) as Page[]),
    // A list, so the drop is decided by where the pointer is rather than by
    // which few pixels of a one-line row it happened to be over.
    { container: list },
  );
  const byId = new Map(orderedTabs([]).map((t) => [t.id, t]));

  return (
    <div ref={list} className={cn('space-y-1', active && 'cursor-grabbing')}>
      {order.map((id) => {
        const tab = byId.get(id);
        if (!tab) return null;
        return (
          <div
            key={id}
            {...bind(id)}
            className={cn(
              'flex items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2 text-sm transition',
              // The gap opens where the row would land, so a move is not a
              // surprise when the pointer is released.
              dragging === id && 'opacity-40',
              over === id && dragging !== id && 'border-accent bg-accent/10',
            )}
          >
            <GripVertical className="size-4 shrink-0 cursor-grab text-muted" />
            <tab.Icon className="size-4 shrink-0 text-accent" strokeWidth={1.8} />
            <span className="font-medium">{tab.label}</span>
            {id === 'library' && <span className="text-[11px] text-muted">the page Orbit opens on</span>}
          </div>
        );
      })}
    </div>
  );
}

export function SettingsView({
  settings,
  setSettings,
  onImportSteam,
  onClearLibrary,
  onReset,
  update,
  onFoundUpdate,
}: {
  settings: Settings;
  /** Takes a patch, so each field saves on its own. */
  setSettings: (patch: Partial<Settings>) => void;
  /** Opens the Steam import dialog. */
  onImportSteam: () => void;
  onClearLibrary: () => void;
  /** Games, sessions, notes and settings all returned to a fresh install. */
  onReset: () => void;
  /** The newer release the app already found when it opened, if there was one. */
  update: ReleaseInfo | null;
  /** Reports what a check from in here found, so the offer travels with the app. */
  onFoundUpdate: (info: ReleaseInfo | null) => void;
}) {
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [folder, setFolder] = useState('');
  const [where, setWhere] = useState<{ path: string; size: number } | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [installStep, setInstallStep] = useState<InstallStep | null>(null);
  const [updateNote, setUpdateNote] = useState('');

  const lookForUpdate = async () => {
    setChecking(true);
    setUpdateNote('');
    const found = await checkForUpdate();
    onFoundUpdate(found);
    setCheckedAt(Date.now());
    setChecking(false);
    if (!found) setUpdateNote(`Orbit is up to date. This is ${APP_VERSION}.`);
  };

  const install = async () => {
    if (!update) return;
    setUpdateNote('');
    try {
      const note = await installUpdate(update, setInstallStep);
      setUpdateNote(
        note ??
          'The installer has opened. Orbit can stay open; if it asks you to close Orbit, say yes and start it again afterwards.',
      );
    } catch (e) {
      setUpdateNote(`That did not work: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setInstallStep(null);
    }
  };

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

        {/* Part of the theme rather than a setting of its own: it decides what
            colour a cover is tinted with when the pointer is over it. */}
        <div className="mt-3">
          <Checkbox
            checked={settings.coverTint !== false}
            onChange={(v) => setSettings({ coverTint: v })}
            label="Tint a cover's hover with its own colours"
            hint="On: the glow behind the Play button is taken from the artwork, so each tile matches the game. Off: it uses Orbit's theme colours instead, so every tile matches the app."
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <GripVertical className="size-4 text-accent" />
          Tabs along the top
        </h2>
        <p className="text-sm text-muted">
          Press a tab and move it to put the pages you use most first. Settings is always last, wherever it would have
          been.
        </p>
        <TabOrder
          order={orderedTabs(settings.tabOrder).map((t) => t.id)}
          onChange={(next) => setSettings({ tabOrder: next })}
        />
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Monitor className="size-4 text-accent" />
          Orbit's window around a game
        </h2>
        <p className="text-sm text-muted">
          Both of these do nothing unless you pick something: Orbit never moves itself uninvited.
        </p>

        <Setting
          label="When a game starts"
          value={settings.window.onLaunch}
          onChange={(v) => setSettings({ window: { ...settings.window, onLaunch: v } })}
          options={[
            { value: 'nothing', label: 'Do nothing', hint: 'Orbit stays where it is.' },
            { value: 'minimize', label: 'Minimize', hint: 'Out of the way, still on the taskbar.' },
            {
              value: 'tray',
              label: 'Minimize to tray',
              hint: 'Off the screen and off the taskbar. Left click the tray icon to bring it back.',
            },
            {
              value: 'close',
              label: 'Close Orbit completely',
              hint: 'Orbit quits, and playtime is NOT tracked while it is closed. It is written down up to the moment it quits.',
            },
          ]}
        />
        {settings.window.onLaunch === 'close' && (
          <p className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-300">
            With this on, Orbit writes down nothing about how long you play: it is not running to see the game end. You
            can still say how long you played, by hand, afterwards.
          </p>
        )}

        <Setting
          label="When the game closes"
          value={settings.window.onClose}
          onChange={(v) => setSettings({ window: { ...settings.window, onClose: v } })}
          options={[
            { value: 'nothing', label: 'Do nothing', hint: 'Whatever Orbit was doing, it carries on doing.' },
            {
              value: 'show',
              label: 'Bring Orbit back',
              hint: 'Minimized, hidden or behind the game, it comes to the front when the session ends.',
            },
            { value: 'quit', label: 'Close Orbit completely', hint: 'The session is counted and saved first, then Orbit quits.' },
          ]}
        />
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
          <button className={cn(btnAccent, 'rounded-lg px-4 py-2 text-sm')}>Add folder</button>
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
        <p className="text-sm text-muted">Programs made alongside Orbit.</p>
        <button
          onClick={() => void openExternal('https://github.com/MarchTheDev/GhostHunterPro')}
          className="flex w-full items-start gap-3 rounded-xl border border-line bg-panel2 p-3 text-left transition hover:border-accent sm:w-auto sm:min-w-[24rem]"
        >
          <Ghost className="mt-0.5 size-5 shrink-0 text-accent" />
          <span>
            <span className="block text-sm font-semibold">Ghost Hunter Pro</span>
            <span className="block text-xs text-muted">Find and clean out game save files and leftover data.</span>
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

      {/* Updates, at the bottom of the page but reachable straight from the
          toast that says one is waiting: the id is what that scrolls to. */}
      <section id="orbit-updates" className="scroll-mt-8 space-y-3">
        <h2 className="flex items-center gap-2 font-semibold">
          <Download className="size-4 text-accent" />
          Updates
        </h2>
        <div className="space-y-3 rounded-xl border border-line bg-panel/60 p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium text-fg">Orbit {APP_VERSION}</p>
              <p className="text-xs text-muted">
                {update
                  ? `Version ${update.version} is ready to install.`
                  : checkedAt
                    ? 'Nothing newer just now.'
                    : 'Orbit looks for a new version when it opens.'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => void lookForUpdate()}
                disabled={checking}
                className={cn(btnAccent, 'rounded-lg px-3 py-1.5 text-xs')}
              >
                {checking ? 'Checking…' : 'Check now'}
              </button>
              {update && (
                <button
                  onClick={() => void install()}
                  disabled={installStep !== null}
                  className={cn(btnAccent, 'rounded-lg px-3 py-1.5 text-xs')}
                >
                  {installStep === 'downloading'
                    ? 'Downloading…'
                    : installStep === 'opening'
                      ? 'Opening…'
                      : `Install ${update.version}`}
                </button>
              )}
              <button
                onClick={() => void openExternal(update?.url ?? RELEASES_URL)}
                className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-xs hover:border-accent hover:text-fg"
              >
                <GitBranch className="size-3.5" />
                Release notes
              </button>
            </div>
          </div>

          {updateNote && <p className="text-xs text-muted">{updateNote}</p>}

          <Checkbox
            checked={settings.updateCheck !== false}
            onChange={(v) => setSettings({ updateCheck: v })}
            label="Look for a new version when Orbit opens"
            hint="One request to GitHub's public releases API. No account, no identifier, and nothing about your library is sent."
          />
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
        </div>
      </footer>
    </div>
  );
}