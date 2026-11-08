import { useMemo, useState } from 'react';
import { ArrowLeft, Check, ChevronDown, CopyPlus, Save, Trash2, X } from 'lucide-react';
import type { Settings, Theme } from '../types';
import { THEMES, applyTheme } from '../data/themes';
import { cn } from '../utils/cn';

// Five choices drive the whole palette, including the page background separately
// from the surface. Orbit derives quieter surfaces, borders and secondary text.
const COLOR_FIELDS: { key: 'bg' | 'panel' | 'text' | 'accent' | 'accent2'; label: string }[] = [
  { key: 'bg', label: 'Background' },
  { key: 'panel', label: 'Surface' },
  { key: 'text', label: 'Text' },
  { key: 'accent', label: 'Main accent' },
  { key: 'accent2', label: 'Second accent' },
];
const HEX = /^#[0-9a-fA-F]{6}$/;

function slug(text: string): string {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'custom';
}

function mix(first: string, second: string, amount: number): string {
  const channel = (value: string, offset: number) => Number.parseInt(value.slice(offset, offset + 2), 16);
  const result = [1, 3, 5].map((offset) => Math.round(channel(first, offset) * (1 - amount) + channel(second, offset) * amount));
  return `#${result.map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}

function derivePalette(theme: Theme): Theme {
  if (![theme.bg, theme.panel, theme.text, theme.accent, theme.accent2].every((value) => HEX.test(value))) return theme;
  const isLight = luminance(theme.panel) > 0.48;
  const edge = isLight ? '#000000' : '#ffffff';
  return {
    ...theme,
    panel2: mix(theme.panel, edge, isLight ? 0.055 : 0.12),
    border: mix(theme.panel, edge, isLight ? 0.17 : 0.2),
    muted: mix(theme.text, theme.panel, 0.46),
    onAccent: luminance(theme.accent) > 0.48 ? '#17151b' : '#ffffff',
  };
}

function blankTheme(): Theme {
  return derivePalette({
    id: `custom-${Date.now()}`,
    name: 'New theme',
    bg: '#101018',
    panel: '#191923',
    panel2: '#242432',
    border: '#38384a',
    text: '#f4f4ff',
    muted: '#aaaabd',
    accent: '#8b5cf6',
    accent2: '#ec4899',
    onAccent: '#ffffff',
  });
}

const QUICK_COLORS = [
  '#f43f5e', '#fb7185', '#f97316', '#f59e0b', '#facc15', '#84cc16',
  '#22c55e', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f8fafc', '#1e293b',
];

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }
  return { h: (h + 360) % 360, s: s * 100, l: l * 100 };
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const h = ((hue % 360) + 360) % 360;
  const s = Math.max(0, Math.min(100, saturation)) / 100;
  const l = Math.max(0, Math.min(100, lightness)) / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - chroma / 2;
  const [r, g, b] = h < 60 ? [chroma, x, 0]
    : h < 120 ? [x, chroma, 0]
      : h < 180 ? [0, chroma, x]
        : h < 240 ? [0, x, chroma]
          : h < 300 ? [x, 0, chroma]
            : [chroma, 0, x];
  return `#${[r, g, b].map((value) => Math.round((value + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

function ThemeColor({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const safe = HEX.test(value) ? value : '#000000';
  const hsl = useMemo(() => hexToHsl(safe), [safe]);
  const chooseHsl = (h: number, s: number, l: number) => onChange(hslToHex(h, s, l));
  return (
    <div className="relative min-w-0 rounded-2xl border border-line bg-panel2/50 p-3 transition hover:border-accent/40">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-label={`${open ? 'Close' : 'Open'} ${label.toLowerCase()} colour picker`}
          aria-expanded={open}
          className="flex h-11 min-w-0 flex-1 items-center gap-3 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/15 shadow-inner" style={{ background: safe }}>
            <span className="size-5 rounded-full border border-white/45 shadow-sm" style={{ background: `linear-gradient(135deg, ${safe}, transparent)` }} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold text-fg">{label}</span>
            <span className="mt-0.5 block text-[10px] text-muted">Pick a shade or enter a hex</span>
          </span>
          <ChevronDown className={`size-4 shrink-0 text-muted transition ${open ? 'rotate-180 text-accent' : ''}`} />
        </button>
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-[5.5rem] rounded-xl border border-line bg-panel px-2.5 py-2 font-mono text-xs uppercase tracking-wide text-fg outline-none transition focus:border-accent"
          aria-label={`${label} hex value`}
          spellCheck={false}
        />
      </div>
      {open && (
        <div className="absolute left-1/2 top-full z-30 mt-2 w-[min(19rem,calc(100vw-2.5rem))] -translate-x-1/2 rounded-2xl border border-line bg-panel p-4 text-fg shadow-2xl shadow-black/40 sm:left-0 sm:translate-x-0">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold">Choose {label.toLowerCase()}</p>
              <p className="mt-0.5 text-[10px] text-muted">Fine-tune the shade or pick a quick colour.</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close colour picker" className="grid size-7 shrink-0 place-items-center rounded-lg border border-line text-muted transition hover:border-accent hover:text-fg">
              <X className="size-3.5" />
            </button>
          </div>
          <div className="mb-3 flex h-12 items-center justify-between rounded-xl border border-line px-3" style={{ background: safe }}>
            <span className="rounded-md bg-black/35 px-2 py-1 font-mono text-xs uppercase text-white">{safe}</span>
          </div>
          <div className="mb-4 grid grid-cols-9 gap-1.5" aria-label="Quick colours">
            {QUICK_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => onChange(color)}
                aria-label={`Choose ${color}`}
                aria-pressed={color.toLowerCase() === safe.toLowerCase()}
                className={`size-6 rounded-lg border transition hover:scale-110 ${color.toLowerCase() === safe.toLowerCase() ? 'border-white ring-2 ring-accent' : 'border-white/15'}`}
                style={{ background: color }}
              />
            ))}
          </div>
          <div className="space-y-3">
            <label className="block text-[10px] font-medium text-muted">
              <span className="mb-1 flex justify-between"><span>Hue</span><span>{Math.round(hsl.h)}°</span></span>
              <input type="range" min="0" max="360" value={Math.round(hsl.h)} onChange={(event) => chooseHsl(Number(event.target.value), hsl.s, hsl.l)} className="h-2 w-full cursor-pointer appearance-none rounded-full accent-accent" style={{ background: 'linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)' }} />
            </label>
            <label className="block text-[10px] font-medium text-muted">
              <span className="mb-1 flex justify-between"><span>Saturation</span><span>{Math.round(hsl.s)}%</span></span>
              <input type="range" min="0" max="100" value={Math.round(hsl.s)} onChange={(event) => chooseHsl(hsl.h, Number(event.target.value), hsl.l)} className="h-2 w-full cursor-pointer appearance-none rounded-full accent-accent" style={{ background: `linear-gradient(90deg,${hslToHex(hsl.h, 0, hsl.l)},${hslToHex(hsl.h, 100, hsl.l)})` }} />
            </label>
            <label className="block text-[10px] font-medium text-muted">
              <span className="mb-1 flex justify-between"><span>Lightness</span><span>{Math.round(hsl.l)}%</span></span>
              <input type="range" min="4" max="96" value={Math.max(4, Math.min(96, Math.round(hsl.l)))} onChange={(event) => chooseHsl(hsl.h, hsl.s, Number(event.target.value))} className="h-2 w-full cursor-pointer appearance-none rounded-full accent-accent" style={{ background: `linear-gradient(90deg,${hslToHex(hsl.h, hsl.s, 4)},${hslToHex(hsl.h, hsl.s, 50)},${hslToHex(hsl.h, hsl.s, 96)})` }} />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

export function ThemeManagerPage({
  settings,
  setSettings,
  onBack,
}: {
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
  onBack: () => void;
}) {
  const [draft, setDraft] = useState<Theme>(() => settings.customThemes?.[0] ?? blankTheme());
  const [activeId, setActiveId] = useState<string | null>(() => settings.customThemes?.[0]?.id ?? null);
  const [isNew, setIsNew] = useState(() => (settings.customThemes?.length ?? 0) === 0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const custom = settings.customThemes ?? [];
  const valid = useMemo(() => Boolean(draft.name.trim()) && COLOR_FIELDS.every(({ key }) => HEX.test(String(draft[key] ?? ''))), [draft]);

  const updateColor = (key: 'bg' | 'panel' | 'text' | 'accent' | 'accent2', value: string) => {
    setDraft((current) => {
      const next = { ...current, [key]: value };
      return HEX.test(value) ? derivePalette(next) : next;
    });
  };
  const updateName = (name: string) => setDraft((current) => ({ ...current, name }));

  const startNew = () => {
    const next = blankTheme();
    setDraft(next);
    setActiveId(null);
    setIsNew(true);
    setNotice('');
  };

  const edit = (theme: Theme) => {
    setDraft({ ...theme });
    setActiveId(theme.id);
    setIsNew(false);
    setNotice('');
  };

  const persist = async (apply: boolean) => {
    if (!valid) return;
    const cleanName = draft.name.trim();
    const id = isNew ? `custom-${slug(cleanName)}-${Date.now().toString(36)}` : activeId ?? draft.id;
    if (THEMES.some((theme) => theme.id === id)) {
      setNotice('That id belongs to a built-in theme. Choose another name.');
      return;
    }
    const savedTheme = derivePalette({ ...draft, id, name: cleanName });
    const next: Settings = {
      ...settings,
      customThemes: isNew
        ? [...custom, savedTheme]
        : custom.map((theme) => theme.id === id ? savedTheme : theme),
      ...(apply ? { theme: id } : {}),
    };
    setBusy(true);
    try {
      setSettings(next);
      if (apply) applyTheme(next.theme, next.customThemes ?? []);
      setDraft(savedTheme);
      setActiveId(id);
      setIsNew(false);
      setNotice(apply ? `${cleanName} saved and applied.` : `${cleanName} saved.`);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (theme: Theme) => {
    if (!confirm(`Delete the custom theme “${theme.name}”?`)) return;
    const next: Settings = {
      ...settings,
      customThemes: custom.filter((item) => item.id !== theme.id),
      ...(settings.theme === theme.id ? { theme: 'nebula' } : {}),
    };
    setBusy(true);
    try {
      setSettings(next);
      applyTheme(next.theme, next.customThemes ?? []);
      if (activeId === theme.id) startNew();
      setNotice(`${theme.name} deleted.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 px-6 pb-10 pt-5">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <button type="button" onClick={onBack} className="mb-3 inline-flex items-center gap-2 rounded-lg text-sm text-muted hover:text-fg"><ArrowLeft className="size-4" /> Back to appearance</button>
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-accent">Orbit appearance</p>
            <h1 className="mt-1 text-2xl font-bold">Custom themes</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted">Choose a background, surface, text and two accents. Orbit builds the supporting colours for you.</p>
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
          <aside className="space-y-3">
            <button type="button" onClick={startNew} className="flex w-full items-center justify-center gap-2 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2.5 text-sm font-semibold text-fg hover:bg-accent/20"><CopyPlus className="size-4" /> Create a theme</button>
            <div className="space-y-1 rounded-2xl border border-line bg-panel/60 p-2">
              {custom.map((theme) => (
                <div key={theme.id} className={cn('flex items-center gap-2 rounded-xl border px-2 py-2', activeId === theme.id ? 'border-accent/60 bg-accent/10' : 'border-transparent hover:bg-panel2/60')}>
                  <button type="button" onClick={() => edit(theme)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <span className="size-7 shrink-0 rounded-lg border border-line" style={{ background: `linear-gradient(135deg, ${theme.bg} 25%, ${theme.accent} 100%)` }} />
                    <span className="truncate text-sm">{theme.name}</span>
                  </button>
                  <button type="button" onClick={() => void remove(theme)} aria-label={`Delete ${theme.name}`} className="grid size-7 shrink-0 place-items-center rounded-lg text-muted hover:bg-rose-500/10 hover:text-rose-300"><Trash2 className="size-3.5" /></button>
                </div>
              ))}
              {custom.length === 0 && <p className="px-2 py-4 text-xs leading-relaxed text-muted">No custom themes yet. Create one to begin.</p>}
            </div>
          </aside>

          <section className="space-y-4 rounded-2xl border border-line bg-panel/60 p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="min-w-[14rem] flex-1">
                <span className="mb-1 block text-xs font-medium text-muted">Theme name</span>
                <input value={draft.name} onChange={(event) => updateName(event.target.value)} className="w-full rounded-xl border border-line bg-panel2 px-3 py-2 text-sm outline-none focus:border-accent" placeholder="Aurora" />
              </label>
              <div className="flex gap-2">
                <button type="button" disabled={!valid || busy} onClick={() => void persist(false)} className="inline-flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm text-muted hover:border-accent hover:text-fg disabled:opacity-40"><Save className="size-4" /> Save</button>
                <button type="button" disabled={!valid || busy} onClick={() => void persist(true)} className="inline-flex items-center gap-2 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-[var(--c-on-accent)] hover:brightness-110 disabled:opacity-40"><Check className="size-4" /> Save and apply</button>
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              {COLOR_FIELDS.map(({ key, label }) => (
                <ThemeColor key={key} label={label} value={String(draft[key] ?? '#ffffff')} onChange={(value) => updateColor(key, value)} />
              ))}
            </div>

            <div className="overflow-hidden rounded-2xl border border-line" style={{ background: draft.bg, color: draft.text }}>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4" style={{ borderColor: draft.border, background: draft.panel }}>
                <div><p className="text-sm font-semibold">{draft.name || 'Theme preview'}</p><p className="text-xs" style={{ color: draft.muted }}>Background, border, muted text and contrast are matched automatically.</p></div>
                <button className="rounded-lg px-3 py-1.5 text-xs font-semibold" style={{ background: draft.accent, color: draft.onAccent }}>Accent action</button>
              </div>
              <div className="grid gap-2 p-4 sm:grid-cols-2" style={{ background: draft.panel2 }}>
                <div className="rounded-xl border p-3 text-sm" style={{ borderColor: draft.border, background: draft.panel }}>Panel <span className="ml-2 text-xs" style={{ color: draft.muted }}>Muted text</span></div>
                <div className="rounded-xl border p-3 text-sm" style={{ borderColor: draft.accent2, background: draft.panel }}>Second accent</div>
              </div>
            </div>
            {notice && <p role="status" className="text-sm text-muted">{notice}</p>}
            {!valid && <p className="text-xs text-rose-300">Choose a name and valid six-digit hex colours before saving.</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
