import { expect, test } from 'claude-code/testing'

import type { ImplementationsAnswer } from '../../types'
import { findPhpParents } from './parents'
import { createShopWorkspace, positionIn, SHOP_FILES } from './shop-project'

const ADDITIONAL_FILES: Record<string, string> = {
  'src/Repository/CustomerRepository.php': `<?php

namespace Shop\\Repository;

use Doctrine\\Bundle\\ServiceEntityRepository;

class CustomerRepository extends ServiceEntityRepository
{
    use Auditable;

    public function find(mixed $id): ?object
    {
        return null;
    }

    public function audit(): void
    {
    }
}
`,
  'src/Repository/Auditable.php': `<?php

namespace Shop\\Repository;

trait Auditable
{
    abstract public function audit(): void;
}
`,
  'src/Repository/ArchivedOrderFinder.php': `<?php

namespace Shop\\Repository;

interface ArchivedOrderFinder extends OrderFinder, \\Countable
{
}
`,
}
const FILES = { ...SHOP_FILES, ...ADDITIONAL_FILES }

function parentsAt(path: string, snippet: string, name: string): Promise<ImplementationsAnswer> {
  return findPhpParents(createShopWorkspace(ADDITIONAL_FILES), positionIn(FILES, path, snippet, name))
}

function placesOf(answer: ImplementationsAnswer): string[] {
  return answer.targets.map(target => `${target.label} ${target.path}:${target.line}`)
}

test('a method overriding a parent method lists it, then the interface method the parent implements', async () => {
  const answer = await parentsAt('src/Entity/CreditNote.php', 'public function getTotal', 'getTotal')
  expect(answer.title).toBe('CreditNote::getTotal')
  expect(placesOf(answer)).toEqual(['Invoice::getTotal src/Entity/Invoice.php:21', 'HasTotal::getTotal src/Entity/HasTotal.php:7'])
  expect(answer.targets[0]?.preview).toBe('public function getTotal(): Money')
  expect(answer.targets.every(target => target.certainty === 'exact' && !target.isDependency)).toBe(true)
  expect(answer.note).toBeNull()
})

test('a method implementing an interface method lists the method of the interface', async () => {
  const answer = await parentsAt('src/Repository/OrderRepository.php', 'public function findLatest', 'findLatest')
  expect(answer.title).toBe('OrderRepository::findLatest')
  expect(placesOf(answer)).toEqual(['OrderFinder::findLatest src/Repository/OrderFinder.php:9'])
})

test('a class lists its parent classes and its interfaces, nearest first, those of dependencies marked so', async () => {
  const answer = await parentsAt('src/Repository/OrderRepository.php', 'class OrderRepository', 'OrderRepository')
  expect(answer.title).toBe('OrderRepository')
  expect(placesOf(answer)).toEqual([
    'ServiceEntityRepository vendor/doctrine/bundle/src/ServiceEntityRepository.php:11',
    'OrderFinder src/Repository/OrderFinder.php:7',
    'EntityRepository vendor/doctrine/orm/src/EntityRepository.php:8',
  ])
  expect(answer.targets.map(target => target.isDependency)).toEqual([true, false, true])
})

test('an interface lists the interfaces it extends, a built-in one being named in no target', async () => {
  const answer = await parentsAt('src/Repository/ArchivedOrderFinder.php', 'interface ArchivedOrderFinder', 'ArchivedOrderFinder')
  expect(placesOf(answer)).toEqual(['OrderFinder src/Repository/OrderFinder.php:7'])
})

test('the parents asked from a reference to a class are those of the class', async () => {
  const answer = await parentsAt('src/Service/Checkout.php', 'private readonly OrderRepository $orders', 'OrderRepository')
  expect(answer.targets.map(target => target.label)).toEqual(['ServiceEntityRepository', 'OrderFinder', 'EntityRepository'])
})

test('a method overriding one of a dependency points into vendor, marked as a dependency', async () => {
  const answer = await parentsAt('src/Repository/CustomerRepository.php', 'public function find(', 'find')
  expect(placesOf(answer)).toEqual(['EntityRepository::find vendor/doctrine/orm/src/EntityRepository.php:14'])
  expect(answer.targets[0]?.isDependency).toBe(true)
  expect(answer.targets[0]?.preview).toBe('public function find(mixed $id): ?object')
})

test('a method declared by a trait the class uses lists the trait method', async () => {
  const answer = await parentsAt('src/Repository/CustomerRepository.php', 'public function audit', 'audit')
  expect(placesOf(answer)).toEqual(['Auditable::audit src/Repository/Auditable.php:7'])
})

test('a call is followed to its method before the parents are looked for', async () => {
  const answer = await parentsAt('src/Service/Checkout.php', '$this->finder->findLatest()', 'findLatest')
  expect(answer.title).toBe('OrderFinder::findLatest')
  expect(answer.targets).toEqual([])
})

test('a method with nothing above it says so', async () => {
  const answer = await parentsAt('src/Service/Checkout.php', '$this->orders->save($order)', 'save')
  expect(answer.title).toBe('OrderRepository::save')
  expect(answer.targets).toEqual([])
  expect(answer.note).toBe('save overrides nothing: OrderRepository has no parent declaring it.')
})

test('a class without parent says so, naming the parents no file declares', async () => {
  const ofMoney = await parentsAt('src/Entity/Money.php', 'final class Money', 'Money')
  expect(ofMoney.note).toBe('Money has no parent class or interface.')
  const ofFailure = await parentsAt('src/Service/CheckoutFailed.php', 'class CheckoutFailed', 'CheckoutFailed')
  expect(ofFailure.note).toBe('CheckoutFailed has no parent class or interface. Not found in the project or its dependencies: RuntimeException.')
})

test('a variable has no parent', async () => {
  const answer = await parentsAt('src/Service/Checkout.php', 'public function pay(Order $order, $unknown)', '$unknown')
  expect(answer.note).toBe('Parents are listed for a class, an interface or a method')
})
