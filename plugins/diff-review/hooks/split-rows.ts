import type { DiffRow } from '../types'

export type SplitSide = { row: DiffRow; rowIndex: number }

export type SplitRow =
  | { kind: 'hunk'; row: DiffRow; rowIndex: number }
  | { kind: 'pair'; left: SplitSide | null; right: SplitSide | null }

// The old file on the left, the new one on the right: an unchanged line sits on both sides, and within a change each
// removed line faces the added line of the same rank, the longer side running on alone.
export function pairRowsSideBySide(rows: DiffRow[]): SplitRow[] {
  const splitRows: SplitRow[] = []
  let removedSides: SplitSide[] = []
  let addedSides: SplitSide[] = []
  const flushChange = () => {
    for (let rank = 0; rank < Math.max(removedSides.length, addedSides.length); rank += 1) {
      splitRows.push({ kind: 'pair', left: removedSides[rank] ?? null, right: addedSides[rank] ?? null })
    }
    removedSides = []
    addedSides = []
  }
  rows.forEach((row, rowIndex) => {
    if (row.kind === 'removed') {
      if (addedSides.length > 0) {
        flushChange()
      }
      removedSides.push({ row, rowIndex })
      return
    }
    if (row.kind === 'added') {
      addedSides.push({ row, rowIndex })
      return
    }
    flushChange()
    splitRows.push(
      row.kind === 'hunk' ? { kind: 'hunk', row, rowIndex } : { kind: 'pair', left: { row, rowIndex }, right: { row, rowIndex } },
    )
  })
  flushChange()

  return splitRows
}

export function splitIndexOfRow(splitRows: SplitRow[], rowIndex: number): number {
  return splitRows.findIndex(splitRow =>
    splitRow.kind === 'hunk'
      ? splitRow.rowIndex === rowIndex
      : splitRow.left?.rowIndex === rowIndex || splitRow.right?.rowIndex === rowIndex,
  )
}
