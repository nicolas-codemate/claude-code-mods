import { expect, test } from 'claude-code/testing'

import type { PaletteItem, SymbolEntry, SymbolKind } from '../types'
import type { PaletteContext } from './palette-search'
import { preparePaletteSource, searchPalette } from './palette-search'

const SHOP_FILES = [
  'README.md',
  'src/Order/Order.php',
  'src/Order/OrderRepository.php',
  'src/Order/OrderStatus.php',
  'src/Invoice/Invoice.php',
  'src/Invoice/InvoiceRepository.php',
  'src/Product/Product.php',
  'src/helpers.php',
  'tests/Order/OrderRepositoryTest.php',
  'tests/fixtures/orders.yaml',
  'storefront/orders.yaml',
  'storefront/src/api/order.service.ts',
  'storefront/src/components/OrderList.vue',
  'storefront/src/composables/useOrder.ts',
]

function declared(kind: SymbolKind, name: string, path: string, line: number, container: string | null = null): SymbolEntry {
  return { kind, name, path, line, container }
}

const SHOP_SYMBOLS: SymbolEntry[] = [
  declared('class', 'Order', 'src/Order/Order.php', 8),
  declared('constant', 'MAXIMUM_LINES', 'src/Order/Order.php', 10, 'Order'),
  declared('method', 'save', 'src/Order/Order.php', 20, 'Order'),
  declared('method', 'total', 'src/Order/Order.php', 30, 'Order'),
  declared('class', 'OrderRepository', 'src/Order/OrderRepository.php', 9),
  declared('method', 'save', 'src/Order/OrderRepository.php', 15, 'OrderRepository'),
  declared('method', 'findPaidOrders', 'src/Order/OrderRepository.php', 25, 'OrderRepository'),
  declared('enum', 'OrderStatus', 'src/Order/OrderStatus.php', 5),
  declared('constant', 'Paid', 'src/Order/OrderStatus.php', 7, 'OrderStatus'),
  declared('class', 'Invoice', 'src/Invoice/Invoice.php', 6),
  declared('method', 'total', 'src/Invoice/Invoice.php', 18, 'Invoice'),
  declared('class', 'InvoiceRepository', 'src/Invoice/InvoiceRepository.php', 7),
  declared('method', 'save', 'src/Invoice/InvoiceRepository.php', 12, 'InvoiceRepository'),
  declared('class', 'Product', 'src/Product/Product.php', 5),
  declared('function', 'orderTotal', 'src/helpers.php', 3),
  declared('function', 'order', 'src/helpers.php', 9),
  declared('class', 'OrderRepositoryTest', 'tests/Order/OrderRepositoryTest.php', 10),
  declared('method', 'testSave', 'tests/Order/OrderRepositoryTest.php', 14, 'OrderRepositoryTest'),
  declared('interface', 'Order', 'storefront/src/api/order.service.ts', 1),
  declared('class', 'OrderService', 'storefront/src/api/order.service.ts', 4),
  declared('method', 'save', 'storefront/src/api/order.service.ts', 9, 'OrderService'),
  declared('function', 'useOrder', 'storefront/src/composables/useOrder.ts', 3),
  declared('constant', 'props', 'storefront/src/components/OrderList.vue', 12),
  declared('function', 'onSelectOrder', 'storefront/src/components/OrderList.vue', 14),
]

const SHOP = preparePaletteSource(SHOP_FILES, SHOP_SYMBOLS)
const NOTHING_OPEN: PaletteContext = { recentPaths: [], currentPath: null }

// A row as one line: what it is, its label with the matched characters between brackets, its detail.
function rowText(item: PaletteItem): string {
  const litLabel = [...item.label]
    .map((character, index) => (item.matchedIndexes.includes(index) ? `[${character}]` : character))
    .join('')
    .replaceAll('][', '')

  return `${item.symbolKind ?? item.kind} ${litLabel} | ${item.detail}`
}

function rowsFor(query: string, context: PaletteContext = NOTHING_OPEN, limit = 20): string[] {
  return searchPalette(query, SHOP, context, limit).map(rowText)
}

test('nothing typed lists the recent files, most recent first, the current one left out', async () => {
  const context = { recentPaths: ['src/Order/Order.php', 'vendor/acme/Money.php', 'src/helpers.php', 'src/Order/Order.php'], currentPath: 'src/helpers.php' }
  expect(rowsFor('', context)).toEqual(['file Order.php | src/Order', 'file Money.php | vendor/acme'])
  expect(rowsFor('   ', context, 1)).toEqual(['file Order.php | src/Order'])
  expect(rowsFor('')).toEqual([])
})

test('a plain query ranks files and symbols in one list, by their names', async () => {
  expect(rowsFor('order')).toEqual([
    'class [Order] | src/Order/Order.php:8',
    'interface [Order] | storefront/src/api/order.service.ts:1',
    'function [order] | src/helpers.php:9',
    'file [order].service.ts | storefront/src/api',
    'enum [Order]Status | src/Order/OrderStatus.php:5',
    'class [Order]Service | storefront/src/api/order.service.ts:4',
    'file [order]s.yaml | storefront',
    'function [order]Total | src/helpers.php:3',
    'class [Order]Repository | src/Order/OrderRepository.php:9',
    'file [Order]List.vue | storefront/src/components',
    'file [order]s.yaml | tests/fixtures',
    'class [Order]RepositoryTest | tests/Order/OrderRepositoryTest.php:10',
    'function use[Order] | storefront/src/composables/useOrder.ts:3',
    'file use[Order].ts | storefront/src/composables',
    'function onSelect[Order] | storefront/src/components/OrderList.vue:14',
    'method OrderRepository::findPaid[Order]s | src/Order/OrderRepository.php:25',
  ])
  expect(rowsFor('OrRe', NOTHING_OPEN, 2)).toEqual([
    'class [Or]der[Re]pository | src/Order/OrderRepository.php:9',
    'class [Or]der[Re]positoryTest | tests/Order/OrderRepositoryTest.php:10',
  ])
  expect(rowsFor('xyz')).toEqual([])
})

test('with equal matches a class-like ranks above a function, a function above a constant', async () => {
  const source = preparePaletteSource(
    ['src/a.ts', 'src/b.ts', 'src/c.ts'],
    [declared('constant', 'total', 'src/a.ts', 1), declared('function', 'total', 'src/b.ts', 1), declared('class', 'total', 'src/c.ts', 1)],
  )
  expect(searchPalette('total', source, NOTHING_OPEN, 10).map(item => item.symbolKind)).toEqual(['class', 'function', 'constant'])
})

test('a file named after a class-like it declares is left to the row of that class-like', async () => {
  expect(rowsFor('product')).toEqual(['class [Product] | src/Product/Product.php:5'])
  expect(rowsFor('helpers')).toEqual(['file [helpers].php | src'])
  expect(rowsFor('Product.php')).toEqual(['file [Product.php] | src/Product'])
  expect(rowsFor('useorder')).toEqual(['function [useOrder] | storefront/src/composables/useOrder.ts:3', 'file [useOrder].ts | storefront/src/composables'])
})

test('a recent file gains places, and so does the class-like standing for it', async () => {
  const context = { recentPaths: ['tests/Order/OrderRepositoryTest.php', 'storefront/src/composables/useOrder.ts'], currentPath: null }
  expect(rowsFor('useorder', context)).toEqual(['file [useOrder].ts | storefront/src/composables', 'function [useOrder] | storefront/src/composables/useOrder.ts:3'])
  expect(rowsFor('orderrepo', context)).toEqual([
    'class [OrderRepo]sitoryTest | tests/Order/OrderRepositoryTest.php:10',
    'class [OrderRepo]sitory | src/Order/OrderRepository.php:9',
  ])
  expect(rowsFor('orderrepo')).toEqual([
    'class [OrderRepo]sitory | src/Order/OrderRepository.php:9',
    'class [OrderRepo]sitoryTest | tests/Order/OrderRepositoryTest.php:10',
  ])
})

test('what lives under tests or fixtures ranks below the same match elsewhere', async () => {
  expect(rowsFor('orders', NOTHING_OPEN, 2)).toEqual(['file [orders].yaml | storefront', 'file [orders].yaml | tests/fixtures'])
})

test('a query with a slash lists files only, each part found in one name along the path, in order', async () => {
  expect(rowsFor('src/ord', NOTHING_OPEN, 3)).toEqual(['file [Ord]er.php | src/Order', 'file [Ord]erList.vue | storefront/src/components', 'file [Ord]erStatus.php | src/Order'])
  expect(rowsFor('ord/rep')).toEqual(['file Order[Rep]ository.php | src/Order', 'file Order[Rep]ositoryTest.php | tests/Order'])
  expect(rowsFor('rep/ord')).toEqual([])
  expect(rowsFor('store/comp/')).toEqual(['file OrderList.vue | storefront/src/components', 'file useOrder.ts | storefront/src/composables'])
  expect(rowsFor('src/inv/')).toEqual(['file Invoice.php | src/Invoice', 'file InvoiceRepository.php | src/Invoice'])
  expect(rowsFor('/')).toEqual([])
})

test('Container::member, Container.member and Container#member list the members of the matching containers', async () => {
  const membersOfOrderNamedSave = [
    'method [Order]::[save] | src/Order/Order.php:20',
    'method [Order]Service::[save] | storefront/src/api/order.service.ts:9',
    'method [Order]Repository::[save] | src/Order/OrderRepository.php:15',
    'method [Order]RepositoryTest::test[Save] | tests/Order/OrderRepositoryTest.php:14',
  ]
  expect(rowsFor('Order::save')).toEqual(membersOfOrderNamedSave)
  expect(rowsFor('Order.save')).toEqual(membersOfOrderNamedSave)
  expect(rowsFor('Order#save')).toEqual(membersOfOrderNamedSave)
  expect(rowsFor('OrRe::sa', NOTHING_OPEN, 1)).toEqual(['method [Or]der[Re]pository::[sa]ve | src/Order/OrderRepository.php:15'])
  expect(rowsFor('Invoice::')).toEqual(['method [Invoice]::total | src/Invoice/Invoice.php:18', 'method [Invoice]Repository::save | src/Invoice/InvoiceRepository.php:12'])
  expect(rowsFor('::total')).toEqual(['method Invoice::[total] | src/Invoice/Invoice.php:18', 'method Order::[total] | src/Order/Order.php:30'])
})

test('a dot also belongs to file names', async () => {
  expect(rowsFor('order.service')).toEqual(['file [order.service].ts | storefront/src/api'])
  expect(rowsFor('.md')).toEqual(['file README[.md] | '])
})

test('several words must all be found, in any order, in the names along a path or in a symbol and its container', async () => {
  const savesOfOrder = [
    'method [Order]::[save] | src/Order/Order.php:20',
    'method [Order]Service::[save] | storefront/src/api/order.service.ts:9',
    'method [Order]Repository::[save] | src/Order/OrderRepository.php:15',
    'method [Order]RepositoryTest::test[Save] | tests/Order/OrderRepositoryTest.php:14',
  ]
  expect(rowsFor('order save')).toEqual(savesOfOrder)
  expect(rowsFor('save  order')).toEqual(savesOfOrder)
  expect(rowsFor('repository invoice')).toEqual(['class [InvoiceRepository] | src/Invoice/InvoiceRepository.php:7'])
  expect(rowsFor('api service')).toEqual(['file order.[service].ts | storefront/src/api'])
  expect(rowsFor('order invoice')).toEqual([])
})

test('a member is listed for several words only when one of them is found in its own name', async () => {
  expect(rowsFor('order repository')).toEqual([
    'class [OrderRepository] | src/Order/OrderRepository.php:9',
    'method [OrderRepository]::findPaidOrders | src/Order/OrderRepository.php:25',
    'class [OrderRepository]Test | tests/Order/OrderRepositoryTest.php:10',
  ])
})

test('words found nowhere as written are matched loosely', async () => {
  expect(rowsFor('OrRe sve', NOTHING_OPEN, 2)).toEqual([
    'method [Or]der[Re]pository::[s]a[ve] | src/Order/OrderRepository.php:15',
    'method [Or]der[Re]positoryTest::test[S]a[ve] | tests/Order/OrderRepositoryTest.php:14',
  ])
  expect(rowsFor('rder epository')).toEqual([
    'class O[rder]R[epository] | src/Order/OrderRepository.php:9',
    'method OrderR[epository]::findPaidO[rder]s | src/Order/OrderRepository.php:25',
    'class O[rder]R[epository]Test | tests/Order/OrderRepositoryTest.php:10',
  ])
})

test('a line number after a name selects files to open on that line, alone the line of the current file', async () => {
  const onLine42 = searchPalette('order:42', SHOP, NOTHING_OPEN, 3)
  expect(onLine42.map(rowText)).toEqual(['file [Order].php | src/Order', 'file [order].service.ts | storefront/src/api', 'file [order]s.yaml | storefront'])
  expect(onLine42.map(item => item.line)).toEqual([42, 42, 42])
  expect(searchPalette('src/inv:7', SHOP, NOTHING_OPEN, 1)).toEqual([
    { kind: 'file', symbolKind: null, label: 'Invoice.php', detail: 'src/Invoice', matchedIndexes: [0, 1, 2], path: 'src/Invoice/Invoice.php', line: 7 },
  ])
  expect(searchPalette(':42', SHOP, { recentPaths: [], currentPath: 'src/Order/Order.php' }, 5)).toEqual([
    { kind: 'line', symbolKind: null, label: 'Order.php:42', detail: 'src/Order', matchedIndexes: [], path: 'src/Order/Order.php', line: 42 },
  ])
  expect(searchPalette(':42', SHOP, NOTHING_OPEN, 5)).toEqual([])
})

test('a row carries what opens it: the path and the line of a symbol, the first line of a file', async () => {
  expect(searchPalette('Order::total', SHOP, NOTHING_OPEN, 1)).toEqual([
    {
      kind: 'symbol',
      symbolKind: 'method',
      label: 'Order::total',
      detail: 'src/Order/Order.php:30',
      matchedIndexes: [0, 1, 2, 3, 4, 7, 8, 9, 10, 11],
      path: 'src/Order/Order.php',
      line: 30,
    },
  ])
  expect(searchPalette('readme', SHOP, NOTHING_OPEN, 1)).toEqual([
    { kind: 'file', symbolKind: null, label: 'README.md', detail: '', matchedIndexes: [0, 1, 2, 3, 4, 5], path: 'README.md', line: 1 },
  ])
  expect(searchPalette('order', SHOP, NOTHING_OPEN, 0)).toEqual([])
})

const CATALOG_WORDS = ['Order', 'Invoice', 'Product', 'Customer', 'Payment', 'Cart', 'Line', 'Item', 'Status', 'Repository', 'Service', 'Test']

// A project large enough for a search to leave candidates out on the ceiling of their score: every pair of words
// names a class with four methods, in a file of its own.
function catalogProject(): { files: string[]; symbols: SymbolEntry[] } {
  const files: string[] = []
  const symbols: SymbolEntry[] = []
  for (const firstWord of CATALOG_WORDS) {
    for (const secondWord of CATALOG_WORDS) {
      const className = `${firstWord}${secondWord}`
      const path = `${secondWord === 'Test' ? 'tests' : 'src'}/${firstWord}/${className}.php`
      files.push(path, `storefront/src/${firstWord.toLowerCase()}/${firstWord.toLowerCase()}-${secondWord.toLowerCase()}.ts`)
      symbols.push(declared('class', className, path, 5))
      for (const [methodIndex, verb] of ['get', 'set', 'find', 'save'].entries()) {
        symbols.push(declared('method', `${verb}${secondWord}`, path, 10 + methodIndex, className))
      }
    }
  }

  return { files, symbols }
}

test('the first rows of a long list are the rows of a short one', async () => {
  const { files, symbols } = catalogProject()
  const source = preparePaletteSource(files, symbols)
  const context = { recentPaths: ['src/Payment/PaymentStatus.php', 'storefront/src/cart/cart-item.ts'], currentPath: null }
  const queries = [
    'o', 'or', 'ord', 'orre', 'OrRe', 'ii', 'inv', 'invoice', 'ps', 'payser', 'e', 'st', 'te', 'ordertest', 'get', 'gt', 'setitem', 'ete', 'tem',
    'order repository', 'pay st', 'get item', 'i s', 'src/or', 'pay/st', 'src/', 'Order::get', 'PaSt::s', '::save', 'cart.', 'cart-item', 'pay-st.ts',
  ]
  for (const query of queries) {
    const everyRow = searchPalette(query, source, context, files.length + symbols.length).map(rowText)
    for (const limit of [1, 5, 30]) {
      const shortList = searchPalette(query, source, context, limit).map(rowText)
      expect(`${query} (${limit}): ${shortList.join(' / ')}`).toBe(`${query} (${limit}): ${everyRow.slice(0, limit).join(' / ')}`)
    }
  }
})
