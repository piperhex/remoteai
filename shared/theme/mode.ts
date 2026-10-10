export type ThemeMode = 'light' | 'dark';

export const THEME_OPTIONS = [
  { value: 'light', label: '明亮' },
  { value: 'dark', label: '暗黑' },
] as const;

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark';
}

export const darkColors = {
  ink: '#e6e8eb', muted: '#a2aaa7', faint: '#87938d',
  surface: '#1b201e', canvas: '#121614', elevated: '#252c28', border: '#35413a',
  accent: '#61d6ad', accentSoft: '#193e31',
  info: '#83b9f7', infoSoft: '#203349',
  warning: '#efbd69', warningSoft: '#40331e',
  danger: '#ff9894', dangerSoft: '#442725',
  purple: '#c3a7f0', purpleSoft: '#342a44',
} as const;

export type ThemeColorRole = keyof typeof darkColors;
export type ThemeColor = (light: string, role: ThemeColorRole) => string;

export function themeColor(mode: ThemeMode): ThemeColor {
  return (light, role) => mode === 'dark' ? darkColors[role] : light;
}
