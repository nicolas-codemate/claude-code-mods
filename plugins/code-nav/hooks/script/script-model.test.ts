import { expect, test } from 'claude-code/testing'

import { buildScriptModel, isScriptPath } from './script-model'

const COMPONENT = [
  '<template>',
  '  <p @click="select(order)">{{ total }}</p>',
  '</template>',
  '',
  '<script setup lang="ts">',
  'const total = 1',
  '</script>',
].join('\n')

test('the files analysed are scripts and Vue components', async () => {
  expect(['a.ts', 'a.tsx', 'a.js', 'a.jsx', 'a.mjs', 'a.cjs', 'a.vue', 'a.d.ts', 'a.d.mts'].every(isScriptPath)).toBe(true)
  expect(['a.css', 'a.json', 'a.php', 'a.graphql'].some(isScriptPath)).toBe(false)
})

test('the tokens of a Vue component are those of its script, at their offsets in the whole file', async () => {
  const model = buildScriptModel('src/Cart.vue', COMPONENT)
  expect(model.structure.tokens.map(token => token.text)).toEqual(['const', 'total', '=', '1'])
  expect(COMPONENT.slice(model.structure.tokens[1]?.start, model.structure.tokens[1]?.end)).toBe('total')
  expect(model.isVueComponent).toBe(true)
})

test('the template is scanned on demand and each of its expressions has its own structure', async () => {
  const model = buildScriptModel('src/Cart.vue', COMPONENT)
  const expressions = model.templateScan()?.expressions ?? []
  expect(expressions.map(expression => COMPONENT.slice(expression.start, expression.end).trim())).toEqual([
    'select(order)',
    'total',
  ])
  const firstExpression = expressions[0]
  const structure = firstExpression === undefined ? null : model.structureOfTemplateExpression(firstExpression)
  expect(structure?.tokens.map(token => token.text)).toEqual(['select', '(', 'order', ')'])
  expect(firstExpression === undefined ? null : model.structureOfTemplateExpression(firstExpression)).toBe(structure)
})

test('a plain script has no template, a TSX file reads its markup', async () => {
  expect(buildScriptModel('src/orders.ts', 'export const a = 1').templateScan()).toBe(null)
  const model = buildScriptModel('src/Row.tsx', "const Row = () => <Text>it's</Text>\nconst after = 1")
  expect(model.structure.fileScope.declarations.map(declaration => declaration.name)).toEqual(['Row', 'after'])
})

test('with a window only that part of the text is read, at the offsets of the whole text', async () => {
  const text = 'const before = 1\nexport const wanted = 2\nconst after = 3'
  const start = text.indexOf('export')
  const model = buildScriptModel('src/big.ts', text, { start, end: start + 'export const wanted = 2'.length })
  expect(model.structure.fileScope.declarations.map(declaration => declaration.name)).toEqual(['wanted'])
  expect(model.structure.tokens[0]?.start).toBe(start)
})
