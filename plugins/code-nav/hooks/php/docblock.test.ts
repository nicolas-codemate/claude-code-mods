import { expect, test } from 'claude-code/testing'

import { docblockReferenceAt, docblockTagsOf, readTypeExpressionPrefix, variableTypeTextIn } from './docblock'
import type { PhpComment } from './tokens'

function docblockOf(text: string, start = 0): PhpComment {
  return { text, start, end: start + text.length, isDocblock: true }
}

function referenceOn(docblock: PhpComment, snippet: string, name: string) {
  const offset = docblock.start + docblock.text.indexOf(snippet) + snippet.lastIndexOf(name) + 1
  const reference = docblockReferenceAt(docblock, offset)

  return reference === null ? null : `${reference.className}${reference.memberName === null ? '' : `::${reference.memberName}`}${reference.isOnMember ? ' (member)' : ''}`
}

const METHOD_DOCBLOCK = docblockOf(`/**
     * Finds the orders of a customer, see {@see OrderFinder::findPaid()}.
     *
     * @template T of object
     *
     * @param class-string<T>           $className
     * @param array<string, Customer>   $customers the Customers by email
     * @param Order|Invoice ...$documents
     * @psalm-param non-empty-list<Order> $orders
     * @param Order[] $orders
     *
     * @return object|null
     * @phpstan-return T|null
     *
     * @throws OrderNotFound|\\RuntimeException when nothing matches
     * @see \\Shop\\Repository\\OrderRepository::save
     */`)

test('parameter and return types are read, the stricter tool tags winning over the plain ones', async () => {
  const tags = docblockTagsOf(METHOD_DOCBLOCK)
  expect(Object.fromEntries(tags.parameterTypeTexts)).toEqual({
    $className: 'class-string<T>',
    $customers: 'array<string, Customer>',
    $documents: 'Order|Invoice',
    $orders: 'non-empty-list<Order>',
  })
  expect(tags.returnTypeText).toBe('T|null')
  expect(tags.templates).toEqual([{ name: 'T', boundTypeText: 'object' }])
})

test('a class docblock gives what the parents stand for, its mixins and the members it declares', async () => {
  const tags = docblockTagsOf(
    docblockOf(`/**
 * @template TKey of array-key
 * @template-covariant T
 * @extends ServiceEntityRepository<Order>
 * @implements IteratorAggregate<TKey, T>
 * @mixin QueryHelpers
 *
 * @method Order|null find($id, $lockMode = null)
 * @method static Builder query()
 * @method array<int, Order> findAll()
 * @property-read Money $total
 * @property string|null $note
 */`),
  )
  expect(tags.templates.map(template => template.name)).toEqual(['TKey', 'T'])
  expect(tags.inheritedTypeTexts).toEqual(['ServiceEntityRepository<Order>', 'IteratorAggregate<TKey, T>'])
  expect(tags.mixinTypeTexts).toEqual(['QueryHelpers'])
  expect(tags.methods.map(method => [method.name, method.typeText, method.isStatic])).toEqual([
    ['find', 'Order|null', false],
    ['query', 'Builder', true],
    ['findAll', 'array<int, Order>', false],
  ])
  expect(tags.properties.map(property => [property.name, property.typeText])).toEqual([['total', 'Money'], ['note', 'string|null']])
})

test('an inline var docblock types the variable it names, or the one right after it when it names none', async () => {
  const named = docblockOf('/** @var Order $order */')
  expect(variableTypeTextIn(named, '$order', false)).toBe('Order')
  expect(variableTypeTextIn(named, '$other', true)).toBe(null)
  const unnamed = docblockOf('/** @var Collection<int, Order> */')
  expect(variableTypeTextIn(unnamed, '$orders', true)).toBe('Collection<int, Order>')
  expect(variableTypeTextIn(unnamed, '$orders', false)).toBe(null)
  expect(variableTypeTextIn(null, '$orders', true)).toBe(null)
})

test('a type runs to the first space outside its brackets', async () => {
  expect(readTypeExpressionPrefix('array<string, Order> $orders the orders', 0)).toEqual({ typeText: 'array<string, Order>', end: 20 })
  expect(readTypeExpressionPrefix('Order | null $order', 0).typeText).toBe('Order | null')
  expect(readTypeExpressionPrefix('Order &$order', 0).typeText).toBe('Order')
  expect(readTypeExpressionPrefix('callable(Order): void $callback', 0).typeText).toBe('callable(Order):')
})

test('a class name in the type of a tag is a reference, with its place in the file', async () => {
  expect(referenceOn(METHOD_DOCBLOCK, '@param array<string, Customer>', 'Customer')).toBe('Customer')
  expect(referenceOn(METHOD_DOCBLOCK, '@param Order|Invoice', 'Invoice')).toBe('Invoice')
  expect(referenceOn(METHOD_DOCBLOCK, 'non-empty-list<Order>', 'Order')).toBe('Order')
  expect(referenceOn(METHOD_DOCBLOCK, '@throws OrderNotFound|\\RuntimeException', 'RuntimeException')).toBe('\\RuntimeException')
  const shifted = docblockOf('/** @return Order */', 100)
  expect(docblockReferenceAt(shifted, 113)).toEqual({ className: 'Order', memberName: null, isOnMember: false, start: 112, end: 117 })
})

test('a see tag names a class and may name one of its members', async () => {
  expect(referenceOn(METHOD_DOCBLOCK, '{@see OrderFinder::findPaid()}', 'OrderFinder')).toBe('OrderFinder')
  expect(referenceOn(METHOD_DOCBLOCK, '{@see OrderFinder::findPaid()}', 'findPaid')).toBe('OrderFinder::findPaid (member)')
  expect(referenceOn(METHOD_DOCBLOCK, '@see \\Shop\\Repository\\OrderRepository::save', 'save')).toBe('\\Shop\\Repository\\OrderRepository::save (member)')
})

test('a builtin type, a variable name, a tag name and a word of the description are no reference', async () => {
  expect(referenceOn(METHOD_DOCBLOCK, '@param array<string, Customer>', 'string')).toBe(null)
  expect(referenceOn(METHOD_DOCBLOCK, 'class-string<T>', 'class')).toBe(null)
  expect(referenceOn(METHOD_DOCBLOCK, '$customers the Customers by email', 'Customers')).toBe(null)
  expect(referenceOn(METHOD_DOCBLOCK, '$customers the', 'customers')).toBe(null)
  expect(referenceOn(METHOD_DOCBLOCK, '@throws OrderNotFound', 'throws')).toBe(null)
  expect(referenceOn(METHOD_DOCBLOCK, 'Finds the orders of a customer', 'orders')).toBe(null)
  expect(referenceOn(METHOD_DOCBLOCK, '@return object|null', 'object')).toBe(null)
})

test('the bound of a template and the return type of a method tag are references, their own names are not', async () => {
  const docblock = docblockOf('/**\n * @template T of Product\n * @method Order|null findLatest(Customer $customer)\n */')
  expect(referenceOn(docblock, '@template T of Product', 'Product')).toBe('Product')
  expect(referenceOn(docblock, '@template T of', 'T')).toBe(null)
  expect(referenceOn(docblock, '@method Order|null', 'Order')).toBe('Order')
  expect(referenceOn(docblock, 'findLatest(', 'findLatest')).toBe(null)
})
