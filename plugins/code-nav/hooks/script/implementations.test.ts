import { expect, test } from 'claude-code/testing'

import type { ImplementationsAnswer } from '../../types'
import { findScriptImplementations } from './implementations'
import { createShopWorkspace, positionIn, SHOP_FILES } from './test-project'

const workspace = createShopWorkspace()

function implementationsAt(path: string, code: string, name: string = code): Promise<ImplementationsAnswer> {
  return findScriptImplementations(workspace, positionIn(path, code, name))
}

function placesOf(answer: ImplementationsAnswer): string[] {
  return answer.targets.map(target => `${target.certainty} ${target.path}:${target.line} ${target.label}`)
}

test('an interface lists the classes that implement it, and the classes that extend those', async () => {
  const answer = await implementationsAt(
    'src/repositories/OrderRepository.ts',
    'interface OrderRepository',
    'OrderRepository',
  )
  expect(answer.title).toBe('OrderRepository')
  expect(placesOf(answer)).toEqual([
    'exact src/repositories/HttpOrderRepository.ts:7 HttpOrderRepository',
    'exact src/repositories/MemoryOrderRepository.ts:4 MemoryOrderRepository',
    'exact src/repositories/CachedOrderRepository.ts:4 CachedOrderRepository',
  ])
  expect(answer.targets[0]?.preview).toBe(
    'export class HttpOrderRepository extends BaseRepository implements OrderRepository {',
  )
})

test('a class lists the classes that extend it', async () => {
  const answer = await implementationsAt('src/repositories/BaseRepository.ts', 'class BaseRepository', 'BaseRepository')
  expect(placesOf(answer)).toEqual([
    'exact src/repositories/HttpOrderRepository.ts:7 HttpOrderRepository',
    'exact src/repositories/CachedOrderRepository.ts:4 CachedOrderRepository',
  ])
})

test('the answer is the same from a use of the name', async () => {
  const fromUse = await implementationsAt(
    'src/repositories/MemoryOrderRepository.ts',
    'implements OrderRepository',
    'OrderRepository',
  )
  const fromDeclaration = await implementationsAt(
    'src/repositories/OrderRepository.ts',
    'interface OrderRepository',
    'OrderRepository',
  )
  expect(placesOf(fromUse)).toEqual(placesOf(fromDeclaration))
})

test('a method of an interface lists the members of the same name in the classes that implement it', async () => {
  const answer = await implementationsAt('src/repositories/OrderRepository.ts', 'find(id: string)', 'find')
  expect(answer.title).toBe('OrderRepository.find')
  expect(placesOf(answer)).toEqual([
    'exact src/repositories/HttpOrderRepository.ts:14 HttpOrderRepository.find',
    'exact src/repositories/MemoryOrderRepository.ts:7 MemoryOrderRepository.find',
    'exact src/repositories/CachedOrderRepository.ts:5 CachedOrderRepository.find',
  ])
})

test('a class that only bears the same parent name, imported from elsewhere, is left out', async () => {
  const files = {
    ...SHOP_FILES,
    'src/other/OrderRepository.ts': 'export interface OrderRepository { count(): number }',
    'src/other/CountingRepository.ts':
      "import type { OrderRepository } from './OrderRepository'\nexport class CountingRepository implements OrderRepository { count() { return 0 } }",
  }
  const answer = await findScriptImplementations(
    createShopWorkspace(files),
    positionIn('src/repositories/OrderRepository.ts', 'interface OrderRepository', 'OrderRepository', files),
  )
  expect(answer.targets.map(target => target.label)).toEqual([
    'HttpOrderRepository',
    'MemoryOrderRepository',
    'CachedOrderRepository',
  ])
})

test('a class whose parent name cannot be followed is listed as a candidate, after the exact ones', async () => {
  const files = {
    ...SHOP_FILES,
    'src/legacy/GlobalRepository.ts': 'export class GlobalRepository extends BaseRepository {}',
  }
  const answer = await findScriptImplementations(
    createShopWorkspace(files),
    positionIn('src/repositories/BaseRepository.ts', 'class BaseRepository', 'BaseRepository', files),
  )
  expect(placesOf(answer).at(-1)).toBe('candidate src/legacy/GlobalRepository.ts:1 GlobalRepository')
})

test('a name that is neither a class nor an interface says so', async () => {
  const answer = await implementationsAt('src/api/orders.ts', 'async function fetchOrders(', 'fetchOrders')
  expect(answer.targets).toEqual([])
  expect(answer.note).toBe('fetchOrders is neither a class nor an interface, nor a member of one')
})

test('a class nothing extends says so, a click on nothing answers no symbol', async () => {
  const leaf = await implementationsAt(
    'src/repositories/MemoryOrderRepository.ts',
    'class MemoryOrderRepository',
    'MemoryOrderRepository',
  )
  expect(leaf.note).toBe('Nothing extends or implements MemoryOrderRepository')
  const nothing = await implementationsAt('src/api/orders.ts', "'/orders'", 'orders')
  expect(nothing).toEqual({ symbol: null, title: '', targets: [], note: null })
})
