import { expect, test } from 'claude-code/testing'

import type { DefinitionAnswer } from '../../types'
import { resolvePhpDefinition } from './definition'
import { createShopWorkspace, positionIn, shopPosition, SHOP_FILES } from './shop-project'

const CHECKOUT = 'src/Service/Checkout.php'

function definitionAt(path: string, snippet: string, name: string): Promise<DefinitionAnswer> {
  return resolvePhpDefinition(createShopWorkspace(), shopPosition(path, snippet, name))
}

function placesOf(answer: DefinitionAnswer): string[] {
  return answer.targets.map(target => `${target.label} ${target.path}:${target.line} ${target.certainty}`)
}

test('a method called on a promoted constructor property goes to the method of the property type', async () => {
  const answer = await definitionAt(CHECKOUT, '$this->orders->save($order)', 'save')
  expect(placesOf(answer)).toEqual(['OrderRepository::save src/Repository/OrderRepository.php:13 exact'])
  expect(answer.targets[0]?.preview).toBe('public function save(Order $order): void')
  expect(answer.targets[0]?.column).toBe(20)
  expect(answer.targets[0]?.isDependency).toBe(false)
  expect(answer.symbol).toEqual({ name: 'save', line: 34, startColumn: 23, endColumn: 27, description: 'method save of OrderRepository' })
  expect(answer.isOnDeclaration).toBe(false)
})

test('a property assigned in the constructor from a typed parameter takes that type', async () => {
  const answer = await definitionAt(CHECKOUT, '$this->mailer->send($paid', 'send')
  expect(placesOf(answer)).toEqual(['Legacy_Mailer::send vendor/legacy/mailer/Mailer.php:5 exact'])
  expect(answer.targets[0]?.isDependency).toBe(true)
})

test('a typed property and a docblock typed property give the receiver of a call', async () => {
  expect(placesOf(await definitionAt(CHECKOUT, '$this->invoiceGenerator->generate($order)', 'generate'))).toEqual([
    'InvoiceGenerator::generate src/Service/InvoiceGenerator.php:12 exact',
  ])
  expect(placesOf(await definitionAt(CHECKOUT, '$this->finder->findLatest()', 'findLatest'))).toEqual([
    'OrderFinder::findLatest src/Repository/OrderFinder.php:9 exact',
  ])
})

test('a variable assigned from a call takes the declared return type of that call', async () => {
  expect(placesOf(await definitionAt(CHECKOUT, '$invoice->getTotal()', 'getTotal'))).toEqual(['Invoice::getTotal src/Entity/Invoice.php:21 exact'])
})

test('a static return type keeps the receiver, a nullable one keeps its class', async () => {
  expect(placesOf(await definitionAt(CHECKOUT, '$order->markPaid()->getCustomer()', 'getCustomer'))).toEqual([
    'Order::getCustomer src/Entity/Order.php:33 exact',
  ])
  expect(placesOf(await definitionAt(CHECKOUT, '$paid?->getEmail()', 'getEmail'))).toEqual(['Customer::getEmail src/Entity/Customer.php:9 exact'])
})

test('a repository documented as extending a generic one answers its entity for find', async () => {
  expect(placesOf(await definitionAt(CHECKOUT, '$latest->getStatus()', 'getStatus'))).toEqual(['Order::getStatus src/Entity/Order.php:59 exact'])
  expect(placesOf(await definitionAt(CHECKOUT, '$this->orders->find(12)', 'find'))).toEqual([
    'EntityRepository::find vendor/doctrine/orm/src/EntityRepository.php:14 exact',
  ])
})

test('getRepository called with a class name gives a repository of that class', async () => {
  expect(placesOf(await definitionAt(CHECKOUT, '$found->getProducts()[0]->getName()', 'getProducts'))).toEqual([
    'Order::getProducts src/Entity/Order.php:49 exact',
  ])
  expect(placesOf(await definitionAt(CHECKOUT, '$found->getProducts()[0]->getName()', 'getName'))).toEqual([
    'Product::getName src/Entity/Product.php:9 exact',
  ])
})

test('a foreach over a documented list gives its elements, over a generic collection its last argument', async () => {
  expect(placesOf(await definitionAt(CHECKOUT, '$order->getTotal();\n        }\n        foreach ($order->getLines()', 'getTotal'))).toEqual([
    'Order::getTotal src/Entity/Order.php:54 exact',
  ])
  expect(placesOf(await definitionAt(CHECKOUT, '$line->getProduct()->getPrice()', 'getPrice'))).toEqual(['Product::getPrice src/Entity/Product.php:14 exact'])
  expect(placesOf(await definitionAt(CHECKOUT, '$customerOrder->getId()', 'getId'))).toEqual(['Order::getId src/Entity/Order.php:28 exact'])
})

test('a typed arrow function parameter, a catch and an inline var docblock type their variable', async () => {
  expect(placesOf(await definitionAt(CHECKOUT, '$each->getCustomer()?->getEmail()', 'getEmail'))).toEqual(['Customer::getEmail src/Entity/Customer.php:9 exact'])
  expect(placesOf(await definitionAt(CHECKOUT, '$failure->getOrder()', 'getOrder'))).toEqual(['CheckoutFailed::getOrder src/Service/CheckoutFailed.php:14 exact'])
  expect(placesOf(await definitionAt(CHECKOUT, '$guest->getEmail()', 'getEmail'))).toEqual(['Customer::getEmail src/Entity/Customer.php:9 exact'])
})

test('new, clone, parentheses and a nullsafe chain over several lines are followed', async () => {
  expect(placesOf(await definitionAt(CHECKOUT, '?->getTotal();\n        $maker', 'getTotal'))).toEqual(['Order::getTotal src/Entity/Order.php:54 exact'])
  expect(placesOf(await definitionAt(CHECKOUT, '$maker->generate($found)->getOrder()', 'getOrder'))).toEqual([
    'Invoice::getOrder src/Entity/Invoice.php:16 exact',
  ])
})

test('static calls, enum cases and constants resolve through the class before the double colon', async () => {
  expect(placesOf(await definitionAt(CHECKOUT, 'Amount::zero()', 'zero'))).toEqual(['Money::zero src/Entity/Money.php:13 exact'])
  expect(placesOf(await definitionAt(CHECKOUT, 'OrderStatus::Paid->label()', 'Paid'))).toEqual(['OrderStatus::Paid src/Entity/OrderStatus.php:7 exact'])
  expect(placesOf(await definitionAt(CHECKOUT, 'OrderStatus::Paid->label()', 'label'))).toEqual(['OrderStatus::label src/Entity/OrderStatus.php:10 exact'])
  expect(placesOf(await definitionAt(CHECKOUT, '$latest->getStatus()->label()', 'label'))).toEqual(['OrderStatus::label src/Entity/OrderStatus.php:10 exact'])
  expect(placesOf(await definitionAt(CHECKOUT, 'self::describe($found)', 'describe'))).toEqual(['Checkout::describe src/Service/Checkout.php:97 exact'])
  expect(placesOf(await definitionAt(CHECKOUT, '? Order::STATUS_PAID', 'STATUS_PAID'))).toEqual(['Order::STATUS_PAID src/Entity/Order.php:11 exact'])
})

test('a method inherited from a trait or declared only by an interface is an exact target', async () => {
  expect(placesOf(await definitionAt('src/Service/InvoiceGenerator.php', "$this->log('generating')", 'log'))).toEqual([
    'Loggable::log src/Service/Loggable.php:7 exact',
  ])
  expect(placesOf(await definitionAt('src/Entity/Invoice.php', '$this->order->getTotal()', 'getTotal'))).toEqual(['Order::getTotal src/Entity/Order.php:54 exact'])
})

test('a method declared by a class docblock is found on its tag line', async () => {
  const files = { 'src/Service/Catalog.php': "<?php\nnamespace Shop\\Service;\nuse Shop\\Repository\\ProductRepository;\nfunction lookup(ProductRepository $products) {\n    return $products->findOneByName('tea');\n}\n" }
  const answer = await resolvePhpDefinition(createShopWorkspace(files), positionIn(files, 'src/Service/Catalog.php', '->findOneByName', 'findOneByName'))
  expect(placesOf(answer)).toEqual(['ProductRepository::findOneByName src/Repository/ProductRepository.php:11 exact'])
})

test('class names resolve through use statements, aliases, grouped uses and the namespace', async () => {
  expect(placesOf(await definitionAt(CHECKOUT, 'pay(Order $order, $unknown)', 'Order'))).toEqual(['Order src/Entity/Order.php:9 exact'])
  expect(placesOf(await definitionAt(CHECKOUT, '$unknown): ?Amount', 'Amount'))).toEqual(['Money src/Entity/Money.php:5 exact'])
  expect(placesOf(await definitionAt(CHECKOUT, 'use Shop\\Entity\\{Customer, Money as Amount};', 'Customer'))).toEqual(['Customer src/Entity/Customer.php:5 exact'])
  expect(placesOf(await definitionAt(CHECKOUT, 'private InvoiceGenerator $invoiceGenerator;', 'InvoiceGenerator'))).toEqual([
    'InvoiceGenerator src/Service/InvoiceGenerator.php:8 exact',
  ])
  expect(placesOf(await definitionAt(CHECKOUT, 'new InvoiceGenerator()', 'InvoiceGenerator'))).toEqual(['InvoiceGenerator src/Service/InvoiceGenerator.php:8 exact'])
  expect(placesOf(await definitionAt(CHECKOUT, 'catch (CheckoutFailed |', 'CheckoutFailed'))).toEqual(['CheckoutFailed src/Service/CheckoutFailed.php:7 exact'])
  expect(placesOf(await definitionAt(CHECKOUT, '$order instanceof Order', 'Order'))).toEqual(['Order src/Entity/Order.php:9 exact'])
  expect(placesOf(await definitionAt(CHECKOUT, 'getRepository(Order::class)', 'Order'))).toEqual(['Order src/Entity/Order.php:9 exact'])
  expect(placesOf(await definitionAt('src/Entity/Order.php', 'class Order implements HasTotal', 'HasTotal'))).toEqual(['HasTotal src/Entity/HasTotal.php:5 exact'])
  expect(placesOf(await definitionAt('src/Service/InvoiceGenerator.php', 'use Loggable;', 'Loggable'))).toEqual(['Loggable src/Service/Loggable.php:5 exact'])
})

test('a class of a dependency is located by the Composer tables and flagged', async () => {
  const fromNamespacePrefix = await definitionAt(CHECKOUT, 'private readonly EntityManagerInterface $entityManager', 'EntityManagerInterface')
  expect(placesOf(fromNamespacePrefix)).toEqual(['EntityManagerInterface vendor/doctrine/orm/src/EntityManagerInterface.php:5 exact'])
  expect(fromNamespacePrefix.targets[0]?.isDependency).toBe(true)
  expect(placesOf(await definitionAt(CHECKOUT, '\\Legacy_Mailer $mailer', 'Legacy_Mailer'))).toEqual(['Legacy_Mailer vendor/legacy/mailer/Mailer.php:3 exact'])
  expect(placesOf(await definitionAt('src/Entity/Order.php', 'use Doctrine\\Common\\Collections\\Collection;', 'Collection'))).toEqual([
    'Collection vendor/doctrine/collections/src/Collection.php:9 exact',
  ])
})

test('without Composer tables a class is found among the project symbols by its namespace', async () => {
  const { 'vendor/composer/autoload_psr4.php': removedPrefixes, 'vendor/composer/autoload_classmap.php': removedClassMap, ...files } = SHOP_FILES
  const workspace = createShopWorkspace()
  const withoutTables = { ...workspace, readFile: async (path: string) => (path.startsWith('vendor/composer/') ? null : (files[path] ?? null)) }
  expect(removedPrefixes === removedClassMap).toBe(false)
  expect(placesOf(await resolvePhpDefinition(withoutTables, shopPosition(CHECKOUT, 'pay(Order $order, $unknown)', 'Order')))).toEqual([
    'Order src/Entity/Order.php:9 exact',
  ])
})

test('class names inside docblock tags are references, a word of prose is not', async () => {
  expect(placesOf(await definitionAt(CHECKOUT, '@param iterable<Customer> $customers', 'Customer'))).toEqual(['Customer src/Entity/Customer.php:5 exact'])
  expect(placesOf(await definitionAt(CHECKOUT, '@param Order[] $orders', 'Order'))).toEqual(['Order src/Entity/Order.php:9 exact'])
  expect(placesOf(await definitionAt(CHECKOUT, '/** @var OrderFinder */', 'OrderFinder'))).toEqual(['OrderFinder src/Repository/OrderFinder.php:7 exact'])
  expect(placesOf(await definitionAt('src/Repository/OrderRepository.php', '@extends ServiceEntityRepository<Order>', 'Order'))).toEqual([
    'Order src/Entity/Order.php:9 exact',
  ])
  expect((await definitionAt(CHECKOUT, '@param Order[] $orders', 'param')).symbol).toBe(null)
  expect((await definitionAt('src/Repository/OrderRepository.php', "'o.status = :status'", 'status')).symbol).toBe(null)
})

test('a click inside a string or a plain comment answers no symbol', async () => {
  const files = { 'src/notes.php': "<?php\n// Order is mentioned here\n$label = 'Order number';\n" }
  const workspace = createShopWorkspace(files)
  expect(await resolvePhpDefinition(workspace, positionIn(files, 'src/notes.php', '// Order is', 'Order'))).toEqual({
    symbol: null,
    targets: [],
    isOnDeclaration: false,
    note: null,
  })
  expect((await resolvePhpDefinition(workspace, positionIn(files, 'src/notes.php', "'Order number'", 'Order'))).symbol).toBe(null)
})

test('a click on a declaration says so and leaves the targets empty', async () => {
  const onMethod = await definitionAt('src/Repository/OrderRepository.php', 'public function save(Order $order)', 'save')
  expect(onMethod.isOnDeclaration).toBe(true)
  expect(onMethod.targets).toEqual([])
  expect(onMethod.symbol?.description).toBe('method save of OrderRepository')
  expect((await definitionAt('src/Entity/Order.php', 'class Order implements', 'Order')).symbol?.description).toBe('class Order')
  expect((await definitionAt('src/Entity/OrderStatus.php', 'enum OrderStatus', 'OrderStatus')).isOnDeclaration).toBe(true)
  expect((await definitionAt('src/Entity/OrderStatus.php', "case Paid = 'paid'", 'Paid')).symbol?.description).toBe('constant Paid of OrderStatus')
  expect((await definitionAt('src/Entity/Order.php', 'const STATUS_PAID', 'STATUS_PAID')).isOnDeclaration).toBe(true)
  expect((await definitionAt('src/Entity/Order.php', 'private ?Customer $customer', '$customer')).symbol?.description).toBe('property customer of Order')
  expect((await definitionAt('src/Entity/Money.php', 'public readonly int $amount', '$amount')).symbol?.description).toBe('property amount of Money')
  expect((await definitionAt('src/functions.php', 'function format_price', 'format_price')).symbol?.description).toBe('function format_price')
})

test('a property access goes to the property, a promoted constructor parameter included', async () => {
  expect(placesOf(await definitionAt('src/functions.php', '$money->amount', 'amount'))).toEqual(['Money::$amount src/Entity/Money.php:8 exact'])
  expect(placesOf(await definitionAt('src/Entity/Order.php', 'return $this->customer', 'customer'))).toEqual(['Order::$customer src/Entity/Order.php:13 exact'])
  expect(placesOf(await definitionAt(CHECKOUT, '$this->entityManager->getRepository', 'entityManager'))).toEqual([
    'Checkout::$entityManager src/Service/Checkout.php:24 exact',
  ])
})

test('a variable goes to its parameter, else to its first assignment', async () => {
  const onParameterUse = await definitionAt(CHECKOUT, '$this->orders->save($order)', '$order')
  expect(placesOf(onParameterUse)).toEqual(['$order src/Service/Checkout.php:32 exact'])
  expect(onParameterUse.symbol?.description).toBe('parameter $order')
  const onAssignedUse = await definitionAt(CHECKOUT, 'format_price($total)', '$total')
  expect(placesOf(onAssignedUse)).toEqual(['$total src/Service/Checkout.php:36 exact'])
  expect(onAssignedUse.symbol?.description).toBe('variable $total')
  const onFirstAssignment = await definitionAt(CHECKOUT, '$total = $invoice->getTotal()', '$total')
  expect(onFirstAssignment.isOnDeclaration).toBe(true)
  expect(placesOf(await definitionAt(CHECKOUT, "$day->format('Y')", '$day'))).toEqual(['$day src/Service/Checkout.php:57 exact'])
})

test('a plain function call goes to the function its use statement or its namespace names', async () => {
  expect(placesOf(await definitionAt(CHECKOUT, 'echo format_price($total)', 'format_price'))).toEqual(['format_price src/functions.php:7 exact'])
  expect(placesOf(await definitionAt(CHECKOUT, 'use function Shop\\format_price;', 'format_price'))).toEqual(['format_price src/functions.php:7 exact'])
})

test('a function no file declares is presumed built into PHP', async () => {
  const answer = await definitionAt(CHECKOUT, 'count([1])', 'count')
  expect(answer.targets).toEqual([])
  expect(answer.note).toBe('count is a PHP built-in function')
  expect((await definitionAt('src/Entity/OrderStatus.php', 'ucfirst($this->value)', 'ucfirst')).note).toBe('ucfirst is a PHP built-in function')
})

test('a member of a class PHP itself defines is said so', async () => {
  expect((await definitionAt(CHECKOUT, "$day->format('Y')", 'format')).note).toBe('format belongs to DateTimeImmutable, a PHP built-in class')
  expect((await definitionAt(CHECKOUT, '$failure->getMessage()', 'getMessage')).note).toBe('getMessage belongs to RuntimeException, a PHP built-in class')
  expect((await definitionAt(CHECKOUT, '\\DateTimeImmutable $day', 'DateTimeImmutable')).note).toBe('DateTimeImmutable is a PHP built-in class')
})

test('when the receiver cannot be typed, every declaration of the name is a candidate, the imported classes first', async () => {
  const answer = await definitionAt(CHECKOUT, '$unknown->save($order)', 'save')
  expect(placesOf(answer)).toEqual([
    'OrderRepository::save src/Repository/OrderRepository.php:13 candidate',
    'ProductRepository::save src/Repository/ProductRepository.php:15 candidate',
  ])
  expect(answer.symbol?.description).toBe('method save')
  const sameNamespaceLast = await definitionAt(CHECKOUT, '$unknown->getTotal()', 'getTotal')
  expect(sameNamespaceLast.targets.map(target => target.label)).toEqual(['Order::getTotal', 'CreditNote::getTotal', 'HasTotal::getTotal', 'Invoice::getTotal'])
})

test('a member the project never declares is searched in the dependencies, then said missing', async () => {
  const fromDependency = await definitionAt(CHECKOUT, "$unknown->sendLater('someone')", 'sendLater')
  expect(placesOf(fromDependency)).toEqual(['Mailer::sendLater vendor/legacy/mailer/Mailer.php:9 candidate'])
  expect(fromDependency.targets[0]?.isDependency).toBe(true)
  const missing = await definitionAt(CHECKOUT, '$unknown->vanish()', 'vanish')
  expect(missing.targets).toEqual([])
  expect(missing.note).toBe('vanish is not declared in the project or its dependencies: a PHP built-in method, or a magic one')
})

test('a first-class callable and a closure capturing a variable keep their receiver types', async () => {
  expect(placesOf(await definitionAt(CHECKOUT, '$this->mailer->send(...)', 'send'))).toEqual(['Legacy_Mailer::send vendor/legacy/mailer/Mailer.php:5 exact'])
  expect((await definitionAt(CHECKOUT, "$day->format('Y') . $each->label()", 'label')).targets.map(target => target.certainty)).toEqual(['candidate'])
})

test('a definition reads only the files its hops go through', async () => {
  const workspace = createShopWorkspace()
  const readPaths: string[] = []
  const recordingWorkspace = { ...workspace, readFile: (path: string) => (readPaths.push(path), workspace.readFile(path)) }
  await resolvePhpDefinition(recordingWorkspace, shopPosition(CHECKOUT, '$this->orders->save($order)', 'save'))
  expect(readPaths.sort()).toEqual(['src/Repository/OrderRepository.php', 'src/Service/Checkout.php', 'vendor/composer/autoload_psr4.php'])
})

test('a file that does not exist and a position past the end answer nothing', async () => {
  const workspace = createShopWorkspace()
  expect((await resolvePhpDefinition(workspace, { path: 'src/Missing.php', line: 3, column: 2 })).symbol).toBe(null)
  expect((await resolvePhpDefinition(workspace, { path: CHECKOUT, line: 9000, column: 0 })).symbol).toBe(null)
})
