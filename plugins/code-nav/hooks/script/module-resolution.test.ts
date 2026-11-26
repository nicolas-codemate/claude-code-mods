import { expect, test } from 'claude-code/testing'

import { createMemoryWorkspace } from '../test-workspace'
import { candidatePathsOf, packageNameOfSpecifier, resolveModuleSpecifier, resolveProjectModule } from './module-resolution'
import { createAnalysisSession } from './session'

function sessionOf(files: Record<string, string>, ignoredPathPrefixes?: string[]) {
  return createAnalysisSession(
    createMemoryWorkspace(files, ignoredPathPrefixes === undefined ? {} : { ignoredPathPrefixes }),
  )
}

const ALIASES = '{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }'

test('a relative specifier finds its file by the usual extensions, then by an index file', async () => {
  const session = sessionOf({
    'src/pages/Orders.vue': '',
    'src/api/orders.ts': '',
    'src/api/index.ts': '',
    'src/types/order.d.ts': '',
    'src/ui/Button.tsx': '',
  })
  expect(await resolveModuleSpecifier(session, 'src/pages/Orders.vue', '../api/orders')).toEqual({
    kind: 'project',
    path: 'src/api/orders.ts',
  })
  expect(await resolveModuleSpecifier(session, 'src/pages/Orders.vue', '../api')).toEqual({
    kind: 'project',
    path: 'src/api/index.ts',
  })
  expect(await resolveModuleSpecifier(session, 'src/pages/Orders.vue', '../types/order')).toEqual({
    kind: 'project',
    path: 'src/types/order.d.ts',
  })
  expect(await resolveModuleSpecifier(session, 'src/api/orders.ts', '../ui/Button')).toEqual({
    kind: 'project',
    path: 'src/ui/Button.tsx',
  })
  expect(await resolveModuleSpecifier(session, 'src/api/orders.ts', './missing')).toEqual({ kind: 'unresolved' })
})

test('a .js specifier stands for the TypeScript file it is compiled from, a query is ignored', async () => {
  const session = sessionOf({ 'src/main.ts': '', 'src/bus.ts': '', 'src/logo.svg': '' })
  expect(await resolveModuleSpecifier(session, 'src/main.ts', './bus.js')).toEqual({ kind: 'project', path: 'src/bus.ts' })
  expect(await resolveModuleSpecifier(session, 'src/main.ts', './logo.svg?url')).toEqual({
    kind: 'project',
    path: 'src/logo.svg',
  })
})

test('an alias is read from the nearest configuration, through the file it extends', async () => {
  const session = sessionOf({
    'shop/tsconfig.json': '{ "extends": "./tsconfig.base.json" }',
    'shop/tsconfig.base.json': ALIASES,
    'shop/src/api/orders.ts': '',
    'shop/src/pages/Orders.vue': '',
  })
  expect(await resolveModuleSpecifier(session, 'shop/src/pages/Orders.vue', '@/api/orders')).toEqual({
    kind: 'project',
    path: 'shop/src/api/orders.ts',
  })
})

test('an alias declared by a referenced configuration is found, as a Vite project lays them out', async () => {
  const session = sessionOf({
    'tsconfig.json': '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }',
    'tsconfig.app.json': ALIASES,
    'src/api/orders.ts': '',
    'src/main.ts': '',
  })
  expect(await resolveModuleSpecifier(session, 'src/main.ts', '@/api/orders')).toEqual({
    kind: 'project',
    path: 'src/api/orders.ts',
  })
})

test('a bare specifier may be a path under baseUrl', async () => {
  const session = sessionOf({
    'jsconfig.json': '{ "compilerOptions": { "baseUrl": "src" } }',
    'src/api/orders.js': '',
    'src/main.js': '',
  })
  expect(await resolveModuleSpecifier(session, 'src/main.js', 'api/orders')).toEqual({
    kind: 'project',
    path: 'src/api/orders.js',
  })
})

test('without any configuration "@/" still names the sources folder', async () => {
  const session = sessionOf({ 'web/package.json': '{}', 'web/src/api/orders.ts': '', 'web/src/pages/Orders.vue': '' })
  expect(await resolveModuleSpecifier(session, 'web/src/pages/Orders.vue', '@/api/orders')).toEqual({
    kind: 'project',
    path: 'web/src/api/orders.ts',
  })
})

test('an aliased path that leads to no file is unresolved, never taken for a package', async () => {
  const session = sessionOf({ 'tsconfig.json': ALIASES, 'src/main.ts': '' })
  expect(await resolveModuleSpecifier(session, 'src/main.ts', '@/api/missing')).toEqual({ kind: 'unresolved' })
})

test('a generated file git ignores is found by reading it', async () => {
  const session = sessionOf(
    { 'tsconfig.json': ALIASES, 'src/main.ts': '', 'src/generated/index.ts': 'export const schema = 1' },
    ['src/generated/', 'node_modules/'],
  )
  expect(await resolveModuleSpecifier(session, 'src/main.ts', '@/generated')).toEqual({
    kind: 'project',
    path: 'src/generated/index.ts',
  })
  expect(await resolveProjectModule(session, 'src/main.ts', './generated')).toBe(null)
})

test('a package is located under the nearest node_modules by the entry its manifest names', async () => {
  const session = sessionOf({
    'web/package.json': '{}',
    'web/src/main.ts': '',
    'web/node_modules/vue/package.json': '{ "types": "dist/vue.d.ts", "main": "index.js" }',
    'web/node_modules/vue/dist/vue.d.ts': '',
    'web/node_modules/lodash/package.json': '{ "main": "lodash.js" }',
    'web/node_modules/lodash/lodash.js': '',
    'web/node_modules/lodash/debounce.js': '',
    'web/node_modules/@types/lodash/package.json': '{ "types": "index.d.ts" }',
    'web/node_modules/@types/lodash/index.d.ts': '',
    'web/node_modules/@shop/ui/package.json': '{ "module": "./dist/index.mjs" }',
    'web/node_modules/@shop/ui/dist/index.mjs': '',
  })
  expect(await resolveModuleSpecifier(session, 'web/src/main.ts', 'vue')).toEqual({
    kind: 'dependency',
    packageName: 'vue',
    path: 'web/node_modules/vue/dist/vue.d.ts',
  })
  expect(await resolveModuleSpecifier(session, 'web/src/main.ts', 'lodash')).toEqual({
    kind: 'dependency',
    packageName: 'lodash',
    path: 'web/node_modules/@types/lodash/index.d.ts',
  })
  expect(await resolveModuleSpecifier(session, 'web/src/main.ts', 'lodash/debounce')).toEqual({
    kind: 'dependency',
    packageName: 'lodash',
    path: 'web/node_modules/lodash/debounce.js',
  })
  expect(await resolveModuleSpecifier(session, 'web/src/main.ts', '@shop/ui')).toEqual({
    kind: 'dependency',
    packageName: '@shop/ui',
    path: 'web/node_modules/@shop/ui/dist/index.mjs',
  })
})

test('a package that is not installed is still named', async () => {
  const session = sessionOf({ 'package.json': '{}', 'src/main.ts': '' })
  expect(await resolveModuleSpecifier(session, 'src/main.ts', '@vueuse/core')).toEqual({
    kind: 'dependency',
    packageName: '@vueuse/core',
    path: null,
  })
  expect(await resolveModuleSpecifier(session, 'src/main.ts', 'node:fs')).toEqual({
    kind: 'dependency',
    packageName: 'node:fs',
    path: null,
  })
})

test('a file of a dependency sees its own package first, then the packages beside it', async () => {
  const session = sessionOf({
    'package.json': '{}',
    'node_modules/vue/package.json': '{ "types": "dist/vue.d.ts" }',
    'node_modules/vue/dist/vue.d.ts': '',
    'node_modules/vue/dist/shared.d.ts': '',
    'node_modules/@vue/runtime/package.json': '{ "types": "index.d.ts" }',
    'node_modules/@vue/runtime/index.d.ts': '',
  })
  expect(await resolveModuleSpecifier(session, 'node_modules/vue/dist/vue.d.ts', './shared')).toEqual({
    kind: 'dependency',
    packageName: 'vue',
    path: 'node_modules/vue/dist/shared.d.ts',
  })
  expect(await resolveModuleSpecifier(session, 'node_modules/vue/dist/vue.d.ts', '@vue/runtime')).toEqual({
    kind: 'dependency',
    packageName: '@vue/runtime',
    path: 'node_modules/@vue/runtime/index.d.ts',
  })
})

test('the name of a package is the first part of a specifier, two parts under a scope', async () => {
  expect(packageNameOfSpecifier('lodash/debounce')).toBe('lodash')
  expect(packageNameOfSpecifier('@vueuse/core/index')).toBe('@vueuse/core')
  expect(candidatePathsOf('src/bus.js').slice(0, 3)).toEqual(['src/bus.js', 'src/bus.ts', 'src/bus.tsx'])
})
