import { useMemo, useState } from 'react';
import { ArrowLeft, Check, CopyPlus, Save, Trash2 } from 'lucide-react';
import type { Settings, Theme } from '../types';
import { THEMES, applyTheme } from '../data/themes';
import { cn } from '../utils/cn';

const COLOR_FIELDS: { key: keyof Theme; label: string }[] = [
  { key: 'bg', label: 'Background' },
  { key: 'panel', label: 'Panel' },
  { key: 'panel2', label: 'Raised panel' },
  { key: 'border', label: 'Border' },
  { key: 'text', label: 'Text' },
  { key: 'muted', label: 'Muted text' },
  { key: 'accent', label: 'Accent' },
  { key: 'accent2', label: 'Second accent' },
  { key: 'onAccent', label: 'Text on accent' },
];
const HEX = /^#[0-9a-fA-F]{6}$/;

function slug(text: string): string {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'custom';
}

function blankTheme(): Theme {
  return {
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
  };
}

function ThemeColor({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex items-center gap-3 rounded-xl border border-line bg-panel2/40 p-2.5">
      <input type="color" value={HEX.test(value) ? value : '#000000'} onChange={(event) => onChange(event.target.value)} className="size-9 cursor-pointer rounded-lg border-0 bg-transparent p-0" aria-label={`${label} color`} />
      <span className="min-w-0 flex-1 text-sm">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} className="w-24 rounded-lg border border-line bg-panel px-2 py-1.5 font-mono text-xs uppercase outline-none focus:border-accent" aria-label={`${label} hex value`} />
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

  const update = <K extends keyof Theme>(key: K, value: Theme[K]) => setDraft((current) => ({ ...current, [key]: value }));

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
    if (!settings || !valid) return;
    const cleanName = draft.name.trim();
    const id = isNew ? `custom-${slug(cleanName)}-${Date.now().toString(36)}` : activeId ?? draft.id;
    if (THEMES.some((theme) => theme.id === id)) {
      setNotice('That id belongs to a built-in theme. Choose another name.');
      return;
    }
    const savedTheme: Theme = { ...draft, id, name: cleanName };
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
    if (!settings || !confirm(`Delete the custom theme “${theme.name}”?`)) return;
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
            <p className="mt-1 max-w-2xl text-sm text-muted">Create a palette, adjust every surface and colour, then save it for the whole app.</p>
          </div>
        </header>

        {(
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
                  <input value={draft.name} onChange={(event) => update('name', event.target.value)} className="w-full rounded-xl border border-line bg-panel2 px-3 py-2 text-sm outline-none focus:border-accent" placeholder="Aurora" />
                </label>
                <div className="flex gap-2">
                  <button type="button" disabled={!valid || busy} onClick={() => void persist(false)} className="inline-flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm text-muted hover:border-accent hover:text-fg disabled:opacity-40"><Save className="size-4" /> Save</button>
                  <button type="button" disabled={!valid || busy} onClick={() => void persist(true)} className="inline-flex items-center gap-2 rounded-xl bg-accent px-3 py-2 text-sm font-semibold text-[var(--c-on-accent)] hover:brightness-110 disabled:opacity-40"><Check className="size-4" /> Save and apply</button>
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {COLOR_FIELDS.map(({ key, label }) => (
                  <ThemeColor key={key} label={label} value={String(draft[key] ?? '#ffffff')} onChange={(value) => update(key, value)} />
                ))}
              </div>

              <div className="overflow-hidden rounded-2xl border border-line" style={{ background: draft.bg, color: draft.text }}>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4" style={{ borderColor: draft.border, background: draft.panel }}>
                  <div><p className="text-sm font-semibold">{draft.name || 'Theme preview'}</p><p className="text-xs" style={{ color: draft.muted }}>A little preview of your surfaces and accents.</p></div>
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
        )}
      </div>
    </div>
  );
}
