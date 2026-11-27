import type { ResultRowMark, SymbolKind, TokenKind } from '../../types'
import type { HighlightKind } from '../display-row'

export type ThemeMode = 'dark' | 'light'

export type Theme = {
  paneBackground: string | undefined
  panelBackground: string | undefined
  headerBackground: string | undefined
  paletteBackground: string | undefined
  selectedBackground: string | undefined
  markedLineBackground: string | undefined
  markedNameBackground: string
  matchBackground: string
  border: string
  accentBorder: string
  text: string
  heading: string
  muted: string
  lineNumber: string
  // The code read, one faint color, while a preview or the structure of the file stands over it.
  overlaidCode: string
  accent: string
  notice: string
  dependency: string
  directory: string
  tokenColors: Record<TokenKind | 'blank', string>
  symbolKindColors: Record<SymbolKind, string>
  resultMarkColors: Record<ResultRowMark, string>
}

const DARK_THEME: Theme = {
  paneBackground: '#111318',
  panelBackground: '#171a21',
  headerBackground: '#1c2029',
  paletteBackground: '#1c2029',
  selectedBackground: '#243349',
  markedLineBackground: '#1a2332',
  markedNameBackground: '#2f4a73',
  matchBackground: '#5c4813',
  border: '#2a2f3a',
  accentBorder: '#2b4a6e',
  text: '#d5d9e0',
  heading: '#eef1f5',
  muted: '#7f8896',
  lineNumber: '#4b5363',
  overlaidCode: '#3a404b',
  accent: '#6cb6ff',
  notice: '#e3b341',
  dependency: '#e0a96d',
  directory: '#e3b341',
  tokenColors: {
    keyword: '#ff7b72',
    name: '#d5d9e0',
    variable: '#ffa657',
    typeName: '#7ee2a8',
    callName: '#d2a8ff',
    property: '#79c0ff',
    string: '#a5d6ff',
    comment: '#7f8896',
    number: '#79c0ff',
    punctuation: '#9aa4b2',
    tag: '#7ee2a8',
    attribute: '#79c0ff',
    text: '#d5d9e0',
    blank: '#d5d9e0',
  },
  symbolKindColors: {
    class: '#7ee2a8',
    interface: '#56c2d6',
    trait: '#56c2d6',
    enum: '#e3b341',
    function: '#d2a8ff',
    method: '#d2a8ff',
    constant: '#79c0ff',
    property: '#79c0ff',
    type: '#56c2d6',
    variable: '#ffa657',
    section: '#e6edf3',
  },
  resultMarkColors: { exact: '#7ee2a8', candidate: '#e3b341', confirmed: '#7ee2a8', unverified: '#e3b341', match: '#7f8896' },
}

const LIGHT_THEME: Theme = {
  paneBackground: '#f6f5f1',
  panelBackground: '#ffffff',
  headerBackground: '#f0efe9',
  paletteBackground: '#ffffff',
  selectedBackground: '#dbe8fb',
  markedLineBackground: '#eef4fd',
  markedNameBackground: '#bcd6f8',
  matchBackground: '#fde58a',
  border: '#d9d7ce',
  accentBorder: '#a9c7ee',
  text: '#2b2f36',
  heading: '#14171c',
  muted: '#646c78',
  lineNumber: '#9aa1ab',
  overlaidCode: '#c3c8cf',
  accent: '#0a5cc2',
  notice: '#8a5a00',
  dependency: '#9a5b13',
  directory: '#8a5a00',
  tokenColors: {
    keyword: '#cf222e',
    name: '#2b2f36',
    variable: '#953800',
    typeName: '#116329',
    callName: '#8250df',
    property: '#0550ae',
    string: '#0a3069',
    comment: '#6e7781',
    number: '#0550ae',
    punctuation: '#57606a',
    tag: '#116329',
    attribute: '#0550ae',
    text: '#2b2f36',
    blank: '#2b2f36',
  },
  symbolKindColors: {
    class: '#116329',
    interface: '#0b6f80',
    trait: '#0b6f80',
    enum: '#8a5a00',
    function: '#8250df',
    method: '#8250df',
    constant: '#0550ae',
    property: '#0550ae',
    type: '#0b6f80',
    variable: '#953800',
    section: '#1f2328',
  },
  resultMarkColors: { exact: '#1a7438', candidate: '#8a5a00', confirmed: '#1a7438', unverified: '#8a5a00', match: '#646c78' },
}

// Claude Code's light themes are named light-…; anything else, the terminal-following one included, counts as dark.
export function claudeCodeModeOf(claudeCodeTheme: unknown): ThemeMode {
  return typeof claudeCodeTheme === 'string' && claudeCodeTheme.startsWith('light') ? 'light' : 'dark'
}

export function themeModeOf(configuredTheme: unknown, claudeCodeTheme: unknown): ThemeMode {
  return configuredTheme === 'dark' || configuredTheme === 'light' ? configuredTheme : claudeCodeModeOf(claudeCodeTheme)
}

// A pane forced to the other mode than Claude Code's leaves the large backgrounds to the terminal, whose own text
// color the buttons keep, and keeps only its colors and the small backgrounds that mark a name.
export function themeOf(configuredTheme: unknown, claudeCodeTheme: unknown): Theme {
  const mode = themeModeOf(configuredTheme, claudeCodeTheme)
  const theme: Record<ThemeMode, Theme> = { dark: DARK_THEME, light: LIGHT_THEME }
  if (mode === claudeCodeModeOf(claudeCodeTheme)) {
    return theme[mode]
  }

  return {
    ...theme[mode],
    paneBackground: undefined,
    panelBackground: undefined,
    headerBackground: undefined,
    paletteBackground: undefined,
    selectedBackground: undefined,
    markedLineBackground: undefined,
  }
}

export function highlightBackgroundOf(theme: Theme, highlight: HighlightKind | null): string | undefined {
  if (highlight === null) {
    return undefined
  }
  const backgrounds: Record<HighlightKind, string> = { marked: theme.markedNameBackground, match: theme.matchBackground }

  return backgrounds[highlight]
}

export const SYMBOL_KIND_LETTERS: Record<SymbolKind, string> = {
  class: 'C',
  interface: 'I',
  trait: 'T',
  enum: 'E',
  function: 'f',
  method: 'm',
  constant: 'c',
  property: 'p',
  type: 't',
  variable: 'v',
  section: '§',
}

export const RESULT_MARK_SIGNS: Record<ResultRowMark, string> = { exact: '●', candidate: '○', confirmed: '●', unverified: '○', match: '·' }
