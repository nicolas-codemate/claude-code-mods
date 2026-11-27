import { expect, test } from 'claude-code/testing'

import { createMemoryWorkspace } from '../test-workspace'
import {
  ancestorNamesOf,
  classNamedIn,
  createPhpProject,
  findMemberInLineage,
  firstMemberInLineage,
  outlineOfText,
  parseTypeInClass,
  walkClassLineage,
} from './project'
import type { PhpFoundMember } from './project'
import { createShopWorkspace } from './shop-project'
import { phpSymbolsOfFile } from './symbols'
import { classType, typeLabelOf } from './type-expression'
import type { PhpTypeMember } from './type-expression'

const CHECKOUT = 'src/Service/Checkout.php'

function classMember(fullyQualifiedName: string): PhpTypeMember {
  return { kind: 'class', name: fullyQualifiedName, typeArguments: [] }
}

test('a parsed outline is kept for as long as the file text stays the same', async () => {
  const first = outlineOfText('src/a.php', '<?php class A {}')
  expect(outlineOfText('src/a.php', '<?php class A {}')).toBe(first)
  expect(outlineOfText('src/a.php', '<?php class B {}')).not.toBe(first)
  expect(outlineOfText('src/a.php', '<?php class B {}').classes[0]?.name).toBe('B')
})

test('one answer reads each file once, however many hops ask for it', async () => {
  const workspace = createShopWorkspace()
  const readPaths: string[] = []
  const project = createPhpProject({ ...workspace, readFile: (path: string) => (readPaths.push(path), workspace.readFile(path)) })
  await project.locateClass('Shop\\Entity\\Order', CHECKOUT)
  await project.locateClass('Shop\\Entity\\Order', CHECKOUT)
  await project.outlineOfFile('src/Entity/Order.php')
  expect(readPaths.filter(path => path === 'src/Entity/Order.php').length).toBe(1)
})

test('a class is located by its namespace prefix, trying each directory of the prefix', async () => {
  const project = createPhpProject(createShopWorkspace())
  expect((await project.locateClass('Shop\\Entity\\Order', CHECKOUT))?.outline.path).toBe('src/Entity/Order.php')
  expect((await project.locateClass('Doctrine\\Common\\Collections\\Collection', CHECKOUT))?.outline.path).toBe('vendor/doctrine/collections/src/Collection.php')
  expect((await project.locateClass('Doctrine\\ORM\\EntityRepository', 'vendor/doctrine/bundle/src/ServiceEntityRepository.php'))?.classDeclaration.name).toBe(
    'EntityRepository',
  )
})

test('a class outside every prefix is located by the class map, a missing one answers null', async () => {
  const project = createPhpProject(createShopWorkspace())
  expect((await project.locateClass('Legacy_Mailer', CHECKOUT))?.outline.path).toBe('vendor/legacy/mailer/Mailer.php')
  expect(await project.locateClass('Shop\\Entity\\Missing', CHECKOUT)).toBe(null)
  expect(await project.locateClass('DateTimeImmutable', CHECKOUT)).toBe(null)
})

test('without a composer.json a class is found among the symbols, checked against its namespace', async () => {
  const files = {
    'lib/a/Order.php': '<?php\nnamespace Other;\nclass Order {}\n',
    'lib/b/Order.php': '<?php\nnamespace Shop\\Entity;\nclass Order {}\n',
    'lib/Basket.php': '<?php\nnamespace Shop;\nclass Basket {}\nclass BasketLine {}\n',
  }
  const project = createPhpProject(createMemoryWorkspace(files, { symbolsOfFile: phpSymbolsOfFile }))
  expect(project.composerRootOf('lib/Basket.php')).toBe(null)
  expect((await project.locateClass('Shop\\Entity\\Order', 'lib/Basket.php'))?.outline.path).toBe('lib/b/Order.php')
  expect((await project.locateClass('Shop\\BasketLine', 'lib/Basket.php'))?.outline.path).toBe('lib/Basket.php')
  expect(await project.locateClass('Shop\\Order', 'lib/Basket.php')).toBe(null)
})

test('a path the project does not list is a dependency', async () => {
  const project = createPhpProject(createShopWorkspace())
  expect(project.isDependencyPath('vendor/doctrine/orm/src/EntityRepository.php')).toBe(true)
  expect(project.isDependencyPath('src/Entity/Order.php')).toBe(false)
  expect(project.composerRootOf('src/Entity/Order.php')).toBe('')
})

test('the lineage goes through the class, its traits, its parents and its interfaces, each once', async () => {
  const project = createPhpProject(createShopWorkspace())
  const visitedNames: string[] = []
  await walkClassLineage(project, classMember('Shop\\Repository\\OrderRepository'), CHECKOUT, boundClass => {
    visitedNames.push(boundClass.located.classDeclaration.name)

    return false
  })
  expect(visitedNames).toEqual(['OrderRepository', 'ServiceEntityRepository', 'EntityRepository', 'OrderFinder'])
  expect([...(await ancestorNamesOf(project, 'Shop\\Entity\\CreditNote', CHECKOUT))].sort()).toEqual(['Shop\\Entity\\HasTotal', 'Shop\\Entity\\Invoice'])
})

test('the lineage stops reading as soon as the visitor has its answer', async () => {
  const workspace = createShopWorkspace()
  const readPaths: string[] = []
  const project = createPhpProject({ ...workspace, readFile: (path: string) => (readPaths.push(path), workspace.readFile(path)) })
  await firstMemberInLineage(project, classMember('Shop\\Repository\\OrderRepository'), CHECKOUT, 'method', 'save')
  expect(readPaths.some(path => path.startsWith('vendor/doctrine/'))).toBe(false)
})

test('a parent documented with type arguments has its placeholders bound all the way up', async () => {
  const project = createPhpProject(createShopWorkspace())
  const found: PhpFoundMember[] = []
  await findMemberInLineage(project, classMember('Shop\\Repository\\OrderRepository'), CHECKOUT, 'method', 'find', foundMember => {
    found.push(foundMember)

    return true
  })
  expect(found[0]?.boundClass.located.classDeclaration.name).toBe('EntityRepository')
  expect(typeLabelOf(found[0]?.boundClass.bindings.get('T') ?? [])).toBe('Shop\\Entity\\Order')
})

test('type arguments given to a class bind its placeholders by position, a missing one falls back on its bound', async () => {
  const project = createPhpProject(createShopWorkspace())
  const bindingsOf = async (typeMember: PhpTypeMember) => {
    const labels: Record<string, string> = {}
    await walkClassLineage(project, typeMember, CHECKOUT, boundClass => {
      for (const [name, type] of boundClass.bindings) {
        labels[name] = typeLabelOf(type)
      }

      return true
    })

    return labels
  }
  const collectionOfOrders = { ...classMember('Doctrine\\Common\\Collections\\Collection'), typeArguments: [[], classType('Shop\\Entity\\Order')] }
  expect(await bindingsOf(collectionOfOrders)).toEqual({ TKey: '', T: 'Shop\\Entity\\Order' })
  expect(await bindingsOf(classMember('Doctrine\\ORM\\EntityRepository'))).toEqual({ T: 'object' })
})

test('a member is found on the nearest class declaring it, a trait and an interface included', async () => {
  const project = createPhpProject(createShopWorkspace())
  const declaringClassOf = async (className: string, memberKind: 'method' | 'property' | 'constant', name: string) =>
    (await firstMemberInLineage(project, classMember(className), CHECKOUT, memberKind, name)).foundMember?.boundClass.located.classDeclaration.name ?? null
  expect(await declaringClassOf('Shop\\Service\\InvoiceGenerator', 'method', 'log')).toBe('Loggable')
  expect(await declaringClassOf('Shop\\Entity\\CreditNote', 'method', 'getOrder')).toBe('Invoice')
  expect(await declaringClassOf('Shop\\Entity\\CreditNote', 'method', 'getTotal')).toBe('CreditNote')
  expect(await declaringClassOf('Shop\\Repository\\OrderFinder', 'method', 'findLatest')).toBe('OrderFinder')
  expect(await declaringClassOf('Shop\\Entity\\Order', 'constant', 'STATUS_PAID')).toBe('Order')
  expect(await declaringClassOf('Shop\\Entity\\Money', 'property', 'amount')).toBe('Money')
  expect(await declaringClassOf('Shop\\Entity\\Money', 'method', 'missing')).toBe(null)
})

test('a method written in code wins over a docblock tag met before it, the tag is the answer when no code declares it', async () => {
  const files = {
    'src/Repository/InvoiceRepository.php':
      '<?php\nnamespace Shop\\Repository;\nuse Doctrine\\Bundle\\ServiceEntityRepository;\n/**\n * @method Invoice|null find($id)\n * @method Invoice[] findDue()\n */\nclass InvoiceRepository extends ServiceEntityRepository {}\n',
  }
  const project = createPhpProject(createShopWorkspace(files))
  const invoiceRepository = classMember('Shop\\Repository\\InvoiceRepository')
  const find = await firstMemberInLineage(project, invoiceRepository, CHECKOUT, 'method', 'find')
  expect(find.foundMember?.kind).toBe('method')
  expect(find.foundMember?.boundClass.located.classDeclaration.name).toBe('EntityRepository')
  expect((await firstMemberInLineage(project, invoiceRepository, CHECKOUT, 'method', 'findDue')).foundMember?.kind).toBe('docblockMethod')
})

test('the classes of a lineage no file declares are reported', async () => {
  const project = createPhpProject(createShopWorkspace())
  const outcome = await firstMemberInLineage(project, classMember('Shop\\Service\\CheckoutFailed'), CHECKOUT, 'method', 'getMessage')
  expect(outcome.foundMember).toBe(null)
  expect(outcome.unlocatedClassNames).toEqual(['RuntimeException'])
})

test('a type written in a class is read with the placeholders and the imports of that class', async () => {
  const project = createPhpProject(createShopWorkspace())
  const repository = await project.locateClass('Doctrine\\Bundle\\ServiceEntityRepository', CHECKOUT)
  const order = await project.locateClass('Shop\\Entity\\Order', CHECKOUT)
  expect(repository !== null && order !== null).toBe(true)
  if (repository !== null && order !== null) {
    expect(typeLabelOf(parseTypeInClass(repository, 'EntityRepository<T>|null'))).toBe('Doctrine\\ORM\\EntityRepository<T>|null')
    expect(parseTypeInClass(repository, 'T')[0]?.kind).toBe('template')
    expect(typeLabelOf(parseTypeInClass(order, 'Collection<int, OrderLine>'))).toBe('Doctrine\\Common\\Collections\\Collection<int, Shop\\Entity\\OrderLine>')
    expect(classNamedIn(order.outline, 'shop\\entity\\order')?.name).toBe('Order')
  }
})
