import { expect, test } from 'claude-code/testing'

import { parseJsonWithComments, pathsOfAliasedSpecifier, readAliasConfiguration } from './path-aliases'

test('a configuration file is read with its comments and trailing commas', async () => {
  const text = [
    '{',
    '  // line comment',
    '  "extends": "./base.json", /* block */',
    '  "note": "a // b",',
    '  "list": [1, 2,],',
    '}',
  ].join('\n')
  expect(parseJsonWithComments(text)).toEqual({ extends: './base.json', note: 'a // b', list: [1, 2] })
  expect(parseJsonWithComments('{ broken')).toBe(null)
})

test('the paths of compilerOptions are read from the project root, relative to baseUrl', async () => {
  const configuration = readAliasConfiguration(
    '{ "compilerOptions": { "baseUrl": "./src", "paths": { "@/*": ["./*"], "@shop/ui": ["../packages/ui/index.ts"], "#types/*": ["types/*.d.ts"] } } }',
    'shop/tsconfig.json',
  )
  expect(configuration.baseDirectory).toBe('shop/src')
  expect(configuration.aliases).toEqual([
    { prefix: '@shop/ui', suffix: '', hasWildcard: false, targets: ['shop/packages/ui/index.ts'] },
    { prefix: '#types/', suffix: '', hasWildcard: true, targets: ['shop/src/types/*.d.ts'] },
    { prefix: '@/', suffix: '', hasWildcard: true, targets: ['shop/src/*'] },
  ])
})

test('without baseUrl the paths are relative to the configuration file', async () => {
  const configuration = readAliasConfiguration('{ "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }', 'tsconfig.json')
  expect(configuration.baseDirectory).toBe(null)
  expect(configuration.aliases[0]?.targets).toEqual(['src/*'])
})

test('the configuration it extends by a relative path and the ones it references are named', async () => {
  const configuration = readAliasConfiguration(
    '{ "extends": "../tsconfig.base", "references": [{ "path": "./tsconfig.app.json" }, { "path": "./packages/ui" }] }',
    'shop/tsconfig.json',
  )
  expect(configuration.extendedPath).toBe('tsconfig.base.json')
  expect(configuration.referencedPaths).toEqual(['shop/tsconfig.app.json', 'shop/packages/ui/tsconfig.json'])
  expect(readAliasConfiguration('{ "extends": "@vue/tsconfig/tsconfig.json" }', 'tsconfig.json').extendedPath).toBe(null)
})

test('a specifier gives the paths its aliases map it to, the most specific alias first', async () => {
  const { aliases } = readAliasConfiguration(
    '{ "compilerOptions": { "paths": { "@/*": ["./src/*"], "@/api/*": ["./generated/*", "./src/api/*"], "~shop": ["./index.ts"] } } }',
    'tsconfig.json',
  )
  expect(pathsOfAliasedSpecifier('@/api/orders', aliases)).toEqual(['generated/orders', 'src/api/orders', 'src/api/orders'])
  expect(pathsOfAliasedSpecifier('~shop', aliases)).toEqual(['index.ts'])
  expect(pathsOfAliasedSpecifier('vue', aliases)).toEqual([])
})
