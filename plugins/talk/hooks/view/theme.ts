export type ThemeMode = 'dark' | 'light'

export type Palette = {
  claude: string
  person: string
  speaking: string
  preparing: string
  failed: string
  warning: string
}

const DARK_PALETTE: Palette = {
  claude: '#d97757',
  person: '#5fb4e8',
  speaking: '#4cc38a',
  preparing: '#e5b84b',
  failed: '#f0716b',
  warning: '#e5b84b',
}

// Darker shades, readable on a white background.
const LIGHT_PALETTE: Palette = {
  claude: '#b8532f',
  person: '#0a5cc2',
  speaking: '#1a7f37',
  preparing: '#8a5a00',
  failed: '#c62828',
  warning: '#8a5a00',
}

export const themeModeOf = (claudeCodeTheme: string | null): ThemeMode =>
  claudeCodeTheme !== null && claudeCodeTheme.startsWith('light') ? 'light' : 'dark'

const PALETTES: Readonly<Record<ThemeMode, Palette>> = { dark: DARK_PALETTE, light: LIGHT_PALETTE }

export const paletteOf = (claudeCodeTheme: string | null): Palette => PALETTES[themeModeOf(claudeCodeTheme)]
