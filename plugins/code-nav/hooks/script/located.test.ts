import { expect, test } from 'claude-code/testing'

import {
  isDependencyPath,
  isSamePlace,
  keyOfLocated,
  locatedDeclaration,
  locatedFile,
  locatedOffset,
  offsetOfLocated,
  withoutDuplicates,
} from './located'
import { buildScriptModel } from './script-model'

const model = buildScriptModel('src/orders.ts', 'const first = 1\nconst second = 2')
const [first, second] = model.structure.fileScope.declarations

test('a declaration is located at its name, a file at nothing', async () => {
  const located = first === undefined ? locatedFile('src/orders.ts') : locatedDeclaration(model, model.structure, first)
  expect(offsetOfLocated(located)).toBe(6)
  expect(offsetOfLocated(locatedFile('src/orders.ts'))).toBe(null)
  expect(offsetOfLocated(locatedOffset(model, 22))).toBe(22)
})

test('two places are the same when they share their file and their offset', async () => {
  const secondPlace =
    second === undefined ? locatedFile('src/orders.ts') : locatedDeclaration(model, model.structure, second)
  expect(isSamePlace(secondPlace, locatedOffset(model, 22))).toBe(true)
  expect(isSamePlace(secondPlace, locatedOffset(model, 6))).toBe(false)
  expect(isSamePlace(locatedFile('src/orders.ts'), locatedFile('src/invoices.ts'))).toBe(false)
  expect(keyOfLocated(locatedFile('src/orders.ts'))).toBe('src/orders.ts:file')
})

test('duplicates are dropped, a path under node_modules is a dependency', async () => {
  expect(withoutDuplicates([locatedOffset(model, 6), locatedFile('src/orders.ts'), locatedOffset(model, 6)]).length).toBe(2)
  expect(isDependencyPath('web/node_modules/vue/index.d.ts')).toBe(true)
  expect(isDependencyPath('node_modules/vue/index.d.ts')).toBe(true)
  expect(isDependencyPath('src/node_modules_list.ts')).toBe(false)
})
