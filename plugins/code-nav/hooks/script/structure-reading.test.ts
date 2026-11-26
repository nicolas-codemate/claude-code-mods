import { expect, test } from 'claude-code/testing'

import type { ScriptScope, ScriptStructure } from './declarations'
import { readScriptStructure } from './structure-reading'
import { tokenizeScript } from './tokenizer'

function read(text: string, hasMarkup = false): ScriptStructure {
  return readScriptStructure(tokenizeScript(text, { hasMarkup }))
}

// One line per declaration, indented by the depth of its scope: "function load", ".member total" for a member.
function outlineOf(structure: ScriptStructure): string[] {
  const lines: string[] = []
  const visit = (scope: ScriptScope, indent: string): void => {
    for (const declaration of scope.declarations) {
      lines.push(`${indent}${declaration.role === 'member' ? '.' : ''}${declaration.kind} ${declaration.name}`)
    }
    for (const child of scope.children) {
      visit(child, child.declarations.length > 0 || child.children.length > 0 ? `${indent}  ` : indent)
    }
  }
  visit(structure.fileScope, '')

  return lines
}

test('every form of import declares its local names with what they import', async () => {
  const structure = read(
    [
      "import OrderTable from './OrderTable.vue'",
      "import * as api from './api'",
      "import { fetchOrder, fetchOrders as loadOrders, type Order } from './api/orders'",
      "import type { Customer } from './types'",
      "import React, { useState } from 'react'",
      "import './setup'",
      "const lazyPage = () => import('./pages/OrdersPage.vue')",
      "const { formatPrice } = require('./format')",
    ].join('\n'),
  )
  const imports = structure.fileScope.declarations
    .filter(declaration => declaration.importBinding !== null)
    .map(
      declaration =>
        `${declaration.name} = ${declaration.importBinding?.importedName} of ${declaration.importBinding?.specifier}${declaration.importBinding?.isTypeOnly ? ' (type)' : ''}`,
    )
  expect(imports).toEqual([
    'OrderTable = default of ./OrderTable.vue',
    'api = * of ./api',
    'fetchOrder = fetchOrder of ./api/orders',
    'loadOrders = fetchOrders of ./api/orders',
    'Order = Order of ./api/orders (type)',
    'Customer = Customer of ./types (type)',
    'React = default of react',
    'useState = useState of react',
    'formatPrice = formatPrice of ./format',
  ])
  expect([...structure.specifierAtToken.values()]).toEqual([
    './OrderTable.vue',
    './api',
    './api/orders',
    './types',
    'react',
    './setup',
    './pages/OrdersPage.vue',
    './format',
  ])
})

test('exports are read: declarations, lists, re-exports, stars and the default', async () => {
  const structure = read(
    [
      'export const TAX_RATE = 0.2',
      'function total() {}',
      'export { total as orderTotal }',
      "export { fetchOrder as loadOrder } from './orders'",
      "export * from './invoices'",
      "export * as http from './http'",
      'export default total',
    ].join('\n'),
  )
  expect(structure.fileScope.declarations.map(declaration => `${declaration.name}:${declaration.isExported}`)).toEqual([
    'TAX_RATE:true',
    'total:false',
  ])
  expect(structure.exportLinks).toEqual([
    { kind: 'named', exportedName: 'orderTotal', localName: 'total', specifier: null },
    { kind: 'named', exportedName: 'loadOrder', localName: 'fetchOrder', specifier: './orders' },
    { kind: 'star', namespaceName: null, specifier: './invoices' },
    { kind: 'star', namespaceName: 'http', specifier: './http' },
  ])
  expect(structure.tokens[structure.defaultExport?.referenceTokenIndex ?? -1]?.text).toBe('total')
})

test('a default export of a declaration flags it, of an expression names nothing', async () => {
  expect(read('export default class OrderService {}').fileScope.declarations[0]?.isDefaultExport).toBe(true)
  expect(read('export default defineComponent({})').defaultExport).toEqual({ tokenIndex: 1, referenceTokenIndex: null })
})

test('a class declares its members, the properties of its constructor included, and what it extends and implements', async () => {
  const structure = read(
    [
      'export abstract class OrderStore<T> extends BaseStore<T> implements Loadable, Countable {',
      '  private items: T[] = []',
      '  static instance?: OrderStore<unknown>',
      '  constructor(private readonly repository: OrderRepository, name: string) { super() }',
      '  get total(): number { return this.items.length }',
      '  async load(id: string): Promise<void> {}',
      '  save = async (order: Order) => order',
      '  abstract remove(id: string): void',
      '}',
    ].join('\n'),
  )
  expect(outlineOf(structure)).toEqual([
    'class OrderStore',
    '  typeParameter T',
    '  .property items',
    '  .property instance',
    '  .method constructor',
    '  .method total',
    '  .method load',
    '  .method save',
    '  .method remove',
    '  .property repository',
    '    parameter repository',
    '    parameter name',
    '    parameter id',
    '    parameter order',
  ])
  const orderStore = structure.fileScope.declarations[0]
  expect(orderStore?.extendedNameIndexes.map(index => structure.tokens[index]?.text)).toEqual(['BaseStore'])
  expect(orderStore?.implementedNameIndexes.map(index => structure.tokens[index]?.text)).toEqual(['Loadable', 'Countable'])
})

test('an interface, an enum and a type literal declare their members', async () => {
  const structure = read(
    [
      'interface OrderRepository extends Repository<Order> {',
      '  find(id: string): Promise<Order>',
      '  readonly all: Order[]',
      '  status:',
      "    | 'draft'",
      "    | 'paid'",
      '  onChange?: (order: Order) => void',
      '}',
      "enum OrderStatus { Draft = 'draft', Paid = 'paid', Shipped }",
      'type OrderLine = { sku: string; quantity: number }',
    ].join('\n'),
  )
  expect(outlineOf(structure).filter(line => !line.includes('parameter'))).toEqual([
    'interface OrderRepository',
    'enum OrderStatus',
    'type OrderLine',
    '  .method find',
    '  .property all',
    '  .property status',
    '  .method onChange',
    '  .constant Draft',
    '  .constant Paid',
    '  .constant Shipped',
    '  .property sku',
    '  .property quantity',
  ])
})

test('an object literal declares its keys and its methods, a bare name in it is a shorthand', async () => {
  const structure = read('const api = { timeout: 30, fetch(id) { return id }, retry: async () => {}, client }')
  const members = structure.fileScope.children[0]?.declarations ?? []
  expect(members.map(member => `${member.kind} ${member.name}${member.isShorthand ? ' (shorthand)' : ''}`)).toEqual([
    'property timeout',
    'method fetch',
    'method retry',
    'property client (shorthand)',
  ])
})

test('a function scope holds its parameters and the names of its body, a block the names declared in it', async () => {
  const structure = read(
    [
      'export function useOrders(initialOrders: Order[] = []) {',
      '  const orders = ref(initialOrders)',
      '  const { data, error: loadError } = fetchOrders()',
      '  for (const order of orders.value) { const line = order.lines[0] }',
      '  try { load() } catch (failure) { report(failure) }',
      '  const total = computed(() => orders.value.reduce((sum, order) => sum + order.total, 0))',
      '  return { orders, total }',
      '}',
    ].join('\n'),
  )
  expect(outlineOf(structure)).toEqual([
    'function useOrders',
    '  parameter initialOrders',
    '  constant orders',
    '  constant data',
    '  constant loadError',
    '  constant total',
    '    constant order',
    '    constant line',
    '    parameter failure',
    '      parameter sum',
    '      parameter order',
    '    .property orders',
    '    .property total',
  ])
})

test('a constant holding a function is a function, and an arrow of one bare parameter has its scope', async () => {
  const structure = read(
    'const load = async (id: string): Promise<Order> => fetchOrder(id)\nconst ids = orders.map(order => order.id)',
  )
  expect(structure.fileScope.declarations.map(declaration => `${declaration.kind} ${declaration.name}`)).toEqual([
    'function load',
    'constant ids',
  ])
  expect(structure.fileScope.children.map(scope => scope.declarations.map(declaration => declaration.name))).toEqual([
    ['id'],
    ['order'],
  ])
})

test('the type of a parameter and the object given as its default value are read, its pattern declares no member', async () => {
  const structure = read('function show({ order }: { order: Order; compact?: boolean }, options = { sort: true }) {}')
  expect(outlineOf(structure)).toEqual([
    'function show',
    '  parameter order',
    '  parameter options',
    '    .property order',
    '    .property compact',
    '    .property sort',
  ])
})

test('the commas of type arguments declare no second constant', async () => {
  const structure = read('const ordersById = new Map<string, Order>(), pending = 2')
  expect(structure.fileScope.declarations.map(declaration => declaration.name)).toEqual(['ordersById', 'pending'])
})

test('a keyword used as a key or as a property declares nothing', async () => {
  const structure = read(
    "const options = { type: 'button', class: 'primary', function: 1, import: 2 }\nrouter.import.type\nconst kind = options.class",
  )
  expect(structure.fileScope.declarations.map(declaration => declaration.name)).toEqual(['options', 'kind'])
})

test('a named function used as a value is known inside itself only', async () => {
  const structure = read('const handler = function retry() { retry() }')
  expect(structure.fileScope.declarations.map(declaration => declaration.name)).toEqual(['handler'])
  expect(structure.fileScope.children[0]?.declarations.map(declaration => declaration.name)).toEqual(['retry'])
})

test('a declared type and a destructured key are remembered on the names they concern', async () => {
  const structure = read('const repository: OrderRepository = create()\nconst { load: reload } = useOrders()')
  const [repository, reload] = structure.fileScope.declarations
  expect(structure.tokens[repository?.typeTokenIndex ?? -1]?.text).toBe('OrderRepository')
  expect(reload?.sourceProperty).toBe('load')
  expect([...structure.destructuredKeyAtToken.values()].map(declaration => declaration.name)).toEqual(['reload'])
})

test('JSX and its expressions are read without disturbing the scopes around them', async () => {
  const structure = read(
    'const Row = (props) => <Box title="it\'s">{props.items.map(item => <Text>{item.name}</Text>)}</Box>\nconst after = 1',
    true,
  )
  expect(structure.fileScope.declarations.map(declaration => declaration.name)).toEqual(['Row', 'after'])
})

test('unbalanced or unknown code declares what it can and never throws', async () => {
  for (const text of [
    'class {',
    'function (',
    'const = ;',
    'export { a as',
    'import {',
    'interface',
    '}}}) const ok = 1',
    'type = <',
    'for (const of',
  ]) {
    expect(Array.isArray(read(text).fileScope.declarations)).toBe(true)
  }
  expect(read('}}}) const ok = 1').fileScope.declarations.map(declaration => declaration.name)).toEqual(['ok'])
})
