import {
  BACKSLASH,
  BACKTICK,
  DOUBLE_QUOTE,
  SINGLE_QUOTE,
  SLASH,
  STAR,
  isDigitCode,
  isNamePartCode,
  isNameStartCode,
  isWhitespaceCode,
  offsetAfterBlockComment,
  offsetAfterNumber,
  offsetAfterQuotedString,
  offsetOfLineEnd,
} from './scanning'
import type { TokenCollector } from './scanning'

type GenericSyntax = {
  hasSlashComments: boolean
  hasStrings: boolean
  // "App\Entity\Order" written in a text is one name to look up.
  joinsNamesWithBackslash: boolean
  keywords: ReadonlySet<string>
}

const CLIKE_SYNTAX: GenericSyntax = {
  hasSlashComments: true,
  hasStrings: true,
  joinsNamesWithBackslash: false,
  keywords: new Set([
    'abstract', 'as', 'async', 'await', 'bool', 'boolean', 'break', 'case', 'catch', 'char', 'class', 'const',
    'continue', 'default', 'defer', 'delete', 'do', 'double', 'else', 'enum', 'export', 'extends', 'false', 'final',
    'finally', 'float', 'fn', 'for', 'func', 'function', 'go', 'goto', 'if', 'impl', 'implements', 'import', 'in',
    'int', 'interface', 'is', 'let', 'long', 'match', 'mut', 'namespace', 'new', 'nil', 'null', 'override', 'package',
    'private', 'protected', 'pub', 'public', 'return', 'self', 'short', 'static', 'struct', 'super', 'switch', 'this',
    'throw', 'throws', 'trait', 'true', 'try', 'type', 'typedef', 'use', 'using', 'val', 'var', 'void', 'while',
  ]),
}

const PLAIN_SYNTAX: GenericSyntax = {
  hasSlashComments: false,
  hasStrings: false,
  joinsNamesWithBackslash: true,
  keywords: new Set(),
}

function scanGeneric(text: string, start: number, end: number, collector: TokenCollector, syntax: GenericSyntax): void {
  let offset = start
  while (offset < end) {
    const code = text.charCodeAt(offset)
    const nextCode = text.charCodeAt(offset + 1)
    if (isWhitespaceCode(code)) {
      offset++
    } else if (isNameStartCode(code)) {
      let nameEnd = offset + 1
      while (nameEnd < end) {
        const nameCode = text.charCodeAt(nameEnd)
        const isJoiningBackslash =
          syntax.joinsNamesWithBackslash && nameCode === BACKSLASH && isNameStartCode(text.charCodeAt(nameEnd + 1))
        if (!isNamePartCode(nameCode) && !isJoiningBackslash) {
          break
        }
        nameEnd++
      }
      const isKeyword = syntax.keywords.has(text.slice(offset, nameEnd))
      collector.add(offset, nameEnd, isKeyword ? 'keyword' : 'name', !isKeyword)
      offset = nameEnd
    } else if (isDigitCode(code)) {
      const numberEnd = offsetAfterNumber(text, offset, end)
      collector.add(offset, numberEnd, 'number', false)
      offset = numberEnd
    } else if (syntax.hasSlashComments && code === SLASH && nextCode === SLASH) {
      const commentEnd = offsetOfLineEnd(text, offset, end)
      collector.add(offset, commentEnd, 'comment', false)
      offset = commentEnd
    } else if (syntax.hasSlashComments && code === SLASH && nextCode === STAR) {
      const commentEnd = offsetAfterBlockComment(text, offset, end)
      collector.add(offset, commentEnd, 'comment', false)
      offset = commentEnd
    } else if (syntax.hasStrings && (code === DOUBLE_QUOTE || code === SINGLE_QUOTE || code === BACKTICK)) {
      const stringEnd = offsetAfterQuotedString(text, offset, end, code === BACKTICK)
      const isClosed = stringEnd - offset >= 2 && text.charCodeAt(stringEnd - 1) === code
      // An apostrophe that closes nowhere on its line is not a string: a lifetime, a contraction in a text.
      const isString = isClosed || code !== SINGLE_QUOTE
      collector.add(offset, isString ? stringEnd : offset + 1, isString ? 'string' : 'punctuation', false)
      offset = isString ? stringEnd : offset + 1
    } else {
      collector.add(offset, offset + 1, 'punctuation', false)
      offset++
    }
  }
}

// A language with "//" and "/* */" comments and quoted strings: C, Java, Go, Rust, CSS and their relatives.
export function scanClike(text: string, start: number, end: number, collector: TokenCollector): void {
  scanGeneric(text, start, end, collector, CLIKE_SYNTAX)
}

// A text of no known language: its names, so that a click can look one up, and its numbers.
export function scanPlain(text: string, start: number, end: number, collector: TokenCollector): void {
  scanGeneric(text, start, end, collector, PLAIN_SYNTAX)
}
