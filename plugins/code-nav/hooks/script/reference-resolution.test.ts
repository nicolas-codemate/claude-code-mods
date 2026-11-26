import { expect, test } from 'claude-code/testing'

import { offsetOfLocated } from './located'
import {
  declarationsExposedWithin,
  membersOf,
  resolveNameAt,
  resolveTopLevelName,
  sourcesOfDestructuredName,
} from './reference-resolution'
import type { ReadingContext, Resolution } from './reference-resolution'
import type { ScriptModel } from './script-model'
import { createAnalysisSession, modelOf } from './session'
import { createShopWorkspace, SHOP_FILES } from './test-project'

async function contextOf(
  path: string,
): Promise<{ context: ReadingContext; model: ScriptModel; tokenIndexOf: (code: string, name: string) => number }> {
  const session = createAnalysisSession(createShopWorkspace())
  const model = await modelOf(session, path)
  if (model === null) {
    throw new Error(`${path} is not in the shop`)
  }
  const text = SHOP_FILES[path] ?? ''

  return {
    model,
    context: { model, structure: model.structure, templateLocalNames: null },
    tokenIndexOf: (code, name) =>
      model.structure.tokens.findIndex(token => token.start === text.indexOf(code) + code.indexOf(name)),
  }
}

function placesOf(resolution: Resolution, files: Record<string, string> = SHOP_FILES): string[] {
  if (resolution.kind !== 'located') {
    return [resolution.kind]
  }

  return resolution.locations.map(located => {
    const offset = offsetOfLocated(located)
    return `${located.path}:${offset === null ? 'file' : (files[located.path] ?? '').slice(0, offset).split('\n').length}`
  })
}

test('a bare name resolves to the binding in scope, an imported one to its declaration', async () => {
  const { context, tokenIndexOf } = await contextOf('src/composables/useOrders.ts')
  const session = createAnalysisSession(createShopWorkspace())
  expect(
    placesOf(await resolveNameAt(session, context, tokenIndexOf('ref<Order[]>(initialOrders)', 'initialOrders'))),
  ).toEqual(['src/composables/useOrders.ts:7'])
  expect(placesOf(await resolveNameAt(session, context, tokenIndexOf('await loadOrder(id)', 'loadOrder')))).toEqual([
    'src/api/orders.ts:6',
  ])
})

test('a member resolves through its receiver: a namespace, an enum, this, a typed property', async () => {
  const session = createAnalysisSession(createShopWorkspace())
  const composable = await contextOf('src/composables/useOrders.ts')
  expect(
    placesOf(await resolveNameAt(session, composable.context, composable.tokenIndexOf('api.fetchOrders()', 'fetchOrders'))),
  ).toEqual(['src/api/orders.ts:10'])
  expect(
    placesOf(await resolveNameAt(session, composable.context, composable.tokenIndexOf('OrderStatus.Draft', 'Draft'))),
  ).toEqual(['src/types/order.ts:2'])
  const repository = await contextOf('src/repositories/HttpOrderRepository.ts')
  expect(
    placesOf(await resolveNameAt(session, repository.context, repository.tokenIndexOf('this.log(`find', 'log'))),
  ).toEqual(['src/repositories/BaseRepository.ts:2'])
  expect(
    placesOf(await resolveNameAt(session, repository.context, repository.tokenIndexOf('this.client.get(', 'get'))),
  ).toEqual(['src/api/http.ts:2'])
})

test('a name that nothing declares is unknown, one a package provides names the package, a built-in is explained', async () => {
  const session = createAnalysisSession(createShopWorkspace())
  const page = await contextOf('src/pages/OrdersPage.vue')
  expect((await resolveNameAt(session, page.context, page.tokenIndexOf('unknownHelper.total', 'unknownHelper'))).kind).toBe(
    'unknown',
  )
  expect((await resolveNameAt(session, page.context, page.tokenIndexOf('unknownHelper.total', 'total'))).kind).toBe(
    'unknown',
  )
  expect(await resolveNameAt(session, page.context, page.tokenIndexOf('storeToRefs(orderStore)', 'storeToRefs'))).toEqual({
    kind: 'package',
    packageName: 'pinia',
  })
  expect((await resolveNameAt(session, page.context, page.tokenIndexOf('console.log', 'console'))).kind).toBe('explained')
})

test('the members of a class are looked up in its parents, those of a module in its exports', async () => {
  const session = createAnalysisSession(createShopWorkspace())
  const cached = await contextOf('src/repositories/CachedOrderRepository.ts')
  const cachedRepository = await resolveTopLevelName(session, cached.model, 'CachedOrderRepository')
  const holder = cachedRepository.kind === 'located' ? cachedRepository.locations[0] : undefined
  const inherited = holder === undefined ? [] : await membersOf(session, holder, 'save')
  expect(placesOf({ kind: 'located', locations: inherited })).toEqual(['src/repositories/HttpOrderRepository.ts:19'])
  const moduleMembers = await membersOf(
    session,
    { path: 'src/api/index.ts', model: null, structure: null, declaration: null, offset: null },
    'fetchInvoice',
  )
  expect(placesOf({ kind: 'located', locations: moduleMembers })).toEqual(['src/api/invoices.ts:1'])
})

test('a destructured name is read from what the call returns', async () => {
  const session = createAnalysisSession(createShopWorkspace())
  const { context, model } = await contextOf('src/pages/OrdersPage.vue')
  const loadOrders = model.structure.fileScope.declarations.find(declaration => declaration.name === 'loadOrders')
  const sources = loadOrders === undefined ? [] : await sourcesOfDestructuredName(session, context, loadOrders)
  expect(placesOf({ kind: 'located', locations: sources })).toEqual(['src/composables/useOrders.ts:11'])
})

test('what a piece of code hands out is a returned local, a key of its options or of a returned literal, nothing written deeper', async () => {
  const linesOfExposed = async (path: string, name: string) => {
    const { model } = await contextOf(path)
    return declarationsExposedWithin(model.structure, 0, model.structure.tokens.length - 1, name).map(
      declaration => model.text.slice(0, model.structure.tokens[declaration.nameTokenIndex]?.start).split('\n').length,
    )
  }
  expect(await linesOfExposed('src/composables/useOrders.ts', 'load')).toEqual([11])
  expect(await linesOfExposed('src/composables/useOrders.ts', 'message')).toEqual([])
  expect(await linesOfExposed('src/stores/cartStore.ts', 'add')).toEqual([10])
  expect(await linesOfExposed('src/stores/cartStore.ts', 'lines')).toEqual([5])
  expect(await linesOfExposed('src/stores/cartStore.ts', 'sku')).toEqual([])
})

test('two constants naming each other end the search instead of looping', async () => {
  const files = { 'src/loop.ts': 'const first = second\nconst second = first\nexport const value = first.total' }
  const session = createAnalysisSession(createShopWorkspace(files))
  const model = await modelOf(session, 'src/loop.ts')
  const tokenIndex = model?.structure.tokens.findIndex(token => token.text === 'total') ?? -1
  const resolution =
    model === null
      ? null
      : await resolveNameAt(session, { model, structure: model.structure, templateLocalNames: null }, tokenIndex)
  expect(resolution?.kind).toBe('unknown')
})
