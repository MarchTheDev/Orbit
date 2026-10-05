export interface Theme {
  id: string;
  name: string;
  bg: string;
  panel: string;
  panel2: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
  accent2: string;
}

// Orbit themes – named after celestial bodies
export const THEMES: Theme[] = [
  { id: 'nebula', name: 'Nebula', bg: '#0b0a16', panel: '#14122a', panel2: '#1d1a3a', border: '#2c2852', text: '#ecebff', muted: '#9a96c4', accent: '#8b5cf6', accent2: '#ec4899' },
  { id: 'eclipse', name: 'Eclipse', bg: '#09090b', panel: '#131316', panel2: '#1c1c21', border: '#2a2a31', text: '#f4f4f5', muted: '#a1a1aa', accent: '#f59e0b', accent2: '#ef4444' },
  { id: 'aurora', name: 'Aurora', bg: '#06121a', panel: '#0c1d29', panel2: '#132a3a', border: '#1f3d52', text: '#e6fbff', muted: '#8fb6c6', accent: '#22d3ee', accent2: '#34d399' },
  { id: 'mars', name: 'Mars', bg: '#140a08', panel: '#22110d', panel2: '#2f1913', border: '#4a2a20', text: '#fff1ec', muted: '#c9a092', accent: '#f97316', accent2: '#e11d48' },
  { id: 'emerald', name: 'Emerald', bg: '#03130f', panel: '#082019', panel2: '#0d2f24', border: '#154536', text: '#e7fff7', muted: '#87b8a7', accent: '#10b981', accent2: '#34d399' },
  { id: 'lunar', name: 'Lunar (Light)', bg: '#eef0f6', panel: '#ffffff', panel2: '#f4f5fa', border: '#dcdfea', text: '#151827', muted: '#636a85', accent: '#4f46e5', accent2: '#0ea5e9' },
];

export function applyTheme(id: string) {
  const t = THEMES.find((x) => x.id === id) ?? THEMES[0];
  const r = document.documentElement.style;
  r.setProperty('--c-bg', t.bg);
  r.setProperty('--c-panel', t.panel);
  r.setProperty('--c-panel2', t.panel2);
  r.setProperty('--c-border', t.border);
  r.setProperty('--c-text', t.text);
  r.setProperty('--c-muted', t.muted);
  r.setProperty('--c-accent', t.accent);
  r.setProperty('--c-accent2', t.accent2);
}
