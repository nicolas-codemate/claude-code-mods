import type { MarkupTemplating } from './markup'
import {
  CLOSING_BRACE,
  DOT,
  DOUBLE_QUOTE,
  HASH,
  MINUS,
  OPENING_BRACE,
  OPENING_PARENTHESIS,
  PERCENT,
  PIPE,
  SINGLE_QUOTE,
  TILDE,
  isDigitCode,
  isNameStartCode,
  isWhitespaceCode,
  offsetAfterName,
  offsetAfterNumber,
  offsetAfterQuotedString,
  offsetAfterWhitespace,
} from './scanning'
import type { TokenCollector } from './scanning'

const TWIG_KEYWORDS = new Set([
  'and', 'as', 'defined', 'else', 'elseif', 'false', 'from', 'if', 'ignore', 'import', 'in', 'is', 'matches', 'missing',
  'none', 'not', 'null', 'only', 'or', 'same', 'true', 'with', 'without',
])

function isWhitespaceControlCode(code: number): boolean {
  return code === MINUS || code === TILDE
}

// "{# ... #}", "{{ ... }}" or "{% ... %}" from its opening brace. A string naming a template ("orders/list.html.twig")
// is navigable: a click opens that file.
function scanTwigConstruct(text: string, start: number, end: number, collector: TokenCollector): number {
  const openingCode = text.charCodeAt(start + 1)
  if (openingCode === HASH) {
    const closingOffset = text.indexOf('#}', start + 2)
    const commentEnd = closingOffset === -1 || closingOffset + 2 > end ? end : closingOffset + 2
    collector.add(start, commentEnd, 'comment', false)

    return commentEnd
  }
  const closingCode = openingCode === PERCENT ? PERCENT : CLOSING_BRACE
  let offset = isWhitespaceControlCode(text.charCodeAt(start + 2)) ? start + 3 : start + 2
  collector.add(start, offset, 'punctuation', false)
  let isTagNameExpected = openingCode === PERCENT
  let openBraceCount = 0
  let previousCode = 0
  while (offset < end) {
    const code = text.charCodeAt(offset)
    const closingStart = isWhitespaceControlCode(code) ? offset + 1 : offset
    if (
      openBraceCount === 0 &&
      text.charCodeAt(closingStart) === closingCode &&
      text.charCodeAt(closingStart + 1) === CLOSING_BRACE
    ) {
      collector.add(offset, closingStart + 2, 'punctuation', false)

      return Math.min(closingStart + 2, end)
    }
    if (isWhitespaceCode(code)) {
      offset++
    } else if (isNameStartCode(code)) {
      const nameEnd = offsetAfterName(text, offset, end)
      const isCalled = text.charCodeAt(offsetAfterWhitespace(text, nameEnd, end)) === OPENING_PARENTHESIS
      if (previousCode === DOT) {
        collector.add(offset, nameEnd, isCalled ? 'callName' : 'property', true)
      } else if (isTagNameExpected || TWIG_KEYWORDS.has(text.slice(offset, nameEnd))) {
        collector.add(offset, nameEnd, 'keyword', false)
      } else {
        collector.add(offset, nameEnd, isCalled || previousCode === PIPE ? 'callName' : 'name', true)
      }
      isTagNameExpected = false
      previousCode = code
      offset = nameEnd
    } else if (isDigitCode(code)) {
      const numberEnd = offsetAfterNumber(text, offset, end)
      collector.add(offset, numberEnd, 'number', false)
      previousCode = code
      offset = numberEnd
    } else if (code === SINGLE_QUOTE || code === DOUBLE_QUOTE) {
      const stringEnd = offsetAfterQuotedString(text, offset, end, true)
      collector.add(offset, stringEnd, 'string', text.startsWith('.twig', stringEnd - 6))
      previousCode = code
      offset = stringEnd
    } else {
      if (code === OPENING_BRACE) {
        openBraceCount++
      } else if (code === CLOSING_BRACE && openBraceCount > 0) {
        openBraceCount--
      }
      collector.add(offset, offset + 1, 'punctuation', false)
      previousCode = code
      offset++
    }
  }

  return end
}

export const TWIG_TEMPLATING: MarkupTemplating = {
  startsConstructAt: (text, offset) => {
    const nextCode = text.charCodeAt(offset + 1)

    return nextCode === OPENING_BRACE || nextCode === PERCENT || nextCode === HASH
  },
  scanConstruct: scanTwigConstruct,
  isScriptAttribute: () => false,
  builtInTagNames: new Set(),
  areTagNamesCaseSensitive: false,
}
