import type { Theme } from '../types';
export type { Theme } from '../types';

// Orbit themes - named after celestial bodies. `nebula` is the default and
// keeps its id so a saved choice survives upgrades; only its palette moved to
// the graphite room and solar signal the rest of the interface is drawn in.
export const THEMES: Theme[] = [
  { id: 'nebula', name: 'Orbital', bg: '#08090c', panel: '#111318', panel2: '#181b21', border: '#272b33', text: '#f3f4f6', muted: '#8e96a3', accent: '#ff6b3d', accent2: '#7aa2ff', onAccent: '#1c0a04' },
  { id: 'eclipse', name: 'Eclipse', bg: '#09090b', panel: '#131316', panel2: '#1c1c21', border: '#2a2a31', text: '#f4f4f5', muted: '#a1a1aa', accent: '#f59e0b', accent2: '#ef4444' },
  // Rubellite follows Eclipse's dark, restrained surfaces with a ruby-pink accent.
  { id: 'rubellite', name: 'Rubellite', bg: '#100a11', panel: '#191019', panel2: '#241722', border: '#3c2938', text: '#f8edf5', muted: '#ad93a7', accent: '#d85b83', accent2: '#9f5baf' },
  { id: 'mars', name: 'Mars', bg: '#140a08', panel: '#22110d', panel2: '#2f1913', border: '#4a2a20', text: '#fff1ec', muted: '#c9a092', accent: '#f97316', accent2: '#e11d48' },
  { id: 'emerald', name: 'Emerald', bg: '#03130f', panel: '#082019', panel2: '#0d2f24', border: '#154536', text: '#e7fff7', muted: '#87b8a7', accent: '#10b981', accent2: '#34d399', onAccent: '#03231a' },
  { id: 'lunar', name: 'Lunar (Light)', bg: '#eef0f6', panel: '#ffffff', panel2: '#f4f5fa', border: '#dcdfea', text: '#151827', muted: '#636a85', accent: '#4f46e5', accent2: '#0ea5e9' },
  { id: 'starlight', name: 'Starlight', bg: '#09121f', panel: '#101d30', panel2: '#192a42', border: '#2a4260', text: '#e8f2ff', muted: '#91a8c4', accent: '#60a5fa', accent2: '#a78bfa' },
  { id: 'rose-quasar', name: 'Rose Quasar', bg: '#1a0c18', panel: '#261326', panel2: '#381c35', border: '#59304f', text: '#fff0fa', muted: '#c29bb7', accent: '#f472b6', accent2: '#fb7185' },
  { id: 'solar-flare', name: 'Solar Flare', bg: '#171208', panel: '#241b0c', panel2: '#35270f', border: '#58431c', text: '#fff4d7', muted: '#c7b58b', accent: '#facc15', accent2: '#fb923c', onAccent: '#2b1b05' },
];

/** Fonts are local system stacks: no downloads, network requests, or setup. */
export const FONTS = [
  { id: 'system', name: 'Orbit Sans', stack: 'Inter, ui-sans-serif, system-ui, sans-serif', sample: 'Clean and familiar' },
  { id: 'rounded', name: 'Rounded', stack: '"Trebuchet MS", "Segoe UI", sans-serif', sample: 'Soft and friendly' },
  { id: 'serif', name: 'Editorial', stack: 'Georgia, Cambria, "Times New Roman", serif', sample: 'A book-like feel' },
  { id: 'mono', name: 'Terminal', stack: '"SFMono-Regular", Consolas, "Liberation Mono", monospace', sample: 'Compact and technical' },
  { id: 'humanist', name: 'Humanist', stack: 'Verdana, Geneva, sans-serif', sample: 'Roomy, screen-friendly letterforms' },
  { id: 'book', name: 'Book', stack: '"Palatino Linotype", "Book Antiqua", Palatino, serif', sample: 'A little more character' },
] as const;

/** Built-in and saved player themes, with built-ins kept first. */
export function themesFor(custom: Theme[] = []): Theme[] {
  return [...THEMES, ...custom.filter((theme) => !THEMES.some((builtIn) => builtIn.id === theme.id))];
}

/** The theme, by id, with Nebula as the answer for anything unknown. */
export function themeById(id: string, custom: Theme[] = []): Theme {
  return themesFor(custom).find((item) => item.id === id) ?? THEMES[0];
}

/**
 * The colours of a theme as plain hex, for the native card. That window is
 * drawn by Rust, which cannot read a CSS variable, so it is handed the same
 * palette the page uses.
 */
export function nativePalette(id: string, custom: Theme[] = []): { panel: string; text: string; muted: string; accent: string } {
  const theme = themeById(id, custom);
  return { panel: theme.panel, text: theme.text, muted: theme.muted, accent: theme.accent };
}

export function applyTheme(id: string, custom: Theme[] = []) {
  const t = themeById(id, custom);
  const r = document.documentElement.style;
  r.setProperty('--c-bg', t.bg);
  r.setProperty('--c-panel', t.panel);
  r.setProperty('--c-panel2', t.panel2);
  r.setProperty('--c-border', t.border);
  r.setProperty('--c-text', t.text);
  r.setProperty('--c-muted', t.muted);
  r.setProperty('--c-accent', t.accent);
  r.setProperty('--c-accent2', t.accent2);
  // Read by every button that sits on the accent: white by default, dark when
  // the accent is too light for white to read.
  r.setProperty('--c-on-accent', t.onAccent ?? '#ffffff');
}

export function applyFont(id: string) {
  const font = FONTS.find((candidate) => candidate.id === id) ?? FONTS[0];
  document.documentElement.style.setProperty('--font-sans', font.stack);
}
