import { plainTypeNameIndex } from './bindings'
import {
  bindingVisibleAt,
  enclosingScopeOfKind,
  innermostScopeAt,
  isReturnedObjectLiteral,
  membersNamed,
  valueScopeOf,
} from './declarations'
import type { ScriptDeclaration, ScriptScope, ScriptStructure } from './declarations'
import { locateExportedName, resolveImportedName } from './export-following'
import type { ImportResolution } from './export-following'
import { isDependencyPath, keyOfLocated, locatedDeclaration, locatedOffset, withoutDuplicates } from './located'
import type { Located } from './located'
import { packageNameOfDependencyPath } from './module-resolution'
import type { ScriptModel } from './script-model'
import { answeredOnce } from './session'
import type { AnalysisSession } from './session'
import { indexAfterAngleGroup, indexAfterExpression, isIdentifier, isPunctuation } from './structure'
import { tokenIndexAtOffset } from './tokenizer'
import type { ScriptToken } from './tokenizer'
import type { TemplateLocalName } from './vue-template'

// Where a name is read: a file's script, or one expression of a Vue template, which sees the names its elements
// declare and then the top level of the script block.
export type ReadingContext = {
  model: ScriptModel
  structure: ScriptStructure
  templateLocalNames: readonly TemplateLocalName[] | null
}

// located: the declarations the name refers to. package: it comes from a dependency that could not be opened, or
// it is a member of a value a dependency makes.
// explained: there is nowhere to go and the note says why (the language or the framework provides the name).
// unknown: nothing tells which declaration it is.
export type Resolution =
  | { kind: 'located'; locations: Located[] }
  | { kind: 'package'; packageName: string }
  | { kind: 'explained'; note: string }
  | { kind: 'unknown' }

const UNKNOWN: Resolution = { kind: 'unknown' }
// Members of arrays, strings and promises that a project hardly ever declares under the same name: on a value of
// unknown type, the language's own member is what the name is.
const JAVASCRIPT_MEMBERS = new Set([
  'length', 'map', 'forEach', 'push', 'includes', 'join', 'slice', 'reduce', 'some', 'every', 'then', 'catch',
  'finally', 'toString', 'trim', 'split', 'startsWith', 'endsWith', 'toLowerCase', 'toUpperCase', 'indexOf', 'concat',
  'flatMap', 'findIndex', 'splice', 'shift', 'unshift', 'pop', 'padStart', 'padEnd', 'toFixed', 'charAt', 'substring',
  'replaceAll', 'localeCompare', 'flat', 'hasOwnProperty', 'toLocaleString',
])
const MAXIMUM_RESOLUTION_DEPTH = 8

const VUE_COMPILER_MACROS = new Set([
  'defineProps',
  'defineEmits',
  'defineExpose',
  'defineOptions',
  'defineSlots',
  'defineModel',
  'withDefaults',
])
const JAVASCRIPT_GLOBALS = new Set([
  'console', 'window', 'document', 'globalThis', 'navigator', 'location', 'history', 'localStorage', 'sessionStorage',
  'Math', 'JSON', 'Object', 'Array', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Date', 'Error', 'TypeError',
  'RangeError', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'RegExp', 'Intl', 'Reflect', 'Proxy', 'URL',
  'URLSearchParams', 'FormData', 'Blob', 'File', 'FileReader', 'AbortController', 'Event', 'CustomEvent', 'HTMLElement',
  'Element', 'Node', 'NaN', 'Infinity', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'queueMicrotask', 'structuredClone',
  'fetch', 'alert', 'confirm', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI', 'process',
  'require', 'module', 'exports',
])
const TYPESCRIPT_UTILITY_TYPES = new Set([
  'Record', 'Partial', 'Required', 'Readonly', 'Pick', 'Omit', 'Exclude', 'Extract', 'NonNullable', 'ReturnType',
  'Parameters', 'Awaited', 'InstanceType', 'ConstructorParameters', 'ReadonlyArray', 'Uppercase', 'Lowercase',
  'Capitalize', 'Uncapitalize', 'PromiseLike', 'ArrayLike', 'Iterable', 'Iterator', 'AsyncIterable',
])
// Calls whose own arguments or type arguments declare the members of what they return: defineProps<{ order: Order }>().
const CALLS_DECLARING_THEIR_RESULT = new Set([
  'defineProps',
  'withDefaults',
  'reactive',
  'shallowReactive',
  'readonly',
  'markRaw',
  'freeze',
])
// Calls that return their first argument under another wrapping: storeToRefs(orderStore).
const CALLS_RETURNING_THEIR_ARGUMENT = new Set([
  'storeToRefs', 'toRefs', 'reactive', 'readonly', 'shallowReactive', 'unref', 'toRaw', 'toValue',
])

function contextOfLocated(located: Located): ReadingContext | null {
  return located.model === null || located.structure === null
    ? null
    : { model: located.model, structure: located.structure, templateLocalNames: null }
}

function resolutionOfLocations(locations: readonly Located[]): Resolution {
  const distinctLocations = withoutDuplicates(locations)

  return distinctLocations.length === 0 ? UNKNOWN : { kind: 'located', locations: distinctLocations }
}

function resolutionOfImport(importResolution: ImportResolution): Resolution {
  switch (importResolution.kind) {
    case 'located':
      return { kind: 'located', locations: [importResolution.located] }
    case 'package':
      return { kind: 'package', packageName: importResolution.packageName }
    case 'unresolved':
      return UNKNOWN
  }
}

function locationsOfResolution(resolution: Resolution): Located[] {
  return resolution.kind === 'located' ? resolution.locations : []
}

async function resolutionOfBinding(
  session: AnalysisSession,
  context: ReadingContext,
  binding: ScriptDeclaration,
): Promise<Resolution> {
  if (binding.importBinding === null) {
    return { kind: 'located', locations: [locatedDeclaration(context.model, context.structure, binding)] }
  }
  const { specifier, importedName } = binding.importBinding

  return resolutionOfImport(await resolveImportedName(session, context.model.path, specifier, importedName))
}

function hasShorthandMemberNamed(scope: ScriptScope, name: string): boolean {
  if (
    scope.kind === 'object' &&
    scope.declarations.some(declaration => declaration.isShorthand && declaration.name === name)
  ) {
    return true
  }

  return scope.children.some(child => hasShorthandMemberNamed(child, name))
}

// The declarations of a name that the code between two tokens hands out: a member of an object literal or of a type
// literal written there, or a name of a function's body that the function returns in an object ("return { load }").
// The outermost ones only: a name declared again deeper is another thing.
export function declarationsExposedWithin(
  structure: ScriptStructure,
  startTokenIndex: number,
  endTokenIndex: number,
  name: string,
): ScriptDeclaration[] {
  let shallowestDepth = Number.POSITIVE_INFINITY
  let exposedDeclarations: ScriptDeclaration[] = []

  function visit(scope: ScriptScope, depth: number, functionDepth: number): void {
    if (scope.endTokenIndex < startTokenIndex || scope.startTokenIndex > endTokenIndex || depth > shallowestDepth) {
      return
    }
    const isInside = scope.startTokenIndex >= startTokenIndex && scope.endTokenIndex <= endTokenIndex
    const isPartOfTheResult = functionDepth === 0 || (functionDepth === 1 && isReturnedObjectLiteral(structure, scope))
    if (isInside) {
      const holdsMembers =
        (scope.kind === 'object' && isPartOfTheResult) ||
        ((scope.kind === 'class' || scope.kind === 'interface') && functionDepth === 0)
      const declarations = scope.declarations.filter(declaration => {
        if (declaration.name !== name || declaration.isShorthand) {
          return false
        }
        if (declaration.role === 'member') {
          return holdsMembers
        }

        const isNameOfAFunctionBody =
          scope.kind === 'function' &&
          functionDepth === 0 &&
          declaration.kind !== 'parameter' &&
          declaration.kind !== 'typeParameter'

        return isNameOfAFunctionBody && hasShorthandMemberNamed(scope, name)
      })
      if (declarations.length > 0 && depth < shallowestDepth) {
        shallowestDepth = depth
        exposedDeclarations = declarations
      }
    }
    const functionDepthInside = isInside && scope.kind === 'function' ? functionDepth + 1 : functionDepth
    if (functionDepthInside > 1 || (functionDepthInside === 1 && scope.kind === 'object' && !isPartOfTheResult)) {
      return
    }
    for (const child of scope.children) {
      visit(child, isInside ? depth + 1 : depth, functionDepthInside)
    }
  }

  visit(structure.fileScope, 0, 0)

  return exposedDeclarations.slice(0, 1)
}

async function membersOfHolder(
  session: AnalysisSession,
  context: ReadingContext,
  holder: ScriptDeclaration,
  name: string,
  depth: number,
): Promise<Located[]> {
  const scope = valueScopeOf(context.structure, holder)
  const ownMembers = scope === null ? [] : membersNamed(scope, name)
  if (ownMembers.length > 0) {
    return ownMembers.map(member => locatedDeclaration(context.model, context.structure, member))
  }
  for (const parentNameIndex of [...holder.extendedNameIndexes, ...holder.implementedNameIndexes]) {
    for (const parent of locationsOfResolution(await resolveNameAt(session, context, parentNameIndex, depth + 1))) {
      const inheritedMembers = await membersOf(session, parent, name, depth + 1)
      if (inheritedMembers.length > 0) {
        return inheritedMembers
      }
    }
  }

  return []
}

// "type OrderView = Order & { isSelected: boolean }": the members of each part, a literal or another named type.
async function membersOfTypeAlias(
  session: AnalysisSession,
  context: ReadingContext,
  alias: ScriptDeclaration,
  name: string,
  depth: number,
): Promise<Located[]> {
  const { tokens, matchingIndexes, scopeStartingAt } = context.structure
  let index = alias.valueTokenIndex ?? tokens.length
  for (let partCount = 0; partCount < 8 && index < tokens.length; partCount += 1) {
    if (isPunctuation(tokens[index], '|') || isPunctuation(tokens[index], '&')) {
      index += 1
    }
    const literalScope = scopeStartingAt.get(index)
    if (literalScope !== undefined && isPunctuation(tokens[index], '{')) {
      const members = membersNamed(literalScope, name)
      if (members.length > 0) {
        return members.map(member => locatedDeclaration(context.model, context.structure, member))
      }
      index = literalScope.endTokenIndex + 1
    } else if (isIdentifier(tokens[index])) {
      while (isPunctuation(tokens[index + 1], '.') && isIdentifier(tokens[index + 2])) {
        index += 2
      }
      for (const part of locationsOfResolution(await resolveNameAt(session, context, index, depth + 1))) {
        const members = await membersOf(session, part, name, depth + 1)
        if (members.length > 0) {
          return members
        }
      }
      index += 1
      if (isPunctuation(tokens[index], '<')) {
        index = indexAfterAngleGroup(tokens, matchingIndexes, index)
      }
    } else {
      return []
    }
    if (!isPunctuation(tokens[index], '|') && !isPunctuation(tokens[index], '&')) {
      return []
    }
  }

  return []
}

async function membersOfObjectLiteral(
  session: AnalysisSession,
  context: ReadingContext,
  scope: ScriptScope,
  name: string,
): Promise<Located[]> {
  const locations: Located[] = []
  for (const member of membersNamed(scope, name)) {
    if (!member.isShorthand) {
      locations.push(locatedDeclaration(context.model, context.structure, member))
      continue
    }
    const binding = bindingVisibleAt(context.structure, name, member.nameTokenIndex)
    if (binding !== null) {
      locations.push(...locationsOfResolution(await resolutionOfBinding(session, context, binding)))
    }
  }

  return locations
}

// The name of the type a function declares it returns, when that is one plain name or a promise of one:
// "): Order {" and "): Promise<Order> {" both answer Order.
function returnTypeNameIndex(structure: ScriptStructure, declaration: ScriptDeclaration): number | null {
  const { tokens, matchingIndexes } = structure
  let openIndex = declaration.valueTokenIndex ?? -1
  if (isIdentifier(tokens[openIndex], 'async')) {
    openIndex += 1
  }
  if (isPunctuation(tokens[openIndex], '<')) {
    openIndex = indexAfterAngleGroup(tokens, matchingIndexes, openIndex)
  }
  const closeIndex = isPunctuation(tokens[openIndex], '(') ? (matchingIndexes[openIndex] ?? -1) : -1
  if (closeIndex === -1 || !isPunctuation(tokens[closeIndex + 1], ':')) {
    return null
  }
  const typeIndex = closeIndex + 2
  const isPromise = isIdentifier(tokens[typeIndex], 'Promise') && isPunctuation(tokens[typeIndex + 1], '<')

  return plainTypeNameIndex(tokens, matchingIndexes, isPromise ? typeIndex + 2 : typeIndex)
}

// The members named so of what a call returns, read from the declaration of what is called: its declared return
// type, the names a composable returns, the state, getters and actions given to a store factory.
function membersOfCallResult(session: AnalysisSession, callee: Located, name: string, depth: number): Promise<Located[]> {
  return answeredOnce(session, `result\n${keyOfLocated(callee)}\n${name}`, () =>
    membersOfCallResultOnce(session, callee, name, depth),
  )
}

async function membersOfCallResultOnce(
  session: AnalysisSession,
  callee: Located,
  name: string,
  depth: number,
): Promise<Located[]> {
  const { declaration, model, structure } = callee
  if (declaration === null || model === null || structure === null) {
    return []
  }
  let startTokenIndex: number
  let endTokenIndex: number
  if (declaration.kind === 'function' || declaration.kind === 'method') {
    const returnTypeIndex = returnTypeNameIndex(structure, declaration)
    if (returnTypeIndex !== null) {
      const context: ReadingContext = { model, structure, templateLocalNames: null }
      const returnTypes = locationsOfResolution(await resolveNameAt(session, context, returnTypeIndex, depth + 1))
      const members = (
        await Promise.all(returnTypes.map(returnType => membersOf(session, returnType, name, depth + 1)))
      ).flat()
      if (members.length > 0) {
        return members
      }
    }
    const scope = valueScopeOf(structure, declaration)
    if (scope === null) {
      return []
    }
    startTokenIndex = scope.startTokenIndex
    endTokenIndex = scope.endTokenIndex
  } else if ((declaration.kind === 'constant' || declaration.kind === 'variable') && declaration.valueTokenIndex !== null) {
    startTokenIndex = declaration.valueTokenIndex
    endTokenIndex = indexAfterExpression(structure.tokens, structure.matchingIndexes, startTokenIndex, true) - 1
  } else {
    return []
  }

  return declarationsExposedWithin(structure, startTokenIndex, endTokenIndex, name).map(exposed =>
    locatedDeclaration(model, structure, exposed),
  )
}

// "defineProps<OrderProps>()", alone or inside withDefaults(...): the members are those of the named type.
async function membersOfNamedTypeArgument(
  session: AnalysisSession,
  context: ReadingContext,
  startIndex: number,
  endIndex: number,
  name: string,
  depth: number,
): Promise<Located[]> {
  const { tokens, matchingIndexes } = context.structure
  for (let index = startIndex; index < endIndex; index += 1) {
    const typeNameIndex =
      isIdentifier(tokens[index]) && isPunctuation(tokens[index + 1], '<')
        ? plainTypeNameIndex(tokens, matchingIndexes, index + 2)
        : null
    if (
      typeNameIndex !== null &&
      isPunctuation(tokens[typeNameIndex + 1], '>') &&
      isPunctuation(tokens[typeNameIndex + 2], '(')
    ) {
      const types = locationsOfResolution(await resolveNameAt(session, context, typeNameIndex, depth + 1))

      return (await Promise.all(types.map(type => membersOf(session, type, name, depth + 1)))).flat()
    }
  }

  return []
}

function followsAWholeValue(token: ScriptToken): boolean {
  return token.kind === 'punctuation'
    ? [';', ',', ')', '}', ']', '!'].includes(token.text)
    : token.kind === 'identifier' && token.text === 'as'
}

// The members named so of the value of the expression that starts at this token: an object literal, "new Order()",
// a call, or another name.
async function membersOfExpression(
  session: AnalysisSession,
  context: ReadingContext,
  startIndex: number,
  name: string,
  depth: number,
): Promise<Located[]> {
  const { tokens, matchingIndexes, scopeStartingAt } = context.structure
  let index = startIndex
  if (isIdentifier(tokens[index], 'await')) {
    index += 1
  }
  const literalScope = scopeStartingAt.get(index)
  if (literalScope !== undefined && literalScope.kind === 'object') {
    return membersOfObjectLiteral(session, context, literalScope, name)
  }
  const isConstruction = isIdentifier(tokens[index], 'new')
  if (isConstruction) {
    index += 1
  }
  if (!isIdentifier(tokens[index])) {
    return []
  }
  let lastNameIndex = index
  while (
    (isPunctuation(tokens[lastNameIndex + 1], '.') || isPunctuation(tokens[lastNameIndex + 1], '?.')) &&
    isIdentifier(tokens[lastNameIndex + 2])
  ) {
    lastNameIndex += 2
  }
  let indexAfterName = lastNameIndex + 1
  if (isPunctuation(tokens[indexAfterName], '<') && tokens[indexAfterName]?.start === tokens[lastNameIndex]?.end) {
    indexAfterName = indexAfterAngleGroup(tokens, matchingIndexes, indexAfterName)
  }
  const tokenAfterName = tokens[indexAfterName]
  const isCall = isPunctuation(tokenAfterName, '(')
  if (isConstruction || !isCall) {
    const endsTheExpression =
      isConstruction || tokenAfterName === undefined || tokenAfterName.followsLineBreak || followsAWholeValue(tokenAfterName)
    if (!endsTheExpression) {
      return []
    }
    const values = locationsOfResolution(await resolveNameAt(session, context, lastNameIndex, depth + 1))

    return (await Promise.all(values.map(value => membersOf(session, value, name, depth + 1)))).flat()
  }
  const calleeName = tokens[lastNameIndex]?.text ?? ''
  const closeIndex = matchingIndexes[indexAfterName] ?? -1
  if (CALLS_DECLARING_THEIR_RESULT.has(calleeName) && closeIndex !== -1) {
    const typedMembers = await membersOfNamedTypeArgument(session, context, index, closeIndex, name, depth)
    if (typedMembers.length > 0) {
      return typedMembers
    }
    const declared = declarationsExposedWithin(context.structure, index, closeIndex, name)
    if (declared.length > 0) {
      return declared.map(declaration => locatedDeclaration(context.model, context.structure, declaration))
    }
  }
  if (CALLS_RETURNING_THEIR_ARGUMENT.has(calleeName) && isIdentifier(tokens[indexAfterName + 1])) {
    let argumentNameIndex = indexAfterName + 1
    while (isPunctuation(tokens[argumentNameIndex + 1], '.') && isIdentifier(tokens[argumentNameIndex + 2])) {
      argumentNameIndex += 2
    }
    const passedValues = locationsOfResolution(await resolveNameAt(session, context, argumentNameIndex, depth + 1))
    const members = (await Promise.all(passedValues.map(value => membersOf(session, value, name, depth + 1)))).flat()
    if (members.length > 0) {
      return members
    }
  }
  const callees = locationsOfResolution(await resolveNameAt(session, context, lastNameIndex, depth + 1))

  return (await Promise.all(callees.map(callee => membersOfCallResult(session, callee, name, depth + 1)))).flat()
}

// What a destructured name is read from: "load" of "const { load } = useOrders()" is the load that useOrders returns.
export async function sourcesOfDestructuredName(
  session: AnalysisSession,
  context: ReadingContext,
  declaration: ScriptDeclaration,
  depth = 0,
): Promise<Located[]> {
  if (declaration.sourceProperty === null || declaration.valueTokenIndex === null || declaration.kind === 'parameter') {
    return []
  }

  return membersOfExpression(session, context, declaration.valueTokenIndex, declaration.sourceProperty, depth + 1)
}

async function membersOfValue(
  session: AnalysisSession,
  context: ReadingContext,
  declaration: ScriptDeclaration,
  name: string,
  depth: number,
): Promise<Located[]> {
  if (declaration.typeTokenIndex !== null) {
    const types = locationsOfResolution(await resolveNameAt(session, context, declaration.typeTokenIndex, depth + 1))
    const typedMembers = (await Promise.all(types.map(type => membersOf(session, type, name, depth + 1)))).flat()
    if (typedMembers.length > 0) {
      return typedMembers
    }
  }
  if (declaration.sourceProperty !== null) {
    const sources = await sourcesOfDestructuredName(session, context, declaration, depth + 1)

    return (await Promise.all(sources.map(source => membersOf(session, source, name, depth + 1)))).flat()
  }
  if (declaration.valueTokenIndex === null || declaration.kind === 'parameter') {
    return []
  }

  return membersOfExpression(session, context, declaration.valueTokenIndex, name, depth + 1)
}

// The index of "default" when the place is the expression a module exports by default: "export default new Bus()".
function defaultExportIndexOf(located: Located): number | null {
  if (located.model === null || located.declaration !== null || located.offset === null) {
    return null
  }
  const tokens = located.model.structure.tokens
  const tokenIndex = tokenIndexAtOffset(tokens, located.offset)

  return isIdentifier(tokens[tokenIndex], 'default') ? tokenIndex : null
}

async function packageBehindExpression(
  session: AnalysisSession,
  context: ReadingContext,
  startIndex: number,
  depth: number,
): Promise<string | null> {
  const { tokens } = context.structure
  let nameIndex = startIndex
  while (isIdentifier(tokens[nameIndex], 'await') || isIdentifier(tokens[nameIndex], 'new')) {
    nameIndex += 1
  }
  if (!isIdentifier(tokens[nameIndex])) {
    return null
  }
  while (
    (isPunctuation(tokens[nameIndex + 1], '.') || isPunctuation(tokens[nameIndex + 1], '?.')) &&
    isIdentifier(tokens[nameIndex + 2])
  ) {
    nameIndex += 2
  }
  const resolution = await resolveNameAt(session, context, nameIndex, depth + 1)
  if (resolution.kind === 'package') {
    return resolution.packageName
  }
  for (const located of locationsOfResolution(resolution)) {
    const packageName = await packageBehindValue(session, located, depth + 1)
    if (packageName !== null) {
      return packageName
    }
  }

  return null
}

// The package a value comes from, when its type or the call that makes it is declared in a dependency: the
// project then declares none of its members.
async function packageBehindValue(session: AnalysisSession, value: Located, depth: number): Promise<string | null> {
  if (isDependencyPath(value.path)) {
    return packageNameOfDependencyPath(value.path)
  }
  if (depth > MAXIMUM_RESOLUTION_DEPTH || value.model === null) {
    return null
  }
  const { declaration } = value
  const context = contextOfLocated(value)
  if (declaration === null || context === null) {
    const defaultExportIndex = defaultExportIndexOf(value)
    const scriptContext: ReadingContext = { model: value.model, structure: value.model.structure, templateLocalNames: null }

    return defaultExportIndex === null
      ? null
      : packageBehindExpression(session, scriptContext, defaultExportIndex + 1, depth)
  }
  if (declaration.typeTokenIndex !== null) {
    const packageOfType = await packageBehindExpression(session, context, declaration.typeTokenIndex, depth)
    if (packageOfType !== null) {
      return packageOfType
    }
  }
  const holdsAValue = declaration.kind === 'constant' || declaration.kind === 'variable' || declaration.kind === 'property'

  return holdsAValue && declaration.valueTokenIndex !== null
    ? packageBehindExpression(session, context, declaration.valueTokenIndex, depth)
    : null
}

// The members named so of what a place denotes: a module, a class with its parents, an enum, an object literal, or
// a value whose type or initializer tells what it is.
export async function membersOf(session: AnalysisSession, holder: Located, name: string, depth = 0): Promise<Located[]> {
  if (depth > MAXIMUM_RESOLUTION_DEPTH) {
    return []
  }
  const { declaration } = holder
  if (declaration === null) {
    const defaultExportIndex = defaultExportIndexOf(holder)
    if (defaultExportIndex !== null && holder.model !== null) {
      const context: ReadingContext = { model: holder.model, structure: holder.model.structure, templateLocalNames: null }

      return membersOfExpression(session, context, defaultExportIndex + 1, name, depth + 1)
    }
    const exported = holder.offset === null ? await locateExportedName(session, holder.path, name) : null

    return exported !== null && exported.kind === 'located' ? [exported.located] : []
  }
  const context = contextOfLocated(holder)
  if (context === null) {
    return []
  }
  switch (declaration.kind) {
    case 'class':
    case 'interface':
    case 'enum':
    case 'namespace':
      return membersOfHolder(session, context, declaration, name, depth)
    case 'type':
      return membersOfTypeAlias(session, context, declaration, name, depth)
    case 'constant':
    case 'variable':
    case 'property':
    case 'parameter':
      return membersOfValue(session, context, declaration, name, depth)
    case 'function':
    case 'method':
    case 'typeParameter':
    case 'import':
      return []
  }
}

async function membersOfThis(
  session: AnalysisSession,
  context: ReadingContext,
  tokenIndex: number,
  name: string,
  depth: number,
): Promise<Located[]> {
  const scope = innermostScopeAt(context.structure, tokenIndex)
  const classScope = enclosingScopeOfKind(scope, ['class'])
  if (classScope !== null) {
    return classScope.owner === null
      ? membersNamed(classScope, name).map(member => locatedDeclaration(context.model, context.structure, member))
      : membersOf(session, locatedDeclaration(context.model, context.structure, classScope.owner), name, depth + 1)
  }
  let outermostObjectScope: ScriptScope | null = null
  for (let current: ScriptScope | null = scope; current !== null; current = current.parent) {
    if (current.kind === 'object') {
      outermostObjectScope = current
    }
  }
  if (outermostObjectScope === null) {
    return []
  }

  return declarationsExposedWithin(
    context.structure,
    outermostObjectScope.startTokenIndex,
    outermostObjectScope.endTokenIndex,
    name,
  ).map(declaration => locatedDeclaration(context.model, context.structure, declaration))
}

async function membersOfParentClass(
  session: AnalysisSession,
  context: ReadingContext,
  tokenIndex: number,
  name: string,
  depth: number,
): Promise<Located[]> {
  const classScope = enclosingScopeOfKind(innermostScopeAt(context.structure, tokenIndex), ['class'])
  for (const parentNameIndex of classScope?.owner?.extendedNameIndexes ?? []) {
    for (const parent of locationsOfResolution(await resolveNameAt(session, context, parentNameIndex, depth + 1))) {
      const members = await membersOf(session, parent, name, depth + 1)
      if (members.length > 0) {
        return members
      }
    }
  }

  return []
}

async function resolveMemberAccess(
  session: AnalysisSession,
  context: ReadingContext,
  tokenIndex: number,
  depth: number,
): Promise<Resolution> {
  const { tokens, matchingIndexes } = context.structure
  const name = tokens[tokenIndex]?.text ?? ''
  let receiverEndIndex = tokenIndex - 2
  if (isPunctuation(tokens[receiverEndIndex], '!')) {
    receiverEndIndex -= 1
  }
  const receiverToken = tokens[receiverEndIndex]
  if (receiverToken === undefined) {
    return UNKNOWN
  }
  const isReceiverAMember =
    isPunctuation(tokens[receiverEndIndex - 1], '.') || isPunctuation(tokens[receiverEndIndex - 1], '?.')
  if (isIdentifier(receiverToken, 'this') && !isReceiverAMember) {
    return resolutionOfLocations(await membersOfThis(session, context, tokenIndex, name, depth))
  }
  if (isIdentifier(receiverToken, 'super') && !isReceiverAMember) {
    return resolutionOfLocations(await membersOfParentClass(session, context, tokenIndex, name, depth))
  }
  if (receiverToken.kind === 'identifier') {
    const receiver = await resolveNameAt(session, context, receiverEndIndex, depth + 1)
    if (receiver.kind !== 'located') {
      return receiver.kind === 'unknown' && JAVASCRIPT_MEMBERS.has(name)
        ? { kind: 'explained', note: `${name} is a JavaScript built-in member` }
        : receiver
    }
    const members = (await Promise.all(receiver.locations.map(holder => membersOf(session, holder, name, depth + 1)))).flat()
    if (members.length > 0) {
      return resolutionOfLocations(members)
    }
    for (const holder of receiver.locations) {
      const packageName = await packageBehindValue(session, holder, depth + 1)
      if (packageName !== null) {
        return { kind: 'package', packageName }
      }
    }

    return JAVASCRIPT_MEMBERS.has(name) ? { kind: 'explained', note: `${name} is a JavaScript built-in member` } : UNKNOWN
  }
  if (JAVASCRIPT_MEMBERS.has(name)) {
    return { kind: 'explained', note: `${name} is a JavaScript built-in member` }
  }
  const openIndex = isPunctuation(receiverToken, ')') ? (matchingIndexes[receiverEndIndex] ?? -1) : -1
  if (openIndex > 0 && isIdentifier(tokens[openIndex - 1])) {
    const callee = await resolveNameAt(session, context, openIndex - 1, depth + 1)
    if (callee.kind !== 'located') {
      return callee
    }
    const isConstruction = isIdentifier(tokens[openIndex - 2], 'new')
    const members = await Promise.all(
      callee.locations.map(calleeLocation =>
        isConstruction
          ? membersOf(session, calleeLocation, name, depth + 1)
          : membersOfCallResult(session, calleeLocation, name, depth + 1),
      ),
    )

    return resolutionOfLocations(members.flat())
  }

  return UNKNOWN
}

async function resolveBareName(
  session: AnalysisSession,
  context: ReadingContext,
  name: string,
  tokenIndex: number,
): Promise<Resolution> {
  const { model, structure, templateLocalNames } = context
  const binding = bindingVisibleAt(structure, name, tokenIndex)
  if (binding !== null) {
    return resolutionOfBinding(session, context, binding)
  }
  if (templateLocalNames !== null) {
    const localName = templateLocalNames.find(candidate => candidate.name === name)
    if (localName !== undefined) {
      return { kind: 'located', locations: [locatedOffset(model, localName.start)] }
    }
    const scriptContext: ReadingContext = { model, structure: model.structure, templateLocalNames: null }
    const scriptBinding = bindingVisibleAt(model.structure, name, -1)
    if (scriptBinding !== null) {
      return resolutionOfBinding(session, scriptContext, scriptBinding)
    }
    const exposedDeclarations = declarationsExposedWithin(model.structure, 0, model.structure.tokens.length, name)
    if (exposedDeclarations.length > 0) {
      return {
        kind: 'located',
        locations: exposedDeclarations.map(declaration => locatedDeclaration(model, model.structure, declaration)),
      }
    }
    if (name.startsWith('$')) {
      return { kind: 'explained', note: `${name} is provided by Vue or by one of its plugins` }
    }
  }
  if (model.isVueComponent && VUE_COMPILER_MACROS.has(name)) {
    return { kind: 'explained', note: `${name} is a Vue compiler macro` }
  }
  if (JAVASCRIPT_GLOBALS.has(name)) {
    return { kind: 'explained', note: `${name} is a JavaScript built-in` }
  }
  if (TYPESCRIPT_UTILITY_TYPES.has(name)) {
    return { kind: 'explained', note: `${name} is a TypeScript built-in type` }
  }

  return UNKNOWN
}

// What a name refers to at the top level of a file's script: a component tag of its template, for one.
export function resolveTopLevelName(session: AnalysisSession, model: ScriptModel, name: string): Promise<Resolution> {
  return resolveBareName(session, { model, structure: model.structure, templateLocalNames: [] }, name, -1)
}

// What the name at this token refers to: through an import, as a member of its receiver, or as a name in scope.
export async function resolveNameAt(
  session: AnalysisSession,
  context: ReadingContext,
  tokenIndex: number,
  depth = 0,
): Promise<Resolution> {
  const { structure, model } = context
  const token = structure.tokens[tokenIndex]
  if (token === undefined || depth > MAXIMUM_RESOLUTION_DEPTH) {
    return UNKNOWN
  }
  const importedName = structure.importedNameAtToken.get(tokenIndex)
  if (importedName !== undefined) {
    return resolutionOfImport(
      await resolveImportedName(session, model.path, importedName.specifier, importedName.importedName),
    )
  }
  const reexportedName = structure.reexportedNameAtToken.get(tokenIndex)
  if (reexportedName !== undefined) {
    return resolutionOfImport(await resolveImportedName(session, model.path, reexportedName.specifier, reexportedName.name))
  }
  const destructuredName = structure.destructuredKeyAtToken.get(tokenIndex)
  if (destructuredName !== undefined) {
    const sources = await sourcesOfDestructuredName(session, context, destructuredName, depth)
    const packageName =
      sources.length > 0 || destructuredName.valueTokenIndex === null
        ? null
        : await packageBehindExpression(session, context, destructuredName.valueTokenIndex, depth)

    return packageName === null ? resolutionOfLocations(sources) : { kind: 'package', packageName }
  }
  const previousToken = structure.tokens[tokenIndex - 1]
  if (isPunctuation(previousToken, '.') || isPunctuation(previousToken, '?.')) {
    return resolveMemberAccess(session, context, tokenIndex, depth)
  }

  return resolveBareName(session, context, token.text, tokenIndex)
}
