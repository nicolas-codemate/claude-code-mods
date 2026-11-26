import type { SymbolKind } from '../../types'
import { indexAfterAngleGroup, isIdentifier, isPunctuation } from './structure'
import type { ScriptToken } from './tokenizer'

export type DeclarationKind =
  | 'class'
  | 'interface'
  | 'enum'
  | 'function'
  | 'method'
  | 'constant'
  | 'property'
  | 'type'
  | 'variable'
  | 'parameter'
  | 'typeParameter'
  | 'namespace'
  | 'import'

// binding: a name code refers to on its own. member: a name reached through its holder ("this.total", "Status.Paid").
export type DeclarationRole = 'binding' | 'member'

export type ScopeKind = 'file' | 'function' | 'block' | 'class' | 'interface' | 'enum' | 'object' | 'namespace'

// importedName is "default" for a default import and "*" for the whole module.
export type ImportBinding = { importedName: string; specifier: string; isTypeOnly: boolean }

export type ScriptDeclaration = {
  name: string
  kind: DeclarationKind
  role: DeclarationRole
  nameTokenIndex: number
  scope: ScriptScope
  // Where its value begins: the parenthesis of a function's parameters, the brace of a class body, the first token
  // of an initializer or of a member's value.
  valueTokenIndex: number | null
  // The name of its declared type when that type is one plain name.
  typeTokenIndex: number | null
  extendedNameIndexes: number[]
  implementedNameIndexes: number[]
  // The key a destructured name is read from: "load" in "const { load } = useOrders()".
  sourceProperty: string | null
  // A member written as a bare name ("{ load }"), which refers to a binding rather than declaring anything.
  isShorthand: boolean
  importBinding: ImportBinding | null
  isExported: boolean
  isDefaultExport: boolean
}

export type ScriptScope = {
  kind: ScopeKind
  startTokenIndex: number
  endTokenIndex: number
  parent: ScriptScope | null
  children: ScriptScope[]
  declarations: ScriptDeclaration[]
  owner: ScriptDeclaration | null
}

export type ExportLink =
  | { kind: 'named'; exportedName: string; localName: string; specifier: string | null }
  | { kind: 'star'; namespaceName: string | null; specifier: string }

export type ScriptStructure = {
  tokens: readonly ScriptToken[]
  matchingIndexes: Int32Array
  fileScope: ScriptScope
  scopeStartingAt: Map<number, ScriptScope>
  declarationAtToken: Map<number, ScriptDeclaration>
  exportLinks: ExportLink[]
  // referenceTokenIndex is the name exported by "export default orderStore", null for any other expression.
  defaultExport: { tokenIndex: number; referenceTokenIndex: number | null } | null
  // The string tokens that name a module: after "from", in "import(...)" and in "require(...)".
  specifierAtToken: Map<number, string>
  // The name before "as" in an import clause, which is no declaration of its own.
  importedNameAtToken: Map<number, ImportBinding>
  reexportedNameAtToken: Map<number, { specifier: string; name: string }>
  // The key of a renamed destructured name ("error" in "const { error: loadError } = ..."), with the name it binds.
  destructuredKeyAtToken: Map<number, ScriptDeclaration>
}

export const SYMBOL_KIND_OF_DECLARATION: Record<DeclarationKind, SymbolKind | null> = {
  class: 'class',
  interface: 'interface',
  enum: 'enum',
  function: 'function',
  method: 'method',
  constant: 'constant',
  property: 'property',
  type: 'type',
  variable: 'variable',
  namespace: 'class',
  parameter: null,
  typeParameter: null,
  import: null,
}

export const DECLARATION_KIND_WORDS: Record<DeclarationKind, string> = {
  class: 'class',
  interface: 'interface',
  enum: 'enum',
  function: 'function',
  method: 'method',
  constant: 'constant',
  property: 'property',
  type: 'type',
  variable: 'variable',
  namespace: 'namespace',
  parameter: 'parameter',
  typeParameter: 'type parameter',
  import: 'imported name',
}

export function innermostScopeAt(structure: ScriptStructure, tokenIndex: number): ScriptScope {
  let scope = structure.fileScope
  for (;;) {
    const children = scope.children
    let low = 0
    let high = children.length - 1
    let enclosingChild: ScriptScope | null = null
    while (low <= high) {
      const middle = (low + high) >> 1
      const child = children[middle]
      if (child === undefined) {
        break
      }
      if (tokenIndex < child.startTokenIndex) {
        high = middle - 1
      } else if (tokenIndex > child.endTokenIndex) {
        low = middle + 1
      } else {
        enclosingChild = child
        break
      }
    }
    if (enclosingChild === null) {
      return scope
    }
    scope = enclosingChild
  }
}

// Of several bindings of one name in a scope (two loops each declaring "order"), the last one declared before the
// reference, else the first.
function bindingOfScope(scope: ScriptScope, name: string, tokenIndex: number): ScriptDeclaration | null {
  let chosen: ScriptDeclaration | null = null
  for (const declaration of scope.declarations) {
    if (declaration.role !== 'binding' || declaration.name !== name) {
      continue
    }
    if (chosen === null || declaration.nameTokenIndex <= tokenIndex) {
      chosen = declaration
    }
  }

  return chosen
}

// The binding a bare name refers to at this token: the innermost enclosing scope first, the file's top level last.
export function bindingVisibleAt(structure: ScriptStructure, name: string, tokenIndex: number): ScriptDeclaration | null {
  let scope: ScriptScope | null = innermostScopeAt(structure, tokenIndex)
  while (scope !== null) {
    const binding = bindingOfScope(scope, name, tokenIndex)
    if (binding !== null) {
      return binding
    }
    scope = scope.parent
  }

  return null
}

// The scope a declaration's value opens: the body of a class, the object literal of a constant, the parameters and
// body of a function.
export function valueScopeOf(structure: ScriptStructure, declaration: ScriptDeclaration): ScriptScope | null {
  let index = declaration.valueTokenIndex
  if (index === null) {
    return null
  }
  const directScope = structure.scopeStartingAt.get(index)
  if (directScope !== undefined) {
    return directScope
  }
  if (isIdentifier(structure.tokens[index], 'async')) {
    index += 1
  }
  if (isPunctuation(structure.tokens[index], '<')) {
    index = indexAfterAngleGroup(structure.tokens, structure.matchingIndexes, index)
  }

  return structure.scopeStartingAt.get(index) ?? null
}

export function membersNamed(scope: ScriptScope, name: string): ScriptDeclaration[] {
  const members = scope.declarations.filter(declaration => declaration.name === name && declaration.role === 'member')

  return members.length > 0 || scope.kind !== 'namespace'
    ? members
    : scope.declarations.filter(declaration => declaration.name === name)
}

// Whether an object literal is what the function around it returns: "return { ... }" or "() => ({ ... })". An
// object written anywhere else in a function body (an argument, a local value) is not part of its result.
export function isReturnedObjectLiteral(structure: ScriptStructure, scope: ScriptScope): boolean {
  const { tokens } = structure
  const previousToken = tokens[scope.startTokenIndex - 1]
  if (scope.kind !== 'object') {
    return false
  }

  return (
    isIdentifier(previousToken, 'return') ||
    (isPunctuation(previousToken, '(') && isPunctuation(tokens[scope.startTokenIndex - 2], '=>'))
  )
}

export function enclosingScopeOfKind(scope: ScriptScope | null, kinds: readonly ScopeKind[]): ScriptScope | null {
  let current = scope
  while (current !== null && !kinds.includes(current.kind)) {
    current = current.parent
  }

  return current
}

export function isScopeWithin(scope: ScriptScope, ancestor: ScriptScope): boolean {
  let current: ScriptScope | null = scope
  while (current !== null) {
    if (current === ancestor) {
      return true
    }
    current = current.parent
  }

  return false
}
