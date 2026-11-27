import type { SourceToken, TokenKind } from '../../types'

export const TAB = 9
export const NEWLINE = 10
export const VERTICAL_TAB = 11
export const FORM_FEED = 12
export const CARRIAGE_RETURN = 13
export const SPACE = 32
export const EXCLAMATION_MARK = 33
export const DOUBLE_QUOTE = 34
export const HASH = 35
export const DOLLAR = 36
export const PERCENT = 37
export const AMPERSAND = 38
export const SINGLE_QUOTE = 39
export const OPENING_PARENTHESIS = 40
export const CLOSING_PARENTHESIS = 41
export const STAR = 42
export const PLUS = 43
export const COMMA = 44
export const MINUS = 45
export const DOT = 46
export const SLASH = 47
export const COLON = 58
export const SEMICOLON = 59
export const LESS_THAN = 60
export const EQUALS = 61
export const GREATER_THAN = 62
export const QUESTION_MARK = 63
export const AT_SIGN = 64
export const OPENING_SQUARE = 91
export const BACKSLASH = 92
export const CLOSING_SQUARE = 93
export const CARET = 94
export const BACKTICK = 96
export const OPENING_BRACE = 123
export const PIPE = 124
export const CLOSING_BRACE = 125
export const TILDE = 126

const UPPERCASE_A = 65
const UPPERCASE_Z = 90
const LOWERCASE_A = 97
const LOWERCASE_E = 101
const LOWERCASE_X = 120
const LOWERCASE_Z = 122
const UNDERSCORE = 95
const DIGIT_ZERO = 48
const DIGIT_NINE = 57
const FIRST_NON_ASCII = 128

export function isWhitespaceCode(code: number): boolean {
  return (
    code === SPACE ||
    code === NEWLINE ||
    code === TAB ||
    code === CARRIAGE_RETURN ||
    code === FORM_FEED ||
    code === VERTICAL_TAB
  )
}

export function isInlineWhitespaceCode(code: number): boolean {
  return code === SPACE || code === TAB
}

export function isDigitCode(code: number): boolean {
  return code >= DIGIT_ZERO && code <= DIGIT_NINE
}

export function isUppercaseCode(code: number): boolean {
  return code >= UPPERCASE_A && code <= UPPERCASE_Z
}

// A letter of any alphabet may start a name: every character beyond ASCII counts as one.
export function isNameStartCode(code: number): boolean {
  return (
    (code >= LOWERCASE_A && code <= LOWERCASE_Z) ||
    (code >= UPPERCASE_A && code <= UPPERCASE_Z) ||
    code === UNDERSCORE ||
    code >= FIRST_NON_ASCII
  )
}

export function isNamePartCode(code: number): boolean {
  return isNameStartCode(code) || (code >= DIGIT_ZERO && code <= DIGIT_NINE)
}

export function offsetAfterWhitespace(text: string, offset: number, end: number): number {
  while (offset < end && isWhitespaceCode(text.charCodeAt(offset))) {
    offset++
  }

  return offset
}

export function offsetAfterInlineWhitespace(text: string, offset: number, end: number): number {
  while (offset < end && isInlineWhitespaceCode(text.charCodeAt(offset))) {
    offset++
  }

  return offset
}

export function offsetAfterName(text: string, offset: number, end: number): number {
  while (offset < end && isNamePartCode(text.charCodeAt(offset))) {
    offset++
  }

  return offset
}

// The end of the line holding the offset: the offset of its "\n", or the end of the range.
export function offsetOfLineEnd(text: string, offset: number, end: number): number {
  const newlineOffset = text.indexOf('\n', offset)

  return newlineOffset === -1 || newlineOffset > end ? end : newlineOffset
}

// A number runs over its digits, its separators, its base prefix and its unit or suffix letters ("0x1F", "1_000",
// "1.5e-3", "10px", "12n"), so that no name starts in the middle of it.
export function offsetAfterNumber(text: string, offset: number, end: number): number {
  const isHexadecimal = text.charCodeAt(offset) === DIGIT_ZERO && (text.charCodeAt(offset + 1) | 32) === LOWERCASE_X
  while (offset < end) {
    const code = text.charCodeAt(offset)
    if (isNamePartCode(code)) {
      offset++
    } else if (code === DOT && isDigitCode(text.charCodeAt(offset + 1))) {
      offset += 2
    } else if (
      (code === PLUS || code === MINUS) &&
      !isHexadecimal &&
      (text.charCodeAt(offset - 1) | 32) === LOWERCASE_E &&
      isDigitCode(text.charCodeAt(offset + 1))
    ) {
      offset += 2
    } else {
      break
    }
  }

  return Math.min(offset, end)
}

// The offset after the closing quote of the string opened at the offset, a backslash escaping the next character.
// A string that may not span lines and is left open stops at the end of its line.
export function offsetAfterQuotedString(text: string, offset: number, end: number, spansLines: boolean): number {
  const quoteCode = text.charCodeAt(offset)
  offset++
  while (offset < end) {
    const code = text.charCodeAt(offset)
    if (code === BACKSLASH) {
      offset += 2
    } else if (code === quoteCode) {
      return offset + 1
    } else if (code === NEWLINE && !spansLines) {
      return offset
    } else {
      offset++
    }
  }

  return end
}

// The offset after the closing "*/" of a block comment, or the end of the range when it is left open.
export function offsetAfterBlockComment(text: string, offset: number, end: number): number {
  const closingOffset = text.indexOf('*/', offset + 2)

  return closingOffset === -1 || closingOffset + 2 > end ? end : closingOffset + 2
}

// Two neighbours of these kinds that touch are drawn the same way, so they are kept as one piece.
const IS_MERGED_WITH_TOUCHING_NEIGHBOUR: Readonly<Record<TokenKind, boolean>> = {
  keyword: false,
  name: false,
  variable: false,
  typeName: false,
  callName: false,
  property: false,
  string: false,
  comment: true,
  number: false,
  punctuation: true,
  tag: false,
  attribute: false,
  text: true,
}

export type TokenCollector = {
  // Offsets index the whole text. A piece spanning several lines is cut at each line end, and every piece loses the
  // whitespace around it. Pieces are given in the order of the text; what would overlap the previous one is dropped.
  add: (startOffset: number, endOffset: number, kind: TokenKind, isNavigable: boolean) => void
  tokensByLine: SourceToken[][]
}

export function createTokenCollector(text: string): TokenCollector {
  const lineStartOffsets = [0]
  let newlineOffset = text.indexOf('\n')
  while (newlineOffset !== -1) {
    lineStartOffsets.push(newlineOffset + 1)
    newlineOffset = text.indexOf('\n', newlineOffset + 1)
  }
  const tokensByLine: SourceToken[][] = lineStartOffsets.map(() => [])
  let lineIndex = 0
  let lineStartOffset = 0
  let nextLineStartOffset = lineStartOffsets[1] ?? text.length + 1
  let lineTokens: SourceToken[] = tokensByLine[0] ?? []
  let coveredUntilOffset = 0

  function moveToNextLine(): void {
    lineIndex++
    lineStartOffset = nextLineStartOffset
    nextLineStartOffset = lineStartOffsets[lineIndex + 1] ?? text.length + 1
    lineTokens = tokensByLine[lineIndex] ?? []
  }

  function addWithinCurrentLine(startOffset: number, endOffset: number, kind: TokenKind, isNavigable: boolean): void {
    while (startOffset < endOffset && isWhitespaceCode(text.charCodeAt(startOffset))) {
      startOffset++
    }
    while (endOffset > startOffset && isWhitespaceCode(text.charCodeAt(endOffset - 1))) {
      endOffset--
    }
    if (startOffset >= endOffset) {
      return
    }
    const startColumn = startOffset - lineStartOffset
    const previousToken = lineTokens[lineTokens.length - 1]
    if (
      previousToken !== undefined &&
      previousToken.endColumn === startColumn &&
      previousToken.kind === kind &&
      IS_MERGED_WITH_TOUCHING_NEIGHBOUR[kind] &&
      !isNavigable &&
      !previousToken.isNavigable
    ) {
      previousToken.endColumn = endOffset - lineStartOffset
      return
    }
    lineTokens.push({ startColumn, endColumn: endOffset - lineStartOffset, kind, isNavigable })
  }

  function add(startOffset: number, endOffset: number, kind: TokenKind, isNavigable: boolean): void {
    if (startOffset < coveredUntilOffset) {
      startOffset = coveredUntilOffset
    }
    if (endOffset > text.length) {
      endOffset = text.length
    }
    if (startOffset >= endOffset) {
      return
    }
    coveredUntilOffset = endOffset
    while (startOffset >= nextLineStartOffset) {
      moveToNextLine()
    }
    while (endOffset > nextLineStartOffset) {
      addWithinCurrentLine(startOffset, nextLineStartOffset - 1, kind, isNavigable)
      moveToNextLine()
      startOffset = lineStartOffset
    }
    addWithinCurrentLine(startOffset, endOffset, kind, isNavigable)
  }

  return { add, tokensByLine }
}
