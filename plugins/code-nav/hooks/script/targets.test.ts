import { expect, test } from 'claude-code/testing'

import { locatedDeclaration, locatedFile, locatedOffset } from './located'
import { createAnalysisSession, modelOf } from './session'
import { targetOfLocated, targetOfSymbol, withoutDuplicateTargets } from './targets'
import { createShopWorkspace } from './test-project'

const session = createAnalysisSession(createShopWorkspace())

test('a declaration is a target at its name, with its line as preview', async () => {
  const model = await modelOf(session, 'src/repositories/HttpOrderRepository.ts')
  const find =
    model === null
      ? undefined
      : [...model.structure.declarationAtToken.values()].find(declaration => declaration.name === 'find')
  const target =
    model === null || find === undefined
      ? null
      : await targetOfLocated(session, locatedDeclaration(model, model.structure, find), 'exact')
  expect(target).toEqual({
    path: 'src/repositories/HttpOrderRepository.ts',
    line: 14,
    column: 8,
    label: 'HttpOrderRepository.find',
    preview: 'async find(id: string): Promise<Order> {',
    certainty: 'exact',
    isDependency: false,
  })
})

test('a file is a target at its first line, a component named without its extension', async () => {
  const component = await targetOfLocated(session, locatedFile('src/components/OrderRow.vue'), 'candidate')
  expect([component.line, component.column, component.label, component.preview, component.certainty]).toEqual([
    1,
    0,
    'OrderRow',
    '<script setup lang="ts">',
    'candidate',
  ])
  expect((await targetOfLocated(session, locatedFile('src/api/orders.ts'), 'exact')).label).toBe('orders.ts')
  expect((await targetOfLocated(session, locatedFile('node_modules/vue/dist/vue.d.ts'), 'exact')).isDependency).toBe(true)
})

test('a place without a declaration is named by the word that stands there', async () => {
  const model = await modelOf(session, 'src/components/OrderTable.vue')
  const offset = model?.text.indexOf('order, index') ?? 0
  const target = model === null ? null : await targetOfLocated(session, locatedOffset(model, offset), 'exact')
  expect([target?.line, target?.label]).toEqual([3, 'order'])
})

test('a symbol of the project index is a target at the column of its name', async () => {
  const target = await targetOfSymbol(
    session,
    { name: 'total', kind: 'property', path: 'src/types/order.ts', line: 12, container: 'Order' },
    'candidate',
  )
  expect(target).toEqual({
    path: 'src/types/order.ts',
    line: 12,
    column: 2,
    label: 'Order.total',
    preview: 'total: number',
    certainty: 'candidate',
    isDependency: false,
  })
})

test('two targets on the same line of the same file are one', async () => {
  const target = await targetOfLocated(session, locatedFile('src/api/orders.ts'), 'exact')
  expect(
    withoutDuplicateTargets([target, { ...target, label: 'again' }, { ...target, line: 2 }]).map(kept => kept.line),
  ).toEqual([1, 2])
})
