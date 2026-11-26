import {
  AMPERSAND,
  AT_SIGN,
  BACKSLASH,
  CLOSING_BRACE,
  CLOSING_PARENTHESIS,
  CLOSING_SQUARE,
  COLON,
  DOLLAR,
  DOT,
  DOUBLE_QUOTE,
  GREATER_THAN,
  LESS_THAN,
  MINUS,
  NEWLINE,
  OPENING_BRACE,
  OPENING_PARENTHESIS,
  OPENING_SQUARE,
  PIPE,
  QUESTION_MARK,
  SINGLE_QUOTE,
  SLASH,
  STAR,
  isDigitCode,
  isInlineWhitespaceCode,
  isNamePartCode,
  isNameStartCode,
  isUppercaseCode,
  isWhitespaceCode,
  offsetAfterInlineWhitespace,
  offsetAfterName,
} from './scanning'
import type { TokenCollector } from './scanning'

// What follows a documentation tag. typeThenVariable: one type expression, then maybe the variable it describes
// ("@param Collection<int, Order>|null $orders"). templateName: the name the tag declares, then maybe "of" and its
// bound ("@template T of Order"). typesToLineEnd: names and types all along the line ("@method Order find(int $id)").
type TagContent = 'typeThenVariable' | 'templateName' | 'typesToLineEnd' | 'prose'

const TAG_NAMES_BY_CONTENT: Readonly<Record<Exclude<TagContent, 'prose'>, readonly string[]>> = {
  typeThenVariable: [
    'param', 'param-out', 'return', 'var', 'throws', 'extends', 'implements', 'use', 'mixin', 'property',
    'property-read', 'property-write', 'see', 'link', 'uses', 'covers', 'template-extends', 'template-implements',
    'template-use', 'require-extends', 'require-implements', 'self-out', 'this-out', 'assert', 'assert-if-true',
    'assert-if-false',
  ],
  templateName: ['template', 'template-covariant', 'template-contravariant'],
  typesToLineEnd: ['method', 'type', 'import-type'],
}

const TAG_CONTENT_BY_TAG_NAME = new Map<string, TagContent>(
  Object.entries(TAG_NAMES_BY_CONTENT).flatMap(([tagContent, tagNames]) =>
    tagNames.map((tagName): [string, TagContent] => [tagName, tagContent as TagContent]),
  ),
)

const TOOL_PREFIXES_OF_TAGS = ['phpstan-', 'psalm-', 'phan-']

function tagContentOf(tagName: string): TagContent {
  const toolPrefix = TOOL_PREFIXES_OF_TAGS.find(prefix => tagName.startsWith(prefix))
  const plainTagName = toolPrefix === undefined ? tagName : tagName.slice(toolPrefix.length)

  return TAG_CONTENT_BY_TAG_NAME.get(plainTagName) ?? 'prose'
}

function isOpeningBracketCode(code: number): boolean {
  return code === OPENING_PARENTHESIS || code === LESS_THAN || code === OPENING_BRACE || code === OPENING_SQUARE
}

function isClosingBracketCode(code: number): boolean {
  return code === CLOSING_PARENTHESIS || code === GREATER_THAN || code === CLOSING_BRACE || code === CLOSING_SQUARE
}

// A documentation comment, from its "/**" to its "*/" (or to the end of the range when it is left open): its tags,
// the class names of their type expressions and the variables they describe are set apart from the prose.
export function scanPhpDocblock(text: string, start: number, end: number, collector: TokenCollector): void {
  const contentEnd = text.startsWith('*/', end - 2) && end - 2 >= start + 3 ? end - 2 : end
  let proseStart = start

  function addSetApart(startOffset: number, endOffset: number, kind: 'keyword' | 'typeName' | 'variable'): void {
    collector.add(proseStart, startOffset, 'comment', false)
    collector.add(startOffset, endOffset, kind, kind !== 'keyword')
    proseStart = endOffset
  }

  function offsetAfterVariable(offset: number): number {
    const nameEnd = offsetAfterName(text, offset + 1, contentEnd)
    if (text.startsWith('$this', offset) && nameEnd === offset + 5) {
      return nameEnd
    }
    addSetApart(offset, nameEnd, 'variable')

    return nameEnd
  }

  // A name of a type expression: "Order", "\App\Entity\Order", or a lowercase word such as "int" or "non-empty-string".
  function offsetAfterTypeWord(offset: number): number {
    let wordEnd = offset
    let hasDash = false
    let isNamespaced = false
    while (wordEnd < contentEnd) {
      const code = text.charCodeAt(wordEnd)
      if (isNamePartCode(code)) {
        wordEnd++
      } else if (code === BACKSLASH && isNameStartCode(text.charCodeAt(wordEnd + 1))) {
        isNamespaced = true
        wordEnd++
      } else if (code === MINUS && wordEnd > offset && isNameStartCode(text.charCodeAt(wordEnd + 1))) {
        hasDash = true
        wordEnd++
      } else {
        break
      }
    }
    if (wordEnd === offset) {
      return offset + 1
    }
    const firstNameCode = text.charCodeAt(text.charCodeAt(offset) === BACKSLASH ? offset + 1 : offset)
    if (!hasDash && (isNamespaced || isUppercaseCode(firstNameCode))) {
      addSetApart(offset, wordEnd, 'typeName')
    }

    return wordEnd
  }

  // Reads one type expression and returns the offset where it stops. Whitespace ends it unless a bracket is open,
  // a "|", "&" or ":" visibly continues it, or the whole line is read as types. An open bracket carries it over
  // the following lines of the comment.
  function offsetAfterTypeExpression(from: number, readsToLineEnd: boolean): number {
    const openBracketCodes: number[] = []
    let offset = from
    let previousSignificantCode = 0
    while (offset < contentEnd) {
      const code = text.charCodeAt(offset)
      if (code === NEWLINE) {
        if (openBracketCodes.length === 0) {
          return offset
        }
        offset = offsetAfterInlineWhitespace(text, offset + 1, contentEnd)
        if (text.charCodeAt(offset) === STAR) {
          offset++
        }
      } else if (isWhitespaceCode(code)) {
        const nextOffset = offsetAfterInlineWhitespace(text, offset, contentEnd)
        const nextCode = text.charCodeAt(nextOffset)
        const isContinued =
          previousSignificantCode === COLON ||
          previousSignificantCode === PIPE ||
          previousSignificantCode === AMPERSAND ||
          nextCode === PIPE ||
          (nextCode === AMPERSAND && text.charCodeAt(nextOffset + 1) !== DOLLAR)
        if (openBracketCodes.length === 0 && !readsToLineEnd && !isContinued) {
          return offset
        }
        offset = Math.max(nextOffset, offset + 1)
      } else if (isNameStartCode(code) || (code === BACKSLASH && isNameStartCode(text.charCodeAt(offset + 1)))) {
        const isMemberOfClass = previousSignificantCode === COLON && text.charCodeAt(offset - 1) === COLON
        const isKeyOfArrayShape =
          openBracketCodes[openBracketCodes.length - 1] === OPENING_BRACE && isFollowedByKeyColon(offset)
        if (isMemberOfClass || isKeyOfArrayShape) {
          offset = offsetAfterName(text, offset + 1, contentEnd)
        } else {
          offset = offsetAfterTypeWord(offset)
        }
        previousSignificantCode = 1
      } else if (code === DOLLAR && isNameStartCode(text.charCodeAt(offset + 1))) {
        offset = offsetAfterVariable(offset)
        previousSignificantCode = 1
      } else if (isDigitCode(code)) {
        offset = offsetAfterName(text, offset, contentEnd)
        previousSignificantCode = 1
      } else if (code === SINGLE_QUOTE || code === DOUBLE_QUOTE) {
        offset = offsetAfterLiteralOnLine(offset)
        previousSignificantCode = code
      } else if (code === SLASH) {
        return offset
      } else if (isOpeningBracketCode(code)) {
        openBracketCodes.push(code)
        previousSignificantCode = code
        offset++
      } else if (isClosingBracketCode(code)) {
        if (openBracketCodes.length === 0) {
          return offset
        }
        openBracketCodes.pop()
        previousSignificantCode = code
        offset++
      } else {
        previousSignificantCode = code
        offset++
      }
    }

    return contentEnd
  }

  function isFollowedByKeyColon(offset: number): boolean {
    let afterName = offsetAfterInlineWhitespace(text, offsetAfterName(text, offset, contentEnd), contentEnd)
    if (text.charCodeAt(afterName) === QUESTION_MARK) {
      afterName++
    }

    return text.charCodeAt(afterName) === COLON && text.charCodeAt(afterName + 1) !== COLON
  }

  function offsetAfterLiteralOnLine(offset: number): number {
    const quoteCode = text.charCodeAt(offset)
    let closingOffset = offset + 1
    while (closingOffset < contentEnd) {
      const code = text.charCodeAt(closingOffset)
      if (code === NEWLINE) {
        return closingOffset
      }
      if (code === quoteCode) {
        return closingOffset + 1
      }
      closingOffset++
    }

    return contentEnd
  }

  function offsetAfterDescribedVariable(offset: number): number {
    let variableOffset = offsetAfterInlineWhitespace(text, offset, contentEnd)
    if (text.charCodeAt(variableOffset) === AMPERSAND) {
      variableOffset++
    }
    while (text.charCodeAt(variableOffset) === DOT) {
      variableOffset++
    }
    if (text.charCodeAt(variableOffset) === DOLLAR && isNameStartCode(text.charCodeAt(variableOffset + 1))) {
      return offsetAfterVariable(variableOffset)
    }

    return offset
  }

  function offsetAfterTemplateDeclaration(offset: number): number {
    const nameStart = offsetAfterInlineWhitespace(text, offset, contentEnd)
    if (!isNameStartCode(text.charCodeAt(nameStart))) {
      return offset
    }
    const nameEnd = offsetAfterName(text, nameStart, contentEnd)
    addSetApart(nameStart, nameEnd, 'typeName')
    const boundKeywordStart = offsetAfterInlineWhitespace(text, nameEnd, contentEnd)
    const boundKeywordEnd = offsetAfterName(text, boundKeywordStart, contentEnd)
    const boundKeyword = text.slice(boundKeywordStart, boundKeywordEnd)
    if (boundKeyword !== 'of' && boundKeyword !== 'as') {
      return nameEnd
    }

    return offsetAfterTypeExpression(offsetAfterInlineWhitespace(text, boundKeywordEnd, contentEnd), false)
  }

  // The tag starting at the "@" of the offset, and what its content holds; returns the offset where prose resumes.
  function offsetAfterTag(tagStart: number): number {
    let tagEnd = tagStart + 1
    while (tagEnd < contentEnd) {
      const code = text.charCodeAt(tagEnd)
      const isJoiningCharacter = (code === MINUS || code === BACKSLASH) && isNameStartCode(text.charCodeAt(tagEnd + 1))
      if (!isNamePartCode(code) && !isJoiningCharacter) {
        break
      }
      tagEnd++
    }
    if (isUppercaseCode(text.charCodeAt(tagStart + 1))) {
      addSetApart(tagStart + 1, tagEnd, 'typeName')

      return tagEnd
    }
    addSetApart(tagStart, tagEnd, 'keyword')
    const tagContent = tagContentOf(text.slice(tagStart + 1, tagEnd))
    const contentStart = offsetAfterInlineWhitespace(text, tagEnd, contentEnd)
    switch (tagContent) {
      case 'typeThenVariable':
        return offsetAfterDescribedVariable(offsetAfterTypeExpression(contentStart, false))
      case 'templateName':
        return offsetAfterTemplateDeclaration(contentStart)
      case 'typesToLineEnd':
        return offsetAfterTypeExpression(contentStart, true)
      case 'prose':
        return tagEnd
      default: {
        const unhandledTagContent: never = tagContent
        return unhandledTagContent
      }
    }
  }

  let offset = start + 3
  let isAtStartOfLineContent = true
  while (offset < contentEnd) {
    const code = text.charCodeAt(offset)
    if (code === NEWLINE) {
      offset = offsetAfterInlineWhitespace(text, offset + 1, contentEnd)
      if (text.charCodeAt(offset) === STAR) {
        offset++
      }
      isAtStartOfLineContent = true
    } else if (isInlineWhitespaceCode(code)) {
      offset++
    } else if (
      code === AT_SIGN &&
      (isAtStartOfLineContent || text.charCodeAt(offset - 1) === OPENING_BRACE) &&
      isNameStartCode(text.charCodeAt(offset + 1))
    ) {
      offset = offsetAfterTag(offset)
      isAtStartOfLineContent = false
    } else {
      offset++
      isAtStartOfLineContent = false
    }
  }
  collector.add(proseStart, end, 'comment', false)
}
