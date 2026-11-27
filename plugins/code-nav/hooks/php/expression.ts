import type { PhpToken, PhpTokenizedSource } from './tokens'

// Token indexes, the end one left out.
export type PhpTokenRange = { start: number; end: number }

export type PhpExpression =
  | { kind: 'variable'; name: string; tokenIndex: number }
  // A name where a class or a constant stands: Order, self, static, parent, PHP_EOL.
  | { kind: 'name'; name: string; tokenIndex: number }
  | { kind: 'instantiation'; className: string | null; tokenIndex: number }
  | { kind: 'methodCall'; receiver: PhpExpression; name: string; isStatic: boolean; argumentRanges: PhpTokenRange[]; tokenIndex: number }
  | { kind: 'propertyAccess'; receiver: PhpExpression; name: string; isStatic: boolean; tokenIndex: number }
  | { kind: 'classConstant'; receiver: PhpExpression; name: string; tokenIndex: number }
  | { kind: 'functionCall'; name: string; argumentRanges: PhpTokenRange[]; tokenIndex: number }
  | { kind: 'invocation'; callee: PhpExpression }
  // key is the literal between the brackets, quotes left out: $row['total'] has the key "total".
  | { kind: 'elementAccess'; receiver: PhpExpression; key: string | null }
  | { kind: 'arrayLiteral'; firstValueRange: PhpTokenRange | null }
  | { kind: 'alternatives'; alternatives: PhpExpression[] }
  | { kind: 'closure' }
  | { kind: 'scalar' }
  | { kind: 'unknown' }

const UNKNOWN_EXPRESSION: PhpExpression = { kind: 'unknown' }
const SCALAR_OPERATORS = new Set([
  '.', '+', '-', '*', '/', '%', '**', '==', '===', '!=', '!==', '<>', '<', '>', '<=', '>=', '<=>', '&&', '||', '!', 'and', 'or', 'xor',
  'instanceof', '&', '|', '^', '<<', '>>', '~',
])
const ASSIGNMENT_OPERATORS = new Set(['=', '??='])
const SCALAR_NAMES = new Set(['true', 'false', 'null', 'TRUE', 'FALSE', 'NULL'])
const NON_CALLABLE_KEYWORDS = new Set([
  'if', 'elseif', 'while', 'for', 'foreach', 'switch', 'match', 'catch', 'return', 'echo', 'print', 'isset', 'unset', 'empty', 'list',
  'array', 'exit', 'die', 'function', 'fn', 'use', 'and', 'or', 'xor', 'new', 'clone', 'include', 'include_once', 'require',
  'require_once', 'declare', 'eval', 'static', 'self', 'parent', 'throw', 'yield', 'else', 'do', 'try', 'finally', 'instanceof',
  'insteadof', 'as', 'case', 'default', 'global', 'namespace', 'class', 'interface', 'trait', 'enum', 'extends', 'implements',
  'public', 'protected', 'private', 'abstract', 'final', 'readonly', 'const', 'var', 'goto', 'break', 'continue',
])

export function isCallableName(name: string): boolean {
  return !NON_CALLABLE_KEYWORDS.has(name.toLowerCase())
}

function isOpeningBracket(text: string): boolean {
  return text === '(' || text === '[' || text === '{' || text === '#['
}

function isClosingBracket(text: string): boolean {
  return text === ')' || text === ']' || text === '}'
}

// The comma-separated parts between two brackets, a named argument's "name:" left out.
export function argumentRangesBetween(source: PhpTokenizedSource, openingIndex: number, closingIndex: number): PhpTokenRange[] {
  const { tokens, matchingBracketIndexes } = source
  const argumentRanges: PhpTokenRange[] = []
  let argumentStart = openingIndex + 1
  const closeArgument = (argumentEnd: number) => {
    const isNamed = tokens[argumentStart]?.kind === 'name' && tokens[argumentStart + 1]?.text === ':'
    const start = isNamed ? argumentStart + 2 : argumentStart
    if (argumentEnd > start) {
      argumentRanges.push({ start, end: argumentEnd })
    }
  }
  let tokenIndex = openingIndex + 1
  while (tokenIndex < closingIndex) {
    const text = tokens[tokenIndex]?.text ?? ''
    const matchingIndex = matchingBracketIndexes[tokenIndex] ?? -1
    if (isOpeningBracket(text) && matchingIndex > tokenIndex) {
      tokenIndex = matchingIndex + 1
      continue
    }
    if (text === ',') {
      closeArgument(tokenIndex)
      argumentStart = tokenIndex + 1
    }
    tokenIndex += 1
  }
  closeArgument(closingIndex)

  return argumentRanges
}

// Where the statement holding a token index stops: its semicolon, or the bracket closing what encloses it.
export function endOfExpressionFrom(source: PhpTokenizedSource, startIndex: number): number {
  const { tokens, matchingBracketIndexes } = source
  let tokenIndex = startIndex
  while (tokenIndex < tokens.length) {
    const text = tokens[tokenIndex]?.text ?? ''
    const matchingIndex = matchingBracketIndexes[tokenIndex] ?? -1
    if (isOpeningBracket(text) && matchingIndex > tokenIndex) {
      tokenIndex = matchingIndex + 1
      continue
    }
    if (text === ';' || text === ',' || isClosingBracket(text)) {
      break
    }
    tokenIndex += 1
  }

  return tokenIndex
}

// The first token of the chain ending at a token index: for "$this->orders->find($id)" ending at ")", "$this".
// Null when what stands there is not a chain of accesses and calls.
export function startOfAccessChain(source: PhpTokenizedSource, lastTokenIndex: number): number | null {
  const { tokens, matchingBracketIndexes } = source
  let tokenIndex = lastTokenIndex
  while (tokenIndex >= 0) {
    const token = tokens[tokenIndex]
    if (token === undefined) {
      return null
    }
    if (token.text === ')' || token.text === ']') {
      const openingIndex = matchingBracketIndexes[tokenIndex] ?? -1
      if (openingIndex === -1) {
        return null
      }
      const before = tokens[openingIndex - 1]
      const isCalleeBefore =
        before !== undefined &&
        (before.kind === 'variable' ||
          before.text === ')' ||
          before.text === ']' ||
          (before.kind === 'name' && (isCallableName(before.text) || isMemberOperator(tokens[openingIndex - 2]?.text ?? ''))))
      if (!isCalleeBefore) {
        return tokens[openingIndex]?.text === '#[' ? null : openingIndex
      }
      tokenIndex = openingIndex - 1
      continue
    }
    if (token.kind === 'name' || token.kind === 'variable') {
      const previousText = tokens[tokenIndex - 1]?.text ?? ''
      if (isMemberOperator(previousText)) {
        tokenIndex -= 2
        continue
      }
      if (previousText === 'new') {
        return tokenIndex - 1
      }

      return tokenIndex
    }
    if (token.kind === 'string' || token.kind === 'number') {
      return tokenIndex
    }

    return null
  }

  return null
}

export function literalKeyOf(token: PhpToken): string | null {
  if (token.kind === 'number') {
    return token.text
  }

  return token.kind === 'string' && /^(['"])[^'"$\\]*\1$/.test(token.text) ? token.text.slice(1, -1) : null
}

function isMemberOperator(text: string): boolean {
  return text === '->' || text === '?->' || text === '::'
}

// Reads the tokens of a range as an expression, as far as navigation needs: chains of accesses and calls, new,
// clone, parentheses, and the alternatives of ?? and ?:. Anything else is a scalar or unknown.
export function parsePhpExpression(source: PhpTokenizedSource, range: PhpTokenRange): PhpExpression {
  const { tokens, matchingBracketIndexes } = source
  let { start, end } = range
  const textAt = (tokenIndex: number): string => (tokenIndex < end ? (tokens[tokenIndex]?.text ?? '') : '')

  while (start < end && (textAt(start) === '&' || textAt(start) === '@')) {
    start += 1
  }
  while (start < end && textAt(start) === '(' && matchingBracketIndexes[start] === end - 1) {
    start += 1
    end -= 1
  }
  if (start >= end) {
    return UNKNOWN_EXPRESSION
  }
  const firstToken = tokens[start]
  if (firstToken === undefined) {
    return UNKNOWN_EXPRESSION
  }
  const isClosureStart = (tokenIndex: number) => textAt(tokenIndex) === 'function' || textAt(tokenIndex) === 'fn'
  if (firstToken.kind === 'name' && (isClosureStart(start) || (firstToken.text === 'static' && isClosureStart(start + 1)))) {
    return { kind: 'closure' }
  }
  if (firstToken.kind === 'name' && firstToken.text === 'match' && textAt(start + 1) === '(') {
    return parseMatchArms(source, { start, end })
  }
  if (firstToken.kind === 'name' && (firstToken.text === 'yield' || firstToken.text === 'throw')) {
    return UNKNOWN_EXPRESSION
  }
  if (firstToken.kind === 'name' && firstToken.text === 'clone') {
    return parsePhpExpression(source, { start: start + 1, end })
  }

  const topLevelIndexesOf = (isWanted: (text: string) => boolean): number[] => {
    const indexes: number[] = []
    let tokenIndex = start
    while (tokenIndex < end) {
      const text = textAt(tokenIndex)
      const matchingIndex = matchingBracketIndexes[tokenIndex] ?? -1
      if (isOpeningBracket(text) && matchingIndex > tokenIndex) {
        tokenIndex = matchingIndex + 1
        continue
      }
      if (isWanted(text)) {
        indexes.push(tokenIndex)
      }
      tokenIndex += 1
    }

    return indexes
  }

  const assignmentIndex = topLevelIndexesOf(text => ASSIGNMENT_OPERATORS.has(text))[0]
  if (assignmentIndex !== undefined) {
    return parsePhpExpression(source, { start: assignmentIndex + 1, end })
  }
  const ternaryIndex = topLevelIndexesOf(text => text === '?')[0]
  if (ternaryIndex !== undefined) {
    const colonIndex = topLevelIndexesOf(text => text === ':').find(tokenIndex => tokenIndex > ternaryIndex)
    if (colonIndex === undefined) {
      return UNKNOWN_EXPRESSION
    }
    const whenTrue = colonIndex === ternaryIndex + 1 ? { start, end: ternaryIndex } : { start: ternaryIndex + 1, end: colonIndex }

    return { kind: 'alternatives', alternatives: [parsePhpExpression(source, whenTrue), parsePhpExpression(source, { start: colonIndex + 1, end })] }
  }
  const coalesceIndexes = topLevelIndexesOf(text => text === '??')
  if (coalesceIndexes.length > 0) {
    const boundaries = [start - 1, ...coalesceIndexes, end]
    const alternatives = boundaries.slice(0, -1).map((boundary, boundaryIndex) =>
      parsePhpExpression(source, { start: boundary + 1, end: boundaries[boundaryIndex + 1] ?? end }),
    )

    return { kind: 'alternatives', alternatives }
  }
  if (topLevelIndexesOf(text => SCALAR_OPERATORS.has(text)).length > 0) {
    return { kind: 'scalar' }
  }

  return parseAccessChain(source, { start, end })
}

// match ($status) { A, B => $first, default => $second }: the value is one of what the arms give.
function parseMatchArms(source: PhpTokenizedSource, range: PhpTokenRange): PhpExpression {
  const { tokens, matchingBracketIndexes } = source
  const armsOpeningIndex = (matchingBracketIndexes[range.start + 1] ?? -1) + 1
  const armsClosingIndex = matchingBracketIndexes[armsOpeningIndex] ?? -1
  if (tokens[armsOpeningIndex]?.text !== '{' || armsClosingIndex !== range.end - 1) {
    return UNKNOWN_EXPRESSION
  }
  const alternatives: PhpExpression[] = []
  for (const armRange of argumentRangesBetween(source, armsOpeningIndex, armsClosingIndex)) {
    let tokenIndex = armRange.start
    while (tokenIndex < armRange.end && tokens[tokenIndex]?.text !== '=>') {
      const matchingIndex = matchingBracketIndexes[tokenIndex] ?? -1
      tokenIndex = matchingIndex > tokenIndex ? matchingIndex + 1 : tokenIndex + 1
    }
    if (tokenIndex < armRange.end - 1) {
      alternatives.push(parsePhpExpression(source, { start: tokenIndex + 1, end: armRange.end }))
    }
  }

  return alternatives.length === 0 ? UNKNOWN_EXPRESSION : { kind: 'alternatives', alternatives }
}

function parseAccessChain(source: PhpTokenizedSource, range: PhpTokenRange): PhpExpression {
  const { tokens, matchingBracketIndexes } = source
  const { start, end } = range
  const firstToken = tokens[start]
  if (firstToken === undefined) {
    return UNKNOWN_EXPRESSION
  }
  const textAt = (tokenIndex: number): string => (tokenIndex < end ? (tokens[tokenIndex]?.text ?? '') : '')
  const closingIndexOf = (openingIndex: number): number => {
    const closingIndex = matchingBracketIndexes[openingIndex] ?? -1

    return closingIndex === -1 || closingIndex >= end ? end - 1 : closingIndex
  }
  let expression: PhpExpression
  let tokenIndex = start + 1

  if (firstToken.kind === 'variable') {
    expression = { kind: 'variable', name: firstToken.text, tokenIndex: start }
  } else if (firstToken.kind === 'string' || firstToken.kind === 'number') {
    expression = { kind: 'scalar' }
  } else if (firstToken.text === '(') {
    const closingIndex = closingIndexOf(start)
    expression = parsePhpExpression(source, { start: start + 1, end: closingIndex })
    tokenIndex = closingIndex + 1
  } else if (firstToken.text === '[') {
    const closingIndex = closingIndexOf(start)
    const firstElement = argumentRangesBetween(source, start, closingIndex)[0]
    let firstValueRange = firstElement ?? null
    if (firstElement !== undefined) {
      for (let elementIndex = firstElement.start; elementIndex < firstElement.end; elementIndex += 1) {
        if (tokens[elementIndex]?.text === '=>') {
          firstValueRange = { start: elementIndex + 1, end: firstElement.end }
          break
        }
        const matchingIndex = matchingBracketIndexes[elementIndex] ?? -1
        if (matchingIndex > elementIndex) {
          elementIndex = matchingIndex
        }
      }
    }
    expression = { kind: 'arrayLiteral', firstValueRange }
    tokenIndex = closingIndex + 1
  } else if (firstToken.kind === 'name' && firstToken.text === 'new') {
    const classToken = tokens[start + 1]
    if (classToken === undefined || start + 1 >= end || classToken.kind !== 'name' || classToken.text === 'class') {
      return UNKNOWN_EXPRESSION
    }
    expression = { kind: 'instantiation', className: classToken.text, tokenIndex: start + 1 }
    tokenIndex = start + 2
    if (textAt(tokenIndex) === '(') {
      tokenIndex = closingIndexOf(tokenIndex) + 1
    }
  } else if (firstToken.kind === 'name' && SCALAR_NAMES.has(firstToken.text)) {
    expression = { kind: 'scalar' }
  } else if (firstToken.kind === 'name' && textAt(start + 1) === '(' && isCallableName(firstToken.text)) {
    const closingIndex = closingIndexOf(start + 1)
    expression = {
      kind: 'functionCall',
      name: firstToken.text,
      argumentRanges: argumentRangesBetween(source, start + 1, closingIndex),
      tokenIndex: start,
    }
    tokenIndex = closingIndex + 1
  } else if (firstToken.kind === 'name') {
    expression = { kind: 'name', name: firstToken.text, tokenIndex: start }
  } else {
    return UNKNOWN_EXPRESSION
  }

  while (tokenIndex < end) {
    const operator = textAt(tokenIndex)
    const memberToken = tokens[tokenIndex + 1]
    if (operator === '->' || operator === '?->' || operator === '::') {
      if (memberToken === undefined || tokenIndex + 1 >= end || (memberToken.kind !== 'name' && memberToken.kind !== 'variable')) {
        return UNKNOWN_EXPRESSION
      }
      const isStatic = operator === '::'
      const isCall = textAt(tokenIndex + 2) === '('
      if (memberToken.kind === 'variable' && !isStatic) {
        return UNKNOWN_EXPRESSION
      }
      if (isCall && memberToken.kind === 'name') {
        const closingIndex = closingIndexOf(tokenIndex + 2)
        expression = {
          kind: 'methodCall',
          receiver: expression,
          name: memberToken.text,
          isStatic,
          argumentRanges: argumentRangesBetween(source, tokenIndex + 2, closingIndex),
          tokenIndex: tokenIndex + 1,
        }
        tokenIndex = closingIndex + 1
      } else if (isStatic && memberToken.kind === 'name') {
        expression = { kind: 'classConstant', receiver: expression, name: memberToken.text, tokenIndex: tokenIndex + 1 }
        tokenIndex += 2
      } else {
        const name = memberToken.kind === 'variable' ? memberToken.text.slice(1) : memberToken.text
        expression = { kind: 'propertyAccess', receiver: expression, name, isStatic, tokenIndex: tokenIndex + 1 }
        tokenIndex += 2
      }
    } else if (operator === '(') {
      expression = { kind: 'invocation', callee: expression }
      tokenIndex = closingIndexOf(tokenIndex) + 1
    } else if (operator === '[') {
      const closingIndex = closingIndexOf(tokenIndex)
      const keyToken = closingIndex === tokenIndex + 2 ? tokens[tokenIndex + 1] : undefined
      expression = { kind: 'elementAccess', receiver: expression, key: keyToken === undefined ? null : literalKeyOf(keyToken) }
      tokenIndex = closingIndex + 1
    } else {
      return UNKNOWN_EXPRESSION
    }
  }

  return expression
}

// The expression a member is read from: for the token "find" of "$this->orders->find($id)", "$this->orders".
export function receiverExpressionOf(source: PhpTokenizedSource, memberTokenIndex: number): PhpExpression {
  const receiverEnd = memberTokenIndex - 1
  const receiverStart = startOfAccessChain(source, receiverEnd - 1)
  if (receiverStart === null) {
    return UNKNOWN_EXPRESSION
  }

  return parsePhpExpression(source, { start: receiverStart, end: receiverEnd })
}
