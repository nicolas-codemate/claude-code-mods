export type LineAndColumn = { line: number; column: number }

export function lineStartOffsetsOf(text: string): number[] {
  const lineStartOffsets = [0]
  let lineBreakOffset = text.indexOf('\n')
  while (lineBreakOffset !== -1) {
    lineStartOffsets.push(lineBreakOffset + 1)
    lineBreakOffset = text.indexOf('\n', lineBreakOffset + 1)
  }

  return lineStartOffsets
}

// The 1-based line and 0-based column of an offset.
export function lineAndColumnOfOffset(lineStartOffsets: readonly number[], offset: number): LineAndColumn {
  let low = 0
  let high = lineStartOffsets.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if ((lineStartOffsets[middle] ?? 0) <= offset) {
      low = middle
    } else {
      high = middle - 1
    }
  }

  return { line: low + 1, column: offset - (lineStartOffsets[low] ?? 0) }
}

// Null when the line does not exist.
export function offsetOfLineAndColumn(lineStartOffsets: readonly number[], line: number, column: number): number | null {
  const lineStartOffset = lineStartOffsets[line - 1]

  return lineStartOffset === undefined ? null : lineStartOffset + Math.max(0, column)
}

export function lineTextAt(text: string, lineStartOffsets: readonly number[], line: number): string {
  const lineStartOffset = lineStartOffsets[line - 1]
  if (lineStartOffset === undefined) {
    return ''
  }
  const nextLineStartOffset = lineStartOffsets[line]
  const lineText =
    nextLineStartOffset === undefined ? text.slice(lineStartOffset) : text.slice(lineStartOffset, nextLineStartOffset - 1)

  return lineText.endsWith('\r') ? lineText.slice(0, -1) : lineText
}
