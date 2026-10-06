import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Database,
  Download,
  FolderOpen,
  Library as LibraryIcon,
  Ghost,
  GitBranch,
  GripVertical,
  Heart,
  ListChecks,
  Monitor,
  Palette,
  Piano,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Volume2,
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
import { driveLabel } from '../utils/drive';
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
      <p className="text-xs leading-relaxed text-muted">{current.hint}</p>
    </div>
  );
}

/**
 * One part of the page, as a card with a heading on it.
 *
 * The settings used to be one long column of headings over switches, which read
 * as a wall of text however short each line was. A card gives each group an
 * edge to be seen against, an icon to be recognised by, and a sentence at the
 * top saying what the group is for, so nothing has to be read from the top to
 * find the one thing somebody came here for.
 */
function Section({
  id,
  icon: Icon,
  title,
  lead,
  children,
}: {
  id: string;
  icon: typeof Palette;
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-28 rounded-3xl border border-line/90 bg-gradient-to-br from-panel/95 via-panel/85 to-panel2/65 p-5 shadow-[0_18px_42px_-30px_rgba(0,0,0,0.9)] transition-shadow sm:p-6"
    >
      <div className="flex items-start gap-3.5">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl border border-accent/25 bg-gradient-to-br from-accent/20 to-accent2/10 text-accent shadow-inner">
          <Icon className="size-[18px]" strokeWidth={1.9} />
        </span>
        <div className="min-w-0 pt-0.5">
          <h2 className="text-base font-semibold leading-6 text-fg">{title}</h2>
          {lead && <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted">{lead}</p>}
        </div>
      </div>
      <div className="mt-5 space-y-4">{children}</div>
    </section>
  );
}

/** A heading inside a card, with a hairline running out to the edge. */
function SubHead({ children }: { children: ReactNode }) {
  return (
    <h3 className="flex items-center gap-3 pt-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted">
      {children}
      <span className="h-px flex-1 bg-line" aria-hidden />
    </h3>
  );
}

/** A box inside a card, for the settings that belong closer together. */
function Group({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('space-y-3 rounded-2xl border border-line/75 bg-bg/45 p-4 shadow-inner', className)}>{children}</div>;
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

/** Every card, in order, so the row at the top can point at them. */
const SECTIONS = [
  { id: 'orbit-appearance', label: 'Appearance' },
  { id: 'orbit-library', label: 'Library' },
  { id: 'orbit-playing', label: 'Playing' },
  { id: 'orbit-libraries', label: 'Libraries' },
  { id: 'orbit-details', label: 'Artwork' },
  { id: 'orbit-tabs', label: 'Tabs' },
  { id: 'orbit-sound', label: 'Sound' },
  { id: 'orbit-tools', label: 'Tools' },
  { id: 'orbit-updates', label: 'Updates' },
  { id: 'orbit-about', label: 'About' },
];

const SETTINGS_SEARCH_ITEMS: { label: string; section: string; keywords: string }[] = [
  { label: 'Themes and colours', section: 'orbit-appearance', keywords: 'appearance background accent nebula theme colour colors' },
  { label: 'Cover hover tint', section: 'orbit-appearance', keywords: 'covers artwork tiles hover tint' },
  { label: 'Opening animation', section: 'orbit-appearance', keywords: 'startup intro opening motion launch' },
  { label: 'Add games to the Backlog', section: 'orbit-library', keywords: 'backlog sync add new games' },
  { label: 'Jump back in panel', section: 'orbit-library', keywords: 'hero recently played hide show home' },
  { label: 'Library cover size', section: 'orbit-library', keywords: 'grid tiles covers small large scale slider zoom' },
  { label: 'Library order and sorting', section: 'orbit-library', keywords: 'sort alphabetically recently added playtime drag manual order' },
  { label: 'Library folders and drives', section: 'orbit-library', keywords: 'where installed paths storage folders drives move' },
  { label: 'Hide games', section: 'orbit-library', keywords: 'hidden library visibility' },
  { label: 'Window when a game starts', section: 'orbit-playing', keywords: 'minimize tray close launch' },
  { label: 'Window when a game closes', section: 'orbit-playing', keywords: 'show quit restore session' },
  { label: 'Steam library scan', section: 'orbit-libraries', keywords: 'steam import installed games scan' },
  { label: 'Steam startup check', section: 'orbit-libraries', keywords: 'steam import automatic launch startup new games' },
  { label: 'Epic, Ubisoft, GOG and EA installs', section: 'orbit-libraries', keywords: 'epic ubisoft gog ea launcher import read only' },
  { label: 'Other game launchers', section: 'orbit-libraries', keywords: 'epic ubisoft gog ea launcher import' },
  { label: 'Artwork and game details', section: 'orbit-details', keywords: 'metadata description cover genres rating release year' },
  { label: 'Automatic background lookups', section: 'orbit-details', keywords: 'fetch metadata offline background automatic' },
  { label: 'Reorder top tabs', section: 'orbit-tabs', keywords: 'navigation order pages tabs' },
  { label: 'Background music', section: 'orbit-sound', keywords: 'sound music melody volume' },
  { label: 'Music while unfocused', section: 'orbit-sound', keywords: 'sound focus background other window' },
  { label: 'Music button and visualizer', section: 'orbit-sound', keywords: 'top bar music controls visualizer bars' },
  { label: 'Ghost Hunter Pro', section: 'orbit-tools', keywords: 'tools save files cleanup' },
  { label: 'Updates and pre-releases', section: 'orbit-updates', keywords: 'version release github update beta' },
  { label: 'Reset or clear Orbit data', section: 'orbit-about', keywords: 'delete remove reset library games sessions notes' },
];

export function SettingsView({
  settings,
  setSettings,
  onImportSteam,
  onImportLaunchers,
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
  /** Opens the read-only scan for other installed launchers. */
  onImportLaunchers: () => void;
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
  const [settingsQuery, setSettingsQuery] = useState('');

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

  /** Take the page to one of its own cards, and mark it for a moment. */
  const jump = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('settings-spot');
    window.setTimeout(() => el.classList.remove('settings-spot'), 2400);
  };

  const searchResults = settingsQuery.trim()
    ? SETTINGS_SEARCH_ITEMS.filter((item) => `${item.label} ${item.keywords}`.toLowerCase().includes(settingsQuery.trim().toLowerCase()))
    : [];

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-5 sm:p-7 lg:p-8">
      <header className="relative overflow-hidden rounded-3xl border border-accent/25 bg-gradient-to-br from-accent/15 via-panel/90 to-panel2/65 p-5 shadow-xl sm:p-6">
        <div className="pointer-events-none absolute -right-10 -top-16 size-48 rounded-full bg-accent/10 blur-3xl" aria-hidden />
        <div className="relative flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-accent/25 bg-accent/10 text-accent">
            <SlidersHorizontal className="size-5" strokeWidth={1.8} />
          </span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-accent">Your Orbit</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">Settings</h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
              Make Orbit feel right for you. Changes save as you make them—there is no Save button to hunt for.
            </p>
          </div>
        </div>
      </header>

      <div className="relative z-20">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <input
          value={settingsQuery}
          onChange={(event) => setSettingsQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setSettingsQuery('');
            if (event.key === 'Enter' && searchResults[0]) {
              jump(searchResults[0].section);
              setSettingsQuery('');
            }
          }}
          placeholder="Search settings, e.g. sound, Steam, folders…"
          aria-label="Search settings"
          className="w-full rounded-2xl border border-line bg-bg/80 py-3 pl-11 pr-4 text-sm text-fg shadow-inner outline-none transition placeholder:text-muted focus:border-accent"
        />
        {settingsQuery.trim() && (
          <div className="absolute inset-x-0 top-full mt-2 max-h-64 overflow-y-auto rounded-2xl border border-line bg-panel p-1.5 shadow-2xl">
            {searchResults.length === 0 ? (
              <p className="px-3 py-3 text-sm text-muted">No matching settings. Try a shorter search.</p>
            ) : (
              searchResults.map((item) => (
                <button
                  key={item.label}
                  onClick={() => {
                    jump(item.section);
                    setSettingsQuery('');
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition hover:bg-panel2"
                >
                  <span className="font-medium text-fg">{item.label}</span>
                  <span className="shrink-0 text-xs text-muted">{SECTIONS.find((section) => section.id === item.section)?.label}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* A quick map stays nearby while the longer cards scroll past. */}
      <nav className="sticky top-[4.25rem] z-10 flex flex-wrap gap-1.5 rounded-2xl border border-line/80 bg-bg/90 p-2 shadow-lg backdrop-blur-xl">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => jump(s.id)}
            className="rounded-full border border-line bg-panel2/50 px-3 py-1 text-xs text-muted transition hover:border-accent/50 hover:text-fg"
          >
            {s.label}
          </button>
        ))}
      </nav>

      <Section
        id="orbit-appearance"
        icon={Palette}
        title="Appearance"
        lead="Choose a theme, tune the library's look, and decide what happens when Orbit opens."
      >
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

        <SubHead>Covers</SubHead>
        {/* Part of the theme rather than a setting of its own: it decides what
            colour a cover is tinted with when the pointer is over it. */}
        <Checkbox
          checked={settings.coverTint !== false}
          onChange={(v) => setSettings({ coverTint: v })}
          label="Tint a cover's hover with its own colours"
          hint="On uses each cover's colours for its hover glow. Off uses your theme colours for a more uniform library."
        />

        <SubHead>When the app opens</SubHead>
        <Checkbox
          checked={settings.startupAnimation !== false}
          onChange={(v) => setSettings({ startupAnimation: v })}
          label="Play the opening when Orbit starts"
          hint="Show Orbit's short animated opening. Turn this off to go straight to the library."
        />
      </Section>

      <Section
        id="orbit-library"
        icon={LibraryIcon}
        title="Library and Backlog"
        lead="Choose where new games appear and which folders Orbit keeps track of."
      >
        <SubHead>Adding games</SubHead>
        <Checkbox
          checked={settings.syncBacklog === true}
          onChange={(v) => setSettings({ syncBacklog: v })}
          label="Also add new games to the Backlog"
          hint="Also put title-only games on the Backlog. Off keeps them in the Library only."
        />

        <SubHead>Jump back in</SubHead>
        <Checkbox
          checked={settings.showHero !== false}
          onChange={(v) => setSettings({ showHero: v })}
          label="Show the Jump back in panel"
          hint="Keep the recently played game and its Play button at the top of the Library."
        />

        <SubHead>Hidden games</SubHead>
        <p className="text-xs leading-relaxed text-muted">
          A game is hidden from its own page or from the right-click menu. It keeps its sessions, notes and playtime,
          and the Hidden chip on the library page is where it comes back.
        </p>

        <SubHead>Where games live</SubHead>
        <p className="text-xs leading-relaxed text-muted">
          Games inside these folders are yours as far as Orbit is concerned: it reports what they take and can move them
          between the folders you list. A game added from anywhere else is listed but never touched.
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
          {settings.libraryFolders.length === 0 && (
            <span className="text-sm text-muted">No folders yet. Add the one your games are installed in below.</span>
          )}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            addFolder(folder);
          }}
        >
          <input value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="D:\Games" className={`${inputCls} flex-1 font-mono`} />
          {isNative() && (
            <button
              type="button"
              className={`${btnBrowse} flex items-center gap-2`}
              onClick={() => void pickFolder('Choose a library folder', folder || undefined).then((p) => p && addFolder(p))}
            >
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
                onClick={() => addFolder(`${driveLabel(d.drive)}Games`)}
                className="rounded-lg border border-line bg-panel2 px-3 py-1.5 text-xs hover:border-accent"
              >
                Use {driveLabel(d.drive)}Games · {fmtBytes(d.free)} free
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section
        id="orbit-playing"
        icon={Monitor}
        title="Playing"
        lead="Choose what Orbit does with its window when a game starts or closes."
      >
        <SubHead>Orbit's window around a game</SubHead>
        <p className="text-xs leading-relaxed text-muted">
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
          <p className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs leading-relaxed text-amber-300">
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

      </Section>

      <Section
        id="orbit-libraries"
        icon={LibraryIcon}
        title="Libraries"
        lead="Orbit only reads local launcher records when you ask it to. It never signs in, changes launcher settings, or adds games automatically from these scans."
      >
        <SubHead>Steam</SubHead>
        <Checkbox
          checked={settings.steamOnLaunch}
          onChange={(v) => setSettings({ steamOnLaunch: v })}
          label="Check Steam for new games when Orbit starts"
          hint="When enabled, Orbit reads the installed Steam manifests at startup and adds games missing from your library. It never changes files in Steam."
        />
        <button
          onClick={onImportSteam}
          className="flex items-center gap-2 rounded-lg border border-line bg-panel2 px-4 py-2 text-sm transition hover:border-accent"
        >
          <Download className="size-4" />
          Scan the Steam library…
        </button>

        <SubHead>Other launchers</SubHead>
        <p className="text-xs leading-relaxed text-muted">
          Scan Epic Games, Ubisoft Connect, GOG Galaxy and EA app install records on this device. Nothing is imported until you select it.
        </p>
        <button
          onClick={onImportLaunchers}
          className="flex items-center gap-2 rounded-lg border border-line bg-panel2 px-4 py-2 text-sm transition hover:border-accent"
        >
          <Download className="size-4" />
          Scan other launchers…
        </button>
      </Section>

      <Section
        id="orbit-details"
        icon={Sparkles}
        title="Artwork and details"
        lead="Orbit can use Steam's public catalogue for artwork and details. That does not make a game a Steam launch: only games imported from your Steam library start through Steam."
      >
        <Checkbox
          checked={settings.fetchMetadata}
          onChange={(v) => setSettings({ fetchMetadata: v })}
          label="Look games up when they are added"
          hint="Fetch a summary, genres, cover art and playtime estimates as you add a game."
        />
        <Checkbox
          checked={settings.autoFetchMetadata}
          onChange={(v) => setSettings({ autoFetchMetadata: v })}
          label="Fill in the gaps in the background"
          hint="Fill in missing details for older games in the background, a few at a time."
        />
      </Section>

      <Section id="orbit-tabs" icon={GripVertical} title="Tabs along the top" lead="Put the pages you use most first. Settings is always last, wherever it would have been.">
        <TabOrder
          order={orderedTabs(settings.tabOrder).map((t) => t.id)}
          onChange={(next) => setSettings({ tabOrder: next })}
        />
      </Section>

      <Section
        id="orbit-sound"
        icon={Piano}
        title="Sound"
        lead="A composed, gentle background phrase—made locally, with no audio downloads."
      >
        <Group>
          <Checkbox
            checked={settings.sound?.enabled === true}
            onChange={(v) =>
              setSettings({ sound: { enabled: v, volume: settings.sound?.volume ?? 0.35, unfocused: settings.sound?.unfocused === true } })
            }
            label="Play something quiet in the background"
            hint="A slow, repeating major-pentatonic melody over one steady soft chord. No random notes or chord changes."
          />

          <label className={cn('block space-y-1', settings.sound?.enabled !== true && 'opacity-50')}>
            <span className="flex items-center gap-2 text-xs text-muted">
              <Volume2 className="size-3.5" />
              Volume
            </span>
            <span className="flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round((settings.sound?.volume ?? 0.35) * 100)}
                disabled={settings.sound?.enabled !== true}
                onChange={(e) =>
                  setSettings({
                    sound: {
                      enabled: true,
                      volume: Number(e.target.value) / 100,
                      unfocused: settings.sound?.unfocused === true,
                    },
                  })
                }
                className="orbit-range flex-1"
                aria-label="Volume"
              />
              <span className="w-10 shrink-0 text-right font-mono text-xs text-muted">
                {Math.round((settings.sound?.volume ?? 0.35) * 100)}%
              </span>
            </span>
          </label>

          <Checkbox
            checked={settings.sound?.unfocused === true}
            onChange={(v) =>
              setSettings({ sound: { enabled: settings.sound?.enabled === true, volume: settings.sound?.volume ?? 0.35, unfocused: v } })
            }
            label="Keep playing while Orbit is not the window in front"
            hint="Off: the music steps aside when you click away, and comes back when you do. On: it carries on, which is what a second monitor wants."
          />

          <SubHead>In the top bar</SubHead>

          <Checkbox
            checked={settings.topbarMusic !== false}
            onChange={(v) => setSettings({ topbarMusic: v })}
            label="Put the music controls in the top bar"
            hint="A music button beside Settings, for hushing it without coming back here."
          />
          <Checkbox
            checked={settings.musicBars !== false}
            onChange={(v) => setSettings({ musicBars: v })}
            label="Dance a little while it plays"
            hint="Four bars beside the button that rise and fall with the music. Off: the button alone says whether it is playing."
          />
        </Group>
      </Section>

      <Section id="orbit-tools" icon={Wand2} title="Other tools" lead="Programs made alongside Orbit, for the parts of a game that are not the game.">
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
      </Section>

      <Section
        id="orbit-updates"
        icon={Download}
        title="Updates"
        lead="One request to GitHub's public releases page when Orbit opens. No account, no identifier, and nothing about your library is sent."
      >
        <Group>
          <Checkbox
            checked={settings.updatePrerelease === true}
            onChange={(v) => setSettings({ updatePrerelease: v })}
            label="Include pre-releases"
            hint="A build published as a pre-release is skipped by default, which keeps a test build out of everybody's way. Turn this on to be offered one."
          />
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
            hint="Off: the check only happens when you press the button above."
          />
        </Group>
      </Section>

      <Section
        id="orbit-about"
        icon={Database}
        title="About"
        lead={`Orbit ${APP_VERSION}, ${isNative() ? 'the desktop app' : 'a browser preview'}. Your library is a file on this machine, and nothing here needs an account.`}
      >
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
        <SubHead>Starting over</SubHead>
        <p className="text-xs leading-relaxed text-muted">
          Neither of these touches the games themselves: only what Orbit knows about them.
        </p>
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
        <p className="flex items-center gap-2 pt-1 text-xs text-muted">
          <ListChecks className="size-3.5 text-accent" />
          Hide a game, and it leaves the shelves without losing a second of what you played.
        </p>
      </Section>

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
