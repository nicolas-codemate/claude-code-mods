import { BOOKMARK_SIGN, MARKED_LINE_SIGN, SCROLLED_START_MARK, TRUNCATION_MARK } from './display-row'

export type SelectedLines = { startLine: number; endLine: number }

export type ShownLineRange = { firstLine: number; lastLine: number }

// "12" for one line, "12-15" for a run of them.
export function lineRangeOf(selectedLines: SelectedLines): string {
  return selectedLines.startLine === selectedLines.endLine ? `${selectedLines.startLine}` : `${selectedLines.startLine}-${selectedLines.endLine}`
}

export function linesWordOf(selectedLines: SelectedLines): string {
  return selectedLines.startLine === selectedLines.endLine ? 'line' : 'lines'
}

// A row of the code as the terminal copies it: the gutter's mark of the line pointed at or of a bookmark, its number,
// then the code, behind a mark when the code is scrolled sideways.
const ROW_WITH_GUTTER = new RegExp(`^\\s*[${MARKED_LINE_SIGN}${BOOKMARK_SIGN}]?\\s*(\\d+)(?: ${SCROLLED_START_MARK}?(.*))?$`)
// The mouse selects whole rows of the screen: a row past the first carries the columns beside the code too, the
// tabs on its left and pinned files on its right, each behind this border.
const COLUMN_BORDER = '│'
// A selection of a few characters with no line number is found back in the code shown only when it says enough to
// tell one line from another.
const SHORTEST_TEXT_LOOKED_FOR = 3

function normalized(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

// Drawn rows have their tabs widened and a line too long for the pane cut with a mark: what is left of the row must
// still be written in the line.
function isWrittenIn(rowText: string, lineText: string): boolean {
  const kept = normalized(rowText.endsWith(TRUNCATION_MARK) ? rowText.slice(0, -TRUNCATION_MARK.length) : rowText)

  return kept === '' || normalized(lineText).includes(kept)
}

function isWithin(selectedLines: SelectedLines, shownRange: ShownLineRange): boolean {
  return selectedLines.startLine >= shownRange.firstLine && selectedLines.endLine <= shownRange.lastLine
}

// The lines of the file shown that the text the person selected in the pane covers, read from the line numbers the
// selection carries, else found back among the lines shown. Null when the selection is not code of this file shown
// in the pane: text of the conversation, of another column, of a preview of another file.
export function selectedLinesIn(selectionText: string, lines: readonly string[], shownRange: ShownLineRange): SelectedLines | null {
  const rows = selectionText.split('\n').map(row => row.replace(/\s+$/, ''))
  while (rows.length > 0 && rows[0] === '') {
    rows.shift()
  }
  while (rows.length > 0 && rows[rows.length - 1] === '') {
    rows.pop()
  }
  if (rows.length === 0) {
    return null
  }
  const numberedRows = rows.map(row => numberedRowOf(row, lines))
  const anchorIndex = numberedRows.findIndex(numberedRow => numberedRow !== null)
  const anchor = numberedRows[anchorIndex]
  if (anchor === null || anchor === undefined) {
    return selectedLineFoundAmongShown(rows, lines, shownRange)
  }
  const startLine = anchor.lineNumber - anchorIndex
  const selectedLines = { startLine, endLine: startLine + rows.length - 1 }
  const isEveryRowItsLine = rows.every((row, rowIndex) => {
    const lineText = lines[startLine + rowIndex - 1]
    const numberedRow = numberedRows[rowIndex]
    if (lineText === undefined) {
      return false
    }
    if (numberedRow === null || numberedRow === undefined) {
      return rowIndex === 0 && isWrittenIn(row.split(COLUMN_BORDER)[0] ?? '', lineText)
    }

    return numberedRow.lineNumber === startLine + rowIndex && isWrittenIn(numberedRow.code, lineText)
  })

  return isEveryRowItsLine && isWithin(selectedLines, shownRange) ? selectedLines : null
}

// The part of a selected row that is a line of the file with its number, whichever column of the screen it sits in.
function numberedRowOf(row: string, lines: readonly string[]): { lineNumber: number; code: string } | null {
  for (const part of row.split(COLUMN_BORDER)) {
    const match = ROW_WITH_GUTTER.exec(part)
    if (match === null) {
      continue
    }
    const lineNumber = Number(match[1])
    const code = match[2] ?? ''
    const lineText = lines[lineNumber - 1]
    if (lineText !== undefined && isWrittenIn(code, lineText)) {
      return { lineNumber, code }
    }
  }

  return null
}

function selectedLineFoundAmongShown(rows: readonly string[], lines: readonly string[], shownRange: ShownLineRange): SelectedLines | null {
  const [row] = rows
  if (rows.length !== 1 || row === undefined || normalized(row).length < SHORTEST_TEXT_LOOKED_FOR) {
    return null
  }
  const holdingLines: number[] = []
  for (let lineNumber = shownRange.firstLine; lineNumber <= Math.min(shownRange.lastLine, lines.length); lineNumber += 1) {
    if (isWrittenIn(row, lines[lineNumber - 1] ?? '')) {
      holdingLines.push(lineNumber)
    }
  }
  const [onlyLine] = holdingLines

  return holdingLines.length === 1 && onlyLine !== undefined ? { startLine: onlyLine, endLine: onlyLine } : null
}

