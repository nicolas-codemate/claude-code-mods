import type { ClickedSymbol, CodePosition, DefinitionAnswer, ImplementationsAnswer, NavigationTarget, Usage, UsagesAnswer } from '../types'
import { TEXT_SEARCH_MATCH_LIMIT } from './constants'
import { labelOfSymbol, wholeNamePattern } from './symbol-names'
import type { Workspace } from './workspace'

const WORD_PATTERN = /[A-Za-z_][A-Za-z0-9_]*/g

export function wordAt(lineText: string, column: number): { name: string; startColumn: number; endColumn: number } | null {
  for (const match of lineText.matchAll(WORD_PATTERN)) {
    if (column >= match.index && column < match.index + match[0].length) {
      return { name: match[0], startColumn: match.index, endColumn: match.index + match[0].length }
    }
  }

  return null
}

async function clickedWord(workspace: Workspace, position: CodePosition): Promise<ClickedSymbol | null> {
  const text = await workspace.readFile(position.path)
  const lineText = text?.split('\n')[position.line - 1]
  const word = lineText === undefined ? null : wordAt(lineText, position.column)

  return word === null ? null : { ...word, line: position.line, description: `the word ${word.name}` }
}

// A file of a language the mod does not analyse: the word under the click is looked up by name alone, among the
// project's declarations.
export async function resolveTextDefinition(workspace: Workspace, position: CodePosition): Promise<DefinitionAnswer> {
  const symbol = await clickedWord(workspace, position)
  if (symbol === null) {
    return { symbol: null, targets: [], isOnDeclaration: false, note: null }
  }
  const targets: NavigationTarget[] = workspace.symbolsNamed(symbol.name).map(declaration => ({
    path: declaration.path,
    line: declaration.line,
    column: 0,
    label: labelOfSymbol(declaration),
    preview: declaration.kind,
    certainty: 'candidate',
    isDependency: false,
  }))

  return {
    symbol,
    targets,
    isOnDeclaration: false,
    note: targets.length === 0 ? `No declaration named ${symbol.name} in the project. Press u to list where the word is written.` : null,
  }
}

export async function findTextUsages(workspace: Workspace, position: CodePosition): Promise<UsagesAnswer> {
  const symbol = await clickedWord(workspace, position)
  if (symbol === null) {
    return { symbol: null, title: '', usages: [], isTruncated: false, note: 'No name under the pointer.' }
  }
  const matches = await workspace.search(wholeNamePattern(symbol.name), { maxMatches: TEXT_SEARCH_MATCH_LIMIT + 1 })
  const usages: Usage[] = matches
    .slice(0, TEXT_SEARCH_MATCH_LIMIT)
    .map(match => ({ path: match.path, line: match.line, column: match.column, preview: match.text.trim(), certainty: 'unverified' }))

  return { symbol, title: symbol.name, usages, isTruncated: matches.length > TEXT_SEARCH_MATCH_LIMIT, note: null }
}

export async function findTextImplementations(workspace: Workspace, position: CodePosition): Promise<ImplementationsAnswer> {
  const symbol = await clickedWord(workspace, position)

  return {
    symbol,
    title: symbol?.name ?? '',
    targets: [],
    note: 'Implementations are known for PHP, TypeScript, JavaScript and Vue files only.',
  }
}

export async function findTextParents(workspace: Workspace, position: CodePosition): Promise<ImplementationsAnswer> {
  const symbol = await clickedWord(workspace, position)

  return {
    symbol,
    title: symbol?.name ?? '',
    targets: [],
    note: 'Parents are known for PHP, TypeScript, JavaScript and Vue files only.',
  }
}
