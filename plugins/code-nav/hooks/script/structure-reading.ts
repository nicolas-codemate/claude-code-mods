import { plainTypeNameIndex, readBindingPattern, readParameterList } from './bindings'
import type { BoundName, ParameterReading } from './bindings'
import { valueScopeOf } from './declarations'
import type {
  DeclarationKind,
  DeclarationRole,
  ImportBinding,
  ScopeKind,
  ScriptDeclaration,
  ScriptScope,
  ScriptStructure,
} from './declarations'
import {
  arrowIndexAfterParameters,
  indexAfterAngleGroup,
  indexAfterExpression,
  indexAfterGroup,
  indexAfterType,
  isIdentifier,
  isPunctuation,
  matchBrackets,
  opensTypeArguments,
  startsAfterImpliedSemicolon,
  startsFunctionExpression,
} from './structure'
import { stringTokenValue } from './tokenizer'
import type { ScriptToken } from './tokenizer'

export type StructureReadingOptions = {
  // The tokens are one expression (a Vue template binding), where a leading brace opens an object literal.
  isExpression?: boolean
}

type DeclarationFields = {
  name: string
  kind: DeclarationKind
  role: DeclarationRole
  nameTokenIndex: number
  valueTokenIndex?: number | null
  typeTokenIndex?: number | null
  extendedNameIndexes?: number[]
  implementedNameIndexes?: number[]
  sourceProperty?: string | null
  isShorthand?: boolean
  importBinding?: ImportBinding | null
  isExported?: boolean
  isDefaultExport?: boolean
}

type ExportFlags = { isExported: boolean; isDefaultExport: boolean }

const WORDS_NEVER_NAMING_A_METHOD = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'with', 'return', 'function', 'typeof', 'await', 'new', 'super', 'import',
  'yield', 'void', 'delete', 'throw', 'do', 'else', 'in', 'of', 'instanceof', 'case',
])
const MEMBER_MODIFIERS = new Set([
  'public', 'private', 'protected', 'static', 'readonly', 'abstract', 'override', 'async', 'declare', 'accessor', 'get',
  'set',
])
const DECLARATION_MODIFIERS = new Set(['async', 'declare', 'abstract', 'default', 'const'])
const PUNCTUATION_BEFORE_A_STATEMENT = new Set([';', '}', '{', ')'])
const PUNCTUATION_BEFORE_A_BLOCK = new Set([')', ']', '}', '{', ';', '=>', '>'])
const WORDS_BEFORE_AN_OBJECT_LITERAL = new Set([
  'return', 'default', 'in', 'of', 'as', 'satisfies', 'extends', 'yield', 'await', 'typeof', 'void', 'case', 'throw',
])
const WORDS_BEFORE_AN_EXPRESSION = new Set(['return', 'new', 'typeof', 'await', 'yield', 'void', 'throw', 'case'])
const SCOPES_HOLDING_MEMBERS: readonly ScopeKind[] = ['class', 'interface', 'enum', 'object']
const MAXIMUM_DECLARATORS_PER_STATEMENT = 50

function newScope(kind: ScopeKind, startTokenIndex: number, endTokenIndex: number): ScriptScope {
  return {
    kind,
    startTokenIndex,
    endTokenIndex: Math.max(startTokenIndex, endTokenIndex),
    parent: null,
    children: [],
    declarations: [],
    owner: null,
  }
}

// One pass over the tokens of a file: its scopes (functions, blocks, class bodies, object literals) with the names
// each declares, its imports and its exports. A construct the pass does not recognise declares nothing.
export function readScriptStructure(tokens: readonly ScriptToken[], options: StructureReadingOptions = {}): ScriptStructure {
  const matchingIndexes = matchBrackets(tokens)
  const fileScope = newScope('file', 0, Math.max(0, tokens.length - 1))
  const structure: ScriptStructure = {
    tokens,
    matchingIndexes,
    fileScope,
    scopeStartingAt: new Map(),
    declarationAtToken: new Map(),
    exportLinks: [],
    defaultExport: null,
    specifierAtToken: new Map(),
    importedNameAtToken: new Map(),
    reexportedNameAtToken: new Map(),
    destructuredKeyAtToken: new Map(),
  }
  // Scopes whose first token lies ahead of the scan: entered when it gets there.
  const scopeToEnterAt = new Map<number, ScriptScope>()
  // Braces that open no scope of their own: the body of a function whose scope began at its parameters, and the
  // braces of a destructuring pattern or of an import clause.
  const bracesWithoutScope = new Set<number>()
  const arrowIndexesOfKnownFunctions = new Set<number>()
  const scopeStack: ScriptScope[] = [fileScope]

  function currentScope(): ScriptScope {
    return scopeStack[scopeStack.length - 1] ?? fileScope
  }

  function enterScope(scope: ScriptScope): void {
    const parent = currentScope()
    scope.parent = parent
    scope.endTokenIndex = Math.min(scope.endTokenIndex, parent.endTokenIndex)
    parent.children.push(scope)
    scopeStack.push(scope)
  }

  function scheduleScope(scope: ScriptScope): void {
    scopeToEnterAt.set(scope.startTokenIndex, scope)
    structure.scopeStartingAt.set(scope.startTokenIndex, scope)
  }

  function declare(scope: ScriptScope, fields: DeclarationFields): ScriptDeclaration {
    const declaration: ScriptDeclaration = {
      name: fields.name,
      kind: fields.kind,
      role: fields.role,
      nameTokenIndex: fields.nameTokenIndex,
      scope,
      valueTokenIndex: fields.valueTokenIndex ?? null,
      typeTokenIndex: fields.typeTokenIndex ?? null,
      extendedNameIndexes: fields.extendedNameIndexes ?? [],
      implementedNameIndexes: fields.implementedNameIndexes ?? [],
      sourceProperty: fields.sourceProperty ?? null,
      isShorthand: fields.isShorthand ?? false,
      importBinding: fields.importBinding ?? null,
      isExported: fields.isExported ?? false,
      isDefaultExport: fields.isDefaultExport ?? false,
    }
    scope.declarations.push(declaration)
    const declarationOfSameToken = structure.declarationAtToken.get(fields.nameTokenIndex)
    if (declarationOfSameToken === undefined || (declarationOfSameToken.role === 'member' && fields.role === 'binding')) {
      structure.declarationAtToken.set(fields.nameTokenIndex, declaration)
    }

    return declaration
  }

  function markPatternBraces(startIndex: number, endIndex: number): void {
    for (let index = startIndex; index < endIndex; index += 1) {
      if (isPunctuation(tokens[index], '{')) {
        bracesWithoutScope.add(index)
      }
    }
  }

  function exportFlagsBefore(index: number): ExportFlags {
    let cursor = index - 1
    let isDefaultExport = false
    while (isIdentifier(tokens[cursor]) && DECLARATION_MODIFIERS.has(tokens[cursor]?.text ?? '')) {
      isDefaultExport = isDefaultExport || tokens[cursor]?.text === 'default'
      cursor -= 1
    }
    const isExported = isIdentifier(tokens[cursor], 'export') && !isPunctuation(tokens[cursor - 1], '.')

    return { isExported, isDefaultExport: isExported && isDefaultExport }
  }

  // A named function or class written where a value is expected is known by its name only inside itself.
  function isInExpressionPosition(index: number): boolean {
    let cursor = index - 1
    while (isIdentifier(tokens[cursor], 'async')) {
      cursor -= 1
    }
    const previousToken = tokens[cursor]
    if (previousToken === undefined) {
      return false
    }
    if (previousToken.kind === 'punctuation') {
      return !PUNCTUATION_BEFORE_A_STATEMENT.has(previousToken.text)
    }

    return previousToken.kind === 'identifier' && WORDS_BEFORE_AN_EXPRESSION.has(previousToken.text)
  }

  function typeParameterNameIndexes(openIndex: number): number[] {
    const nameIndexes: number[] = []
    const indexAfterParameters = indexAfterAngleGroup(tokens, matchingIndexes, openIndex)
    let depth = 0
    let expectsName = false
    for (let index = openIndex; index < indexAfterParameters; index += 1) {
      const token = tokens[index]
      if (token === undefined) {
        break
      }
      if (token.kind === 'punctuation') {
        if (token.text === '<') {
          depth += 1
          expectsName = depth === 1
        } else if (token.text === '>') {
          depth -= 1
        } else if (token.text === ',' && depth === 1) {
          expectsName = true
        } else if (token.text === '(' || token.text === '[' || token.text === '{') {
          index = Math.max(index, matchingIndexes[index] ?? index)
        }
        continue
      }
      if (expectsName && token.kind === 'identifier' && !['const', 'in', 'out'].includes(token.text)) {
        nameIndexes.push(index)
        expectsName = false
      }
    }

    return nameIndexes
  }

  function declareTypeParameters(scope: ScriptScope, openIndex: number): void {
    for (const nameIndex of typeParameterNameIndexes(openIndex)) {
      declare(scope, {
        name: tokens[nameIndex]?.text ?? '',
        kind: 'typeParameter',
        role: 'binding',
        nameTokenIndex: nameIndex,
      })
    }
  }

  function declareBoundNames(
    scope: ScriptScope,
    boundNames: readonly BoundName[],
    fields: Omit<DeclarationFields, 'name' | 'nameTokenIndex' | 'sourceProperty'>,
  ): void {
    for (const boundName of boundNames) {
      const declaration = declare(scope, {
        ...fields,
        name: tokens[boundName.tokenIndex]?.text ?? '',
        nameTokenIndex: boundName.tokenIndex,
        sourceProperty: boundName.sourceProperty,
      })
      if (boundName.keyTokenIndex !== null) {
        structure.destructuredKeyAtToken.set(boundName.keyTokenIndex, declaration)
      }
    }
  }

  // The scope of a function runs from its opening parenthesis to the end of its body, so that its parameters and
  // the names of its body are looked up together.
  function scheduleFunctionScope(
    openIndex: number,
    closeIndex: number,
  ): { scope: ScriptScope; parameters: ParameterReading[] } {
    let cursor = closeIndex + 1
    if (isPunctuation(tokens[cursor], ':')) {
      cursor = indexAfterType(tokens, matchingIndexes, cursor + 1)
    }
    let endIndex = closeIndex
    if (isPunctuation(tokens[cursor], '=>')) {
      arrowIndexesOfKnownFunctions.add(cursor)
      cursor += 1
      endIndex = isPunctuation(tokens[cursor], '{')
        ? cursor
        : indexAfterExpression(tokens, matchingIndexes, cursor, true) - 1
    }
    if (isPunctuation(tokens[cursor], '{') && (matchingIndexes[cursor] ?? -1) !== -1) {
      bracesWithoutScope.add(cursor)
      endIndex = matchingIndexes[cursor] ?? cursor
    }
    const scope = newScope('function', openIndex, endIndex)
    scheduleScope(scope)
    const parameters = readParameterList(tokens, matchingIndexes, openIndex + 1, closeIndex)
    for (const parameter of parameters) {
      markPatternBraces(parameter.patternStartIndex, parameter.indexAfterPattern)
      const isPlainName = parameter.boundNames.length === 1 && parameter.boundNames[0]?.sourceProperty === null
      declareBoundNames(scope, parameter.boundNames, {
        kind: 'parameter',
        role: 'binding',
        valueTokenIndex: parameter.defaultValueTokenIndex,
        typeTokenIndex:
          isPlainName && parameter.typeTokenIndex !== null
            ? plainTypeNameIndex(tokens, matchingIndexes, parameter.typeTokenIndex)
            : null,
      })
    }

    return { scope, parameters }
  }

  function readFunctionDeclaration(index: number): void {
    let cursor = index + 1
    if (isPunctuation(tokens[cursor], '*')) {
      cursor += 1
    }
    const nameIndex = isIdentifier(tokens[cursor]) ? cursor : null
    if (nameIndex !== null) {
      cursor += 1
    }
    const typeParametersIndex = isPunctuation(tokens[cursor], '<') ? cursor : null
    if (typeParametersIndex !== null) {
      cursor = indexAfterAngleGroup(tokens, matchingIndexes, cursor)
    }
    const closeIndex = matchingIndexes[cursor] ?? -1
    if (!isPunctuation(tokens[cursor], '(')) {
      return
    }
    if (closeIndex === -1) {
      if (nameIndex !== null && !isInExpressionPosition(index)) {
        declare(currentScope(), {
          name: tokens[nameIndex]?.text ?? '',
          kind: 'function',
          role: 'binding',
          nameTokenIndex: nameIndex,
          ...exportFlagsBefore(index),
        })
      }
      return
    }
    const { scope } = scheduleFunctionScope(cursor, closeIndex)
    if (typeParametersIndex !== null) {
      declareTypeParameters(scope, typeParametersIndex)
    }
    if (nameIndex !== null) {
      scope.owner = declare(isInExpressionPosition(index) ? scope : currentScope(), {
        name: tokens[nameIndex]?.text ?? '',
        kind: 'function',
        role: 'binding',
        nameTokenIndex: nameIndex,
        valueTokenIndex: cursor,
        ...exportFlagsBefore(index),
      })
    }
  }

  function readClassOrInterface(index: number, kind: 'class' | 'interface'): void {
    let cursor = index + 1
    const hasName = isIdentifier(tokens[cursor]) && !['extends', 'implements'].includes(tokens[cursor]?.text ?? '')
    const nameIndex = hasName ? cursor : null
    if (nameIndex !== null) {
      cursor += 1
    } else if (kind === 'interface') {
      return
    }
    const typeParametersIndex = isPunctuation(tokens[cursor], '<') ? cursor : null
    if (typeParametersIndex !== null) {
      cursor = indexAfterAngleGroup(tokens, matchingIndexes, cursor)
    }
    const extendedNameIndexes: number[] = []
    const implementedNameIndexes: number[] = []
    let heritageNameIndexes: number[] | null = null
    while (cursor < tokens.length && !isPunctuation(tokens[cursor], '{')) {
      const token = tokens[cursor]
      if (isIdentifier(token, 'extends')) {
        heritageNameIndexes = extendedNameIndexes
        cursor += 1
      } else if (isIdentifier(token, 'implements')) {
        heritageNameIndexes = implementedNameIndexes
        cursor += 1
      } else if (isIdentifier(token) && heritageNameIndexes !== null) {
        while (isPunctuation(tokens[cursor + 1], '.') && isIdentifier(tokens[cursor + 2])) {
          cursor += 2
        }
        heritageNameIndexes.push(cursor)
        cursor += 1
        if (isPunctuation(tokens[cursor], '<')) {
          cursor = indexAfterAngleGroup(tokens, matchingIndexes, cursor)
        }
        if (isPunctuation(tokens[cursor], '(')) {
          cursor = indexAfterGroup(matchingIndexes, cursor)
        }
      } else if (isPunctuation(token, ',') && heritageNameIndexes !== null) {
        cursor += 1
      } else if (isPunctuation(token, '(') || isPunctuation(token, '[')) {
        cursor = indexAfterGroup(matchingIndexes, cursor)
      } else if (
        isPunctuation(token, ';') ||
        isPunctuation(token, '}') ||
        isPunctuation(token, ')') ||
        isPunctuation(token, '=')
      ) {
        return
      } else {
        cursor += 1
      }
    }
    const closeIndex = matchingIndexes[cursor] ?? -1
    if (closeIndex === -1) {
      return
    }
    const scope = newScope(kind, cursor, closeIndex)
    scheduleScope(scope)
    if (nameIndex !== null) {
      scope.owner = declare(kind === 'class' && isInExpressionPosition(index) ? scope : currentScope(), {
        name: tokens[nameIndex]?.text ?? '',
        kind,
        role: 'binding',
        nameTokenIndex: nameIndex,
        valueTokenIndex: cursor,
        extendedNameIndexes,
        implementedNameIndexes,
        ...exportFlagsBefore(index),
      })
    }
    if (typeParametersIndex !== null) {
      declareTypeParameters(scope, typeParametersIndex)
    }
    readMembers(scope)
  }

  function readEnum(index: number): void {
    const openIndex = index + 2
    const closeIndex = matchingIndexes[openIndex] ?? -1
    if (!isIdentifier(tokens[index + 1]) || !isPunctuation(tokens[openIndex], '{') || closeIndex === -1) {
      return
    }
    const scope = newScope('enum', openIndex, closeIndex)
    scheduleScope(scope)
    scope.owner = declare(currentScope(), {
      name: tokens[index + 1]?.text ?? '',
      kind: 'enum',
      role: 'binding',
      nameTokenIndex: index + 1,
      valueTokenIndex: openIndex,
      ...exportFlagsBefore(index),
    })
    readMembers(scope)
  }

  function readNamespace(index: number): void {
    let nameIndex = index + 1
    if (!isIdentifier(tokens[nameIndex])) {
      return
    }
    while (isPunctuation(tokens[nameIndex + 1], '.') && isIdentifier(tokens[nameIndex + 2])) {
      nameIndex += 2
    }
    const openIndex = nameIndex + 1
    const closeIndex = matchingIndexes[openIndex] ?? -1
    if (!isPunctuation(tokens[openIndex], '{') || closeIndex === -1) {
      return
    }
    const scope = newScope('namespace', openIndex, closeIndex)
    scheduleScope(scope)
    scope.owner = declare(currentScope(), {
      name: tokens[nameIndex]?.text ?? '',
      kind: 'namespace',
      role: 'binding',
      nameTokenIndex: nameIndex,
      valueTokenIndex: openIndex,
      ...exportFlagsBefore(index),
    })
  }

  function readTypeAlias(index: number): void {
    const nameIndex = index + 1
    let cursor = index + 2
    if (!isIdentifier(tokens[nameIndex])) {
      return
    }
    const typeParametersIndex = isPunctuation(tokens[cursor], '<') ? cursor : null
    if (typeParametersIndex !== null) {
      cursor = indexAfterAngleGroup(tokens, matchingIndexes, cursor)
    }
    if (!isPunctuation(tokens[cursor], '=')) {
      return
    }
    declare(currentScope(), {
      name: tokens[nameIndex]?.text ?? '',
      kind: 'type',
      role: 'binding',
      nameTokenIndex: nameIndex,
      valueTokenIndex: cursor + 1,
      ...exportFlagsBefore(index),
    })
    if (typeParametersIndex !== null) {
      const scope = newScope('block', typeParametersIndex, indexAfterType(tokens, matchingIndexes, cursor + 1) - 1)
      scheduleScope(scope)
      declareTypeParameters(scope, typeParametersIndex)
    }
  }

  function readVariables(index: number, keyword: string): void {
    if (keyword === 'const' && isIdentifier(tokens[index + 1], 'enum')) {
      return
    }
    const exportFlags = exportFlagsBefore(index)
    const kindOfPlainValue: DeclarationKind = keyword === 'const' ? 'constant' : 'variable'
    let cursor = index + 1
    for (let declaratorCount = 0; declaratorCount < MAXIMUM_DECLARATORS_PER_STATEMENT; declaratorCount += 1) {
      const startToken = tokens[cursor]
      if (!isIdentifier(startToken) && !isPunctuation(startToken, '{') && !isPunctuation(startToken, '[')) {
        return
      }
      const isPlainName = isIdentifier(startToken)
      const pattern = readBindingPattern(tokens, matchingIndexes, cursor)
      if (declaratorCount > 0 && !mayFollowADeclaredName(tokens[pattern.indexAfterPattern])) {
        return
      }
      markPatternBraces(cursor, pattern.indexAfterPattern)
      cursor = pattern.indexAfterPattern
      if (isPunctuation(tokens[cursor], '!')) {
        cursor += 1
      }
      let typeTokenIndex: number | null = null
      if (isPunctuation(tokens[cursor], ':')) {
        typeTokenIndex = isPlainName ? plainTypeNameIndex(tokens, matchingIndexes, cursor + 1) : null
        cursor = indexAfterType(tokens, matchingIndexes, cursor + 1)
      }
      const valueTokenIndex = isPunctuation(tokens[cursor], '=') ? cursor + 1 : null
      const requiredSpecifier = valueTokenIndex === null ? null : specifierOfRequireCallAt(valueTokenIndex)
      if (requiredSpecifier !== null) {
        for (const boundName of pattern.boundNames) {
          declare(currentScope(), {
            name: tokens[boundName.tokenIndex]?.text ?? '',
            kind: 'import',
            role: 'binding',
            nameTokenIndex: boundName.tokenIndex,
            importBinding: {
              importedName: isPlainName ? '*' : (boundName.sourceProperty ?? '*'),
              specifier: requiredSpecifier,
              isTypeOnly: false,
            },
          })
        }
        return
      }
      const isFunction =
        isPlainName && valueTokenIndex !== null && startsFunctionExpression(tokens, matchingIndexes, valueTokenIndex)
      declareBoundNames(currentScope(), pattern.boundNames, {
        kind: isFunction ? 'function' : kindOfPlainValue,
        role: 'binding',
        valueTokenIndex,
        typeTokenIndex,
        ...exportFlags,
      })
      const indexAfterDeclarator =
        valueTokenIndex === null ? cursor : indexAfterExpression(tokens, matchingIndexes, valueTokenIndex, true)
      if (!isPunctuation(tokens[indexAfterDeclarator], ',')) {
        return
      }
      cursor = indexAfterDeclarator + 1
    }
  }

  function mayFollowADeclaredName(token: ScriptToken | undefined): boolean {
    if (token === undefined || token.followsLineBreak) {
      return true
    }

    return token.kind === 'punctuation'
      ? ['=', ':', ',', ';', '!'].includes(token.text)
      : token.text === 'in' || token.text === 'of'
  }

  function specifierOfRequireCallAt(index: number): string | null {
    const argumentToken = tokens[index + 2]
    const isRequireCall =
      isIdentifier(tokens[index], 'require') &&
      isPunctuation(tokens[index + 1], '(') &&
      isPunctuation(tokens[index + 3], ')')
    if (!isRequireCall || argumentToken === undefined || argumentToken.kind !== 'string') {
      return null
    }
    const specifier = stringTokenValue(argumentToken)
    structure.specifierAtToken.set(index + 2, specifier)

    return specifier
  }

  function readCatchClause(index: number): void {
    const openIndex = index + 1
    const closeIndex = matchingIndexes[openIndex] ?? -1
    const bodyIndex = closeIndex + 1
    const bodyCloseIndex = matchingIndexes[bodyIndex] ?? -1
    if (
      !isPunctuation(tokens[openIndex], '(') ||
      closeIndex === -1 ||
      !isPunctuation(tokens[bodyIndex], '{') ||
      bodyCloseIndex === -1
    ) {
      return
    }
    const scope = newScope('block', openIndex, bodyCloseIndex)
    scheduleScope(scope)
    bracesWithoutScope.add(bodyIndex)
    const pattern = readBindingPattern(tokens, matchingIndexes, openIndex + 1)
    markPatternBraces(openIndex + 1, closeIndex)
    declareBoundNames(scope, pattern.boundNames, { kind: 'parameter', role: 'binding' })
  }

  function readLoopHeader(index: number): void {
    const openIndex = isIdentifier(tokens[index + 1], 'await') ? index + 2 : index + 1
    const closeIndex = matchingIndexes[openIndex] ?? -1
    if (!isPunctuation(tokens[openIndex], '(') || closeIndex === -1) {
      return
    }
    const bodyIndex = closeIndex + 1
    const bodyCloseIndex = isPunctuation(tokens[bodyIndex], '{') ? (matchingIndexes[bodyIndex] ?? -1) : -1
    if (bodyCloseIndex !== -1) {
      bracesWithoutScope.add(bodyIndex)
    }
    scheduleScope(newScope('block', openIndex, bodyCloseIndex === -1 ? closeIndex : bodyCloseIndex))
  }

  function readImportClauseNames(openIndex: number, isStatementTypeOnly: boolean, specifier: string): void {
    const closeIndex = matchingIndexes[openIndex] ?? -1
    let cursor = openIndex + 1
    while (cursor < closeIndex) {
      let isTypeOnly = isStatementTypeOnly
      const followsTypeKeyword =
        isIdentifier(tokens[cursor], 'type') && (isIdentifier(tokens[cursor + 1]) || tokens[cursor + 1]?.kind === 'string')
      if (followsTypeKeyword && !isIdentifier(tokens[cursor + 1], 'as')) {
        isTypeOnly = true
        cursor += 1
      }
      const importedToken = tokens[cursor]
      if (importedToken === undefined || (importedToken.kind !== 'identifier' && importedToken.kind !== 'string')) {
        return
      }
      const importedName = importedToken.kind === 'string' ? stringTokenValue(importedToken) : importedToken.text
      const importBinding: ImportBinding = { importedName, specifier, isTypeOnly }
      let localIndex = cursor
      if (isIdentifier(tokens[cursor + 1], 'as') && isIdentifier(tokens[cursor + 2])) {
        localIndex = cursor + 2
        structure.importedNameAtToken.set(cursor, importBinding)
      }
      declare(fileScope, {
        name: tokens[localIndex]?.text ?? '',
        kind: 'import',
        role: 'binding',
        nameTokenIndex: localIndex,
        importBinding,
      })
      cursor = localIndex + 1
      if (!isPunctuation(tokens[cursor], ',')) {
        return
      }
      cursor += 1
    }
  }

  function readImport(index: number): void {
    const nextToken = tokens[index + 1]
    if (isPunctuation(nextToken, '(')) {
      const argumentToken = tokens[index + 2]
      if (argumentToken !== undefined && argumentToken.kind === 'string') {
        structure.specifierAtToken.set(index + 2, stringTokenValue(argumentToken))
      }
      return
    }
    if (nextToken !== undefined && nextToken.kind === 'string') {
      structure.specifierAtToken.set(index + 1, stringTokenValue(nextToken))
      return
    }
    let cursor = index + 1
    const afterTypeKeyword = tokens[cursor + 1]
    const isTypeOnly =
      isIdentifier(tokens[cursor], 'type') &&
      afterTypeKeyword !== undefined &&
      !isIdentifier(afterTypeKeyword, 'from') &&
      !isPunctuation(afterTypeKeyword, ',') &&
      !isPunctuation(afterTypeKeyword, '=')
    if (isTypeOnly) {
      cursor += 1
    }
    const defaultNameIndex = isIdentifier(tokens[cursor]) ? cursor : null
    if (defaultNameIndex !== null) {
      cursor += 1
      if (isPunctuation(tokens[cursor], ',')) {
        cursor += 1
      }
    }
    let namespaceNameIndex: number | null = null
    let clauseIndex: number | null = null
    if (isPunctuation(tokens[cursor], '*') && isIdentifier(tokens[cursor + 1], 'as') && isIdentifier(tokens[cursor + 2])) {
      namespaceNameIndex = cursor + 2
      cursor += 3
    } else if (isPunctuation(tokens[cursor], '{') && (matchingIndexes[cursor] ?? -1) !== -1) {
      clauseIndex = cursor
      bracesWithoutScope.add(cursor)
      cursor = indexAfterGroup(matchingIndexes, cursor)
    }
    let specifierIndex = -1
    let importedNameOfWholeModule = 'default'
    if (isIdentifier(tokens[cursor], 'from') && tokens[cursor + 1]?.kind === 'string') {
      specifierIndex = cursor + 1
    } else if (
      isPunctuation(tokens[cursor], '=') &&
      isIdentifier(tokens[cursor + 1], 'require') &&
      tokens[cursor + 3]?.kind === 'string'
    ) {
      specifierIndex = cursor + 3
      importedNameOfWholeModule = '*'
    }
    const specifierToken = tokens[specifierIndex]
    if (specifierToken === undefined) {
      return
    }
    const specifier = stringTokenValue(specifierToken)
    structure.specifierAtToken.set(specifierIndex, specifier)
    if (defaultNameIndex !== null) {
      declare(fileScope, {
        name: tokens[defaultNameIndex]?.text ?? '',
        kind: 'import',
        role: 'binding',
        nameTokenIndex: defaultNameIndex,
        importBinding: { importedName: importedNameOfWholeModule, specifier, isTypeOnly },
      })
    }
    if (namespaceNameIndex !== null) {
      declare(fileScope, {
        name: tokens[namespaceNameIndex]?.text ?? '',
        kind: 'import',
        role: 'binding',
        nameTokenIndex: namespaceNameIndex,
        importBinding: { importedName: '*', specifier, isTypeOnly },
      })
    }
    if (clauseIndex !== null) {
      readImportClauseNames(clauseIndex, isTypeOnly, specifier)
    }
  }

  function readExportClause(openIndex: number): void {
    const closeIndex = matchingIndexes[openIndex] ?? -1
    if (closeIndex === -1) {
      return
    }
    bracesWithoutScope.add(openIndex)
    const specifierToken = isIdentifier(tokens[closeIndex + 1], 'from') ? tokens[closeIndex + 2] : undefined
    const specifier =
      specifierToken !== undefined && specifierToken.kind === 'string' ? stringTokenValue(specifierToken) : null
    if (specifier !== null) {
      structure.specifierAtToken.set(closeIndex + 2, specifier)
    }
    let cursor = openIndex + 1
    while (cursor < closeIndex) {
      if (
        isIdentifier(tokens[cursor], 'type') &&
        isIdentifier(tokens[cursor + 1]) &&
        !isIdentifier(tokens[cursor + 1], 'as')
      ) {
        cursor += 1
      }
      const localToken = tokens[cursor]
      if (!isIdentifier(localToken)) {
        return
      }
      const hasAlias = isIdentifier(tokens[cursor + 1], 'as') && tokens[cursor + 2] !== undefined
      const exportedIndex = hasAlias ? cursor + 2 : cursor
      structure.exportLinks.push({
        kind: 'named',
        exportedName: tokens[exportedIndex]?.text ?? '',
        localName: localToken.text,
        specifier,
      })
      if (specifier !== null) {
        structure.reexportedNameAtToken.set(cursor, { specifier, name: localToken.text })
        structure.reexportedNameAtToken.set(exportedIndex, { specifier, name: localToken.text })
      }
      cursor = exportedIndex + 1
      if (!isPunctuation(tokens[cursor], ',')) {
        return
      }
      cursor += 1
    }
  }

  function readExport(index: number): void {
    let cursor = index + 1
    if (
      isIdentifier(tokens[cursor], 'type') &&
      (isPunctuation(tokens[cursor + 1], '{') || isPunctuation(tokens[cursor + 1], '*'))
    ) {
      cursor += 1
    }
    if (isPunctuation(tokens[cursor], '{')) {
      readExportClause(cursor)
      return
    }
    if (isPunctuation(tokens[cursor], '*')) {
      cursor += 1
      let namespaceName: string | null = null
      if (isIdentifier(tokens[cursor], 'as') && isIdentifier(tokens[cursor + 1])) {
        namespaceName = tokens[cursor + 1]?.text ?? null
        cursor += 2
      }
      const specifierToken = tokens[cursor + 1]
      if (isIdentifier(tokens[cursor], 'from') && specifierToken !== undefined && specifierToken.kind === 'string') {
        const specifier = stringTokenValue(specifierToken)
        structure.specifierAtToken.set(cursor + 1, specifier)
        structure.exportLinks.push({ kind: 'star', namespaceName, specifier })
      }
      return
    }
    if (isIdentifier(tokens[cursor], 'default') || isPunctuation(tokens[cursor], '=')) {
      const exportedToken = tokens[cursor + 1]
      const tokenAfterExported = tokens[cursor + 2]
      const isLoneName =
        isIdentifier(exportedToken) &&
        !WORDS_NEVER_NAMING_A_METHOD.has(exportedToken.text) &&
        !['class', 'async', 'abstract', 'interface', 'enum'].includes(exportedToken.text) &&
        (tokenAfterExported === undefined || isPunctuation(tokenAfterExported, ';') || tokenAfterExported.followsLineBreak)
      structure.defaultExport = { tokenIndex: cursor, referenceTokenIndex: isLoneName ? cursor + 1 : null }
    }
  }

  function memberKindOfValue(scope: ScriptScope, valueIndex: number | null): DeclarationKind {
    if (scope.kind === 'enum') {
      return 'constant'
    }

    return valueIndex !== null && startsFunctionExpression(tokens, matchingIndexes, valueIndex) ? 'method' : 'property'
  }

  function isMemberNameStart(token: ScriptToken | undefined): boolean {
    return (
      token !== undefined &&
      (token.kind === 'identifier' ||
        token.kind === 'string' ||
        token.kind === 'number' ||
        isPunctuation(token, '[') ||
        isPunctuation(token, '*'))
    )
  }

  // Reads the member that starts at this index and answers where the scan of the holder goes on, and whether the
  // member is over there (a method with its body) so that the next token starts another one.
  function readMemberAt(scope: ScriptScope, startIndex: number): { nextIndex: number; isComplete: boolean } {
    const closeIndex = scope.endTokenIndex
    let cursor = startIndex
    while (isPunctuation(tokens[cursor], '@')) {
      cursor += 2
      while (isPunctuation(tokens[cursor], '.')) {
        cursor += 2
      }
      if (isPunctuation(tokens[cursor], '(')) {
        cursor = indexAfterGroup(matchingIndexes, cursor)
      }
    }
    while (
      isIdentifier(tokens[cursor]) &&
      MEMBER_MODIFIERS.has(tokens[cursor]?.text ?? '') &&
      isMemberNameStart(tokens[cursor + 1])
    ) {
      cursor += 1
    }
    if (isPunctuation(tokens[cursor], '*')) {
      cursor += 1
    }
    const nameToken = tokens[cursor]
    if (nameToken === undefined || cursor >= closeIndex) {
      return { nextIndex: closeIndex, isComplete: false }
    }
    if (isPunctuation(nameToken, '[')) {
      return { nextIndex: indexAfterGroup(matchingIndexes, cursor), isComplete: false }
    }
    if (nameToken.kind !== 'identifier' && nameToken.kind !== 'string' && nameToken.kind !== 'number') {
      return { nextIndex: cursor === startIndex ? startIndex : cursor, isComplete: false }
    }
    const name = nameToken.kind === 'string' ? stringTokenValue(nameToken) : nameToken.text
    let indexAfterName = cursor + 1
    const isMarkedOptional = isPunctuation(tokens[indexAfterName], '?') || isPunctuation(tokens[indexAfterName], '!')
    if (
      isMarkedOptional &&
      (isPunctuation(tokens[indexAfterName + 1], ':') || isPunctuation(tokens[indexAfterName + 1], '('))
    ) {
      indexAfterName += 1
    }
    const tokenAfterName = tokens[indexAfterName]
    const hasTypeParameters = isPunctuation(tokenAfterName, '<') && tokenAfterName?.start === nameToken.end
    if (isPunctuation(tokenAfterName, '(') || hasTypeParameters) {
      const openIndex = hasTypeParameters ? indexAfterAngleGroup(tokens, matchingIndexes, indexAfterName) : indexAfterName
      const parametersCloseIndex = matchingIndexes[openIndex] ?? -1
      if (!isPunctuation(tokens[openIndex], '(') || parametersCloseIndex === -1) {
        return { nextIndex: indexAfterName, isComplete: false }
      }
      declare(scope, {
        name,
        kind: scope.kind === 'enum' ? 'constant' : 'method',
        role: 'member',
        nameTokenIndex: cursor,
        valueTokenIndex: openIndex,
      })
      let indexAfterHeader = parametersCloseIndex + 1
      if (isPunctuation(tokens[indexAfterHeader], ':')) {
        indexAfterHeader = indexAfterType(tokens, matchingIndexes, indexAfterHeader + 1)
      }
      const bodyCloseIndex = isPunctuation(tokens[indexAfterHeader], '{') ? (matchingIndexes[indexAfterHeader] ?? -1) : -1
      if (bodyCloseIndex === -1) {
        return { nextIndex: indexAfterHeader, isComplete: false }
      }

      return { nextIndex: bodyCloseIndex + 1, isComplete: scope.kind !== 'object' }
    }
    if (isPunctuation(tokenAfterName, ':')) {
      const annotationIndex = indexAfterName + 1
      let valueIndex = annotationIndex
      if (scope.kind !== 'object') {
        const indexAfterAnnotation = indexAfterType(tokens, matchingIndexes, annotationIndex)
        valueIndex = isPunctuation(tokens[indexAfterAnnotation], '=') ? indexAfterAnnotation + 1 : annotationIndex
      }
      declare(scope, {
        name,
        kind: memberKindOfValue(scope, valueIndex),
        role: 'member',
        nameTokenIndex: cursor,
        valueTokenIndex: valueIndex,
        typeTokenIndex: plainTypeNameIndex(tokens, matchingIndexes, annotationIndex),
      })

      return { nextIndex: annotationIndex, isComplete: false }
    }
    if (isPunctuation(tokenAfterName, '=') && scope.kind !== 'object') {
      declare(scope, {
        name,
        kind: memberKindOfValue(scope, indexAfterName + 1),
        role: 'member',
        nameTokenIndex: cursor,
        valueTokenIndex: indexAfterName + 1,
      })

      return { nextIndex: indexAfterName + 1, isComplete: false }
    }
    const endsTheMember =
      indexAfterName >= closeIndex ||
      isPunctuation(tokenAfterName, ',') ||
      isPunctuation(tokenAfterName, ';') ||
      (scope.kind !== 'object' && tokenAfterName?.followsLineBreak === true)
    if (endsTheMember && nameToken.kind === 'identifier') {
      declare(scope, {
        name,
        kind: memberKindOfValue(scope, null),
        role: 'member',
        nameTokenIndex: cursor,
        isShorthand: scope.kind === 'object',
      })
    }

    return { nextIndex: cursor + 1, isComplete: false }
  }

  // In an object literal a line break separates no members, unless the line begins like one ("name:", "name(").
  function mayStartMemberOnNewLine(scope: ScriptScope, index: number): boolean {
    if (!startsAfterImpliedSemicolon(tokens, index) || !isMemberNameStart(tokens[index])) {
      return isPunctuation(tokens[index], '@') && tokens[index]?.followsLineBreak === true
    }
    if (scope.kind !== 'object') {
      return true
    }
    const tokenAfterName = tokens[index + 1]

    return isPunctuation(tokenAfterName, ':') || isPunctuation(tokenAfterName, '?') || isPunctuation(tokenAfterName, '(')
  }

  function readMembers(scope: ScriptScope): void {
    const closeIndex = scope.endTokenIndex
    let index = scope.startTokenIndex + 1
    let isAtMemberStart = true
    let angleDepth = 0
    while (index < closeIndex) {
      const token = tokens[index]
      if (token === undefined) {
        return
      }
      if (!isAtMemberStart && angleDepth === 0 && mayStartMemberOnNewLine(scope, index)) {
        isAtMemberStart = true
      }
      if (isAtMemberStart) {
        const reading = readMemberAt(scope, index)
        isAtMemberStart = reading.isComplete
        angleDepth = 0
        if (reading.nextIndex > index) {
          index = reading.nextIndex
          continue
        }
      }
      if (token.kind === 'punctuation') {
        if (token.text === '(' || token.text === '[' || token.text === '{' || token.text === '${') {
          const groupCloseIndex = matchingIndexes[index] ?? -1
          index = groupCloseIndex === -1 ? index + 1 : groupCloseIndex + 1
          continue
        }
        if (token.text === ';' || (token.text === ',' && angleDepth === 0)) {
          isAtMemberStart = true
          angleDepth = 0
        } else if (token.text === '<' && opensTypeArguments(tokens, index)) {
          angleDepth += 1
        } else if (token.text === '>' && angleDepth > 0) {
          angleDepth -= 1
        }
      }
      index += 1
    }
  }

  function readMethodBody(index: number, token: ScriptToken): void {
    const scopeKind = currentScope().kind
    let openIndex = index + 1
    if (isPunctuation(tokens[openIndex], '<')) {
      if (!SCOPES_HOLDING_MEMBERS.includes(scopeKind) || tokens[openIndex]?.start !== token.end) {
        return
      }
      openIndex = indexAfterAngleGroup(tokens, matchingIndexes, openIndex)
    }
    const closeIndex = matchingIndexes[openIndex] ?? -1
    if (!isPunctuation(tokens[openIndex], '(') || closeIndex === -1 || structure.scopeStartingAt.has(openIndex)) {
      return
    }
    let indexAfterHeader = closeIndex + 1
    if (isPunctuation(tokens[indexAfterHeader], ':')) {
      indexAfterHeader = indexAfterType(tokens, matchingIndexes, indexAfterHeader + 1)
    }
    if (!isPunctuation(tokens[indexAfterHeader], '{')) {
      return
    }
    const classScope = currentScope()
    const { scope, parameters } = scheduleFunctionScope(openIndex, closeIndex)
    scope.owner = structure.declarationAtToken.get(index) ?? null
    if (token.text !== 'constructor' || classScope.kind !== 'class') {
      return
    }
    for (const parameter of parameters) {
      const nameIndex = parameter.boundNames[0]?.tokenIndex
      if (parameter.isProperty && nameIndex !== undefined) {
        declare(classScope, {
          name: tokens[nameIndex]?.text ?? '',
          kind: 'property',
          role: 'member',
          nameTokenIndex: nameIndex,
          typeTokenIndex:
            parameter.typeTokenIndex === null ? null : plainTypeNameIndex(tokens, matchingIndexes, parameter.typeTokenIndex),
        })
      }
    }
  }

  function readSingleParameterArrow(index: number, token: ScriptToken): void {
    const bodyIndex = index + 2
    const bodyCloseIndex = isPunctuation(tokens[bodyIndex], '{') ? (matchingIndexes[bodyIndex] ?? -1) : -1
    if (bodyCloseIndex !== -1) {
      bracesWithoutScope.add(bodyIndex)
    }
    const endIndex =
      bodyCloseIndex === -1 ? indexAfterExpression(tokens, matchingIndexes, bodyIndex, true) - 1 : bodyCloseIndex
    const scope = newScope('function', index, Math.max(endIndex, index + 1))
    scheduleScope(scope)
    declare(scope, { name: token.text, kind: 'parameter', role: 'binding', nameTokenIndex: index })
  }

  function readIdentifier(index: number, token: ScriptToken): void {
    const previousToken = tokens[index - 1]
    const nextToken = tokens[index + 1]
    if (isPunctuation(previousToken, '.') || isPunctuation(previousToken, '?.') || isPunctuation(nextToken, ':')) {
      return
    }
    switch (token.text) {
      case 'import':
        if (!isPunctuation(nextToken, '.')) {
          readImport(index)
        }
        return
      case 'export':
        readExport(index)
        return
      case 'function':
        readFunctionDeclaration(index)
        return
      case 'class':
        readClassOrInterface(index, 'class')
        return
      case 'interface':
        if (isIdentifier(nextToken)) {
          readClassOrInterface(index, 'interface')
        }
        return
      case 'enum':
        readEnum(index)
        return
      case 'type':
        if (isIdentifier(nextToken) && !isIdentifier(previousToken, 'import')) {
          readTypeAlias(index)
        }
        return
      case 'namespace':
      case 'module':
        readNamespace(index)
        return
      case 'const':
      case 'let':
      case 'var':
        readVariables(index, token.text)
        return
      case 'catch':
        readCatchClause(index)
        return
      case 'for':
        readLoopHeader(index)
        return
    }
    if (isPunctuation(nextToken, '=>') && !arrowIndexesOfKnownFunctions.has(index + 1)) {
      readSingleParameterArrow(index, token)
      return
    }
    if ((isPunctuation(nextToken, '(') || isPunctuation(nextToken, '<')) && !WORDS_NEVER_NAMING_A_METHOD.has(token.text)) {
      readMethodBody(index, token)
    }
  }

  function readParenthesis(index: number): void {
    if (structure.scopeStartingAt.has(index) || arrowIndexAfterParameters(tokens, matchingIndexes, index) === -1) {
      return
    }
    scheduleFunctionScope(index, matchingIndexes[index] ?? index)
  }

  function opensObjectLiteral(index: number): boolean {
    const previousToken = tokens[index - 1]
    if (previousToken === undefined) {
      return options.isExpression ?? false
    }
    if (previousToken.kind === 'identifier') {
      return WORDS_BEFORE_AN_OBJECT_LITERAL.has(previousToken.text) && !isPunctuation(tokens[index - 2], '.')
    }
    if (previousToken.kind !== 'punctuation' || PUNCTUATION_BEFORE_A_BLOCK.has(previousToken.text)) {
      return false
    }
    if (previousToken.text !== ':' || SCOPES_HOLDING_MEMBERS.includes(currentScope().kind)) {
      return true
    }
    for (let cursor = index - 2; cursor >= 0 && cursor >= index - 12; cursor -= 1) {
      const token = tokens[cursor]
      if (isIdentifier(token, 'case') || isIdentifier(token, 'default')) {
        return false
      }
      if (isPunctuation(token, ';') || isPunctuation(token, '{') || isPunctuation(token, '}') || isPunctuation(token, '?')) {
        break
      }
    }

    return true
  }

  function readBrace(index: number): void {
    const closeIndex = matchingIndexes[index] ?? -1
    if (structure.scopeStartingAt.has(index) || bracesWithoutScope.has(index) || closeIndex === -1) {
      return
    }
    const isObjectLiteral = opensObjectLiteral(index)
    const scope = newScope(isObjectLiteral ? 'object' : 'block', index, closeIndex)
    scheduleScope(scope)
    if (isObjectLiteral) {
      readMembers(scope)
    }
  }

  for (let index = 0; index < tokens.length; index += 1) {
    while (scopeStack.length > 1 && currentScope().endTokenIndex < index) {
      scopeStack.pop()
    }
    const scopeStartingHere = scopeToEnterAt.get(index)
    if (scopeStartingHere !== undefined) {
      scopeToEnterAt.delete(index)
      enterScope(scopeStartingHere)
    }
    const token = tokens[index]
    if (token === undefined) {
      continue
    }
    if (token.kind === 'identifier') {
      readIdentifier(index, token)
    } else if (token.kind === 'punctuation') {
      if (token.text === '(') {
        readParenthesis(index)
      } else if (token.text === '{') {
        readBrace(index)
      }
    }
    const scopeOpenedHere = scopeToEnterAt.get(index)
    if (scopeOpenedHere !== undefined) {
      scopeToEnterAt.delete(index)
      enterScope(scopeOpenedHere)
    }
  }

  for (const declaration of structure.declarationAtToken.values()) {
    const valueScope = valueScopeOf(structure, declaration)
    if (valueScope !== null && valueScope.owner === null) {
      valueScope.owner = declaration
    }
  }

  return structure
}
