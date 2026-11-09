import { useState } from 'react';
import { ArrowLeft, Check, CopyPlus, Save, Trash2 } from 'lucide-react';
import type { Settings, Theme } from '../types';
import { THEMES, applyTheme } from '../data/themes';
import { cn } from '../utils/cn';

const HEX = /^#[0-9a-fA-F]{6}$/;
const DEFAULT_BASE = 'eclipse';

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

/** Change one hue while keeping the base theme's contrast and overall shape. */
function paletteFor(base: Theme, color: string, current: Pick<Theme, 'id' | 'name'>): Theme {
  const lightBase = luminance(base.bg) > 0.5;
  const surfaceTint = lightBase ? 0.075 : 0.15;
  return {
    ...base,
    ...current,
    baseThemeId: base.id,
    themeColor: color,
    bg: mix(base.bg, color, surfaceTint * 0.65),
    panel: mix(base.panel, color, surfaceTint),
    panel2: mix(base.panel2, color, surfaceTint * 1.25),
    border: mix(base.border, color, surfaceTint * 1.45),
    text: base.text,
    muted: mix(base.muted, color, surfaceTint * 0.32),
    accent: color,
    accent2: mix(color, '#ffffff', lightBase ? 0.1 : 0.18),
    onAccent: luminance(color) > 0.48 ? '#17151b' : '#ffffff',
  };
}

function nearestBase(theme: Theme): Theme {
  if (theme.baseThemeId) {
    const exact = THEMES.find((item) => item.id === theme.baseThemeId);
    if (exact) return exact;
  }
  const rgb = (hex: string) => [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));
  const distance = (left: string, right: string) => rgb(left).reduce((total, channel, index) => total + (channel - rgb(right)[index]) ** 2, 0);
  return THEMES.reduce((best, candidate) =>
    distance(theme.bg, candidate.bg) + distance(theme.panel, candidate.panel) <
    distance(theme.bg, best.bg) + distance(theme.panel, best.panel) ? candidate : best,
  THEMES.find((item) => item.id === DEFAULT_BASE) ?? THEMES[0]);
}

function newTheme(): Theme {
  const base = THEMES.find((item) => item.id === DEFAULT_BASE) ?? THEMES[0];
  return paletteFor(base, base.accent, { id: `custom-${Date.now()}`, name: 'New theme' });
}

function ThemeColor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const safe = HEX.test(value) ? value : '#000000';
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border border-line bg-panel2/50 p-3 transition hover:border-accent/50 focus-within:border-accent">
      <label className="relative grid size-10 shrink-0 cursor-pointer place-items-center overflow-hidden rounded-lg border border-line shadow-inner" title="Choose the theme colour">
        <span className="absolute inset-0" style={{ background: safe }} />
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/15 to-transparent" />
        <input
          type="color"
          value={safe}
          onChange={(event) => onChange(event.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label="Choose theme colour"
        />
      </label>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-fg">Theme colour</span>
        <span className="mt-0.5 block truncate text-[10px] text-muted">Tint the surfaces and accents together</span>
      </span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-[5.5rem] rounded-lg border border-line bg-panel px-2.5 py-2 font-mono text-xs uppercase tracking-wide text-fg outline-none transition focus:border-accent"
        aria-label="Theme colour hex value"
        spellCheck={false}
      />
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
  const initial = settings.customThemes?.[0] ?? newTheme();
  const initialBase = nearestBase(initial);
  const [draft, setDraft] = useState<Theme>(initial);
  const [baseId, setBaseId] = useState(initialBase.id);
  const [themeColor, setThemeColor] = useState(initial.themeColor ?? initial.accent);
  const [activeId, setActiveId] = useState<string | null>(settings.customThemes?.[0]?.id ?? null);
  const [isNew, setIsNew] = useState((settings.customThemes?.length ?? 0) === 0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const custom = settings.customThemes ?? [];
  const valid = Boolean(draft.name.trim()) && HEX.test(themeColor);
  const selectedBase = THEMES.find((theme) => theme.id === baseId) ?? THEMES[0];

  const changeBase = (id: string) => {
    const base = THEMES.find((theme) => theme.id === id) ?? THEMES[0];
    setBaseId(base.id);
    setDraft((current) => paletteFor(base, HEX.test(themeColor) ? themeColor : current.accent, current));
  };
  const changeColor = (color: string) => {
    setThemeColor(color);
    if (!HEX.test(color)) return;
    setDraft((current) => paletteFor(selectedBase, color, current));
  };
  const updateName = (name: string) => setDraft((current) => ({ ...current, name }));

  const startNew = () => {
    const next = newTheme();
    setDraft(next);
    setBaseId(DEFAULT_BASE);
    setThemeColor(next.themeColor ?? next.accent);
    setActiveId(null);
    setIsNew(true);
    setNotice('');
  };

  const edit = (theme: Theme) => {
    const base = nearestBase(theme);
    setDraft({ ...theme });
    setBaseId(base.id);
    setThemeColor(theme.themeColor ?? theme.accent);
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
    const savedTheme = { ...draft, id, name: cleanName, baseThemeId: baseId, themeColor };
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
            <p className="mt-1 max-w-2xl text-sm text-muted">Pick a base theme, then change one colour. Orbit tints the surfaces and accents for you.</p>
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
                <input value={draft.name} onChange={(event) => updateName(event.target.value)} className="w-full rounded-xl border border-line bg-panel2 px-3 py-2 text-sm outline-none focus:border-accent" placeholder="Eclipse Navy" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-muted">Base theme</span>
                <select value={baseId} onChange={(event) => changeBase(event.target.value)} className="w-full rounded-xl border border-line bg-panel2 px-3 py-2 text-sm text-fg outline-none focus:border-accent">
                  {THEMES.map((theme) => <option key={theme.id} value={theme.id}>{theme.name}</option>)}
                </select>
              </label>
            </div>

            <ThemeColor value={themeColor} onChange={changeColor} />

            <div className="space-y-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted">Live app preview</p>
                <p className="mt-0.5 text-[11px] text-muted">One colour changes the highlights and softly tints the background and surfaces.</p>
              </div>
              <div className="overflow-hidden rounded-2xl border shadow-xl" style={{ borderColor: draft.border, background: draft.bg, color: draft.text }}>
                <div className="flex min-h-64">
                  <aside className="hidden w-36 shrink-0 flex-col gap-1 border-r p-3 sm:flex" style={{ borderColor: draft.border, background: draft.panel }}>
                    <div className="mb-3 flex items-center gap-2 px-2 py-1">
                      <span className="grid size-6 place-items-center rounded-md text-[10px] font-black" style={{ background: draft.accent, color: draft.onAccent }}>O</span>
                      <span className="text-xs font-bold">Orbit</span>
                    </div>
                    {['Library', 'Backlog', 'Journal'].map((item, index) => (
                      <div key={item} className="rounded-lg px-2.5 py-2 text-[11px]" style={{ background: index === 0 ? draft.panel2 : 'transparent', color: index === 0 ? draft.text : draft.muted }}>{item}</div>
                    ))}
                  </aside>
                  <div className="min-w-0 flex-1" style={{ background: draft.bg }}>
                    <div className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: draft.border, background: draft.panel }}>
                      <div><p className="text-xs font-semibold">{draft.name || 'Your Library'}</p><p className="text-[10px]" style={{ color: draft.muted }}>Recently played · 12 games</p></div>
                      <span className="rounded-lg border px-2.5 py-1.5 text-[10px]" style={{ borderColor: draft.border, background: draft.panel2, color: draft.muted }}>Search games</span>
                    </div>
                    <div className="space-y-3 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] font-semibold">Continue playing</p>
                        <span className="rounded-md px-2 py-1 text-[10px] font-semibold" style={{ background: draft.accent, color: draft.onAccent }}>View all</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {['Hollow Knight', 'Hades II', 'Celeste'].map((game, index) => (
                          <div key={game} className="overflow-hidden rounded-xl border" style={{ borderColor: draft.border, background: draft.panel }}>
                            <div className="h-16" style={{ background: index === 1 ? `linear-gradient(135deg, ${draft.accent2}, ${draft.accent})` : index === 2 ? `linear-gradient(135deg, ${draft.panel2}, ${draft.accent2})` : `linear-gradient(135deg, ${draft.accent}, ${draft.panel2})` }} />
                            <div className="p-2"><p className="truncate text-[10px] font-semibold">{game}</p><p className="mt-0.5 text-[9px]" style={{ color: draft.muted }}>Recently played</p></div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              {notice ? <p role="status" className="text-sm text-muted">{notice}</p> : <span />}
              <div className="flex gap-2">
                <button type="button" disabled={!valid || busy} onClick={() => void persist(false)} className="inline-flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm text-muted hover:border-accent hover:text-fg disabled:opacity-40"><Save className="size-4" /> Save</button>
                <button type="button" disabled={!valid || busy} onClick={() => void persist(true)} className="inline-flex items-center gap-2 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-[var(--c-on-accent)] hover:brightness-110 disabled:opacity-40"><Check className="size-4" /> Save and apply</button>
              </div>
            </div>
            {!valid && <p className="text-xs text-rose-300">Choose a name and valid six-digit hex colour before saving.</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
