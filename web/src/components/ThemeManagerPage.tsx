import { useMemo, useState } from 'react';
import { ArrowLeft, Check, CopyPlus, Save, Trash2 } from 'lucide-react';
import type { Settings, Theme } from '../types';
import { THEMES, applyTheme } from '../data/themes';
import { cn } from '../utils/cn';

// Four choices drive the whole palette. Orbit derives the quieter surfaces,
// borders and secondary text so a theme stays coherent without nine knobs.
const COLOR_FIELDS: { key: 'panel' | 'text' | 'accent' | 'accent2'; label: string }[] = [
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
  if (![theme.panel, theme.text, theme.accent, theme.accent2].every((value) => HEX.test(value))) return theme;
  const isLight = luminance(theme.panel) > 0.48;
  const edge = isLight ? '#000000' : '#ffffff';
  return {
    ...theme,
    bg: mix(theme.panel, edge, isLight ? 0.08 : 0.42),
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

function ThemeColor({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const safe = HEX.test(value) ? value : '#000000';
  return (
    <label className="flex min-w-0 items-center gap-3 rounded-2xl border border-line bg-panel2/50 p-3 transition hover:border-accent/40">
      <span className="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/15 shadow-inner">
        <span className="absolute inset-0" style={{ background: safe }} />
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/15 to-transparent" />
        <input
          type="color"
          value={safe}
          onChange={(event) => onChange(event.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label={`Choose ${label.toLowerCase()} color`}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-fg">{label}</span>
        <span className="mt-0.5 block text-[10px] text-muted">Click the swatch or edit the hex</span>
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-[5.5rem] rounded-xl border border-line bg-panel px-2.5 py-2 font-mono text-xs uppercase tracking-wide text-fg outline-none transition focus:border-accent"
        aria-label={`${label} hex value`}
        spellCheck={false}
      />
    </label>
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

  const updateColor = (key: 'panel' | 'text' | 'accent' | 'accent2', value: string) => {
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
            <p className="mt-1 max-w-2xl text-sm text-muted">Choose a surface, text and two accents. Orbit builds the matching backgrounds and supporting colours for you.</p>
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
