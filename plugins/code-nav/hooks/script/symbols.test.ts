import { expect, test } from 'claude-code/testing'

import type { SymbolEntry } from '../../types'
import { buildScriptModel } from './script-model'
import { holderNameOf, labelOfDeclaration, scriptSymbolsOfFile } from './symbols'
import { SHOP_FILES } from './test-project'

function rowsOf(symbols: SymbolEntry[]): string[] {
  return symbols.map(
    symbol => `${symbol.line} ${symbol.kind} ${symbol.container === null ? '' : `${symbol.container}.`}${symbol.name}`,
  )
}

function symbolsOfShopFile(path: string): string[] {
  return rowsOf(scriptSymbolsOfFile(path, SHOP_FILES[path] ?? ''))
}

test('the top-level declarations of a file are listed with their kind and their line', async () => {
  expect(symbolsOfShopFile('src/api/orders.ts')).toEqual([
    '4 constant ORDERS_ENDPOINT',
    '6 function fetchOrder',
    '10 function fetchOrders',
  ])
  expect(scriptSymbolsOfFile('src/api/orders.ts', SHOP_FILES['src/api/orders.ts'] ?? '')[0]).toEqual({
    name: 'ORDERS_ENDPOINT',
    kind: 'constant',
    path: 'src/api/orders.ts',
    line: 4,
    container: null,
  })
})

test('imports are no declarations of the file', async () => {
  expect(symbolsOfShopFile('src/api/index.ts')).toEqual([])
})

test('the members of an enum, of an interface and of a type literal are listed under their holder', async () => {
  expect(symbolsOfShopFile('src/types/order.ts')).toEqual([
    '1 enum OrderStatus',
    '2 constant OrderStatus.Draft',
    '3 constant OrderStatus.Paid',
    '6 interface Customer',
    '7 property Customer.name',
    '10 interface Order',
    '11 property Order.id',
    '12 property Order.total',
    '13 property Order.status',
    '14 property Order.customer',
    '17 type OrderLine',
    '17 property OrderLine.sku',
    '17 property OrderLine.quantity',
  ])
})

test('the members of a class are listed under it, the properties of its constructor included', async () => {
  expect(symbolsOfShopFile('src/repositories/HttpOrderRepository.ts')).toEqual([
    '7 class HttpOrderRepository',
    '8 property HttpOrderRepository.savedCount',
    '10 method HttpOrderRepository.constructor',
    '14 method HttpOrderRepository.find',
    '19 method HttpOrderRepository.save',
    '10 property HttpOrderRepository.client',
  ])
})

test('what a composable returns is listed under it, its other local names are not', async () => {
  expect(symbolsOfShopFile('src/composables/useOrders.ts')).toEqual([
    '7 function useOrders',
    '8 property useOrders.orders',
    '9 property useOrders.total',
    '11 method useOrders.load',
    '15 method useOrders.reload',
  ])
})

test('the state, getters and actions given to a store factory are listed under the store', async () => {
  expect(symbolsOfShopFile('src/stores/cartStore.ts')).toEqual([
    '4 constant useCartStore',
    '5 method useCartStore.state',
    '6 property useCartStore.getters',
    '9 property useCartStore.actions',
    '5 property useCartStore.lines',
    '7 method useCartStore.count',
    '10 method useCartStore.add',
    '13 method useCartStore.clear',
  ])
  expect(symbolsOfShopFile('src/stores/orderStore.ts')).toEqual([
    '6 constant useOrderStore',
    '7 property useOrderStore.orders',
    '9 method useOrderStore.load',
  ])
})

test('the declarations of a Vue component are those of its script block, at their lines in the whole file', async () => {
  expect(symbolsOfShopFile('src/pages/OrdersPage.vue')).toEqual([
    '9 constant orders',
    '9 constant total',
    '9 constant loadOrders',
    '10 constant orderStore',
    '11 constant cartStore',
    '12 constant storedOrders',
    '14 function onSelect',
  ])
})

test('the keys of a constant object literal are listed under the constant', async () => {
  expect(
    rowsOf(
      scriptSymbolsOfFile(
        'src/settings.ts',
        "export const SETTINGS = {\n  currency: 'EUR',\n  format(amount) { return amount },\n}",
      ),
    ),
  ).toEqual(['1 constant SETTINGS', '2 property SETTINGS.currency', '3 method SETTINGS.format'])
})

test('a member is labelled with the name it is reached through, a name on its own with its name alone', async () => {
  const model = buildScriptModel('src/stores/cartStore.ts', SHOP_FILES['src/stores/cartStore.ts'] ?? '')
  const declarationNamed = (name: string) =>
    [...model.structure.declarationAtToken.values()].find(declaration => declaration.name === name)
  const add = declarationNamed('add')
  const store = declarationNamed('useCartStore')
  const parameter = declarationNamed('line')
  expect(add === undefined ? null : labelOfDeclaration(model.structure, add)).toBe('useCartStore.add')
  expect(store === undefined ? null : holderNameOf(model.structure, store)).toBe(null)
  expect(parameter === undefined ? null : labelOfDeclaration(model.structure, parameter)).toBe('line')
})

test('a file that is no valid code lists what it can and never throws', async () => {
  expect(rowsOf(scriptSymbolsOfFile('src/broken.ts', 'export function open( {\nconst after = 1\nclass'))).toEqual([
    '1 function open',
    '2 constant after',
  ])
  expect(scriptSymbolsOfFile('src/empty.ts', '')).toEqual([])
})
