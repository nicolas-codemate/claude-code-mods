import { expect, test } from 'claude-code/testing'

import { ancestorDirectoriesOf, baseNameOf, baseNameWithoutExtension, directoryOf, joinPath, pathInDirectory } from './paths'

test('a path is cut into its directory and its base name', async () => {
  expect(directoryOf('src/api/orders.ts')).toBe('src/api')
  expect(directoryOf('package.json')).toBe('')
  expect(baseNameOf('src/api/orders.ts')).toBe('orders.ts')
  expect(baseNameWithoutExtension('src/api/orders.graphql.ts')).toBe('orders')
  expect(baseNameWithoutExtension('src/.eslintrc')).toBe('.eslintrc')
})

test('a relative path is joined to a directory, and may not climb above the root', async () => {
  expect(joinPath('src/pages', '../api/./orders')).toBe('src/api/orders')
  expect(joinPath('', './src')).toBe('src')
  expect(joinPath('src', '..')).toBe('')
  expect(joinPath('src', '../../outside')).toBe(null)
})

test('the directories holding a file are listed from the nearest to the root', async () => {
  expect(ancestorDirectoriesOf('shop/src/api/orders.ts')).toEqual(['shop/src/api', 'shop/src', 'shop', ''])
  expect(ancestorDirectoriesOf('main.ts')).toEqual([''])
  expect(pathInDirectory('', 'tsconfig.json')).toBe('tsconfig.json')
  expect(pathInDirectory('shop', 'tsconfig.json')).toBe('shop/tsconfig.json')
})
