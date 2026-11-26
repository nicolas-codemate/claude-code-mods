import type { NavigationTarget, SymbolEntry, TargetCertainty } from '../../types'
import { isDependencyPath, offsetOfLocated } from './located'
import type { Located } from './located'
import { baseNameOf, baseNameWithoutExtension } from './paths'
import { readText } from './session'
import type { AnalysisSession } from './session'
import { labelOfDeclaration } from './symbols'
import { lineAndColumnOfOffset, lineStartOffsetsOf, lineTextAt } from '../text-position'

function labelOfFile(path: string): string {
  return path.endsWith('.vue') ? baseNameWithoutExtension(path) : baseNameOf(path)
}

function nameAtOffset(text: string, offset: number): string {
  return text.slice(offset).match(/^[A-Za-z_$][A-Za-z0-9_$]*/)?.[0] ?? ''
}

export async function targetOfLocated(
  session: AnalysisSession,
  located: Located,
  certainty: TargetCertainty,
): Promise<NavigationTarget> {
  const text = located.model?.text ?? (await readText(session, located.path)) ?? ''
  const lineStartOffsets = located.model?.lineStartOffsets ?? lineStartOffsetsOf(text)
  const offset = offsetOfLocated(located)
  const place = offset === null ? { line: 1, column: 0 } : lineAndColumnOfOffset(lineStartOffsets, offset)
  let label = labelOfFile(located.path)
  if (located.declaration !== null && located.structure !== null) {
    label = labelOfDeclaration(located.structure, located.declaration)
  } else if (offset !== null) {
    const name = nameAtOffset(text, offset)
    label = name === '' || name === 'default' ? label : name
  }

  return {
    path: located.path,
    line: place.line,
    column: place.column,
    label,
    preview: lineTextAt(text, lineStartOffsets, place.line).trim(),
    certainty,
    isDependency: isDependencyPath(located.path),
  }
}

function columnOfName(lineText: string, name: string): number {
  const namePattern = new RegExp(`(^|[^A-Za-z0-9_$])${name.replace(/[$]/g, '\\$')}([^A-Za-z0-9_$]|$)`)
  const match = namePattern.exec(lineText)

  return match === null ? Math.max(0, lineText.length - lineText.trimStart().length) : match.index + (match[1]?.length ?? 0)
}

// A declaration the project index lists, read from its file for the text of its line.
export async function targetOfSymbol(
  session: AnalysisSession,
  symbol: SymbolEntry,
  certainty: TargetCertainty,
): Promise<NavigationTarget> {
  const text = (await readText(session, symbol.path)) ?? ''
  const lineText = lineTextAt(text, lineStartOffsetsOf(text), symbol.line)

  return {
    path: symbol.path,
    line: symbol.line,
    column: columnOfName(lineText, symbol.name),
    label: symbol.container === null ? symbol.name : `${symbol.container}.${symbol.name}`,
    preview: lineText.trim(),
    certainty,
    isDependency: isDependencyPath(symbol.path),
  }
}

export function withoutDuplicateTargets(targets: readonly NavigationTarget[]): NavigationTarget[] {
  const seenPlaces = new Set<string>()

  return targets.filter(target => {
    const place = `${target.path}:${target.line}`
    if (seenPlaces.has(place)) {
      return false
    }
    seenPlaces.add(place)

    return true
  })
}
