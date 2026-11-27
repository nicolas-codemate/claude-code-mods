import { TAB_WIDTH } from '../constants'

export const MAXIMUM_OUTLINE_ENTRIES = 2000

// A longer line is minified code or data: no declaration worth listing starts there, and reading it with the
// declaration patterns would cost more than the rest of the file.
const MAXIMUM_READ_LINE_LENGTH = 1000

// Calls visit for each line short enough to read, numbered from 1, its line break and carriage return left out,
// until visit answers false.
export function forEachOutlineLine(text: string, visit: (lineText: string, line: number) => boolean): void {
  let line = 0
  for (let lineStart = 0; lineStart <= text.length; ) {
    line++
    const lineFeedIndex = text.indexOf('\n', lineStart)
    const afterLine = lineFeedIndex === -1 ? text.length : lineFeedIndex
    const lineEnd = afterLine > lineStart && text[afterLine - 1] === '\r' ? afterLine - 1 : afterLine
    if (lineEnd - lineStart <= MAXIMUM_READ_LINE_LENGTH && !visit(text.slice(lineStart, lineEnd), line)) {
      return
    }
    if (lineFeedIndex === -1) {
      return
    }
    lineStart = lineFeedIndex + 1
  }
}

// The column where the line's text starts, a tab reaching the next multiple of four.
export function indentationOfLine(lineText: string): number {
  let indentation = 0
  for (const character of lineText) {
    if (character === ' ') {
      indentation++
    } else if (character === '\t') {
      indentation += TAB_WIDTH - (indentation % TAB_WIDTH)
    } else {
      break
    }
  }

  return indentation
}

