// class: a fully qualified class name. builtin: a type PHP or the docblock conventions define (array, int, list).
// template: a placeholder a docblock declares (@template T). receiver: static, self or $this, the type the member
// was reached through.
export type PhpTypeMemberKind = 'class' | 'builtin' | 'template' | 'receiver'

export type PhpTypeMember = {
  kind: PhpTypeMemberKind
  name: string
  typeArguments: PhpType[]
  // The entries of an array shape, array{0: Order, total: Money}; an entry without a key is known by its position.
  shapeEntries?: PhpShapeEntry[]
}

export type PhpShapeEntry = { key: string; type: PhpType }

// A union: every type the value may have. Empty when nothing is known.
export type PhpType = PhpTypeMember[]

export type PhpTypeNameResolver = (writtenName: string) => { kind: PhpTypeMemberKind; name: string }

const BUILTIN_TYPE_NAMES = new Set([
  'int', 'integer', 'string', 'bool', 'boolean', 'float', 'double', 'array', 'callable', 'iterable', 'object', 'mixed', 'void',
  'null', 'never', 'false', 'true', 'list', 'scalar', 'resource', 'numeric', 'number', 'empty', 'max', 'min', 'key-of', 'value-of',
])
const ITERABLE_BUILTIN_NAMES = new Set(['array', 'list', 'iterable', 'non-empty-array', 'non-empty-list'])
// Generator<TKey, TValue, TSend, TReturn>: what iterating gives is the second argument, not the last.
const KEYED_BY_FIRST_ARGUMENT_CLASS_NAMES = new Set(['Generator'])

// The type of a value a class of PHP itself gives: no file declares what it holds.
export const PHP_OWN_VALUE_TYPE_NAME = 'php-own-value'

export function isPhpOwnValue(type: PhpType): boolean {
  return type.some(member => member.kind === 'builtin' && member.name === PHP_OWN_VALUE_TYPE_NAME)
}

export function isBuiltinTypeName(writtenName: string): boolean {
  return writtenName.includes('-') || BUILTIN_TYPE_NAMES.has(writtenName.toLowerCase())
}

export function isReceiverTypeName(writtenName: string): boolean {
  return writtenName === 'static' || writtenName === 'self' || writtenName === '$this'
}

export function classType(fullyQualifiedName: string, typeArguments: PhpType[] = []): PhpType {
  return [{ kind: 'class', name: fullyQualifiedName, typeArguments }]
}

export function builtinType(name: string, typeArguments: PhpType[] = []): PhpType {
  return [{ kind: 'builtin', name, typeArguments }]
}

function isTypeNameCharacter(character: string): boolean {
  return /[A-Za-z0-9_\\$-]/.test(character) || character.charCodeAt(0) >= 128
}

function endOfBalanced(text: string, openingOffset: number): number {
  let depth = 0
  for (let offset = openingOffset; offset < text.length; offset += 1) {
    const character = text[offset]
    if (character === '(' || character === '{' || character === '<' || character === '[') {
      depth += 1
    } else if (character === ')' || character === '}' || character === '>' || character === ']') {
      depth -= 1
      if (depth === 0) {
        return offset + 1
      }
    }
  }

  return text.length
}

// A native type or a docblock one: ?Order, Order|null, Order[], array<int, Order>, Collection<int, T>, (A&B)|null,
// array{0: Order, total: Money}. What the parser does not read (callable signatures, literals) is kept as a builtin
// without arguments.
export function parsePhpType(typeText: string, resolveName: PhpTypeNameResolver): PhpType {
  let offset = 0

  const skipSpaces = () => {
    while (offset < typeText.length && /\s/.test(typeText[offset] ?? '')) {
      offset += 1
    }
  }

  const parsePrimary = (): PhpType => {
    skipSpaces()
    const character = typeText[offset] ?? ''
    if (character === '(') {
      offset += 1
      const inner = parseUnion()
      skipSpaces()
      if (typeText[offset] === ')') {
        offset += 1
      }

      return inner
    }
    if (character === "'" || character === '"') {
      const closingOffset = typeText.indexOf(character, offset + 1)
      offset = closingOffset === -1 ? typeText.length : closingOffset + 1

      return builtinType('string')
    }
    if (!isTypeNameCharacter(character)) {
      return []
    }
    const nameStart = offset
    while (offset < typeText.length && isTypeNameCharacter(typeText[offset] ?? '')) {
      offset += 1
    }
    const writtenName = typeText.slice(nameStart, offset)
    if (/^-?[0-9]/.test(writtenName)) {
      return builtinType('int')
    }
    const typeArguments: PhpType[] = []
    let shapeEntries: PhpShapeEntry[] | undefined
    if (typeText[offset] === '<') {
      offset += 1
      while (offset < typeText.length) {
        const offsetBefore = offset
        typeArguments.push(parseUnion())
        skipSpaces()
        if (typeText[offset] === ',') {
          offset += 1
        } else if (typeText[offset] === '>') {
          offset += 1
          break
        } else if (offset === offsetBefore) {
          offset = typeText.length
        }
      }
    } else if (typeText[offset] === '{') {
      shapeEntries = parseShapeEntries()
    } else if (typeText[offset] === '(') {
      offset = endOfBalanced(typeText, offset)
      if (typeText[offset] === ':') {
        offset += 1
        parsePostfix()
      }
    } else if (typeText.startsWith('::', offset)) {
      offset += 2
      while (offset < typeText.length && /[A-Za-z0-9_*]/.test(typeText[offset] ?? '')) {
        offset += 1
      }

      return builtinType('mixed')
    }
    const resolved = resolveName(writtenName)

    return [{ kind: resolved.kind, name: resolved.name, typeArguments, ...(shapeEntries === undefined ? {} : { shapeEntries }) }]
  }

  const parseShapeEntries = (): PhpShapeEntry[] => {
    const shapeEnd = endOfBalanced(typeText, offset)
    const entries: PhpShapeEntry[] = []
    offset += 1
    while (offset < shapeEnd - 1) {
      const offsetBefore = offset
      const keyMatch = typeText.slice(offset, shapeEnd).match(/^\s*(['"]?)([A-Za-z0-9_-]+)\1\??\s*:/)
      if (keyMatch !== null) {
        offset += keyMatch[0].length
      }
      const entryType = parseUnion()
      entries.push({ key: keyMatch?.[2] ?? String(entries.length), type: entryType })
      skipSpaces()
      if (typeText[offset] !== ',' || offset === offsetBefore) {
        break
      }
      offset += 1
    }
    offset = shapeEnd

    return entries
  }

  const parsePostfix = (): PhpType => {
    let type = parsePrimary()
    while (typeText.startsWith('[]', offset)) {
      type = builtinType('array', [type])
      offset += 2
    }

    return type
  }

  function parseUnion(): PhpType {
    const members: PhpType = []
    while (offset < typeText.length) {
      const offsetBefore = offset
      skipSpaces()
      if (typeText[offset] === '?') {
        offset += 1
        members.push(...builtinType('null'))
      }
      members.push(...parsePostfix())
      skipSpaces()
      if (typeText[offset] === '|' || typeText[offset] === '&') {
        offset += 1
      } else {
        break
      }
      if (offset === offsetBefore) {
        break
      }
    }

    return members
  }

  return parseUnion()
}

// Whether the type names something to navigate to: a class, a placeholder, or a list or a shape of known elements.
export function isInformativeType(type: PhpType): boolean {
  return type.some(
    member =>
      member.kind !== 'builtin' ||
      member.typeArguments.some(isInformativeType) ||
      (member.shapeEntries ?? []).some(entry => isInformativeType(entry.type)),
  )
}

// What an array shape holds under a key: the entry "1" of array{0: Sheet, 1: Account} is Account.
export function shapeEntryTypeOf(type: PhpType, key: string): PhpType {
  return mergeTypes(...type.map(member => member.shapeEntries?.find(entry => entry.key === key)?.type ?? []))
}

// Whether the type leaves the question open: nothing, mixed, or a bare array, object or iterable. A scalar closes it.
export function isOpenType(type: PhpType): boolean {
  const openNames = new Set(['mixed', 'array', 'object', 'iterable', 'callable', 'null', 'list'])

  return type.every(
    member =>
      member.kind === 'builtin' && member.typeArguments.length === 0 && member.shapeEntries === undefined && openNames.has(member.name.toLowerCase()),
  )
}

export function hasTypeArgumentsOrPlaceholders(type: PhpType): boolean {
  return type.some(member => member.kind === 'template' || member.typeArguments.length > 0 || member.shapeEntries !== undefined)
}

export function classMembersOf(type: PhpType): PhpTypeMember[] {
  return type.filter(member => member.kind === 'class')
}

export function mergeTypes(...types: PhpType[]): PhpType {
  const merged: PhpType = []
  for (const member of types.flat()) {
    if (!merged.some(existing => existing.kind === member.kind && existing.name === member.name)) {
      merged.push(member)
    }
  }

  return merged
}

// What iterating the type or reading one of its entries gives, when its own arguments say it: Order[] and
// Collection<int, Order> give Order.
export function elementTypeOf(type: PhpType): PhpType {
  return mergeTypes(
    ...type.map(member => {
      if (member.typeArguments.length === 0 || (member.kind === 'builtin' && !ITERABLE_BUILTIN_NAMES.has(member.name.toLowerCase()))) {
        return []
      }
      const shortName = member.name.slice(member.name.lastIndexOf('\\') + 1)
      if (KEYED_BY_FIRST_ARGUMENT_CLASS_NAMES.has(shortName) && member.typeArguments.length >= 2) {
        return member.typeArguments[1] ?? []
      }

      return member.typeArguments.at(-1) ?? []
    }),
  )
}

export function substituteTypePlaceholders(type: PhpType, bindings: ReadonlyMap<string, PhpType>, receiverType: PhpType | null): PhpType {
  return mergeTypes(
    ...type.map((member): PhpType => {
      if (member.kind === 'template') {
        return bindings.get(member.name) ?? []
      }
      if (member.kind === 'receiver') {
        return receiverType ?? [member]
      }
      if (member.typeArguments.length === 0 && member.shapeEntries === undefined) {
        return [member]
      }
      const substitute = (type: PhpType) => substituteTypePlaceholders(type, bindings, receiverType)
      const shapeEntries = member.shapeEntries?.map(entry => ({ key: entry.key, type: substitute(entry.type) }))

      return [{ ...member, typeArguments: member.typeArguments.map(substitute), ...(shapeEntries === undefined ? {} : { shapeEntries }) }]
    }),
  )
}

export function typeLabelOf(type: PhpType): string {
  return type
    .map(member => (member.typeArguments.length === 0 ? member.name : `${member.name}<${member.typeArguments.map(typeLabelOf).join(', ')}>`))
    .join('|')
}
