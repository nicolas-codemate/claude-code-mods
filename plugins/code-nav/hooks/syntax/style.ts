import {
  DOUBLE_QUOTE,
  SINGLE_QUOTE,
  SLASH,
  STAR,
  isWhitespaceCode,
  offsetAfterBlockComment,
  offsetAfterQuotedString,
  offsetOfLineEnd,
} from './scanning'
import type { TokenCollector } from './scanning'

// A style sheet, from start to end: its comments and its strings set apart, everything else plain text. A "//"
// opens a comment only after whitespace, so that the one of "url(https://...)" does not.
export function scanStyle(text: string, start: number, end: number, collector: TokenCollector): void {
  let textStart = start
  let offset = start
  while (offset < end) {
    const code = text.charCodeAt(offset)
    const isBlockComment = code === SLASH && text.charCodeAt(offset + 1) === STAR
    const isLineComment =
      code === SLASH &&
      text.charCodeAt(offset + 1) === SLASH &&
      (offset === start || isWhitespaceCode(text.charCodeAt(offset - 1)))
    if (isBlockComment || isLineComment) {
      const commentEnd = isBlockComment
        ? offsetAfterBlockComment(text, offset, end)
        : offsetOfLineEnd(text, offset, end)
      collector.add(textStart, offset, 'text', false)
      collector.add(offset, commentEnd, 'comment', false)
      offset = commentEnd
      textStart = commentEnd
    } else if (code === SINGLE_QUOTE || code === DOUBLE_QUOTE) {
      const stringEnd = offsetAfterQuotedString(text, offset, end, false)
      collector.add(textStart, offset, 'text', false)
      collector.add(offset, stringEnd, 'string', false)
      offset = stringEnd
      textStart = stringEnd
    } else {
      offset++
    }
  }
  collector.add(textStart, end, 'text', false)
}
