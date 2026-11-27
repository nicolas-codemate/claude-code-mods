import { lineAndColumnOfOffset } from '../text-position'
import { tokenizePhp } from './tokens'
import type { PhpComment, PhpTokenizedSource } from './tokens'

export type PhpClassKind = 'class' | 'interface' | 'trait' | 'enum'

export type PhpFunctionKind = 'function' | 'method' | 'closure' | 'arrowFunction'

// A variable name keeps its dollar sign ("$order"); a property name does not ("total"), as a member access spells it.
export type PhpParameter = {
  name: string
  tokenIndex: number
  typeText: string | null
  isVariadic: boolean
  isPromoted: boolean
  leadingDocblock: PhpComment | null
}

// Every function, method, closure and arrow function of a file, from its keyword to the end of its body.
export type PhpFunctionScope = {
  kind: PhpFunctionKind
  name: string | null
  nameTokenIndex: number | null
  keywordTokenIndex: number
  parameters: PhpParameter[]
  capturedVariableNames: string[]
  returnTypeText: string | null
  docblock: PhpComment | null
  isStatic: boolean
  hasBody: boolean
  // The opening brace of the body; for an arrow function, the first token of its expression.
  bodyStartTokenIndex: number
  endTokenIndex: number
  parentScope: PhpFunctionScope | null
  classDeclaration: PhpClassDeclaration | null
  namespaceName: string
}

export type PhpPropertyDeclaration = {
  name: string
  tokenIndex: number
  typeText: string | null
  docblock: PhpComment | null
  isStatic: boolean
  promotedBy: PhpFunctionScope | null
}

export type PhpConstantDeclaration = { name: string; tokenIndex: number; isEnumCase: boolean }

export type PhpClassDeclaration = {
  kind: PhpClassKind
  // Empty for an anonymous class.
  name: string
  namespaceName: string
  fullyQualifiedName: string
  nameTokenIndex: number
  isAbstract: boolean
  extendsNames: string[]
  implementsNames: string[]
  traitNames: string[]
  docblock: PhpComment | null
  bodyStartTokenIndex: number
  bodyEndTokenIndex: number
  methods: PhpFunctionScope[]
  properties: PhpPropertyDeclaration[]
  constants: PhpConstantDeclaration[]
}

export type PhpDeclarationReference =
  | { kind: 'class'; classDeclaration: PhpClassDeclaration }
  | { kind: 'method'; classDeclaration: PhpClassDeclaration; method: PhpFunctionScope }
  | { kind: 'function'; functionScope: PhpFunctionScope }
  | { kind: 'property'; classDeclaration: PhpClassDeclaration; property: PhpPropertyDeclaration }
  | { kind: 'constant'; classDeclaration: PhpClassDeclaration | null; constant: PhpConstantDeclaration }
  | { kind: 'parameter'; functionScope: PhpFunctionScope; parameter: PhpParameter }

export type PhpImportKind = 'class' | 'function' | 'constant'

export type PhpImportReference = { kind: PhpImportKind; fullyQualifiedName: string }

export type PhpFileOutline = {
  path: string
  source: PhpTokenizedSource
  namespaceDeclarations: Array<{ tokenIndex: number; name: string }>
  classImports: Map<string, string>
  functionImports: Map<string, string>
  constantImports: Map<string, string>
  classes: PhpClassDeclaration[]
  anonymousClasses: PhpClassDeclaration[]
  functions: PhpFunctionScope[]
  functionScopes: PhpFunctionScope[]
  constants: PhpConstantDeclaration[]
  declarationsByTokenIndex: Map<number, PhpDeclarationReference>
  importsByTokenIndex: Map<number, PhpImportReference>
  // The name tokens standing where only a class can: a type, after new, before ::, in extends or implements...
  classReferenceTokenIndexes: Set<number>
}

type OpenScope = {
  endTokenIndex: number
  bodyStartTokenIndex: number
  classDeclaration: PhpClassDeclaration | null
  functionScope: PhpFunctionScope | null
}

const DECLARATION_MODIFIERS = new Set(['public', 'protected', 'private', 'static', 'abstract', 'final', 'readonly', 'var'])
const PROMOTION_MODIFIERS = new Set(['public', 'protected', 'private', 'readonly'])
const TYPE_PUNCTUATION = new Set(['?', '|', '&', '(', ')'])

export function shortNameOf(qualifiedName: string): string {
  return qualifiedName.slice(qualifiedName.lastIndexOf('\\') + 1)
}

export function namespaceOf(fullyQualifiedName: string): string {
  const separatorIndex = fullyQualifiedName.lastIndexOf('\\')

  return separatorIndex === -1 ? '' : fullyQualifiedName.slice(0, separatorIndex)
}

function qualifiedIn(namespaceName: string, name: string): string {
  return namespaceName === '' ? name : `${namespaceName}\\${name}`
}

// A class name as a file writes it, turned into its fully qualified name by the file's use statements and namespace.
export function resolveClassName(outline: PhpFileOutline, namespaceName: string, writtenName: string): string {
  if (writtenName.startsWith('\\')) {
    return writtenName.slice(1)
  }
  const separatorIndex = writtenName.indexOf('\\')
  const firstSegment = separatorIndex === -1 ? writtenName : writtenName.slice(0, separatorIndex)
  if (firstSegment === 'namespace' && separatorIndex !== -1) {
    return qualifiedIn(namespaceName, writtenName.slice(separatorIndex + 1))
  }
  const importedName = outline.classImports.get(firstSegment)
  if (importedName !== undefined) {
    return separatorIndex === -1 ? importedName : `${importedName}${writtenName.slice(separatorIndex)}`
  }

  return qualifiedIn(namespaceName, writtenName)
}

export function namespaceAt(outline: PhpFileOutline, tokenIndex: number): string {
  let namespaceName = ''
  for (const declaration of outline.namespaceDeclarations) {
    if (declaration.tokenIndex > tokenIndex) {
      break
    }
    namespaceName = declaration.name
  }

  return namespaceName
}

export function enclosingClassAt(outline: PhpFileOutline, tokenIndex: number): PhpClassDeclaration | null {
  let innermost: PhpClassDeclaration | null = null
  for (const classDeclaration of [...outline.classes, ...outline.anonymousClasses]) {
    const isInside = tokenIndex > classDeclaration.bodyStartTokenIndex && tokenIndex < classDeclaration.bodyEndTokenIndex
    if (isInside && (innermost === null || classDeclaration.bodyStartTokenIndex > innermost.bodyStartTokenIndex)) {
      innermost = classDeclaration
    }
  }

  return innermost
}

// The class a token belongs to: the one whose body holds it, else the one declared right below it, as for an
// attribute written above a class and naming self.
export function classAround(outline: PhpFileOutline, tokenIndex: number): PhpClassDeclaration | null {
  return enclosingClassAt(outline, tokenIndex) ?? outline.classes.find(classDeclaration => classDeclaration.nameTokenIndex > tokenIndex) ?? null
}

export function enclosingFunctionScopeAt(outline: PhpFileOutline, tokenIndex: number): PhpFunctionScope | null {
  let innermost: PhpFunctionScope | null = null
  for (const functionScope of outline.functionScopes) {
    if (functionScope.keywordTokenIndex > tokenIndex) {
      break
    }
    if (tokenIndex <= functionScope.endTokenIndex) {
      innermost = functionScope
    }
  }

  return innermost
}

export function positionOfToken(outline: PhpFileOutline, tokenIndex: number): { line: number; column: number } {
  const offset = outline.source.tokens[tokenIndex]?.start ?? 0

  return positionOfOffset(outline, offset)
}

export function positionOfOffset(outline: PhpFileOutline, offset: number): { line: number; column: number } {
  return lineAndColumnOfOffset(outline.source.lineStartOffsets, offset)
}

export function lineTextAt(outline: PhpFileOutline, line: number): string {
  const { text, lineStartOffsets } = outline.source
  const lineStartOffset = lineStartOffsets[line - 1]
  if (lineStartOffset === undefined) {
    return ''
  }
  const nextLineStartOffset = lineStartOffsets[line]

  return text.slice(lineStartOffset, nextLineStartOffset === undefined ? text.length : nextLineStartOffset - 1).replace(/\r$/, '')
}

export function parsePhpOutline(path: string, text: string): PhpFileOutline {
  const source = tokenizePhp(text)
  const { tokens, matchingBracketIndexes } = source
  const outline: PhpFileOutline = {
    path,
    source,
    namespaceDeclarations: [],
    classImports: new Map(),
    functionImports: new Map(),
    constantImports: new Map(),
    classes: [],
    anonymousClasses: [],
    functions: [],
    functionScopes: [],
    constants: [],
    declarationsByTokenIndex: new Map(),
    importsByTokenIndex: new Map(),
    classReferenceTokenIndexes: new Set(),
  }
  const openScopes: OpenScope[] = []
  let namespaceName = ''

  const textAt = (tokenIndex: number): string => tokens[tokenIndex]?.text ?? ''
  const isNameAt = (tokenIndex: number): boolean => tokens[tokenIndex]?.kind === 'name'
  const closingIndexOf = (openingIndex: number): number => {
    const closingIndex = matchingBracketIndexes[openingIndex] ?? -1

    return closingIndex === -1 ? tokens.length - 1 : closingIndex
  }
  // private(set) restricts writing only; a parenthesis after a modifier can also open the type itself, a DNF type
  // such as (Customer&Stringable)|null, which must be read whole.
  const tokenCountOfModifierAt = (modifierTokenIndex: number): number => {
    const isAsymmetricVisibility =
      textAt(modifierTokenIndex + 1) === '(' && textAt(modifierTokenIndex + 2).toLowerCase() === 'set' && textAt(modifierTokenIndex + 3) === ')'

    return isAsymmetricVisibility ? 4 : 1
  }
  const sourceBetween = (firstTokenIndex: number, lastTokenIndex: number): string =>
    text.slice(tokens[firstTokenIndex]?.start ?? 0, tokens[lastTokenIndex]?.end ?? 0)

  // The modifiers and attributes written before a declaration's keyword: where its docblock is attached.
  const declarationStartBefore = (keywordTokenIndex: number, lowestTokenIndex: number): number => {
    let startTokenIndex = keywordTokenIndex
    while (startTokenIndex - 1 > lowestTokenIndex) {
      const previous = tokens[startTokenIndex - 1]
      if (previous?.kind === 'name' && DECLARATION_MODIFIERS.has(previous.text)) {
        startTokenIndex -= 1
      } else if (previous?.text === ']' && textAt(matchingBracketIndexes[startTokenIndex - 1] ?? -1) === '#[') {
        startTokenIndex = matchingBracketIndexes[startTokenIndex - 1] ?? startTokenIndex - 1
      } else {
        break
      }
    }

    return startTokenIndex
  }
  const docblockBetween = (startTokenIndex: number, endTokenIndex: number): PhpComment | null => {
    for (let tokenIndex = startTokenIndex; tokenIndex <= endTokenIndex; tokenIndex += 1) {
      const docblock = tokens[tokenIndex]?.leadingDocblock
      if (docblock) {
        return docblock
      }
    }

    return null
  }
  const hasModifierBetween = (startTokenIndex: number, endTokenIndex: number, modifier: string): boolean => {
    for (let tokenIndex = startTokenIndex; tokenIndex < endTokenIndex; tokenIndex += 1) {
      if (textAt(tokenIndex) === modifier && isNameAt(tokenIndex)) {
        return true
      }
    }

    return false
  }
  const markTypeNames = (firstTokenIndex: number, lastTokenIndex: number) => {
    for (let tokenIndex = firstTokenIndex; tokenIndex <= lastTokenIndex; tokenIndex += 1) {
      if (isNameAt(tokenIndex)) {
        outline.classReferenceTokenIndexes.add(tokenIndex)
      }
    }
  }

  const readImports = (useTokenIndex: number): number => {
    let tokenIndex = useTokenIndex + 1
    let statementKind: PhpImportKind = 'class'
    if (textAt(tokenIndex) === 'function' && isNameAt(tokenIndex + 1)) {
      statementKind = 'function'
      tokenIndex += 1
    } else if (textAt(tokenIndex) === 'const' && isNameAt(tokenIndex + 1)) {
      statementKind = 'constant'
      tokenIndex += 1
    }
    const importTables: Record<PhpImportKind, Map<string, string>> = {
      class: outline.classImports,
      function: outline.functionImports,
      constant: outline.constantImports,
    }
    const registerImport = (kind: PhpImportKind, fullyQualifiedName: string, nameTokenIndex: number): number => {
      const normalizedName = fullyQualifiedName.replace(/^\\/, '')
      const hasAlias = textAt(nameTokenIndex + 1) === 'as' && isNameAt(nameTokenIndex + 2)
      const alias = hasAlias ? textAt(nameTokenIndex + 2) : shortNameOf(normalizedName)
      importTables[kind].set(alias, normalizedName)
      outline.importsByTokenIndex.set(nameTokenIndex, { kind, fullyQualifiedName: normalizedName })
      if (hasAlias) {
        outline.importsByTokenIndex.set(nameTokenIndex + 2, { kind, fullyQualifiedName: normalizedName })
      }

      return hasAlias ? nameTokenIndex + 3 : nameTokenIndex + 1
    }
    let groupPrefix = ''
    while (tokenIndex < tokens.length) {
      const token = tokens[tokenIndex]
      if (token === undefined || token.text === ';') {
        break
      }
      if (token.kind === 'name' && token.text.endsWith('\\') && textAt(tokenIndex + 1) === '{') {
        groupPrefix = token.text
        tokenIndex += 2
      } else if (token.kind === 'name') {
        let entryKind = statementKind
        let nameTokenIndex = tokenIndex
        if (groupPrefix !== '' && (token.text === 'function' || token.text === 'const') && isNameAt(tokenIndex + 1)) {
          entryKind = token.text === 'function' ? 'function' : 'constant'
          nameTokenIndex += 1
        }
        tokenIndex = registerImport(entryKind, groupPrefix + textAt(nameTokenIndex), nameTokenIndex)
      } else if (token.text === '}') {
        groupPrefix = ''
        tokenIndex += 1
      } else if (token.text === ',') {
        tokenIndex += 1
      } else {
        break
      }
    }

    return tokenIndex
  }

  const readTraitUse = (useTokenIndex: number, classDeclaration: PhpClassDeclaration): number => {
    let tokenIndex = useTokenIndex + 1
    while (tokenIndex < tokens.length) {
      const token = tokens[tokenIndex]
      if (token === undefined || token.text === ';') {
        break
      }
      if (token.text === '{') {
        return closingIndexOf(tokenIndex)
      }
      if (token.kind === 'name') {
        classDeclaration.traitNames.push(resolveClassName(outline, namespaceName, token.text))
        outline.classReferenceTokenIndexes.add(tokenIndex)
      }
      tokenIndex += 1
    }

    return tokenIndex
  }

  const readParameters = (openingIndex: number, closingIndex: number): PhpParameter[] => {
    const parameters: PhpParameter[] = []
    let chunkStartTokenIndex = openingIndex + 1
    let tokenIndex = openingIndex + 1
    let variableTokenIndex = -1
    const closeChunk = (chunkEndTokenIndex: number) => {
      if (variableTokenIndex !== -1) {
        let typeStartTokenIndex = chunkStartTokenIndex
        let isPromoted = false
        while (typeStartTokenIndex < variableTokenIndex) {
          const token = tokens[typeStartTokenIndex]
          if (token?.text === '#[') {
            typeStartTokenIndex = closingIndexOf(typeStartTokenIndex) + 1
          } else if (token?.kind === 'name' && PROMOTION_MODIFIERS.has(token.text)) {
            isPromoted = true
            typeStartTokenIndex += tokenCountOfModifierAt(typeStartTokenIndex)
          } else {
            break
          }
        }
        let typeEndTokenIndex = variableTokenIndex - 1
        const isVariadic = textAt(typeEndTokenIndex) === '...'
        if (isVariadic) {
          typeEndTokenIndex -= 1
        }
        if (textAt(typeEndTokenIndex) === '&') {
          typeEndTokenIndex -= 1
        }
        const hasType = typeEndTokenIndex >= typeStartTokenIndex
        if (hasType) {
          markTypeNames(typeStartTokenIndex, typeEndTokenIndex)
        }
        parameters.push({
          name: textAt(variableTokenIndex),
          tokenIndex: variableTokenIndex,
          typeText: hasType ? sourceBetween(typeStartTokenIndex, typeEndTokenIndex) : null,
          isVariadic,
          isPromoted,
          leadingDocblock: docblockBetween(chunkStartTokenIndex, variableTokenIndex),
        })
      }
      chunkStartTokenIndex = chunkEndTokenIndex + 1
      variableTokenIndex = -1
    }
    while (tokenIndex < closingIndex) {
      const token = tokens[tokenIndex]
      if (token === undefined) {
        break
      }
      if (token.text === '(' || token.text === '[' || token.text === '{' || token.text === '#[') {
        tokenIndex = closingIndexOf(tokenIndex) + 1
        continue
      }
      if (token.text === ',') {
        closeChunk(tokenIndex)
      } else if (token.kind === 'variable' && variableTokenIndex === -1) {
        variableTokenIndex = tokenIndex
      }
      tokenIndex += 1
    }
    closeChunk(closingIndex)

    return parameters
  }

  const openFunction = (keywordTokenIndex: number, enclosing: OpenScope | undefined, isClassBodyLevel: boolean): void => {
    const isArrowFunction = textAt(keywordTokenIndex) === 'fn'
    let tokenIndex = keywordTokenIndex + 1
    if (textAt(tokenIndex) === '&') {
      tokenIndex += 1
    }
    let nameTokenIndex: number | null = null
    if (!isArrowFunction && isNameAt(tokenIndex)) {
      nameTokenIndex = tokenIndex
      tokenIndex += 1
    }
    if (textAt(tokenIndex) !== '(') {
      return
    }
    const parametersClosingIndex = closingIndexOf(tokenIndex)
    const parameters = readParameters(tokenIndex, parametersClosingIndex)
    tokenIndex = parametersClosingIndex + 1
    const capturedVariableNames: string[] = []
    if (!isArrowFunction && textAt(tokenIndex) === 'use' && textAt(tokenIndex + 1) === '(') {
      const captureClosingIndex = closingIndexOf(tokenIndex + 1)
      for (let captureIndex = tokenIndex + 2; captureIndex < captureClosingIndex; captureIndex += 1) {
        if (tokens[captureIndex]?.kind === 'variable') {
          capturedVariableNames.push(textAt(captureIndex))
        }
      }
      tokenIndex = captureClosingIndex + 1
    }
    let returnTypeText: string | null = null
    if (textAt(tokenIndex) === ':') {
      const returnTypeStartTokenIndex = tokenIndex + 1
      tokenIndex = returnTypeStartTokenIndex
      while (tokenIndex < tokens.length && (isNameAt(tokenIndex) || TYPE_PUNCTUATION.has(textAt(tokenIndex)))) {
        tokenIndex += 1
      }
      if (tokenIndex > returnTypeStartTokenIndex) {
        returnTypeText = sourceBetween(returnTypeStartTokenIndex, tokenIndex - 1)
        markTypeNames(returnTypeStartTokenIndex, tokenIndex - 1)
      }
    }
    let hasBody = false
    let bodyStartTokenIndex = tokenIndex
    let endTokenIndex = tokenIndex
    if (isArrowFunction) {
      if (textAt(tokenIndex) !== '=>') {
        return
      }
      hasBody = true
      bodyStartTokenIndex = tokenIndex + 1
      endTokenIndex = bodyStartTokenIndex
      while (endTokenIndex < tokens.length) {
        const token = tokens[endTokenIndex]
        if (token === undefined) {
          break
        }
        if (token.text === '(' || token.text === '[' || token.text === '{' || token.text === '#[') {
          endTokenIndex = closingIndexOf(endTokenIndex) + 1
          continue
        }
        if (token.text === ',' || token.text === ';' || token.text === ')' || token.text === ']' || token.text === '}') {
          break
        }
        endTokenIndex += 1
      }
      endTokenIndex -= 1
    } else if (textAt(tokenIndex) === '{') {
      hasBody = true
      endTokenIndex = closingIndexOf(tokenIndex)
    }
    const lowestTokenIndex = enclosing ? enclosing.bodyStartTokenIndex : -1
    const startTokenIndex = declarationStartBefore(keywordTokenIndex, lowestTokenIndex)
    const kind: PhpFunctionKind = isArrowFunction
      ? 'arrowFunction'
      : nameTokenIndex === null
        ? 'closure'
        : isClassBodyLevel
          ? 'method'
          : 'function'
    const classDeclaration = enclosing?.classDeclaration ?? null
    const functionScope: PhpFunctionScope = {
      kind,
      name: nameTokenIndex === null ? null : textAt(nameTokenIndex),
      nameTokenIndex,
      keywordTokenIndex,
      parameters,
      capturedVariableNames,
      returnTypeText,
      docblock: docblockBetween(startTokenIndex, keywordTokenIndex),
      isStatic: hasModifierBetween(startTokenIndex, keywordTokenIndex, 'static'),
      hasBody,
      bodyStartTokenIndex,
      endTokenIndex,
      parentScope: enclosing?.functionScope ?? null,
      classDeclaration,
      namespaceName,
    }
    outline.functionScopes.push(functionScope)
    if (kind === 'method' && classDeclaration !== null && nameTokenIndex !== null) {
      classDeclaration.methods.push(functionScope)
      outline.declarationsByTokenIndex.set(nameTokenIndex, { kind: 'method', classDeclaration, method: functionScope })
    } else if (kind === 'function' && nameTokenIndex !== null) {
      outline.functions.push(functionScope)
      outline.declarationsByTokenIndex.set(nameTokenIndex, { kind: 'function', functionScope })
    }
    for (const parameter of parameters) {
      if (parameter.isPromoted && classDeclaration !== null && kind === 'method') {
        const property: PhpPropertyDeclaration = {
          name: parameter.name.slice(1),
          tokenIndex: parameter.tokenIndex,
          typeText: parameter.typeText,
          docblock: parameter.leadingDocblock,
          isStatic: false,
          promotedBy: functionScope,
        }
        classDeclaration.properties.push(property)
        outline.declarationsByTokenIndex.set(parameter.tokenIndex, { kind: 'property', classDeclaration, property })
      } else {
        outline.declarationsByTokenIndex.set(parameter.tokenIndex, { kind: 'parameter', functionScope, parameter })
      }
    }
    openScopes.push({ endTokenIndex, bodyStartTokenIndex, classDeclaration, functionScope })
  }

  const openClass = (keywordTokenIndex: number, enclosing: OpenScope | undefined): void => {
    const keyword = textAt(keywordTokenIndex)
    const previousText = textAt(keywordTokenIndex - 1)
    if (previousText === '::' || previousText === '->' || previousText === '?->') {
      return
    }
    let tokenIndex = keywordTokenIndex + 1
    const isAnonymous = keyword === 'class' && (!isNameAt(tokenIndex) || textAt(tokenIndex) === 'extends' || textAt(tokenIndex) === 'implements')
    if (isAnonymous && previousText !== 'new' && previousText !== 'readonly') {
      return
    }
    if (!isAnonymous && !isNameAt(tokenIndex)) {
      return
    }
    const nameTokenIndex = isAnonymous ? keywordTokenIndex : tokenIndex
    if (isAnonymous && textAt(tokenIndex) === '(') {
      tokenIndex = closingIndexOf(tokenIndex) + 1
    } else if (!isAnonymous) {
      tokenIndex += 1
    }
    const extendsNames: string[] = []
    const implementsNames: string[] = []
    let currentList: string[] | null = null
    while (tokenIndex < tokens.length && textAt(tokenIndex) !== '{') {
      const token = tokens[tokenIndex]
      if (token === undefined || token.text === ';' || token.text === '(' || token.text === '=') {
        return
      }
      if (token.text === 'extends') {
        currentList = extendsNames
      } else if (token.text === 'implements') {
        currentList = implementsNames
      } else if (token.kind === 'name' && currentList !== null) {
        currentList.push(resolveClassName(outline, namespaceName, token.text))
        outline.classReferenceTokenIndexes.add(tokenIndex)
      }
      tokenIndex += 1
    }
    if (tokenIndex >= tokens.length) {
      return
    }
    const startTokenIndex = declarationStartBefore(keywordTokenIndex, enclosing ? enclosing.bodyStartTokenIndex : -1)
    const name = isAnonymous ? '' : textAt(nameTokenIndex)
    const classDeclaration: PhpClassDeclaration = {
      kind: keyword === 'interface' ? 'interface' : keyword === 'trait' ? 'trait' : keyword === 'enum' ? 'enum' : 'class',
      name,
      namespaceName,
      fullyQualifiedName: isAnonymous ? `class@anonymous:${keywordTokenIndex}` : qualifiedIn(namespaceName, name),
      nameTokenIndex,
      isAbstract: hasModifierBetween(startTokenIndex, keywordTokenIndex, 'abstract'),
      extendsNames,
      implementsNames,
      traitNames: [],
      docblock: docblockBetween(startTokenIndex, keywordTokenIndex),
      bodyStartTokenIndex: tokenIndex,
      bodyEndTokenIndex: closingIndexOf(tokenIndex),
      methods: [],
      properties: [],
      constants: [],
    }
    if (isAnonymous) {
      outline.anonymousClasses.push(classDeclaration)
    } else {
      outline.classes.push(classDeclaration)
      outline.declarationsByTokenIndex.set(nameTokenIndex, { kind: 'class', classDeclaration })
    }
    openScopes.push({
      endTokenIndex: classDeclaration.bodyEndTokenIndex,
      bodyStartTokenIndex: classDeclaration.bodyStartTokenIndex,
      classDeclaration,
      functionScope: null,
    })
  }

  const readProperty = (variableTokenIndex: number, classDeclaration: PhpClassDeclaration): void => {
    let statementStartTokenIndex = variableTokenIndex
    while (statementStartTokenIndex - 1 > classDeclaration.bodyStartTokenIndex) {
      const previous = tokens[statementStartTokenIndex - 1]
      if (previous === undefined || previous.text === ';' || previous.text === '{' || previous.text === '}') {
        break
      }
      if (previous.kind === 'variable') {
        const firstDeclarator = classDeclaration.properties.at(-1)
        if (firstDeclarator !== undefined) {
          const property = { ...firstDeclarator, name: textAt(variableTokenIndex).slice(1), tokenIndex: variableTokenIndex }
          classDeclaration.properties.push(property)
          outline.declarationsByTokenIndex.set(variableTokenIndex, { kind: 'property', classDeclaration, property })
        }

        return
      }
      const openingIndex = matchingBracketIndexes[statementStartTokenIndex - 1] ?? -1
      statementStartTokenIndex = previous.text === ']' && openingIndex !== -1 ? openingIndex : statementStartTokenIndex - 1
    }
    let typeStartTokenIndex = statementStartTokenIndex
    let isStatic = false
    while (typeStartTokenIndex < variableTokenIndex) {
      const token = tokens[typeStartTokenIndex]
      if (token?.text === '#[') {
        typeStartTokenIndex = closingIndexOf(typeStartTokenIndex) + 1
      } else if (token?.kind === 'name' && DECLARATION_MODIFIERS.has(token.text)) {
        isStatic = isStatic || token.text === 'static'
        typeStartTokenIndex += tokenCountOfModifierAt(typeStartTokenIndex)
      } else {
        break
      }
    }
    const hasType = typeStartTokenIndex < variableTokenIndex
    if (hasType) {
      markTypeNames(typeStartTokenIndex, variableTokenIndex - 1)
    }
    const property: PhpPropertyDeclaration = {
      name: textAt(variableTokenIndex).slice(1),
      tokenIndex: variableTokenIndex,
      typeText: hasType ? sourceBetween(typeStartTokenIndex, variableTokenIndex - 1) : null,
      docblock: docblockBetween(statementStartTokenIndex, variableTokenIndex),
      isStatic,
      promotedBy: null,
    }
    classDeclaration.properties.push(property)
    outline.declarationsByTokenIndex.set(variableTokenIndex, { kind: 'property', classDeclaration, property })
  }

  // const A = 1, B = 2; and the typed form const string A = 'a': each name stands right before its equal sign.
  const readConstants = (constTokenIndex: number, classDeclaration: PhpClassDeclaration | null): void => {
    let tokenIndex = constTokenIndex + 1
    let isExpectingName = true
    while (tokenIndex < tokens.length) {
      const token = tokens[tokenIndex]
      if (token === undefined || token.text === ';') {
        break
      }
      if (token.text === '(' || token.text === '[' || token.text === '{') {
        tokenIndex = closingIndexOf(tokenIndex) + 1
        continue
      }
      if (token.text === '=' && isExpectingName && isNameAt(tokenIndex - 1)) {
        const constant = { name: textAt(tokenIndex - 1), tokenIndex: tokenIndex - 1, isEnumCase: false }
        if (classDeclaration === null) {
          outline.constants.push(constant)
        } else {
          classDeclaration.constants.push(constant)
        }
        outline.declarationsByTokenIndex.set(tokenIndex - 1, { kind: 'constant', classDeclaration, constant })
        if (tokenIndex - 2 > constTokenIndex) {
          markTypeNames(constTokenIndex + 1, tokenIndex - 2)
        }
        isExpectingName = false
      } else if (token.text === ',') {
        isExpectingName = true
      }
      tokenIndex += 1
    }
  }

  for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
    while (openScopes.length > 0 && (openScopes.at(-1)?.endTokenIndex ?? 0) < tokenIndex) {
      openScopes.pop()
    }
    const token = tokens[tokenIndex]
    if (token === undefined) {
      break
    }
    const enclosing = openScopes.at(-1)
    const classAtBodyLevel =
      enclosing && enclosing.functionScope === null && tokenIndex > enclosing.bodyStartTokenIndex ? enclosing.classDeclaration : null
    if (token.kind === 'variable') {
      if (classAtBodyLevel !== null && textAt(tokenIndex - 1) !== '::') {
        readProperty(tokenIndex, classAtBodyLevel)
      }
      continue
    }
    if (token.kind === 'punctuation') {
      if (token.text === '#[') {
        let attributeTokenIndex = tokenIndex + 1
        const attributeClosingIndex = closingIndexOf(tokenIndex)
        while (attributeTokenIndex < attributeClosingIndex) {
          if (isNameAt(attributeTokenIndex)) {
            outline.classReferenceTokenIndexes.add(attributeTokenIndex)
          }
          attributeTokenIndex += 1
          while (attributeTokenIndex < attributeClosingIndex && textAt(attributeTokenIndex) !== ',') {
            attributeTokenIndex = textAt(attributeTokenIndex) === '(' ? closingIndexOf(attributeTokenIndex) + 1 : attributeTokenIndex + 1
          }
          attributeTokenIndex += 1
        }
      } else if (token.text === '{' && classAtBodyLevel !== null) {
        tokenIndex = closingIndexOf(tokenIndex)
      }
      continue
    }
    if (token.kind !== 'name') {
      continue
    }
    const previousText = textAt(tokenIndex - 1)
    if (previousText === '->' || previousText === '?->' || previousText === '::') {
      continue
    }
    switch (token.text) {
      case 'namespace':
        if (isNameAt(tokenIndex + 1) && (textAt(tokenIndex + 2) === ';' || textAt(tokenIndex + 2) === '{')) {
          namespaceName = textAt(tokenIndex + 1)
          outline.namespaceDeclarations.push({ tokenIndex, name: namespaceName })
          tokenIndex += 1
        } else if (textAt(tokenIndex + 1) === '{') {
          namespaceName = ''
          outline.namespaceDeclarations.push({ tokenIndex, name: '' })
        }
        break
      case 'use':
        if (classAtBodyLevel !== null) {
          tokenIndex = readTraitUse(tokenIndex, classAtBodyLevel)
        } else if (enclosing === undefined) {
          tokenIndex = readImports(tokenIndex)
        }
        break
      case 'class':
      case 'interface':
      case 'trait':
      case 'enum':
        openClass(tokenIndex, enclosing)
        break
      case 'function':
      case 'fn':
        openFunction(tokenIndex, enclosing, classAtBodyLevel !== null)
        if (token.text === 'function' && isNameAt(tokenIndex + 1)) {
          tokenIndex += 1
        }
        break
      case 'const':
        if (classAtBodyLevel !== null) {
          readConstants(tokenIndex, classAtBodyLevel)
        } else if (enclosing === undefined) {
          readConstants(tokenIndex, null)
        }
        break
      case 'case':
        if (classAtBodyLevel !== null && classAtBodyLevel.kind === 'enum' && isNameAt(tokenIndex + 1)) {
          const constant = { name: textAt(tokenIndex + 1), tokenIndex: tokenIndex + 1, isEnumCase: true }
          classAtBodyLevel.constants.push(constant)
          outline.declarationsByTokenIndex.set(tokenIndex + 1, { kind: 'constant', classDeclaration: classAtBodyLevel, constant })
          tokenIndex += 1
        }
        break
      case 'define':
        if (enclosing === undefined && textAt(tokenIndex + 1) === '(' && tokens[tokenIndex + 2]?.kind === 'string') {
          const constant = { name: textAt(tokenIndex + 2).slice(1, -1), tokenIndex: tokenIndex + 2, isEnumCase: false }
          outline.constants.push(constant)
          outline.declarationsByTokenIndex.set(tokenIndex + 2, { kind: 'constant', classDeclaration: null, constant })
        }
        break
      case 'new':
      case 'instanceof':
        if (isNameAt(tokenIndex + 1) && textAt(tokenIndex + 1) !== 'class') {
          outline.classReferenceTokenIndexes.add(tokenIndex + 1)
        }
        break
      case 'catch':
        if (textAt(tokenIndex + 1) === '(') {
          const catchClosingIndex = closingIndexOf(tokenIndex + 1)
          markTypeNames(tokenIndex + 2, catchClosingIndex - 1)
        }
        break
      default:
        if (textAt(tokenIndex + 1) === '::') {
          outline.classReferenceTokenIndexes.add(tokenIndex)
        }
    }
  }

  return outline
}
