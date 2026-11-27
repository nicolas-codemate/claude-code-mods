import { expect, test } from 'claude-code/testing'

import { componentNameOfTag, localNamesVisibleFrom, scanVueTemplate } from './vue-template'

const TEMPLATE = [
  '<table>',
  '  <!-- <Hidden :orders="orders" /> -->',
  '  <OrderRow v-for="(order, index) in orders" :key="order.id" :order="order" class="row" @click="select(order)" />',
  '  <OrderTable>',
  '    <template #footer="{ total: sum }">{{ formatPrice(sum) }}</template>',
  '  </OrderTable>',
  '  <input ref="search" v-model="query">',
  '  <p>{{ total }}</p>',
  '</table>',
].join('\n')
const scan = scanVueTemplate(TEMPLATE, { start: 0, end: TEMPLATE.length })

test('every tag is an element with the range of its name, comments are skipped', async () => {
  expect(scan.elements.map(element => element.tagName)).toEqual([
    'table',
    'OrderRow',
    'OrderTable',
    'template',
    'input',
    'p',
  ])
  const orderTable = scan.elements[2]
  expect(TEMPLATE.slice(orderTable?.nameRange.start, orderTable?.nameRange.end)).toBe('OrderTable')
  expect(TEMPLATE.slice(orderTable?.closingNameRange?.start, orderTable?.closingNameRange?.end)).toBe('OrderTable')
})

test('interpolations and the values of directives are expressions, a plain attribute is not', async () => {
  expect(scan.expressions.map(expression => TEMPLATE.slice(expression.start, expression.end).trim())).toEqual([
    'orders',
    'order.id',
    'order',
    'select(order)',
    'formatPrice(sum)',
    'search',
    'query',
    'total',
  ])
})

test('a v-for and the props of a slot declare names for their own element', async () => {
  expect(scan.elements[1]?.localNames.map(localName => localName.name)).toEqual(['order', 'index'])
  expect(scan.elements[3]?.localNames.map(localName => localName.name)).toEqual(['sum'])
})

test('an expression sees the names of the elements around it, the list of a v-for does not see its own item', async () => {
  const namesSeenBy = (code: string) => {
    const expression = scan.expressions.find(candidate => TEMPLATE.slice(candidate.start, candidate.end).trim() === code)
    return localNamesVisibleFrom(scan, expression?.elementIndex ?? null).map(localName => localName.name)
  }
  expect(namesSeenBy('select(order)')).toEqual(['order', 'index'])
  expect(namesSeenBy('formatPrice(sum)')).toEqual(['sum'])
  expect(namesSeenBy('orders')).toEqual([])
  expect(namesSeenBy('total')).toEqual([])
})

test('a tag written with dashes names the same component as its PascalCase spelling', async () => {
  expect(componentNameOfTag('order-table')).toBe('OrderTable')
  expect(componentNameOfTag('OrderTable')).toBe('OrderTable')
})
