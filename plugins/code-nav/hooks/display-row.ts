import type { SourceToken, TokenKind } from '../types'
import { TAB_WIDTH } from './constants'

// marked: the name the pane points at. match: an occurrence the list under the code is about.
export type HighlightKind = 'marked' | 'match'

export type ColumnRange = { startColumn: number; endColumn: number; kind: HighlightKind }

// Where a drawn line is cut: before, the start of the line is scrolled out of the pane on the left; after, its end
// does not fit on the right.
export type CutSide = 'before' | 'after'

// A stretch of one drawn line. blank is the whitespace between tokens. A navigable piece carries the column of its
// token in the line's own text, which a click sends back; a cut mark says on which side the line goes on.
export type DisplayPiece = {
  text: string
  kind: TokenKind | 'blank'
  navigableColumn: number | null
  highlight: HighlightKind | null
  cut: CutSide | null
}

export const TRUNCATION_MARK = '…'
export const SCROLLED_START_MARK = '‹'
// The gutter's mark before a line's number: the line pointed at, or a line bookmarked.
export const MARKED_LINE_SIGN = '▸'
export const BOOKMARK_SIGN = '◆'

// The name pointed at wins over a match on the same columns.
function highlightOver(startColumn: number, endColumn: number, highlights: readonly ColumnRange[]): HighlightKind | null {
  let found: HighlightKind | null = null
  for (const highlight of highlights) {
    if (highlight.startColumn < endColumn && highlight.endColumn > startColumn) {
      if (highlight.kind === 'marked') {
        return 'marked'
      }
      found = highlight.kind
    }
  }

  return found
}

// Cuts a stretch that is not clickable wherever a highlight starts or ends inside it, so a match found in the middle
// of a comment or a string is lit alone.
function piecesOfPlainStretch(
  lineText: string,
  startColumn: number,
  endColumn: number,
  kind: TokenKind | 'blank',
  highlights: readonly ColumnRange[],
): Array<{ startColumn: number; endColumn: number; kind: TokenKind | 'blank'; navigableColumn: null; highlight: HighlightKind | null }> {
  const cuts = new Set<number>([startColumn, endColumn])
  for (const highlight of highlights) {
    if (highlight.startColumn > startColumn && highlight.startColumn < endColumn) {
      cuts.add(highlight.startColumn)
    }
    if (highlight.endColumn > startColumn && highlight.endColumn < endColumn) {
      cuts.add(highlight.endColumn)
    }
  }
  const orderedCuts = [...cuts].sort((first, second) => first - second)
  const pieces = []
  for (let cutIndex = 0; cutIndex < orderedCuts.length - 1; cutIndex += 1) {
    const pieceStart = orderedCuts[cutIndex] ?? startColumn
    const pieceEnd = orderedCuts[cutIndex + 1] ?? endColumn
    if (lineText.slice(pieceStart, pieceEnd) !== '') {
      pieces.push({ startColumn: pieceStart, endColumn: pieceEnd, kind, navigableColumn: null, highlight: highlightOver(pieceStart, pieceStart + 1, highlights) })
    }
  }

  return pieces
}

// How many columns a line takes once drawn, its tabs widened.
export function drawnWidthOf(lineText: string): number {
  return expandedText(lineText, 0, lineText.length, 0).length
}

function expandedText(lineText: string, startColumn: number, endColumn: number, drawnColumnsBefore: number): string {
  let expanded = ''
  for (const character of lineText.slice(startColumn, endColumn)) {
    if (character === '\t') {
      expanded += ' '.repeat(TAB_WIDTH - ((drawnColumnsBefore + expanded.length) % TAB_WIDTH))
    } else if (character !== '\r') {
      expanded += character
    }
  }

  return expanded
}

// One line of the file as the pane draws it: tabs widened to the next stop, neighbours that draw alike merged into
// one piece, the columns scrolled out on the left left out behind a mark, and the line cut with a mark where the pane
// ends.
export function displayRowOf(
  lineText: string,
  tokens: readonly SourceToken[],
  highlights: readonly ColumnRange[],
  availableColumns: number,
  scrolledColumns = 0,
): DisplayPiece[] {
  const stretches: Array<{ startColumn: number; endColumn: number; kind: TokenKind | 'blank'; navigableColumn: number | null; highlight: HighlightKind | null }> = []
  let column = 0
  for (const token of tokens) {
    if (token.startColumn < column || token.endColumn <= token.startColumn) {
      continue
    }
    if (token.startColumn > column) {
      stretches.push(...piecesOfPlainStretch(lineText, column, token.startColumn, 'blank', highlights))
    }
    if (token.isNavigable) {
      stretches.push({
        startColumn: token.startColumn,
        endColumn: token.endColumn,
        kind: token.kind,
        navigableColumn: token.startColumn,
        highlight: highlightOver(token.startColumn, token.endColumn, highlights),
      })
    } else {
      stretches.push(...piecesOfPlainStretch(lineText, token.startColumn, token.endColumn, token.kind, highlights))
    }
    column = token.endColumn
  }
  if (column < lineText.length) {
    stretches.push(...piecesOfPlainStretch(lineText, column, lineText.length, 'blank', highlights))
  }

  const pieces: DisplayPiece[] = []
  let drawnColumns = 0
  // The scrolled-start mark takes the place of the first column left in sight.
  let hiddenColumns = 0
  if (scrolledColumns > 0 && drawnWidthOf(lineText) > scrolledColumns) {
    pieces.push({ text: SCROLLED_START_MARK, kind: 'comment', navigableColumn: null, highlight: null, cut: 'before' })
    drawnColumns = SCROLLED_START_MARK.length
    hiddenColumns = scrolledColumns + SCROLLED_START_MARK.length
  } else if (scrolledColumns > 0) {
    return pieces
  }
  let lineColumns = 0
  for (const stretch of stretches) {
    const wholeText = expandedText(lineText, stretch.startColumn, stretch.endColumn, lineColumns)
    const text = wholeText.slice(Math.max(0, hiddenColumns - lineColumns))
    lineColumns += wholeText.length
    if (text === '') {
      continue
    }
    const roomLeft = availableColumns - drawnColumns
    if (text.length > roomLeft) {
      const keptText = text.slice(0, Math.max(0, roomLeft - 1))
      if (keptText !== '') {
        pieces.push({ text: keptText, kind: stretch.kind, navigableColumn: stretch.navigableColumn, highlight: stretch.highlight, cut: null })
      } else if (roomLeft <= 0) {
        // What is already drawn fills the row: its last character gives its place to the mark.
        const lastPiece = pieces[pieces.length - 1]
        if (lastPiece !== undefined) {
          lastPiece.text = lastPiece.text.slice(0, -1)
          if (lastPiece.text === '') {
            pieces.pop()
          }
        }
      }
      pieces.push({ text: TRUNCATION_MARK, kind: 'comment', navigableColumn: null, highlight: null, cut: 'after' })
      break
    }
    const previousPiece = pieces[pieces.length - 1]
    const isMergedWithPrevious =
      previousPiece !== undefined &&
      previousPiece.navigableColumn === null &&
      previousPiece.cut === null &&
      stretch.navigableColumn === null &&
      previousPiece.highlight === stretch.highlight &&
      (previousPiece.kind === stretch.kind || stretch.kind === 'blank')
    if (isMergedWithPrevious) {
      previousPiece.text += text
    } else {
      pieces.push({ text, kind: stretch.kind, navigableColumn: stretch.navigableColumn, highlight: stretch.highlight, cut: null })
    }
    drawnColumns += text.length
  }

  return pieces
}
