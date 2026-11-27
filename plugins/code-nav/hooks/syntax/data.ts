import { extensionOfPath } from './language'
import {
  AMPERSAND,
  BACKSLASH,
  CLOSING_SQUARE,
  COLON,
  COMMA,
  DOT,
  DOUBLE_QUOTE,
  EQUALS,
  EXCLAMATION_MARK,
  GREATER_THAN,
  HASH,
  MINUS,
  OPENING_BRACE,
  OPENING_SQUARE,
  PIPE,
  PLUS,
  SEMICOLON,
  SINGLE_QUOTE,
  SLASH,
  STAR,
  isDigitCode,
  isInlineWhitespaceCode,
  isNamePartCode,
  isNameStartCode,
  isWhitespaceCode,
  offsetAfterBlockComment,
  offsetAfterInlineWhitespace,
  offsetAfterNumber,
  offsetAfterQuotedString,
  offsetAfterWhitespace,
  offsetOfLineEnd,
} from './scanning'
import type { TokenCollector } from './scanning'

// json: JSON, with the comments some tools allow. yaml: YAML and its look-alikes. keyValue: "key = value" lines
// under "[section]" headers (INI, TOML, .env, .properties).
export type DataDialect = 'json' | 'yaml' | 'keyValue'

const JSON_EXTENSIONS = new Set(['json', 'jsonc', 'json5', 'webmanifest', 'lock'])
const YAML_EXTENSIONS = new Set(['yaml', 'yml', 'neon'])

const VALUE_KEYWORDS = new Set(['true', 'false', 'null', 'yes', 'no', 'on', 'off'])

export function dataDialectOfPath(path: string): DataDialect {
  const extension = extensionOfPath(path)
  if (JSON_EXTENSIONS.has(extension)) {
    return 'json'
  }

  return YAML_EXTENSIONS.has(extension) ? 'yaml' : 'keyValue'
}

// A word of a value keeps what joins its parts: "App\Entity\Order", "order.mailer" and "kernel.project_dir" are
// each one name to look up.
function offsetAfterDataName(text: string, offset: number, end: number): number {
  while (offset < end) {
    const code = text.charCodeAt(offset)
    const isJoiningCharacter =
      (code === DOT || code === MINUS || code === BACKSLASH) && isNamePartCode(text.charCodeAt(offset + 1))
    if (!isNamePartCode(code) && !isJoiningCharacter) {
      break
    }
    offset++
  }

  return offset
}

function scanJson(text: string, start: number, end: number, collector: TokenCollector): void {
  let offset = start
  while (offset < end) {
    const code = text.charCodeAt(offset)
    if (isWhitespaceCode(code)) {
      offset++
    } else if (code === DOUBLE_QUOTE || code === SINGLE_QUOTE) {
      const stringEnd = offsetAfterQuotedString(text, offset, end, false)
      const isKey = text.charCodeAt(offsetAfterWhitespace(text, stringEnd, end)) === COLON
      collector.add(offset, stringEnd, isKey ? 'property' : 'string', isKey)
      offset = stringEnd
    } else if (code === SLASH && text.charCodeAt(offset + 1) === SLASH) {
      const commentEnd = offsetOfLineEnd(text, offset, end)
      collector.add(offset, commentEnd, 'comment', false)
      offset = commentEnd
    } else if (code === SLASH && text.charCodeAt(offset + 1) === STAR) {
      const commentEnd = offsetAfterBlockComment(text, offset, end)
      collector.add(offset, commentEnd, 'comment', false)
      offset = commentEnd
    } else if (isDigitCode(code) || (code === MINUS && isDigitCode(text.charCodeAt(offset + 1)))) {
      const numberEnd = offsetAfterNumber(text, code === MINUS ? offset + 1 : offset, end)
      collector.add(offset, numberEnd, 'number', false)
      offset = numberEnd
    } else if (isNameStartCode(code)) {
      const nameEnd = offsetAfterDataName(text, offset, end)
      const isKey = text.charCodeAt(offsetAfterWhitespace(text, nameEnd, end)) === COLON
      const isKeyword = !isKey && VALUE_KEYWORDS.has(text.slice(offset, nameEnd))
      collector.add(offset, nameEnd, isKey ? 'property' : isKeyword ? 'keyword' : 'name', !isKeyword)
      offset = nameEnd
    } else {
      collector.add(offset, offset + 1, 'punctuation', false)
      offset++
    }
  }
}

type LineValueDialect = Exclude<DataDialect, 'json'>

const OPENS_COMMENT_WITH_SEMICOLON: Readonly<Record<LineValueDialect, boolean>> = { yaml: false, keyValue: true }
const HAS_YAML_MARKS: Readonly<Record<LineValueDialect, boolean>> = { yaml: true, keyValue: false }

// YAML closes a single-quoted string at the first quote that is not doubled; a backslash escapes nothing in it.
function offsetAfterSingleQuotedYamlString(text: string, offset: number, lineEnd: number): number {
  let closingOffset = offset + 1
  while (closingOffset < lineEnd) {
    if (text.charCodeAt(closingOffset) === SINGLE_QUOTE) {
      if (text.charCodeAt(closingOffset + 1) !== SINGLE_QUOTE) {
        return closingOffset + 1
      }
      closingOffset++
    }
    closingOffset++
  }

  return lineEnd
}

function isFollowedByKeyColon(text: string, offset: number, lineEnd: number): boolean {
  if (offset >= lineEnd || text.charCodeAt(offset) !== COLON) {
    return false
  }

  return offset + 1 >= lineEnd || isWhitespaceCode(text.charCodeAt(offset + 1))
}

// What stands on a line after its key: strings, numbers, names, a comment. Returns whether the value ends on the
// "|" or ">" that makes the more indented lines below it one block of text.
function scanLineValue(
  text: string,
  from: number,
  lineEnd: number,
  collector: TokenCollector,
  dialect: LineValueDialect,
): boolean {
  let offset = from
  let opensTextBlock = false
  while (offset < lineEnd) {
    const code = text.charCodeAt(offset)
    const isAfterWhitespace = offset === from || isWhitespaceCode(text.charCodeAt(offset - 1))
    if (isWhitespaceCode(code)) {
      offset++
      continue
    }
    if ((code === HASH || (code === SEMICOLON && OPENS_COMMENT_WITH_SEMICOLON[dialect])) && isAfterWhitespace) {
      collector.add(offset, lineEnd, 'comment', false)

      return opensTextBlock
    }
    opensTextBlock = false
    if (code === DOUBLE_QUOTE || code === SINGLE_QUOTE) {
      const stringEnd =
        code === SINGLE_QUOTE && HAS_YAML_MARKS[dialect]
          ? offsetAfterSingleQuotedYamlString(text, offset, lineEnd)
          : offsetAfterQuotedString(text, offset, lineEnd, false)
      const isKey = HAS_YAML_MARKS[dialect] && isFollowedByKeyColon(text, stringEnd, lineEnd)
      collector.add(offset, stringEnd, isKey ? 'property' : 'string', isKey)
      offset = stringEnd
    } else if (isDigitCode(code)) {
      const numberEnd = offsetAfterNumber(text, offset, lineEnd)
      collector.add(offset, numberEnd, 'number', false)
      offset = numberEnd
    } else if (isNameStartCode(code)) {
      const nameEnd = offsetAfterDataName(text, offset, lineEnd)
      const isKey = HAS_YAML_MARKS[dialect] && isFollowedByKeyColon(text, nameEnd, lineEnd)
      const isKeyword = !isKey && VALUE_KEYWORDS.has(text.slice(offset, nameEnd).toLowerCase())
      collector.add(offset, nameEnd, isKey ? 'property' : isKeyword ? 'keyword' : 'name', !isKeyword)
      offset = nameEnd
    } else if (
      HAS_YAML_MARKS[dialect] &&
      (code === AMPERSAND || code === STAR) &&
      isNameStartCode(text.charCodeAt(offset + 1))
    ) {
      const nameEnd = offsetAfterDataName(text, offset + 1, lineEnd)
      collector.add(offset, nameEnd, 'variable', true)
      offset = nameEnd
    } else if (HAS_YAML_MARKS[dialect] && code === EXCLAMATION_MARK && isAfterWhitespace) {
      let tagEnd = offset + 1
      while (tagEnd < lineEnd && !isWhitespaceCode(text.charCodeAt(tagEnd))) {
        tagEnd++
      }
      collector.add(offset, tagEnd, 'keyword', false)
      offset = tagEnd
    } else {
      opensTextBlock = HAS_YAML_MARKS[dialect] && (code === PIPE || code === GREATER_THAN) && isAfterWhitespace
      collector.add(offset, offset + 1, 'punctuation', false)
      offset++
      while (opensTextBlock && offset < lineEnd && isTextBlockIndicatorCode(text.charCodeAt(offset))) {
        collector.add(offset, offset + 1, 'punctuation', false)
        offset++
      }
    }
  }

  return opensTextBlock
}

function isTextBlockIndicatorCode(code: number): boolean {
  return code === PLUS || code === MINUS || isDigitCode(code)
}

// The offset of the colon ending the key the line starts with, -1 when the line does not start with a key. A colon
// ends a key only before whitespace or the end of the line: "http://shop.test" holds none.
function offsetOfYamlKeyColon(text: string, offset: number, lineEnd: number): number {
  const firstCode = text.charCodeAt(offset)
  if (firstCode === DOUBLE_QUOTE || firstCode === SINGLE_QUOTE) {
    const stringEnd =
      firstCode === SINGLE_QUOTE
        ? offsetAfterSingleQuotedYamlString(text, offset, lineEnd)
        : offsetAfterQuotedString(text, offset, lineEnd, false)
    const colonOffset = offsetAfterInlineWhitespace(text, stringEnd, lineEnd)

    return isFollowedByKeyColon(text, colonOffset, lineEnd) ? colonOffset : -1
  }
  for (let colonOffset = offset; colonOffset < lineEnd; colonOffset++) {
    const code = text.charCodeAt(colonOffset)
    if (code === COLON && isFollowedByKeyColon(text, colonOffset, lineEnd)) {
      return colonOffset > offset ? colonOffset : -1
    }
    const endsKeySearch =
      code === OPENING_BRACE ||
      code === OPENING_SQUARE ||
      code === CLOSING_SQUARE ||
      code === COMMA ||
      code === DOUBLE_QUOTE ||
      code === SINGLE_QUOTE ||
      (code === HASH && colonOffset > offset && isWhitespaceCode(text.charCodeAt(colonOffset - 1)))
    if (endsKeySearch || (colonOffset === offset && (code === HASH || code === AMPERSAND || code === STAR))) {
      return -1
    }
  }

  return -1
}

function scanYaml(text: string, start: number, end: number, collector: TokenCollector): void {
  // The indentation of the line that opened a block of text with "|" or ">", -1 outside such a block.
  let textBlockIndentation = -1
  let lineStart = start
  while (lineStart < end) {
    const lineEnd = offsetOfLineEnd(text, lineStart, end)
    let offset = offsetAfterInlineWhitespace(text, lineStart, lineEnd)
    const indentation = offset - lineStart
    const isBlank = offsetAfterWhitespace(text, offset, lineEnd) === lineEnd
    if (textBlockIndentation !== -1 && (isBlank || indentation > textBlockIndentation)) {
      collector.add(offset, lineEnd, 'string', false)
    } else {
      while (offset < lineEnd && text.charCodeAt(offset) === MINUS && isSequenceDash(text, offset, lineEnd)) {
        collector.add(offset, offset + 1, 'punctuation', false)
        offset = offsetAfterInlineWhitespace(text, offset + 1, lineEnd)
      }
      const keyColonOffset = offsetOfYamlKeyColon(text, offset, lineEnd)
      if (keyColonOffset !== -1) {
        collector.add(offset, keyColonOffset, 'property', true)
        collector.add(keyColonOffset, keyColonOffset + 1, 'punctuation', false)
        offset = keyColonOffset + 1
      }
      textBlockIndentation = scanLineValue(text, offset, lineEnd, collector, 'yaml') ? indentation : -1
    }
    lineStart = lineEnd + 1
  }
}

function isSequenceDash(text: string, offset: number, lineEnd: number): boolean {
  return offset + 1 >= lineEnd || isInlineWhitespaceCode(text.charCodeAt(offset + 1))
}

function scanKeyValueLines(text: string, start: number, end: number, collector: TokenCollector): void {
  let lineStart = start
  while (lineStart < end) {
    const lineEnd = offsetOfLineEnd(text, lineStart, end)
    let offset = offsetAfterInlineWhitespace(text, lineStart, lineEnd)
    const firstCode = offset < lineEnd ? text.charCodeAt(offset) : 0
    if (firstCode === OPENING_SQUARE) {
      offset = scanSectionHeader(text, offset, lineEnd, collector)
    } else if (firstCode !== HASH && firstCode !== SEMICOLON) {
      if (text.startsWith('export ', offset)) {
        collector.add(offset, offset + 6, 'keyword', false)
        offset = offsetAfterInlineWhitespace(text, offset + 6, lineEnd)
      }
      const equalsOffset = offsetOfKeyEquals(text, offset, lineEnd)
      if (equalsOffset !== -1) {
        collector.add(offset, equalsOffset, 'property', true)
        collector.add(equalsOffset, equalsOffset + 1, 'punctuation', false)
        offset = equalsOffset + 1
      }
    }
    scanLineValue(text, offset, lineEnd, collector, 'keyValue')
    lineStart = lineEnd + 1
  }
}

// "[database]" or "[[servers]]": the name between the brackets is drawn as a tag.
function scanSectionHeader(text: string, offset: number, lineEnd: number, collector: TokenCollector): number {
  let nameStart = offset
  while (nameStart < lineEnd && text.charCodeAt(nameStart) === OPENING_SQUARE) {
    nameStart++
  }
  let nameEnd = nameStart
  while (nameEnd < lineEnd && text.charCodeAt(nameEnd) !== CLOSING_SQUARE) {
    nameEnd++
  }
  let headerEnd = nameEnd
  while (headerEnd < lineEnd && text.charCodeAt(headerEnd) === CLOSING_SQUARE) {
    headerEnd++
  }
  collector.add(offset, nameStart, 'punctuation', false)
  collector.add(nameStart, nameEnd, 'tag', false)
  collector.add(nameEnd, headerEnd, 'punctuation', false)

  return headerEnd
}

function offsetOfKeyEquals(text: string, offset: number, lineEnd: number): number {
  for (let equalsOffset = offset; equalsOffset < lineEnd; equalsOffset++) {
    const code = text.charCodeAt(equalsOffset)
    if (code === EQUALS) {
      return equalsOffset > offset ? equalsOffset : -1
    }
    if (code === DOUBLE_QUOTE || code === SINGLE_QUOTE || code === HASH) {
      return -1
    }
  }

  return -1
}

const SCANNER_BY_DIALECT: Readonly<
  Record<DataDialect, (text: string, start: number, end: number, collector: TokenCollector) => void>
> = {
  json: scanJson,
  yaml: scanYaml,
  keyValue: scanKeyValueLines,
}

export function scanData(
  text: string,
  start: number,
  end: number,
  collector: TokenCollector,
  dialect: DataDialect,
): void {
  SCANNER_BY_DIALECT[dialect](text, start, end, collector)
}
