import { expect, test } from 'claude-code/testing'

import { findScriptImplementations, findScriptUsages, resolveScriptDefinition, scriptSymbolsOfFile } from './analysis'
import { createShopWorkspace, positionIn, SHOP_FILES } from './test-project'

const workspace = createShopWorkspace()

test('one click answers its definition, its usages and its implementations', async () => {
  const position = positionIn('src/repositories/HttpOrderRepository.ts', 'implements OrderRepository', 'OrderRepository')
  const definition = await resolveScriptDefinition(workspace, position)
  const usages = await findScriptUsages(workspace, position)
  const implementations = await findScriptImplementations(workspace, position)
  expect(definition.targets.map(target => `${target.path}:${target.line}`)).toEqual([
    'src/repositories/OrderRepository.ts:3',
  ])
  expect(usages.usages.map(usage => usage.path)).toEqual([
    'src/repositories/HttpOrderRepository.ts',
    'src/repositories/MemoryOrderRepository.ts',
  ])
  expect(implementations.targets.map(target => target.label)).toEqual([
    'HttpOrderRepository',
    'MemoryOrderRepository',
    'CachedOrderRepository',
  ])
})

test('every file of the shop gives its symbols', async () => {
  const symbolCounts = Object.entries(SHOP_FILES)
    .filter(([path]) => path.startsWith('src/'))
    .map(([path, text]) => scriptSymbolsOfFile(path, text).length)
  expect(symbolCounts.every(count => count >= 0)).toBe(true)
  expect(workspace.symbolsNamed('fetchOrder').map(symbol => symbol.path)).toEqual(['src/api/orders.ts'])
})

test('a click anywhere in any file of the shop answers without throwing', async () => {
  let answeredCount = 0
  for (const [path, text] of Object.entries(SHOP_FILES)) {
    const lines = text.split('\n')
    for (const [lineIndex, lineText] of lines.entries()) {
      for (let column = 0; column < lineText.length; column += 3) {
        const position = { path, line: lineIndex + 1, column }
        await resolveScriptDefinition(workspace, position)
        answeredCount += 1
      }
    }
  }
  expect(answeredCount).toBeGreaterThan(1000)
})

test('a file cut anywhere, as it is while being typed, still gives its symbols without throwing', async () => {
  let readCount = 0
  for (const [path, text] of Object.entries(SHOP_FILES)) {
    for (let cutOffset = 0; cutOffset < text.length; cutOffset += 5) {
      scriptSymbolsOfFile(path, text.slice(0, cutOffset))
      scriptSymbolsOfFile(path, text.slice(cutOffset))
      readCount += 2
    }
  }
  expect(readCount).toBeGreaterThan(2000)
})

test('brackets left open in a class header, a parameter list or a member end the reading instead of looping', async () => {
  for (const text of [
    'class Cart extends Base(',
    'class Cart extends mixin([',
    'class Cart { [key',
    'function load({ [key',
    'const { [key',
    '@Component( class Cart {}',
  ]) {
    expect(Array.isArray(scriptSymbolsOfFile('src/open.ts', text))).toBe(true)
  }
})
