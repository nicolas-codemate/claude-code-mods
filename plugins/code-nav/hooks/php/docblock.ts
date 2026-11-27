import type { PhpComment } from './tokens'
import { isBuiltinTypeName, isReceiverTypeName } from './type-expression'

export type PhpDocblockTemplate = { name: string; boundTypeText: string | null }

// A member a class docblock declares without code: @method Order|null find($id), @property Money $total.
export type PhpDocblockMember = { name: string; typeText: string | null; isStatic: boolean; offsetInDocblock: number }

export type PhpDocblockTags = {
  parameterTypeTexts: Map<string, string>
  returnTypeText: string | null
  variableTypes: Array<{ typeText: string; variableName: string | null }>
  templates: PhpDocblockTemplate[]
  // "ServiceEntityRepository<Order>": what @extends, @implements and @use say of the parents.
  inheritedTypeTexts: string[]
  mixinTypeTexts: string[]
  methods: PhpDocblockMember[]
  properties: PhpDocblockMember[]
}

// A class name, or a member of a class, written in a docblock tag, with its place in the file.
export type PhpDocblockReference = { className: string; memberName: string | null; isOnMember: boolean; start: number; end: number }

const TYPE_FIRST_TAGS = new Set([
  'param', 'return', 'var', 'throws', 'extends', 'implements', 'use', 'mixin', 'property', 'property-read', 'property-write',
  'template-extends', 'template-implements', 'template-use', 'inherits',
])
const TEMPLATE_TAGS = new Set(['template', 'template-covariant', 'template-contravariant'])
const SYMBOL_REFERENCE_TAGS = new Set(['see', 'uses', 'covers', 'coversDefaultClass', 'usesClass', 'expectedException', 'link'])
const TOOL_PREFIX_PATTERN = /^(?:psalm|phpstan|phan)-/

const tagsByDocblock = new WeakMap<PhpComment, PhpDocblockTags>()

// The type written at an offset of a tag's text: it runs to the first space outside brackets, a union may be spaced.
export function readTypeExpressionPrefix(text: string, start: number): { typeText: string; end: number } {
  let offset = start
  let depth = 0
  while (offset < text.length) {
    const character = text[offset] ?? ''
    if (character === '<' || character === '(' || character === '{' || character === '[') {
      depth += 1
    } else if (character === '>' || character === ')' || character === '}' || character === ']') {
      depth -= 1
    } else if (/\s/.test(character) && depth <= 0) {
      const spacedUnionMatch = text.slice(offset).match(/^[ \t]*\|[ \t]*/)
      if (spacedUnionMatch === null) {
        break
      }
      offset += spacedUnionMatch[0].length
      continue
    }
    offset += 1
  }

  return { typeText: text.slice(start, offset), end: offset }
}

function emptyTags(): PhpDocblockTags {
  return {
    parameterTypeTexts: new Map(),
    returnTypeText: null,
    variableTypes: [],
    templates: [],
    inheritedTypeTexts: [],
    mixinTypeTexts: [],
    methods: [],
    properties: [],
  }
}

function parseDocblock(docblockText: string): PhpDocblockTags {
  const tags = emptyTags()
  const toolParameterNames = new Set<string>()
  let hasToolReturn = false
  const tagPattern = /^[ \t]*(?:\/\*\*|\*)?[ \t]*@([A-Za-z-]+)[ \t]+([^\n]*)/gm
  for (const match of docblockText.matchAll(tagPattern)) {
    const writtenTag = match[1] ?? ''
    const isToolTag = TOOL_PREFIX_PATTERN.test(writtenTag)
    const tag = writtenTag.replace(TOOL_PREFIX_PATTERN, '')
    const content = (match[2] ?? '').replace(/\*\/\s*$/, '').trimEnd()
    if (tag === 'param') {
      const { typeText, end } = readTypeExpressionPrefix(content, 0)
      const variableName = content.slice(end).match(/^\s*(?:&|\.\.\.)*(\$[A-Za-z_0-9]+)/)?.[1]
      if (variableName !== undefined && typeText !== '' && (isToolTag || !toolParameterNames.has(variableName))) {
        tags.parameterTypeTexts.set(variableName, typeText)
        if (isToolTag) {
          toolParameterNames.add(variableName)
        }
      }
    } else if (tag === 'return') {
      const { typeText } = readTypeExpressionPrefix(content, 0)
      if (typeText !== '' && (isToolTag || !hasToolReturn)) {
        tags.returnTypeText = typeText
        hasToolReturn = hasToolReturn || isToolTag
      }
    } else if (tag === 'var') {
      const { typeText, end } = readTypeExpressionPrefix(content, 0)
      const variableName = content.slice(end).match(/^\s*(\$[A-Za-z_0-9]+)/)?.[1] ?? null
      if (typeText !== '' && !typeText.startsWith('$')) {
        tags.variableTypes[isToolTag ? 'unshift' : 'push']({ typeText, variableName })
      }
    } else if (TEMPLATE_TAGS.has(tag)) {
      const templateMatch = content.match(/^([A-Za-z_0-9]+)(?:\s+(?:of|as)\s+(.+))?/)
      if (templateMatch?.[1] !== undefined) {
        const boundTypeText = templateMatch[2] === undefined ? null : readTypeExpressionPrefix(templateMatch[2], 0).typeText
        tags.templates.push({ name: templateMatch[1], boundTypeText })
      }
    } else if (tag === 'extends' || tag === 'implements' || tag === 'use' || tag.startsWith('template-') || tag === 'inherits') {
      const { typeText } = readTypeExpressionPrefix(content, 0)
      if (typeText !== '') {
        tags.inheritedTypeTexts.push(typeText)
      }
    } else if (tag === 'mixin') {
      const { typeText } = readTypeExpressionPrefix(content, 0)
      if (typeText !== '') {
        tags.mixinTypeTexts.push(typeText)
      }
    } else if (tag === 'method') {
      const methodMatch = content.match(/^(static\s+)?(?:(.+?)\s+)?([A-Za-z_0-9]+)\s*\(/)
      if (methodMatch?.[3] !== undefined) {
        tags.methods.push({
          name: methodMatch[3],
          typeText: methodMatch[2] ?? (methodMatch[1] === undefined ? null : 'static'),
          isStatic: methodMatch[1] !== undefined && methodMatch[2] !== undefined,
          offsetInDocblock: match.index,
        })
      }
    } else if (tag === 'property' || tag === 'property-read' || tag === 'property-write') {
      const { typeText, end } = readTypeExpressionPrefix(content, 0)
      const propertyName = content.slice(end).match(/^\s*\$([A-Za-z_0-9]+)/)?.[1]
      if (propertyName !== undefined) {
        tags.properties.push({ name: propertyName, typeText: typeText === '' ? null : typeText, isStatic: false, offsetInDocblock: match.index })
      }
    }
  }

  return tags
}

export function docblockTagsOf(docblock: PhpComment | null): PhpDocblockTags {
  if (docblock === null) {
    return emptyTags()
  }
  const knownTags = tagsByDocblock.get(docblock)
  if (knownTags !== undefined) {
    return knownTags
  }
  const tags = parseDocblock(docblock.text)
  tagsByDocblock.set(docblock, tags)

  return tags
}

// The type a docblock gives a variable: "@var Order $order", or a bare "@var Order" standing right before it.
export function variableTypeTextIn(docblock: PhpComment | null, variableName: string, acceptsUnnamed: boolean): string | null {
  for (const variableType of docblockTagsOf(docblock).variableTypes) {
    if (variableType.variableName === variableName || (variableType.variableName === null && acceptsUnnamed)) {
      return variableType.typeText
    }
  }

  return null
}

function identifierAround(text: string, offset: number): { name: string; start: number; end: number } | null {
  const isIdentifierCharacter = (character: string | undefined) => character !== undefined && /[A-Za-z0-9_\\]/.test(character)
  if (!isIdentifierCharacter(text[offset])) {
    return null
  }
  let start = offset
  while (isIdentifierCharacter(text[start - 1])) {
    start -= 1
  }
  let end = offset
  while (isIdentifierCharacter(text[end])) {
    end += 1
  }
  if (text[start - 1] === '$' || text[start - 1] === '-' || text[end] === '-') {
    return null
  }

  return { name: text.slice(start, end), start, end }
}

// The class name under an offset of a docblock, when it stands in the type of a tag (@param, @return, @var, @throws,
// @extends...) or in a @see reference. A word of the description is not a reference.
export function docblockReferenceAt(docblock: PhpComment, offsetInFile: number): PhpDocblockReference | null {
  const text = docblock.text
  const offset = offsetInFile - docblock.start
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1
  const nextLineBreak = text.indexOf('\n', offset)
  const lineEnd = nextLineBreak === -1 ? text.length : nextLineBreak
  const line = text.slice(lineStart, lineEnd)
  const offsetInLine = offset - lineStart
  let tagMatch: RegExpMatchArray | null = null
  for (const match of line.matchAll(/@([A-Za-z-]+)/g)) {
    if (match.index + match[0].length <= offsetInLine) {
      tagMatch = match
    }
  }
  if (tagMatch === null || tagMatch.index === undefined) {
    return null
  }
  const tag = (tagMatch[1] ?? '').replace(TOOL_PREFIX_PATTERN, '')
  let typeStart = tagMatch.index + tagMatch[0].length
  typeStart += line.slice(typeStart).match(/^\s*/)?.[0].length ?? 0
  const toReference = (identifier: { name: string; start: number; end: number }, memberName: string | null, isOnMember: boolean) => ({
    className: identifier.name,
    memberName,
    isOnMember,
    start: docblock.start + lineStart + identifier.start,
    end: docblock.start + lineStart + identifier.end,
  })

  if (SYMBOL_REFERENCE_TAGS.has(tag)) {
    const referenceMatch = line.slice(typeStart).match(/^([A-Za-z0-9_\\]+)(?:::(\$?[A-Za-z0-9_]+))?/)
    if (referenceMatch?.[1] === undefined) {
      return null
    }
    const classEnd = typeStart + referenceMatch[1].length
    const memberName = referenceMatch[2] ?? null
    if (offsetInLine >= typeStart && offsetInLine < classEnd) {
      return toReference({ name: referenceMatch[1], start: typeStart, end: classEnd }, null, false)
    }
    if (memberName !== null && offsetInLine >= classEnd + 2 && offsetInLine < classEnd + 2 + memberName.length) {
      const memberRange = { name: referenceMatch[1], start: classEnd + 2, end: classEnd + 2 + memberName.length }

      return toReference(memberRange, memberName.replace(/^\$/, ''), true)
    }

    return null
  }
  if (TEMPLATE_TAGS.has(tag)) {
    typeStart += line.slice(typeStart).match(/^[A-Za-z_0-9]+\s+(?:of|as)\s+/)?.[0].length ?? line.length
  } else if (tag === 'method') {
    typeStart += line.slice(typeStart).match(/^static\s+/)?.[0].length ?? 0
  } else if (!TYPE_FIRST_TAGS.has(tag)) {
    return null
  }
  const { end: typeEnd } = readTypeExpressionPrefix(line, typeStart)
  if (offsetInLine < typeStart || offsetInLine >= typeEnd) {
    return null
  }
  const identifier = identifierAround(line, offsetInLine)
  if (identifier === null || identifier.end > typeEnd || isBuiltinTypeName(identifier.name) || isReceiverTypeName(identifier.name)) {
    return null
  }
  if (tag === 'method' && /^\s*\(/.test(line.slice(identifier.end))) {
    return null
  }

  return toReference(identifier, null, false)
}
