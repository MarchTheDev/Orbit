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
      className="scroll-mt-6 rounded-2xl border border-line bg-panel2/30 p-5 transition-shadow"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-accent/25 bg-accent/10 text-accent">
          <Icon className="size-4" strokeWidth={1.9} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold leading-9">{title}</h2>
          {lead && <p className="text-xs leading-relaxed text-muted">{lead}</p>}
        </div>
      </div>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

/** A heading inside a card, with a hairline running out to the edge. */
function SubHead({ children }: { children: ReactNode }) {
  return (
    <h3 className="flex items-center gap-3 pt-1 text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted">
      {children}
      <span className="h-px flex-1 bg-line" aria-hidden />
    </h3>
  );
}

/** A box inside a card, for the settings that belong closer together. */
function Group({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('space-y-3 rounded-xl border border-line bg-bg/30 p-4', className)}>{children}</div>;
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
  { id: 'orbit-details', label: 'Artwork' },
  { id: 'orbit-tabs', label: 'Tabs' },
  { id: 'orbit-sound', label: 'Sound' },
  { id: 'orbit-tools', label: 'Tools' },
  { id: 'orbit-updates', label: 'Updates' },
  { id: 'orbit-about', label: 'About' },
];

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

  /** Take the page to one of its own cards, and mark it for a moment. */
  const jump = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('settings-spot');
    window.setTimeout(() => el.classList.remove('settings-spot'), 2400);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-8">
      <header className="space-y-1 px-1">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted">Everything here saves as you change it. Nothing needs a Save button.</p>
      </header>

      {/* The page is long, so it says what is on it before it starts. */}
      <nav className="flex flex-wrap gap-1.5 px-1">
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
        lead="The colours Orbit is drawn in, and how the covers behave."
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
          hint="On: the glow behind a tile is taken from its artwork, so each game looks like itself. Off: the theme's colours are used, so every tile matches the app."
        />

        <SubHead>When the app opens</SubHead>
        <Checkbox
          checked={settings.startupAnimation !== false}
          onChange={(v) => setSettings({ startupAnimation: v })}
          label="Play the opening when Orbit starts"
          hint="The mark, a ring and the name, about a second and a half, which is the time the library takes to arrive anyway. Off: the app is simply there."
        />
      </Section>

      <Section
        id="orbit-library"
        icon={LibraryIcon}
        title="Library and Backlog"
        lead="What Orbit does with a game the moment it is added, and where it keeps your folders."
      >
        <SubHead>Adding games</SubHead>
        <Checkbox
          checked={settings.syncBacklog === true}
          onChange={(v) => setSettings({ syncBacklog: v })}
          label="Also add new games to the Backlog"
          hint="A game added with nothing to point at waits on the Backlog as well, so one list covers what you own and what you mean to play. Off: it stays in the library."
        />

        <SubHead>Jump back in</SubHead>
        <Checkbox
          checked={settings.showHero !== false}
          onChange={(v) => setSettings({ showHero: v })}
          label="Show the Jump back in panel"
          hint="The panel at the top of the library, with the game you played last. It has a small cross of its own; this is the switch that brings it back."
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
        lead="What Orbit does with its own window around a session, and how it treats the Steam library on this PC."
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

        <SubHead>Steam library</SubHead>
        <p className="text-xs leading-relaxed text-muted">
          Importing lives in Add game, where games are added from. These two are the other side of it: keeping up with
          what is installed, and taking Steam games back out.
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
          Scan the Steam library…
        </button>
      </Section>

      <Section
        id="orbit-details"
        icon={Sparkles}
        title="Artwork and details"
        lead="Where the description, the genres, the release year and the cover come from: the Steam store, which asks for no key and nothing to set up."
      >
        <Checkbox
          checked={settings.fetchMetadata}
          onChange={(v) => setSettings({ fetchMetadata: v })}
          label="Look games up when they are added"
          hint="Fills in a summary, genres, cover art and HowLongToBeat times. Off: games are added offline and stay as they were typed."
        />
        <Checkbox
          checked={settings.autoFetchMetadata}
          onChange={(v) => setSettings({ autoFetchMetadata: v })}
          label="Fill in the gaps in the background"
          hint="Games already in the library, or ones added while offline, are looked up quietly, a few at a time."
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
        lead="A slow melody Orbit makes itself, so nothing is downloaded and nothing is licensed."
      >
        <Group>
          <Checkbox
            checked={settings.sound?.enabled === true}
            onChange={(v) =>
              setSettings({ sound: { enabled: v, volume: settings.sound?.volume ?? 0.35, unfocused: settings.sound?.unfocused === true } })
            }
            label="Play something quiet in the background"
            hint="Soft notes from a pentatonic scale, so no interval ever lands wrong, one at a time and slowly."
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
