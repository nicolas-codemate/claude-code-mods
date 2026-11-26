import {
  COLON,
  DOT,
  DOUBLE_QUOTE,
  EQUALS,
  EXCLAMATION_MARK,
  GREATER_THAN,
  LESS_THAN,
  MINUS,
  OPENING_BRACE,
  QUESTION_MARK,
  SINGLE_QUOTE,
  SLASH,
  isDigitCode,
  isNameStartCode,
  isUppercaseCode,
  isWhitespaceCode,
  offsetAfterWhitespace,
} from './scanning'
import type { TokenCollector } from './scanning'
import { scanScript } from './script'
import { scanStyle } from './style'

// Where a "{" stands when a templating language is asked whether it opens one of its constructs.
export type MarkupPlace = 'content' | 'tag' | 'attributeValue'

// What a templating language adds to markup: constructs opened by a "{" ("{{ total }}", "{% if %}"), attributes
// whose value is an expression of the script family, tags of its own that are no component of the project.
export type MarkupTemplating = {
  startsConstructAt: (text: string, offset: number, place: MarkupPlace) => boolean
  // Adds the tokens of the construct opened at the offset and returns the offset after it.
  scanConstruct: (text: string, offset: number, end: number, collector: TokenCollector) => number
  isScriptAttribute: (attributeName: string) => boolean
  builtInTagNames: ReadonlySet<string>
  // "<Button>" is the HTML button where tag names ignore case, a component where they do not.
  areTagNamesCaseSensitive: boolean
}

export const NO_TEMPLATING: MarkupTemplating = {
  startsConstructAt: () => false,
  scanConstruct: (_text, offset) => offset + 1,
  isScriptAttribute: () => false,
  builtInTagNames: new Set(),
  areTagNamesCaseSensitive: false,
}

const KNOWN_ELEMENT_NAMES = new Set([
  'a', 'abbr', 'address', 'area', 'article', 'aside', 'audio', 'b', 'base', 'bdi', 'bdo', 'blockquote', 'body', 'br',
  'button', 'canvas', 'caption', 'cite', 'code', 'col', 'colgroup', 'data', 'datalist', 'dd', 'del', 'details', 'dfn',
  'dialog', 'div', 'dl', 'dt', 'em', 'embed', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr', 'html', 'i', 'iframe', 'img', 'input', 'ins', 'kbd', 'label',
  'legend', 'li', 'link', 'main', 'map', 'mark', 'menu', 'meta', 'meter', 'nav', 'noscript', 'object', 'ol', 'optgroup',
  'option', 'output', 'p', 'picture', 'pre', 'progress', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'script', 'search',
  'section', 'select', 'slot', 'small', 'source', 'span', 'strong', 'style', 'sub', 'summary', 'sup', 'table', 'tbody',
  'td', 'template', 'textarea', 'tfoot', 'th', 'thead', 'time', 'title', 'tr', 'track', 'u', 'ul', 'var', 'video',
  'wbr', 'svg', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'g', 'defs', 'use', 'symbol',
  'text', 'tspan', 'image', 'mask', 'pattern', 'filter', 'marker', 'stop', 'desc', 'view', 'animate', 'math',
  'doctype', 'annotation-xml', 'color-profile', 'font-face', 'font-face-format', 'font-face-name', 'font-face-src',
  'font-face-uri', 'missing-glyph',
])

function isTagNamePartCode(code: number): boolean {
  return isNameStartCode(code) || isDigitCode(code) || code === MINUS || code === DOT || code === COLON
}

function endsAttributeName(code: number): boolean {
  return (
    isWhitespaceCode(code) ||
    code === EQUALS ||
    code === GREATER_THAN ||
    code === LESS_THAN ||
    code === SINGLE_QUOTE ||
    code === DOUBLE_QUOTE
  )
}

function offsetOrEnd(foundOffset: number, end: number): number {
  return foundOffset === -1 || foundOffset > end ? end : foundOffset
}

// HTML, XML or the template of a component, from start to end: comments, tags, attributes and their values, the text
// between tags. The content of a <script> is read as script, that of a <style> as a style sheet.
export function scanMarkup(
  text: string,
  start: number,
  end: number,
  collector: TokenCollector,
  templating: MarkupTemplating,
): void {
  let isLastTagClosedOnItself = false
  let textStart = start

  function addTextUpTo(offset: number): void {
    collector.add(textStart, offset, 'text', false)
    textStart = offset
  }

  // A component of the project: a capitalized or dashed tag that is neither an HTML element nor a tag of the
  // templating language.
  function isComponentTagName(tagName: string): boolean {
    if (!isUppercaseCode(tagName.charCodeAt(0)) && !tagName.includes('-')) {
      return false
    }
    const comparedName = templating.areTagNamesCaseSensitive ? tagName : tagName.toLowerCase()

    return !KNOWN_ELEMENT_NAMES.has(comparedName) && !templating.builtInTagNames.has(tagName)
  }

  function scanQuotedAttributeValue(offset: number, attributeName: string): number {
    const quoteCode = text.charCodeAt(offset)
    if (templating.isScriptAttribute(attributeName)) {
      const closingOffset = offsetOrEnd(text.indexOf(text.charAt(offset), offset + 1), end)
      collector.add(offset, offset + 1, 'punctuation', false)
      scanScript(text, offset + 1, closingOffset, collector, false)
      collector.add(closingOffset, closingOffset + 1, 'punctuation', false)

      return Math.min(closingOffset + 1, end)
    }
    let pieceStart = offset
    let valueOffset = offset + 1
    while (valueOffset < end) {
      const code = text.charCodeAt(valueOffset)
      if (code === quoteCode) {
        collector.add(pieceStart, valueOffset + 1, 'string', false)

        return valueOffset + 1
      }
      if (code === OPENING_BRACE && templating.startsConstructAt(text, valueOffset, 'attributeValue')) {
        collector.add(pieceStart, valueOffset, 'string', false)
        valueOffset = templating.scanConstruct(text, valueOffset, end, collector)
        pieceStart = valueOffset
      } else {
        valueOffset++
      }
    }
    collector.add(pieceStart, end, 'string', false)

    return end
  }

  function scanAttribute(offset: number): number {
    let nameEnd = offset + 1
    while (nameEnd < end) {
      const code = text.charCodeAt(nameEnd)
      if (endsAttributeName(code) || (code === SLASH && text.charCodeAt(nameEnd + 1) === GREATER_THAN)) {
        break
      }
      nameEnd++
    }
    collector.add(offset, nameEnd, 'attribute', false)
    const equalsOffset = offsetAfterWhitespace(text, nameEnd, end)
    if (equalsOffset >= end || text.charCodeAt(equalsOffset) !== EQUALS) {
      return nameEnd
    }
    collector.add(equalsOffset, equalsOffset + 1, 'punctuation', false)
    const valueStart = offsetAfterWhitespace(text, equalsOffset + 1, end)
    const valueCode = valueStart < end ? text.charCodeAt(valueStart) : 0
    if (valueCode === SINGLE_QUOTE || valueCode === DOUBLE_QUOTE) {
      return scanQuotedAttributeValue(valueStart, text.slice(offset, nameEnd))
    }
    let valueEnd = valueStart
    while (valueEnd < end) {
      const code = text.charCodeAt(valueEnd)
      if (isWhitespaceCode(code) || code === GREATER_THAN) {
        break
      }
      valueEnd++
    }
    collector.add(valueStart, valueEnd, 'string', false)

    return valueEnd
  }

  // The attributes of a tag, from the end of its name to the ">" closing it.
  function scanAttributes(from: number): number {
    let offset = from
    isLastTagClosedOnItself = false
    while (offset < end) {
      const code = text.charCodeAt(offset)
      if (isWhitespaceCode(code)) {
        offset++
      } else if (code === GREATER_THAN) {
        collector.add(offset, offset + 1, 'punctuation', false)

        return offset + 1
      } else if ((code === SLASH || code === QUESTION_MARK) && text.charCodeAt(offset + 1) === GREATER_THAN) {
        collector.add(offset, offset + 2, 'punctuation', false)
        isLastTagClosedOnItself = true

        return offset + 2
      } else if (code === LESS_THAN) {
        return offset
      } else if (code === OPENING_BRACE && templating.startsConstructAt(text, offset, 'tag')) {
        offset = templating.scanConstruct(text, offset, end, collector)
      } else if (endsAttributeName(code) || code === SLASH) {
        collector.add(offset, offset + 1, 'punctuation', false)
        offset++
      } else {
        offset = scanAttribute(offset)
      }
    }

    return end
  }

  function scanRawContent(tagName: string, contentStart: number): number {
    const lowercaseTagName = tagName.toLowerCase()
    if (lowercaseTagName !== 'script' && lowercaseTagName !== 'style') {
      return contentStart
    }
    const contentEnd = offsetOrEnd(text.indexOf(`</${tagName}`, contentStart), end)
    if (lowercaseTagName === 'script') {
      scanScript(text, contentStart, contentEnd, collector, false)
    } else {
      scanStyle(text, contentStart, contentEnd, collector)
    }

    return contentEnd
  }

  // What the "<" of the offset opens: a comment, a character data section, a tag. Returns the offset after it, or -1
  // when the "<" is a character of the text.
  function scanFromLessThan(offset: number): number {
    if (text.startsWith('<!--', offset)) {
      addTextUpTo(offset)
      const closingOffset = text.indexOf('-->', offset + 4)
      const commentEnd = closingOffset === -1 || closingOffset + 3 > end ? end : closingOffset + 3
      collector.add(offset, commentEnd, 'comment', false)

      return commentEnd
    }
    if (text.startsWith('<![CDATA[', offset)) {
      addTextUpTo(offset)
      const closingOffset = offsetOrEnd(text.indexOf(']]>', offset + 9), end)
      collector.add(offset, offset + 9, 'punctuation', false)
      collector.add(offset + 9, closingOffset, 'text', false)
      collector.add(closingOffset, Math.min(closingOffset + 3, end), 'punctuation', false)

      return Math.min(closingOffset + 3, end)
    }
    const afterLessThanCode = text.charCodeAt(offset + 1)
    const isClosingTag = afterLessThanCode === SLASH
    const hasMarker = isClosingTag || afterLessThanCode === EXCLAMATION_MARK || afterLessThanCode === QUESTION_MARK
    const nameStart = hasMarker ? offset + 2 : offset + 1
    if (nameStart >= end || !isNameStartCode(text.charCodeAt(nameStart))) {
      return -1
    }
    let nameEnd = nameStart
    while (nameEnd < end && isTagNamePartCode(text.charCodeAt(nameEnd))) {
      nameEnd++
    }
    const tagName = text.slice(nameStart, nameEnd)
    addTextUpTo(offset)
    collector.add(offset, nameStart, 'punctuation', false)
    collector.add(nameStart, nameEnd, 'tag', isComponentTagName(tagName))
    const tagEnd = scanAttributes(nameEnd)

    return isClosingTag || isLastTagClosedOnItself ? tagEnd : scanRawContent(tagName, tagEnd)
  }

  let offset = start
  while (offset < end) {
    const code = text.charCodeAt(offset)
    if (code === LESS_THAN) {
      const constructEnd = scanFromLessThan(offset)
      if (constructEnd === -1) {
        offset++
      } else {
        offset = constructEnd
        textStart = constructEnd
      }
    } else if (code === OPENING_BRACE && templating.startsConstructAt(text, offset, 'content')) {
      addTextUpTo(offset)
      offset = templating.scanConstruct(text, offset, end, collector)
      textStart = offset
    } else {
      offset++
    }
  }
  addTextUpTo(end)
}
