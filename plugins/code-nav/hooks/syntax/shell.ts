import type { TokenKind } from '../../types'
import { extensionOfPath, fileNameOfPath } from './language'
import {
  AMPERSAND,
  BACKSLASH,
  BACKTICK,
  COLON,
  DOLLAR,
  DOT,
  DOUBLE_QUOTE,
  EQUALS,
  HASH,
  LESS_THAN,
  MINUS,
  NEWLINE,
  OPENING_BRACE,
  OPENING_PARENTHESIS,
  PIPE,
  PLUS,
  QUESTION_MARK,
  SEMICOLON,
  SINGLE_QUOTE,
  SLASH,
  isDigitCode,
  isNamePartCode,
  isNameStartCode,
  isWhitespaceCode,
  offsetAfterInlineWhitespace,
  offsetAfterName,
  offsetAfterNumber,
  offsetAfterWhitespace,
  offsetOfLineEnd,
} from './scanning'
import type { TokenCollector } from './scanning'

export type ShellDialect = 'shell' | 'dockerfile' | 'makefile'

const SHELL_KEYWORDS = new Set([
  'break', 'case', 'continue', 'declare', 'do', 'done', 'elif', 'else', 'esac', 'exit', 'export', 'fi', 'for',
  'function', 'if', 'in', 'local', 'readonly', 'return', 'select', 'set', 'shift', 'source', 'then', 'unset', 'until',
  'while',
])

// The words that are keywords only as the first word of their line: the instructions of a Dockerfile, the
// directives of a Makefile.
const LINE_STARTING_KEYWORDS: Readonly<Record<ShellDialect, ReadonlySet<string>>> = {
  shell: new Set(),
  dockerfile: new Set([
    'ADD', 'ARG', 'CMD', 'COPY', 'ENTRYPOINT', 'ENV', 'EXPOSE', 'FROM', 'HEALTHCHECK', 'LABEL', 'ONBUILD', 'RUN',
    'SHELL', 'STOPSIGNAL', 'USER', 'VOLUME', 'WORKDIR',
  ]),
  makefile: new Set([
    'define', 'else', 'endef', 'endif', 'export', 'ifdef', 'ifeq', 'ifndef', 'ifneq', 'include', 'override',
    'unexport',
  ]),
}

// A Makefile declares a target or a variable with a name at the very start of a line.
const DECLARES_AT_LINE_START: Readonly<Record<ShellDialect, boolean>> = {
  shell: false,
  dockerfile: false,
  makefile: true,
}

// A Makefile reads its variables as "$(NAME)", which is a command substitution anywhere else.
const READS_PARENTHESIZED_VARIABLES: Readonly<Record<ShellDialect, boolean>> = {
  shell: false,
  dockerfile: false,
  makefile: true,
}

const SPECIAL_PARAMETER_CHARACTERS = '@*#?$!-<^+%|'

export function shellDialectOfPath(path: string): ShellDialect {
  const fileName = fileNameOfPath(path)
  if (fileName.startsWith('dockerfile') || extensionOfPath(path) === 'dockerfile') {
    return 'dockerfile'
  }

  return fileName === 'makefile' || fileName === 'gnumakefile' || extensionOfPath(path) === 'mk' ? 'makefile' : 'shell'
}

function startsWordAfter(code: number): boolean {
  return (
    isWhitespaceCode(code) ||
    code === SEMICOLON ||
    code === PIPE ||
    code === AMPERSAND ||
    code === OPENING_PARENTHESIS ||
    code === BACKTICK
  )
}

// A shell script, a Dockerfile or a Makefile, from start to end.
export function scanShell(
  text: string,
  start: number,
  end: number,
  collector: TokenCollector,
  dialect: ShellDialect,
): void {
  let lineStartOffset = start
  let isFirstWordOfLine = true
  let labelOfOpenedHereDocument: string | null = null

  // A word keeps the dashes, dots and slashes inside it: "docker-compose" and "bin/console" are each one name.
  function offsetAfterWord(offset: number): number {
    while (offset < end) {
      const code = text.charCodeAt(offset)
      const isJoiningCharacter =
        (code === MINUS || code === DOT || code === SLASH) && isNamePartCode(text.charCodeAt(offset + 1))
      if (!isNamePartCode(code) && !isJoiningCharacter) {
        break
      }
      offset++
    }

    return offset
  }

  function kindOfWord(offset: number, wordEnd: number, startsWord: boolean): TokenKind {
    const word = text.slice(offset, wordEnd)
    const nextCode = text.charCodeAt(wordEnd)
    const isAssigned = nextCode === EQUALS || (nextCode === PLUS && text.charCodeAt(wordEnd + 1) === EQUALS)
    if (isAssigned && startsWord && offsetAfterName(text, offset, wordEnd) === wordEnd) {
      return 'variable'
    }
    if (DECLARES_AT_LINE_START[dialect] && offset === lineStartOffset) {
      const afterWord = offsetAfterInlineWhitespace(text, wordEnd, end)
      const afterWordCode = text.charCodeAt(afterWord)
      const isConditionalOrImmediateAssignment =
        (afterWordCode === COLON || afterWordCode === QUESTION_MARK) && text.charCodeAt(afterWord + 1) === EQUALS
      if (afterWordCode === EQUALS || isConditionalOrImmediateAssignment) {
        return 'variable'
      }
      if (afterWordCode === COLON) {
        return 'callName'
      }
    }
    if ((isFirstWordOfLine && LINE_STARTING_KEYWORDS[dialect].has(word)) || (startsWord && SHELL_KEYWORDS.has(word))) {
      return 'keyword'
    }

    const isDeclaredFunction = text.charCodeAt(offsetAfterInlineWhitespace(text, wordEnd, end)) === OPENING_PARENTHESIS

    return isDeclaredFunction ? 'callName' : 'name'
  }

  // "$name", "${name...", "$(NAME)" in a Makefile, or a special parameter such as "$1" and "$@".
  function scanDollar(offset: number): number {
    const nextCode = text.charCodeAt(offset + 1)
    if (isNameStartCode(nextCode)) {
      const nameEnd = offsetAfterName(text, offset + 1, end)
      collector.add(offset, nameEnd, 'variable', true)

      return nameEnd
    }
    if (nextCode === OPENING_BRACE || (nextCode === OPENING_PARENTHESIS && READS_PARENTHESIZED_VARIABLES[dialect])) {
      const nameStart = offset + 2
      const nameEnd = offsetAfterName(text, nameStart, end)
      const isVariable = nextCode === OPENING_BRACE || !isWhitespaceCode(text.charCodeAt(nameEnd))
      collector.add(offset, nameStart, 'punctuation', false)
      if (nameEnd > nameStart && isNameStartCode(text.charCodeAt(nameStart)) && isVariable) {
        collector.add(nameStart, nameEnd, 'variable', true)

        return nameEnd
      }

      return nameStart
    }
    if (offset + 1 < end && (isDigitCode(nextCode) || SPECIAL_PARAMETER_CHARACTERS.includes(text.charAt(offset + 1)))) {
      collector.add(offset, offset + 2, 'variable', false)

      return offset + 2
    }
    collector.add(offset, offset + 1, 'punctuation', false)

    return offset + 1
  }

  function scanDoubleQuotedString(start: number): number {
    let pieceStart = start
    let offset = start + 1
    while (offset < end) {
      const code = text.charCodeAt(offset)
      if (code === BACKSLASH) {
        offset += 2
      } else if (code === DOUBLE_QUOTE) {
        collector.add(pieceStart, offset + 1, 'string', false)

        return offset + 1
      } else if (code === DOLLAR && isNameStartCode(text.charCodeAt(offset + 1))) {
        collector.add(pieceStart, offset, 'string', false)
        offset = scanDollar(offset)
        pieceStart = offset
      } else if (code === DOLLAR && text.charCodeAt(offset + 1) === OPENING_BRACE) {
        collector.add(pieceStart, offset, 'string', false)
        offset = scanDollar(offset)
        pieceStart = offset
      } else {
        offset++
      }
    }
    collector.add(pieceStart, end, 'string', false)

    return end
  }

  // "<<LABEL", "<<-LABEL" or "<<'LABEL'": the lines below, up to the one holding the label alone, are one text.
  // Returns -1 when the offset does not open one.
  function scanHereDocumentOpening(offset: number): number {
    let labelStart = text.charCodeAt(offset + 2) === MINUS ? offset + 3 : offset + 2
    const operatorEnd = labelStart
    labelStart = offsetAfterInlineWhitespace(text, labelStart, end)
    const quoteCode = text.charCodeAt(labelStart)
    const isQuoted = quoteCode === SINGLE_QUOTE || quoteCode === DOUBLE_QUOTE
    const nameStart = isQuoted ? labelStart + 1 : labelStart
    if (!isNameStartCode(text.charCodeAt(nameStart))) {
      return -1
    }
    const nameEnd = offsetAfterName(text, nameStart, end)
    const labelEnd = isQuoted && text.charCodeAt(nameEnd) === quoteCode ? nameEnd + 1 : nameEnd
    collector.add(offset, operatorEnd, 'punctuation', false)
    collector.add(labelStart, labelEnd, 'string', false)
    labelOfOpenedHereDocument = text.slice(nameStart, nameEnd)

    return labelEnd
  }

  function isPartOfHereString(offset: number): boolean {
    return text.charCodeAt(offset + 2) === LESS_THAN || text.charCodeAt(offset - 1) === LESS_THAN
  }

  function scanHereDocumentBody(bodyStart: number, label: string): number {
    let lineStart = bodyStart
    while (lineStart < end) {
      const lineEnd = offsetOfLineEnd(text, lineStart, end)
      const contentStart = offsetAfterInlineWhitespace(text, lineStart, lineEnd)
      const isClosingLine =
        text.startsWith(label, contentStart) &&
        offsetAfterWhitespace(text, contentStart + label.length, lineEnd) === lineEnd
      if (isClosingLine) {
        collector.add(bodyStart, lineEnd, 'string', false)

        return lineEnd
      }
      lineStart = lineEnd + 1
    }
    collector.add(bodyStart, end, 'string', false)

    return end
  }

  let offset = start
  while (offset < end) {
    const code = text.charCodeAt(offset)
    if (code === NEWLINE) {
      offset++
      if (labelOfOpenedHereDocument !== null) {
        offset = scanHereDocumentBody(offset, labelOfOpenedHereDocument)
        labelOfOpenedHereDocument = null
      }
      lineStartOffset = offset
      isFirstWordOfLine = true
      continue
    }
    if (isWhitespaceCode(code)) {
      offset++
      continue
    }
    const startsWord = offset === start || startsWordAfter(text.charCodeAt(offset - 1))
    const nextCode = text.charCodeAt(offset + 1)
    if (code === HASH && startsWord) {
      const commentEnd = offsetOfLineEnd(text, offset, end)
      collector.add(offset, commentEnd, 'comment', false)
      offset = commentEnd
    } else if (code === SINGLE_QUOTE) {
      const closingOffset = text.indexOf("'", offset + 1)
      const stringEnd = closingOffset === -1 || closingOffset >= end ? end : closingOffset + 1
      collector.add(offset, stringEnd, 'string', false)
      offset = stringEnd
    } else if (code === DOUBLE_QUOTE) {
      offset = scanDoubleQuotedString(offset)
    } else if (code === DOLLAR) {
      offset = scanDollar(offset)
    } else if (isDigitCode(code)) {
      const numberEnd = offsetAfterNumber(text, offset, end)
      collector.add(offset, numberEnd, 'number', false)
      offset = numberEnd
    } else if (code === MINUS && startsWord && (isNameStartCode(nextCode) || nextCode === MINUS)) {
      let optionEnd = offset + 1
      while (optionEnd < end && (isNamePartCode(text.charCodeAt(optionEnd)) || text.charCodeAt(optionEnd) === MINUS)) {
        optionEnd++
      }
      collector.add(offset, optionEnd, 'attribute', false)
      offset = optionEnd
    } else if (isNameStartCode(code)) {
      const wordEnd = offsetAfterWord(offset)
      const kind = kindOfWord(offset, wordEnd, startsWord)
      collector.add(offset, wordEnd, kind, kind !== 'keyword')
      offset = wordEnd
    } else {
      const opensHereDocument = code === LESS_THAN && nextCode === LESS_THAN && !isPartOfHereString(offset)
      const hereDocumentOpeningEnd = opensHereDocument ? scanHereDocumentOpening(offset) : -1
      if (hereDocumentOpeningEnd === -1) {
        collector.add(offset, offset + 1, 'punctuation', false)
        offset++
      } else {
        offset = hereDocumentOpeningEnd
      }
    }
    isFirstWordOfLine = false
  }
}
