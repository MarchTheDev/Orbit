import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { emit } from '@tauri-apps/api/event';
import {
  Database,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Library as LibraryIcon,
  Ghost,
  GitBranch,
  GripVertical,
  Heart,
  ListChecks,
  Monitor,
  MonitorPlay,
  Palette,
  Piano,
  RefreshCw,
  ArrowLeftRight,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Volume2,
  Wand2,
  X,
} from 'lucide-react';
import { OVERLAY_BOXES, type FontChoice, type LauncherId, type OverlayBoxId, type Page, type Settings } from '../types';
import { FONTS, THEMES } from '../data/themes';
import { LAUNCHERS, NOT_SCANNABLE_NOTE, canScan, launcherOn } from '../data/launchers';
import { desktopOs } from '../utils/platform';
import { scrollSettingsSectionToTop } from '../utils/settingsNavigation';
import {
  cloudAutoOn,
  dataDir,
  dataDirSize,
  dataPortable,
  isNative,
  savesWithClouds,
  listDrives,
  rememberMusic,
  overlayCaptureDirs,
  overlayOpenKind,
  overlayFps,
  overlayQuality,
  clampOverlaySeconds,
  overlayLengths,
  revealInExplorer,
  setExeContextMenu,
  setLaunchOnStartup,
  type CaptureDirs,
  type DriveInfo,
} from '../services/native';
import { openExternal, pickFile, pickFolder } from '../services/desktop';
import { playShutter } from '../services/shutter';
import { CopySettings } from './CopySettings';
import { ShortcutEditor } from './ShortcutEditor';
import { AddCloud, CloudAccounts, CloudTools } from './saves/CloudPanel';
import { fmtBytes } from '../utils/format';
import { cn } from '../utils/cn';
import { driveLabel } from '../utils/drive';
import { btnBrowse, inputCls } from './ui/Modal';
import { Checkbox, CheckboxInline } from './ui/Checkbox';
import { Select } from './ui/Select';
import { btnAccent } from './ui/buttons';
import { LauncherIcon } from './ui/LauncherIcon';
import { APP_VERSION } from '../version';
import {
  RELEASES_URL,
  checkForUpdate,
  installUpdate,
  type InstallStep,
  type ReleaseInfo,
} from '../services/updates';
import { orderedTabs } from './TopNav';
import { LIBRARY_FILTERS, orderedLibraryFilters, type Filter } from './Toolbar';
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
      className="scroll-mt-28 rounded-3xl border border-line/65 bg-panel/25 p-5 transition-colors sm:p-6"
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
  return <div className={cn('space-y-3 rounded-2xl border border-line/50 bg-bg/20 p-4', className)}>{children}</div>;
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

/** The Library chips: ordered by drag, independently hidden with one tap. */
function LibraryFilterOrder({
  order,
  hidden,
  onChange,
}: {
  order: Filter[];
  hidden: Filter[];
  onChange: (order: Filter[], hidden: Filter[]) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const filters = orderedLibraryFilters(order).map((item) => item.id);
  const hiddenSet = new Set(hidden);
  const visibleCount = filters.filter((id) => !hiddenSet.has(id)).length;
  const { bind, dragging, over, active } = useDragReorder(
    (fromId, toId, after) => onChange(moveInOrder(filters, fromId, toId, after) as Filter[], hidden),
    { container: list },
  );

  const toggle = (id: Filter) => {
    const isHidden = hiddenSet.has(id);
    if (!isHidden && visibleCount <= 1) return;
    const next = isHidden ? hidden.filter((item) => item !== id) : [...hidden, id];
    onChange(filters, next);
  };

  return (
    <div ref={list} className={cn('space-y-1', active && 'cursor-grabbing')}>
      {filters.map((id) => {
        const definition = LIBRARY_FILTERS.find((item) => item.id === id);
        if (!definition) return null;
        const shown = !hiddenSet.has(id);
        const disabled = shown && visibleCount <= 1;
        return (
          <div
            key={id}
            {...bind(id)}
            className={cn(
              'flex items-center gap-3 rounded-xl border border-line bg-panel px-3 py-2 text-sm transition',
              dragging === id && 'opacity-40',
              over === id && dragging !== id && 'border-accent bg-accent/10',
              !shown && 'opacity-65',
            )}
          >
            <GripVertical className="size-4 shrink-0 cursor-grab text-muted" />
            <span className="min-w-0 flex-1 font-medium">{definition.label}</span>
            <span className="text-[11px] text-muted">{shown ? 'Shown' : 'Hidden'}</span>
            <button
              type="button"
              onClick={() => toggle(id)}
              disabled={disabled}
              aria-label={`${shown ? 'Hide' : 'Show'} ${definition.label} filter`}
              aria-pressed={shown}
              title={disabled ? 'At least one Library filter must stay visible' : `${shown ? 'Hide' : 'Show'} this filter`}
              className="grid size-8 shrink-0 place-items-center rounded-lg border border-line text-muted transition hover:border-accent hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
            >
              {shown ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
            </button>
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
  { id: 'orbit-overlay', label: 'Overlay' },
  { id: 'orbit-backups', label: 'Backups' },
  { id: 'orbit-libraries', label: 'Libraries' },
  { id: 'orbit-details', label: 'Artwork' },
  { id: 'orbit-tabs', label: 'Tabs' },
  { id: 'orbit-sound', label: 'Sound' },
  { id: 'orbit-copy', label: 'Export' },
  { id: 'orbit-tools', label: 'Tools' },
  { id: 'orbit-updates', label: 'Updates' },
  { id: 'orbit-about', label: 'About' },
];

const SETTINGS_SEARCH_ITEMS: { label: string; section: string; keywords: string }[] = [
  { label: 'Themes and colours', section: 'orbit-appearance', keywords: 'appearance background accent nebula theme colour colors' },
  { label: 'Fonts and typeface', section: 'orbit-appearance', keywords: 'font typography sans serif rounded mono' },
  { label: 'Cover hover tint', section: 'orbit-appearance', keywords: 'covers artwork tiles hover tint' },
  { label: 'Opening animation', section: 'orbit-appearance', keywords: 'startup intro opening motion launch' },
  { label: 'Add games to the Backlog', section: 'orbit-library', keywords: 'backlog sync add new games' },
  { label: 'Jump back in panel', section: 'orbit-library', keywords: 'hero recently played hide show home' },
  { label: 'Library cover size', section: 'orbit-library', keywords: 'grid tiles covers small large scale slider zoom' },
  { label: 'Library order and sorting', section: 'orbit-library', keywords: 'sort alphabetically recently added playtime drag manual order' },
  { label: 'Library filter categories', section: 'orbit-library', keywords: 'all playing completed dropped favorites unplayed hidden reorder show hide' },
  { label: 'Library folders and drives', section: 'orbit-library', keywords: 'where installed paths storage folders drives move' },
  { label: 'Hide games', section: 'orbit-library', keywords: 'hidden library visibility' },
  { label: 'Window when a game starts', section: 'orbit-playing', keywords: 'minimize tray close launch' },
  { label: 'Window when a game closes', section: 'orbit-playing', keywords: 'show quit restore session' },
  { label: 'Close button', section: 'orbit-playing', keywords: 'quit tray hide close button exit' },
  { label: 'Overlay', section: 'orbit-overlay', keywords: 'overlay alt x start select screenshot recording replay hotkey' },
  { label: 'Replay lengths', section: 'orbit-overlay', keywords: 'overlay last 30 45 60 90 120 seconds custom clip lengths' },
  { label: 'Picture quality', section: 'orbit-overlay', keywords: 'overlay 720p 1080p 1440p 4k 2160 quality fps frames recording replay' },
  { label: 'Capture chime', section: 'orbit-overlay', keywords: 'overlay shutter recording replay screenshot chime sound saved volume' },
  { label: 'Capture notes', section: 'orbit-overlay', keywords: 'overlay toast screenshot recording replay saved notification' },
  { label: 'Game start note', section: 'orbit-overlay', keywords: 'overlay working popup banner start game notice' },
  { label: 'Capture folder', section: 'orbit-overlay', keywords: 'overlay screenshots recordings replays save location path directory folder' },
  { label: 'Overlay boxes', section: 'orbit-overlay', keywords: 'overlay hide show fps performance clock notes audio gallery capture boxes resize' },
  { label: 'Send backups to the cloud', section: 'orbit-backups', keywords: 'cloud auto send after backup marked tick' },
  { label: 'Add a cloud', section: 'orbit-backups', keywords: 'add cloud google drive mega proton dropbox sign in ftp sftp webdav shared folder server' },
  { label: 'Connected clouds', section: 'orbit-backups', keywords: 'cloud google drive mega proton dropbox disconnect sign out' },
  { label: 'rclone', section: 'orbit-backups', keywords: 'rclone get update folder path check backups' },
  { label: 'Launcher library scans', section: 'orbit-libraries', keywords: 'steam epic ubisoft gog ea import installed games scan launcher' },
  { label: 'Rescan libraries on launch', section: 'orbit-libraries', keywords: 'steam epic ubisoft gog ea automatic startup new games per launcher' },
  { label: 'Launch Orbit at sign-in', section: 'orbit-appearance', keywords: 'start when pc starts boot login startup autostart' },
  { label: 'Start Orbit in the background', section: 'orbit-appearance', keywords: 'tray hidden background boot launch on sign-in startup' },
  { label: 'Open in Orbit', section: 'orbit-appearance', keywords: 'explorer windows linux context menu right click executable import nautilus dolphin' },
  { label: 'Artwork and game details', section: 'orbit-details', keywords: 'metadata description cover genres rating release year steamgriddb portrait key' },
  { label: 'Automatic background lookups', section: 'orbit-details', keywords: 'fetch metadata offline background automatic' },
  { label: 'Reorder top tabs', section: 'orbit-tabs', keywords: 'navigation order pages tabs' },
  { label: 'Background music', section: 'orbit-sound', keywords: 'sound music melody volume' },
  { label: 'Music while unfocused', section: 'orbit-sound', keywords: 'sound focus background other window' },
  { label: 'Music button and visualizer', section: 'orbit-sound', keywords: 'top bar music controls visualizer bars' },
  { label: 'Your own music', section: 'orbit-sound', keywords: 'sound file mp3 ogg wav flac restore default chord' },
  { label: 'Export and import', section: 'orbit-copy', keywords: 'export import file settings journal sessions playthrough copy backup orbit' },
  { label: 'Ghost Hunter Pro', section: 'orbit-tools', keywords: 'tools save files cleanup' },
  { label: 'Updates and pre-releases', section: 'orbit-updates', keywords: 'version release github update beta' },
  { label: 'Reset or clear Orbit data', section: 'orbit-about', keywords: 'delete remove reset library games sessions notes' },
];

function OverlaySettings({
  settings,
  setSettings,
  where,
}: {
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
  where: string;
}) {
  const overlay = settings.overlay;
  const enabled = overlay?.enabled !== false;
  const replay = overlay?.replay !== false;
  const seconds = clampOverlaySeconds(overlay?.seconds);
  const lengths = overlayLengths(overlay?.lengths);
  const extras = (overlay?.lengths ?? []).map((item) => clampOverlaySeconds(item)).filter((item) => item !== 30 && item !== 45 && item !== 60);
  const quality = overlayQuality(overlay?.quality);
  const fps = overlayFps(overlay?.fps);
  const shutterOn = overlay?.shutter !== false;
  const shutterVolume = overlay?.shutterVolume ?? 40;
  const [draft, setDraft] = useState('90');
  const [folderNote, setFolderNote] = useState<string | null>(null);
  const [layoutNote, setLayoutNote] = useState<string | null>(null);

  const setOverlay = (patch: Partial<NonNullable<Settings['overlay']>>) => {
    setSettings({
      overlay: {
        ...overlay,
        enabled,
        replay,
        seconds,
        lengths: overlay?.lengths ?? [],
        quality,
        fps,
        shutter: shutterOn,
        shutterVolume,
        ffmpeg: overlay?.ffmpeg ?? '',
        hidden: overlay?.hidden ?? [],
        ...patch,
      },
    });
  };

  const addLength = () => {
    const next = clampOverlaySeconds(Number(draft));
    if (!Number.isFinite(Number(draft))) return;
    if (lengths.includes(next) && (next === 30 || next === 45 || next === 60 || extras.includes(next))) {
      setOverlay({ seconds: next });
      return;
    }
    setOverlay({ lengths: [...extras, next].sort((a, b) => a - b), seconds: next });
  };

  const sep = where.includes('\\') ? '\\' : '/';
  const trimmedRoot = where.replace(/[\\/]+$/, '');
  const captureRoot = trimmedRoot || (where.startsWith('/') ? '/' : '');
  const capturePath = (name: string) =>
    captureRoot ? `${captureRoot}${captureRoot.endsWith(sep) ? '' : sep}${name}` : '';
  // The defaults are the machine's own Pictures and Videos folders, which only
  // the desktop side can name - so they are asked for rather than assumed.
  const [defaults, setDefaults] = useState<CaptureDirs | null>(null);
  useEffect(() => {
    let alive = true;
    void overlayCaptureDirs()
      .then((dirs) => {
        if (alive) setDefaults(dirs);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const captureFolders = ([
    { kind: 'screenshots', label: 'Screenshots', setting: 'screenshotDirectory' },
    { kind: 'recordings', label: 'Recordings', setting: 'recordingDirectory' },
    { kind: 'replays', label: 'Replays', setting: 'replayDirectory' },
  ] as const).map((folder) => {
    const custom = overlay?.[folder.setting]?.trim() ?? '';
    const fallback = defaults?.[folder.kind] || capturePath(folder.kind);
    return { ...folder, custom, path: custom || fallback };
  });

  return (
    <>
      <Checkbox
        checked={enabled}
        onChange={(on) => setOverlay({ enabled: on })}
        label="Overlay"
        hint="Off means your configured keyboard shortcut and Start + Select do nothing."
      />
      <Checkbox
        checked={replay}
        onChange={(on) => setOverlay({ replay: on })}
        label="Keep the last few seconds while a game is playing"
        hint="The rolling replay is kept in a temporary file on disk (up to 288 MB), not in memory, and it is deleted when the game stops. Nothing becomes a saved clip until you save one. At 4K or for long clips, less than the selected duration may be available. Turn it off for the lightest resource use."
      />
      <div className="space-y-1.5">
        <p className="text-sm font-medium">Replay lengths</p>
        <div className="flex flex-wrap gap-2">
          {lengths.map((length) => {
            const extra = length !== 30 && length !== 45 && length !== 60;
            return (
              <span key={length} className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setOverlay({ seconds: length })}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-xs',
                    seconds === length ? 'border-accent bg-accent/15 text-fg' : 'border-line bg-panel2 text-muted hover:border-accent',
                  )}
                >
                  {length} seconds
                </button>
                {extra && (
                  <button
                    type="button"
                    aria-label={`Remove ${length} seconds`}
                    onClick={() => setOverlay({
                      lengths: extras.filter((item) => item !== length),
                      seconds: seconds === length ? 30 : seconds,
                    })}
                    className="grid size-7 place-items-center rounded-lg border border-line text-muted hover:border-accent hover:text-fg"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </span>
            );
          })}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <label className="text-xs text-muted" htmlFor="overlay-length">Add a length</label>
          <input
            id="overlay-length"
            type="number"
            min={5}
            max={300}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addLength();
            }}
            className={cn(inputCls, 'max-w-[6rem]')}
          />
          <button type="button" onClick={addLength} className={btnBrowse}>Add</button>
        </div>
        <p className="text-xs leading-relaxed text-muted">30, 45, and 60 stay. Add others, such as 90 or 120, and they show up in the overlay too. The highlighted one is selected until you pick another there. From 5 seconds to 5 minutes.</p>
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium">Quality</p>
        <div className="flex flex-wrap gap-2">
          {([
            ['720p', '720p', '1280 × 720'],
            ['1080p', '1080p', '1920 × 1080'],
            ['1440p', '1440p', '2560 × 1440'],
            ['4k', '4K', '3840 × 2160'],
          ] as const).map(([value, label, detail]) => (
            <button
              key={value}
              type="button"
              onClick={() => setOverlay({ quality: value })}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-left',
                quality === value ? 'border-accent bg-accent/15 text-fg' : 'border-line bg-panel2 text-muted hover:border-accent',
              )}
            >
              <span className="block text-xs font-medium">{label}</span>
              <span className="block text-[10px] text-muted">{detail}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          {([30, 60] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setOverlay({ fps: value })}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-xs',
                fps === value ? 'border-accent bg-accent/15 text-fg' : 'border-line bg-panel2 text-muted hover:border-accent',
              )}
            >
              {value} fps
            </button>
          ))}
        </div>
        <p className="text-xs leading-relaxed text-muted">
          Orbit records up to this size. A smaller screen is not stretched to 4K. 720p at 30 fps uses the least power; 4K and 60 use more. Performance readings refresh once a second, and the FPS sampler stops when its box is hidden.
        </p>
      </div>
      <Checkbox
        checked={shutterOn}
        onChange={(on) => setOverlay({ shutter: on })}
        label="Play a sound when a capture is saved"
        hint="A short, light chime after a screenshot, recording, or replay is saved."
      />
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <label className="text-sm font-medium" htmlFor="shutter-volume">Capture chime</label>
          <button
            type="button"
            disabled={!shutterOn}
            onClick={() => playShutter(shutterVolume)}
            className="text-xs text-muted hover:text-fg disabled:opacity-40"
          >
            Preview
          </button>
        </div>
        <input
          id="shutter-volume"
          type="range"
          min={0}
          max={100}
          disabled={!shutterOn}
          value={shutterVolume}
          aria-label="Capture chime volume"
          onChange={(event) => setOverlay({ shutterVolume: Number(event.target.value) })}
          className="w-full max-w-xs accent-[var(--c-accent)] disabled:opacity-40"
        />
        <p className="text-xs text-muted">{shutterOn ? `${shutterVolume}` : 'Off'}</p>
      </div>
      <Checkbox
        checked={overlay?.captureToast !== false}
        onChange={(on) => setOverlay({ captureToast: on })}
        label="Show a note when a capture is saved"
        hint="A small note for a screenshot, a recording, or a replay."
      />
      <Checkbox
        checked={overlay?.readyNotice !== false}
        onChange={(on) => setOverlay({ readyNotice: on })}
        label="Show that the overlay is working"
        hint="A small note in Orbit's main window when you start a game. It does not appear when you open the overlay."
      />
      <Checkbox
        checked={overlay?.liveStats !== false}
        onChange={(on) => setOverlay({ liveStats: on })}
        label="Read live stats (FPS, CPU, GPU)"
        hint={
          overlay?.liveStats === false
            ? 'Off. The FPS and performance boxes stay empty. Orbit turns this off by itself if the overlay closed while it was reading them.'
            : 'The FPS box reads the picture the desktop presents. Turn this off if the overlay closes by itself over a game.'
        }
      />
      <ShortcutEditor
        value={overlay?.shortcuts}
        onChange={(shortcuts, resetOpenShortcut) =>
          setOverlay({ shortcuts, ...(resetOpenShortcut === undefined ? {} : { openShortcut: resetOpenShortcut }) })
        }
        openShortcut={overlay?.openShortcut ?? 'Alt+X'}
        onOpenShortcutChange={(openShortcut) => setOverlay({ openShortcut })}
      />
      <div className="space-y-3 rounded-2xl border border-line bg-panel2/30 p-3">
        <div>
          <p className="text-sm font-medium">Capture folders</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Screenshots go to your Pictures folder, recordings and replays to your Videos folder, each
            in an Orbit folder with a subfolder for the game. Choose a folder here to put one somewhere
            else.
          </p>
        </div>
        {captureFolders.map((folder) => (
          <div key={folder.kind} className="space-y-2 rounded-xl border border-line bg-panel2/40 px-3 py-2">
            <span className="min-w-0">
              <span className="block text-xs text-fg">{folder.label}</span>
              <span className="block break-all font-mono text-[11px] text-muted">{folder.path || 'Choose a folder to set this location'}</span>
            </span>
            <div className="flex flex-wrap gap-2">
              {isNative() && (
                <button
                  type="button"
                  onClick={() => void pickFolder(`Choose a folder for ${folder.label}`, folder.custom || folder.path || (where || undefined)).then((path) => path && setOverlay({ [folder.setting]: path } as Partial<NonNullable<Settings['overlay']>>))}
                  className={btnBrowse}
                >
                  <FolderOpen className="mr-1.5 inline size-3.5" />
                  Choose folder…
                </button>
              )}
              {folder.custom && (
                <button
                  type="button"
                  onClick={() => setOverlay({ [folder.setting]: undefined } as Partial<NonNullable<Settings['overlay']>>)}
                  className={btnBrowse}
                >
                  Use default folder
                </button>
              )}
              <button
                type="button"
                disabled={!folder.path}
                onClick={() => void overlayOpenKind(folder.kind).then(() => setFolderNote(null)).catch((error) => setFolderNote(error instanceof Error ? error.message : String(error)))}
                className={btnBrowse}
              >
                Open
              </button>
            </div>
          </div>
        ))}
        {folderNote && <p className="text-xs text-muted">{folderNote}</p>}
      </div>
      <div className="space-y-1.5">
        <p className="text-sm font-medium">Overlay boxes</p>
        <p className="text-xs leading-relaxed text-muted">Turn a box off and it stays out of the overlay. The same switches are on the overlay, so a hidden capture box can still be brought back.</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              // Version zero tells an unmounted panel to generate fresh,
              // screen-sized defaults the next time it opens.
              setOverlay({ layout: {}, layoutRevision: 0 });
              setLayoutNote('Default positions will be restored now, or the next time you open the overlay.');
              void emit('overlay-layout-reset');
            }}
            className={btnBrowse}
          >
            Restore default positions
          </button>
          {OVERLAY_BOXES.map((box) => {
            const shown = !(overlay?.hidden ?? []).includes(box.id);
            return (
              <button
                key={box.id}
                type="button"
                aria-pressed={shown}
                onClick={() => {
                  const hidden = new Set(overlay?.hidden ?? []);
                  if (shown) hidden.add(box.id);
                  else hidden.delete(box.id);
                  setOverlay({ hidden: [...hidden] as OverlayBoxId[] });
                }}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-xs',
                  shown ? 'border-accent bg-accent/15 text-fg' : 'border-line bg-panel2 text-muted hover:border-accent',
                )}
              >
                {shown ? box.label : `${box.label} hidden`}
              </button>
            );
          })}
        </div>
        {layoutNote && <p role="status" className="text-xs text-muted">{layoutNote}</p>}
      </div>
    </>
  );
}

function withSound(
  settings: Settings,
  patch: Partial<NonNullable<Settings['sound']>>,
): NonNullable<Settings['sound']> {
  return {
    enabled: settings.sound?.enabled !== false,
    volume: settings.sound?.volume ?? 0.35,
    unfocused: settings.sound?.unfocused === true,
    file: settings.sound?.file ?? null,
    ...patch,
  };
}

function fileName(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut >= 0 ? path.slice(cut + 1) : path;
}

export function SettingsView({
  settings,
  setSettings,
  onImportLauncher,
  onClearLibrary,
  onReset,
  onLibraryChanged,
  update,
  onFoundUpdate,
}: {
  settings: Settings;
  /** Takes a patch, so each field saves on its own. */
  setSettings: (patch: Partial<Settings> | ((current: Settings) => Partial<Settings>)) => void;
  /** Opens a read-only scan for one specific launcher. */
  onImportLauncher: (launcher: LauncherId) => void;
  onClearLibrary: () => void;
  /** Games, sessions, notes and settings all returned to a fresh install. */
  onReset: () => void;
  /** Re-read the library after a copy brings journal or sessions in. */
  onLibraryChanged?: () => void;
  /** The newer release the app already found when it opened, if there was one. */
  update: ReleaseInfo | null;
  /** Reports what a check from in here found, so the offer travels with the app. */
  onFoundUpdate: (info: ReleaseInfo | null) => void;
}) {
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [folder, setFolder] = useState('');
  const [where, setWhere] = useState<{ path: string; size: number } | null>(null);
  /** True when this copy keeps everything beside the program. */
  const [portable, setPortable] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const [installStep, setInstallStep] = useState<InstallStep | null>(null);
  const [updateNote, setUpdateNote] = useState('');
  const [settingsQuery, setSettingsQuery] = useState('');
  const [startupBusy, setStartupBusy] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [exeContextMenuBusy, setExeContextMenuBusy] = useState(false);
  const [exeContextMenuError, setExeContextMenuError] = useState<string | null>(null);
  const [musicError, setMusicError] = useState<string | null>(null);
  const [musicBusy, setMusicBusy] = useState(false);
  const native = isNative();

  const chooseMusic = async () => {
    setMusicError(null);
    const picked = await pickFile('Choose music', ['mp3', 'ogg', 'oga', 'wav', 'flac', 'm4a', 'aac', 'opus']);
    if (!picked) return;
    setMusicBusy(true);
    try {
      const kept = await rememberMusic(picked);
      setSettings({ sound: withSound(settings, { file: kept, enabled: true }) });
    } catch (reason) {
      setMusicError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setMusicBusy(false);
    }
  };

  const setOpenExeInOrbit = async (enabled: boolean) => {
    setExeContextMenuBusy(true);
    setExeContextMenuError(null);
    try {
      await setExeContextMenu(enabled);
      setSettings({ openExeInOrbit: enabled });
    } catch (reason) {
      setExeContextMenuError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setExeContextMenuBusy(false);
    }
  };

  const setLaunchAtSignIn = async (enabled: boolean) => {
    setStartupBusy(true);
    setStartupError(null);
    try {
      await setLaunchOnStartup(enabled);
      setSettings({ launchOnStartup: enabled });
    } catch (reason) {
      setStartupError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setStartupBusy(false);
    }
  };

  const setLauncherScanOnLaunch = (launcher: LauncherId, enabled: boolean) => {
    if (launcher === 'Steam') {
      setSettings({ steamOnLaunch: enabled });
      return;
    }
    const current = settings.launcherScanOnLaunch ?? [];
    const next = enabled
      ? [...new Set([...current, launcher])]
      : current.filter((item) => item !== launcher);
    setSettings({ launcherScanOnLaunch: next });
  };

  const lookForUpdate = async () => {
    setChecking(true);
    setUpdateNote('');
    try {
      const found = await checkForUpdate(undefined, settings.updatePrerelease === true);
      onFoundUpdate(found);
      setCheckedAt(Date.now());
      if (!found) setUpdateNote(`No newer release was found. This is Orbit ${APP_VERSION}.`);
    } finally {
      setChecking(false);
    }
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
    void dataPortable().then(setPortable).catch(() => undefined);
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
    scrollSettingsSectionToTop(el);
    el.classList.add('settings-spot');
    window.setTimeout(() => el.classList.remove('settings-spot'), 2400);
  };

  const searchResults = settingsQuery.trim()
    ? SETTINGS_SEARCH_ITEMS.filter(
        (item) =>
          (desktopOs() === 'windows' || desktopOs() === 'linux' || item.label !== 'Open in Orbit') &&
          `${item.label} ${item.keywords}`.toLowerCase().includes(settingsQuery.trim().toLowerCase()),
      )
    : [];

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-5 sm:p-7 lg:p-8">
      <header className="relative overflow-hidden rounded-3xl border border-line bg-gradient-to-br from-panel via-panel/95 to-panel2/75 p-5 shadow-lg sm:p-6">
        <div className="pointer-events-none absolute -right-10 -top-16 size-48 rounded-full bg-accent/10 blur-3xl" aria-hidden />
        <div className="relative flex items-start gap-4">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl border border-accent/25 bg-accent/10 text-accent">
            <SlidersHorizontal className="size-5" strokeWidth={1.8} />
          </span>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-accent">Your Orbit</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">Settings</h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
              Make Orbit feel right for you. Changes save as you make them - there is no Save button to hunt for.
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
      <nav className="orbit-sticky sticky top-[4.25rem] z-10 flex flex-wrap justify-center gap-1.5 rounded-2xl border border-line bg-panel p-2 shadow-lg backdrop-blur-xl">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => jump(s.id)}
            className="rounded-full border border-line/70 bg-bg/45 px-3 py-1.5 text-xs font-medium text-muted shadow-sm transition hover:border-accent/50 hover:bg-accent/10 hover:text-fg"
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

        <SubHead>Typeface</SubHead>
        <div className="grid gap-2 sm:grid-cols-2">
          {FONTS.map((font) => (
            <button
              key={font.id}
              type="button"
              onClick={() => setSettings({ fontFamily: font.id as FontChoice })}
              aria-pressed={(settings.fontFamily ?? 'system') === font.id}
              className={cn(
                'rounded-xl border px-3 py-3 text-left transition',
                (settings.fontFamily ?? 'system') === font.id
                  ? 'border-accent bg-accent/10 shadow-[0_0_0_1px_var(--c-accent)]'
                  : 'border-line bg-panel2/40 hover:border-accent/50',
              )}
              style={{ fontFamily: font.stack }}
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-semibold">{font.name}</span>
                <span className="text-lg font-bold">Aa</span>
              </span>
              <span className="mt-1 block text-xs text-muted">{font.sample}</span>
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
        <Checkbox
          checked={settings.launchOnStartup === true}
          onChange={(value) => void setLaunchAtSignIn(value)}
          disabled={!native || startupBusy}
          label="Launch Orbit when this PC starts"
          hint={native
            ? 'Off by default. When enabled, Orbit starts when you sign in to this computer.'
            : 'Available in the desktop app. Off by default; when enabled, Orbit starts when you sign in.'}
        />
        <Checkbox
          checked={settings.launchOnStartupBackground === true}
          onChange={(value) => setSettings({ launchOnStartupBackground: value })}
          disabled={!native || settings.launchOnStartup !== true || startupBusy}
          label="Start Orbit in the background"
          hint={settings.launchOnStartup === true
            ? 'At sign-in, keep the window hidden and leave Orbit available from the system tray. Opening Orbit normally still shows the window.'
            : 'Turn on “Launch Orbit when this PC starts” above to use this option.'}
          className="ml-5"
        />
        {startupError && <p role="alert" className="text-[11px] text-rose-300">Could not change startup: {startupError}</p>}
        {(desktopOs() === 'windows' || desktopOs() === 'linux') && (
          <>
            <SubHead>{desktopOs() === 'windows' ? 'Windows Explorer' : 'File manager'}</SubHead>
            <Checkbox
              checked={settings.openExeInOrbit !== false}
              onChange={(enabled) => void setOpenExeInOrbit(enabled)}
              disabled={exeContextMenuBusy}
              label={desktopOs() === 'windows' ? 'Add “Open in Orbit” to .exe right-click menus' : 'Add “Open in Orbit” to right-click menus'}
              hint={desktopOs() === 'windows'
                ? 'Enabled by default. Turn it off to remove Orbit’s entry from Explorer; it does not change any other file associations.'
                : 'Enabled by default. Adds the action to KDE, Nemo and Thunar menus, to Nautilus and Caja under Scripts, and to Open With. It does not change which program opens a file. Close the file manager and open it again if the menu was already up.'}
            />
            {exeContextMenuError && (
              <p role="alert" className="text-[11px] text-rose-300">Could not update the menu: {exeContextMenuError}</p>
            )}
          </>
        )}
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

        <SubHead>Library filters</SubHead>
        <p className="text-xs leading-relaxed text-muted">
          Drag to choose the order of the Library chips. Hide the ones you do not use; at least one stays visible.
        </p>
        <LibraryFilterOrder
          order={orderedLibraryFilters(settings.libraryFilterOrder).map((item) => item.id)}
          hidden={settings.hiddenLibraryFilters ?? []}
          onChange={(libraryFilterOrder, hiddenLibraryFilters) => setSettings({ libraryFilterOrder, hiddenLibraryFilters })}
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

        <SubHead>Closing Orbit itself</SubHead>
        <p className="text-xs leading-relaxed text-muted">
          Separate from what happens around a game. The minimise button is the usual one, and stays on the taskbar.
          Hiding only works when the tray icon is there; otherwise Orbit quits, so it cannot vanish with no way back.
        </p>
        <Setting
          label="When the close button is pressed"
          value={settings.window.onAppClose ?? 'quit'}
          onChange={(v) => setSettings({ window: { ...settings.window, onAppClose: v } })}
          options={[
            { value: 'quit', label: 'Close completely', hint: 'The window goes, the clock is written down, and Orbit exits.' },
            {
              value: 'tray',
              label: 'Hide to the tray',
              hint: 'The window leaves the taskbar. Left click the tray icon to bring it back.',
            },
          ]}
        />

      </Section>

      <Section
        id="orbit-overlay"
        icon={MonitorPlay}
        title="Overlay"
        lead="A fullscreen panel over the game. Change its keyboard shortcut below, or open it with Start and Select together. Pictures, recordings, and replays are saved on this PC. Recordings and replays use system-output audio when available; the microphone is not captured."
      >
        <OverlaySettings settings={settings} setSettings={setSettings} where={where?.path ?? ''} />
      </Section>

      <Section
        id="orbit-backups"
        icon={Save}
        title="Backups"
        lead="Add a cloud here. Disconnect one here too."
      >
        <Checkbox
          checked={cloudAutoOn(settings.saves)}
          onChange={(on) => setSettings((current) => ({ saves: savesWithClouds(current.saves, { cloudAuto: on }) }))}
          label="Also send a backup to the cloud"
          hint="A backup saved on this PC is also sent to the clouds marked on the Cloud page. Off leaves it on this PC until you send it."
        />
        <AddCloud settings={settings} setSettings={setSettings} />
        <CloudTools />
        <CloudAccounts settings={settings} setSettings={setSettings} />
      </Section>

      <Section
        id="orbit-libraries"
        icon={LibraryIcon}
        title="Libraries"
        lead="Scan one launcher and choose games to add. Rescans on Orbit launch are off by default."
      >
        {!native && <p className="text-xs text-muted">Local scans and startup rescans are available in the desktop app.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {LAUNCHERS.filter((launcher) => launcherOn(launcher.id, desktopOs())).map((launcher) => {
            const scannable = canScan(launcher);
            const rescan = launcher.id === 'Steam'
              ? settings.steamOnLaunch
              : (settings.launcherScanOnLaunch ?? []).includes(launcher.id);
            return (
              <div key={launcher.id} className="overflow-hidden rounded-2xl border border-line bg-panel/55">
                <button
                  type="button"
                  onClick={() => onImportLauncher(launcher.id)}
                  disabled={!scannable}
                  className="group flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-accent/5 disabled:hover:bg-transparent"
                >
                  <span
                    className="grid size-10 shrink-0 place-items-center rounded-xl border bg-panel"
                    style={{ color: launcher.color, borderColor: `${launcher.color}55` }}
                  >
                    <LauncherIcon launcher={launcher.id} className="size-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-fg">{launcher.id}</span>
                    <span className="block text-[11px] text-muted">
                      {scannable ? 'Scan library' : NOT_SCANNABLE_NOTE}
                    </span>
                  </span>
                  {scannable && (
                    <Download className="size-4 shrink-0 text-muted transition group-hover:text-accent" />
                  )}
                </button>
                <div className="border-t border-line/70 px-3 py-2.5">
                  <CheckboxInline
                    checked={rescan && scannable}
                    disabled={!native || !scannable}
                    onChange={(value) => setLauncherScanOnLaunch(launcher.id, value)}
                    label="Rescan on Orbit launch"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section
        id="orbit-details"
        icon={Sparkles}
        title="Artwork and details"
        lead="Orbit can use Steam's public catalogue for artwork and details. That does not make a game a Steam launch: only games imported from your Steam library start through Steam."
      >
        <div className="rounded-2xl border border-line bg-panel/40 p-3">
          <label className="block text-sm font-semibold text-fg" htmlFor="sgdb-key">
            SteamGridDB API key
          </label>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Optional. Steam's own artwork needs nothing and is used when this is empty. A key asks
            SteamGridDB for portrait covers only, a page at a time. Get a free key from{' '}
            <button
              type="button"
              className="underline decoration-line underline-offset-2 transition hover:text-accent"
              onClick={() => void openExternal('https://www.steamgriddb.com/profile/preferences')}
            >
              your SteamGridDB profile
            </button>
            . It stays on this machine, in your settings file.
          </p>
          <div className="mt-2.5 flex gap-2">
            <input
              id="sgdb-key"
              type="password"
              value={settings.sgdbApiKey ?? ''}
              onChange={(e) => setSettings({ sgdbApiKey: e.target.value })}
              placeholder="Leave empty to use Steam's artwork only"
              className={`${inputCls} min-w-0 flex-1 font-mono`}
              spellCheck={false}
              autoComplete="off"
            />
            {settings.sgdbApiKey && (
              <button
                type="button"
                onClick={() => setSettings({ sgdbApiKey: '' })}
                className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs text-muted transition hover:border-accent hover:text-fg"
              >
                Clear
              </button>
            )}
          </div>
        </div>
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
        lead="A quiet chord, made in the app. Nothing is downloaded. A file you pick replaces it, and Restore brings the chord back."
      >
        <Group>
          <Checkbox
            checked={settings.sound?.enabled !== false}
            onChange={(v) => setSettings({ sound: withSound(settings, { enabled: v }) })}
            label="Play something quiet in the background"
            hint="A slow melody over one soft chord, unless a file is chosen below. No random notes or chord changes."
          />

          <label className={cn('block space-y-1', settings.sound?.enabled === false && 'opacity-50')}>
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
                disabled={settings.sound?.enabled === false}
                onChange={(e) =>
                  setSettings({ sound: withSound(settings, { enabled: true, volume: Number(e.target.value) / 100 }) })
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
            onChange={(v) => setSettings({ sound: withSound(settings, { unfocused: v }) })}
            label="Keep playing while Orbit is not the window in front"
            hint="Off: the music steps aside when you click away, and comes back when you do. On: it carries on, which is what a second monitor wants."
          />

          <SubHead>Your own music</SubHead>
          <p className="text-xs leading-relaxed text-muted">
            {settings.sound?.file
              ? `Playing ${fileName(settings.sound.file)}. Restore the default to hear the chord again.`
              : 'The default chord is what plays. ogg, wav, and flac are the surest files. If a file will not play, the chord is used.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!native || musicBusy}
              onClick={() => void chooseMusic()}
              className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition hover:border-accent/50 hover:text-fg disabled:opacity-50"
            >
              Choose a file
            </button>
            <button
              type="button"
              disabled={!settings.sound?.file || musicBusy}
              onClick={() => {
                setMusicError(null);
                setSettings({ sound: withSound(settings, { file: null }) });
              }}
              className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted transition hover:border-accent/50 hover:text-fg disabled:opacity-50"
            >
              Restore the default
            </button>
          </div>
          {musicError && (
            <p role="alert" className="text-xs text-rose-300">
              {musicError}
            </p>
          )}
          {!native && <p className="text-xs text-muted">Choosing a file needs the desktop app.</p>}

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

      <Section
        id="orbit-copy"
        icon={ArrowLeftRight}
        title="Export and import"
        lead="Save this Orbit to a file you keep, and bring that file back later. Settings always go in. The journal and the sessions go in only if you tick them. This is not a copy of the games' save files."
      >
        <CopySettings settings={settings} setSettings={setSettings} onLibraryChanged={onLibraryChanged} />
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
        <p className="text-xs leading-relaxed text-muted">
          {portable
            ? 'This is the portable copy: the library, the settings, the backups, the screenshots, the recordings and the replays all live in that folder, beside the program. Move the folder and they move with it.'
            : 'The library, the settings, the backups and the captures live in that folder. A portable copy keeps them beside the program instead.'}
        </p>
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
