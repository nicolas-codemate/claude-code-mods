import type { TokenKind } from '../../types'
import {
  AMPERSAND,
  BACKSLASH,
  BACKTICK,
  CARET,
  CLOSING_BRACE,
  CLOSING_PARENTHESIS,
  CLOSING_SQUARE,
  COLON,
  COMMA,
  DOLLAR,
  DOT,
  DOUBLE_QUOTE,
  EQUALS,
  EXCLAMATION_MARK,
  GREATER_THAN,
  HASH,
  LESS_THAN,
  MINUS,
  NEWLINE,
  OPENING_BRACE,
  OPENING_PARENTHESIS,
  OPENING_SQUARE,
  PERCENT,
  PIPE,
  PLUS,
  QUESTION_MARK,
  SEMICOLON,
  SINGLE_QUOTE,
  SLASH,
  SPACE,
  STAR,
  isDigitCode,
  isNamePartCode,
  isNameStartCode,
  isUppercaseCode,
  isWhitespaceCode,
  offsetAfterBlockComment,
  offsetAfterInlineWhitespace,
  offsetAfterNumber,
  offsetAfterQuotedString,
  offsetAfterWhitespace,
  offsetOfLineEnd,
} from './scanning'
import type { TokenCollector } from './scanning'

const RESERVED_KEYWORDS = new Set([
  'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'delete', 'do', 'else', 'enum', 'export',
  'extends', 'finally', 'for', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'return', 'switch',
  'throw', 'try', 'typeof', 'var', 'while', 'with', 'yield',
])

// Reserved words that stand for a value: they stay keywords before a colon ("a ? null : b", "default:").
const VALUE_KEYWORDS = new Set(['default', 'false', 'null', 'super', 'this', 'true', 'undefined', 'void'])

// Words that are keywords only where the grammar expects them: a name anywhere else ("const type = order.type").
const CONTEXTUAL_KEYWORDS = new Set([
  'abstract', 'accessor', 'as', 'asserts', 'async', 'declare', 'from', 'get', 'implements', 'infer', 'interface', 'is',
  'keyof', 'module', 'namespace', 'of', 'override', 'private', 'protected', 'public', 'readonly', 'satisfies', 'set',
  'static', 'type', 'unique',
])

const CONTEXTUAL_KEYWORDS_BEFORE_A_BRACKET = new Set([
  'as', 'async', 'is', 'keyof', 'of', 'readonly', 'satisfies', 'static',
])

// An operator written as a word: a contextual word standing before one of them is its operand, hence a name.
const WORD_OPERATORS = new Set(['as', 'in', 'instanceof', 'is', 'of', 'satisfies'])

const PRIMITIVE_TYPE_NAMES = new Set(['any', 'bigint', 'boolean', 'never', 'number', 'string', 'unknown'])
const PRIMITIVE_TYPE_NAMES_ALSO_COMMON_AS_NAMES = new Set(['object', 'symbol'])

const KEYWORDS_BEFORE_A_DECLARED_TYPE = new Set(['class', 'enum', 'interface', 'type'])

// What stood before the token being read, when it is neither a keyword nor a piece of punctuation. The "#" keeps
// these marks apart from every keyword.
const NAME_BEFORE = '#name'
const REQUIRE_BEFORE = '#require'
const LITERAL_BEFORE = '#literal'
const TYPE_ALIAS_EQUALS_BEFORE = '#='
const TYPE_ARGUMENTS_OPENING_BEFORE = '#<'
const FUNCTION_TYPE_ARROW_BEFORE = '#=>'
const TERNARY_COLON_BEFORE = '?:'

const TOKENS_BEFORE_A_TYPE = new Set([
  ':', '|', '&', 'as', 'extends', 'implements', 'infer', 'instanceof', 'is', 'keyof', 'satisfies',
  TYPE_ALIAS_EQUALS_BEFORE, TYPE_ARGUMENTS_OPENING_BEFORE, FUNCTION_TYPE_ARROW_BEFORE,
])

const DEEPEST_NESTING = 60
const LONGEST_TYPE_ARGUMENTS_OF_A_CALL = 200

function isScriptNamePartCode(code: number): boolean {
  return isNamePartCode(code) || code === DOLLAR
}

// "Order", "T" and "URL" are written as types; "MAX_ITEMS" is a constant.
function isWrittenAsType(name: string): boolean {
  if (!isUppercaseCode(name.charCodeAt(0))) {
    return false
  }

  return !(name.includes('_') && name === name.toUpperCase())
}

function isDoubledInAnOperator(code: number): boolean {
  return code === PIPE || code === AMPERSAND || code === QUESTION_MARK || code === EQUALS
}

function isOperatorCode(code: number): boolean {
  return (
    code === EXCLAMATION_MARK ||
    code === LESS_THAN ||
    code === GREATER_THAN ||
    code === PLUS ||
    code === MINUS ||
    code === STAR ||
    code === SLASH ||
    code === PERCENT ||
    code === AMPERSAND ||
    code === PIPE ||
    code === CARET ||
    code === QUESTION_MARK ||
    code === EQUALS
  )
}

// TypeScript or JavaScript from start to end. allowsJsx: a "<" where a value is expected opens an element.
export function scanScript(
  text: string,
  start: number,
  end: number,
  collector: TokenCollector,
  allowsJsx: boolean,
): void {
  let previousSignificant = ''
  let beforePreviousSignificant = ''
  let previousSignificantEnd = -1
  let bracketDepth = 0
  let isInImportClause = false
  let isInExportClause = false
  let isInHeritageList = false
  let isTypeAliasEqualsExpected = false
  let nestingDepth = 0
  // The bracket depth at which each "<" of type arguments still open was written.
  const typeArgumentsDepths: number[] = []
  // The bracket depth inside each open parenthesis written where a type was expected: the parameters of a function
  // type such as "(order: Order) => Invoice", whose arrow is then followed by a type.
  const functionTypeParametersDepths: number[] = []
  let hasClosedFunctionTypeParameters = false
  // The bracket depth of each "?" of a conditional expression still waiting for its ":", which then announces a
  // value and not a type.
  const conditionDepths: number[] = []

  function noteSignificant(significant: string, significantEnd: number): void {
    beforePreviousSignificant = previousSignificant
    previousSignificant = significant
    previousSignificantEnd = significantEnd
  }

  // Whether the next token starts a value rather than continuing one: what tells a regular expression from a
  // division and an element from a comparison.
  function isValueExpected(): boolean {
    if (previousSignificant === '') {
      return true
    }
    const firstCode = previousSignificant.charCodeAt(0)
    if (firstCode === HASH) {
      return false
    }
    if (isNameStartCode(firstCode)) {
      return !VALUE_KEYWORDS.has(previousSignificant) && !PRIMITIVE_TYPE_NAMES.has(previousSignificant)
    }

    return previousSignificant !== ')' && previousSignificant !== ']' && previousSignificant !== '}'
  }

  function isDirectlyInTypeArgumentsAt(depth: number): boolean {
    return typeArgumentsDepths.length > 0 && typeArgumentsDepths[typeArgumentsDepths.length - 1] === depth
  }

  function isDirectlyInTypeArguments(): boolean {
    return isDirectlyInTypeArgumentsAt(bracketDepth)
  }

  function isInTypePosition(): boolean {
    return (
      TOKENS_BEFORE_A_TYPE.has(previousSignificant) ||
      isDirectlyInTypeArguments() ||
      isInHeritageList ||
      isInImportClause ||
      isInExportClause
    )
  }

  function closeTypeArgumentsDeeperThan(depth: number): void {
    while (typeArgumentsDepths.length > 0 && (typeArgumentsDepths[typeArgumentsDepths.length - 1] ?? 0) > depth) {
      typeArgumentsDepths.pop()
    }
  }

  function forgetConditionsDeeperThan(depth: number): void {
    while (conditionDepths.length > 0 && (conditionDepths[conditionDepths.length - 1] ?? 0) > depth) {
      conditionDepths.pop()
    }
  }

  // "order?: Order" and "total?(): number" mark an optional member; any other lone "?" opens a condition.
  function opensCondition(offset: number, nextCode: number): boolean {
    const isOptionalMethod = nextCode === OPENING_PARENTHESIS && previousSignificantEnd === offset
    const isOptionalMember = nextCode === COLON || nextCode === CLOSING_PARENTHESIS || nextCode === COMMA

    return !isOptionalMethod && !isOptionalMember
  }

  // "useState<Order | null>(null)": the "<" touching the name opens type arguments closed right before a "(".
  function isCallWithTypeArguments(openingOffset: number, limit: number): boolean {
    const lookaheadLimit = Math.min(limit, openingOffset + LONGEST_TYPE_ARGUMENTS_OF_A_CALL)
    let depth = 0
    for (let offset = openingOffset; offset < lookaheadLimit; offset++) {
      const code = text.charCodeAt(offset)
      if (code === LESS_THAN) {
        depth++
      } else if (code === GREATER_THAN && text.charCodeAt(offset - 1) !== EQUALS) {
        depth--
        if (depth === 0) {
          return text.charCodeAt(offset + 1) === OPENING_PARENTHESIS
        }
      } else if (code === SEMICOLON && depth === 1) {
        return false
      }
    }

    return false
  }

  function isContextualKeywordHere(name: string, nameEnd: number, limit: number): boolean {
    const nextOffset = offsetAfterInlineWhitespace(text, nameEnd, limit)
    const nextCode = nextOffset < limit ? text.charCodeAt(nextOffset) : 0
    if (name === 'from') {
      return nextCode === SINGLE_QUOTE || nextCode === DOUBLE_QUOTE
    }
    if (isNameStartCode(nextCode) || nextCode === DOLLAR) {
      let nextWordEnd = nextOffset
      while (nextWordEnd < limit && isScriptNamePartCode(text.charCodeAt(nextWordEnd))) {
        nextWordEnd++
      }

      return !WORD_OPERATORS.has(text.slice(nextOffset, nextWordEnd))
    }
    if (nextCode === OPENING_BRACE || nextCode === HASH || nextCode === SINGLE_QUOTE || nextCode === DOUBLE_QUOTE) {
      return true
    }
    if (nextCode === OPENING_PARENTHESIS && name === 'async') {
      return true
    }
    if (nextCode === STAR) {
      return name === 'async' || name === 'static'
    }
    if (nextCode === OPENING_SQUARE || nextCode === OPENING_PARENTHESIS) {
      return nextOffset > nameEnd && CONTEXTUAL_KEYWORDS_BEFORE_A_BRACKET.has(name)
    }

    return false
  }

  function isArrayTypeSuffixAt(offset: number, limit: number): boolean {
    const openingOffset = offsetAfterWhitespace(text, offset, limit)

    return text.charCodeAt(openingOffset) === OPENING_SQUARE && text.charCodeAt(openingOffset + 1) === CLOSING_SQUARE
  }

  function isKeywordHere(name: string, nameEnd: number, nextCode: number, limit: number): boolean {
    if (VALUE_KEYWORDS.has(name)) {
      return true
    }
    if (RESERVED_KEYWORDS.has(name)) {
      return nextCode !== COLON
    }
    if (CONTEXTUAL_KEYWORDS.has(name)) {
      return isContextualKeywordHere(name, nameEnd, limit)
    }
    if (PRIMITIVE_TYPE_NAMES.has(name)) {
      const isCombinedWithAnotherType =
        nextCode === PIPE ||
        nextCode === AMPERSAND ||
        (nextCode === OPENING_SQUARE && isArrayTypeSuffixAt(nameEnd, limit))

      return isInTypePosition() || isCombinedWithAnotherType
    }

    return PRIMITIVE_TYPE_NAMES_ALSO_COMMON_AS_NAMES.has(name) && isInTypePosition()
  }

  function noteKeyword(keyword: string, nextCode: number): void {
    if (keyword === 'import') {
      isInImportClause = nextCode !== OPENING_PARENTHESIS && nextCode !== DOT
    } else if (keyword === 'export') {
      isInExportClause = nextCode === OPENING_BRACE
    } else if (keyword === 'from') {
      isInImportClause = false
      isInExportClause = false
      isTypeAliasEqualsExpected = false
    } else if (keyword === 'extends' || keyword === 'implements') {
      isInHeritageList = typeArgumentsDepths.length === 0
    } else if (keyword === 'type') {
      isInExportClause = previousSignificant === 'export' && nextCode === OPENING_BRACE
      isTypeAliasEqualsExpected = nextCode !== OPENING_BRACE
    }
  }

  function kindOfName(name: string, isCalled: boolean): TokenKind {
    if (KEYWORDS_BEFORE_A_DECLARED_TYPE.has(previousSignificant)) {
      return 'typeName'
    }
    const isTypeLike = isWrittenAsType(name)
    if (previousSignificant === 'new' && isTypeLike) {
      return 'typeName'
    }
    if (isCalled) {
      return 'callName'
    }

    return isTypeLike && isInTypePosition() ? 'typeName' : 'name'
  }

  function scanName(offset: number, limit: number): number {
    let nameEnd = offset + 1
    while (nameEnd < limit && isScriptNamePartCode(text.charCodeAt(nameEnd))) {
      nameEnd++
    }
    const nextOffset = offsetAfterWhitespace(text, nameEnd, limit)
    const nextCode = nextOffset < limit ? text.charCodeAt(nextOffset) : 0
    const isCalled =
      nextCode === OPENING_PARENTHESIS ||
      (text.charCodeAt(nameEnd) === LESS_THAN && isCallWithTypeArguments(nameEnd, limit))
    if (previousSignificant === '.' || previousSignificant === '?.') {
      collector.add(offset, nameEnd, isCalled ? 'callName' : 'property', true)
      noteSignificant(NAME_BEFORE, nameEnd)

      return nameEnd
    }
    const name = text.slice(offset, nameEnd)
    if (isKeywordHere(name, nameEnd, nextCode, limit)) {
      collector.add(offset, nameEnd, 'keyword', false)
      noteKeyword(name, nextCode)
      noteSignificant(name, nameEnd)

      return nameEnd
    }
    collector.add(offset, nameEnd, kindOfName(name, isCalled), true)
    noteSignificant(name === 'require' ? REQUIRE_BEFORE : NAME_BEFORE, nameEnd)

    return nameEnd
  }

  // The string names a file to open after "from", after a bare "import", and as the argument of "import(" or
  // "require(".
  function isModuleSpecifierExpected(): boolean {
    if (previousSignificant === 'from' || previousSignificant === 'import') {
      return true
    }

    const isCalledFunctionALoader =
      beforePreviousSignificant === 'import' || beforePreviousSignificant === REQUIRE_BEFORE

    return previousSignificant === '(' && isCalledFunctionALoader
  }

  // The offset after the regular expression opened at the offset and its flags; -1 when it does not close on its
  // line, the "/" being a division then.
  function offsetAfterRegularExpression(offset: number, limit: number): number {
    let isInCharacterClass = false
    let closingOffset = offset + 1
    while (closingOffset < limit) {
      const code = text.charCodeAt(closingOffset)
      if (code === NEWLINE) {
        return -1
      }
      if (code === BACKSLASH) {
        closingOffset += 2
        continue
      }
      if (code === OPENING_SQUARE) {
        isInCharacterClass = true
      } else if (code === CLOSING_SQUARE) {
        isInCharacterClass = false
      } else if (code === SLASH && !isInCharacterClass) {
        closingOffset++
        while (closingOffset < limit && isNamePartCode(text.charCodeAt(closingOffset))) {
          closingOffset++
        }

        return closingOffset
      }
      closingOffset++
    }

    return -1
  }

  // Code between braces inside a template literal or an element: from the opening piece ("${" or "{") to the "}"
  // closing it, the code keeping its own reading of what came before.
  function scanBracedCode(offset: number, openingLength: number, limit: number): number {
    collector.add(offset, offset + openingLength, 'punctuation', false)
    const reading = { previousSignificant, beforePreviousSignificant, previousSignificantEnd }
    previousSignificant = ''
    beforePreviousSignificant = ''
    nestingDepth++
    const codeEnd = scanCode(offset + openingLength, limit, true)
    nestingDepth--
    previousSignificant = reading.previousSignificant
    beforePreviousSignificant = reading.beforePreviousSignificant
    previousSignificantEnd = reading.previousSignificantEnd
    if (codeEnd < limit && text.charCodeAt(codeEnd) === CLOSING_BRACE) {
      collector.add(codeEnd, codeEnd + 1, 'punctuation', false)

      return codeEnd + 1
    }

    return codeEnd
  }

  function scanTemplateLiteral(start: number, limit: number): number {
    let pieceStart = start
    let offset = start + 1
    while (offset < limit) {
      const code = text.charCodeAt(offset)
      if (code === BACKSLASH) {
        offset += 2
      } else if (code === BACKTICK) {
        collector.add(pieceStart, offset + 1, 'string', false)

        return offset + 1
      } else if (code === DOLLAR && text.charCodeAt(offset + 1) === OPENING_BRACE && nestingDepth < DEEPEST_NESTING) {
        collector.add(pieceStart, offset, 'string', false)
        offset = scanBracedCode(offset, 2, limit)
        pieceStart = offset
      } else {
        offset++
      }
    }
    collector.add(pieceStart, limit, 'string', false)

    return limit
  }

  function offsetAfterElementName(offset: number, limit: number): number {
    let nameEnd = offset
    while (nameEnd < limit) {
      const code = text.charCodeAt(nameEnd)
      if (!isScriptNamePartCode(code) && code !== DOT && code !== MINUS && code !== COLON) {
        break
      }
      nameEnd++
    }

    return nameEnd
  }

  function looksLikeElement(offset: number, limit: number): boolean {
    const firstCode = text.charCodeAt(offset + 1)
    if (firstCode === GREATER_THAN) {
      return true
    }
    if (!isNameStartCode(firstCode)) {
      return false
    }
    const afterName = offsetAfterWhitespace(text, offsetAfterElementName(offset + 1, limit), limit)
    const afterNameCode = afterName < limit ? text.charCodeAt(afterName) : 0
    if (afterNameCode === GREATER_THAN || afterNameCode === OPENING_BRACE) {
      return true
    }
    if (afterNameCode === SLASH) {
      return text.charCodeAt(afterName + 1) === GREATER_THAN
    }

    return isNameStartCode(afterNameCode) && !text.startsWith('extends ', afterName)
  }

  // A capitalized or dotted element name is a component ("<OrderList>", "<Form.Field>"), any other a plain tag.
  function scanElementName(offset: number, limit: number): number {
    const nameEnd = offsetAfterElementName(offset, limit)
    const name = text.slice(offset, nameEnd)
    if (!isUppercaseCode(text.charCodeAt(offset)) && !name.includes('.')) {
      collector.add(offset, nameEnd, 'tag', false)

      return nameEnd
    }
    let segmentStart = offset
    for (let segmentEnd = offset; segmentEnd <= nameEnd; segmentEnd++) {
      if (segmentEnd === nameEnd || text.charCodeAt(segmentEnd) === DOT) {
        collector.add(segmentStart, segmentEnd, 'typeName', true)
        collector.add(segmentEnd, Math.min(segmentEnd + 1, nameEnd), 'punctuation', false)
        segmentStart = segmentEnd + 1
      }
    }

    return nameEnd
  }

  // An element from its "<": its tag, its attributes and, unless it closes itself, its children up to its closing tag.
  function scanElement(start: number, limit: number): number {
    collector.add(start, start + 1, 'punctuation', false)
    let offset = start + 1
    if (text.charCodeAt(offset) !== GREATER_THAN) {
      offset = scanElementName(offset, limit)
    }
    while (offset < limit) {
      const code = text.charCodeAt(offset)
      if (isWhitespaceCode(code)) {
        offset++
      } else if (code === SLASH && text.charCodeAt(offset + 1) === GREATER_THAN) {
        collector.add(offset, offset + 2, 'punctuation', false)

        return offset + 2
      } else if (code === GREATER_THAN) {
        collector.add(offset, offset + 1, 'punctuation', false)

        return scanElementChildren(offset + 1, limit)
      } else if (code === OPENING_BRACE && nestingDepth < DEEPEST_NESTING) {
        offset = scanBracedCode(offset, 1, limit)
      } else if (code === SINGLE_QUOTE || code === DOUBLE_QUOTE) {
        const stringEnd = offsetAfterQuotedString(text, offset, limit, true)
        collector.add(offset, stringEnd, 'string', false)
        offset = stringEnd
      } else if (isScriptNamePartCode(code)) {
        const attributeEnd = offsetAfterElementName(offset, limit)
        collector.add(offset, attributeEnd, 'attribute', false)
        offset = attributeEnd
      } else {
        collector.add(offset, offset + 1, 'punctuation', false)
        offset++
      }
    }

    return limit
  }

  function scanElementChildren(from: number, limit: number): number {
    let textStart = from
    let offset = from
    while (offset < limit) {
      const code = text.charCodeAt(offset)
      if (code === OPENING_BRACE && nestingDepth < DEEPEST_NESTING) {
        collector.add(textStart, offset, 'text', false)
        offset = scanBracedCode(offset, 1, limit)
        textStart = offset
      } else if (code === LESS_THAN && text.charCodeAt(offset + 1) === SLASH) {
        collector.add(textStart, offset, 'text', false)
        collector.add(offset, offset + 2, 'punctuation', false)
        const nameEnd = scanElementName(offset + 2, limit)
        const closingOffset = offsetAfterWhitespace(text, nameEnd, limit)
        if (closingOffset < limit && text.charCodeAt(closingOffset) === GREATER_THAN) {
          collector.add(closingOffset, closingOffset + 1, 'punctuation', false)

          return closingOffset + 1
        }

        return closingOffset
      } else if (code === LESS_THAN && nestingDepth < DEEPEST_NESTING && looksLikeElement(offset, limit)) {
        collector.add(textStart, offset, 'text', false)
        nestingDepth++
        offset = scanElement(offset, limit)
        nestingDepth--
        textStart = offset
      } else {
        offset++
      }
    }
    collector.add(textStart, limit, 'text', false)

    return limit
  }

  function scanLessThan(offset: number, limit: number): number {
    if (allowsJsx && isValueExpected() && nestingDepth < DEEPEST_NESTING && looksLikeElement(offset, limit)) {
      nestingDepth++
      const elementEnd = scanElement(offset, limit)
      nestingDepth--
      noteSignificant(LITERAL_BEFORE, elementEnd)

      return elementEnd
    }
    const nextCode = text.charCodeAt(offset + 1)
    const touchesName = previousSignificantEnd === offset && previousSignificant === NAME_BEFORE
    const startsValueWithName = !allowsJsx && isValueExpected() && isNameStartCode(nextCode)
    const opensTypeArguments = (touchesName && nextCode !== SPACE && nextCode !== EQUALS) || startsValueWithName
    collector.add(offset, offset + 1, 'punctuation', false)
    if (opensTypeArguments) {
      typeArgumentsDepths.push(bracketDepth)
      noteSignificant(TYPE_ARGUMENTS_OPENING_BEFORE, offset + 1)
    } else {
      noteSignificant('<', offset + 1)
    }

    return offset + 1
  }

  function scanPunctuation(offset: number): number {
    const code = text.charCodeAt(offset)
    const nextCode = text.charCodeAt(offset + 1)
    let punctuationEnd = offset + 1
    let significant = text.charAt(offset)
    const closesFunctionTypeParameters = hasClosedFunctionTypeParameters
    hasClosedFunctionTypeParameters = false
    if (code === EQUALS && nextCode === GREATER_THAN) {
      punctuationEnd = offset + 2
      significant = closesFunctionTypeParameters ? FUNCTION_TYPE_ARROW_BEFORE : '=>'
    } else if (code === QUESTION_MARK && nextCode === DOT && !isDigitCode(text.charCodeAt(offset + 2))) {
      punctuationEnd = offset + 2
      significant = '?.'
    } else if (code === DOT && nextCode === DOT && text.charCodeAt(offset + 2) === DOT) {
      punctuationEnd = offset + 3
      significant = '...'
    } else if (nextCode === code && isDoubledInAnOperator(code)) {
      punctuationEnd = offset + 2
      significant = text.slice(offset, offset + 2)
    } else if (code === EQUALS) {
      const isPartOfAnOperator = isOperatorCode(text.charCodeAt(offset - 1))
      if (!isPartOfAnOperator && isTypeAliasEqualsExpected && typeArgumentsDepths.length === 0) {
        significant = TYPE_ALIAS_EQUALS_BEFORE
        isTypeAliasEqualsExpected = false
      }
      isInHeritageList = false
      isInImportClause = false
    } else if (code === OPENING_PARENTHESIS || code === OPENING_SQUARE || code === OPENING_BRACE) {
      bracketDepth++
      const isWhereATypeIsExpected =
        TOKENS_BEFORE_A_TYPE.has(previousSignificant) || isDirectlyInTypeArgumentsAt(bracketDepth - 1)
      if (code === OPENING_PARENTHESIS && isWhereATypeIsExpected) {
        functionTypeParametersDepths.push(bracketDepth)
      }
      if (code !== OPENING_SQUARE) {
        isInHeritageList = false
        isTypeAliasEqualsExpected = false
      }
      if (code === OPENING_PARENTHESIS) {
        isInImportClause = false
      }
    } else if (code === CLOSING_PARENTHESIS || code === CLOSING_SQUARE || code === CLOSING_BRACE) {
      let innermostDepth = functionTypeParametersDepths[functionTypeParametersDepths.length - 1]
      while (innermostDepth !== undefined && innermostDepth >= bracketDepth) {
        functionTypeParametersDepths.pop()
        hasClosedFunctionTypeParameters = code === CLOSING_PARENTHESIS && innermostDepth === bracketDepth
        innermostDepth = functionTypeParametersDepths[functionTypeParametersDepths.length - 1]
      }
      bracketDepth--
      closeTypeArgumentsDeeperThan(bracketDepth)
      forgetConditionsDeeperThan(bracketDepth)
      if (code === CLOSING_BRACE) {
        isInExportClause = false
      }
    } else if (code === SEMICOLON) {
      closeTypeArgumentsDeeperThan(bracketDepth - 1)
      forgetConditionsDeeperThan(bracketDepth - 1)
      isInImportClause = false
      isInExportClause = false
      isInHeritageList = false
      isTypeAliasEqualsExpected = false
    } else if (code === GREATER_THAN && isDirectlyInTypeArguments()) {
      typeArgumentsDepths.pop()
      significant = NAME_BEFORE
    } else if (code === QUESTION_MARK && opensCondition(offset, nextCode)) {
      conditionDepths.push(bracketDepth)
    } else if (code === COLON && conditionDepths[conditionDepths.length - 1] === bracketDepth) {
      conditionDepths.pop()
      significant = TERNARY_COLON_BEFORE
    }
    collector.add(offset, punctuationEnd, 'punctuation', false)
    noteSignificant(significant, punctuationEnd)

    return punctuationEnd
  }

  function isPrivateNameAt(offset: number): boolean {
    return text.charCodeAt(offset) === HASH && isNameStartCode(text.charCodeAt(offset + 1))
  }

  // Code from the offset to the limit. Between the braces of a template literal or of an element, it stops before
  // the "}" closing them instead.
  function scanCode(from: number, limit: number, isBetweenBraces: boolean): number {
    const bracketDepthAtStart = bracketDepth
    let offset = from
    while (offset < limit) {
      const code = text.charCodeAt(offset)
      if (isWhitespaceCode(code)) {
        offset++
      } else if (isNameStartCode(code) || code === DOLLAR || isPrivateNameAt(offset)) {
        offset = scanName(offset, limit)
      } else if (isDigitCode(code) || (code === DOT && isDigitCode(text.charCodeAt(offset + 1)))) {
        const numberEnd = offsetAfterNumber(text, offset, limit)
        collector.add(offset, numberEnd, 'number', false)
        noteSignificant(LITERAL_BEFORE, numberEnd)
        offset = numberEnd
      } else if (code === SINGLE_QUOTE || code === DOUBLE_QUOTE) {
        const stringEnd = offsetAfterQuotedString(text, offset, limit, false)
        collector.add(offset, stringEnd, 'string', isModuleSpecifierExpected())
        isInImportClause = false
        isTypeAliasEqualsExpected = false
        noteSignificant(LITERAL_BEFORE, stringEnd)
        offset = stringEnd
      } else if (code === BACKTICK) {
        offset = scanTemplateLiteral(offset, limit)
        noteSignificant(LITERAL_BEFORE, offset)
      } else if (code === SLASH && text.charCodeAt(offset + 1) === SLASH) {
        const commentEnd = offsetOfLineEnd(text, offset, limit)
        collector.add(offset, commentEnd, 'comment', false)
        offset = commentEnd
      } else if (code === SLASH && text.charCodeAt(offset + 1) === STAR) {
        const commentEnd = offsetAfterBlockComment(text, offset, limit)
        collector.add(offset, commentEnd, 'comment', false)
        offset = commentEnd
      } else if (code === SLASH) {
        const expressionEnd = isValueExpected() ? offsetAfterRegularExpression(offset, limit) : -1
        if (expressionEnd === -1) {
          offset = scanPunctuation(offset)
        } else {
          collector.add(offset, expressionEnd, 'string', false)
          noteSignificant(LITERAL_BEFORE, expressionEnd)
          offset = expressionEnd
        }
      } else if (code === LESS_THAN) {
        offset = scanLessThan(offset, limit)
      } else if (code === CLOSING_BRACE && isBetweenBraces && bracketDepth <= bracketDepthAtStart) {
        return offset
      } else {
        offset = scanPunctuation(offset)
      }
    }

    return limit
  }

  scanCode(start, end, false)
}
