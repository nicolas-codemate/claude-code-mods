import { docblockTagsOf, variableTypeTextIn } from './docblock'
import { argumentRangesBetween, endOfExpressionFrom, literalKeyOf, parsePhpExpression, receiverExpressionOf } from './expression'
import type { PhpExpression, PhpTokenRange } from './expression'
import { classAround, enclosingClassAt, enclosingFunctionScopeAt, namespaceAt, namespaceOf, resolveClassName, shortNameOf } from './outline'
import type { PhpFileOutline, PhpFunctionScope, PhpParameter } from './outline'
import { findMemberInLineage, parseTypeInClass, templateNamesOf, typeNameResolverIn, walkClassLineage } from './project'
import type { PhpFoundMember, PhpLocatedClass, PhpProject } from './project'
import type { PhpComment } from './tokens'
import {
  builtinType,
  classMembersOf,
  classType,
  elementTypeOf,
  hasTypeArgumentsOrPlaceholders,
  isInformativeType,
  isOpenType,
  mergeTypes,
  parsePhpType,
  PHP_OWN_VALUE_TYPE_NAME,
  shapeEntryTypeOf,
  substituteTypePlaceholders,
} from './type-expression'
import type { PhpType, PhpTypeMember } from './type-expression'

export type PhpInferenceContext = { project: PhpProject; outline: PhpFileOutline }

type VariableBinding =
  | { kind: 'assignment'; valueRange: PhpTokenRange; docblock: PhpComment | null; tokenIndex: number }
  // $orders[] = new Order(): the variable is a list of what is appended.
  | { kind: 'appendedElement'; valueRange: PhpTokenRange }
  | { kind: 'foreachValue'; asTokenIndex: number }
  // [$sheet, $account] = $this->createSheet(): the variable is one entry of the value, by its position or its key.
  | { kind: 'destructured'; key: string | null; valueRange: PhpTokenRange | null; asTokenIndex: number | null }
  | { kind: 'typeText'; typeText: string; tokenIndex: number }
  | { kind: 'unreadable' }

const MAXIMUM_INFERENCE_DEPTH = 10
const MAXIMUM_UNION_MEMBERS = 6
const CONSTRUCTOR_LIKE_METHOD_NAMES = ['__construct', 'setUp']
const ELEMENT_OF_FIRST_ARGUMENT_FUNCTIONS = new Set([
  'current', 'reset', 'end', 'next', 'prev', 'array_shift', 'array_pop', 'array_first', 'array_last',
])
const SAME_AS_FIRST_ARGUMENT_FUNCTIONS = new Set([
  'array_values', 'array_filter', 'array_reverse', 'array_slice', 'array_merge', 'array_unique', 'array_diff', 'array_intersect',
  'iterator_to_array',
])
const ENUM_OWN_TYPE_METHODS = new Set(['from', 'tryFrom'])
const REPOSITORY_GETTER_NAME = 'getRepository'
const LEAVING_KEYWORDS = new Set(['return', 'throw', 'continue', 'break'])

const closureByBodyEndByOutline = new WeakMap<PhpFileOutline, Map<number, PhpFunctionScope>>()

// A scope with its own variables, by the index of its closing brace: an arrow function shares its parent's.
function separateScopeEndingAt(outline: PhpFileOutline, closingBraceIndex: number): PhpFunctionScope | null {
  let closureByBodyEnd = closureByBodyEndByOutline.get(outline)
  if (closureByBodyEnd === undefined) {
    closureByBodyEnd = new Map()
    for (const functionScope of outline.functionScopes) {
      if (functionScope.kind !== 'arrowFunction' && functionScope.hasBody) {
        closureByBodyEnd.set(functionScope.endTokenIndex, functionScope)
      }
    }
    closureByBodyEndByOutline.set(outline, closureByBodyEnd)
  }

  return closureByBodyEnd.get(closingBraceIndex) ?? null
}

function enclosingClassTypeAt(outline: PhpFileOutline, tokenIndex: number): PhpType {
  const classDeclaration = classAround(outline, tokenIndex)

  return classDeclaration === null ? [] : classType(classDeclaration.fullyQualifiedName)
}

// The class a name stands for where it is written: self and static are the class around, parent the one it extends.
export function typeOfClassName(outline: PhpFileOutline, writtenName: string, tokenIndex: number): PhpType {
  if (writtenName === 'self' || writtenName === 'static') {
    return enclosingClassTypeAt(outline, tokenIndex)
  }
  if (writtenName === 'parent') {
    const parentName = classAround(outline, tokenIndex)?.extendsNames[0]

    return parentName === undefined ? [] : classType(parentName)
  }

  return classType(resolveClassName(outline, namespaceAt(outline, tokenIndex), writtenName))
}

// A type written in a comment or a signature of the file, read where it stands: the placeholders of the class and
// of the function around are known, static means the class around.
export function parseTypeAt(outline: PhpFileOutline, typeText: string, tokenIndex: number): PhpType {
  const classDeclaration = enclosingClassAt(outline, tokenIndex)
  const templateNames = classDeclaration === null ? [] : templateNamesOf(classDeclaration)
  for (let scope = enclosingFunctionScopeAt(outline, tokenIndex); scope !== null; scope = scope.parentScope) {
    templateNames.push(...docblockTagsOf(scope.docblock).templates.map(template => template.name))
  }
  const type = parsePhpType(typeText, typeNameResolverIn(outline, namespaceAt(outline, tokenIndex), templateNames))

  return substituteTypePlaceholders(type, new Map(), classDeclaration === null ? null : classType(classDeclaration.fullyQualifiedName))
}

// The native type wins unless it says nothing to navigate to, or the docblock adds what the elements or the
// placeholders are: array against Order[], Collection against Collection<int, Order>, object against T.
export function preferredDeclaredType(nativeType: PhpType, docblockType: PhpType): PhpType {
  if (docblockType.length === 0) {
    return nativeType
  }
  if (!isInformativeType(nativeType) || hasTypeArgumentsOrPlaceholders(docblockType)) {
    return docblockType
  }

  return nativeType
}

function declaredTypeOfParameter(outline: PhpFileOutline, functionScope: PhpFunctionScope, parameter: PhpParameter): PhpType {
  const nativeType = parameter.typeText === null ? [] : parseTypeAt(outline, parameter.typeText, parameter.tokenIndex)
  const docblockTypeText =
    docblockTagsOf(functionScope.docblock).parameterTypeTexts.get(parameter.name) ??
    variableTypeTextIn(parameter.leadingDocblock, parameter.name, true)
  const docblockType = docblockTypeText === null ? [] : parseTypeAt(outline, docblockTypeText, parameter.tokenIndex)
  const declaredType = preferredDeclaredType(nativeType, docblockType)
  const isListAlready = declaredType.some(member => member.kind === 'builtin' && member.typeArguments.length > 0)

  return parameter.isVariadic && !isListAlready && declaredType.length > 0 ? builtinType('array', [declaredType]) : declaredType
}

// "$order instanceof PaidOrder" tells the type where the check holds: in the rest of its own condition, in the block an
// if or a while opens on it, after an assert, and after a negated check whose block leaves the function.
function isInstanceOfCheckHoldingAt(outline: PhpFileOutline, variableTokenIndex: number, positionTokenIndex: number): boolean {
  const { tokens, matchingBracketIndexes } = outline.source
  const enclosingOpeningBefore = (fromTokenIndex: number): number => {
    let tokenIndex = fromTokenIndex
    while (tokenIndex >= 0) {
      const text = tokens[tokenIndex]?.text ?? ''
      if (text === ')' || text === ']' || text === '}') {
        const openingIndex = matchingBracketIndexes[tokenIndex] ?? -1
        tokenIndex = (openingIndex === -1 ? tokenIndex : openingIndex) - 1
        continue
      }
      if (text === '(') {
        return tokenIndex
      }
      if (text === ';' || text === '{') {
        return -1
      }
      tokenIndex -= 1
    }

    return -1
  }
  let openingIndex = enclosingOpeningBefore(variableTokenIndex - 1)
  if (openingIndex === -1) {
    return endOfExpressionFrom(outline.source, variableTokenIndex) > positionTokenIndex
  }
  let isNegated = tokens[variableTokenIndex - 1]?.text === '!'
  const keywordBefore = (tokenIndex: number): string => (tokens[tokenIndex - 1]?.text ?? '').replace(/^\\/, '')
  for (let climbs = 0; climbs < 4; climbs += 1) {
    const keyword = keywordBefore(openingIndex)
    if (keyword === 'if' || keyword === 'elseif' || keyword === 'while' || keyword === 'assert') {
      break
    }
    if ((matchingBracketIndexes[openingIndex] ?? -1) >= positionTokenIndex) {
      return true
    }
    isNegated = isNegated || keyword === '!'
    const outerOpeningIndex = enclosingOpeningBefore(openingIndex - 1)
    if (outerOpeningIndex === -1) {
      return false
    }
    openingIndex = outerOpeningIndex
  }
  const closingIndex = matchingBracketIndexes[openingIndex] ?? -1
  if (closingIndex === -1 || positionTokenIndex <= closingIndex) {
    return true
  }
  const keyword = keywordBefore(openingIndex)
  if (keyword === 'assert') {
    return true
  }
  if (keyword !== 'if' && keyword !== 'elseif' && keyword !== 'while') {
    return false
  }
  const blockClosingIndex = tokens[closingIndex + 1]?.text === '{' ? (matchingBracketIndexes[closingIndex + 1] ?? -1) : -1
  if (blockClosingIndex === -1) {
    return false
  }
  if (!isNegated) {
    return positionTokenIndex < blockClosingIndex
  }
  const leavesTheFunction = tokens.slice(closingIndex + 2, blockClosingIndex).some(token => token.kind === 'name' && LEAVING_KEYWORDS.has(token.text))

  return leavesTheFunction && positionTokenIndex > blockClosingIndex
}

// The list a variable is one target of, "[$sheet, $account] = ..." or "foreach (... as [$key, $value])", with the
// position or the key the variable takes its value from. Null when the variable stands anywhere else.
function destructuringOf(outline: PhpFileOutline, variableTokenIndex: number): Extract<VariableBinding, { kind: 'destructured' }> | null {
  const { tokens, matchingBracketIndexes } = outline.source
  const followingText = tokens[variableTokenIndex + 1]?.text ?? ''
  if (followingText !== ',' && followingText !== ']' && followingText !== ')') {
    return null
  }
  let closingIndex = variableTokenIndex + 1
  while (tokens[closingIndex]?.text === ',') {
    closingIndex = endOfExpressionFrom(outline.source, closingIndex + 1)
  }
  const closingText = tokens[closingIndex]?.text ?? ''
  const openingIndex = matchingBracketIndexes[closingIndex] ?? -1
  if ((closingText !== ']' && closingText !== ')') || openingIndex === -1) {
    return null
  }
  const beforeOpening = tokens[openingIndex - 1]
  const isForeachTarget = beforeOpening?.text === 'as'
  const isIndexOrCall =
    beforeOpening !== undefined &&
    (beforeOpening.kind === 'variable' ||
      beforeOpening.text === ')' ||
      beforeOpening.text === ']' ||
      (beforeOpening.kind === 'name' && beforeOpening.text !== 'list'))
  if (!isForeachTarget && (tokens[closingIndex + 1]?.text !== '=' || isIndexOrCall)) {
    return null
  }
  const entryRanges = argumentRangesBetween(outline.source, openingIndex, closingIndex)
  const entryIndex = entryRanges.findIndex(range => variableTokenIndex >= range.start && variableTokenIndex < range.end)
  const entryRange = entryRanges[entryIndex]
  if (entryRange === undefined) {
    return null
  }
  const keyToken = tokens[variableTokenIndex - 1]?.text === '=>' ? tokens[variableTokenIndex - 2] : undefined
  const isKeyed = entryRange.end - entryRange.start > 1
  const key = isKeyed ? (keyToken === undefined ? null : literalKeyOf(keyToken)) : String(entryIndex)
  const valueStart = closingIndex + 2

  return isForeachTarget
    ? { kind: 'destructured', key, valueRange: null, asTokenIndex: openingIndex - 1 }
    : { kind: 'destructured', key, valueRange: { start: valueStart, end: endOfExpressionFrom(outline.source, valueStart) }, asTokenIndex: null }
}

function catchTypeTextBefore(outline: PhpFileOutline, variableTokenIndex: number): string | null {
  const { tokens, text } = outline.source
  let tokenIndex = variableTokenIndex - 1
  while (tokenIndex > 0 && (tokens[tokenIndex]?.kind === 'name' || tokens[tokenIndex]?.text === '|')) {
    tokenIndex -= 1
  }
  if (tokens[tokenIndex]?.text !== '(' || tokens[tokenIndex - 1]?.text !== 'catch' || tokenIndex + 1 >= variableTokenIndex) {
    return null
  }

  return text.slice(tokens[tokenIndex + 1]?.start ?? 0, tokens[variableTokenIndex - 1]?.end ?? 0)
}

// The nearest place above a position where the variable takes a value, within one function's own body.
function nearestBindingBefore(
  outline: PhpFileOutline,
  variableName: string,
  lowestTokenIndex: number,
  fromTokenIndex: number,
  positionTokenIndex: number,
): VariableBinding | null {
  const { tokens } = outline.source
  let tokenIndex = fromTokenIndex
  while (tokenIndex >= lowestTokenIndex) {
    const token = tokens[tokenIndex]
    if (token === undefined) {
      break
    }
    if (token.text === '}' && token.kind === 'punctuation') {
      const separateScope = separateScopeEndingAt(outline, tokenIndex)
      if (separateScope !== null) {
        tokenIndex = separateScope.keywordTokenIndex - 1
        continue
      }
    }
    const isTheVariable = token.kind === 'variable' && token.text === variableName && tokens[tokenIndex - 1]?.text !== '::'
    const followingText = tokens[tokenIndex + 1]?.text ?? ''
    if (isTheVariable && (followingText === '=' || followingText === '??=')) {
      const valueRange = { start: tokenIndex + 2, end: endOfExpressionFrom(outline.source, tokenIndex + 2) }
      if (positionTokenIndex >= valueRange.end) {
        return { kind: 'assignment', valueRange, docblock: token.leadingDocblock, tokenIndex }
      }
    } else if (isTheVariable && followingText === '[' && tokens[tokenIndex + 2]?.text === ']' && tokens[tokenIndex + 3]?.text === '=') {
      const valueRange = { start: tokenIndex + 4, end: endOfExpressionFrom(outline.source, tokenIndex + 4) }
      if (positionTokenIndex >= valueRange.end) {
        return { kind: 'appendedElement', valueRange }
      }
    } else if (isTheVariable) {
      const previousText = tokens[tokenIndex - 1]?.text ?? ''
      if (previousText === 'as' && followingText !== '=>') {
        return { kind: 'foreachValue', asTokenIndex: tokenIndex - 1 }
      }
      if (previousText === '=>' && tokens[tokenIndex - 3]?.text === 'as') {
        return { kind: 'foreachValue', asTokenIndex: tokenIndex - 3 }
      }
      if (previousText === 'as' || previousText === 'static' || previousText === 'global') {
        return { kind: 'unreadable' }
      }
      const destructuring = destructuringOf(outline, tokenIndex)
      if (destructuring !== null && (destructuring.valueRange === null || positionTokenIndex >= destructuring.valueRange.end)) {
        return destructuring
      }
      const catchTypeText = catchTypeTextBefore(outline, tokenIndex)
      if (catchTypeText !== null) {
        return { kind: 'typeText', typeText: catchTypeText, tokenIndex }
      }
      const checkedClassToken = tokens[tokenIndex + 2]
      const isClassCheck = followingText === 'instanceof' && checkedClassToken?.kind === 'name'
      if (isClassCheck && checkedClassToken !== undefined && isInstanceOfCheckHoldingAt(outline, tokenIndex, positionTokenIndex)) {
        return { kind: 'typeText', typeText: checkedClassToken.text, tokenIndex }
      }
    }
    if (token.leadingDocblock !== null) {
      const typeText = variableTypeTextIn(token.leadingDocblock, variableName, false)
      if (typeText !== null) {
        return { kind: 'typeText', typeText, tokenIndex }
      }
    }
    tokenIndex -= 1
  }

  return null
}

function foreachSubjectRange(outline: PhpFileOutline, asTokenIndex: number): PhpTokenRange | null {
  const { tokens, matchingBracketIndexes } = outline.source
  let tokenIndex = asTokenIndex - 1
  while (tokenIndex >= 0) {
    const text = tokens[tokenIndex]?.text ?? ''
    if (text === ')' || text === ']' || text === '}') {
      const openingIndex = matchingBracketIndexes[tokenIndex] ?? -1
      if (openingIndex === -1) {
        return null
      }
      tokenIndex = openingIndex - 1
      continue
    }
    if (text === '(') {
      return tokens[tokenIndex - 1]?.text === 'foreach' ? { start: tokenIndex + 1, end: asTokenIndex } : null
    }
    if (text === ';' || text === '{') {
      return null
    }
    tokenIndex -= 1
  }

  return null
}

// What iterating a value gives: its own arguments say it (Order[]), else what its class says of its parents
// ("@implements IteratorAggregate<int, Order>").
export async function elementTypeOfIterable(context: PhpInferenceContext, type: PhpType): Promise<PhpType> {
  const directElementType = elementTypeOf(type)
  if (directElementType.length > 0) {
    return directElementType
  }
  let inheritedElementType: PhpType = []
  for (const member of classMembersOf(type).slice(0, MAXIMUM_UNION_MEMBERS)) {
    await walkClassLineage(context.project, member, context.outline.path, boundClass => {
      for (const inheritedTypeText of docblockTagsOf(boundClass.located.classDeclaration.docblock).inheritedTypeTexts) {
        const parentType = substituteTypePlaceholders(parseTypeInClass(boundClass.located, inheritedTypeText), boundClass.bindings, null)
        const elementType = elementTypeOf(parentType)
        if (elementType.length > 0) {
          inheritedElementType = mergeTypes(inheritedElementType, elementType)

          return true
        }
      }

      return false
    })
  }

  return inheritedElementType
}

export async function typeOfVariableAt(context: PhpInferenceContext, variableName: string, atTokenIndex: number, depth: number): Promise<PhpType> {
  const { outline } = context
  if (depth > MAXIMUM_INFERENCE_DEPTH) {
    return []
  }
  if (variableName === '$this') {
    return enclosingClassTypeAt(outline, atTokenIndex)
  }
  const ownDocblockTypeText = variableTypeTextIn(outline.source.tokens[atTokenIndex]?.leadingDocblock ?? null, variableName, false)
  if (ownDocblockTypeText !== null) {
    return parseTypeAt(outline, ownDocblockTypeText, atTokenIndex)
  }
  let functionScope = enclosingFunctionScopeAt(outline, atTokenIndex)
  let positionTokenIndex = atTokenIndex
  for (let hops = 0; hops < MAXIMUM_INFERENCE_DEPTH; hops += 1) {
    const lowestTokenIndex = functionScope === null ? 0 : functionScope.bodyStartTokenIndex
    const binding = nearestBindingBefore(outline, variableName, lowestTokenIndex, positionTokenIndex - 1, positionTokenIndex)
    if (binding !== null) {
      return typeOfBinding(context, variableName, binding, depth)
    }
    if (functionScope === null) {
      return []
    }
    const parameter = functionScope.parameters.find(candidate => candidate.name === variableName)
    if (parameter !== undefined) {
      return declaredTypeOfParameter(outline, functionScope, parameter)
    }
    const seesParentVariables = functionScope.kind === 'arrowFunction' || functionScope.capturedVariableNames.includes(variableName)
    if (!seesParentVariables) {
      return []
    }
    positionTokenIndex = functionScope.keywordTokenIndex
    functionScope = functionScope.parentScope
  }

  return []
}

async function typeOfBinding(context: PhpInferenceContext, variableName: string, binding: VariableBinding, depth: number): Promise<PhpType> {
  const { outline } = context
  switch (binding.kind) {
    case 'assignment': {
      const docblockTypeText = variableTypeTextIn(binding.docblock, variableName, true)
      const docblockType = docblockTypeText === null ? [] : parseTypeAt(outline, docblockTypeText, binding.tokenIndex)
      if (isInformativeType(docblockType)) {
        return docblockType
      }

      return inferExpressionType(context, parsePhpExpression(outline.source, binding.valueRange), depth + 1)
    }
    case 'appendedElement': {
      const elementType = await inferExpressionType(context, parsePhpExpression(outline.source, binding.valueRange), depth + 1)

      return elementType.length > 0 ? builtinType('array', [elementType]) : []
    }
    case 'foreachValue': {
      const subjectRange = foreachSubjectRange(outline, binding.asTokenIndex)
      if (subjectRange === null) {
        return []
      }
      const subjectType = await inferExpressionType(context, parsePhpExpression(outline.source, subjectRange), depth + 1)

      return elementTypeOfIterable(context, subjectType)
    }
    case 'destructured': {
      const subjectRange = binding.valueRange ?? (binding.asTokenIndex === null ? null : foreachSubjectRange(outline, binding.asTokenIndex))
      if (subjectRange === null) {
        return []
      }
      const subjectType = await inferExpressionType(context, parsePhpExpression(outline.source, subjectRange), depth + 1)
      const listType = binding.valueRange === null ? await elementTypeOfIterable(context, subjectType) : subjectType
      const entryType = binding.key === null ? [] : shapeEntryTypeOf(listType, binding.key)

      return entryType.length > 0 ? entryType : elementTypeOfIterable(context, listType)
    }
    case 'typeText':
      return parseTypeAt(outline, binding.typeText, binding.tokenIndex)
    case 'unreadable':
      return []
    default: {
      const unhandledBinding: never = binding

      return unhandledBinding
    }
  }
}

function declaredReturnTypeOf(foundMember: PhpFoundMember): PhpType {
  const { located } = foundMember.boundClass
  switch (foundMember.kind) {
    case 'method': {
      const methodTags = docblockTagsOf(foundMember.method.docblock)
      const methodTemplateNames = methodTags.templates.map(template => template.name)
      const nativeType = foundMember.method.returnTypeText === null ? [] : parseTypeInClass(located, foundMember.method.returnTypeText)
      const docblockType = methodTags.returnTypeText === null ? [] : parseTypeInClass(located, methodTags.returnTypeText, methodTemplateNames)

      return preferredDeclaredType(nativeType, docblockType)
    }
    case 'docblockMethod':
      return foundMember.docblockMember.typeText === null ? [] : parseTypeInClass(located, foundMember.docblockMember.typeText)
    case 'property':
    case 'constant':
    case 'docblockProperty':
      return []
    default: {
      const unhandledMember: never = foundMember

      return unhandledMember
    }
  }
}

// What the placeholders of a function stand for in one call, read from its arguments: a parameter documented
// class-string<T> given Order::class binds T to Order, a parameter documented T binds it to the argument's type.
async function placeholderBindingsOfCall(
  context: PhpInferenceContext,
  declaringClass: PhpLocatedClass | null,
  declaringOutline: PhpFileOutline,
  functionScope: PhpFunctionScope,
  argumentRanges: readonly PhpTokenRange[],
  depth: number,
): Promise<Map<string, PhpType>> {
  const bindings = new Map<string, PhpType>()
  const tags = docblockTagsOf(functionScope.docblock)
  if (tags.templates.length === 0) {
    return bindings
  }
  const templateNames = tags.templates.map(template => template.name)
  const parseDeclaredType = (typeText: string): PhpType =>
    declaringClass === null
      ? parsePhpType(typeText, typeNameResolverIn(declaringOutline, functionScope.namespaceName, templateNames))
      : parseTypeInClass(declaringClass, typeText, templateNames)
  for (const template of tags.templates) {
    bindings.set(template.name, template.boundTypeText === null ? [] : parseDeclaredType(template.boundTypeText))
  }
  for (const [parameterIndex, parameter] of functionScope.parameters.entries()) {
    const parameterTypeText = tags.parameterTypeTexts.get(parameter.name)
    const argumentRange = argumentRanges[parameterIndex]
    if (parameterTypeText === undefined || argumentRange === undefined) {
      continue
    }
    const parameterType = parseDeclaredType(parameterTypeText)
    const mentionsPlaceholder = (type: PhpType): boolean =>
      type.some(member => member.kind === 'template' || member.typeArguments.some(mentionsPlaceholder))
    if (!mentionsPlaceholder(parameterType)) {
      continue
    }
    const argumentType = await inferExpressionType(context, parsePhpExpression(context.outline.source, argumentRange), depth + 1)
    for (const parameterMember of parameterType) {
      const placeholderOfArgument = parameterMember.typeArguments.at(-1)?.find(member => member.kind === 'template')
      if (parameterMember.kind === 'template' && isInformativeType(argumentType)) {
        bindings.set(parameterMember.name, argumentType.filter(member => member.name !== 'null'))
      } else if (parameterMember.name === 'class-string' && placeholderOfArgument !== undefined) {
        const namedClasses = argumentType.flatMap(member => (member.name === 'class-string' ? (member.typeArguments[0] ?? []) : []))
        if (namedClasses.length > 0) {
          bindings.set(placeholderOfArgument.name, namedClasses)
        }
      } else if (placeholderOfArgument !== undefined && parameterMember.kind === 'builtin') {
        const elementType = elementTypeOf(argumentType)
        if (elementType.length > 0) {
          bindings.set(placeholderOfArgument.name, elementType)
        }
      }
    }
  }

  return bindings
}

async function typeOfMethodCall(
  context: PhpInferenceContext,
  receiverType: PhpType,
  methodName: string,
  argumentRanges: readonly PhpTokenRange[],
  depth: number,
): Promise<PhpType> {
  let resultType: PhpType = []
  for (const receiverMember of classMembersOf(receiverType).slice(0, MAXIMUM_UNION_MEMBERS)) {
    const outcome: { returnType: PhpType | null; openReturnType: PhpType; isDeclared: boolean; reachesPhpOwnClass: boolean } = {
      returnType: null,
      openReturnType: [],
      isDeclared: false,
      reachesPhpOwnClass: false,
    }
    const visitDeclaration = async (foundMember: PhpFoundMember): Promise<boolean> => {
      const declaredType = declaredReturnTypeOf(foundMember)
      outcome.isDeclared = true
      if (isOpenType(declaredType)) {
        outcome.openReturnType = outcome.openReturnType.length > 0 ? outcome.openReturnType : declaredType

        return false
      }
      const callBindings =
        foundMember.kind === 'method'
          ? await placeholderBindingsOfCall(
              context,
              foundMember.boundClass.located,
              foundMember.boundClass.located.outline,
              foundMember.method,
              argumentRanges,
              depth,
            )
          : new Map<string, PhpType>()
      const bindings = new Map([...foundMember.boundClass.bindings, ...callBindings])
      outcome.returnType = substituteTypePlaceholders(declaredType, bindings, [receiverMember])

      return true
    }
    await findMemberInLineage(context.project, receiverMember, context.outline.path, 'method', methodName, visitDeclaration, unlocatedClassName => {
      outcome.reachesPhpOwnClass = outcome.reachesPhpOwnClass || !unlocatedClassName.includes('\\')
    })
    const undeclaredType = !outcome.isDeclared && outcome.reachesPhpOwnClass ? builtinType(PHP_OWN_VALUE_TYPE_NAME) : outcome.openReturnType
    const returnType = outcome.returnType ?? (await typeOfEnumOwnMethod(context, receiverMember, methodName)) ?? undeclaredType
    resultType = mergeTypes(resultType, methodName === REPOSITORY_GETTER_NAME ? await withMappedRepositories(context, returnType) : returnType)
  }

  return resultType
}

// Doctrine answers getRepository(Order::class) with the repository the entity names in its own mapping,
// #[ORM\Entity(repositoryClass: OrderRepository::class)]: the declared EntityRepository<Order> is narrowed to it.
async function withMappedRepositories(context: PhpInferenceContext, repositoryType: PhpType): Promise<PhpType> {
  const narrowedType: PhpType = []
  for (const repositoryMember of repositoryType) {
    const isRepositoryOfOneEntity = repositoryMember.kind === 'class' && repositoryMember.typeArguments.length === 1
    const entityMember = isRepositoryOfOneEntity ? classMembersOf(repositoryMember.typeArguments[0] ?? [])[0] : undefined
    const entity = entityMember === undefined ? null : await context.project.locateClass(entityMember.name, context.outline.path)
    const mappedRepositoryName = entity === null ? null : mappedRepositoryNameOf(entity)
    narrowedType.push(mappedRepositoryName === null ? repositoryMember : { kind: 'class', name: mappedRepositoryName, typeArguments: [] })
  }

  return narrowedType
}

function mappedRepositoryNameOf(entity: PhpLocatedClass): string | null {
  const { tokens } = entity.outline.source
  const { classDeclaration, outline } = entity
  for (let tokenIndex = classDeclaration.nameTokenIndex - 1; tokenIndex >= 0; tokenIndex -= 1) {
    const token = tokens[tokenIndex]
    if (token === undefined || token.text === ';' || token.text === '}') {
      break
    }
    const repositoryToken = tokens[tokenIndex + 2]
    if (token.text === 'repositoryClass' && tokens[tokenIndex + 1]?.text === ':' && repositoryToken?.kind === 'name') {
      return resolveClassName(outline, classDeclaration.namespaceName, repositoryToken.text)
    }
  }
  const annotatedName = classDeclaration.docblock?.text.match(/repositoryClass\s*=\s*"?([A-Za-z0-9_\\]+)/)?.[1]

  return annotatedName === undefined ? null : resolveClassName(outline, classDeclaration.namespaceName, annotatedName)
}

async function typeOfEnumOwnMethod(context: PhpInferenceContext, receiverMember: PhpTypeMember, methodName: string): Promise<PhpType | null> {
  if (!ENUM_OWN_TYPE_METHODS.has(methodName) && methodName !== 'cases') {
    return null
  }
  const located = await context.project.locateClass(receiverMember.name, context.outline.path)
  if (located === null || located.classDeclaration.kind !== 'enum') {
    return null
  }

  return methodName === 'cases' ? builtinType('array', [[receiverMember]]) : [receiverMember]
}

async function typeAssignedInConstructor(
  context: PhpInferenceContext,
  located: PhpLocatedClass,
  propertyName: string,
  depth: number,
): Promise<PhpType> {
  const { tokens } = located.outline.source
  for (const methodName of CONSTRUCTOR_LIKE_METHOD_NAMES) {
    const method = located.classDeclaration.methods.find(candidate => candidate.name === methodName)
    if (method === undefined || !method.hasBody) {
      continue
    }
    for (let tokenIndex = method.bodyStartTokenIndex; tokenIndex < method.endTokenIndex; tokenIndex += 1) {
      const isAssignmentToProperty =
        tokens[tokenIndex]?.text === '$this' &&
        tokens[tokenIndex + 1]?.text === '->' &&
        tokens[tokenIndex + 2]?.text === propertyName &&
        tokens[tokenIndex + 3]?.text === '='
      if (isAssignmentToProperty) {
        const valueRange = { start: tokenIndex + 4, end: endOfExpressionFrom(located.outline.source, tokenIndex + 4) }
        const constructorContext = { project: context.project, outline: located.outline }
        const assignedType = await inferExpressionType(constructorContext, parsePhpExpression(located.outline.source, valueRange), depth + 1)
        if (assignedType.length > 0) {
          return assignedType
        }
      }
    }
  }

  return []
}

export function declaredTypeOfProperty(foundMember: PhpFoundMember): PhpType {
  const { located } = foundMember.boundClass
  switch (foundMember.kind) {
    case 'property': {
      const { property } = foundMember
      const nativeType = property.typeText === null ? [] : parseTypeInClass(located, property.typeText)
      const docblockTypeText =
        variableTypeTextIn(property.docblock, `$${property.name}`, true) ??
        (property.promotedBy === null ? null : (docblockTagsOf(property.promotedBy.docblock).parameterTypeTexts.get(`$${property.name}`) ?? null))
      const docblockType = docblockTypeText === null ? [] : parseTypeInClass(located, docblockTypeText)

      return preferredDeclaredType(nativeType, docblockType)
    }
    case 'docblockProperty':
      return foundMember.docblockMember.typeText === null ? [] : parseTypeInClass(located, foundMember.docblockMember.typeText)
    case 'method':
    case 'docblockMethod':
    case 'constant':
      return []
    default: {
      const unhandledMember: never = foundMember

      return unhandledMember
    }
  }
}

async function typeOfProperty(context: PhpInferenceContext, receiverType: PhpType, propertyName: string, depth: number): Promise<PhpType> {
  let resultType: PhpType = []
  for (const receiverMember of classMembersOf(receiverType).slice(0, MAXIMUM_UNION_MEMBERS)) {
    await findMemberInLineage(context.project, receiverMember, context.outline.path, 'property', propertyName, async foundMember => {
      let declaredType = declaredTypeOfProperty(foundMember)
      if (isOpenType(declaredType) && foundMember.kind === 'property') {
        const assignedType = await typeAssignedInConstructor(context, foundMember.boundClass.located, propertyName, depth)
        declaredType = assignedType.length > 0 ? assignedType : declaredType
      }
      resultType = mergeTypes(resultType, substituteTypePlaceholders(declaredType, foundMember.boundClass.bindings, [receiverMember]))

      return true
    })
  }

  return resultType
}

// "$this->customer instanceof BusinessCustomer" above an access to $this->customer, where that check holds.
function typeCheckedOfOwnProperty(outline: PhpFileOutline, propertyName: string, propertyTokenIndex: number): PhpType {
  const { tokens } = outline.source
  const lowestTokenIndex = enclosingFunctionScopeAt(outline, propertyTokenIndex)?.bodyStartTokenIndex ?? 0
  for (let tokenIndex = propertyTokenIndex - 3; tokenIndex >= lowestTokenIndex; tokenIndex -= 1) {
    const checkedClassToken = tokens[tokenIndex + 4]
    const isCheckOfTheProperty =
      tokens[tokenIndex]?.text === '$this' &&
      tokens[tokenIndex + 1]?.text === '->' &&
      tokens[tokenIndex + 2]?.text === propertyName &&
      tokens[tokenIndex + 3]?.text === 'instanceof' &&
      checkedClassToken?.kind === 'name'
    if (isCheckOfTheProperty && checkedClassToken !== undefined && isInstanceOfCheckHoldingAt(outline, tokenIndex, propertyTokenIndex)) {
      return parseTypeAt(outline, checkedClassToken.text, tokenIndex)
    }
  }

  return []
}

async function typeOfClassConstant(context: PhpInferenceContext, receiverType: PhpType, constantName: string): Promise<PhpType> {
  if (constantName === 'class') {
    return builtinType('class-string', [receiverType])
  }
  for (const receiverMember of classMembersOf(receiverType)) {
    const located = await context.project.locateClass(receiverMember.name, context.outline.path)
    const isEnumCase = located?.classDeclaration.constants.some(constant => constant.isEnumCase && constant.name === constantName) ?? false
    if (isEnumCase) {
      return [receiverMember]
    }
  }

  return []
}

async function typeOfFunctionCall(
  context: PhpInferenceContext,
  functionName: string,
  argumentRanges: readonly PhpTokenRange[],
  tokenIndex: number,
  depth: number,
): Promise<PhpType> {
  const { outline, project } = context
  const shortName = shortNameOf(functionName)
  const firstArgumentRange = argumentRanges[0]
  if (firstArgumentRange !== undefined && (ELEMENT_OF_FIRST_ARGUMENT_FUNCTIONS.has(shortName) || SAME_AS_FIRST_ARGUMENT_FUNCTIONS.has(shortName))) {
    const argumentType = await inferExpressionType(context, parsePhpExpression(outline.source, firstArgumentRange), depth + 1)

    return ELEMENT_OF_FIRST_ARGUMENT_FUNCTIONS.has(shortName) ? elementTypeOfIterable(context, argumentType) : argumentType
  }
  const declaration = await functionDeclarationNamed(project, outline, functionName, tokenIndex)
  if (declaration === null) {
    return []
  }
  const { functionScope } = declaration
  const tags = docblockTagsOf(functionScope.docblock)
  const templateNames = tags.templates.map(template => template.name)
  const resolveName = typeNameResolverIn(declaration.outline, functionScope.namespaceName, templateNames)
  const nativeType = functionScope.returnTypeText === null ? [] : parsePhpType(functionScope.returnTypeText, resolveName)
  const docblockType = tags.returnTypeText === null ? [] : parsePhpType(tags.returnTypeText, resolveName)
  const bindings = await placeholderBindingsOfCall(context, null, declaration.outline, functionScope, argumentRanges, depth)

  return substituteTypePlaceholders(preferredDeclaredType(nativeType, docblockType), bindings, null)
}

// A function of the project by the name a file calls it: its use function import, its namespace, else the global one.
export async function functionDeclarationNamed(
  project: PhpProject,
  outline: PhpFileOutline,
  writtenName: string,
  tokenIndex: number,
): Promise<{ outline: PhpFileOutline; functionScope: PhpFunctionScope } | null> {
  const namespaceName = namespaceAt(outline, tokenIndex)
  const importedName = outline.functionImports.get(writtenName)
  const candidateNames =
    importedName !== undefined
      ? [importedName]
      : writtenName.includes('\\')
        ? [resolveClassName(outline, namespaceName, writtenName)]
        : [...new Set([namespaceName === '' ? writtenName : `${namespaceName}\\${writtenName}`, writtenName])]
  for (const candidateName of candidateNames) {
    const shortName = shortNameOf(candidateName)
    const candidateNamespace = namespaceOf(candidateName)
    const symbolPaths = project.workspace.symbolsNamed(shortName).flatMap(symbol => (symbol.kind === 'function' ? [symbol.path] : []))
    for (const candidatePath of new Set([outline.path, ...symbolPaths])) {
      const candidateOutline = candidatePath === outline.path ? outline : await project.outlineOfFile(candidatePath)
      const functionScope = candidateOutline?.functions.find(
        candidate => candidate.name === shortName && candidate.namespaceName === candidateNamespace,
      )
      if (candidateOutline && functionScope !== undefined) {
        return { outline: candidateOutline, functionScope }
      }
    }
  }

  return null
}

async function typeOfReceiver(context: PhpInferenceContext, receiver: PhpExpression, isStatic: boolean, depth: number): Promise<PhpType> {
  if (isStatic && receiver.kind === 'name') {
    return typeOfClassName(context.outline, receiver.name, receiver.tokenIndex)
  }

  return inferExpressionType(context, receiver, depth)
}

// The type of an expression, hop by hop: each variable, property and call along the chain is resolved from the
// declarations it leads to. Empty when a hop cannot be read.
export async function inferExpressionType(context: PhpInferenceContext, expression: PhpExpression, depth: number): Promise<PhpType> {
  if (depth > MAXIMUM_INFERENCE_DEPTH) {
    return []
  }
  switch (expression.kind) {
    case 'variable':
      return typeOfVariableAt(context, expression.name, expression.tokenIndex, depth)
    case 'instantiation':
      return expression.className === null ? [] : typeOfClassName(context.outline, expression.className, expression.tokenIndex)
    case 'methodCall': {
      const receiverType = await typeOfReceiver(context, expression.receiver, expression.isStatic, depth)

      return typeOfMethodCall(context, receiverType, expression.name, expression.argumentRanges, depth)
    }
    case 'propertyAccess': {
      const isOwnProperty = expression.receiver.kind === 'variable' && expression.receiver.name === '$this' && !expression.isStatic
      const checkedType = isOwnProperty ? typeCheckedOfOwnProperty(context.outline, expression.name, expression.tokenIndex) : []
      if (checkedType.length > 0) {
        return checkedType
      }
      const receiverType = await typeOfReceiver(context, expression.receiver, expression.isStatic, depth)

      return typeOfProperty(context, receiverType, expression.name, depth)
    }
    case 'classConstant': {
      const receiverType = await typeOfReceiver(context, expression.receiver, true, depth)

      return typeOfClassConstant(context, receiverType, expression.name)
    }
    case 'functionCall':
      return typeOfFunctionCall(context, expression.name, expression.argumentRanges, expression.tokenIndex, depth)
    case 'elementAccess': {
      const receiverType = await inferExpressionType(context, expression.receiver, depth)
      const entryType = expression.key === null ? [] : shapeEntryTypeOf(receiverType, expression.key)

      return entryType.length > 0 ? entryType : elementTypeOfIterable(context, receiverType)
    }
    case 'arrayLiteral': {
      const { firstValueRange } = expression
      const firstValueType =
        firstValueRange === null
          ? []
          : await inferExpressionType(context, parsePhpExpression(context.outline.source, firstValueRange), depth + 1)

      return builtinType('array', firstValueType.length > 0 ? [firstValueType] : [])
    }
    case 'alternatives': {
      const alternativeTypes: PhpType[] = []
      for (const alternative of expression.alternatives) {
        alternativeTypes.push(await inferExpressionType(context, alternative, depth))
      }

      return mergeTypes(...alternativeTypes)
    }
    case 'closure':
      return classType('Closure')
    case 'scalar':
      return builtinType('scalar')
    case 'name':
    case 'invocation':
    case 'unknown':
      return []
    default: {
      const unhandledExpression: never = expression

      return unhandledExpression
    }
  }
}

// The type of what stands before the -> or :: of a member, given the token of the member's name.
export async function receiverTypeOfMemberAccess(context: PhpInferenceContext, memberTokenIndex: number): Promise<PhpType> {
  const isStatic = context.outline.source.tokens[memberTokenIndex - 1]?.text === '::'
  const receiver = receiverExpressionOf(context.outline.source, memberTokenIndex)

  return typeOfReceiver(context, receiver, isStatic, 0)
}
