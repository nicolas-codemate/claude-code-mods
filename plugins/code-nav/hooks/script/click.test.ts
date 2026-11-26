import { expect, test } from 'claude-code/testing'

import { readClickAtOffset, readClickAtPosition, symbolOfClick } from './click'
import { buildScriptModel } from './script-model'

const SCRIPT = [
  "import { fetchOrder as loadOrder } from './api/orders'",
  '// loadOrder is called below',
  "const label = 'loadOrder'",
  'const type = 1',
  'export async function show(order) {',
  '  return loadOrder(order.id + type)',
  '}',
].join('\n')
const scriptModel = buildScriptModel('src/show.ts', SCRIPT)

const COMPONENT = [
  '<template>',
  '  <OrderRow v-for="order in orders" :order="order" />',
  '  <p>{{ total }}</p>',
  '</template>',
  '<script setup>',
  'const total = 1',
  '</script>',
].join('\n')
const componentModel = buildScriptModel('src/Table.vue', COMPONENT)

function kindAt(model: typeof scriptModel, text: string, code: string, name: string = code): string {
  return readClickAtOffset(model, text.indexOf(code) + code.indexOf(name)).kind
}

test('a name of the code is a click on a name, anywhere inside it', async () => {
  const start = SCRIPT.indexOf('loadOrder(order')
  for (const offset of [start, start + 4, start + 8]) {
    expect(readClickAtOffset(scriptModel, offset).kind).toBe('name')
  }
  expect(readClickAtOffset(scriptModel, start + 9).kind).toBe('none')
})

test('a comment, a string that names no module, a keyword and blank space are no click', async () => {
  expect(kindAt(scriptModel, SCRIPT, '// loadOrder is called', 'loadOrder')).toBe('none')
  expect(kindAt(scriptModel, SCRIPT, "'loadOrder'", 'loadOrder')).toBe('none')
  expect(kindAt(scriptModel, SCRIPT, 'return loadOrder', 'return')).toBe('none')
  expect(kindAt(scriptModel, SCRIPT, 'export async', 'async')).toBe('none')
  expect(readClickAtOffset(scriptModel, SCRIPT.indexOf('  return')).kind).toBe('none')
})

test('the string of an import is a click on a module', async () => {
  const click = readClickAtOffset(scriptModel, SCRIPT.indexOf('api/orders'))
  expect(click.kind === 'specifier' ? click.specifier : null).toBe('./api/orders')
})

test('a word the language also reads as a keyword is a name when the file declares it', async () => {
  expect(kindAt(scriptModel, SCRIPT, 'order.id + type', 'type')).toBe('name')
  expect(kindAt(buildScriptModel('src/a.ts', 'type Order = string'), 'type Order = string', 'type')).toBe('none')
})

test('in a template a tag, a name of an expression and a name declared by a directive are told apart', async () => {
  expect(kindAt(componentModel, COMPONENT, '<OrderRow', 'OrderRow')).toBe('componentTag')
  expect(kindAt(componentModel, COMPONENT, 'in orders"', 'orders')).toBe('name')
  expect(kindAt(componentModel, COMPONENT, '{{ total }}', 'total')).toBe('name')
  expect(kindAt(componentModel, COMPONENT, 'order in', 'order')).toBe('templateLocal')
  expect(kindAt(componentModel, COMPONENT, ':order="order"', 'order=')).toBe('none')
  expect(kindAt(componentModel, COMPONENT, '<p>', 'p')).toBe('componentTag')
})

test('the symbol of a click gives its range on its line and what it was read as', async () => {
  const symbolAt = (code: string, name: string) =>
    symbolOfClick(scriptModel, readClickAtOffset(scriptModel, SCRIPT.indexOf(code) + code.indexOf(name)))
  expect(symbolAt('return loadOrder(order.id', 'loadOrder')).toEqual({
    name: 'loadOrder',
    line: 6,
    startColumn: 9,
    endColumn: 18,
    description: 'imported name loadOrder',
  })
  expect(symbolAt('order.id + type', 'id')?.description).toBe('member id of order')
  expect(symbolAt('loadOrder(order.id', 'order')?.description).toBe('parameter order')
  expect(symbolAt('async function show', 'show')?.description).toBe('function show')
  expect(symbolAt("'./api/orders'", 'api')?.description).toBe('module ./api/orders')
  expect(symbolOfClick(componentModel, readClickAtOffset(componentModel, COMPONENT.indexOf('OrderRow')))?.description).toBe(
    'component OrderRow',
  )
  expect(symbolOfClick(scriptModel, { kind: 'none' })).toBe(null)
})

test('a position is a line counted from 1 and a column counted from 0', async () => {
  expect(readClickAtPosition(scriptModel, { path: 'src/show.ts', line: 6, column: 10 }).kind).toBe('name')
  expect(readClickAtPosition(scriptModel, { path: 'src/show.ts', line: 60, column: 0 }).kind).toBe('none')
})
