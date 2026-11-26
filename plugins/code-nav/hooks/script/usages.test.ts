import { expect, test } from 'claude-code/testing'

import type { UsagesAnswer } from '../../types'
import type { Workspace } from '../workspace'
import { createShopWorkspace, lineOf, positionIn, SHOP_FILES } from './test-project'
import { findScriptUsages } from './usages'

const workspace = createShopWorkspace()

function usagesAt(path: string, code: string, name: string = code): Promise<UsagesAnswer> {
  return findScriptUsages(workspace, positionIn(path, code, name))
}

function rowsOf(answer: UsagesAnswer): string[] {
  return answer.usages.map(usage => `${usage.certainty} ${usage.path}:${usage.line} ${usage.preview}`)
}

const USE_ORDERS = 'src/composables/useOrders.ts'
const ORDERS_PAGE = 'src/pages/OrdersPage.vue'

test('the usages of an exported function are confirmed in the files that import it, directly, through a namespace or through an index', async () => {
  const answer = await usagesAt('src/api/orders.ts', 'async function fetchOrders(', 'fetchOrders')
  expect(answer.title).toBe('fetchOrders')
  expect(rowsOf(answer)).toEqual([
    `confirmed ${USE_ORDERS}:12 orders.value = await api.fetchOrders()`,
    'confirmed src/stores/orderStore.ts:10 orders.value = await fetchOrders()',
  ])
  expect(answer.isTruncated).toBe(false)
})

test('import lines, re-export lines, comments and strings are no usages', async () => {
  const previews = (await usagesAt('src/api/orders.ts', 'async function fetchOrders(', 'fetchOrders')).usages.map(
    usage => usage.preview,
  )
  expect(
    previews.some(
      preview =>
        preview.startsWith('import') ||
        preview.startsWith('export {') ||
        preview.includes('not called') ||
        preview.includes('failed'),
    ),
  ).toBe(false)
})

test('a name imported under another name is followed to the uses of that other name', async () => {
  const answer = await usagesAt('src/api/orders.ts', 'async function fetchOrder(', 'fetchOrder')
  expect(rowsOf(answer)).toEqual([`confirmed ${USE_ORDERS}:16 const { status, customer: buyer } = await loadOrder(id)`])
})

test('the usages are the same when asked from a use of the name', async () => {
  const fromUse = await usagesAt('src/stores/orderStore.ts', 'await fetchOrders()', 'fetchOrders')
  const fromDeclaration = await usagesAt('src/api/orders.ts', 'async function fetchOrders(', 'fetchOrders')
  expect(rowsOf(fromUse)).toEqual(rowsOf(fromDeclaration))
})

test('a local variable or a parameter is used within its scope only', async () => {
  const parameter = await usagesAt(USE_ORDERS, '(sum, order)', 'order')
  expect(rowsOf(parameter)).toEqual([
    `confirmed ${USE_ORDERS}:9 const total = computed(() => orders.value.reduce((sum, order) => sum + order.total, 0))`,
  ])
  expect(parameter.usages[0]?.column).toBe(SHOP_FILES[USE_ORDERS]?.split('\n')[8]?.indexOf('order.total'))
  const local = await usagesAt(USE_ORDERS, 'const { status, customer', 'status')
  expect(local.usages.map(usage => usage.line)).toEqual([lineOf(USE_ORDERS, 'status: status ??')])
})

test('a name of a component script is used in its script and in its template', async () => {
  const answer = await usagesAt(ORDERS_PAGE, 'function onSelect', 'onSelect')
  expect(rowsOf(answer)).toEqual([`confirmed ${ORDERS_PAGE}:26 <OrderTable :orders="orders" @select="onSelect" />`])
})

test('what a composable returns is confirmed where its result is destructured, and at the uses of the destructured name', async () => {
  const answer = await usagesAt(USE_ORDERS, 'async function load()', 'load')
  expect(answer.title).toBe('useOrders.load')
  expect(rowsOf(answer)).toEqual([
    `confirmed ${USE_ORDERS}:22 return { orders, total, load, reload }`,
    `confirmed ${ORDERS_PAGE}:9 const { orders, total, load: loadOrders } = useOrders()`,
    `confirmed ${ORDERS_PAGE}:20 loadOrders()`,
  ])
})

test('an action of a store is confirmed on the stores made by its factory and on this inside the store', async () => {
  const answer = await usagesAt('src/stores/cartStore.ts', 'add(line: OrderLine)', 'add')
  expect(answer.title).toBe('useCartStore.add')
  expect(rowsOf(answer)).toEqual([
    'confirmed src/stores/cartStore.ts:14 this.add({ sku: "", quantity: 0 })',
    `confirmed ${ORDERS_PAGE}:16 cartStore.add(line)`,
  ])
})

test('a property of a type is confirmed where the type of the value is known, unverified on a value of unknown type', async () => {
  const answer = await usagesAt('src/types/order.ts', 'total: number', 'total')
  expect(answer.title).toBe('Order.total')
  expect(rowsOf(answer)).toEqual([
    'confirmed src/components/OrderRow.vue:11 <td>{{ formatPrice(props.order.total) }}</td>',
    `unverified ${USE_ORDERS}:9 const total = computed(() => orders.value.reduce((sum, order) => sum + order.total, 0))`,
    `unverified ${USE_ORDERS}:19 return { id, total: 0, status: status ?? OrderStatus.Draft, customer: buyer }`,
    `unverified ${ORDERS_PAGE}:17 console.log(order.customer.name, cartStore.count, unknownHelper.total)`,
  ])
})

test('a member of another class that bears the same name is no usage', async () => {
  const answer = await usagesAt('src/repositories/BaseRepository.ts', 'protected log(', 'log')
  expect(rowsOf(answer)).toEqual([
    'confirmed src/repositories/HttpOrderRepository.ts:15 this.log(`find ${id}`)',
    'confirmed src/repositories/HttpOrderRepository.ts:21 this.log(order.customer.name)',
  ])
})

test('a component is used by the tags that name it, in either spelling', async () => {
  const answer = await usagesAt(ORDERS_PAGE, '<OrderTable :orders', 'OrderTable')
  expect(rowsOf(answer)).toEqual([
    `confirmed ${ORDERS_PAGE}:26 <OrderTable :orders="orders" @select="onSelect" />`,
    `confirmed ${ORDERS_PAGE}:27 <order-table :orders="storedOrders" />`,
  ])
})

test('the item of a v-for is used in the expressions of its element', async () => {
  const answer = await usagesAt('src/components/OrderTable.vue', '(order, index) in', 'order')
  expect(answer.usages.map(usage => [usage.line, usage.certainty])).toEqual([
    [3, 'confirmed'],
    [3, 'confirmed'],
    [3, 'confirmed'],
  ])
})

test('a module is used by the lines that import it', async () => {
  const answer = await usagesAt(USE_ORDERS, "'@/api/orders'", 'api/orders')
  expect(rowsOf(answer)).toEqual([
    "confirmed src/api/index.ts:1 export { fetchOrder as loadOrder, fetchOrders } from './orders'",
    `confirmed ${USE_ORDERS}:2 import * as api from '@/api/orders'`,
    "confirmed src/repositories/HttpOrderRepository.ts:2 import { ORDERS_ENDPOINT } from '@/api/orders'",
  ])
})

test('a name of a package is confirmed where it is imported from that package', async () => {
  const answer = await usagesAt('src/stores/orderStore.ts', "defineStore('orders'", 'defineStore')
  expect(rowsOf(answer)).toEqual([
    "confirmed src/stores/cartStore.ts:4 export const useCartStore = defineStore('cart', {",
    "confirmed src/stores/orderStore.ts:6 export const useOrderStore = defineStore('orders', () => {",
  ])
})

test('when nothing tells what a member is, every access of that name is listed as unverified', async () => {
  const answer = await usagesAt(ORDERS_PAGE, 'unknownHelper.total', 'total')
  expect(answer.usages.every(usage => usage.certainty === 'unverified')).toBe(true)
  expect(answer.usages.map(usage => `${usage.path}:${usage.line}`)).toEqual([`${USE_ORDERS}:9`, `${ORDERS_PAGE}:17`])
  expect(answer.note).toBe('The declaration of total is not known: every use of that name is listed')
})

test('confirmed usages come first', async () => {
  const certainties = (await usagesAt('src/types/order.ts', 'total: number', 'total')).usages.map(usage => usage.certainty)
  expect(certainties).toEqual([...certainties].sort())
})

test('the search is capped and says when more matches existed', async () => {
  const searchingWorkspace: Workspace = {
    ...workspace,
    search: async (pattern, options) => {
      const matches = await workspace.search(pattern, { ...options, maxMatches: undefined })
      const firstMatch = matches[0]
      return firstMatch === undefined
        ? []
        : Array.from({ length: (options?.maxMatches ?? 0) + 5 }, () => firstMatch).slice(0, options?.maxMatches)
    },
  }
  const answer = await findScriptUsages(
    searchingWorkspace,
    positionIn('src/api/orders.ts', 'async function fetchOrders(', 'fetchOrders'),
  )
  expect(answer.isTruncated).toBe(true)
})

test('a search cut at its limit before reaching any usage says it stopped there, not that there is none', async () => {
  const workspaceFindingTheNameOnlyWhereItIsNotUsed: Workspace = {
    ...workspace,
    search: async (_pattern, options) =>
      Array.from({ length: options?.maxMatches ?? 0 }, (_, index) => ({ path: 'src/types/order.ts', line: 1, column: index, text: '' })),
  }
  const answer = await findScriptUsages(
    workspaceFindingTheNameOnlyWhereItIsNotUsed,
    positionIn('src/api/orders.ts', 'async function fetchOrders(', 'fetchOrders'),
  )
  expect(answer.usages).toEqual([])
  expect(answer.isTruncated).toBe(true)
  expect(answer.note).toBe('No usage of fetchOrders among the first 3000 places fetchOrders is written: the search stopped there.')
})

test('a click on nothing answers no symbol', async () => {
  const answer = await usagesAt(USE_ORDERS, '// fetchOrders is not called here', 'called')
  expect(answer).toEqual({ symbol: null, title: '', usages: [], isTruncated: false, note: null })
})
