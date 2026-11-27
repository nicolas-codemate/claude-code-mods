import { expect, test } from 'claude-code/testing'

import { escapedForRegularExpression, isClassLikeKind, labelOfSymbol, wholeNamePattern } from './symbol-names'

test('a member is named with what holds it, anything else by its own name', async () => {
  expect(labelOfSymbol({ name: 'save', container: 'OrderRepository' })).toBe('OrderRepository::save')
  expect(labelOfSymbol({ name: 'OrderRepository', container: null })).toBe('OrderRepository')
})

test('a class, an interface, a trait and an enum hold members; a function or a constant does not', async () => {
  expect((['class', 'interface', 'trait', 'enum'] as const).every(isClassLikeKind)).toBe(true)
  expect((['function', 'method', 'constant', 'property', 'type', 'variable'] as const).some(isClassLikeKind)).toBe(false)
})

test('a name is searched as a whole word, a variable with its dollar sign included', async () => {
  expect('$total = $this->total() + $totals'.match(new RegExp(wholeNamePattern('total'), 'g'))).toEqual(['total', 'total'])
  expect('$order->save($orders, $order)'.match(new RegExp(wholeNamePattern('$order'), 'g'))).toEqual(['$order', '$order'])
  expect(new RegExp(escapedForRegularExpression('a.b(c)')).test('a.b(c)')).toBe(true)
  expect(new RegExp(escapedForRegularExpression('a.b(c)')).test('axb(c)')).toBe(false)
})
