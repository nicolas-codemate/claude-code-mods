import { expect, test } from 'claude-code/testing'

import type { DefinitionAnswer } from '../../types'
import { resolveScriptDefinition } from './definition'
import { createShopWorkspace, lineOf, positionIn, SHOP_FILES } from './test-project'

const workspace = createShopWorkspace()

function definitionAt(path: string, code: string, name: string = code): Promise<DefinitionAnswer> {
  return resolveScriptDefinition(workspace, positionIn(path, code, name))
}

function placesOf(answer: DefinitionAnswer): string[] {
  return answer.targets.map(target => `${target.certainty} ${target.path}:${target.line} ${target.label}`)
}

const USE_ORDERS = 'src/composables/useOrders.ts'
const HTTP_REPOSITORY = 'src/repositories/HttpOrderRepository.ts'
const ORDERS_PAGE = 'src/pages/OrdersPage.vue'
const ORDER_TABLE = 'src/components/OrderTable.vue'

test('a click on the name of a declaration says so and goes nowhere', async () => {
  for (const [path, code, name] of [
    ['src/api/orders.ts', 'async function fetchOrder(', 'fetchOrder'],
    ['src/api/http.ts', 'class HttpClient', 'HttpClient'],
    ['src/types/order.ts', 'interface Order {', 'Order'],
    ['src/types/order.ts', 'type OrderLine', 'OrderLine'],
    ['src/types/order.ts', 'enum OrderStatus', 'OrderStatus'],
    ['src/api/orders.ts', 'const ORDERS_ENDPOINT', 'ORDERS_ENDPOINT'],
    [HTTP_REPOSITORY, 'private savedCount', 'savedCount'],
    [HTTP_REPOSITORY, 'async find(id', 'find'],
    [USE_ORDERS, 'customer: buyer }', 'buyer'],
  ] as const) {
    const answer = await definitionAt(path, code, name)
    expect([name, answer.isOnDeclaration, answer.targets.length, answer.symbol?.name]).toEqual([name, true, 0, name])
  }
})

test('the name of an import is no declaration: it goes to what it imports', async () => {
  const answer = await definitionAt(USE_ORDERS, "import { loadOrder } from '@/api'", 'loadOrder')
  expect(answer.isOnDeclaration).toBe(false)
  expect(placesOf(answer)).toEqual([
    `exact src/api/orders.ts:${lineOf('src/api/orders.ts', 'export async function fetchOrder')} fetchOrder`,
  ])
})

test('a parameter and a local constant are found in the scope around the click, before the top level', async () => {
  const parameter = await definitionAt(USE_ORDERS, 'sum + order.total', 'order')
  expect(placesOf(parameter)).toEqual([`exact ${USE_ORDERS}:${lineOf(USE_ORDERS, '(sum, order)')} order`])
  expect(parameter.symbol?.description).toBe('parameter order')
  const local = await definitionAt(USE_ORDERS, 'return { orders, total, load, reload }', 'total')
  expect(placesOf(local)).toEqual([`exact ${USE_ORDERS}:${lineOf(USE_ORDERS, 'const total = computed')} useOrders.total`])
})

test('a destructured name is found where the pattern declares it', async () => {
  const answer = await definitionAt(USE_ORDERS, 'status ?? OrderStatus.Draft', 'status')
  expect(placesOf(answer)).toEqual([`exact ${USE_ORDERS}:${lineOf(USE_ORDERS, 'const { status, customer: buyer }')} status`])
})

test('a name of the top level of the file is found from inside a function', async () => {
  const answer = await definitionAt('src/utils/format.ts', '${rounded} ${CURRENCY}', 'CURRENCY')
  expect(placesOf(answer)).toEqual(['exact src/utils/format.ts:1 CURRENCY'])
  expect(answer.targets[0]?.preview).toBe("const CURRENCY = 'EUR'")
  expect(answer.targets[0]?.column).toBe(6)
})

test('an imported name goes to its declaration through the alias of the configuration', async () => {
  const answer = await definitionAt(USE_ORDERS, 'ref<Order[]>(initialOrders)', 'Order')
  expect(placesOf(answer)).toEqual([
    `exact src/types/order.ts:${lineOf('src/types/order.ts', 'export interface Order {')} Order`,
  ])
  expect(answer.symbol?.description).toBe('imported name Order')
})

test('a renamed re-export through an index file is followed to the real declaration', async () => {
  const answer = await definitionAt(USE_ORDERS, 'await loadOrder(id)', 'loadOrder')
  expect(placesOf(answer)).toEqual([
    `exact src/api/orders.ts:${lineOf('src/api/orders.ts', 'export async function fetchOrder')} fetchOrder`,
  ])
})

test('a star re-export through an index file is followed too', async () => {
  const files = { ...SHOP_FILES, 'src/billing.ts': "import { fetchInvoice } from '@/api'\nfetchInvoice('7')" }
  const answer = await resolveScriptDefinition(
    createShopWorkspace(files),
    positionIn('src/billing.ts', "fetchInvoice('7')", 'fetchInvoice', files),
  )
  expect(placesOf(answer)).toEqual(['exact src/api/invoices.ts:1 fetchInvoice'])
})

test('a member of a namespace import goes to that name in the module, the namespace itself to the module', async () => {
  const member = await definitionAt(USE_ORDERS, 'await api.fetchOrders()', 'fetchOrders')
  expect(placesOf(member)).toEqual([
    `exact src/api/orders.ts:${lineOf('src/api/orders.ts', 'export async function fetchOrders')} fetchOrders`,
  ])
  const namespace = await definitionAt(USE_ORDERS, 'await api.fetchOrders()', 'api')
  expect(placesOf(namespace)).toEqual(['exact src/api/orders.ts:1 orders.ts'])
})

test('a default import of a component goes to its file', async () => {
  const answer = await definitionAt(ORDER_TABLE, "import OrderRow from './OrderRow.vue'", 'OrderRow')
  expect(placesOf(answer)).toEqual(['exact src/components/OrderRow.vue:1 OrderRow'])
})

test('a click on a module specifier opens that file at its first line', async () => {
  const answer = await definitionAt(USE_ORDERS, "'@/api/orders'", 'api/orders')
  expect(placesOf(answer)).toEqual(['exact src/api/orders.ts:1 orders.ts'])
  expect(answer.symbol?.description).toBe('module @/api/orders')
  expect(answer.targets[0]?.preview).toBe("import type { Order } from '@/types/order'")
})

test('a name required by a CommonJS file, with a .js specifier, goes to the TypeScript declaration', async () => {
  const answer = await definitionAt('src/legacy/report.js', 'return formatPrice(amount)', 'formatPrice')
  expect(placesOf(answer)).toEqual([
    `exact src/utils/format.ts:${lineOf('src/utils/format.ts', 'export function formatPrice')} formatPrice`,
  ])
})

test('a name of an installed package goes to its declaration there, flagged as a dependency', async () => {
  const answer = await definitionAt(USE_ORDERS, 'ref<Order[]>(initialOrders)', 'ref')
  expect(placesOf(answer)).toEqual(['exact node_modules/vue/dist/vue.d.ts:1 ref'])
  expect(answer.targets[0]?.isDependency).toBe(true)
})

test('a name of a package that cannot be opened answers a note naming the package', async () => {
  const answer = await definitionAt('src/stores/orderStore.ts', "defineStore('orders'", 'defineStore')
  expect(answer.targets).toEqual([])
  expect(answer.note).toBe('defineStore comes from the package pinia')
})

test('this.member goes to the member of the class, then to that of its parents', async () => {
  const own = await definitionAt(HTTP_REPOSITORY, 'this.savedCount += 1', 'savedCount')
  expect(placesOf(own)).toEqual([
    `exact ${HTTP_REPOSITORY}:${lineOf(HTTP_REPOSITORY, 'private savedCount')} HttpOrderRepository.savedCount`,
  ])
  const inherited = await definitionAt(HTTP_REPOSITORY, 'this.log(`find', 'log')
  expect(placesOf(inherited)).toEqual(['exact src/repositories/BaseRepository.ts:2 BaseRepository.log'])
  const constructorProperty = await definitionAt(HTTP_REPOSITORY, 'await this.client.get', 'client')
  expect(placesOf(constructorProperty)).toEqual([
    `exact ${HTTP_REPOSITORY}:${lineOf(HTTP_REPOSITORY, 'constructor(private')} HttpOrderRepository.client`,
  ])
})

test('super.member goes to the member of the parent class', async () => {
  const answer = await definitionAt('src/repositories/CachedOrderRepository.ts', 'super.find(id)', 'find')
  expect(placesOf(answer)).toEqual([
    `exact ${HTTP_REPOSITORY}:${lineOf(HTTP_REPOSITORY, 'async find(id')} HttpOrderRepository.find`,
  ])
})

test('this.member in the options of a store goes to its state and to its actions', async () => {
  const state = await definitionAt('src/stores/cartStore.ts', 'this.lines.push(line)', 'lines')
  expect(placesOf(state)).toEqual([
    `exact src/stores/cartStore.ts:${lineOf('src/stores/cartStore.ts', 'state: ()')} useCartStore.lines`,
  ])
  const action = await definitionAt('src/stores/cartStore.ts', 'this.add({', 'add')
  expect(placesOf(action)).toEqual([
    `exact src/stores/cartStore.ts:${lineOf('src/stores/cartStore.ts', 'add(line: OrderLine)')} useCartStore.add`,
  ])
})

test('Name.member goes to the member of an imported enum', async () => {
  const answer = await definitionAt(USE_ORDERS, 'OrderStatus.Draft', 'Draft')
  expect(placesOf(answer)).toEqual(['exact src/types/order.ts:2 OrderStatus.Draft'])
  expect(answer.symbol?.description).toBe('member Draft of OrderStatus')
})

test('Name.member goes to the key of a local object literal and to the static member of a class', async () => {
  const files = {
    ...SHOP_FILES,
    'src/settings.ts': [
      'const SETTINGS = { currency: 1, tax: { rate: 2 } }',
      'class Shop { static open = true }',
      'export const view = [SETTINGS.tax.rate, Shop.open]',
    ].join('\n'),
  }
  const shopWorkspace = createShopWorkspace(files)
  const nestedKey = await resolveScriptDefinition(
    shopWorkspace,
    positionIn('src/settings.ts', 'SETTINGS.tax.rate', 'rate', files),
  )
  expect(placesOf(nestedKey)).toEqual(['exact src/settings.ts:1 SETTINGS.rate'])
  const staticMember = await resolveScriptDefinition(
    shopWorkspace,
    positionIn('src/settings.ts', 'Shop.open', 'open', files),
  )
  expect(placesOf(staticMember)).toEqual(['exact src/settings.ts:2 Shop.open'])
})

test('Name.member goes to the declaration of a TypeScript namespace', async () => {
  const files = {
    ...SHOP_FILES,
    'src/money.ts': [
      'export namespace Money {',
      '  export function round(amount: number) {',
      '    return amount',
      '  }',
      '}',
    ].join('\n'),
    'src/checkout.ts': "import { Money } from './money'\nexport const total = Money.round(12.5)",
  }
  const answer = await resolveScriptDefinition(
    createShopWorkspace(files),
    positionIn('src/checkout.ts', 'Money.round', 'round', files),
  )
  expect(placesOf(answer)).toEqual(['exact src/money.ts:2 round'])
})

test('a component written with options resolves this and its template against its data and its methods', async () => {
  const files = {
    ...SHOP_FILES,
    'src/components/CartCounter.vue': [
      '<template>',
      '  <button @click="increment">{{ count }}</button>',
      '</template>',
      '<script>',
      'export default {',
      '  data() {',
      '    return { count: 0 }',
      '  },',
      '  methods: {',
      '    increment() {',
      '      this.count += 1',
      '    },',
      '  },',
      '}',
      '</script>',
    ].join('\n'),
  }
  const shopWorkspace = createShopWorkspace(files)
  const path = 'src/components/CartCounter.vue'
  const fromThis = await resolveScriptDefinition(shopWorkspace, positionIn(path, 'this.count += 1', 'count', files))
  expect(fromThis.targets.map(target => `${target.certainty} ${target.line} ${target.preview}`)).toEqual([
    'exact 7 return { count: 0 }',
  ])
  const interpolation = await resolveScriptDefinition(shopWorkspace, positionIn(path, '{{ count }}', 'count', files))
  expect(interpolation.targets.map(target => target.line)).toEqual([7])
  const handler = await resolveScriptDefinition(shopWorkspace, positionIn(path, '@click="increment"', 'increment', files))
  expect(handler.targets.map(target => target.line)).toEqual([10])
})

test('a member of a value whose declared type is known goes to that type, through its own members', async () => {
  const answer = await definitionAt(HTTP_REPOSITORY, 'this.log(order.customer.name)', 'name')
  expect(placesOf(answer)).toEqual(['exact src/types/order.ts:7 Customer.name'])
  const throughProperty = await definitionAt(HTTP_REPOSITORY, 'await this.client.get', 'get')
  expect(placesOf(throughProperty)).toEqual(['exact src/api/http.ts:2 HttpClient.get'])
})

test('a member of what a store or a composable returns goes to its declaration there', async () => {
  const setupStore = await definitionAt(ORDERS_PAGE, 'orderStore.load()', 'load')
  expect(placesOf(setupStore)).toEqual([
    `exact src/stores/orderStore.ts:${lineOf('src/stores/orderStore.ts', 'async function load')} useOrderStore.load`,
  ])
  const optionsStoreAction = await definitionAt(ORDERS_PAGE, 'cartStore.add(line)', 'add')
  expect(placesOf(optionsStoreAction)).toEqual([
    `exact src/stores/cartStore.ts:${lineOf('src/stores/cartStore.ts', 'add(line: OrderLine)')} useCartStore.add`,
  ])
  const optionsStoreGetter = await definitionAt(ORDERS_PAGE, 'cartStore.count', 'count')
  expect(placesOf(optionsStoreGetter)).toEqual([
    `exact src/stores/cartStore.ts:${lineOf('src/stores/cartStore.ts', 'count: state')} useCartStore.count`,
  ])
})

test('the key of a renamed destructured name goes to what the call returns', async () => {
  const fromComposable = await definitionAt(ORDERS_PAGE, 'load: loadOrders }', 'load')
  expect(placesOf(fromComposable)).toEqual([
    `exact ${USE_ORDERS}:${lineOf(USE_ORDERS, 'async function load')} useOrders.load`,
  ])
  const throughStoreToRefs = await definitionAt(ORDERS_PAGE, 'orders: storedOrders }', 'orders')
  expect(placesOf(throughStoreToRefs)).toEqual([
    `exact src/stores/orderStore.ts:${lineOf('src/stores/orderStore.ts', 'const orders = ref')} useOrderStore.orders`,
  ])
  const throughReturnType = await definitionAt(USE_ORDERS, 'customer: buyer } =', 'customer')
  expect(placesOf(throughReturnType)).toEqual([
    `exact src/types/order.ts:${lineOf('src/types/order.ts', 'customer: Customer')} Order.customer`,
  ])
})

test('a member of a value of unknown type lists every declaration of that name as candidates, imported files first', async () => {
  const answer = await definitionAt(ORDERS_PAGE, 'unknownHelper.total', 'total')
  expect(placesOf(answer)).toEqual([
    `candidate ${USE_ORDERS}:${lineOf(USE_ORDERS, 'const total = computed')} useOrders.total`,
    `candidate src/types/order.ts:${lineOf('src/types/order.ts', 'total: number')} Order.total`,
  ])
  expect(answer.symbol?.description).toBe('member total of unknownHelper')
})

test('candidates of the same directory come before the rest of the project', async () => {
  const files = {
    ...SHOP_FILES,
    'src/far/away.ts': 'export interface Far { weight: number }',
    'src/near/model.ts': 'export interface Near { weight: number }',
    'src/near/page.ts': 'export const heavy = parcel.weight > 3',
  }
  const answer = await resolveScriptDefinition(
    createShopWorkspace(files),
    positionIn('src/near/page.ts', 'parcel.weight', 'weight', files),
  )
  expect(placesOf(answer)).toEqual(['candidate src/near/model.ts:1 Near.weight', 'candidate src/far/away.ts:1 Far.weight'])
})

test('a name declared nowhere in the project says so', async () => {
  const answer = await definitionAt(ORDERS_PAGE, 'unknownHelper.total', 'unknownHelper')
  expect(answer.targets).toEqual([])
  expect(answer.note).toBe('No declaration of unknownHelper was found in the project')
})

test('a member of a value made by a dependency names the package instead of listing candidates', async () => {
  const answer = await definitionAt(USE_ORDERS, 'orders.value = await api.fetchOrders()', 'value')
  expect(answer.targets).toEqual([])
  expect(answer.note).toBe('value comes from the package vue')
})

test('a built-in of the language answers a note', async () => {
  const global = await definitionAt('src/utils/format.ts', 'Math.round(amount', 'Math')
  expect(global.note).toBe('Math is a JavaScript built-in')
  const member = await definitionAt('src/repositories/MemoryOrderRepository.ts', 'this.orders.push(order)', 'push')
  expect(member.note).toBe('push is a JavaScript built-in member')
})

test('a component tag of a template goes to the component the script imports, in either spelling', async () => {
  const pascalCase = await definitionAt(ORDERS_PAGE, '<OrderTable :orders', 'OrderTable')
  expect(placesOf(pascalCase)).toEqual(['exact src/components/OrderTable.vue:1 OrderTable'])
  expect(pascalCase.symbol?.description).toBe('component OrderTable')
  const kebabCase = await definitionAt(ORDERS_PAGE, '<order-table', 'order-table')
  expect(placesOf(kebabCase)).toEqual(['exact src/components/OrderTable.vue:1 OrderTable'])
})

test('a component tag the script does not import lists the component files of that name', async () => {
  const answer = await definitionAt(ORDERS_PAGE, '<GlobalBanner />', 'GlobalBanner')
  expect(placesOf(answer)).toEqual(['candidate src/components/GlobalBanner.vue:1 GlobalBanner'])
})

test('a plain HTML tag is no symbol', async () => {
  const answer = await definitionAt(ORDERS_PAGE, '<p class="total">', 'p')
  expect(answer.symbol).toBe(null)
})

test('a name of a template goes to the declaration of the script block, at its line in the whole file', async () => {
  const boundProp = await definitionAt(ORDERS_PAGE, ':orders="orders"', '"orders')
  expect(placesOf(boundProp)).toEqual([`exact ${ORDERS_PAGE}:${lineOf(ORDERS_PAGE, 'const { orders, total')} orders`])
  const handler = await definitionAt(ORDERS_PAGE, '@select="onSelect"', 'onSelect')
  expect(placesOf(handler)).toEqual([`exact ${ORDERS_PAGE}:${lineOf(ORDERS_PAGE, 'function onSelect')} onSelect`])
  const interpolation = await definitionAt(ORDERS_PAGE, '{{ total }}', 'total')
  expect(placesOf(interpolation)).toEqual([`exact ${ORDERS_PAGE}:${lineOf(ORDERS_PAGE, 'const { orders, total')} total`])
})

test('a function called in a template goes through the import of the script block', async () => {
  const answer = await definitionAt('src/components/OrderRow.vue', '{{ formatPrice(', 'formatPrice')
  expect(placesOf(answer)).toEqual([
    `exact src/utils/format.ts:${lineOf('src/utils/format.ts', 'export function formatPrice')} formatPrice`,
  ])
})

test('a name of a template goes to the prop that defineProps declares', async () => {
  const propOfTheList = await definitionAt(ORDER_TABLE, 'in orders"', 'orders')
  expect(placesOf(propOfTheList)).toEqual([`exact ${ORDER_TABLE}:${lineOf(ORDER_TABLE, 'defineProps<')} orders`])
  const memberOfProps = await definitionAt('src/components/OrderRow.vue', '{{ props.order.id }}', 'order')
  expect(placesOf(memberOfProps)).toEqual([
    `exact src/components/OrderRow.vue:${lineOf('src/components/OrderRow.vue', 'defineProps<')} props.order`,
  ])
  const throughThePropType = await definitionAt('src/components/OrderRow.vue', '{{ props.order.id }}', 'id')
  expect(placesOf(throughThePropType)).toEqual([
    `exact src/types/order.ts:${lineOf('src/types/order.ts', 'id: string')} Order.id`,
  ])
})

test('the item of a v-for goes to where the directive declares it, and is a declaration there', async () => {
  const usage = await definitionAt(ORDER_TABLE, ':key="order.id"', 'order')
  expect(placesOf(usage)).toEqual([`exact ${ORDER_TABLE}:3 order`])
  expect(usage.targets[0]?.column).toBe(SHOP_FILES[ORDER_TABLE]?.split('\n')[2]?.indexOf('order, index'))
  const declaration = await definitionAt(ORDER_TABLE, '(order, index) in', 'order')
  expect(declaration.isOnDeclaration).toBe(true)
})

test('defineProps and the names Vue provides to a template answer a note', async () => {
  const macro = await definitionAt(ORDER_TABLE, 'defineProps<{ orders', 'defineProps')
  expect(macro.note).toBe('defineProps is a Vue compiler macro')
  const provided = await definitionAt(ORDER_TABLE, "$t('orders.count')", '$t')
  expect(provided.note).toBe('$t is provided by Vue or by one of its plugins')
})

test('a click in a comment, in a string that names no module or on a keyword answers no symbol', async () => {
  for (const [path, code, name] of [
    [USE_ORDERS, '// fetchOrders is not called here', 'fetchOrders'],
    [USE_ORDERS, "'fetchOrders failed'", 'fetchOrders'],
    [ORDERS_PAGE, '<!-- OrderTable lists the orders -->', 'OrderTable'],
    ['src/utils/format.ts', '/^\\d+ "EUR"$/', 'EUR'],
    [USE_ORDERS, 'return { orders, total, load, reload }', 'return'],
    [USE_ORDERS, 'const message', 'const'],
  ] as const) {
    const answer = await definitionAt(path, code, name)
    expect([name, answer.symbol, answer.targets.length]).toEqual([name, null, 0])
  }
})

test('the key of an object literal and the parameter of a signature are declarations, whatever name is in scope', async () => {
  const key = await definitionAt(USE_ORDERS, 'return { id, total: 0', 'total')
  expect(key.isOnDeclaration).toBe(true)
  const signatureParameter = await definitionAt('src/repositories/OrderRepository.ts', 'save(order: Order): void', 'order')
  expect(signatureParameter.isOnDeclaration).toBe(true)
})

test('the symbol read under the click covers the whole name on its line', async () => {
  const answer = await definitionAt(USE_ORDERS, 'await loadOrder(id)', 'loadOrder')
  const lineText = SHOP_FILES[USE_ORDERS]?.split('\n')[(answer.symbol?.line ?? 1) - 1] ?? ''
  expect(lineText.slice(answer.symbol?.startColumn, answer.symbol?.endColumn)).toBe('loadOrder')
})

test('a file that cannot be read or a position outside it answers no symbol', async () => {
  expect((await resolveScriptDefinition(workspace, { path: 'src/missing.ts', line: 1, column: 0 })).symbol).toBe(null)
  expect((await resolveScriptDefinition(workspace, { path: USE_ORDERS, line: 999, column: 0 })).symbol).toBe(null)
})
