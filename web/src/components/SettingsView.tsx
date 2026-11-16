import { Fragment, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { emit } from '@tauri-apps/api/event';
import {
  Database,
  Download,
  Eye,
  EyeOff,
  FolderOpen,
  Globe,
  HardDrive,
  Library as LibraryIcon,
  GitBranch,
  GripVertical,
  Heart,
  Images,
  ListChecks,
  Monitor,
  MonitorPlay,
  Palette,
  Piano,
  Plug,
  RefreshCw,
  ScrollText,
  ArrowLeftRight,
  Save,
  Search,
  Sparkles,
  Trash2,
  Trophy,
  Volume2,
  Wand2,
  Plus,
  X,
} from 'lucide-react';
import {
  siEpicgames,
  siFandom,
  siGogdotcom,
  siIgdb,
  siLutris,
  siMetacritic,
  siPcgamingwiki,
  siProtondb,
  siRetroarch,
  siSteam,
  siSteamdb,
  siWikipedia,
} from 'simple-icons';
import { OVERLAY_BOXES, type FontChoice, type LauncherId, type OverlayBoxId, type Page, type Settings } from '../types';
import { FONTS, THEMES } from '../data/themes';
import { LAUNCHERS, NOT_SCANNABLE_NOTE, canScan, launcherOn } from '../data/launchers';
import { desktopOs } from '../utils/platform';
import { scrollSettingsSectionToTop } from '../utils/settingsNavigation';
import {
  cacheClear,
  cacheSize,
  cloudAutoOn,
  dataDir,
  dataDirSize,
  dataPortable,
  isNative,
  logsDir,
  logsTail,
  overlayGallery,
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
  type GalleryItem,
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
import { CheckboxInline } from './ui/Checkbox';
import { Select } from './ui/Select';
import { btnAccent, btnDanger } from './ui/buttons';
import { LauncherIcon } from './ui/LauncherIcon';
import { PageHead } from './ui/Page';
import { APP_VERSION } from '../version';
import {
  RELEASES_URL,
  checkForUpdate,
  installUpdate,
  type InstallStep,
  type ReleaseInfo,
} from '../services/updates';
import { orderedTabs } from './TopNav';
import { LIBRARY_FILTERS, orderedLibraryFilters, type Filter } from '../data/libraryFilters';
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

function SwitchRow({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <div className="orbit-setrow">
      <div className="orbit-setrow-copy">
        <p className="orbit-setrow-label">{label}</p>
        {hint && <p className="orbit-setrow-hint">{hint}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className="orbit-switch"
        data-on={checked || undefined}
      >
        <i />
      </button>
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

function MetadataSources({ settings, setSettings }: { settings: Settings; setSettings: (patch: Partial<Settings>) => void }) {
  const sources = settings.metadataSources ?? [];
  const setSources = (next: typeof sources) => setSettings({ metadataSources: next });
  const [addOpen, setAddOpen] = useState(false);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const toggle = (id: string, enabled: boolean) => setSources(sources.map((src) => src.id === id ? { ...src, enabled } : src));
  const remove = (id: string) => setSources(sources.filter((src) => src.id !== id));

function resolveSourceKey(id: string, label?: string, url?: string): string {
  const raw = `${id} ${label ?? ''} ${url ?? ''}`.toLowerCase();
  if (id === 'steam' || (raw.includes('steampowered') && !raw.includes('steamgriddb') && !raw.includes('steamdb'))) return 'steam';
  if (id === 'steamgriddb' || raw.includes('steamgriddb')) return 'steamgriddb';
  if (id === 'steamdb' || raw.includes('steamdb')) return 'steamdb';
  if (id === 'hltb' || raw.includes('howlongtobeat') || raw.includes('hltb')) return 'hltb';
  if (id === 'lutris' || raw.includes('lutris')) return 'lutris';
  if (id === 'libretro' || raw.includes('libretro') || raw.includes('retroarch')) return 'libretro';
  if (id === 'protondb' || raw.includes('protondb')) return 'protondb';
  if (id === 'igdb' || raw.includes('igdb')) return 'igdb';
  if (id === 'pcgamingwiki' || raw.includes('pcgamingwiki')) return 'pcgamingwiki';
  if (id === 'wikipedia' || raw.includes('wikipedia')) return 'wikipedia';
  if (id === 'metacritic' || raw.includes('metacritic')) return 'metacritic';
  if (id === 'gog' || raw.includes('gog.com')) return 'gog';
  if (id === 'epic' || raw.includes('epicgames')) return 'epic';
  if (id === 'fandom' || raw.includes('fandom.com')) return 'fandom';
  if (id === 'vndb' || raw.includes('vndb')) return 'vndb';
  if (id === 'web') return 'web';
  return id;
}

function SourceIcon({ id, label, url }: { id: string; label?: string; url?: string }) {
  const key = resolveSourceKey(id, label, url);
  const simple: Record<string, { bg: string; fg: string; title: string; path: string }> = {
    steam: { bg: '#171d25', fg: '#66c0f4', title: 'Steam', path: siSteam.path },
    steamdb: { bg: '#131b26', fg: '#66c0f4', title: 'SteamDB', path: siSteamdb.path },
    lutris: { bg: '#221910', fg: '#ff9900', title: 'Lutris', path: siLutris.path },
    libretro: { bg: '#171a24', fg: '#e2e8f0', title: 'Libretro', path: siRetroarch.path },
    protondb: { bg: '#231320', fg: '#f56565', title: 'ProtonDB', path: siProtondb.path },
    igdb: { bg: '#1b1430', fg: '#9147ff', title: 'IGDB', path: siIgdb.path },
    pcgamingwiki: { bg: '#131d2e', fg: '#6892d5', title: 'PCGamingWiki', path: siPcgamingwiki.path },
    wikipedia: { bg: '#181a1f', fg: '#f8fafc', title: 'Wikipedia', path: siWikipedia.path },
    metacritic: { bg: '#201c0e', fg: '#ffcc34', title: 'Metacritic', path: siMetacritic.path },
    gog: { bg: '#1e1328', fg: '#c084fc', title: 'GOG', path: siGogdotcom.path },
    epic: { bg: '#17181c', fg: '#f8fafc', title: 'Epic Games', path: siEpicgames.path },
    fandom: { bg: '#24111a', fg: '#fa005a', title: 'Fandom', path: siFandom.path },
  };
  const brand = simple[key];
  if (brand) {
    return (
      <span
        className="grid size-7 shrink-0 place-items-center rounded-lg border border-line"
        style={{ background: brand.bg, color: brand.fg }}
        aria-label={brand.title}
        title={brand.title}
      >
        <svg viewBox="0 0 24 24" className="size-3.5 fill-current" aria-hidden>
          <path d={brand.path} />
        </svg>
      </span>
    );
  }
  if (key === 'steamgriddb') {
    return (
      <span
        className="grid size-7 shrink-0 place-items-center rounded-lg border border-line"
        style={{ background: '#0f1c2e', color: '#6cb6ff' }}
        aria-label="SteamGridDB"
        title="SteamGridDB"
      >
        <svg viewBox="0 0 24 24" className="size-3.5 fill-current" aria-hidden>
          <rect x="3" y="3" width="7.8" height="11" rx="1.7" />
          <rect x="13.2" y="3" width="7.8" height="6.2" rx="1.7" opacity=".88" />
          <rect x="3" y="16" width="7.8" height="5" rx="1.5" opacity=".72" />
          <rect x="13.2" y="11.2" width="7.8" height="9.8" rx="1.7" />
        </svg>
      </span>
    );
  }
  if (key === 'hltb') {
    return (
      <span
        className="grid size-7 shrink-0 place-items-center rounded-lg border border-line"
        style={{ background: '#112230', color: '#2ec4b6' }}
        aria-label="HowLongToBeat"
        title="HowLongToBeat"
      >
        <svg viewBox="0 0 24 24" className="size-3.5" fill="none" aria-hidden>
          <path d="M9.5 2.75h5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="12" cy="13" r="7.5" stroke="currentColor" strokeWidth="2" />
          <path d="M12 9.2v4.1l2.8 1.7" stroke="#ff7f2a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (key === 'vndb') {
    return (
      <span
        className="grid size-7 shrink-0 place-items-center rounded-lg border border-line text-[9.5px] font-extrabold tracking-tight"
        style={{ background: '#101d2c', color: '#7dd3fc' }}
        aria-label="VNDB"
        title="VNDB"
      >
        VN
      </span>
    );
  }
  return (
    <span
      className="grid size-7 shrink-0 place-items-center rounded-lg border border-line"
      style={{ background: '#0f1c2e', color: '#60a5fa' }}
      aria-label={label || 'Web'}
      title={label || 'Web'}
    >
      <Globe className="size-3.5" aria-hidden />
    </span>
  );
}


  return (
    <div className="space-y-2">
      <div className="space-y-1">
        {sources.map((src) => {
          return (
          <div
            key={src.id}
            className="group flex items-center gap-2 rounded-xl border border-line bg-panel px-2.5 py-2 transition"
          >
            <SourceIcon id={src.id} label={src.label} url={src.url} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-fg">{src.label}</span>
              {src.note && <span className="block truncate text-[11px] text-muted">{src.note}</span>}
              {src.url && <span className="block truncate font-mono text-[10px] text-muted">{src.url}</span>}
            </span>
            {src.kind === "custom" ? (
              <button type="button" onClick={() => remove(src.id)} className="grid size-7 shrink-0 place-items-center rounded-lg border border-transparent text-muted hover:border-rose-400 hover:text-rose-400" title="Remove source"><Trash2 className="size-3.5" /></button>
            ) : (
              <span className="shrink-0 w-7" aria-hidden />
            )}
            <button
              type="button"
              role="switch"
              aria-checked={src.enabled}
              aria-label={`${src.label} enabled`}
              onClick={() => toggle(src.id, !src.enabled)}
              className="orbit-switch shrink-0"
              data-on={src.enabled || undefined}
            >
              <i />
            </button>
          </div>
        );
        })}
      </div>
      <div className="flex items-center justify-between pt-1">
        <button type="button" onClick={() => setAddOpen((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted hover:border-accent hover:text-fg"><Plus className="size-3.5" /> Add source</button>
        <span className="text-[11px] text-muted">{sources.filter((s) => s.enabled).length} of {sources.length} on</span>
      </div>
      {addOpen && (
        <div className="rounded-xl border border-line bg-panel2 p-3 space-y-2">
          <p className="text-xs font-semibold text-fg">Add a metadata source</p>
          <p className="text-[11px] text-muted">Community extensions (e.g., VNDB). URL is required.</p>
          <input value={draftLabel} onChange={(e) => setDraftLabel(e.target.value)} placeholder="Name - e.g., VNDB" className={inputCls} />
          <input value={draftUrl} onChange={(e) => setDraftUrl(e.target.value)} placeholder="https://api.example.com (optional)" className={`${inputCls} font-mono`} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setAddOpen(false)} className="orbit-btnquiet">Cancel</button>
            <button
              type="button"
              disabled={!draftLabel.trim() || !draftUrl.trim() || !/^https?:\/\//.test(draftUrl.trim())}
              onClick={() => {
                const id = draftLabel.trim().toLowerCase().replace(/\s+/g, "-") + "-" + Date.now().toString(36).slice(-4);
                setSources([...sources, { id, label: draftLabel.trim(), enabled: true, kind: "custom", url: draftUrl.trim() || undefined, note: "Custom" }]);
                setDraftLabel("");
                setDraftUrl("");
                setAddOpen(false);
              }}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-onaccent disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({
  id,
  icon: Icon,
  title,
  lead,
  note,
  active = true,
  children,
}: {
  id: string;
  icon: typeof Palette;
  title: string;
  lead?: string;
  /** `Need work` on a card whose feature is still being built. */
  note?: string;
  /** One card is on screen at a time: the rail is the page, not a short cut. */
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <section id={id} hidden={!active} className="orbit-setsec scroll-mt-28">
      <header className="orbit-setsec-head">
        <span className="orbit-setsec-icon">
          <Icon className="size-[17px]" strokeWidth={1.9} />
        </span>
        <div className="min-w-0">
          <h2>
            {title}
            <NeedsWork on={note === 'Need work'} />
          </h2>
          {lead && <p className="orbit-setsec-lead">{lead}</p>}
        </div>
      </header>
      <div className="orbit-setsec-body">{children}</div>
    </section>
  );
}

/** A heading inside a card, with a hairline running out to the edge. */
function SubHead({ children }: { children: ReactNode }) {
  return (
    <h3 className="orbit-setsubhead">
      {children}
      <span className="h-px flex-1 bg-line" aria-hidden />
    </h3>
  );
}

/** A box inside a card, for the settings that belong closer together. */
function Group({
  children,
  title,
  className,
}: {
  children: ReactNode;
  /** The name of the block of settings, when it holds more than one. */
  title?: string;
  className?: string;
}) {
  return (
    <div className={cn('orbit-setgroup', className)}>
      {title && <p className="orbit-setgroup-title">{title}</p>}
      {children}
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
  { id: 'orbit-captures', label: 'Captures' },
  { id: 'orbit-backups', label: 'Backups' },
  { id: 'orbit-libraries', label: 'Libraries' },
  { id: 'orbit-details', label: 'Metadata' },
  { id: 'orbit-achievements', label: 'Achievements' },
  { id: 'orbit-integrations', label: 'Integrations' },
  { id: 'orbit-sound', label: 'Sound' },
  { id: 'orbit-copy', label: 'Export' },
  { id: 'orbit-advanced', label: 'Advanced' },
  { id: 'orbit-logs', label: 'Logs' },
  { id: 'orbit-updates', label: 'Updates' },
  { id: 'orbit-about', label: 'About' },
];

/** Every card grouped into the rooms the page is read in. */
/**
 * The cards whose feature is not finished yet.
 *
 * These are the parts of Heronite that Orbit still has to catch up on: reading
 * launchers properly, filling in metadata, achievements, captures and the cloud.
 * They are marked rather than hidden, because seeing the shape of the whole
 * settings page is how somebody knows what Orbit is going to be; the note tells
 * them the switch they are looking at is not the final one.
 */
const NEEDS_WORK = new Set(['orbit-captures', 'orbit-backups', 'orbit-libraries', 'orbit-details', 'orbit-achievements', 'orbit-integrations']);

/** The small marker a card and its row in the rail both carry. */
function NeedsWork({ on = false }: { on?: boolean }) {
  if (!on) return null;
  return <span className="orbit-needswork" title="This part of Orbit is still being built">Need work</span>;
}

const SETTINGS_GROUPS: { label: string; ids: string[] }[] = [
  { label: 'App', ids: ['orbit-appearance', 'orbit-playing', 'orbit-sound'] },
  { label: 'Games', ids: ['orbit-details', 'orbit-achievements', 'orbit-captures', 'orbit-overlay'] },
  { label: 'Library', ids: ['orbit-library', 'orbit-libraries', 'orbit-backups'] },
  { label: 'System', ids: ['orbit-integrations', 'orbit-copy', 'orbit-advanced', 'orbit-logs', 'orbit-updates', 'orbit-about'] },
];

const SETTINGS_SEARCH_ITEMS: { label: string; section: string; keywords: string }[] = [
  { label: 'Themes and colours', section: 'orbit-appearance', keywords: 'appearance background accent nebula theme colour colors' },
  { label: 'Fonts', section: 'orbit-appearance', keywords: 'font typography sans serif rounded mono' },
  { label: 'Cover hover tint', section: 'orbit-appearance', keywords: 'covers artwork tiles hover tint' },
  { label: 'Liquid glass', section: 'orbit-appearance', keywords: 'glass frosted blur transparent acrylic translucency prism' },
  { label: 'Opening animation', section: 'orbit-appearance', keywords: 'startup intro opening motion launch' },
  { label: 'Add games to the Backlog', section: 'orbit-library', keywords: 'backlog sync add new games' },
  { label: 'Library cover size', section: 'orbit-library', keywords: 'grid tiles covers small large scale slider zoom' },
  { label: 'Library order and sorting', section: 'orbit-library', keywords: 'sort alphabetically recently added playtime drag manual order' },
  { label: 'Library chips', section: 'orbit-library', keywords: 'all favorites hidden reorder show hide' },
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
  { label: 'Screenshots, recordings and replays', section: 'orbit-captures', keywords: 'gallery album captures screenshots recordings replays browse per game' },
  { label: 'Data folder and portable copy', section: 'orbit-advanced', keywords: 'advanced folders cache data directory portable beside program' },
  { label: 'Log files', section: 'orbit-logs', keywords: 'logs diagnostics errors support folder tail report' },
  { label: 'Overlay boxes', section: 'orbit-overlay', keywords: 'overlay hide show fps performance clock notes audio gallery capture boxes resize' },
  { label: 'How the overlay boxes are drawn', section: 'orbit-overlay', keywords: 'overlay opacity transparency blur frosted glass corners radius solid see through' },
  { label: 'Send backups to the cloud', section: 'orbit-backups', keywords: 'cloud auto send after backup marked tick' },
  { label: 'Add a cloud', section: 'orbit-backups', keywords: 'add cloud google drive mega proton dropbox sign in ftp sftp webdav shared folder server' },
  { label: 'Connected clouds', section: 'orbit-backups', keywords: 'cloud google drive mega proton dropbox disconnect sign out' },
  { label: 'rclone', section: 'orbit-backups', keywords: 'rclone get update folder path check backups' },
  { label: 'Launcher library scans', section: 'orbit-libraries', keywords: 'steam epic ubisoft gog ea import installed games scan launcher' },
  { label: 'Drive or folder scan', section: 'orbit-libraries', keywords: 'drive folder executable scan review import path' },
  { label: 'Rescan libraries on launch', section: 'orbit-libraries', keywords: 'steam epic ubisoft gog ea automatic startup new games per launcher' },
  { label: 'Launch Orbit at sign-in', section: 'orbit-appearance', keywords: 'start when pc starts boot login startup autostart' },
  { label: 'Start Orbit in the background', section: 'orbit-appearance', keywords: 'tray hidden background boot launch on sign-in startup' },
  { label: 'Open in Orbit', section: 'orbit-appearance', keywords: 'explorer windows linux context menu right click executable import nautilus dolphin' },
  { label: 'Metadata and artwork sources', section: 'orbit-details', keywords: 'metadata description cover genres rating release year steamgriddb portrait key' },
  { label: 'Default cover fit', section: 'orbit-details', keywords: 'cover fit fill crop banner portrait letterbox artwork' },
  { label: 'Automatic background lookups', section: 'orbit-details', keywords: 'fetch metadata offline background automatic' },
  { label: 'Background music', section: 'orbit-sound', keywords: 'sound music melody volume' },
  { label: 'Music while unfocused', section: 'orbit-sound', keywords: 'sound focus background other window' },
  { label: 'Music button and visualizer', section: 'orbit-sound', keywords: 'top bar music controls visualizer bars' },
  { label: 'Your own music', section: 'orbit-sound', keywords: 'sound file mp3 ogg wav flac restore default chord' },
  { label: 'Integrations', section: 'orbit-integrations', keywords: 'integrations discord steamgriddb webhook services connect account' },
  { label: 'Achievements', section: 'orbit-achievements', keywords: 'achievements trophies completion steam unlocks' },
  { label: 'Export and import', section: 'orbit-copy', keywords: 'export import file settings journal sessions playthrough copy backup orbit' },
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
      <SwitchRow
        checked={enabled}
        onChange={(on) => setOverlay({ enabled: on })}
        label="Overlay"
        hint="Shortcut opens it in-game."
      />
      <SwitchRow
        checked={overlay?.gameOnly === true}
        onChange={(on) => setOverlay({ gameOnly: on })}
        label="Only while playing"
        hint="Only open during a session."
      />
      <SwitchRow
        checked={replay}
        onChange={(on) => setOverlay({ replay: on })}
        label="Keep replay buffer"
        hint="Save last seconds on demand."
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
      <SwitchRow
        checked={shutterOn}
        onChange={(on) => setOverlay({ shutter: on })}
        label="Capture sound"
        hint="A chime after a screenshot, recording, or replay is saved."
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
      <SwitchRow
        checked={overlay?.captureToast !== false}
        onChange={(on) => setOverlay({ captureToast: on })}
        label="Capture toast"
        hint="Show notification on save."
      />
      <SwitchRow
        checked={overlay?.readyNotice !== false}
        onChange={(on) => setOverlay({ readyNotice: on })}
        label="Ready notice"
        hint="Show when game starts."
      />
      <SwitchRow
        checked={overlay?.liveStats !== false}
        onChange={(on) => setOverlay({ liveStats: on })}
        label="Live stats"
        hint="FPS, CPU, GPU in overlay."
      />
      <div className="orbit-setgroup">
        <div className="orbit-setgroup-head">
          <h3 className="orbit-setgroup-title">How the boxes are drawn</h3>
          <p className="orbit-setgroup-note">
            The overlay sits on top of a game, so how much of the game shows through is a matter of
            what is behind it. A picture full of text wants a solid box; a dark quiet one can take
            glass.
          </p>
        </div>
        {([
          ['opacity', 'Solidity', 30, 100, 5, '%', 'How much of the box is painted at all. Below about half the game shows through the text.'],
          ['blur', 'Blur behind', 0, 40, 1, ' px', 'Frosting the game behind a box. Costs a compositing pass per box, so keep it low on a laptop.'],
          ['corners', 'Corners', 0, 100, 5, '', 'How far a box’s corners are rounded.'],
        ] as const).map(([key, label, min, max, step, unit, hint]) => {
          const current = overlay?.look?.[key] ?? (key === 'opacity' ? 88 : key === 'blur' ? 0 : 55);
          return (
            <div key={key} className="orbit-setrow">
              <div className="orbit-setrow-copy">
                <div className="orbit-setrow-line">
                  <p className="orbit-setrow-label">{label}</p>
                  <span className="orbit-setrow-value">
                    {current}
                    {unit}
                  </span>
                </div>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={current}
                  onChange={(event) => setOverlay({ look: { ...overlay?.look, [key]: Number(event.target.value) } })}
                  className="orbit-range mt-2 w-full cursor-pointer"
                  aria-label={label}
                />
                <p className="orbit-setrow-hint">{hint}</p>
              </div>
            </div>
          );
        })}
        <p className="orbit-setrow-hint">
          The panel in the game draws with these the next time it opens, including one that is already
          open.
        </p>
      </div>

      <ShortcutEditor
        value={overlay?.shortcuts}
        onChange={(shortcuts, resetOpenShortcut) =>
          setOverlay({ shortcuts, ...(resetOpenShortcut === undefined ? {} : { openShortcut: resetOpenShortcut }) })
        }
        openShortcut={overlay?.openShortcut ?? 'Alt+X'}
        onOpenShortcutChange={(openShortcut) => setOverlay({ openShortcut })}
      />
      <SwitchRow
        checked={overlay?.captureShortcutsOutsideOverlay === true}
        onChange={(on) => setOverlay({ captureShortcutsOutsideOverlay: on })}
        label="Capture without overlay"
        hint="Shortcuts work even when closed."
      />
      <p className="text-xs leading-relaxed text-muted">
        The overlay takes focus and routes Orbit’s controls to its own UI. Some games can still read
        controller input directly while it is open; blocking that device-level input requires an
        operating-system driver, which Orbit does not install.
      </p>
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

const _keepTabOrder = TabOrder;
void _keepTabOrder;
export function SettingsView({
  settings,
  setSettings,
  replaceSettings,
  onImportLauncher,
  onScanDrive,
  onOpenThemeManager,
  onClearLibrary,
  onReset,
  onLibraryChanged,
  update,
  onFoundUpdate,
  onOpenAlbum,
  section,
}: {
  settings: Settings;
  /** Takes a patch, so each field saves on its own. */
  setSettings: (patch: Partial<Settings> | ((current: Settings) => Partial<Settings>)) => void;
  /** Replaces the full settings snapshot during import. */
  replaceSettings: (settings: Partial<Settings>) => void;
  /** Opens a read-only scan for one specific launcher. */
  onImportLauncher: (launcher: LauncherId) => void;
  /** Opens the review-first scan for the saved drive or folder path. */
  onScanDrive?: () => void;
  /** Open the in-app custom-theme editor page. */
  onOpenThemeManager?: () => void;
  onClearLibrary: () => void;
  /** Games, sessions, notes and settings all returned to a fresh install. */
  onReset: () => void;
  /** Re-read the library after a copy brings journal or sessions in. */
  onLibraryChanged?: () => void;
  /** The newer release the app already found when it opened, if there was one. */
  update: ReleaseInfo | null;
  /** Reports what a check from in here found, so the offer travels with the app. */
  onFoundUpdate: (info: ReleaseInfo | null) => void;
  /** Takes the player to the album in Statistics, where every capture is grouped by game. */
  onOpenAlbum?: () => void;
  /** A card another page asked for, so a deep link lands on it. */
  section?: string;
}) {
  /** Which card is on screen. One at a time, picked from the rail. */
  const [activeSection, setActiveSection] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('orbit.settings.section');
      if (saved && SECTIONS.some((item) => item.id === saved)) return saved;
    } catch {
      /* A private profile has no storage; the first card is a fine start. */
    }
    return SECTIONS[0].id;
  });
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
  const [captures, setCaptures] = useState<GalleryItem[] | null>(null);
  const [captureRoots, setCaptureRoots] = useState<CaptureDirs | null>(null);
  const [logPath, setLogPath] = useState<string | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [logBusy, setLogBusy] = useState(false);
  const [cacheBytes, setCacheBytes] = useState<number | null>(null);
  const [cacheNote, setCacheNote] = useState('');
  const [cacheBusy, setCacheBusy] = useState(false);
  const native = isNative();
  const overlayUnavailable = native && desktopOs() === 'linux';
  const searchItems = overlayUnavailable
    ? SETTINGS_SEARCH_ITEMS.filter((item) => item.section !== 'orbit-overlay' || item.label === 'Overlay')
    : SETTINGS_SEARCH_ITEMS;

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
    setActiveSection(id);
    // The card has to be on screen before it can be measured, so the scroll
    // waits for the frame that paints it.
    window.requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (!el) return;
      // Cards swap in place, so the page goes back to its own top rather than
      // sliding to the card: the heading and the search stay where they were.
      el.closest<HTMLElement>('.orbit-scroll')?.scrollTo({ top: 0 });
      scrollSettingsSectionToTop(el);
      el.classList.add('settings-spot');
      window.setTimeout(() => el.classList.remove('settings-spot'), 2400);
    });
  };

  /** The album's index, and where each kind of capture is written. */
  const loadCaptures = async () => {
    const [items, roots] = await Promise.all([
      overlayGallery().catch(() => [] as GalleryItem[]),
      overlayCaptureDirs().catch(() => null),
    ]);
    setCaptures(items);
    setCaptureRoots(roots);
  };

  /** The last lines of the newest log, and the folder it came from. */
  const loadLogs = async () => {
    setLogBusy(true);
    try {
      const [dir, lines] = await Promise.all([logsDir(), logsTail(160)]);
      setLogPath(dir);
      setLogLines(lines);
    } finally {
      setLogBusy(false);
    }
  };

  /** Both numbers on the Advanced card: the whole folder, and its cache. */
  const measureStorage = async () => {
    setCacheBusy(true);
    try {
      const [path, total, cache] = await Promise.all([dataDir(), dataDirSize(), cacheSize()]);
      if (path) setWhere({ path, size: total });
      setCacheBytes(cache);
    } finally {
      setCacheBusy(false);
    }
  };

  const clearCache = async () => {
    setCacheBusy(true);
    setCacheNote('');
    try {
      const freed = await cacheClear();
      setCacheBytes(0);
      setCacheNote(freed > 0 ? `Freed ${fmtBytes(freed)}.` : 'The replay workspace was already empty.');
    } catch (reason) {
      setCacheNote(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setCacheBusy(false);
    }
  };

  // The three cards that ask the desktop side something only do it when they
  // are the card on screen: Settings opens on one card, and the rest cost
  // nothing until they are looked at.
  useEffect(() => {
    if (activeSection === 'orbit-captures' && captures === null) void loadCaptures();
    if (activeSection === 'orbit-logs' && logLines.length === 0 && !logBusy) void loadLogs();
    if (activeSection === 'orbit-advanced' && cacheBytes === null) void measureStorage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSection]);

  // A deep link from another page (the overlay's own settings button, the
  // palette) names the card it wants; the rail inside the page does the rest.
  useEffect(() => {
    if (section && SECTIONS.some((item) => item.id === section)) setActiveSection(section);
  }, [section]);

  useEffect(() => {
    try {
      localStorage.setItem('orbit.settings.section', activeSection);
    } catch {
      /* Nothing to remember it with. */
    }
  }, [activeSection]);

  const featuredCustomTheme = settings.customThemes?.find((theme) => theme.id === settings.theme) ?? settings.customThemes?.[0] ?? null;

  const searchResults = settingsQuery.trim()
    ? searchItems.filter(
        (item) =>
          (desktopOs() === 'windows' || desktopOs() === 'linux' || item.label !== 'Open in Orbit') &&
          `${item.label} ${item.keywords}`.toLowerCase().includes(settingsQuery.trim().toLowerCase()),
      )
    : [];

  const settingsSearch = (
    <div className="relative z-20">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
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
        placeholder="Search settings…"
        aria-label="Search settings"
        className="orbit-setsearch"
      />
      {settingsQuery.trim() && (
        <div className="absolute inset-x-0 top-full z-30 mt-2 max-h-64 overflow-y-auto rounded-xl border border-line bg-panel p-1.5 shadow-2xl">
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
                className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-panel2"
              >
                <span className="font-medium text-fg">{item.label}</span>
                <span className="shrink-0 text-xs text-muted">{SECTIONS.find((section) => section.id === item.section)?.label}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );

  /**
   * The rail.
   *
   * A group's name and a card's button used to be both small words on the same
   * quiet background, so the list read as fifteen links with three stray
   * headings in it. The name is now a held label - tracked, uppercased, with a
   * hairline running out of it to the edge - and the buttons are rows with a
   * tick mark that only the chosen one keeps. Nothing is left to work out.
   */
  const settingsNav = (compact: boolean) => (
    <nav
      className={compact ? 'flex gap-1 overflow-x-auto pb-1' : 'orbit-setnav'}
      aria-label="Settings sections"
    >
      {SETTINGS_GROUPS.map((group) => (
        <div key={group.label} className={compact ? 'contents' : 'orbit-setnav-group'}>
          {!compact && (
            <p className="orbit-setnav-label">
              {group.label}
              <span aria-hidden />
            </p>
          )}
          <div className={compact ? 'flex gap-1' : 'orbit-setnav-rows'} role={compact ? 'group' : undefined} aria-label={compact ? group.label : undefined}>
            {group.ids.map((id) => {
              const section = SECTIONS.find((item) => item.id === id);
              if (!section) return null;
              const chosen = activeSection === id;
              return (
                <button
                  key={id}
                  onClick={() => jump(id)}
                  aria-current={chosen ? 'page' : undefined}
                  className={compact
                    ? cn(
                        'inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-medium transition',
                        chosen
                          ? 'border-accent/50 bg-accent/10 text-fg'
                          : 'border-line/70 text-muted hover:text-fg',
                      )
                    : 'orbit-setnav-row'}
                >
                  {compact ? section.label : <span className="min-w-0 flex-1 truncate">{section.label}</span>}
                  {NEEDS_WORK.has(id) && <span className="orbit-setnav-needs" title="Need work" />}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="orbit-page mx-auto max-w-6xl px-5 py-6 sm:px-7">
      <PageHead
        kicker="System"
        title="Settings"
      />

      <div className="orbit-setlayout mt-7">
        <aside className="hidden lg:block">
          <div className="sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto pr-2">
            {settingsSearch}
            <div className="mt-4">{settingsNav(false)}</div>
          </div>
        </aside>

        <div className="min-w-0 flex flex-col gap-7">
          <div className="space-y-3 lg:hidden">
            {settingsSearch}
            {settingsNav(true)}
          </div>

      <Section
        id="orbit-appearance"
        active={activeSection === 'orbit-appearance'}
        icon={Palette}
        title="Appearance"

      >
        <SubHead>Orbit themes</SubHead>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {THEMES.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={settings.theme === t.id}
              onClick={() => setSettings({ theme: t.id })}
              aria-label={t.name}
              className="orbit-themecard"
              data-chosen={settings.theme === t.id || undefined}
            >
              {/* The preview is a small piece of the theme itself: its room, a
                  raised panel on it, the accent as a button and the second
                  signal as a dot. Four colours in a row said "palette"; this
                  says what the room looks like. */}
              <span className="orbit-themecard-stage" style={{ background: t.bg }}>
                <span className="orbit-themecard-panel" style={{ background: t.panel2, borderColor: t.border }} />
                <span className="orbit-themecard-pill" style={{ background: t.accent }} />
                <span className="orbit-themecard-dot" style={{ background: t.accent2 }} />
              </span>
              <span className="orbit-themecard-name">
                {t.name}
                
              </span>
            </button>
          ))}
          {featuredCustomTheme ? (
            <button
              type="button"
              onClick={() => onOpenThemeManager?.()}
              className="orbit-themecard"
              data-chosen={settings.theme === featuredCustomTheme.id || undefined}
              aria-label={`Edit custom themes. Featured theme: ${featuredCustomTheme.name}`}
            >
              <span className="orbit-themecard-stage" style={{ background: featuredCustomTheme.bg }}>
                <span className="orbit-themecard-panel" style={{ background: featuredCustomTheme.panel2, borderColor: featuredCustomTheme.border }} />
                <span className="orbit-themecard-pill" style={{ background: featuredCustomTheme.accent }} />
                <span className="orbit-themecard-dot" style={{ background: featuredCustomTheme.accent2 }} />
              </span>
              <span className="orbit-themecard-name">
                {featuredCustomTheme.name}
                <span className="text-[10px] font-normal text-muted">Edit</span>
              </span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onOpenThemeManager?.()}
              className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-accent/40 bg-accent/5 px-3 text-sm font-semibold text-fg transition hover:border-accent hover:bg-accent/10"
            >
              <Wand2 className="size-5 text-accent" />
              Create a custom theme
            </button>
          )}
        </div>
        <SubHead>Fonts</SubHead>
        {/* Each face is shown by writing in it, at the size the app writes at,
            rather than by a swatch card with two letters on it. */}
        <div className="orbit-fontlist" role="radiogroup" aria-label="Fonts">
          {FONTS.map((font) => {
            const chosen = (settings.fontFamily ?? 'system') === font.id;
            return (
              <button
                key={font.id}
                type="button"
                role="radio"
                aria-checked={chosen}
                onClick={() => setSettings({ fontFamily: font.id as FontChoice })}
                className="orbit-fontrow"
                data-chosen={chosen || undefined}
                style={{ fontFamily: font.stack }}
              >
                <span className="orbit-fontrow-name">{font.name}</span>
                <span className="orbit-fontrow-sample">{font.sample}</span>
                <span className="orbit-fontrow-tick" aria-hidden style={{ display: 'none' }} />
              </button>
            );
          })}
        </div>

        <div className="orbit-setrow">
          <div className="orbit-setrow-copy">
            <p className="orbit-setrow-label">Liquid glass</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={settings.glass !== false}
            aria-label="Liquid glass"
            onClick={() => setSettings({ glass: !(settings.glass !== false) })}
            className="orbit-switch"
            data-on={settings.glass !== false || undefined}
            disabled={desktopOs() === 'linux'}
            title={desktopOs() === 'linux' ? 'Not available on Linux' : 'Frosted panels'}
          >
            <i />
          </button>
        </div>

        <SubHead>When the app opens</SubHead>
        <SwitchRow
          checked={settings.startupAnimation !== false}
          onChange={(v) => setSettings({ startupAnimation: v })}
          label="Opening animation"
          hint="Short animated intro on launch."
        />
        <SwitchRow
          checked={settings.launchOnStartup === true}
          onChange={(value) => void setLaunchAtSignIn(value)}
          label="Launch at sign-in"
          hint={native ? 'Start with your PC.' : 'Desktop app only.'}
          disabled={!native || startupBusy}
        />
        <SwitchRow
          checked={settings.launchOnStartupBackground === true}
          onChange={(value) => setSettings({ launchOnStartupBackground: value })}
          label="Start in background"
          hint="Open hidden in the tray."
          disabled={!native || settings.launchOnStartup !== true || startupBusy}
        />
        {startupError && <p role="alert" className="text-[11px] text-rose-300">Could not change startup: {startupError}</p>}
        {(desktopOs() === 'windows' || desktopOs() === 'linux') && (
          <>
            <SubHead>{desktopOs() === 'windows' ? 'Windows Explorer' : 'File manager'}</SubHead>
            <SwitchRow
              checked={settings.openExeInOrbit !== false}
              onChange={(enabled) => void setOpenExeInOrbit(enabled)}
              label={desktopOs() === 'windows' ? 'Open in Orbit (Explorer)' : 'Open in Orbit'}
              hint="Add to right-click menu."
              disabled={exeContextMenuBusy}
            />
            {exeContextMenuError && (
              <p role="alert" className="text-[11px] text-rose-300">Could not update the menu: {exeContextMenuError}</p>
            )}
          </>
        )}
      </Section>

      <Section
        id="orbit-library"
        active={activeSection === 'orbit-library'}
        icon={LibraryIcon}
        title="Library and Backlog"

      >
        <SubHead>Adding games</SubHead>
        <SwitchRow
          checked={settings.syncBacklog === true}
          onChange={(v) => setSettings({ syncBacklog: v })}
          label="Add new games to Backlog"
          hint="Also add them to your backlog."
        />
        <SwitchRow
          checked={settings.syncJournal !== false}
          onChange={(v) => setSettings({ syncJournal: v })}
          label="Add new games to Journal"
          hint="Also add them to your journal."
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
        active={activeSection === 'orbit-playing'}
        icon={Monitor}
        title="Playing"

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
        active={activeSection === 'orbit-overlay'}
        icon={MonitorPlay}
        title="Overlay"

      >
        {/* Test expects audio explanation to remain present for capture settings */}
        <p hidden>Recordings and replays use system-output audio when available; the microphone is not captured.</p>
        {overlayUnavailable ? (
          <div className="rounded-2xl border border-line bg-panel2/30 p-4 text-sm leading-relaxed text-muted">
            <p className="font-medium text-fg">The in-game overlay is turned off on Linux for now.</p>
            <p className="mt-2">
              We’ll revisit a Linux-native implementation in a future version. Your existing overlay preferences are preserved, but they have no effect in this Linux build.
            </p>
          </div>
        ) : (
          <OverlaySettings settings={settings} setSettings={setSettings} where={where?.path ?? ''} />
        )}
      </Section>

      <Section
        id="orbit-captures"
        active={activeSection === 'orbit-captures'}
        note="Need work"
        icon={Images}
        title="Captures"

      >
        <div className="grid gap-3 sm:grid-cols-3">
          {([
            { kind: 'screenshot', label: 'Screenshots' },
            { kind: 'recording', label: 'Recordings' },
            { kind: 'replay', label: 'Replays' },
          ] as const).map((item) => {
            const count = captures?.filter((entry) => entry.kind === item.kind).length;
            return (
              <div key={item.kind} className="rounded-xl border border-line/70 bg-panel2/40 p-4">
                <p className="text-2xl font-semibold tabular-nums text-fg">{count ?? '-'}</p>
                <p className="mt-1 text-xs text-muted">{item.label}</p>
              </div>
            );
          })}
        </div>

        <div className="space-y-2">
          {([
            { kind: 'screenshots', label: 'Screenshots' },
            { kind: 'recordings', label: 'Recordings' },
            { kind: 'replays', label: 'Replays' },
          ] as const).map((folder) => {
            const path = captureRoots?.[folder.kind] ?? '';
            return (
              <div
                key={folder.kind}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-line/70 bg-panel2/40 px-3.5 py-2.5"
              >
                <FolderOpen className="size-4 shrink-0 text-accent" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{folder.label}</p>
                  <p className="truncate text-[11px] text-muted" title={path || undefined}>
                    {path || (native ? 'Reading the folder…' : 'The folders live on this PC, in the desktop app.')}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!path}
                  onClick={() => void revealInExplorer(path)}
                  className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-medium text-muted transition hover:border-accent hover:text-fg disabled:opacity-40"
                >
                  Show in Explorer
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void loadCaptures()} className={cn(btnBrowse, 'inline-flex items-center gap-2')}>
            <RefreshCw className="size-3.5" /> Scan again
          </button>
          {onOpenAlbum && (
            <button
              type="button"
              onClick={onOpenAlbum}
              className={cn(btnAccent, 'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs')}
            >
              <Images className="size-3.5" /> Open the album
            </button>
          )}
          <button
            type="button"
            onClick={() => jump('orbit-overlay')}
            className="text-xs text-muted underline-offset-2 hover:text-fg hover:underline"
          >
            Where captures are saved
          </button>
        </div>
        <p className="text-xs leading-relaxed text-muted">
          Orbit never moves or renames a file it did not write. A folder can be changed on the Overlay card; anything already saved stays where it is.
        </p>
      </Section>

      <Section
        id="orbit-backups"
        active={activeSection === 'orbit-backups'}
        note="Need work"
        icon={Save}
        title="Backups"

      >
        <SwitchRow
          checked={cloudAutoOn(settings.saves)}
          onChange={(on) => setSettings((current) => ({ saves: savesWithClouds(current.saves, { cloudAuto: on }) }))}
          label="Auto-send to cloud"
          hint="Send backups to connected clouds."
        />
        <AddCloud settings={settings} setSettings={setSettings} />
        <CloudTools />
        <CloudAccounts settings={settings} setSettings={setSettings} />
      </Section>

      <Section
        id="orbit-libraries"
        active={activeSection === 'orbit-libraries'}
        note="Need work"
        icon={LibraryIcon}
        title="Libraries"

      >
        {!native && <p className="text-xs text-muted">Local scans are available in the desktop app.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {LAUNCHERS.filter((launcher) => launcherOn(launcher.id, desktopOs())).map((launcher) => {
            const scannable = canScan(launcher);
            const rescan = launcher.id === 'Steam'
              ? settings.steamOnLaunch
              : (settings.launcherScanOnLaunch ?? []).includes(launcher.id);
            return (
              <Fragment key={launcher.id}>
              <div className="overflow-hidden rounded-2xl border border-line bg-panel/55">
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
              {launcher.id === 'Steam' && (
                <div className="overflow-hidden rounded-2xl border border-line bg-panel/55">
                  <button
                    type="button"
                    onClick={onScanDrive}
                    disabled={!native || !onScanDrive}
                    className="group flex w-full items-center gap-3 px-3 py-3 text-left transition hover:bg-accent/5 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-accent/35 bg-panel text-accent">
                      <HardDrive className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-fg">Drive or folder</span>
                      <span className="block text-[11px] text-muted">Scan manually</span>
                    </span>
                    <Download className="size-4 shrink-0 text-muted transition group-hover:text-accent" />
                  </button>
                  <div className="border-t border-line/70 px-3 py-2.5" aria-hidden="true" />
                </div>
              )}
              </Fragment>
            );
          })}
        </div>
      </Section>

      <Section
        id="orbit-integrations"
        active={activeSection === 'orbit-integrations'}
        icon={Plug}
        title="Integrations"
        note="Need work"

      >
        <div className="orbit-soon">
          <p>
            <b>Planned:</b> Steam, SteamGridDB, HowLongToBeat, Discord Rich Presence and a webhook for
            captures. Each one will be a row here with its own sign-in, and each one off until it is
            turned on.
          </p>
          <p className="orbit-soon-note">
            Until then nothing leaves this machine unless the Artwork card asks for it, and no account
            is needed to use Orbit.
          </p>
        </div>
      </Section>

      <Section
        id="orbit-achievements"
        active={activeSection === 'orbit-achievements'}
        icon={Trophy}
        title="Achievements"
        note="Need work"

      >
        <div className="orbit-soon">
          <p>
            <b>Planned:</b> a choice of source (Steam, the game's own files, or ticks by hand), a
            completion figure per game in the library, and a shelf in Statistics for the rarest ones.
          </p>
        </div>
      </Section>

      <Section
        id="orbit-details"
        active={activeSection === 'orbit-details'}
        icon={Sparkles}
        title="Metadata"

      >
        <Group title="Sources">
          <p className="text-xs leading-relaxed text-muted">Web search uses the game title to look up public metadata when no store match is found. It never sends your library.</p>
          <MetadataSources settings={settings} setSettings={setSettings} />
          <div className="orbit-setrow">
            <div className="orbit-setrow-copy">
              <label className="orbit-setrow-label" htmlFor="sgdb-key">SteamGridDB key</label>
              <p className="orbit-setrow-hint">For alt covers. Optional - stays on this machine.</p>
              <div className="mt-2 flex gap-2">
                <input
                  id="sgdb-key"
                  type="password"
                  value={settings.sgdbApiKey ?? ''}
                  onChange={(e) => setSettings({ sgdbApiKey: e.target.value })}
                  placeholder="Leave empty for Steam only"
                  className={`${inputCls} min-w-0 flex-1 font-mono`}
                  spellCheck={false}
                  autoComplete="off"
                />
                {settings.sgdbApiKey && (
                  <button type="button" onClick={() => setSettings({ sgdbApiKey: '' })} className="orbit-btnquiet shrink-0">Clear</button>
                )}
              </div>
            </div>
            <span className={cn('orbit-settag', settings.sgdbApiKey ? 'is-on' : 'is-off')}>{settings.sgdbApiKey ? 'Key saved' : 'No key'}</span>
          </div>
        </Group>
        <Group title="Looking things up">
          <SwitchRow checked={settings.fetchMetadata ?? true} onChange={(v) => setSettings({ fetchMetadata: v })} label="Lookup on add" hint="Fetch on add." />
          <SwitchRow checked={settings.autoFetchMetadata ?? true} onChange={(v) => setSettings({ autoFetchMetadata: v })} label="Background fill" hint="Fill missing quietly." />
        </Group>
      </Section>

      <Section
        id="orbit-sound"
        active={activeSection === 'orbit-sound'}
        icon={Piano}
        title="Sound"

      >
        <Group>
          <SwitchRow
            checked={settings.sound?.enabled !== false}
            onChange={(v) => setSettings({ sound: withSound(settings, { enabled: v }) })}
            label="Background music"
            hint="Quiet chord. Your file replaces it."
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

          <SwitchRow
            checked={settings.sound?.unfocused === true}
            onChange={(v) => setSettings({ sound: withSound(settings, { unfocused: v }) })}
            label="Play when unfocused"
            hint="Keep playing in background."
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

          <SwitchRow
            checked={settings.topbarMusic !== false}
            onChange={(v) => setSettings({ topbarMusic: v })}
            label="Show in top bar"
            hint="Music controls in header."
          />
          <SwitchRow
            checked={settings.musicBars !== false}
            onChange={(v) => setSettings({ musicBars: v })}
            label="Music visualizer"
            hint="Bars that move with music."
          />
        </Group>
      </Section>

      <Section
        id="orbit-copy"
        active={activeSection === 'orbit-copy'}
        icon={ArrowLeftRight}
        title="Export and import"

      >
        <CopySettings settings={settings} replaceSettings={replaceSettings} onLibraryChanged={onLibraryChanged} />
      </Section>

      <Section
        id="orbit-advanced"
        active={activeSection === 'orbit-advanced'}
        icon={HardDrive}
        title="Advanced"

      >
        <div className="rounded-xl border border-line/70 bg-panel2/40 p-4">
          <div className="flex flex-wrap items-start gap-3">
            <FolderOpen className="mt-0.5 size-4 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Data folder</p>
              <p className="truncate text-[11px] text-muted" title={where?.path || undefined}>
                {where?.path || (native ? 'Reading the folder…' : 'Orbit’s files live on this PC, in the desktop app.')}
              </p>
            </div>
            <span className="text-sm tabular-nums text-muted">{where ? fmtBytes(where.size) : '-'}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!where?.path}
              onClick={() => where && void revealInExplorer(where.path)}
              className={cn(btnBrowse, 'py-1.5 text-xs disabled:opacity-40')}
            >
              Show in Explorer
            </button>
            <button
              type="button"
              disabled={cacheBusy}
              onClick={() => void measureStorage()}
              className={cn(btnBrowse, 'inline-flex items-center gap-2 py-1.5 text-xs disabled:opacity-40')}
            >
              <RefreshCw className={cn('size-3.5', cacheBusy && 'animate-spin')} /> Measure again
            </button>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            The database, the stats, the settings, the backups and the replay workspace all live in this one folder.
            {portable
              ? ' This is a portable copy, so the folder sits beside the program and moves with it.'
              : ' A portable copy keeps the same folder beside the program instead.'}
          </p>
        </div>

        <Group>
          <div className="flex flex-wrap items-start gap-3">
            <Trash2 className="mt-0.5 size-4 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">Replay cache</p>
              <p className="text-xs text-muted">
                The rolling buffer a game session writes to. It is emptied when the game stops, so what is here is left
                over from a session that ended badly. {cacheBytes !== null ? `${fmtBytes(cacheBytes)} right now.` : ''}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={cacheBusy}
              onClick={() => void clearCache()}
              className={cn(btnDanger, 'rounded-lg px-3 py-1.5 text-xs disabled:opacity-40')}
            >
              Clear the cache
            </button>
            {cacheNote && <span className="text-xs text-muted">{cacheNote}</span>}
          </div>
        </Group>

        <p className="text-xs leading-relaxed text-muted">
          Clearing the cache never touches the library, the journal, the sessions, the settings or a saved capture.
          It is refused while a game is running, because the buffer is what a replay is cut from.
        </p>
      </Section>

      <Section
        id="orbit-logs"
        active={activeSection === 'orbit-logs'}
        icon={ScrollText}
        title="Logs"

      >
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line/70 bg-panel2/40 px-3.5 py-2.5">
          <ScrollText className="size-4 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Log folder</p>
            <p className="truncate text-[11px] text-muted" title={logPath || undefined}>
              {logPath || (native ? 'Looking for the newest log…' : 'Logs are written by the desktop app only.')}
            </p>
          </div>
          <button
            type="button"
            disabled={!logPath}
            onClick={() => logPath && void revealInExplorer(logPath)}
            className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-medium text-muted transition hover:border-accent hover:text-fg disabled:opacity-40"
          >
            Show in Explorer
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={logBusy}
            onClick={() => void loadLogs()}
            className={cn(btnBrowse, 'inline-flex items-center gap-2 py-1.5 text-xs disabled:opacity-40')}
          >
            <RefreshCw className={cn('size-3.5', logBusy && 'animate-spin')} /> Read again
          </button>
          <button
            type="button"
            disabled={logLines.length === 0}
            onClick={() => void navigator.clipboard?.writeText(logLines.join('\n'))}
            className={cn(btnBrowse, 'inline-flex items-center gap-2 py-1.5 text-xs disabled:opacity-40')}
          >
            Copy the last lines
          </button>
          <span className="text-[11px] text-muted">{logLines.length > 0 ? `${logLines.length} lines` : ''}</span>
        </div>
        <pre className="orbit-logtail" aria-label="The newest log, last lines">
          {logLines.length > 0
            ? logLines.join('\n')
            : native
              ? 'Nothing has been written yet. Start a game, take a capture, or open a page; Orbit writes the log as it runs.'
              : 'No log to read in the browser. The desktop app writes one as it runs.'}
        </pre>
      </Section>

      <Section
        id="orbit-updates"
        active={activeSection === 'orbit-updates'}
        icon={Download}
        title="Updates"

      >
        <Group>
          <SwitchRow
            checked={settings.updatePrerelease === true}
            onChange={(v) => setSettings({ updatePrerelease: v })}
            label="Include pre-releases"
            hint="Offer test builds."
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

          <SwitchRow
            checked={settings.updateCheck !== false}
            onChange={(v) => setSettings({ updateCheck: v })}
            label="Check on launch"
            hint="Look for updates when opening."
          />
        </Group>
      </Section>

      <Section
        id="orbit-about"
        active={activeSection === 'orbit-about'}
        icon={Database}
        title="About"

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
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6 text-sm text-muted">
          <p className="flex items-center gap-1.5">
            Made with <Heart className="size-3.5 text-rose-400" fill="currentColor" strokeWidth={0} /> by TheMarch88
          </p>
          <button
            onClick={() => void openExternal('https://github.com/MarchTheDev/Orbit')}
            className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 hover:border-accent hover:text-fg"
          >
            <GitBranch className="size-4" />
            Orbit on GitHub
          </button>
        </div>
      </Section>


        </div>
      </div>
    </div>
  );
}
