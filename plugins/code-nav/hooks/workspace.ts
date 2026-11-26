import type { SymbolEntry } from '../types'

export type SearchMatch = { path: string; line: number; column: number; text: string }

export type SearchOptions = {
  // Glob patterns as ripgrep reads them ("*.php", "!tests/**"); every file when absent.
  globs?: readonly string[]
  // A directory under the root to search instead of the whole project.
  directory?: string
  // Also search what git ignores (vendor/, node_modules/): slower, asked only when the project's own code has no answer.
  includeIgnored?: boolean
  // A text the person typed in lower case: the names the analyses search keep their case.
  isCaseInsensitive?: boolean
  maxMatches?: number
}

// What the analysis may ask of the project: its file list, its declarations, a file's text, a ripgrep search.
// Every path is relative to the root; a file git ignores is read by its path from the root all the same.
export type Workspace = {
  files: () => readonly string[]
  symbols: () => readonly SymbolEntry[]
  symbolsNamed: (name: string) => readonly SymbolEntry[]
  // Null when the file does not exist or cannot be read.
  readFile: (path: string) => Promise<string | null>
  // pattern is a Rust regular expression, as ripgrep takes it. One match per occurrence, in path then line order.
  search: (pattern: string, options?: SearchOptions) => Promise<SearchMatch[]>
}
