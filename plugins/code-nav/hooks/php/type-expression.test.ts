import { expect, test } from 'claude-code/testing'

import {
  classType,
  elementTypeOf,
  isBuiltinTypeName,
  isInformativeType,
  isOpenType,
  mergeTypes,
  parsePhpType,
  shapeEntryTypeOf,
  substituteTypePlaceholders,
  typeLabelOf,
} from './type-expression'
import type { PhpType, PhpTypeNameResolver } from './type-expression'

const resolveInShop: PhpTypeNameResolver = writtenName => {
  if (writtenName === 'static' || writtenName === 'self' || writtenName === '$this') {
    return { kind: 'receiver', name: 'static' }
  }
  if (writtenName === 'T' || writtenName === 'TKey') {
    return { kind: 'template', name: writtenName }
  }

  return isBuiltinTypeName(writtenName) ? { kind: 'builtin', name: writtenName } : { kind: 'class', name: `Shop\\${writtenName.replace(/^\\/, '')}` }
}

function parsed(typeText: string): PhpType {
  return parsePhpType(typeText, resolveInShop)
}

test('a nullable or a union type keeps every class of the union', async () => {
  expect(typeLabelOf(parsed('?Order'))).toBe('null|Shop\\Order')
  expect(typeLabelOf(parsed('Order|Invoice|null'))).toBe('Shop\\Order|Shop\\Invoice|null')
  expect(typeLabelOf(parsed('Order | Invoice'))).toBe('Shop\\Order|Shop\\Invoice')
  expect(typeLabelOf(parsed('(Countable&Order)|null'))).toBe('Shop\\Countable|Shop\\Order|null')
})

test('the list and generic spellings of a docblock all name their element', async () => {
  expect(typeLabelOf(parsed('Order[]'))).toBe('array<Shop\\Order>')
  expect(typeLabelOf(parsed('array<Order>'))).toBe('array<Shop\\Order>')
  expect(typeLabelOf(parsed('array<string, Order>'))).toBe('array<string, Shop\\Order>')
  expect(typeLabelOf(parsed('iterable<Order>'))).toBe('iterable<Shop\\Order>')
  expect(typeLabelOf(parsed('Collection<int, Order>'))).toBe('Shop\\Collection<int, Shop\\Order>')
  expect(typeLabelOf(parsed('list<Order[]>'))).toBe('list<array<Shop\\Order>>')
  expect(typeLabelOf(parsed('class-string<T>'))).toBe('class-string<T>')
})

test('placeholders and the receiver words are told apart from classes', async () => {
  expect(parsed('T|null').map(member => member.kind)).toEqual(['template', 'builtin'])
  expect(parsed('static').map(member => member.kind)).toEqual(['receiver'])
  expect(parsed('$this').map(member => member.kind)).toEqual(['receiver'])
  expect(parsed('\\DateTimeInterface')[0]).toEqual({ kind: 'class', name: 'Shop\\DateTimeInterface', typeArguments: [] })
})

test('what the parser does not model is kept as a builtin instead of failing', async () => {
  expect(typeLabelOf(parsed('callable(Order, int): Invoice'))).toBe('callable')
  expect(typeLabelOf(parsed("'paid'|Order"))).toBe('string|Shop\\Order')
  expect(typeLabelOf(parsed('int<0, max>'))).toBe('int<int, max>')
  expect(typeLabelOf(parsed('Order::STATUS_*'))).toBe('mixed')
  expect(parsed('')).toEqual([])
  expect(parsed('<<<')).toEqual([])
})

test('an array shape keeps its entries by key or by position', async () => {
  const shape = parsed('array{0: Sheet, 1: Account, total?: Money}')
  expect(typeLabelOf(shapeEntryTypeOf(shape, '1'))).toBe('Shop\\Account')
  expect(typeLabelOf(shapeEntryTypeOf(shape, 'total'))).toBe('Shop\\Money')
  expect(typeLabelOf(shapeEntryTypeOf(parsed('array{Sheet, Account}'), '1'))).toBe('Shop\\Account')
  expect(typeLabelOf(shapeEntryTypeOf(parsed("array{'lines': list<Line>}"), 'lines'))).toBe('list<Shop\\Line>')
  expect(shapeEntryTypeOf(shape, 'missing')).toEqual([])
})

test('the element of a list is its last argument, of a generator its value', async () => {
  expect(typeLabelOf(elementTypeOf(parsed('Order[]')))).toBe('Shop\\Order')
  expect(typeLabelOf(elementTypeOf(parsed('Collection<int, Order>|null')))).toBe('Shop\\Order')
  expect(typeLabelOf(elementTypeOf(parsed('Generator<int, Order, mixed, void>')))).toBe('Shop\\Order')
  expect(elementTypeOf(parsed('Order'))).toEqual([])
  expect(elementTypeOf(parsed('class-string<Order>'))).toEqual([])
})

test('placeholders take what they are bound to, the receiver words the type the member was reached through', async () => {
  const bindings = new Map([['T', classType('Shop\\Order')]])
  expect(typeLabelOf(substituteTypePlaceholders(parsed('T|null'), bindings, null))).toBe('Shop\\Order|null')
  expect(typeLabelOf(substituteTypePlaceholders(parsed('Collection<TKey, T>'), bindings, null))).toBe('Shop\\Collection<, Shop\\Order>')
  expect(typeLabelOf(substituteTypePlaceholders(parsed('static'), new Map(), classType('Shop\\QueryBuilder')))).toBe('Shop\\QueryBuilder')
  expect(typeLabelOf(substituteTypePlaceholders(parsed('array{0: T}'), bindings, null).flatMap(member => member.shapeEntries?.[0]?.type ?? []))).toBe('Shop\\Order')
})

test('a type is informative when it names a class, open when it leaves the question to the docblock', async () => {
  expect(isInformativeType(parsed('?Order'))).toBe(true)
  expect(isInformativeType(parsed('Order[]'))).toBe(true)
  expect(isInformativeType(parsed('array|string'))).toBe(false)
  expect(isOpenType(parsed('array'))).toBe(true)
  expect(isOpenType(parsed('?object'))).toBe(true)
  expect(isOpenType([])).toBe(true)
  expect(isOpenType(parsed('string'))).toBe(false)
  expect(isOpenType(parsed('Order[]'))).toBe(false)
})

test('merging types keeps one member per name', async () => {
  expect(typeLabelOf(mergeTypes(parsed('Order|null'), parsed('Order|Invoice')))).toBe('Shop\\Order|null|Shop\\Invoice')
})
