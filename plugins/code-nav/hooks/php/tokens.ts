import { lineStartOffsetsOf } from '../text-position'

export type PhpTokenKind = 'name' | 'variable' | 'string' | 'number' | 'punctuation'

export type PhpComment = { text: string; start: number; end: number; isDocblock: boolean }

// A name keeps its namespace separators ("App\Entity\Order" is one token); a string is one token, quotes included.
export type PhpToken = {
  kind: PhpTokenKind
  text: string
  start: number
  end: number
  // The docblock written between the previous token and this one.
  leadingDocblock: PhpComment | null
}

export type PhpTokenizedSource = {
  text: string
  tokens: PhpToken[]
  comments: PhpComment[]
  // For a bracket, the index of the token closing or opening it; -1 for any other token or a bracket left alone.
  matchingBracketIndexes: number[]
  lineStartOffsets: number[]
}

const BACKSLASH = 92
const DOLLAR = 36
const SINGLE_QUOTE = 39
const DOUBLE_QUOTE = 34
const BACKTICK = 96
const NEWLINE = 10
const SLASH = 47
const STAR = 42
const HASH = 35
const OPENING_SQUARE = 91
const OPENING_BRACE = 123
const CLOSING_BRACE = 125
const QUESTION_MARK = 63
const GREATER_THAN = 62
const LESS_THAN = 60
const DOT = 46

const THREE_CHARACTER_OPERATORS = new Set(['===', '!==', '<=>', '**=', '...', '<<=', '>>=', '??=', '?->'])
const TWO_CHARACTER_OPERATORS = new Set([
  '->', '::', '=>', '==', '!=', '<>', '<=', '>=', '&&', '||', '??', '++', '--', '+=', '-=', '*=', '/=', '.=', '%=', '&=', '|=',
  '^=', '<<', '>>', '**', '#[',
])
const OPENING_BRACKETS = new Set(['(', '[', '{', '#['])
const CLOSING_BRACKETS = new Set([')', ']', '}'])

function isNameStart(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95 || code >= 128
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57
}

function isNamePart(code: number): boolean {
  return isNameStart(code) || isDigit(code)
}

function isWhitespace(code: number): boolean {
  return code === 32 || code === 9 || code === NEWLINE || code === 13
}

export function tokenIndexAtOffset(tokens: readonly PhpToken[], offset: number): number {
  let low = 0
  let high = tokens.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const token = tokens[middle]
    if (token === undefined) {
      return -1
    }
    if (offset < token.start) {
      high = middle - 1
    } else if (offset >= token.end) {
      low = middle + 1
    } else {
      return middle
    }
  }

  return -1
}

export function commentAtOffset(comments: readonly PhpComment[], offset: number): PhpComment | null {
  let low = 0
  let high = comments.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const comment = comments[middle]
    if (comment === undefined) {
      return null
    }
    if (offset < comment.start) {
      high = middle - 1
    } else if (offset >= comment.end) {
      low = middle + 1
    } else {
      return comment
    }
  }

  return null
}

function endOfQuotedString(text: string, start: number, quote: number): number {
  const isInterpolating = quote !== SINGLE_QUOTE
  let offset = start + 1
  while (offset < text.length) {
    const code = text.charCodeAt(offset)
    if (code === BACKSLASH) {
      offset += 2
      continue
    }
    if (code === quote) {
      return offset + 1
    }
    if (isInterpolating && code === OPENING_BRACE && text.charCodeAt(offset + 1) === DOLLAR) {
      offset = endOfInterpolatedExpression(text, offset)
      continue
    }
    offset += 1
  }

  return text.length
}

// "{$order->lines['first']}" inside a double-quoted string: the braces may hold quotes of their own.
function endOfInterpolatedExpression(text: string, openingBraceOffset: number): number {
  let depth = 0
  let offset = openingBraceOffset
  while (offset < text.length) {
    const code = text.charCodeAt(offset)
    if (code === OPENING_BRACE) {
      depth += 1
    } else if (code === CLOSING_BRACE) {
      depth -= 1
      if (depth === 0) {
        return offset + 1
      }
    } else if (code === SINGLE_QUOTE) {
      offset = endOfQuotedString(text, offset, SINGLE_QUOTE)
      continue
    } else if (code === NEWLINE) {
      return offset
    }
    offset += 1
  }

  return text.length
}

function endOfHeredoc(text: string, start: number): number {
  let offset = start + 3
  while (text.charCodeAt(offset) === 32 || text.charCodeAt(offset) === 9) {
    offset += 1
  }
  const openingQuote = text.charCodeAt(offset)
  if (openingQuote === SINGLE_QUOTE || openingQuote === DOUBLE_QUOTE) {
    offset += 1
  }
  const labelStart = offset
  while (isNamePart(text.charCodeAt(offset))) {
    offset += 1
  }
  const label = text.slice(labelStart, offset)
  if (label === '') {
    return start + 3
  }
  let lineBreakOffset = text.indexOf('\n', offset)
  while (lineBreakOffset !== -1) {
    let lineOffset = lineBreakOffset + 1
    while (text.charCodeAt(lineOffset) === 32 || text.charCodeAt(lineOffset) === 9) {
      lineOffset += 1
    }
    if (text.startsWith(label, lineOffset) && !isNamePart(text.charCodeAt(lineOffset + label.length))) {
      return lineOffset + label.length
    }
    lineBreakOffset = text.indexOf('\n', lineBreakOffset + 1)
  }

  return text.length
}

function endOfLineComment(text: string, start: number): number {
  const lineBreakOffset = text.indexOf('\n', start)
  const lineEnd = lineBreakOffset === -1 ? text.length : lineBreakOffset
  const closingTagOffset = text.indexOf('?>', start)

  return closingTagOffset !== -1 && closingTagOffset < lineEnd ? closingTagOffset : lineEnd
}

function startOfPhpCode(text: string, from: number): number {
  let openingTagOffset = text.indexOf('<?', from)
  while (openingTagOffset !== -1) {
    if (text.startsWith('<?php', openingTagOffset)) {
      return openingTagOffset + 5
    }
    if (text.startsWith('<?=', openingTagOffset)) {
      return openingTagOffset + 3
    }
    openingTagOffset = text.indexOf('<?', openingTagOffset + 2)
  }

  return text.length
}

function endOfNumber(text: string, start: number): number {
  let offset = start
  while (offset < text.length) {
    const code = text.charCodeAt(offset)
    if (isNamePart(code) || (code === DOT && isDigit(text.charCodeAt(offset + 1)))) {
      offset += 1
    } else {
      break
    }
  }

  return offset
}

function endOfName(text: string, start: number): number {
  let offset = start
  while (offset < text.length) {
    const code = text.charCodeAt(offset)
    if (isNamePart(code)) {
      offset += 1
    } else if (code === BACKSLASH && (isNameStart(text.charCodeAt(offset + 1)) || text.charCodeAt(offset + 1) === OPENING_BRACE)) {
      offset += 1
    } else {
      break
    }
  }

  return offset
}

function matchBrackets(tokens: readonly PhpToken[]): number[] {
  const matchingBracketIndexes = new Array<number>(tokens.length).fill(-1)
  const openBracketIndexes: number[] = []
  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    const token = tokens[tokenIndex]
    if (token === undefined || token.kind !== 'punctuation') {
      continue
    }
    if (OPENING_BRACKETS.has(token.text)) {
      openBracketIndexes.push(tokenIndex)
    } else if (CLOSING_BRACKETS.has(token.text)) {
      const openingIndex = openBracketIndexes.pop()
      if (openingIndex !== undefined) {
        matchingBracketIndexes[openingIndex] = tokenIndex
        matchingBracketIndexes[tokenIndex] = openingIndex
      }
    }
  }

  return matchingBracketIndexes
}

export function tokenizePhp(text: string): PhpTokenizedSource {
  const tokens: PhpToken[] = []
  const comments: PhpComment[] = []
  let pendingDocblock: PhpComment | null = null
  let offset = startOfPhpCode(text, 0)

  const pushToken = (kind: PhpTokenKind, start: number, end: number) => {
    tokens.push({ kind, text: text.slice(start, end), start, end, leadingDocblock: pendingDocblock })
    pendingDocblock = null
  }

  while (offset < text.length) {
    const code = text.charCodeAt(offset)
    if (isWhitespace(code)) {
      offset += 1
      continue
    }
    const nextCode = text.charCodeAt(offset + 1)
    if (code === QUESTION_MARK && nextCode === GREATER_THAN) {
      offset = startOfPhpCode(text, offset + 2)
      continue
    }
    if ((code === SLASH && nextCode === SLASH) || (code === HASH && nextCode !== OPENING_SQUARE)) {
      const end = endOfLineComment(text, offset)
      comments.push({ text: text.slice(offset, end), start: offset, end, isDocblock: false })
      offset = end
      continue
    }
    if (code === SLASH && nextCode === STAR) {
      const closingOffset = text.indexOf('*/', offset + 2)
      const end = closingOffset === -1 ? text.length : closingOffset + 2
      const isDocblock = text.charCodeAt(offset + 2) === STAR && end - offset > 4
      const comment = { text: text.slice(offset, end), start: offset, end, isDocblock }
      comments.push(comment)
      if (isDocblock) {
        pendingDocblock = comment
      }
      offset = end
      continue
    }
    if (code === DOLLAR && isNameStart(nextCode)) {
      const end = endOfName(text, offset + 1)
      pushToken('variable', offset, end)
      offset = end
      continue
    }
    if (isNameStart(code) || (code === BACKSLASH && isNameStart(nextCode))) {
      const end = endOfName(text, offset + 1)
      pushToken('name', offset, end)
      offset = end
      continue
    }
    if (isDigit(code)) {
      const end = endOfNumber(text, offset)
      pushToken('number', offset, end)
      offset = end
      continue
    }
    if (code === SINGLE_QUOTE || code === DOUBLE_QUOTE || code === BACKTICK) {
      const end = endOfQuotedString(text, offset, code)
      pushToken('string', offset, end)
      offset = end
      continue
    }
    if (code === LESS_THAN && nextCode === LESS_THAN && text.charCodeAt(offset + 2) === LESS_THAN) {
      const end = endOfHeredoc(text, offset)
      pushToken('string', offset, end)
      offset = end
      continue
    }
    const operatorLength = THREE_CHARACTER_OPERATORS.has(text.slice(offset, offset + 3))
      ? 3
      : TWO_CHARACTER_OPERATORS.has(text.slice(offset, offset + 2))
        ? 2
        : 1
    pushToken('punctuation', offset, offset + operatorLength)
    offset += operatorLength
  }

  return { text, tokens, comments, matchingBracketIndexes: matchBrackets(tokens), lineStartOffsets: lineStartOffsetsOf(text) }
}
