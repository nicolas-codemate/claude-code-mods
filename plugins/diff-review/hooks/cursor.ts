import type { DiffRow } from '../types'
import type { SplitRow } from './split-rows'

// The rows the line cursor stops on, in the order drawn. Side by side, a pair is one stop: its new line, or the
// removed one when nothing faces it.
export function cursorStopsOf(diffRows: DiffRow[], splitRows: SplitRow[] | null): number[] {
  if (splitRows) {
    return splitRows.flatMap(splitRow => {
      const side = splitRow.kind === 'pair' ? (splitRow.right ?? splitRow.left) : null
      return side ? [side.rowIndex] : []
    })
  }

  return diffRows.flatMap((row, rowIndex) => (row.kind === 'hunk' ? [] : [rowIndex]))
}

export function firstChangeStop(diffRows: DiffRow[], stops: number[]): number | null {
  return stops.find(rowIndex => diffRows[rowIndex]?.kind !== 'context') ?? stops[0] ?? null
}

export function movedCursor(stops: number[], cursorRowIndex: number, offset: number): number {
  const currentStop = stops.indexOf(cursorRowIndex)
  if (currentStop === -1) {
    return stops[0] ?? cursorRowIndex
  }

  return stops[Math.max(0, Math.min(stops.length - 1, currentStop + offset))] ?? cursorRowIndex
}

// The first line of the next hunk below the cursor; upward, the first line of its own hunk, then of the one above.
export function cursorAtHunk(diffRows: DiffRow[], stops: number[], cursorRowIndex: number, direction: 1 | -1): number {
  const hunkStarts = stops.filter((rowIndex, stopIndex) => {
    const previousStop = stops[stopIndex - 1]
    return previousStop === undefined || diffRows.slice(previousStop, rowIndex).some(row => row.kind === 'hunk')
  })
  const target =
    direction === 1
      ? hunkStarts.find(rowIndex => rowIndex > cursorRowIndex)
      : [...hunkStarts].reverse().find(rowIndex => rowIndex < cursorRowIndex)

  return target ?? cursorRowIndex
}

// The scroll offset that keeps the cursor's drawn line in view, a few lines from the edge it moves toward.
export function offsetShowingCursor(drawnIndex: number, offset: number, visibleRows: number): number {
  const margin = Math.min(3, Math.floor(visibleRows / 4))
  if (drawnIndex < offset + margin) {
    return Math.max(0, drawnIndex - margin)
  }
  if (drawnIndex > offset + visibleRows - 1 - margin) {
    return Math.max(0, drawnIndex - visibleRows + 1 + margin)
  }

  return offset
}
