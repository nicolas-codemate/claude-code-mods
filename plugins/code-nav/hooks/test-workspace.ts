import type { SymbolEntry } from '../types'
import type { SearchMatch, SearchOptions, Workspace } from './workspace'

export type MemoryWorkspaceOptions = {
  // Paths the project's own file list leaves out, as git ignores a dependency folder: read and searched on request only.
  ignoredPathPrefixes?: readonly string[]
  symbolsOfFile?: (path: string, text: string) => SymbolEntry[]
}

function globAsPattern(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')

  return new RegExp(`(^|/)${escaped}$`)
}

function isPathKeptByGlobs(path: string, globs: readonly string[] | undefined): boolean {
  if (!globs || globs.length === 0) {
    return true
  }
  const excluded = globs.filter(glob => glob.startsWith('!')).map(glob => globAsPattern(glob.slice(1)))
  const included = globs.filter(glob => !glob.startsWith('!')).map(globAsPattern)

  return !excluded.some(pattern => pattern.test(path)) && (included.length === 0 || included.some(pattern => pattern.test(path)))
}

// A project held in memory, for tests: the search runs the pattern as a JavaScript regular expression, so a test's
// patterns stay within what ripgrep and JavaScript both read (no look-around, no backreference).
export function createMemoryWorkspace(textByPath: Record<string, string>, options: MemoryWorkspaceOptions = {}): Workspace {
  const ignoredPathPrefixes = options.ignoredPathPrefixes ?? ['vendor/', 'node_modules/']
  const isIgnored = (path: string) => ignoredPathPrefixes.some(prefix => path.startsWith(prefix) || path.includes(`/${prefix}`))
  const allPaths = Object.keys(textByPath).sort()
  const projectPaths = allPaths.filter(path => !isIgnored(path))
  const symbols = options.symbolsOfFile
    ? projectPaths.flatMap(path => options.symbolsOfFile?.(path, textByPath[path] ?? '') ?? [])
    : []

  return {
    files: () => projectPaths,
    symbols: () => symbols,
    symbolsNamed: name => symbols.filter(symbol => symbol.name === name),
    readFile: async path => textByPath[path] ?? null,
    search: async (pattern: string, searchOptions: SearchOptions = {}) => {
      const matches: SearchMatch[] = []
      const searchedPaths = (searchOptions.includeIgnored ? allPaths : projectPaths).filter(
        path =>
          (searchOptions.directory === undefined || path.startsWith(`${searchOptions.directory.replace(/\/$/, '')}/`)) &&
          isPathKeptByGlobs(path, searchOptions.globs),
      )
      for (const path of searchedPaths) {
        const lines = (textByPath[path] ?? '').split('\n')
        for (const [lineIndex, lineText] of lines.entries()) {
          for (const match of lineText.matchAll(new RegExp(pattern, 'g'))) {
            matches.push({ path, line: lineIndex + 1, column: match.index, text: lineText })
            if (searchOptions.maxMatches !== undefined && matches.length >= searchOptions.maxMatches) {
              return matches
            }
          }
        }
      }

      return matches
    },
  }
}
