import { expect, test } from 'claude-code/testing'

import type { ImplementationsAnswer } from '../../types'
import { findScriptParents } from './parents'
import { createShopWorkspace, positionIn, SHOP_FILES } from './test-project'

const FILES: Record<string, string> = {
  ...SHOP_FILES,
  'node_modules/shop-kit/package.json': '{ "name": "shop-kit", "types": "index.d.ts" }',
  'node_modules/shop-kit/index.d.ts': [
    'export declare class StoredRepository {',
    '  remove(id: string): void',
    '}',
  ].join('\n'),
  'src/repositories/ArchiveRepository.ts': [
    "import { StoredRepository } from 'shop-kit'",
    '',
    'export class ArchiveRepository extends StoredRepository {',
    '  remove(id: string): void {',
    '    console.log(id)',
    '  }',
    '}',
  ].join('\n'),
}
const workspace = createShopWorkspace(FILES)

function parentsAt(path: string, code: string, name: string = code): Promise<ImplementationsAnswer> {
  return findScriptParents(workspace, positionIn(path, code, name, FILES))
}

function placesOf(answer: ImplementationsAnswer): string[] {
  return answer.targets.map(target => `${target.certainty} ${target.path}:${target.line} ${target.label}`)
}

test('a class lists the class it extends, then what that one extends and implements', async () => {
  const answer = await parentsAt(
    'src/repositories/CachedOrderRepository.ts',
    'class CachedOrderRepository',
    'CachedOrderRepository',
  )
  expect(answer.title).toBe('CachedOrderRepository')
  expect(placesOf(answer)).toEqual([
    'exact src/repositories/HttpOrderRepository.ts:7 HttpOrderRepository',
    'exact src/repositories/BaseRepository.ts:1 BaseRepository',
    'exact src/repositories/OrderRepository.ts:3 OrderRepository',
  ])
  expect(answer.targets.every(target => !target.isDependency)).toBe(true)
})

test('a method overriding a parent method lists it, then the interface method the parent implements', async () => {
  const answer = await parentsAt('src/repositories/CachedOrderRepository.ts', 'async find(id', 'find')
  expect(answer.title).toBe('CachedOrderRepository.find')
  expect(placesOf(answer)).toEqual([
    'exact src/repositories/HttpOrderRepository.ts:14 HttpOrderRepository.find',
    'exact src/repositories/OrderRepository.ts:4 OrderRepository.find',
  ])
  expect(answer.targets[0]?.preview).toBe('async find(id: string): Promise<Order> {')
})

test('a method implementing an interface method lists the method of the interface', async () => {
  const answer = await parentsAt('src/repositories/MemoryOrderRepository.ts', 'save(order: Order)', 'save')
  expect(placesOf(answer)).toEqual(['exact src/repositories/OrderRepository.ts:5 OrderRepository.save'])
})

test('the parents asked from a use of a class name are those of the class', async () => {
  const answer = await parentsAt(
    'src/repositories/CachedOrderRepository.ts',
    'extends HttpOrderRepository',
    'HttpOrderRepository',
  )
  expect(placesOf(answer)).toEqual([
    'exact src/repositories/BaseRepository.ts:1 BaseRepository',
    'exact src/repositories/OrderRepository.ts:3 OrderRepository',
  ])
})

test('a parent declared by a package is marked as a dependency', async () => {
  const ofClass = await parentsAt('src/repositories/ArchiveRepository.ts', 'class ArchiveRepository', 'ArchiveRepository')
  expect(placesOf(ofClass)).toEqual(['exact node_modules/shop-kit/index.d.ts:1 StoredRepository'])
  expect(ofClass.targets[0]?.isDependency).toBe(true)
  const ofMethod = await parentsAt('src/repositories/ArchiveRepository.ts', 'remove(id: string): void {', 'remove')
  expect(placesOf(ofMethod)).toEqual(['exact node_modules/shop-kit/index.d.ts:2 StoredRepository.remove'])
  expect(ofMethod.targets[0]?.isDependency).toBe(true)
})

test('a method or a class with nothing above it says so', async () => {
  const ofMethod = await parentsAt('src/repositories/BaseRepository.ts', 'protected log(', 'log')
  expect(ofMethod.targets).toEqual([])
  expect(ofMethod.note).toBe('log overrides nothing: BaseRepository has no parent declaring it.')
  const ofClass = await parentsAt('src/api/http.ts', 'export class HttpClient', 'HttpClient')
  expect(ofClass.note).toBe('HttpClient has no parent class or interface.')
})

test('a name that is neither a class nor a member of one says so, a click on nothing answers no symbol', async () => {
  const ofFunction = await parentsAt('src/api/orders.ts', 'async function fetchOrders(', 'fetchOrders')
  expect(ofFunction.note).toBe('fetchOrders is neither a class nor an interface, nor a member of one')
  const nothing = await parentsAt('src/api/orders.ts', "'/orders'", 'orders')
  expect(nothing).toEqual({ symbol: null, title: '', targets: [], note: null })
})
