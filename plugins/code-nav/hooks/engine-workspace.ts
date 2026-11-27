import type { EngineInterface } from 'claude-code'

import type { IndexSummary, SymbolEntry } from '../types'
import { FILE_TEXT_MAX_AGE_MS } from './constants'
import { declarationSearches, parseDeclarationSearchOutput } from './project-index'
import type { SearchMatch, SearchOptions, Workspace } from './workspace'

export type ProjectIndex = {
  files: readonly string[]
  fileSet: ReadonlySet<string>
  symbols: readonly SymbolEntry[]
  symbolsByName: ReadonlyMap<string, readonly SymbolEntry[]>
  builtAt: number
  summary: IndexSummary
}

export const EMPTY_INDEX: ProjectIndex = {
  files: [],
  fileSet: new Set(),
  symbols: [],
  symbolsByName: new Map(),
  builtAt: 0,
  summary: { fileCount: 0, symbolCount: 0, durationMs: 0 },
}

// Named explicitly: with no path, ripgrep reads its standard input when that is not a terminal.
const SEARCHED_DIRECTORY = './'

function withoutCurrentDirectoryPrefix(path: string): string {
  return path.startsWith('./') ? path.slice(2) : path
}

// ripgrep exits with 1 when nothing matched, which is an answer, and with 2 on a real failure.
const RIPGREP_NO_MATCH_EXIT_CODE = 1

export class RipgrepMissingError extends Error {}

async function ripgrepOutput($: EngineInterface, root: string, ripgrepArguments: readonly string[], maxLines?: number): Promise<string> {
  let output = ''
  let errorOutput = ''
  let lineCount = 0
  const child = $.process.spawn({ argv: ['rg', ...ripgrepArguments], cwd: root })
  try {
    for await (const chunk of child) {
      if (chunk.stream === 'stderr') {
        errorOutput += chunk.text
        continue
      }
      output += chunk.text
      if (maxLines !== undefined) {
        lineCount += chunk.text.split('\n').length - 1
        if (lineCount >= maxLines) {
          break
        }
      }
    }
  } catch (error) {
    throw new RipgrepMissingError(`ripgrep (rg) could not be started: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (maxLines === undefined || lineCount < maxLines) {
    const ended = await child.result.catch(() => null)
    if (ended !== null && ended.code !== 0 && ended.code !== RIPGREP_NO_MATCH_EXIT_CODE && output === '') {
      throw new Error(`rg failed: ${errorOutput.trim().split('\n')[0] ?? `exit code ${String(ended.code)}`}`)
    }
  }

  return output
}

function groupedByName(symbols: readonly SymbolEntry[]): Map<string, SymbolEntry[]> {
  const symbolsByName = new Map<string, SymbolEntry[]>()
  for (const symbol of symbols) {
    const sameName = symbolsByName.get(symbol.name)
    if (sameName) {
      sameName.push(symbol)
    } else {
      symbolsByName.set(symbol.name, [symbol])
    }
  }

  return symbolsByName
}

// Lists the project's files and declarations with ripgrep, which leaves out what git ignores: a dependency folder is
// never read here.
export async function buildProjectIndex($: EngineInterface, root: string): Promise<ProjectIndex> {
  const startedAt = await $.clock.now()
  const [fileListing, ...declarationOutputs] = await Promise.all([
    ripgrepOutput($, root, ['--files', SEARCHED_DIRECTORY]),
    ...declarationSearches().map(search => ripgrepOutput($, root, search.argv)),
  ])
  const files = (fileListing ?? '')
    .split('\n')
    .filter(path => path !== '')
    .map(withoutCurrentDirectoryPrefix)
    .sort()
  const symbols = declarationSearches().flatMap((search, searchIndex) =>
    parseDeclarationSearchOutput(search.language, declarationOutputs[searchIndex] ?? ''),
  )
  const builtAt = await $.clock.now()

  return {
    files,
    fileSet: new Set(files),
    symbols,
    symbolsByName: groupedByName(symbols),
    builtAt,
    summary: { fileCount: files.length, symbolCount: symbols.length, durationMs: builtAt - startedAt },
  }
}

// ripgrep counts a column in bytes, from 1; the analysis counts characters, from 0.
export function characterColumnOfByteColumn(lineText: string, byteColumn: number): number {
  let bytesSeen = 0
  let characterIndex = 0
  for (const character of lineText) {
    if (bytesSeen >= byteColumn - 1) {
      break
    }
    const codePoint = character.codePointAt(0) ?? 0
    bytesSeen += codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4
    characterIndex += character.length
  }

  return characterIndex
}

// The line's text may hold a carriage return or a line separator character, which "." alone does not match.
const SEARCH_LINE_PATTERN = /^(.*?):(\d+):(\d+):(.*)$/s
// What ripgrep prints in place of a line longer than the limit given to it.
const OMITTED_LINE_PATTERN = /^\[Omitted long line with \d+ matches?\]$/
const LONGEST_SEARCHED_LINE_BYTES = 2000

export function parseSearchOutput(output: string, maxMatches: number | undefined): SearchMatch[] {
  const matches: SearchMatch[] = []
  for (const outputLine of output.split('\n')) {
    const parts = SEARCH_LINE_PATTERN.exec(outputLine)
    if (!parts) {
      continue
    }
    const [, path = '', lineNumber = '0', byteColumn = '1', printedText = ''] = parts
    if (OMITTED_LINE_PATTERN.test(printedText)) {
      continue
    }
    const text = printedText.endsWith('\r') ? printedText.slice(0, -1) : printedText
    matches.push({ path: withoutCurrentDirectoryPrefix(path), line: Number(lineNumber), column: characterColumnOfByteColumn(text, Number(byteColumn)), text })
  }
  matches.sort((first, second) => (first.path === second.path ? first.line - second.line || first.column - second.column : first.path < second.path ? -1 : 1))

  return maxMatches === undefined ? matches : matches.slice(0, maxMatches)
}

// --vimgrep prints one line per occurrence, each with its whole line. A line longer than the limit is left out, its
// matches with it: one line of a minified file would otherwise weigh megabytes in the answer.
export function searchArgumentsOf(pattern: string, options: SearchOptions): string[] {
  return [
    '--vimgrep',
    '--no-messages',
    '--color',
    'never',
    '--max-columns',
    String(LONGEST_SEARCHED_LINE_BYTES),
    ...(options.includeIgnored ? ['--no-ignore'] : []),
    ...(options.isCaseInsensitive ? ['--ignore-case'] : []),
    ...(options.globs ?? []).flatMap(glob => ['--glob', glob]),
    '--regexp',
    pattern,
    options.directory ?? SEARCHED_DIRECTORY,
  ]
}

export type EngineWorkspace = Workspace & {
  root: string
  index: () => ProjectIndex
  replaceIndex: (index: ProjectIndex) => void
  // The file shown is read again from the disk, not from the texts kept for the analysis.
  forgetFileText: (path: string) => void
}

// The project as the analysis reads it, over the engine: file texts are kept a few seconds so that one analysis
// reading a class and its parents asks the disk once for each, and an edit shows on the next look.
export function createEngineWorkspace($: EngineInterface, root: string): EngineWorkspace {
  let index = EMPTY_INDEX
  const textByPath = new Map<string, { text: string | null; readAt: number }>()

  return {
    root,
    index: () => index,
    replaceIndex: nextIndex => {
      index = nextIndex
    },
    forgetFileText: path => {
      textByPath.delete(path)
    },
    files: () => index.files,
    symbols: () => index.symbols,
    symbolsNamed: name => index.symbolsByName.get(name) ?? [],
    readFile: async path => {
      const now = await $.clock.now()
      const kept = textByPath.get(path)
      if (kept && now - kept.readAt < FILE_TEXT_MAX_AGE_MS) {
        return kept.text
      }
      const text = await $.fs.read(path.startsWith('/') ? path : `${root}/${path}`).then(
        value => (typeof value === 'string' ? value : null),
        () => null,
      )
      textByPath.set(path, { text, readAt: now })

      return text
    },
    search: async (pattern, options = {}) => {
      const output = await ripgrepOutput($, root, searchArgumentsOf(pattern, options), options.maxMatches)

      return parseSearchOutput(output, options.maxMatches)
    },
  }
}
