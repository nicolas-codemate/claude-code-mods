import { indexAfterAngleGroup, indexAfterExpression, indexAfterGroup, indexAfterType, isIdentifier, isPunctuation } from './structure'
import type { ScriptToken } from './tokenizer'

// One name a pattern binds. sourceProperty is the key it is read from when the pattern destructures an object at its
// first level: "load" for both names of "const { load, load: reload } = useOrders()"; keyTokenIndex is that key when
// the name is renamed.
export type BoundName = { tokenIndex: number; sourceProperty: string | null; keyTokenIndex: number | null }

export type PatternReading = { boundNames: BoundName[]; indexAfterPattern: number }

export type ParameterReading = {
  boundNames: BoundName[]
  patternStartIndex: number
  indexAfterPattern: number
  // The parameter of a constructor that is also a property: "private readonly repository: OrderRepository".
  isProperty: boolean
  typeTokenIndex: number | null
  defaultValueTokenIndex: number | null
}

const PARAMETER_MODIFIERS = new Set(['public', 'private', 'protected', 'readonly', 'override'])
const TYPE_KEYWORDS_NAMING_NO_DECLARATION = new Set([
  'string', 'number', 'boolean', 'void', 'any', 'unknown', 'never', 'null', 'undefined', 'object', 'symbol', 'bigint',
  'true', 'false', 'this',
])

// The index of the type's name when the type at this index is one plain name ("Order", "Order<Line>",
// "Order | null"), its type arguments left aside; null for anything else, whose members cannot be read from a single declaration.
export function plainTypeNameIndex(
  tokens: readonly ScriptToken[],
  matchingIndexes: Int32Array,
  typeStartIndex: number,
): number | null {
  let nameIndex = typeStartIndex
  if (!isIdentifier(tokens[nameIndex]) || TYPE_KEYWORDS_NAMING_NO_DECLARATION.has(tokens[nameIndex]?.text ?? '')) {
    return null
  }
  while (isPunctuation(tokens[nameIndex + 1], '.') && isIdentifier(tokens[nameIndex + 2])) {
    nameIndex += 2
  }
  let indexAfterName = nameIndex + 1
  if (isPunctuation(tokens[indexAfterName], '<')) {
    indexAfterName = indexAfterAngleGroup(tokens, matchingIndexes, indexAfterName)
  }
  while (
    isPunctuation(tokens[indexAfterName], '|') &&
    ['null', 'undefined'].includes(tokens[indexAfterName + 1]?.text ?? '')
  ) {
    indexAfterName += 2
  }
  const indexAfterWholeType = indexAfterType(tokens, matchingIndexes, typeStartIndex)

  return indexAfterWholeType === indexAfterName ? nameIndex : null
}

function readObjectPattern(
  tokens: readonly ScriptToken[],
  matchingIndexes: Int32Array,
  openIndex: number,
  isFirstLevel: boolean,
  boundNames: BoundName[],
): void {
  const closeIndex = matchingIndexes[openIndex] ?? -1
  let index = openIndex + 1
  while (index < closeIndex) {
    const keyToken = tokens[index]
    if (keyToken === undefined) {
      return
    }
    if (isPunctuation(keyToken, '...')) {
      index = readPatternInto(tokens, matchingIndexes, index + 1, false, boundNames)
    } else if (isPunctuation(keyToken, '[') || isPunctuation(tokens[index + 1], ':')) {
      const valueIndex = isPunctuation(keyToken, '[') ? indexAfterGroup(matchingIndexes, index) + 1 : index + 2
      const sourceProperty = isFirstLevel && keyToken.kind === 'identifier' ? keyToken.text : null
      if (isIdentifier(tokens[valueIndex])) {
        boundNames.push({ tokenIndex: valueIndex, sourceProperty, keyTokenIndex: sourceProperty === null ? null : index })
        index = valueIndex + 1
      } else {
        index = readPatternInto(tokens, matchingIndexes, valueIndex, false, boundNames)
      }
    } else if (isIdentifier(keyToken)) {
      boundNames.push({ tokenIndex: index, sourceProperty: isFirstLevel ? keyToken.text : null, keyTokenIndex: null })
      index += 1
    } else {
      return
    }
    if (isPunctuation(tokens[index], '=')) {
      index = indexAfterExpression(tokens, matchingIndexes, index + 1, true)
    }
    if (!isPunctuation(tokens[index], ',')) {
      return
    }
    index += 1
  }
}

function readArrayPattern(
  tokens: readonly ScriptToken[],
  matchingIndexes: Int32Array,
  openIndex: number,
  boundNames: BoundName[],
): void {
  const closeIndex = matchingIndexes[openIndex] ?? -1
  let index = openIndex + 1
  while (index < closeIndex) {
    if (isPunctuation(tokens[index], ',')) {
      index += 1
      continue
    }
    if (isPunctuation(tokens[index], '...')) {
      index += 1
    }
    const elementToken = tokens[index]
    if (!isIdentifier(elementToken) && !isPunctuation(elementToken, '{') && !isPunctuation(elementToken, '[')) {
      return
    }
    index = readPatternInto(tokens, matchingIndexes, index, false, boundNames)
    if (isPunctuation(tokens[index], '=')) {
      index = indexAfterExpression(tokens, matchingIndexes, index + 1, true)
    }
  }
}

function readPatternInto(
  tokens: readonly ScriptToken[],
  matchingIndexes: Int32Array,
  startIndex: number,
  isFirstLevel: boolean,
  boundNames: BoundName[],
): number {
  const startToken = tokens[startIndex]
  if (isIdentifier(startToken)) {
    boundNames.push({ tokenIndex: startIndex, sourceProperty: null, keyTokenIndex: null })

    return startIndex + 1
  }
  const closeIndex = matchingIndexes[startIndex] ?? -1
  if (closeIndex === -1) {
    return startIndex + 1
  }
  if (isPunctuation(startToken, '{')) {
    readObjectPattern(tokens, matchingIndexes, startIndex, isFirstLevel, boundNames)
  } else if (isPunctuation(startToken, '[')) {
    readArrayPattern(tokens, matchingIndexes, startIndex, boundNames)
  }

  return closeIndex + 1
}

// The names bound by the pattern at this index: one name, or the names an object or array destructuring declares.
export function readBindingPattern(
  tokens: readonly ScriptToken[],
  matchingIndexes: Int32Array,
  startIndex: number,
): PatternReading {
  const boundNames: BoundName[] = []
  const indexAfterPattern = readPatternInto(tokens, matchingIndexes, startIndex, true, boundNames)

  return { boundNames, indexAfterPattern }
}

// The parameters between two indexes: those of a function between its parentheses, or the names a Vue template
// directive declares ("order, index" of a v-for, the slot props of a v-slot).
export function readParameterList(
  tokens: readonly ScriptToken[],
  matchingIndexes: Int32Array,
  startIndex: number,
  endIndex: number,
): ParameterReading[] {
  const parameters: ParameterReading[] = []
  let index = startIndex
  while (index < endIndex) {
    while (isPunctuation(tokens[index], '@')) {
      index += 2
      while (isPunctuation(tokens[index], '.')) {
        index += 2
      }
      if (isPunctuation(tokens[index], '(')) {
        index = indexAfterGroup(matchingIndexes, index)
      }
    }
    let isProperty = false
    while (
      isIdentifier(tokens[index]) &&
      PARAMETER_MODIFIERS.has(tokens[index]?.text ?? '') &&
      isBindingStart(tokens[index + 1])
    ) {
      isProperty = true
      index += 1
    }
    if (isPunctuation(tokens[index], '...')) {
      index += 1
    }
    if (!isBindingStart(tokens[index])) {
      break
    }
    const pattern = readBindingPattern(tokens, matchingIndexes, index)
    const isThisParameter = isIdentifier(tokens[index], 'this')
    const patternStartIndex = index
    index = pattern.indexAfterPattern
    if (isPunctuation(tokens[index], '?')) {
      index += 1
    }
    let typeTokenIndex: number | null = null
    if (isPunctuation(tokens[index], ':')) {
      typeTokenIndex = index + 1
      index = indexAfterType(tokens, matchingIndexes, index + 1)
    }
    let defaultValueTokenIndex: number | null = null
    if (isPunctuation(tokens[index], '=')) {
      defaultValueTokenIndex = index + 1
      index = indexAfterExpression(tokens, matchingIndexes, index + 1, true)
    }
    if (!isThisParameter) {
      parameters.push({
        boundNames: pattern.boundNames,
        patternStartIndex,
        indexAfterPattern: pattern.indexAfterPattern,
        isProperty,
        typeTokenIndex,
        defaultValueTokenIndex,
      })
    }
    if (!isPunctuation(tokens[index], ',')) {
      break
    }
    index += 1
  }

  return parameters
}

function isBindingStart(token: ScriptToken | undefined): boolean {
  return isIdentifier(token) || isPunctuation(token, '{') || isPunctuation(token, '[')
}
