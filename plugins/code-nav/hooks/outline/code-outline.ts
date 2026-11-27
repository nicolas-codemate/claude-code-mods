import type { SymbolEntry, SymbolKind } from '../../types'
import { forEachOutlineLine, indentationOfLine, MAXIMUM_OUTLINE_ENTRIES } from './outline-lines'

// membersHolder: a class-like, whose functions are methods. plainScope: a function or a module, whose functions stay
// functions. none: the declaration holds nothing written below it.
export type ScopeOpening = 'membersHolder' | 'plainScope' | 'none'

// anywhere: wherever the line stands. membersHolderBody: directly inside a class-like, which keeps a statement of a
// method body from being read as a method. topLevel: outside every declaration.
export type RulePlacement = 'anywhere' | 'membersHolderBody' | 'topLevel'

// One shape of declaration line. The pattern names the declared word with a group "name"; a group "container", when
// it matched, names what holds the declaration in place of the declarations above it (the receiver of a Go method,
// the class of a C++ method defined outside it). A null kind opens a scope without listing it: a Rust impl block.
export type CodeDeclarationRule = {
  pattern: RegExp
  kind: SymbolKind | null
  kindInsideMembersHolder?: SymbolKind
  opens: ScopeOpening
  placement: RulePlacement
}

export type CodeLanguage = {
  rules: readonly CodeDeclarationRule[]
  lineCommentPrefixes: readonly string[]
  blockComment: { open: string; close: string } | null
  // Python: a docstring spans lines between triple quotes.
  hasTripleQuotedStrings: boolean
  // Lines that stand at the indentation of a declaration without closing it: a brace opened on its own line, an
  // access label of a C++ class.
  linesKeepingScopes: RegExp | null
  wordsThatAreNotNames: readonly string[]
}

type OpenScope = { name: string; indentation: number; opening: ScopeOpening }

function isMembersHolder(scope: OpenScope | undefined): boolean {
  if (scope === undefined) {
    return false
  }
  switch (scope.opening) {
    case 'membersHolder':
      return true
    case 'plainScope':
    case 'none':
      return false
    default: {
      const unhandledOpening: never = scope.opening
      return unhandledOpening
    }
  }
}

function isRuleAllowedAt(placement: RulePlacement, openScopes: readonly OpenScope[]): boolean {
  switch (placement) {
    case 'anywhere':
      return true
    case 'membersHolderBody':
      return isMembersHolder(openScopes.at(-1))
    case 'topLevel':
      return openScopes.length === 0
    default: {
      const unhandledPlacement: never = placement
      return unhandledPlacement
    }
  }
}

function countOccurrences(text: string, searched: string): number {
  let count = 0
  for (let index = text.indexOf(searched); index !== -1; index = text.indexOf(searched, index + searched.length)) {
    count++
  }

  return count
}

// Declarations are nested by indentation: a declaration holds the lines indented deeper than its own line, until a
// line at its indentation or shallower closes it. Code formatted by hand or by a formatter is indented that way in
// every language listed, braces or not, which keeps the reading to one pass without parsing the blocks.
export function codeSymbolsOfText(path: string, text: string, language: CodeLanguage): SymbolEntry[] {
  const symbols: SymbolEntry[] = []
  const openScopes: OpenScope[] = []
  const wordsThatAreNotNames = new Set(language.wordsThatAreNotNames)
  let isInsideBlockComment = false
  let tripleQuoteDelimiter: string | null = null

  forEachOutlineLine(text, (lineText, line) => {
    const trimmedLine = lineText.trim()
    if (tripleQuoteDelimiter !== null) {
      if (countOccurrences(trimmedLine, tripleQuoteDelimiter) % 2 === 1) {
        tripleQuoteDelimiter = null
      }
      return true
    }
    if (isInsideBlockComment && language.blockComment) {
      if (trimmedLine.includes(language.blockComment.close)) {
        isInsideBlockComment = false
      }
      return true
    }
    if (trimmedLine === '') {
      return true
    }
    if (language.blockComment && trimmedLine.startsWith(language.blockComment.open)) {
      const closeIndex = trimmedLine.indexOf(language.blockComment.close, language.blockComment.open.length)
      isInsideBlockComment = closeIndex === -1
      return true
    }
    if (language.lineCommentPrefixes.some(prefix => trimmedLine.startsWith(prefix))) {
      return true
    }
    if (language.linesKeepingScopes?.test(trimmedLine)) {
      return true
    }

    const indentation = indentationOfLine(lineText)
    while (openScopes.length > 0 && (openScopes.at(-1)?.indentation ?? -1) >= indentation) {
      openScopes.pop()
    }

    for (const rule of language.rules) {
      if (!isRuleAllowedAt(rule.placement, openScopes)) {
        continue
      }
      const groups = rule.pattern.exec(lineText)?.groups
      const name = groups?.name
      if (name === undefined || name === '' || wordsThatAreNotNames.has(name)) {
        continue
      }
      const explicitContainer = groups?.container
      const enclosingScope = openScopes.at(-1)
      const isMember = explicitContainer !== undefined || isMembersHolder(enclosingScope)
      const kind = isMember && rule.kindInsideMembersHolder ? rule.kindInsideMembersHolder : rule.kind
      if (kind !== null) {
        symbols.push({ name, kind, path, line, container: explicitContainer ?? enclosingScope?.name ?? null })
      }
      if (rule.opens !== 'none') {
        openScopes.push({ name, indentation, opening: rule.opens })
      }
      break
    }

    if (language.hasTripleQuotedStrings) {
      for (const delimiter of ['"""', "'''"]) {
        if (countOccurrences(lineText, delimiter) % 2 === 1) {
          tripleQuoteDelimiter = delimiter
          break
        }
      }
    }

    return symbols.length < MAXIMUM_OUTLINE_ENTRIES
  })

  return symbols
}
