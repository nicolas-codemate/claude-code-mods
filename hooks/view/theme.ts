import type { DiffRowKind } from '../../types'

export type ThemeMode = 'dark' | 'light'

export type Theme = {
  paneBackground: string | undefined
  panelBackground: string | undefined
  headerBackground: string | undefined
  border: string
  text: string
  heading: string
  muted: string
  lineNumber: string
  accent: string
  accentBorder: string
  activeTabBackground: string | undefined
  selectedBackground: string | undefined
  cursorBackground: string | undefined
  threadBackground: string | undefined
  hunk: string
  directory: string
  commitSha: string
  added: string
  removed: string
  addedRowBackground: string | undefined
  removedRowBackground: string | undefined
  gitHubThread: string
  gitHubThreadBorder: string
  gitHubThreadBackground: string | undefined
  // The fill of the drawings the Desktop shows: kept when the backgrounds go back to the terminal, since a drawing
  // brings its own text colors and needs its own surface under them.
  tileFill: string
}

const DARK_THEME: Theme = {
  paneBackground: '#111318',
  panelBackground: '#171a21',
  headerBackground: '#1c2029',
  border: '#2a2f3a',
  text: '#d5d9e0',
  heading: '#eef1f5',
  muted: '#7f8896',
  lineNumber: '#4b5363',
  accent: '#6cb6ff',
  accentBorder: '#2b4a6e',
  activeTabBackground: '#16263a',
  selectedBackground: '#1d2533',
  cursorBackground: '#1d2a3c',
  threadBackground: '#141c28',
  hunk: '#56c2d6',
  directory: '#e0a96d',
  commitSha: '#e3b341',
  added: '#7ee2a8',
  removed: '#ff8f8f',
  addedRowBackground: '#11251b',
  removedRowBackground: '#2a1517',
  gitHubThread: '#b392f0',
  gitHubThreadBorder: '#3d3160',
  gitHubThreadBackground: '#1a1626',
  tileFill: '#1c2029',
}

const LIGHT_THEME: Theme = {
  paneBackground: '#f6f5f1',
  panelBackground: '#ffffff',
  headerBackground: '#f0efe9',
  border: '#d9d7ce',
  text: '#2b2f36',
  heading: '#14171c',
  muted: '#646c78',
  lineNumber: '#9aa1ab',
  accent: '#0a5cc2',
  accentBorder: '#a9c7ee',
  activeTabBackground: '#e3eefc',
  selectedBackground: '#eaf1fb',
  cursorBackground: '#dde9fb',
  threadBackground: '#f2f7fe',
  hunk: '#0b6f80',
  directory: '#9a5b13',
  commitSha: '#8a5a00',
  added: '#1a7438',
  removed: '#b3261e',
  addedRowBackground: '#e7f5eb',
  removedRowBackground: '#fcebea',
  gitHubThread: '#7038c7',
  gitHubThreadBorder: '#cdb6f2',
  gitHubThreadBackground: '#f6f1fd',
  tileFill: '#f0efe9',
}

// Claude Code's light themes are named light-…; anything else, the terminal-following one included, counts as dark.
export function claudeCodeModeOf(claudeCodeTheme: unknown): ThemeMode {
  return typeof claudeCodeTheme === 'string' && claudeCodeTheme.startsWith('light') ? 'light' : 'dark'
}

export function themeModeOf(configuredTheme: unknown, claudeCodeTheme: unknown): ThemeMode {
  return configuredTheme === 'dark' || configuredTheme === 'light' ? configuredTheme : claudeCodeModeOf(claudeCodeTheme)
}

// Button labels, code and markdown keep the terminal's own text color, which suits Claude Code's theme: a pane forced
// to the other mode leaves every background to the terminal so that text stays readable, and keeps only its colors.
export function themeOf(configuredTheme: unknown, claudeCodeTheme: unknown): Theme {
  const mode = themeModeOf(configuredTheme, claudeCodeTheme)
  const theme = mode === 'light' ? LIGHT_THEME : DARK_THEME
  if (mode === claudeCodeModeOf(claudeCodeTheme)) {
    return theme
  }

  return Object.fromEntries(
    Object.entries(theme).map(([key, color]) => [key, key.endsWith('Background') ? undefined : color]),
  ) as Theme
}

export const ROW_MARKS = { hunk: '@@', context: ' ', added: '+', removed: '−' } as const

export function rowColorOf(theme: Theme, kind: DiffRowKind): string {
  return { hunk: theme.hunk, context: theme.muted, added: theme.added, removed: theme.removed }[kind]
}

export function rowBackgroundOf(theme: Theme, kind: DiffRowKind): string | undefined {
  return { hunk: undefined, context: undefined, added: theme.addedRowBackground, removed: theme.removedRowBackground }[kind]
}
