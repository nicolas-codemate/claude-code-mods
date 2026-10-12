export type HeaderTile =
  | { kind: 'count'; label: string; value: string }
  | { kind: 'lines'; label: string; addedLines: number; removedLines: number }
  | { kind: 'progress'; label: string; done: number; total: number }

export const LINES_TO_VIEW_TILE_LABEL = 'To view'

const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉']

// The terminal's progress bar: whole cells, then one cell filled by eighths, so it moves smoothly in a few cells.
export function progressBarCells(done: number, total: number, cells: number): { filled: string; rest: string } {
  const filledEighths = total > 0 ? Math.round((cells * 8 * Math.min(done, total)) / total) : 0
  const wholeCells = Math.floor(filledEighths / 8)
  const partialCell = EIGHTHS[filledEighths % 8] ?? ''
  const filled = '█'.repeat(wholeCells) + partialCell

  return { filled, rest: ' '.repeat(cells - wholeCells - (partialCell ? 1 : 0)) }
}
