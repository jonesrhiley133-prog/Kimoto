/** Theme model, presets and runtime application via CSS variables. */
export interface ThemeColors {
  bg: string; surface: string; surface2: string; card: string; border: string; text: string; muted: string;
  primary: string; onPrimary: string; secondary: string; accent: string; hover: string; selected: string;
}
export interface ThemeData {
  colors: ThemeColors;
  dark: boolean;
  radius: number; // px
  shadow: number; // 0..1.5
  blur: number; // px (glass)
  transparency: number; // 0 = opaque surfaces, 0.5 = very translucent
  gradient: { enabled: boolean; from: string; to: string; angle: number; opacity: number };
  font: 'Inter' | 'System' | 'Space Grotesk' | 'Literata' | 'Atkinson';
  fontSize: number; // px root size
  density: 'compact' | 'comfortable' | 'spacious';
  animations: 'full' | 'reduced' | 'none';
}

const base = { radius: 10, shadow: 1, blur: 0, transparency: 0, font: 'Inter' as const, fontSize: 16, density: 'comfortable' as const, animations: 'full' as const };
const noGrad = { enabled: false, from: '#000000', to: '#000000', angle: 160, opacity: 0.25 };
const mk = (dark: boolean, colors: ThemeColors, extra: Partial<ThemeData> = {}): ThemeData => ({ ...base, dark, colors, gradient: noGrad, ...extra });

export const PRESETS: Record<string, { name: string; theme: ThemeData }> = {
  amoled: { name: 'AMOLED Black', theme: mk(true, { bg: '#000000', surface: '#0a0a0a', surface2: '#141414', card: '#0d0d0d', border: '#262626', text: '#f2f2f2', muted: '#8f8f8f', primary: '#a78bfa', onPrimary: '#0b0614', secondary: '#38bdf8', accent: '#f472b6', hover: '#ffffff', selected: '#a78bfa' }, { shadow: 0 }) },
  midnight: { name: 'Midnight', theme: mk(true, { bg: '#0d0f17', surface: '#141722', surface2: '#1b1f2d', card: '#181b28', border: '#2c3144', text: '#e9ebf5', muted: '#949ab4', primary: '#8b7cff', onPrimary: '#ffffff', secondary: '#5ec4ff', accent: '#ff7eb3', hover: '#ffffff', selected: '#8b7cff' }) },
  dark: { name: 'Dark', theme: mk(true, { bg: '#18181b', surface: '#1f1f23', surface2: '#27272a', card: '#222226', border: '#3a3a40', text: '#f4f4f5', muted: '#a1a1aa', primary: '#3b82f6', onPrimary: '#ffffff', secondary: '#22d3ee', accent: '#f59e0b', hover: '#ffffff', selected: '#3b82f6' }) },
  light: { name: 'Light', theme: mk(false, { bg: '#f6f7fb', surface: '#ffffff', surface2: '#eef0f6', card: '#ffffff', border: '#dfe2ec', text: '#161826', muted: '#5f6680', primary: '#5b4cf0', onPrimary: '#ffffff', secondary: '#0284c7', accent: '#db2777', hover: '#000000', selected: '#5b4cf0' }, { shadow: 0.5 }) },
  dracula: { name: 'Dracula', theme: mk(true, { bg: '#21222c', surface: '#282a36', surface2: '#343746', card: '#2c2e3b', border: '#44475a', text: '#f8f8f2', muted: '#a4a8c4', primary: '#bd93f9', onPrimary: '#1e1f29', secondary: '#8be9fd', accent: '#ff79c6', hover: '#ffffff', selected: '#bd93f9' }) },
  nord: { name: 'Nord', theme: mk(true, { bg: '#242933', surface: '#2e3440', surface2: '#3b4252', card: '#323846', border: '#4c566a', text: '#eceff4', muted: '#a8b1c2', primary: '#88c0d0', onPrimary: '#1f2530', secondary: '#81a1c1', accent: '#b48ead', hover: '#ffffff', selected: '#88c0d0' }) },
  catppuccin: { name: 'Catppuccin', theme: mk(true, { bg: '#181825', surface: '#1e1e2e', surface2: '#313244', card: '#232334', border: '#45475a', text: '#cdd6f4', muted: '#a6adc8', primary: '#cba6f7', onPrimary: '#1e1e2e', secondary: '#89dceb', accent: '#f5c2e7', hover: '#ffffff', selected: '#cba6f7' }, { radius: 14 }) },
  tokyonight: { name: 'Tokyo Night', theme: mk(true, { bg: '#16161e', surface: '#1a1b26', surface2: '#24283b', card: '#1f2030', border: '#2f3449', text: '#c0caf5', muted: '#8a92b8', primary: '#7aa2f7', onPrimary: '#11121a', secondary: '#7dcfff', accent: '#bb9af7', hover: '#ffffff', selected: '#7aa2f7' }) },
  ocean: { name: 'Ocean', theme: mk(true, { bg: '#07141f', surface: '#0c1e2c', surface2: '#12293b', card: '#0f2333', border: '#1f3d55', text: '#e2f1fb', muted: '#8fb0c6', primary: '#2dd4bf', onPrimary: '#04201c', secondary: '#38bdf8', accent: '#fbbf24', hover: '#ffffff', selected: '#2dd4bf' }, { gradient: { enabled: true, from: '#0b3b5a', to: '#07141f', angle: 170, opacity: 0.6 } }) },
  sakura: { name: 'Sakura', theme: mk(false, { bg: '#fff5f8', surface: '#ffffff', surface2: '#fde8ef', card: '#ffffff', border: '#f5cfdc', text: '#3b1f2b', muted: '#8a5f70', primary: '#e0457b', onPrimary: '#ffffff', secondary: '#9b6bd6', accent: '#f59e0b', hover: '#5a0f2a', selected: '#e0457b' }, { radius: 16, shadow: 0.4 }) },
  lavender: { name: 'Lavender', theme: mk(false, { bg: '#f5f3ff', surface: '#ffffff', surface2: '#ece8fd', card: '#ffffff', border: '#ddd6fe', text: '#241a45', muted: '#6b628f', primary: '#7c3aed', onPrimary: '#ffffff', secondary: '#0ea5e9', accent: '#ec4899', hover: '#2e1065', selected: '#7c3aed' }, { radius: 14, shadow: 0.4 }) },
};
export const DEFAULT_THEME_ID = 'midnight';

export const hexToRgb = (hex: string) => {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((x) => x + x).join('') : h.padEnd(6, '0');
  const n = parseInt(full.slice(0, 6), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
};
export const luminance = (hex: string) => {
  const [r, g, b] = hexToRgb(hex).split(' ').map((v) => {
    const c = Number(v) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const FONTS: Record<ThemeData['font'], string> = {
  Inter: "'Inter', system-ui, sans-serif",
  System: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
  'Space Grotesk': "'Space Grotesk', 'Inter', sans-serif",
  Literata: "'Literata', Georgia, serif",
  Atkinson: "'Atkinson Hyperlegible', 'Inter', sans-serif",
};

export function resolveTheme(appearance: { themeId?: string; custom?: ThemeData | null } | undefined, saved: { id: string; data: ThemeData }[] = []): ThemeData {
  const id = appearance?.themeId ?? DEFAULT_THEME_ID;
  if (id === 'custom' && appearance?.custom) return { ...PRESETS.midnight.theme, ...appearance.custom };
  const s = saved.find((t) => t.id === id);
  if (s) return { ...PRESETS.midnight.theme, ...s.data };
  return (PRESETS[id] ?? PRESETS[DEFAULT_THEME_ID]).theme;
}

export function applyTheme(t: ThemeData, target: HTMLElement = document.documentElement) {
  const s = target.style;
  const c = t.colors;
  const set = (k: string, v: string) => s.setProperty(k, v);
  set('--c-bg', hexToRgb(c.bg)); set('--c-surface', hexToRgb(c.surface)); set('--c-surface-2', hexToRgb(c.surface2));
  set('--c-card', hexToRgb(c.card)); set('--c-border', hexToRgb(c.border)); set('--c-text', hexToRgb(c.text)); set('--c-muted', hexToRgb(c.muted));
  set('--c-primary', hexToRgb(c.primary)); set('--c-on-primary', hexToRgb(c.onPrimary)); set('--c-secondary', hexToRgb(c.secondary));
  set('--c-accent', hexToRgb(c.accent)); set('--c-hover', hexToRgb(c.hover)); set('--c-selected', hexToRgb(c.selected));
  set('--radius', `${t.radius}px`); set('--shadow', String(t.shadow)); set('--blur', `${t.blur}px`);
  set('--surface-alpha', String(1 - t.transparency));
  set('--font-sans', FONTS[t.font] ?? FONTS.Inter);
  set('--font-size', `${t.fontSize}px`);
  set('--gap', t.density === 'compact' ? '0.6rem' : t.density === 'spacious' ? '1.5rem' : '1rem');
  set('--anim', t.animations === 'none' ? '0ms' : t.animations === 'reduced' ? '80ms' : '160ms');
  const g = t.gradient;
  set('--app-gradient', g.enabled ? `linear-gradient(${g.angle}deg, ${g.from}${Math.round(g.opacity * 255).toString(16).padStart(2, '0')}, ${g.to}00 70%)` : 'none');
  if (target === document.documentElement) {
    s.colorScheme = t.dark ? 'dark' : 'light';
    document.documentElement.dataset.anim = t.animations;
    document.documentElement.dataset.density = t.density;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', c.bg);
  }
}

/** Categorical chart palette (validated; light and dark steps). */
export const SERIES = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
};
