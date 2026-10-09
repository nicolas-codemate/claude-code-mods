import type { DiffRow } from '../types'
import { parseUnifiedDiff } from './git-parsing'

// A selection spanning several lines watches its first one: a term is searched within a line.
export function watchedTermOf(selectedText: string): string {
  return selectedText.split('\n').map(line => line.trim()).find(line => line !== '') ?? ''
}

export function matchCountOf(text: string, term: string): number {
  return term === '' ? 0 : text.split(term).length - 1
}

export function splitByTerm(text: string, term: string): Array<{ text: string; isMatch: boolean }> {
  if (term === '') {
    return [{ text, isMatch: false }]
  }

  return text
    .split(term)
    .flatMap((part, index) => (index === 0 ? [{ text: part, isMatch: false }] : [{ text: term, isMatch: true }, { text: part, isMatch: false }]))
    .filter(segment => segment.text !== '')
}

// The diff of a whole view, file by file: a deleted file is named by its old path, any other by its new one.
export function rowsByPathOfViewDiff(diffOutput: string): Record<string, DiffRow[]> {
  const rowsByPath: Record<string, DiffRow[]> = {}
  for (const fileDiff of diffOutput.split(/^(?=diff --git )/m)) {
    const oldPath = fileDiff.match(/^--- a\/(.+)$/m)?.[1]
    const newPath = fileDiff.match(/^\+\+\+ b\/(.+)$/m)?.[1]
    const path = newPath ?? oldPath
    if (path !== undefined) {
      rowsByPath[path] = parseUnifiedDiff(fileDiff)
    }
  }

  return rowsByPath
}

export function matchCountByPathOf(rowsByPath: Record<string, DiffRow[]>, term: string): Record<string, number> {
  return Object.fromEntries(
    Object.entries(rowsByPath)
      .map(([path, rows]) => [path, rows.reduce((count, row) => count + (row.kind === 'hunk' ? 0 : matchCountOf(row.text, term)), 0)] as const)
      .filter(([, count]) => count > 0),
  )
}

// The next stop holding the term past the cursor, in the direction asked; with no cursor, the first or the last one.
export function matchStopFrom(diffRows: DiffRow[], stops: number[], cursorRowIndex: number | null, term: string, direction: 1 | -1): number | null {
  const matchStops = stops.filter(rowIndex => matchCountOf(diffRows[rowIndex]?.text ?? '', term) > 0)
  const orderedMatchStops = direction === 1 ? matchStops : [...matchStops].reverse()
  const cursorStop = cursorRowIndex === null ? -1 : stops.indexOf(cursorRowIndex)
  if (cursorStop === -1) {
    return orderedMatchStops[0] ?? null
  }

  return orderedMatchStops.find(rowIndex => (stops.indexOf(rowIndex) - cursorStop) * direction > 0) ?? null
}

// The next file holding the term in the order of the list, going round past its end; the current one comes last.
export function fileWithMatchesFrom(
  orderedPaths: string[],
  currentPath: string | null,
  matchCountByPath: Record<string, number>,
  direction: 1 | -1,
): string | null {
  const currentIndex = currentPath === null ? -1 : orderedPaths.indexOf(currentPath)
  const startIndex = currentIndex === -1 && direction === -1 ? orderedPaths.length : currentIndex
  for (let step = 1; step <= orderedPaths.length; step += 1) {
    const index = (((startIndex + step * direction) % orderedPaths.length) + orderedPaths.length) % orderedPaths.length
    const path = orderedPaths[index]
    if (path !== undefined && (matchCountByPath[path] ?? 0) > 0) {
      return path
    }
  }

  return null
}
