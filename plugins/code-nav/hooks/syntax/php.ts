import type { TokenKind } from '../../types'
import { scanPhpDocblock } from './php-docblock'
import {
  AMPERSAND,
  BACKSLASH,
  BACKTICK,
  CLOSING_BRACE,
  CLOSING_PARENTHESIS,
  CLOSING_SQUARE,
  COLON,
  COMMA,
  DOLLAR,
  DOT,
  DOUBLE_QUOTE,
  EQUALS,
  GREATER_THAN,
  HASH,
  LESS_THAN,
  MINUS,
  OPENING_BRACE,
  OPENING_PARENTHESIS,
  OPENING_SQUARE,
  PIPE,
  QUESTION_MARK,
  SEMICOLON,
  SINGLE_QUOTE,
  SLASH,
  STAR,
  isDigitCode,
  isNamePartCode,
  isNameStartCode,
  isWhitespaceCode,
  offsetAfterBlockComment,
  offsetAfterInlineWhitespace,
  offsetAfterName,
  offsetAfterNumber,
  offsetAfterQuotedString,
  offsetAfterWhitespace,
  offsetOfLineEnd,
} from './scanning'
import type { TokenCollector } from './scanning'

const TYPE_KEYWORDS = new Set([
  'array', 'bool', 'callable', 'false', 'float', 'int', 'iterable', 'mixed', 'never', 'null', 'object', 'parent',
  'self', 'static', 'string', 'true', 'void',
])

const MODIFIER_KEYWORDS = new Set(['abstract', 'final', 'private', 'protected', 'public', 'readonly', 'static', 'var'])

const OTHER_KEYWORDS = new Set([
  '__class__', '__dir__', '__file__', '__function__', '__line__', '__method__', '__namespace__', '__trait__', 'and',
  'as', 'break', 'case', 'catch', 'class', 'clone', 'const', 'continue', 'declare', 'default', 'die', 'do', 'echo',
  'else', 'elseif', 'empty', 'enddeclare', 'endfor', 'endforeach', 'endif', 'endswitch', 'endwhile', 'enum', 'eval',
  'exit', 'extends', 'finally', 'fn', 'for', 'foreach', 'from', 'function', 'global', 'goto', 'if', 'implements',
  'include', 'include_once', 'instanceof', 'insteadof', 'interface', 'isset', 'list', 'match', 'namespace', 'new', 'or',
  'print', 'require', 'require_once', 'return', 'switch', 'throw', 'trait', 'try', 'unset', 'use', 'while', 'xor',
  'yield',
])

// The keywords after which the next name is a class, an interface, a trait or an enum.
const KEYWORDS_BEFORE_A_TYPE_NAME = new Set(['new', 'instanceof', 'insteadof', 'class', 'interface', 'trait', 'enum'])

// What a bracket encloses: the parameters of a function declaration, the variables a closure captures, the exception
// types of a catch, an attribute, the grouped part of a type ("(Countable&Traversable)|null"), or anything else.
type BracketRole = 'plain' | 'parameters' | 'capturedVariables' | 'caughtTypes' | 'attribute' | 'typeGroup'

const STARTS_WITH_A_TYPE: Readonly<Record<BracketRole, boolean>> = {
  plain: false,
  parameters: true,
  capturedVariables: false,
  caughtTypes: true,
  attribute: false,
  typeGroup: true,
}

const MAY_BE_FOLLOWED_BY_A_RETURN_TYPE: Readonly<Record<BracketRole, boolean>> = {
  plain: false,
  parameters: true,
  capturedVariables: true,
  caughtTypes: false,
  attribute: false,
  typeGroup: false,
}

const IS_PART_OF_A_TYPE: Readonly<Record<BracketRole, boolean>> = {
  plain: false,
  parameters: false,
  capturedVariables: false,
  caughtTypes: false,
  attribute: false,
  typeGroup: true,
}

// Where names are read as types. expression: one type, as long as only names, type keywords, "|", "&" and "?" follow
// each other (a parameter, a property, a return type). list: every name up to the next "{" or ";" (after extends,
// implements and use).
type TypeContext = 'none' | 'expression' | 'list'

const NAME_BEFORE = 'name'
const VARIABLE_BEFORE = 'variable'
const LITERAL_BEFORE = 'literal'
const MEMBER_ACCESS_BEFORE = '->'
const STATIC_ACCESS_BEFORE = '::'
const ATTRIBUTE_OPENING_BEFORE = '#['

const DEEPEST_INTERPOLATION_NESTING = 50
const NO_CLOSING_QUOTE = -1

function offsetOfOpeningTag(text: string, from: number, end: number): number {
  let tagOffset = text.indexOf('<?', from)
  while (tagOffset !== -1 && tagOffset < end) {
    const isLongTag =
      text.startsWith('php', tagOffset + 2) || text.startsWith('PHP', tagOffset + 2)
        ? !isNamePartCode(text.charCodeAt(tagOffset + 5))
        : false
    if (isLongTag || text.charCodeAt(tagOffset + 2) === EQUALS) {
      return tagOffset
    }
    tagOffset = text.indexOf('<?', tagOffset + 2)
  }

  return -1
}

// A PHP file: text up to each "<?php" or "<?=", code up to the "?>" closing it.
export function scanPhp(text: string, start: number, end: number, collector: TokenCollector): void {
  let previousSignificant = ''
  let previousNameEndsWithSeparator = false
  let typeContext: TypeContext = 'none'
  let roleOfNextParenthesis: BracketRole = 'plain'
  let mayReturnTypeFollow = false
  // From a "const" keyword to the "=" or ";" that follows it.
  let isDeclaringConstant = false
  let interpolationNesting = 0
  const bracketRoles: BracketRole[] = []

  function leaveTypeExpression(): void {
    if (typeContext === 'expression') {
      typeContext = 'none'
    }
  }

  function offsetAfterLineComment(offset: number, limit: number): number {
    const lineEnd = offsetOfLineEnd(text, offset, limit)
    for (let closingTagOffset = offset; closingTagOffset < lineEnd - 1; closingTagOffset++) {
      if (
        text.charCodeAt(closingTagOffset) === QUESTION_MARK &&
        text.charCodeAt(closingTagOffset + 1) === GREATER_THAN
      ) {
        return closingTagOffset
      }
    }

    return lineEnd
  }

  // A reserved word is a plain name where the language lets it be one: a constant being declared ("const LIST = 1"),
  // the label of a named argument ("find(default: 1)"), an enum that is not a declaration, a "from" without "yield".
  function isKeywordHere(lowercaseName: string, nextOffset: number, nextCode: number): boolean {
    const isKeyword =
      TYPE_KEYWORDS.has(lowercaseName) || MODIFIER_KEYWORDS.has(lowercaseName) || OTHER_KEYWORDS.has(lowercaseName)
    if (!isKeyword) {
      return false
    }
    if (lowercaseName === 'enum') {
      return isNameStartCode(nextCode)
    }
    if (lowercaseName === 'from') {
      return previousSignificant === 'yield'
    }
    const isDeclaredConstant = isDeclaringConstant && nextCode === EQUALS
    const isArgumentLabel =
      (previousSignificant === '(' || previousSignificant === ',') &&
      nextCode === COLON &&
      text.charCodeAt(nextOffset + 1) !== COLON

    return !isDeclaredConstant && !isArgumentLabel
  }

  function noteKeyword(keyword: string, nextCode: number): void {
    mayReturnTypeFollow = false
    if (keyword === 'function' || keyword === 'fn') {
      roleOfNextParenthesis = 'parameters'
      typeContext = 'none'
    } else if (keyword === 'catch') {
      roleOfNextParenthesis = 'caughtTypes'
      typeContext = 'none'
    } else if (keyword === 'use' || keyword === 'extends' || keyword === 'implements') {
      typeContext = 'list'
    } else if (keyword === 'const') {
      typeContext = 'none'
      isDeclaringConstant = true
    } else if (MODIFIER_KEYWORDS.has(keyword)) {
      const isStaticAccess = keyword === 'static' && nextCode === COLON
      if (typeContext !== 'list' && !isStaticAccess && previousSignificant !== 'new') {
        typeContext = 'expression'
      }
    } else if (!TYPE_KEYWORDS.has(keyword)) {
      leaveTypeExpression()
    }
    previousSignificant = keyword
  }

  function kindOfName(nameEnd: number, nextOffset: number, nextCode: number): TokenKind {
    const isCalled = nextCode === OPENING_PARENTHESIS
    if (previousSignificant === 'function') {
      return isCalled ? 'callName' : 'name'
    }
    if (KEYWORDS_BEFORE_A_TYPE_NAME.has(previousSignificant) || previousSignificant === ATTRIBUTE_OPENING_BEFORE) {
      return 'typeName'
    }
    if (typeContext === 'list') {
      return text.charCodeAt(nameEnd - 1) === BACKSLASH ? 'name' : 'typeName'
    }
    if (nextCode === COLON && text.charCodeAt(nextOffset + 1) === COLON) {
      return 'typeName'
    }
    if (isCalled) {
      return 'callName'
    }
    if (isDeclaringConstant) {
      return isNameStartCode(nextCode) ? 'typeName' : 'name'
    }
    if (typeContext === 'expression' || nextCode === DOLLAR) {
      return 'typeName'
    }

    return 'name'
  }

  // A name keeps its namespace separators: "\App\Entity\Order" is one piece, as is the "App\Entity\" before the
  // braces of a grouped use.
  function offsetAfterNameWithSeparators(offset: number, limit: number): number {
    let nameEnd = text.charCodeAt(offset) === BACKSLASH ? offset + 1 : offset
    while (nameEnd < limit) {
      const code = text.charCodeAt(nameEnd)
      if (isNamePartCode(code)) {
        nameEnd++
      } else if (code === BACKSLASH) {
        const followingCode = text.charCodeAt(nameEnd + 1)
        if (isNameStartCode(followingCode)) {
          nameEnd++
        } else if (followingCode === OPENING_BRACE) {
          return nameEnd + 1
        } else {
          break
        }
      } else {
        break
      }
    }

    return nameEnd
  }

  function scanName(offset: number, limit: number): number {
    const nameEnd = offsetAfterNameWithSeparators(offset, limit)
    const nextOffset = offsetAfterWhitespace(text, nameEnd, end)
    const nextCode = nextOffset < end ? text.charCodeAt(nextOffset) : 0
    if (previousSignificant === MEMBER_ACCESS_BEFORE || previousSignificant === STATIC_ACCESS_BEFORE) {
      const isClassConstantOfType = previousSignificant === STATIC_ACCESS_BEFORE && text.startsWith('class', offset)
      if (isClassConstantOfType && nameEnd === offset + 5) {
        collector.add(offset, nameEnd, 'keyword', false)
      } else {
        collector.add(offset, nameEnd, nextCode === OPENING_PARENTHESIS ? 'callName' : 'property', true)
      }
      previousSignificant = NAME_BEFORE
      previousNameEndsWithSeparator = false
      mayReturnTypeFollow = false

      return nameEnd
    }
    const lowercaseName = text.slice(offset, nameEnd).toLowerCase()
    if (previousSignificant !== 'function' && isKeywordHere(lowercaseName, nextOffset, nextCode)) {
      collector.add(offset, nameEnd, 'keyword', false)
      noteKeyword(lowercaseName, nextCode)

      return nameEnd
    }
    collector.add(offset, nameEnd, kindOfName(nameEnd, nextOffset, nextCode), true)
    previousSignificant = NAME_BEFORE
    previousNameEndsWithSeparator = text.charCodeAt(nameEnd - 1) === BACKSLASH
    mayReturnTypeFollow = false

    return nameEnd
  }

  function scanVariable(offset: number, limit: number): number {
    const nameEnd = offsetAfterName(text, offset + 1, limit)
    const isThis = nameEnd === offset + 5 && text.startsWith('$this', offset)
    collector.add(offset, nameEnd, isThis ? 'keyword' : 'variable', !isThis)
    previousSignificant = VARIABLE_BEFORE
    mayReturnTypeFollow = false
    leaveTypeExpression()

    return nameEnd
  }

  // The text of a double-quoted string or of a heredoc, from the offset to its closing quote (to the limit for a
  // heredoc, which has none): "$order", "$order->total" and "{$order->total()}" are code inside the string.
  function scanInterpolatedText(start: number, limit: number, closingQuoteCode: number): number {
    let pieceStart = start
    let offset = closingQuoteCode === NO_CLOSING_QUOTE ? start : start + 1
    while (offset < limit) {
      const code = text.charCodeAt(offset)
      if (code === BACKSLASH) {
        offset += 2
      } else if (code === closingQuoteCode) {
        collector.add(pieceStart, offset + 1, 'string', false)

        return offset + 1
      } else if (code === DOLLAR && isNameStartCode(text.charCodeAt(offset + 1))) {
        collector.add(pieceStart, offset, 'string', false)
        const nameEnd = offsetAfterName(text, offset + 1, limit)
        const isThis = nameEnd === offset + 5 && text.startsWith('$this', offset)
        collector.add(offset, nameEnd, isThis ? 'keyword' : 'variable', !isThis)
        offset = nameEnd
        if (text.startsWith('->', offset) && isNameStartCode(text.charCodeAt(offset + 2))) {
          const propertyEnd = offsetAfterName(text, offset + 2, limit)
          collector.add(offset, offset + 2, 'punctuation', false)
          collector.add(offset + 2, propertyEnd, 'property', true)
          offset = propertyEnd
        }
        pieceStart = offset
      } else if (
        code === OPENING_BRACE &&
        text.charCodeAt(offset + 1) === DOLLAR &&
        interpolationNesting < DEEPEST_INTERPOLATION_NESTING
      ) {
        collector.add(pieceStart, offset, 'string', false)
        collector.add(offset, offset + 1, 'punctuation', false)
        offset = scanCodeInsideString(offset + 1, limit)
        if (offset < limit && text.charCodeAt(offset) === CLOSING_BRACE) {
          collector.add(offset, offset + 1, 'punctuation', false)
          offset++
        }
        pieceStart = offset
      } else {
        offset++
      }
    }
    collector.add(pieceStart, limit, 'string', false)

    return limit
  }

  function scanCodeInsideString(offset: number, limit: number): number {
    const reading = { previousSignificant, previousNameEndsWithSeparator, typeContext, roleOfNextParenthesis }
    previousSignificant = ''
    typeContext = 'none'
    roleOfNextParenthesis = 'plain'
    interpolationNesting++
    const codeEnd = scanCode(offset, limit, true)
    interpolationNesting--
    previousSignificant = reading.previousSignificant
    previousNameEndsWithSeparator = reading.previousNameEndsWithSeparator
    typeContext = reading.typeContext
    roleOfNextParenthesis = reading.roleOfNextParenthesis

    return codeEnd
  }

  // "<<<LABEL", "<<<"LABEL"" or "<<<'LABEL'" (a nowdoc: nothing is code inside), closed by the label alone at the
  // start of a line, indented or not. Returns -1 when the offset does not open one.
  function scanHeredoc(offset: number, limit: number): number {
    let labelStart = offsetAfterInlineWhitespace(text, offset + 3, limit)
    const quoteCode = text.charCodeAt(labelStart)
    const isQuoted = quoteCode === SINGLE_QUOTE || quoteCode === DOUBLE_QUOTE
    if (isQuoted) {
      labelStart++
    }
    if (!isNameStartCode(text.charCodeAt(labelStart))) {
      return -1
    }
    const labelEnd = offsetAfterName(text, labelStart, limit)
    const label = text.slice(labelStart, labelEnd)
    const bodyStart = offsetOfLineEnd(text, labelEnd, limit) + 1
    collector.add(offset, bodyStart - 1, 'string', false)
    let lineStart = bodyStart
    while (lineStart < limit) {
      const lineContentStart = offsetAfterInlineWhitespace(text, lineStart, limit)
      const labelEndOnLine = lineContentStart + label.length
      if (text.startsWith(label, lineContentStart) && !isNamePartCode(text.charCodeAt(labelEndOnLine))) {
        scanHeredocBody(bodyStart, lineStart, quoteCode === SINGLE_QUOTE)
        collector.add(lineContentStart, labelEndOnLine, 'string', false)

        return labelEndOnLine
      }
      lineStart = offsetOfLineEnd(text, lineStart, limit) + 1
    }
    scanHeredocBody(bodyStart, limit, quoteCode === SINGLE_QUOTE)

    return limit
  }

  function scanHeredocBody(bodyStart: number, bodyEnd: number, isNowdoc: boolean): void {
    if (bodyStart >= bodyEnd) {
      return
    }
    if (isNowdoc) {
      collector.add(bodyStart, bodyEnd, 'string', false)
    } else {
      scanInterpolatedText(bodyStart, bodyEnd, NO_CLOSING_QUOTE)
    }
  }

  function openBracket(role: BracketRole): void {
    bracketRoles.push(role)
    roleOfNextParenthesis = 'plain'
    typeContext = STARTS_WITH_A_TYPE[role] ? 'expression' : 'none'
  }

  function closeBracket(): void {
    const closedRole = bracketRoles.pop() ?? 'plain'
    const enclosingRole = bracketRoles[bracketRoles.length - 1] ?? 'plain'
    const isTypeResumed = closedRole === 'attribute' && STARTS_WITH_A_TYPE[enclosingRole]
    mayReturnTypeFollow = MAY_BE_FOLLOWED_BY_A_RETURN_TYPE[closedRole]
    typeContext = IS_PART_OF_A_TYPE[closedRole] || isTypeResumed ? 'expression' : 'none'
  }

  function scanPunctuation(offset: number): number {
    const code = text.charCodeAt(offset)
    const nextCode = text.charCodeAt(offset + 1)
    const couldReturnTypeFollow = mayReturnTypeFollow
    mayReturnTypeFollow = false
    let punctuationEnd = offset + 1
    let significant = text.charAt(offset)
    if (code === MINUS && nextCode === GREATER_THAN) {
      punctuationEnd = offset + 2
      significant = MEMBER_ACCESS_BEFORE
      leaveTypeExpression()
    } else if (code === QUESTION_MARK && nextCode === MINUS && text.charCodeAt(offset + 2) === GREATER_THAN) {
      punctuationEnd = offset + 3
      significant = MEMBER_ACCESS_BEFORE
      leaveTypeExpression()
    } else if (code === COLON && nextCode === COLON) {
      punctuationEnd = offset + 2
      significant = STATIC_ACCESS_BEFORE
      leaveTypeExpression()
    } else if (code === EQUALS && nextCode === GREATER_THAN) {
      punctuationEnd = offset + 2
      significant = '=>'
      leaveTypeExpression()
    } else if (code === OPENING_PARENTHESIS) {
      const isTypeGroup = typeContext === 'expression' && roleOfNextParenthesis === 'plain'
      const roleUnlessCapture = isTypeGroup ? 'typeGroup' : roleOfNextParenthesis
      openBracket(previousSignificant === 'use' ? 'capturedVariables' : roleUnlessCapture)
    } else if (code === OPENING_SQUARE) {
      openBracket('plain')
    } else if (code === OPENING_BRACE) {
      const isAfterNamespacePrefix = previousNameEndsWithSeparator && previousSignificant === NAME_BEFORE
      const isGroupedUse = typeContext === 'list' && isAfterNamespacePrefix
      openBracket('plain')
      typeContext = isGroupedUse ? 'list' : 'none'
    } else if (code === CLOSING_PARENTHESIS || code === CLOSING_SQUARE || code === CLOSING_BRACE) {
      closeBracket()
    } else if (code === COMMA) {
      const enclosingRole = bracketRoles[bracketRoles.length - 1] ?? 'plain'
      if (enclosingRole === 'attribute') {
        significant = ATTRIBUTE_OPENING_BEFORE
      }
      if (typeContext !== 'list') {
        typeContext = STARTS_WITH_A_TYPE[enclosingRole] ? 'expression' : 'none'
      }
    } else if (code === COLON) {
      typeContext = couldReturnTypeFollow ? 'expression' : typeContext === 'list' ? 'list' : 'none'
    } else if (code === SEMICOLON) {
      typeContext = 'none'
      roleOfNextParenthesis = 'plain'
      isDeclaringConstant = false
    } else if (code === EQUALS) {
      isDeclaringConstant = false
      leaveTypeExpression()
    } else if (code !== PIPE && code !== AMPERSAND && code !== QUESTION_MARK) {
      leaveTypeExpression()
    }
    collector.add(offset, punctuationEnd, 'punctuation', false)
    previousSignificant = significant

    return punctuationEnd
  }

  // Code from the offset to the "?>" closing it, which is consumed, or to the limit. Inside a string, the code of a
  // "{$...}" stops before the "}" closing it instead.
  function scanCode(from: number, limit: number, isInsideString: boolean): number {
    const openBracketCountAtStart = bracketRoles.length
    let offset = from
    while (offset < limit) {
      const code = text.charCodeAt(offset)
      if (isWhitespaceCode(code)) {
        offset++
      } else if (isNameStartCode(code) || (code === BACKSLASH && isNameStartCode(text.charCodeAt(offset + 1)))) {
        offset = scanName(offset, limit)
      } else if (code === DOLLAR && isNameStartCode(text.charCodeAt(offset + 1))) {
        offset = scanVariable(offset, limit)
      } else if (isDigitCode(code) || (code === DOT && isDigitCode(text.charCodeAt(offset + 1)))) {
        const numberEnd = offsetAfterNumber(text, offset, limit)
        collector.add(offset, numberEnd, 'number', false)
        previousSignificant = LITERAL_BEFORE
        leaveTypeExpression()
        offset = numberEnd
      } else if (code === SINGLE_QUOTE) {
        const stringEnd = offsetAfterQuotedString(text, offset, limit, true)
        collector.add(offset, stringEnd, 'string', false)
        previousSignificant = LITERAL_BEFORE
        leaveTypeExpression()
        offset = stringEnd
      } else if (code === DOUBLE_QUOTE || code === BACKTICK) {
        offset = scanInterpolatedText(offset, limit, code)
        previousSignificant = LITERAL_BEFORE
        leaveTypeExpression()
      } else if (code === SLASH && text.charCodeAt(offset + 1) === STAR) {
        const commentEnd = offsetAfterBlockComment(text, offset, limit)
        if (text.charCodeAt(offset + 2) === STAR && text.charCodeAt(offset + 3) !== SLASH) {
          scanPhpDocblock(text, offset, commentEnd, collector)
        } else {
          collector.add(offset, commentEnd, 'comment', false)
        }
        offset = commentEnd
      } else if (code === SLASH && text.charCodeAt(offset + 1) === SLASH) {
        const commentEnd = offsetAfterLineComment(offset, limit)
        collector.add(offset, commentEnd, 'comment', false)
        offset = commentEnd
      } else if (code === HASH && text.charCodeAt(offset + 1) === OPENING_SQUARE) {
        collector.add(offset, offset + 2, 'punctuation', false)
        openBracket('attribute')
        previousSignificant = ATTRIBUTE_OPENING_BEFORE
        offset += 2
      } else if (code === HASH) {
        const commentEnd = offsetAfterLineComment(offset, limit)
        collector.add(offset, commentEnd, 'comment', false)
        offset = commentEnd
      } else if (code === QUESTION_MARK && text.charCodeAt(offset + 1) === GREATER_THAN && !isInsideString) {
        collector.add(offset, offset + 2, 'keyword', false)

        return offset + 2
      } else if (code === CLOSING_BRACE && isInsideString && bracketRoles.length <= openBracketCountAtStart) {
        return offset
      } else {
        const heredocEnd =
          code === LESS_THAN && text.startsWith('<<<', offset) && !isInsideString ? scanHeredoc(offset, limit) : -1
        if (heredocEnd === -1) {
          offset = scanPunctuation(offset)
        } else {
          previousSignificant = LITERAL_BEFORE
          leaveTypeExpression()
          offset = heredocEnd
        }
      }
    }

    return limit
  }

  let offset = start
  while (offset < end) {
    const openingTagOffset = offsetOfOpeningTag(text, offset, end)
    if (openingTagOffset === -1) {
      collector.add(offset, end, 'text', false)

      return
    }
    collector.add(offset, openingTagOffset, 'text', false)
    const openingTagEnd = openingTagOffset + (text.charCodeAt(openingTagOffset + 2) === EQUALS ? 3 : 5)
    collector.add(openingTagOffset, openingTagEnd, 'keyword', false)
    previousSignificant = ''
    typeContext = 'none'
    offset = scanCode(openingTagEnd, end, false)
  }
}
