export type ThemeMode = 'dark' | 'light'

export type Palette = {
  // The band's frame while the voice reads; also Claude's name and its thinking line.
  claude: string
  // The band's frame while Claude writes its answer and the voice is made ready.
  working: string
  // The band's frame at rest.
  idle: string
  // An answer the person has already moved on from.
  muted: string
  speaking: string
  preparing: string
  failed: string
  warning: string
}

const DARK_PALETTE: Palette = {
  claude: '#d97757',
  working: '#5fb4e8',
  idle: '#5c6370',
  muted: '#8b929e',
  speaking: '#4cc38a',
  preparing: '#e5b84b',
  failed: '#f0716b',
  warning: '#e5b84b',
}

// Darker shades, readable on a white background.
const LIGHT_PALETTE: Palette = {
  claude: '#b8532f',
  working: '#0a5cc2',
  idle: '#a0a7b4',
  muted: '#6b7280',
  speaking: '#1a7f37',
  preparing: '#8a5a00',
  failed: '#c62828',
  warning: '#8a5a00',
}

export const themeModeOf = (claudeCodeTheme: string | null): ThemeMode =>
  claudeCodeTheme !== null && claudeCodeTheme.startsWith('light') ? 'light' : 'dark'

const PALETTES: Readonly<Record<ThemeMode, Palette>> = { dark: DARK_PALETTE, light: LIGHT_PALETTE }

export const paletteOf = (claudeCodeTheme: string | null): Palette => PALETTES[themeModeOf(claudeCodeTheme)]
