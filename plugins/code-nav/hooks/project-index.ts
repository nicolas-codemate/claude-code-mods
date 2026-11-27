import type { SymbolEntry } from '../types'
import type { LanguageDeclarations } from './language-support'
import { NAVIGATED_LANGUAGES } from './languages'
import type { NavigatedLanguage } from './languages'
import type { ClassLikeKind } from './symbol-names'

export type IndexedLanguage = NavigatedLanguage

const SEARCHED_DIRECTORY = './'

// The ripgrep invocations that list every declaration of the project: argv is what follows `rg` on the command line,
// run from the project root. What git ignores is left out, which is what keeps the dependencies out of the index.
export function declarationSearches(): readonly { language: IndexedLanguage; argv: readonly string[] }[] {
  return (Object.keys(NAVIGATED_LANGUAGES) as IndexedLanguage[]).map(language => {
    const { declarations, extensions } = NAVIGATED_LANGUAGES[language]

    return {
      language,
      argv: [
        '--no-config',
        // Names are read as ASCII words, which halves the time of the search.
        '--no-unicode',
        '--color=never',
        '--heading',
        '--line-number',
        '--no-column',
        '--only-matching',
        '--replace',
        declarations.replacement,
        '--regexp',
        declarations.pattern,
        ...extensions.flatMap(extension => ['--glob', `*.${extension}`]),
        // Without a directory, ripgrep reads its standard input whenever that is not a terminal.
        SEARCHED_DIRECTORY,
      ],
    }
  })
}

const CARRIAGE_RETURN = 13
const SPACE = 32
const DIGIT_ZERO = 48

// Reads one invocation's standard output into declarations: a path on its own line, then its declarations, then a
// blank line. Members get their container: the class-like declared above them in the same file, until a declaration
// that starts its line closes it.
export function parseDeclarationSearchOutput(language: IndexedLanguage, output: string): SymbolEntry[] {
  const declarations: LanguageDeclarations = NAVIGATED_LANGUAGES[language].declarations
  const readingByKeyword = new Map(Object.entries(declarations.readingByKeyword))
  const wordsThatAreNotNames = new Set(declarations.wordsThatAreNotNames)
  const symbols: SymbolEntry[] = []
  let path: string | null = null
  let openClassLike: { name: string; kind: ClassLikeKind } | null = null

  for (let lineStart = 0; lineStart < output.length; ) {
    const nextLineFeed = output.indexOf('\n', lineStart)
    const afterLine = nextLineFeed === -1 ? output.length : nextLineFeed
    const lineEnd = afterLine > lineStart && output.charCodeAt(afterLine - 1) === CARRIAGE_RETURN ? afterLine - 1 : afterLine
    const printedStart = lineStart
    lineStart = afterLine + 1
    if (lineEnd === printedStart) {
      path = null
      continue
    }
    if (path === null) {
      const pathStart = output.startsWith(SEARCHED_DIRECTORY, printedStart) ? printedStart + SEARCHED_DIRECTORY.length : printedStart
      path = output.slice(pathStart, lineEnd)
      openClassLike = null
      continue
    }
    const lineNumberEnd = output.indexOf(':', printedStart)
    const nameStart = output.lastIndexOf(' ', lineEnd - 1) + 1
    if (lineNumberEnd === -1 || lineNumberEnd >= nameStart || nameStart >= lineEnd) {
      continue
    }
    const isIndented = output.charCodeAt(lineNumberEnd + 1) <= SPACE && lineNumberEnd + 2 < nameStart
    const reading = readingByKeyword.get(output.slice(lineNumberEnd + (isIndented ? 2 : 1), nameStart - 1))
    const name = output.slice(nameStart, lineEnd)
    if (!reading || wordsThatAreNotNames.has(name)) {
      continue
    }
    let line = 0
    for (let digitIndex = printedStart; digitIndex < lineNumberEnd; digitIndex++) {
      line = line * 10 + output.charCodeAt(digitIndex) - DIGIT_ZERO
    }
    if ('classLikeKind' in reading) {
      symbols.push({ name, kind: reading.classLikeKind, path, line, container: null })
      openClassLike = { name, kind: reading.classLikeKind }
      continue
    }
    const memberKind = isIndented && openClassLike ? reading.memberKindByClassLike[openClassLike.kind] : undefined
    if (memberKind && openClassLike) {
      symbols.push({ name, kind: memberKind, path, line, container: openClassLike.name })
    } else if (reading.standaloneKind) {
      symbols.push({ name, kind: reading.standaloneKind, path, line, container: null })
      if (!isIndented) {
        openClassLike = null
      }
    }
  }

  return symbols
}
