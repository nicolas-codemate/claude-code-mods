import { expect, test } from 'claude-code/testing'

import { createMemoryWorkspace } from '../test-workspace'
import { locateExportedName, resolveImportedName } from './export-following'
import type { ImportResolution } from './export-following'
import { offsetOfLocated } from './located'
import { createAnalysisSession, readText } from './session'
import type { AnalysisSession } from './session'

const FILES: Record<string, string> = {
  'src/api/orders.ts': [
    'export function fetchOrder() {}',
    'const client = 1',
    'export { client as httpClient }',
    'export default fetchOrder',
  ].join('\n'),
  'src/api/invoices.ts': 'export const fetchInvoice = () => 1',
  'src/api/index.ts': [
    "export { fetchOrder as loadOrder } from './orders'",
    "export * from './invoices'",
    "export * as orders from './orders'",
    "export * from './loop'",
  ].join('\n'),
  'src/api/loop.ts': "export * from './index'",
  'src/shop.ts': ["import { loadOrder } from './api'", 'export { loadOrder }', 'export default class Shop {}'].join('\n'),
  'src/settings.ts': 'export default { currency: 1 }',
  'src/Cart.vue': '<script setup>\nconst total = 1\n</script>',
  'src/theme.css': '.cart {}',
  'package.json': '{}',
}

function describe(session: AnalysisSession, resolution: ImportResolution): Promise<string> | string {
  if (resolution.kind !== 'located') {
    return resolution.kind === 'package' ? `package ${resolution.packageName}` : 'unresolved'
  }
  const { located } = resolution
  const offset = offsetOfLocated(located)

  return readText(session, located.path).then(
    text => `${located.path}:${offset === null ? 'file' : (text ?? '').slice(0, offset).split('\n').length}`,
  )
}

async function imported(specifier: string, name: string, fromPath = 'src/main.ts'): Promise<string> {
  const session = createAnalysisSession(createMemoryWorkspace(FILES))

  return describe(session, await resolveImportedName(session, fromPath, specifier, name))
}

test('a name is found where its module declares it', async () => {
  expect(await imported('./api/orders', 'fetchOrder')).toBe('src/api/orders.ts:1')
})

test('a renamed export leads to the declaration under its own name', async () => {
  expect(await imported('./api/orders', 'httpClient')).toBe('src/api/orders.ts:2')
  expect(await imported('./api', 'loadOrder')).toBe('src/api/orders.ts:1')
})

test('a star export is followed to the module that declares the name', async () => {
  expect(await imported('./api', 'fetchInvoice')).toBe('src/api/invoices.ts:1')
})

test('a module re-exported under a name is that module', async () => {
  expect(await imported('./api', 'orders')).toBe('src/api/orders.ts:file')
})

test('a name imported then exported again is followed through both files', async () => {
  expect(await imported('./shop', 'loadOrder')).toBe('src/api/orders.ts:1')
})

test('the default export is the declaration it names, the class it declares, or its expression', async () => {
  expect(await imported('./api/orders', 'default')).toBe('src/api/orders.ts:1')
  expect(await imported('./shop', 'default')).toBe('src/shop.ts:3')
  expect(await imported('./settings', 'default')).toBe('src/settings.ts:1')
})

test('the default export of a Vue component and any name of a file that is no script are the file', async () => {
  expect(await imported('./Cart.vue', 'default')).toBe('src/Cart.vue:file')
  expect(await imported('./theme.css', 'default')).toBe('src/theme.css:file')
})

test('star exports that come back to their own file end the search', async () => {
  expect(await imported('./api', 'nowhere')).toBe('src/api/index.ts:file')
  const session = createAnalysisSession(createMemoryWorkspace(FILES))
  expect((await locateExportedName(session, 'src/api/index.ts', 'nowhere')).kind).toBe('unresolved')
})

test('a package that cannot be opened is named, a path that leads nowhere is unresolved', async () => {
  expect(await imported('pinia', 'defineStore')).toBe('package pinia')
  expect(await imported('./missing', 'anything')).toBe('unresolved')
})
