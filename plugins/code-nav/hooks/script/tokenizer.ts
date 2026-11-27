// markupName: a lower-case tag or an attribute name of JSX, which names no declaration.
export type ScriptTokenKind =
  'identifier' | 'number' | 'string' | 'template' | 'regularExpression' | 'punctuation' | 'markupName'

// start and end are offsets into the whole text. A template literal is cut into its text chunks (kind template),
// each substitution between them read as code inside a "${" and "}" pair of punctuation tokens.
export type ScriptToken = {
  kind: ScriptTokenKind
  text: string
  start: number
  end: number
  followsLineBreak: boolean
}

export type TokenizerOptions = {
  // The text holds JSX (.tsx, .jsx): a "<" where an expression may start opens an element.
  hasMarkup?: boolean
  start?: number
  end?: number
  // Tokens already read from an earlier part of the same text, which the new ones follow.
  tokensBefore?: ScriptToken[]
}

const KEYWORDS_BEFORE_AN_EXPRESSION = new Set([
  'return', 'typeof', 'case', 'in', 'of', 'delete', 'void', 'throw', 'new', 'else', 'do', 'instanceof', 'yield',
  'await', 'default',
])

const CODE_TAB = 9
const CODE_LINE_FEED = 10
const CODE_CARRIAGE_RETURN = 13
const CODE_SPACE = 32
const CODE_EXCLAMATION = 33
const CODE_DOUBLE_QUOTE = 34
const CODE_HASH = 35
const CODE_DOLLAR = 36
const CODE_PERCENT = 37
const CODE_AMPERSAND = 38
const CODE_SINGLE_QUOTE = 39
const CODE_ASTERISK = 42
const CODE_PLUS = 43
const CODE_MINUS = 45
const CODE_DOT = 46
const CODE_SLASH = 47
const CODE_LESS_THAN = 60
const CODE_EQUALS = 61
const CODE_GREATER_THAN = 62
const CODE_QUESTION = 63
const CODE_BACKSLASH = 92
const CODE_OPENING_BRACKET = 91
const CODE_CLOSING_BRACKET = 93
const CODE_CARET = 94
const CODE_BACKTICK = 96
const CODE_OPENING_BRACE = 123
const CODE_PIPE = 124
const CODE_CLOSING_BRACE = 125

function isIdentifierStartCode(code: number): boolean {
  return (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || code === 95 || code === CODE_DOLLAR || code > 127
}

function isDigitCode(code: number): boolean {
  return code >= 48 && code <= 57
}

function isIdentifierPartCode(code: number): boolean {
  return isIdentifierStartCode(code) || isDigitCode(code)
}

function isWhitespaceCode(code: number): boolean {
  return (
    code === CODE_SPACE ||
    code === CODE_TAB ||
    code === CODE_LINE_FEED ||
    code === CODE_CARRIAGE_RETURN ||
    code === 0xa0 ||
    code === 0xfeff
  )
}

// The length of the operator that starts here. "<<" and ">>" stay two tokens: the second closes type arguments
// ("Map<string, Array<number>>") far more often than it shifts bits.
function operatorLengthAt(text: string, position: number, code: number): number {
  const nextCode = text.charCodeAt(position + 1)
  const isFollowedByEquals = nextCode === CODE_EQUALS
  switch (code) {
    case CODE_DOT:
      return nextCode === CODE_DOT && text.charCodeAt(position + 2) === CODE_DOT ? 3 : 1
    case CODE_EQUALS:
      if (isFollowedByEquals) {
        return text.charCodeAt(position + 2) === CODE_EQUALS ? 3 : 2
      }
      return nextCode === CODE_GREATER_THAN ? 2 : 1
    case CODE_EXCLAMATION:
      if (isFollowedByEquals) {
        return text.charCodeAt(position + 2) === CODE_EQUALS ? 3 : 2
      }
      return 1
    case CODE_QUESTION:
      if (nextCode === CODE_QUESTION) {
        return text.charCodeAt(position + 2) === CODE_EQUALS ? 3 : 2
      }
      return nextCode === CODE_DOT && !isDigitCode(text.charCodeAt(position + 2)) ? 2 : 1
    case CODE_AMPERSAND:
    case CODE_PIPE:
    case CODE_ASTERISK:
      if (nextCode === code) {
        return text.charCodeAt(position + 2) === CODE_EQUALS ? 3 : 2
      }
      return isFollowedByEquals ? 2 : 1
    case CODE_PLUS:
    case CODE_MINUS:
      return nextCode === code || isFollowedByEquals ? 2 : 1
    case CODE_LESS_THAN:
    case CODE_GREATER_THAN:
    case CODE_SLASH:
    case CODE_PERCENT:
    case CODE_CARET:
      return isFollowedByEquals ? 2 : 1
    default:
      return 1
  }
}

// Whether an expression may start after this token: what tells a regular expression from a division, and a JSX
// element from a comparison.
function mayPrecedeAnExpression(previousToken: ScriptToken | undefined): boolean {
  if (previousToken === undefined) {
    return true
  }
  if (previousToken.kind === 'punctuation') {
    return previousToken.text !== ')' && previousToken.text !== ']'
  }

  return previousToken.kind === 'identifier' && KEYWORDS_BEFORE_AN_EXPRESSION.has(previousToken.text)
}

export function tokenizeScript(text: string, options: TokenizerOptions = {}): ScriptToken[] {
  const tokens: ScriptToken[] = options.tokensBefore ?? []
  const end = Math.min(options.end ?? text.length, text.length)
  const hasMarkup = options.hasMarkup ?? false
  let position = options.start ?? 0
  let sawLineBreak = tokens.length > 0

  function pushToken(kind: ScriptTokenKind, start: number, tokenEnd: number): void {
    tokens.push({ kind, text: text.slice(start, tokenEnd), start, end: tokenEnd, followsLineBreak: sawLineBreak })
    sawLineBreak = false
  }

  function skipWhitespace(): void {
    while (position < end) {
      const code = text.charCodeAt(position)
      if (code === CODE_LINE_FEED) {
        sawLineBreak = true
      } else if (!isWhitespaceCode(code)) {
        return
      }
      position += 1
    }
  }

  function readQuotedString(quoteCode: number, hasEscapes: boolean): void {
    const start = position
    position += 1
    while (position < end) {
      const code = text.charCodeAt(position)
      if (code === CODE_BACKSLASH && hasEscapes) {
        position += 2
        continue
      }
      if (code === quoteCode) {
        position += 1
        break
      }
      if (code === CODE_LINE_FEED && hasEscapes) {
        break
      }
      position += 1
    }
    position = Math.min(position, end)
    pushToken('string', start, position)
  }

  function readTemplateLiteral(): void {
    let chunkStart = position
    position += 1
    while (position < end) {
      const code = text.charCodeAt(position)
      if (code === CODE_BACKSLASH) {
        position += 2
        continue
      }
      if (code === CODE_BACKTICK) {
        position += 1
        pushToken('template', chunkStart, position)
        return
      }
      if (code === CODE_DOLLAR && text.charCodeAt(position + 1) === CODE_OPENING_BRACE) {
        if (position > chunkStart) {
          pushToken('template', chunkStart, position)
        }
        pushToken('punctuation', position, position + 2)
        position += 2
        readCode(true)
        chunkStart = position
        continue
      }
      position += 1
    }
    position = Math.min(position, end)
    if (position > chunkStart) {
      pushToken('template', chunkStart, position)
    }
  }

  // False when no closing slash stands on the line: the slash was a division after all.
  function readRegularExpression(): boolean {
    let scanPosition = position + 1
    let isInCharacterClass = false
    while (scanPosition < end) {
      const code = text.charCodeAt(scanPosition)
      if (code === CODE_LINE_FEED) {
        return false
      }
      if (code === CODE_BACKSLASH) {
        scanPosition += 2
        continue
      }
      if (code === CODE_OPENING_BRACKET) {
        isInCharacterClass = true
      } else if (code === CODE_CLOSING_BRACKET) {
        isInCharacterClass = false
      } else if (code === CODE_SLASH && !isInCharacterClass) {
        scanPosition += 1
        while (scanPosition < end && isIdentifierPartCode(text.charCodeAt(scanPosition))) {
          scanPosition += 1
        }
        const start = position
        position = scanPosition
        pushToken('regularExpression', start, position)
        return true
      }
      scanPosition += 1
    }

    return false
  }

  function readMarkupName(): void {
    const start = position
    while (position < end) {
      const code = text.charCodeAt(position)
      if (!isIdentifierPartCode(code) && code !== 45 && code !== 58 && code !== CODE_DOT) {
        break
      }
      position += 1
    }
    const name = text.slice(start, position)
    const firstCode = name.charCodeAt(0)
    const isComponentName =
      name.includes('.') || (firstCode >= 65 && firstCode <= 90) || firstCode === 95 || firstCode === CODE_DOLLAR
    if (name === '') {
      return
    }
    if (!isComponentName) {
      pushToken('markupName', start, position)
      return
    }
    let segmentStart = start
    for (let index = start; index <= position; index += 1) {
      if (index === position || text.charCodeAt(index) === CODE_DOT) {
        if (index > segmentStart) {
          pushToken('identifier', segmentStart, index)
        }
        if (index < position) {
          pushToken('punctuation', index, index + 1)
        }
        segmentStart = index + 1
      }
    }
  }

  function readMarkupChildren(): void {
    while (position < end) {
      const code = text.charCodeAt(position)
      if (code === CODE_OPENING_BRACE) {
        pushToken('punctuation', position, position + 1)
        position += 1
        readCode(true)
        continue
      }
      if (code === CODE_LESS_THAN) {
        if (text.charCodeAt(position + 1) !== CODE_SLASH) {
          readMarkupElement()
          continue
        }
        pushToken('punctuation', position, position + 1)
        pushToken('punctuation', position + 1, position + 2)
        position += 2
        skipWhitespace()
        readMarkupName()
        skipWhitespace()
        if (text.charCodeAt(position) === CODE_GREATER_THAN) {
          pushToken('punctuation', position, position + 1)
          position += 1
        }
        return
      }
      if (code === CODE_LINE_FEED) {
        sawLineBreak = true
      }
      position += 1
    }
  }

  function readMarkupElement(): void {
    pushToken('punctuation', position, position + 1)
    position += 1
    readMarkupName()
    while (position < end) {
      skipWhitespace()
      const code = text.charCodeAt(position)
      if (code === CODE_SLASH && text.charCodeAt(position + 1) === CODE_GREATER_THAN) {
        pushToken('punctuation', position, position + 1)
        pushToken('punctuation', position + 1, position + 2)
        position += 2
        return
      }
      if (code === CODE_GREATER_THAN) {
        pushToken('punctuation', position, position + 1)
        position += 1
        readMarkupChildren()
        return
      }
      if (code === CODE_OPENING_BRACE) {
        pushToken('punctuation', position, position + 1)
        position += 1
        readCode(true)
        continue
      }
      if (code === CODE_DOUBLE_QUOTE || code === CODE_SINGLE_QUOTE) {
        readQuotedString(code, false)
        continue
      }
      if (code === 61) {
        pushToken('punctuation', position, position + 1)
        position += 1
        continue
      }
      if (code === CODE_LESS_THAN) {
        readMarkupElement()
        continue
      }
      if (isIdentifierStartCode(code)) {
        const start = position
        while (position < end) {
          const partCode = text.charCodeAt(position)
          if (!isIdentifierPartCode(partCode) && partCode !== 45 && partCode !== 58) {
            break
          }
          position += 1
        }
        pushToken('markupName', start, position)
        continue
      }
      position += 1
    }
  }

  function startsMarkupElement(): boolean {
    if (!hasMarkup || !mayPrecedeAnExpression(tokens[tokens.length - 1])) {
      return false
    }
    const nextCode = text.charCodeAt(position + 1)
    if (nextCode === CODE_GREATER_THAN) {
      return true
    }
    if (!isIdentifierStartCode(nextCode)) {
      return false
    }
    let scanPosition = position + 1
    while (
      scanPosition < end &&
      (isIdentifierPartCode(text.charCodeAt(scanPosition)) || text.charCodeAt(scanPosition) === CODE_DOT)
    ) {
      scanPosition += 1
    }
    while (scanPosition < end && isWhitespaceCode(text.charCodeAt(scanPosition))) {
      scanPosition += 1
    }
    const isTypeParameterList = text.charCodeAt(scanPosition) === 44 || text.startsWith('extends', scanPosition)

    return !isTypeParameterList
  }

  // Reads code to the end, or up to the closing brace of a substitution or of a JSX expression the caller opened.
  function readCode(stopsAtClosingBrace: boolean): void {
    let braceDepth = 0
    while (position < end) {
      const code = text.charCodeAt(position)
      if (code === CODE_LINE_FEED) {
        sawLineBreak = true
        position += 1
        continue
      }
      if (isWhitespaceCode(code)) {
        position += 1
        continue
      }
      if (isIdentifierStartCode(code) || (code === CODE_HASH && isIdentifierStartCode(text.charCodeAt(position + 1)))) {
        const start = position
        position += 1
        while (position < end && isIdentifierPartCode(text.charCodeAt(position))) {
          position += 1
        }
        pushToken('identifier', start, position)
        continue
      }
      if (isDigitCode(code) || (code === CODE_DOT && isDigitCode(text.charCodeAt(position + 1)))) {
        const start = position
        position += 1
        while (position < end) {
          const partCode = text.charCodeAt(position)
          const isFractionDot = partCode === CODE_DOT && isDigitCode(text.charCodeAt(position + 1))
          if (!isIdentifierPartCode(partCode) && !isFractionDot) {
            break
          }
          position += 1
        }
        pushToken('number', start, position)
        continue
      }
      if (code === CODE_DOUBLE_QUOTE || code === CODE_SINGLE_QUOTE) {
        readQuotedString(code, true)
        continue
      }
      if (code === CODE_BACKTICK) {
        readTemplateLiteral()
        continue
      }
      if (code === CODE_SLASH) {
        const nextCode = text.charCodeAt(position + 1)
        if (nextCode === CODE_SLASH) {
          const lineEnd = text.indexOf('\n', position)
          position = lineEnd === -1 || lineEnd > end ? end : lineEnd
          continue
        }
        if (nextCode === CODE_ASTERISK) {
          const commentEnd = text.indexOf('*/', position + 2)
          const nextPosition = commentEnd === -1 || commentEnd + 2 > end ? end : commentEnd + 2
          if (text.slice(position, nextPosition).includes('\n')) {
            sawLineBreak = true
          }
          position = nextPosition
          continue
        }
        if (mayPrecedeAnExpression(tokens[tokens.length - 1]) && readRegularExpression()) {
          continue
        }
      }
      if (code === CODE_HASH && position === 0 && text.charCodeAt(1) === 33) {
        const lineEnd = text.indexOf('\n')
        position = lineEnd === -1 ? end : lineEnd
        continue
      }
      if (code === CODE_LESS_THAN && startsMarkupElement()) {
        readMarkupElement()
        continue
      }
      if (code === CODE_OPENING_BRACE) {
        braceDepth += 1
      } else if (code === CODE_CLOSING_BRACE) {
        if (braceDepth === 0 && stopsAtClosingBrace) {
          pushToken('punctuation', position, position + 1)
          position += 1
          return
        }
        braceDepth -= 1
      }
      const operatorLength = Math.min(operatorLengthAt(text, position, code), end - position)
      pushToken('punctuation', position, position + operatorLength)
      position += operatorLength
    }
  }

  readCode(false)

  return tokens
}

export function stringTokenValue(token: ScriptToken): string {
  const lastCharacter = token.text[token.text.length - 1]
  const isClosed = token.text.length >= 2 && lastCharacter === token.text[0]

  return token.text.slice(1, isClosed ? -1 : undefined)
}

// The index of the token holding this offset, by binary search; -1 between tokens (whitespace, a comment).
export function tokenIndexAtOffset(tokens: readonly ScriptToken[], offset: number): number {
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
