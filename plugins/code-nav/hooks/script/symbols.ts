import type { SymbolEntry, SymbolKind } from '../../types'
import { isReturnedObjectLiteral, SYMBOL_KIND_OF_DECLARATION, valueScopeOf } from './declarations'
import type { ScriptDeclaration, ScriptScope, ScriptStructure } from './declarations'
import { buildScriptModel } from './script-model'
import type { ScriptModel } from './script-model'
import { indexAfterExpression, startsFunctionExpression } from './structure'
import { lineAndColumnOfOffset } from '../text-position'

// How deep the options given to a factory are read: defineStore('orders', { actions: { load() {} } }) declares load
// two object literals down, state: () => ({ orders: [] }) three scopes down.
const MAXIMUM_DEPTH_OF_FACTORY_OPTIONS = 3

// The top-level declaration whose value holds this token: the store a nested action belongs to.
export function topLevelDeclarationAround(structure: ScriptStructure, tokenIndex: number): ScriptDeclaration | null {
  let holder: ScriptDeclaration | null = null
  for (const declaration of structure.fileScope.declarations) {
    const startsBefore = declaration.valueTokenIndex !== null && declaration.valueTokenIndex <= tokenIndex
    if (declaration.role === 'binding' && declaration.kind !== 'import' && startsBefore) {
      holder = declaration
    }
  }
  if (holder === null || holder.valueTokenIndex === null) {
    return null
  }
  const valueScope = valueScopeOf(structure, holder)
  const valueEndIndex =
    valueScope === null
      ? indexAfterExpression(structure.tokens, structure.matchingIndexes, holder.valueTokenIndex, true) - 1
      : valueScope.endTokenIndex

  return valueEndIndex >= tokenIndex ? holder : null
}

function shorthandMemberNamesUnder(scope: ScriptScope, names: Set<string> = new Set()): Set<string> {
  if (scope.kind === 'object') {
    for (const declaration of scope.declarations) {
      if (declaration.isShorthand) {
        names.add(declaration.name)
      }
    }
  }
  for (const child of scope.children) {
    shorthandMemberNamesUnder(child, names)
  }

  return names
}

// The names of a function's body that it hands out in an object: "return { orders, load }".
function declarationsReturnedBy(functionScope: ScriptScope): ScriptDeclaration[] {
  const returnedNames = shorthandMemberNamesUnder(functionScope)

  return functionScope.declarations.filter(
    declaration =>
      declaration.kind !== 'parameter' && declaration.kind !== 'typeParameter' && returnedNames.has(declaration.name),
  )
}

// The name a declaration is reached through: the class of a method, the constant holding an object literal, the
// composable or the store whose result exposes it. Null for a name that stands on its own.
export function holderNameOf(structure: ScriptStructure, declaration: ScriptDeclaration): string | null {
  const isExposedBinding =
    declaration.scope.kind === 'function' && declarationsReturnedBy(declaration.scope).includes(declaration)
  if (declaration.role === 'binding' && !isExposedBinding) {
    return null
  }
  const directOwner = declaration.scope.owner
  if (
    declaration.role === 'member' &&
    directOwner !== null &&
    directOwner.role === 'binding' &&
    directOwner.kind !== 'parameter'
  ) {
    return directOwner.name
  }
  let topMostScope = declaration.scope
  while (topMostScope.parent !== null && topMostScope.parent.kind !== 'file') {
    topMostScope = topMostScope.parent
  }
  if (topMostScope.owner !== null && topMostScope.owner.scope.kind === 'file') {
    return topMostScope.owner.name
  }

  return topLevelDeclarationAround(structure, topMostScope.startTokenIndex)?.name ?? null
}

export function labelOfDeclaration(structure: ScriptStructure, declaration: ScriptDeclaration): string {
  const holderName = holderNameOf(structure, declaration)

  return holderName === null ? declaration.name : `${holderName}.${declaration.name}`
}

function symbolKindOfExposedName(structure: ScriptStructure, declaration: ScriptDeclaration): SymbolKind | null {
  if (declaration.role === 'binding' && declaration.kind === 'function') {
    return 'method'
  }
  if (declaration.role === 'binding') {
    return 'property'
  }
  const isFunctionValue =
    declaration.kind === 'property' &&
    declaration.valueTokenIndex !== null &&
    startsFunctionExpression(structure.tokens, structure.matchingIndexes, declaration.valueTokenIndex)

  return isFunctionValue ? 'method' : SYMBOL_KIND_OF_DECLARATION[declaration.kind]
}

// The names reached through a top-level declaration: the members of a class or of an object literal, what a
// composable returns, the state, getters and actions given to a store factory.
function namesReachedThrough(structure: ScriptStructure, holder: ScriptDeclaration): ScriptDeclaration[] {
  const valueScope = valueScopeOf(structure, holder)
  const reached: ScriptDeclaration[] = []
  if (valueScope !== null && valueScope.kind !== 'function') {
    return valueScope.declarations.filter(declaration => !declaration.isShorthand && declaration.kind !== 'typeParameter')
  }
  if (valueScope !== null) {
    return declarationsReturnedBy(valueScope)
  }
  if (holder.valueTokenIndex === null || (holder.kind !== 'constant' && holder.kind !== 'variable')) {
    return reached
  }
  const startTokenIndex = holder.valueTokenIndex
  const endTokenIndex = indexAfterExpression(structure.tokens, structure.matchingIndexes, startTokenIndex, true) - 1

  function visit(scope: ScriptScope, depth: number, functionDepth: number): void {
    if (
      scope.endTokenIndex < startTokenIndex ||
      scope.startTokenIndex > endTokenIndex ||
      depth > MAXIMUM_DEPTH_OF_FACTORY_OPTIONS
    ) {
      return
    }
    const isInside = scope.startTokenIndex >= startTokenIndex && scope.endTokenIndex <= endTokenIndex
    const isPartOfTheResult = functionDepth === 0 || (functionDepth === 1 && isReturnedObjectLiteral(structure, scope))
    if (isInside && scope.kind === 'object' && isPartOfTheResult) {
      reached.push(...scope.declarations.filter(declaration => declaration.role === 'member' && !declaration.isShorthand))
    } else if (isInside && scope.kind === 'function' && functionDepth === 0 && depth <= 1) {
      reached.push(...declarationsReturnedBy(scope))
    }
    const functionDepthInside = isInside && scope.kind === 'function' ? functionDepth + 1 : functionDepth
    if (functionDepthInside > 1 || (functionDepthInside === 1 && scope.kind === 'object' && !isPartOfTheResult)) {
      return
    }
    for (const child of scope.children) {
      visit(child, isInside ? depth + 1 : depth, functionDepthInside)
    }
  }

  visit(holder.scope, 0, 0)

  return reached
}

export function symbolsOfModel(model: ScriptModel): SymbolEntry[] {
  const { structure } = model
  const symbols: SymbolEntry[] = []
  const lineOf = (declaration: ScriptDeclaration) =>
    lineAndColumnOfOffset(model.lineStartOffsets, structure.tokens[declaration.nameTokenIndex]?.start ?? 0).line
  for (const declaration of structure.fileScope.declarations) {
    const kind = SYMBOL_KIND_OF_DECLARATION[declaration.kind]
    if (declaration.role !== 'binding' || kind === null) {
      continue
    }
    symbols.push({ name: declaration.name, kind, path: model.path, line: lineOf(declaration), container: null })
    for (const reachedDeclaration of namesReachedThrough(structure, declaration)) {
      const reachedKind = symbolKindOfExposedName(structure, reachedDeclaration)
      if (reachedKind !== null) {
        symbols.push({
          name: reachedDeclaration.name,
          kind: reachedKind,
          path: model.path,
          line: lineOf(reachedDeclaration),
          container: declaration.name,
        })
      }
    }
  }

  return symbols
}

// The declarations of one file: its top-level names, and under each the names reached through it.
export function scriptSymbolsOfFile(path: string, text: string): SymbolEntry[] {
  return symbolsOfModel(buildScriptModel(path, text))
}
