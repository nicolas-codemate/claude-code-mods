import type { SourceToken } from '../../types'
import { isNamePartCode, isWhitespaceCode } from './scanning'

// What must hold for the tokens of any text, whatever its language: one array per line; on each line the tokens are
// in order, do not overlap and stay inside the line; none starts or ends on whitespace nor in the middle of a word;
// every character that is not whitespace belongs to a token. Returns one sentence per breach, none when all holds.
export function tokenInvariantBreaches(text: string, tokensByLine: SourceToken[][]): string[] {
  const lines = text.split('\n')
  const breaches: string[] = []
  if (tokensByLine.length !== lines.length) {
    breaches.push(`${tokensByLine.length} arrays of tokens for ${lines.length} lines`)
  }
  lines.forEach((line, lineIndex) => {
    const where = `line ${lineIndex + 1}`
    let previousEndColumn = 0
    for (const token of tokensByLine[lineIndex] ?? []) {
      const tokenText = line.slice(token.startColumn, token.endColumn)
      const what = `${where}: ${token.kind} "${tokenText}" at ${token.startColumn}-${token.endColumn}`
      if (token.startColumn < 0 || token.endColumn > line.length || token.startColumn >= token.endColumn) {
        breaches.push(`${what} is empty or outside its line of ${line.length} characters`)
        continue
      }
      if (token.startColumn < previousEndColumn) {
        breaches.push(`${what} starts before the previous token ends at ${previousEndColumn}`)
      }
      const firstCode = line.charCodeAt(token.startColumn)
      const lastCode = line.charCodeAt(token.endColumn - 1)
      if (isWhitespaceCode(firstCode) || isWhitespaceCode(lastCode)) {
        breaches.push(`${what} starts or ends on whitespace`)
      }
      if (cutsAWord(line, token.startColumn) || cutsAWord(line, token.endColumn)) {
        breaches.push(`${what} starts or ends in the middle of a word`)
      }
      const uncoveredColumn = columnOfFirstCharacterBetween(line, previousEndColumn, token.startColumn)
      if (uncoveredColumn !== -1) {
        breaches.push(`${where}: the character at ${uncoveredColumn} belongs to no token`)
      }
      previousEndColumn = Math.max(previousEndColumn, token.endColumn)
    }
    const uncoveredColumn = columnOfFirstCharacterBetween(line, previousEndColumn, line.length)
    if (uncoveredColumn !== -1) {
      breaches.push(`${where}: the character at ${uncoveredColumn} belongs to no token`)
    }
  })

  return breaches
}

function cutsAWord(line: string, column: number): boolean {
  return (
    column > 0 &&
    column < line.length &&
    isNamePartCode(line.charCodeAt(column - 1)) &&
    isNamePartCode(line.charCodeAt(column))
  )
}

function columnOfFirstCharacterBetween(line: string, startColumn: number, endColumn: number): number {
  for (let column = startColumn; column < endColumn; column++) {
    if (!isWhitespaceCode(line.charCodeAt(column))) {
      return column
    }
  }

  return -1
}
