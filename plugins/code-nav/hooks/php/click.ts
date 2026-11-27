import { docblockReferenceAt, docblockTagsOf } from './docblock'
import { isCallableName } from './expression'
import { classAround, enclosingClassAt, enclosingFunctionScopeAt, namespaceAt, resolveClassName } from './outline'
import type { PhpDeclarationReference, PhpFileOutline } from './outline'
import { templateNamesOf } from './project'
import type { PhpMemberKind } from './project'
import { commentAtOffset, tokenIndexAtOffset } from './tokens'
import { isBuiltinTypeName } from './type-expression'

// Offsets in the file of the name the click is on.
export type PhpNameRange = { start: number; end: number }

// What the name under a click is, read from what surrounds it. tokenIndex is absent for a name inside a comment.
export type PhpClick =
  | { kind: 'none' }
  | { kind: 'declaration'; declaration: PhpDeclarationReference; range: PhpNameRange; tokenIndex: number }
  | { kind: 'classReference'; fullyQualifiedName: string; range: PhpNameRange }
  | { kind: 'memberAccess'; memberKind: PhpMemberKind; name: string; range: PhpNameRange; tokenIndex: number }
  | { kind: 'memberOfNamedClass'; fullyQualifiedName: string; name: string; range: PhpNameRange }
  | { kind: 'functionCall'; writtenName: string; range: PhpNameRange; tokenIndex: number }
  | { kind: 'variable'; name: string; range: PhpNameRange; tokenIndex: number }
  | { kind: 'constantReference'; name: string; range: PhpNameRange; tokenIndex: number }

const NO_CLICK: PhpClick = { kind: 'none' }
const MAGIC_CONSTANT_PATTERN = /^__[A-Z]+__$/

// The fully qualified class a name token refers to, when it stands where a class does: a type, after new, before ::,
// in extends, implements, catch, instanceof, an attribute or a use statement. Null for any other name.
export function classReferenceAt(outline: PhpFileOutline, tokenIndex: number): string | null {
  const token = outline.source.tokens[tokenIndex]
  if (token === undefined || token.kind !== 'name') {
    return null
  }
  const importReference = outline.importsByTokenIndex.get(tokenIndex)
  if (importReference !== undefined) {
    return importReference.kind === 'class' ? importReference.fullyQualifiedName : null
  }
  if (!outline.classReferenceTokenIndexes.has(tokenIndex) || isBuiltinTypeName(token.text)) {
    return null
  }
  if (token.text === 'self' || token.text === 'static') {
    return classAround(outline, tokenIndex)?.fullyQualifiedName ?? null
  }
  if (token.text === 'parent') {
    return classAround(outline, tokenIndex)?.extendsNames[0] ?? null
  }

  return resolveClassName(outline, namespaceAt(outline, tokenIndex), token.text)
}

function firstTokenIndexFrom(outline: PhpFileOutline, offset: number): number {
  const { tokens } = outline.source
  let low = 0
  let high = tokens.length
  while (low < high) {
    const middle = (low + high) >> 1
    if ((tokens[middle]?.start ?? 0) < offset) {
      low = middle + 1
    } else {
      high = middle
    }
  }

  return low
}

function readDocblockClick(outline: PhpFileOutline, offset: number): PhpClick {
  const comment = commentAtOffset(outline.source.comments, offset)
  if (comment === null || !comment.text.startsWith('/*')) {
    return NO_CLICK
  }
  const reference = docblockReferenceAt(comment, offset)
  if (reference === null) {
    return NO_CLICK
  }
  const followingTokenIndex = firstTokenIndexFrom(outline, comment.end)
  const classDeclaration = enclosingClassAt(outline, followingTokenIndex)
  const placeholderNames = [
    ...docblockTagsOf(comment).templates.map(template => template.name),
    ...(classDeclaration === null ? [] : templateNamesOf(classDeclaration)),
    ...docblockTagsOf(enclosingFunctionScopeAt(outline, followingTokenIndex)?.docblock ?? null).templates.map(template => template.name),
  ]
  if (placeholderNames.includes(reference.className)) {
    return NO_CLICK
  }
  const isOwnClass = reference.className === 'self' || reference.className === 'static'
  const fullyQualifiedName = isOwnClass
    ? (classDeclaration?.fullyQualifiedName ?? null)
    : resolveClassName(outline, namespaceAt(outline, followingTokenIndex), reference.className)
  if (fullyQualifiedName === null) {
    return NO_CLICK
  }
  const range = { start: reference.start, end: reference.end }

  return reference.isOnMember && reference.memberName !== null
    ? { kind: 'memberOfNamedClass', fullyQualifiedName, name: reference.memberName, range }
    : { kind: 'classReference', fullyQualifiedName, range }
}

export function readPhpClick(outline: PhpFileOutline, offset: number): PhpClick {
  const { tokens } = outline.source
  let tokenIndex = tokenIndexAtOffset(tokens, offset)
  if (tokenIndex === -1) {
    const docblockClick = readDocblockClick(outline, offset)
    if (docblockClick.kind !== 'none') {
      return docblockClick
    }
    const tokenIndexBefore = tokenIndexAtOffset(tokens, offset - 1)
    const tokenBefore = tokens[tokenIndexBefore]
    if (tokenBefore === undefined || tokenBefore.end !== offset || (tokenBefore.kind !== 'name' && tokenBefore.kind !== 'variable')) {
      return NO_CLICK
    }
    tokenIndex = tokenIndexBefore
  }
  const token = tokens[tokenIndex]
  if (token === undefined) {
    return NO_CLICK
  }
  const range = { start: token.start, end: token.end }
  const declaration = outline.declarationsByTokenIndex.get(tokenIndex)
  if (declaration !== undefined) {
    return { kind: 'declaration', declaration, range, tokenIndex }
  }
  if (token.kind !== 'name' && token.kind !== 'variable') {
    return NO_CLICK
  }
  const previousText = tokens[tokenIndex - 1]?.text ?? ''
  const followingText = tokens[tokenIndex + 1]?.text ?? ''

  if (token.kind === 'variable') {
    if (previousText === '::') {
      return { kind: 'memberAccess', memberKind: 'property', name: token.text.slice(1), range, tokenIndex }
    }
    if (token.text === '$this') {
      const classDeclaration = enclosingClassAt(outline, tokenIndex)

      return classDeclaration === null ? NO_CLICK : { kind: 'classReference', fullyQualifiedName: classDeclaration.fullyQualifiedName, range }
    }

    return { kind: 'variable', name: token.text, range, tokenIndex }
  }

  const importReference = outline.importsByTokenIndex.get(tokenIndex)
  if (importReference !== undefined && importReference.kind === 'function') {
    return { kind: 'functionCall', writtenName: `\\${importReference.fullyQualifiedName}`, range, tokenIndex }
  }
  if (importReference !== undefined && importReference.kind === 'constant') {
    return { kind: 'constantReference', name: importReference.fullyQualifiedName, range, tokenIndex }
  }
  if (previousText === '->' || previousText === '?->') {
    return { kind: 'memberAccess', memberKind: followingText === '(' ? 'method' : 'property', name: token.text, range, tokenIndex }
  }
  if (previousText === '::') {
    if (token.text === 'class') {
      return NO_CLICK
    }

    return { kind: 'memberAccess', memberKind: followingText === '(' ? 'method' : 'constant', name: token.text, range, tokenIndex }
  }
  const fullyQualifiedName = classReferenceAt(outline, tokenIndex)
  if (fullyQualifiedName !== null) {
    return { kind: 'classReference', fullyQualifiedName, range }
  }
  if (!isCallableName(token.text) || isBuiltinTypeName(token.text) || outline.classReferenceTokenIndexes.has(tokenIndex)) {
    return NO_CLICK
  }
  if (followingText === '(') {
    return previousText === 'function' || previousText === 'new' ? NO_CLICK : { kind: 'functionCall', writtenName: token.text, range, tokenIndex }
  }
  const isNamedArgument = followingText === ':' && (previousText === '(' || previousText === ',')
  const isNotAConstant = previousText === 'namespace' || previousText === 'goto' || previousText === 'as' || token.text.endsWith('\\')
  if (isNamedArgument || isNotAConstant || MAGIC_CONSTANT_PATTERN.test(token.text)) {
    return NO_CLICK
  }

  return { kind: 'constantReference', name: token.text, range, tokenIndex }
}
