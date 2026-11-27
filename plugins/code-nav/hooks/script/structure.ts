import type { ScriptToken } from './tokenizer'

const CLOSER_OF_OPENER: Record<string, string> = { '(': ')', '[': ']', '{': '}', '${': '}' }
const CLOSERS = new Set([')', ']', '}'])

const TYPE_PREFIX_KEYWORDS = new Set(['keyof', 'typeof', 'readonly', 'unique', 'infer', 'new', 'abstract', 'asserts'])
const KEYWORDS_AN_EXPRESSION_CONTINUES_AFTER = new Set([
  'return', 'typeof', 'new', 'await', 'in', 'of', 'instanceof', 'extends', 'as', 'satisfies', 'yield', 'void', 'delete',
  'throw', 'case',
])
const KEYWORDS_CONTINUING_AN_EXPRESSION = new Set(['as', 'in', 'of', 'instanceof', 'satisfies'])
const PUNCTUATION_STARTING_A_STATEMENT = new Set(['(', '[', '{', '@', '!', '~', '++', '--', '...', '<'])
const PUNCTUATION_ENDING_AN_OPERAND = new Set([')', ']', '}', '++', '--', '>'])

export function isPunctuation(token: ScriptToken | undefined, text: string): boolean {
  return token !== undefined && token.kind === 'punctuation' && token.text === text
}

export function isIdentifier(token: ScriptToken | undefined, text?: string): token is ScriptToken {
  return token !== undefined && token.kind === 'identifier' && (text === undefined || token.text === text)
}

// For each bracket, the index of the one that matches it, -1 for any other token and for a bracket left unmatched.
export function matchBrackets(tokens: readonly ScriptToken[]): Int32Array {
  const matchingIndexes = new Int32Array(tokens.length).fill(-1)
  const openIndexes: number[] = []
  const expectedCloserCodes: number[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token === undefined || token.kind !== 'punctuation' || token.text.length > 2) {
      continue
    }
    const code = token.text.charCodeAt(0)
    const isSubstitutionOpener = code === 36 && token.text.length === 2
    if ((token.text.length === 1 && (code === 40 || code === 91 || code === 123)) || isSubstitutionOpener) {
      openIndexes.push(index)
      expectedCloserCodes.push(code === 40 ? 41 : code === 91 ? 93 : 125)
      continue
    }
    if (token.text.length !== 1 || (code !== 41 && code !== 93 && code !== 125)) {
      continue
    }
    for (let stackIndex = openIndexes.length - 1; stackIndex >= 0; stackIndex -= 1) {
      if (expectedCloserCodes[stackIndex] === code) {
        const openIndex = openIndexes[stackIndex] ?? -1
        matchingIndexes[openIndex] = index
        matchingIndexes[index] = openIndex
        openIndexes.length = stackIndex
        expectedCloserCodes.length = stackIndex
        break
      }
    }
  }

  return matchingIndexes
}

// The index after the bracket that closes this one, or after the bracket itself when nothing closes it.
export function indexAfterGroup(matchingIndexes: Int32Array, openIndex: number): number {
  const closeIndex = matchingIndexes[openIndex] ?? -1

  return closeIndex === -1 ? openIndex + 1 : closeIndex + 1
}

// The index after the ">" closing the type arguments or parameters that open at this "<".
export function indexAfterAngleGroup(
  tokens: readonly ScriptToken[],
  matchingIndexes: Int32Array,
  openIndex: number,
): number {
  let depth = 0
  let index = openIndex
  while (index < tokens.length) {
    const token = tokens[index]
    if (token === undefined) {
      break
    }
    if (token.kind === 'punctuation') {
      if (token.text === '<') {
        depth += 1
      } else if (token.text === '>') {
        depth -= 1
        if (depth === 0) {
          return index + 1
        }
      } else if (CLOSER_OF_OPENER[token.text] !== undefined) {
        index = indexAfterGroup(matchingIndexes, index)
        continue
      } else if (token.text === ';' || CLOSERS.has(token.text)) {
        break
      }
    }
    index += 1
  }

  return openIndex + 1
}

// The index after the type that starts at this index; the index itself when no type stands there.
export function indexAfterType(tokens: readonly ScriptToken[], matchingIndexes: Int32Array, startIndex: number): number {
  let index = startIndex
  let pendingConditionalBranches = 0
  let expectsOperand = true
  while (index < tokens.length) {
    const token = tokens[index]
    if (token === undefined) {
      break
    }
    if (expectsOperand) {
      if (token.kind === 'punctuation') {
        if (token.text === '|' || token.text === '&' || token.text === '-' || token.text === '...') {
          index += 1
          continue
        }
        if (token.text === '(') {
          index = indexAfterGroup(matchingIndexes, index)
          if (isPunctuation(tokens[index], '=>')) {
            index += 1
            continue
          }
          expectsOperand = false
          continue
        }
        if (token.text === '{' || token.text === '[') {
          index = indexAfterGroup(matchingIndexes, index)
          expectsOperand = false
          continue
        }
        if (token.text === '<') {
          index = indexAfterAngleGroup(tokens, matchingIndexes, index)
          continue
        }

        return index
      }
      if (token.kind === 'identifier' && TYPE_PREFIX_KEYWORDS.has(token.text) && !isPunctuation(tokens[index + 1], '.')) {
        const nextToken = tokens[index + 1]
        const hasOperandAfter =
          nextToken !== undefined && (nextToken.kind !== 'punctuation' || ['(', '{', '[', '<'].includes(nextToken.text))
        if (hasOperandAfter) {
          index += 1
          continue
        }
      }
      if (token.kind === 'template') {
        index += 1
        while (isPunctuation(tokens[index], '${')) {
          index = indexAfterGroup(matchingIndexes, index)
          if (tokens[index]?.kind === 'template') {
            index += 1
          }
        }
        expectsOperand = false
        continue
      }
      index += 1
      while (isPunctuation(tokens[index], '.') && tokens[index + 1]?.kind === 'identifier') {
        index += 2
      }
      if (isPunctuation(tokens[index], '<') && token.kind === 'identifier') {
        index = indexAfterAngleGroup(tokens, matchingIndexes, index)
      }
      expectsOperand = false
      continue
    }
    if (token.kind === 'punctuation') {
      if (token.text === '[' && !token.followsLineBreak) {
        index = indexAfterGroup(matchingIndexes, index)
        continue
      }
      if (token.text === '|' || token.text === '&') {
        index += 1
        expectsOperand = true
        continue
      }
      if (token.text === '?' && pendingConditionalBranches > 0) {
        index += 1
        expectsOperand = true
        continue
      }
      if (token.text === ':' && pendingConditionalBranches > 0) {
        pendingConditionalBranches -= 1
        index += 1
        expectsOperand = true
        continue
      }

      return index
    }
    if (token.kind === 'identifier' && token.text === 'extends') {
      pendingConditionalBranches += 1
      index += 1
      expectsOperand = true
      continue
    }
    if (token.kind === 'identifier' && token.text === 'is') {
      index += 1
      expectsOperand = true
      continue
    }

    return index
  }

  return index
}

function mayContinueAfter(previousToken: ScriptToken | undefined): boolean {
  if (previousToken === undefined) {
    return false
  }
  if (previousToken.kind === 'punctuation') {
    return !PUNCTUATION_ENDING_AN_OPERAND.has(previousToken.text)
  }

  return previousToken.kind === 'identifier' && KEYWORDS_AN_EXPRESSION_CONTINUES_AFTER.has(previousToken.text)
}

function continuesAnExpression(token: ScriptToken): boolean {
  if (token.kind === 'punctuation') {
    return !PUNCTUATION_STARTING_A_STATEMENT.has(token.text)
  }

  return token.kind === 'identifier' && KEYWORDS_CONTINUING_AN_EXPRESSION.has(token.text)
}

// A token that begins a new statement or member although no semicolon precedes it: the first of a line, after a
// token that completes an expression, and itself no operator.
export function startsAfterImpliedSemicolon(tokens: readonly ScriptToken[], index: number): boolean {
  const token = tokens[index]

  return (
    token !== undefined && token.followsLineBreak && !mayContinueAfter(tokens[index - 1]) && !continuesAnExpression(token)
  )
}

// "new Map<string, Order>()": a "<" glued to the name before it opens type arguments, whose commas separate
// nothing of the expression around; a comparison is written with spaces.
export function opensTypeArguments(tokens: readonly ScriptToken[], index: number): boolean {
  const previousToken = tokens[index - 1]

  return previousToken !== undefined && previousToken.kind === 'identifier' && previousToken.end === tokens[index]?.start
}

// The index of the token that ends the expression starting at this index: a semicolon, an unmatched closing bracket,
// a comma when asked, or the first token of a new statement.
export function indexAfterExpression(
  tokens: readonly ScriptToken[],
  matchingIndexes: Int32Array,
  startIndex: number,
  stopsAtComma: boolean,
): number {
  let index = startIndex
  while (index < tokens.length) {
    const token = tokens[index]
    if (token === undefined) {
      break
    }
    if (token.kind === 'punctuation') {
      if (
        CLOSER_OF_OPENER[token.text] !== undefined &&
        (index === startIndex || !startsAfterImpliedSemicolon(tokens, index))
      ) {
        index = indexAfterGroup(matchingIndexes, index)
        continue
      }
      if (token.text === ';' || CLOSERS.has(token.text) || (token.text === ',' && stopsAtComma)) {
        return index
      }
      if (token.text === '<' && opensTypeArguments(tokens, index)) {
        index = indexAfterAngleGroup(tokens, matchingIndexes, index)
        continue
      }
    }
    if (index > startIndex && startsAfterImpliedSemicolon(tokens, index)) {
      return index
    }
    index += 1
  }

  return index
}

// Whether a function starts at this index: "function", "async function", "(a) =>", "async (a) =>", "a =>".
export function startsFunctionExpression(
  tokens: readonly ScriptToken[],
  matchingIndexes: Int32Array,
  startIndex: number,
): boolean {
  let index = startIndex
  if (isIdentifier(tokens[index], 'async') && !isPunctuation(tokens[index + 1], '=>')) {
    index += 1
  }
  const token = tokens[index]
  if (token === undefined) {
    return false
  }
  if (token.kind === 'identifier') {
    return token.text === 'function' || isPunctuation(tokens[index + 1], '=>')
  }
  if (isPunctuation(token, '<')) {
    index = indexAfterAngleGroup(tokens, matchingIndexes, index)
  }
  if (!isPunctuation(tokens[index], '(')) {
    return false
  }

  return arrowIndexAfterParameters(tokens, matchingIndexes, index) !== -1
}

// The index of the "=>" of the arrow function whose parameters open at this parenthesis, -1 when it is not one.
export function arrowIndexAfterParameters(
  tokens: readonly ScriptToken[],
  matchingIndexes: Int32Array,
  openIndex: number,
): number {
  const closeIndex = matchingIndexes[openIndex] ?? -1
  if (closeIndex === -1) {
    return -1
  }
  if (isPunctuation(tokens[closeIndex + 1], '=>')) {
    return closeIndex + 1
  }
  if (!isPunctuation(tokens[closeIndex + 1], ':')) {
    return -1
  }
  const indexAfterReturnType = indexAfterType(tokens, matchingIndexes, closeIndex + 2)

  return isPunctuation(tokens[indexAfterReturnType], '=>') ? indexAfterReturnType : -1
}
