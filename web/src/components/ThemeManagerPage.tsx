import { useState } from 'react';
import { ArrowLeft, Check, CopyPlus, Save, Trash2 } from 'lucide-react';
import type { Settings, Theme } from '../types';
import { THEMES, applyTheme } from '../data/themes';
import { cn } from '../utils/cn';

const HEX = /^#[0-9a-fA-F]{6}$/;
type ThemeMode = NonNullable<Theme['themeMode']>;
const MODES: { id: ThemeMode; label: string; help: string }[] = [
  { id: 'graded', label: 'Graded', help: 'The main colour carries through the whole palette.' },
  { id: 'dark', label: 'Dark', help: 'Dark neutral surfaces shaded with the second colour.' },
  { id: 'light-graded', label: 'Light graded', help: 'A light palette washed with the main colour.' },
  { id: 'light', label: 'Light', help: 'Clean light surfaces with coloured accents.' },
];

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

/** Generate every supporting colour from two choices and a palette style. */
function paletteFromColors(
  primary: string,
  secondary: string,
  mode: ThemeMode,
  current: Pick<Theme, 'id' | 'name'>,
): Theme {
  let bg: string;
  let panel: string;
  let panel2: string;
  let border: string;
  let text: string;
  let muted: string;

  switch (mode) {
    case 'graded':
      bg = mix('#05070a', primary, 0.40);
      panel = mix('#0b0e13', primary, 0.52);
      panel2 = mix('#141a22', primary, 0.65);
      border = mix('#252d39', primary, 0.68);
      text = '#f5f7fb';
      muted = mix('#aab0bc', primary, 0.14);
      break;
    case 'light-graded':
      bg = mix(primary, '#ffffff', 0.90);
      panel = mix(primary, '#ffffff', 0.95);
      panel2 = mix(primary, '#ffffff', 0.84);
      border = mix(primary, '#ffffff', 0.70);
      text = '#171923';
      muted = mix('#5f6470', primary, 0.14);
      break;
    case 'light':
      // Lunar-like clean surfaces, with enough of the second colour in the
      // page, raised cards and dividers to make the palette feel intentional.
      bg = mix('#f0f2f6', secondary, 0.09);
      panel = mix('#ffffff', secondary, 0.065);
      panel2 = mix('#e9ebf0', secondary, 0.15);
      border = mix('#d2d6df', secondary, 0.24);
      text = '#171923';
      muted = mix('#5f6470', secondary, 0.18);
      break;
    default:
      // Eclipse-like neutral darkness, visibly tinted by the second colour
      // across all the surfaces rather than only in the accent controls.
      bg = mix('#090a0d', secondary, 0.16);
      panel = mix('#13151a', secondary, 0.24);
      panel2 = mix('#1d2028', secondary, 0.34);
      border = mix('#30343e', secondary, 0.42);
      text = '#f4f5f7';
      muted = mix('#a1a4ac', secondary, 0.2);
      break;
  }

  return {
    ...current,
    bg,
    panel,
    panel2,
    border,
    text,
    muted,
    accent: primary,
    accent2: secondary,
    onAccent: luminance(primary) > 0.48 ? '#17151b' : '#ffffff',
    themeMode: mode,
    primaryColor: primary,
    secondaryColor: secondary,
  };
}

function newTheme(): Theme {
  return paletteFromColors('#10b981', '#34d399', 'dark', {
    id: `custom-${Date.now()}`,
    name: 'New theme',
  });
}

function ThemeColor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const safe = HEX.test(value) ? value : '#000000';
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border border-line bg-panel2/50 p-3 transition hover:border-accent/50 focus-within:border-accent">
      <label className="relative grid size-10 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-lg border border-line shadow-inner" title={`Choose ${label.toLowerCase()}`}>
        <span className="absolute inset-0" style={{ background: safe }} />
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/15 to-transparent" />
        <input
          type="color"
          value={safe}
          onChange={(event) => onChange(event.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label={`Choose ${label.toLowerCase()}`}
        />
      </label>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-fg">{label}</span>
        <span className="mt-0.5 block truncate text-[10px] text-muted">Choose a colour; Orbit builds the rest</span>
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-[5.5rem] rounded-lg border border-line bg-panel px-2.5 py-2 font-mono text-xs uppercase tracking-wide text-fg outline-none transition focus:border-accent"
        aria-label={`${label} hex value`}
        spellCheck={false}
      />
    </div>
  );
}

function PalettePreview({ theme }: { theme: Theme }) {
  const swatches = [
    { label: 'Background', color: theme.bg, text: theme.text },
    { label: 'Surface', color: theme.panel, text: theme.text },
    { label: 'Raised', color: theme.panel2, text: theme.text },
    { label: 'Main colour', color: theme.accent, text: theme.onAccent ?? '#fff' },
    { label: 'Second colour', color: theme.accent2, text: luminance(theme.accent2) > 0.48 ? '#17151b' : '#fff' },
    { label: 'Border', color: theme.border, text: theme.text },
  ];
  return (
    <section className="space-y-3 rounded-2xl border border-line bg-panel/45 p-4" aria-label="Generated palette preview">
      <div>
        <h2 className="text-sm font-semibold text-fg">Generated palette</h2>
        <p className="mt-0.5 text-xs text-muted">A colour swatch preview, not a mock-up of Orbit screens.</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {swatches.map((swatch) => (
          <div
            key={swatch.label}
            className="flex min-h-16 items-end justify-between gap-2 rounded-xl border p-2.5"
            style={{ backgroundColor: swatch.color, borderColor: theme.border, color: swatch.text }}
          >
            <span className="text-xs font-medium">{swatch.label}</span>
            <span className="font-mono text-[10px] uppercase opacity-75">{swatch.color}</span>
          </div>
        ))}
      </div>
    </section>
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
  const initial = settings.customThemes?.[0];
  const initialPrimary = initial?.primaryColor ?? initial?.themeColor ?? initial?.accent ?? '#10b981';
  const initialSecondary = initial?.secondaryColor ?? initial?.accent2 ?? '#34d399';
  const initialMode = initial?.themeMode ?? 'dark';
  const [draft, setDraft] = useState<Theme>(() => initial
    ? paletteFromColors(initialPrimary, initialSecondary, initialMode, initial)
    : newTheme());
  const [primary, setPrimary] = useState(initialPrimary);
  const [secondary, setSecondary] = useState(initialSecondary);
  const [mode, setMode] = useState<ThemeMode>(initialMode);
  const [activeId, setActiveId] = useState<string | null>(settings.customThemes?.[0]?.id ?? null);
  const [isNew, setIsNew] = useState((settings.customThemes?.length ?? 0) === 0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const custom = settings.customThemes ?? [];
  const valid = Boolean(draft.name.trim()) && HEX.test(primary) && HEX.test(secondary);
  const help = MODES.find((item) => item.id === mode)?.help ?? '';

  const rebuild = (nextPrimary: string, nextSecondary: string, nextMode: ThemeMode) => {
    if (!HEX.test(nextPrimary) || !HEX.test(nextSecondary)) return;
    setDraft((current) => paletteFromColors(nextPrimary, nextSecondary, nextMode, current));
  };
  const changePrimary = (color: string) => {
    setPrimary(color);
    rebuild(color, secondary, mode);
  };
  const changeSecondary = (color: string) => {
    setSecondary(color);
    rebuild(primary, color, mode);
  };
  const changeMode = (nextMode: ThemeMode) => {
    setMode(nextMode);
    rebuild(primary, secondary, nextMode);
  };
  const updateName = (name: string) => setDraft((current) => ({ ...current, name }));

  const startNew = () => {
    const next = newTheme();
    setDraft(next);
    setPrimary(next.primaryColor ?? next.accent);
    setSecondary(next.secondaryColor ?? next.accent2);
    setMode(next.themeMode ?? 'dark');
    setActiveId(null);
    setIsNew(true);
    setNotice('');
  };

  const edit = (theme: Theme) => {
    const nextPrimary = theme.primaryColor ?? theme.themeColor ?? theme.accent;
    const nextSecondary = theme.secondaryColor ?? theme.accent2;
    const nextMode = theme.themeMode ?? 'dark';
    setDraft(paletteFromColors(nextPrimary, nextSecondary, nextMode, theme));
    setPrimary(nextPrimary);
    setSecondary(nextSecondary);
    setMode(nextMode);
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
    const savedTheme = {
      ...draft,
      id,
      name: cleanName,
      themeMode: mode,
      primaryColor: primary,
      secondaryColor: secondary,
    };
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
            <p className="mt-1 max-w-2xl text-sm text-muted">Choose two colours and a style. Orbit generates the rest of the palette.</p>
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
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">Theme name</span>
                <input value={draft.name} onChange={(event) => updateName(event.target.value)} className="w-full rounded-xl border border-line bg-panel2 px-3 py-2 text-sm outline-none focus:border-accent" placeholder="Deep Sea" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">Style</span>
                <select value={mode} onChange={(event) => changeMode(event.target.value as ThemeMode)} className="w-full rounded-xl border border-line bg-panel2 px-3 py-2 text-sm text-fg outline-none focus:border-accent">
                  {MODES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select>
                <span className="mt-1 block text-[11px] text-muted">{help}</span>
              </label>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <ThemeColor label="Main colour" value={primary} onChange={changePrimary} />
              <ThemeColor label="Second colour" value={secondary} onChange={changeSecondary} />
            </div>

            <PalettePreview theme={draft} />

            <div className="flex flex-wrap items-center justify-between gap-3">
              {notice ? <p role="status" className="text-sm text-muted">{notice}</p> : <span />}
              <div className="flex gap-2">
                <button type="button" disabled={!valid || busy} onClick={() => void persist(false)} className="inline-flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm text-muted hover:border-accent hover:text-fg disabled:opacity-40"><Save className="size-4" /> Save</button>
                <button type="button" disabled={!valid || busy} onClick={() => void persist(true)} className="inline-flex items-center gap-2 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-[var(--c-on-accent)] hover:brightness-110 disabled:opacity-40"><Check className="size-4" /> Save and apply</button>
              </div>
            </div>
            {!valid && <p className="text-xs text-rose-300">Choose a name and two valid six-digit hex colours before saving.</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
