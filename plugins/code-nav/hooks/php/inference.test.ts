import { expect, test } from 'claude-code/testing'

import { parseTypeAt, preferredDeclaredType, receiverTypeOfMemberAccess } from './inference'
import { createPhpProject, outlineOfText } from './project'
import { createShopWorkspace } from './shop-project'
import { parsePhpType, typeLabelOf } from './type-expression'
import type { PhpType } from './type-expression'

const SANDBOX = 'src/Service/Sandbox.php'
const SANDBOX_HEADER = `<?php

namespace Shop\\Service;

use Doctrine\\Common\\Collections\\Collection;
use Doctrine\\ORM\\EntityManagerInterface;
use Shop\\Entity\\Customer;
use Shop\\Entity\\Invoice;
use Shop\\Entity\\Money;
use Shop\\Entity\\Order;
use Shop\\Entity\\OrderStatus;
use Shop\\Entity\\Product;
use Shop\\Repository\\OrderRepository;
use function Shop\\zero_money;

`

// The type of what stands before the last "->probe" or "::probe" of a body written inside a class of the shop.
async function receiverTypeIn(classBody: string, additionalFiles: Record<string, string> = {}): Promise<string> {
  const text = `${SANDBOX_HEADER}class Sandbox extends AbstractSandbox\n{\n${classBody}\n}\n`
  const project = createPhpProject(createShopWorkspace({ [SANDBOX]: text, ...additionalFiles }))
  const outline = await project.outlineOfFile(SANDBOX)
  if (outline === null) {
    return 'no outline'
  }
  const probeTokenIndex = outline.source.tokens.findLastIndex(token => token.text === 'probe')

  return typeLabelOf(await receiverTypeOfMemberAccess({ project, outline }, probeTokenIndex))
}

function typeIn(methodBody: string, signature = 'public function run(Order $order, $unknown): void'): Promise<string> {
  return receiverTypeIn(`    ${signature}\n    {\n${methodBody}\n    }`)
}

test('$this, self, static, parent and a class name give the class they stand for', async () => {
  expect(await typeIn('$this->probe();')).toBe('Shop\\Service\\Sandbox')
  expect(await typeIn('self::probe();')).toBe('Shop\\Service\\Sandbox')
  expect(await typeIn('static::probe();')).toBe('Shop\\Service\\Sandbox')
  expect(await typeIn('parent::probe();')).toBe('Shop\\Service\\AbstractSandbox')
  expect(await typeIn('Money::probe();')).toBe('Shop\\Entity\\Money')
  expect(await typeIn('\\Legacy_Mailer::probe();')).toBe('Legacy_Mailer')
})

test('a property takes its native type, a promoted parameter its own, a var docblock when nothing is native', async () => {
  const properties = `    private Order $current;
    /** @var Collection<int, Invoice> */
    private Collection $invoices;
    /** @var Customer|null */
    private $customer;
    private $assigned;
    private $untyped;

    public function __construct(private readonly OrderRepository $orders, Product $product)
    {
        $this->assigned = $product;
    }
`
  const probe = (expression: string) => receiverTypeIn(`${properties}    public function run(): void\n    {\n        ${expression}->probe();\n    }`)
  expect(await probe('$this->current')).toBe('Shop\\Entity\\Order')
  expect(await probe('$this->orders')).toBe('Shop\\Repository\\OrderRepository')
  expect(await probe('$this->invoices')).toBe('Doctrine\\Common\\Collections\\Collection<int, Shop\\Entity\\Invoice>')
  expect(await probe('$this->customer')).toBe('Shop\\Entity\\Customer|null')
  expect(await probe('$this->assigned')).toBe('Shop\\Entity\\Product')
  expect(await probe('$this->untyped')).toBe('')
  expect(await probe('$this->missing')).toBe('')
})

test('a parameter takes its native type first, its param docblock otherwise or when it says more', async () => {
  const signature = `/**
     * @param Order[] $orders
     * @param Customer $customer
     * @param Collection<int, Product> $products
     * @param Invoice $document
     */
    public function run(array $orders, $customer, Collection $products, Order|Invoice $document, Money ...$amounts): void`
  expect(await typeIn('$orders->probe();', signature)).toBe('array<Shop\\Entity\\Order>')
  expect(await typeIn('$customer->probe();', signature)).toBe('Shop\\Entity\\Customer')
  expect(await typeIn('$products->probe();', signature)).toBe('Doctrine\\Common\\Collections\\Collection<int, Shop\\Entity\\Product>')
  expect(await typeIn('$document->probe();', signature)).toBe('Shop\\Entity\\Order|Shop\\Entity\\Invoice')
  expect(await typeIn('$amounts->probe();', signature)).toBe('array<Shop\\Entity\\Money>')
  expect(await typeIn('$amounts[0]->probe();', signature)).toBe('Shop\\Entity\\Money')
})

test('a closure and an arrow function type their own parameters and see the variables around them', async () => {
  expect(await typeIn('$run = function (Invoice $invoice) { $invoice->probe(); };')).toBe('Shop\\Entity\\Invoice')
  expect(await typeIn('$run = fn (Invoice $invoice) => $invoice->probe();')).toBe('Shop\\Entity\\Invoice')
  expect(await typeIn('$run = fn ($x) => $order->probe();')).toBe('Shop\\Entity\\Order')
  expect(await typeIn('$run = function () use ($order) { $order->probe(); };')).toBe('Shop\\Entity\\Order')
  expect(await typeIn('$run = function () { $order->probe(); };')).toBe('')
  expect(await typeIn('$run = function () { $inner = new Money(1, "EUR"); }; $inner->probe();')).toBe('')
  expect(await typeIn('$run = fn ($each) => $each->probe();')).toBe('')
})

test('a variable takes the type of its nearest earlier assignment, read recursively', async () => {
  expect(await typeIn('$invoice = new Invoice($order);\n$invoice->probe();')).toBe('Shop\\Entity\\Invoice')
  expect(await typeIn('$total = $order->getTotal();\n$sum = $total->add($total);\n$sum->probe();')).toBe('Shop\\Entity\\Money')
  expect(await typeIn('$value = new Invoice($order);\n$value = $order->getCustomer();\n$value->probe();')).toBe('null|Shop\\Entity\\Customer')
  expect(await typeIn('$order = $order->markPaid();\n$order->probe();')).toBe('Shop\\Entity\\Order')
  expect(await typeIn('$value = $unknown;\n$value->probe();')).toBe('')
  expect(await typeIn('if ($found = $order->getCustomer()) { $found->probe(); }')).toBe('null|Shop\\Entity\\Customer')
  expect(await typeIn('$later->probe();\n$later = new Money(1, "EUR");')).toBe('')
})

test('an assignment the click stands inside does not type its own variable', async () => {
  expect(await typeIn('$current = new Invoice($order);\n$current = $current->probe();')).toBe('Shop\\Entity\\Invoice')
})

test('a var docblock above an assignment or naming a variable wins over what is assigned', async () => {
  expect(await typeIn('/** @var Customer $guest */\n$guest = $unknown->load();\n$guest->probe();')).toBe('Shop\\Entity\\Customer')
  expect(await typeIn('/** @var Product[] */\n$products = $unknown->all();\n$products->probe();')).toBe('array<Shop\\Entity\\Product>')
  expect(await typeIn('$thing = $unknown;\n/** @var Invoice $thing */\n$thing->probe();')).toBe('Shop\\Entity\\Invoice')
})

test('a catch types its variable with every class it names', async () => {
  expect(await typeIn('try { } catch (CheckoutFailed | \\RuntimeException $failure) { $failure->probe(); }')).toBe('Shop\\Service\\CheckoutFailed|RuntimeException')
})

test('a foreach value takes the element of a documented list, of a generic collection or of a class documenting what it iterates', async () => {
  const basket = {
    'src/Entity/Basket.php':
      '<?php\nnamespace Shop\\Entity;\n/**\n * @implements \\IteratorAggregate<int, Product>\n */\nclass Basket implements \\IteratorAggregate {}\n',
  }
  expect(await typeIn('foreach ($order->getProducts() as $product) { $product->probe(); }')).toBe('Shop\\Entity\\Product')
  expect(await typeIn('foreach ($order->getLines() as $index => $line) { $line->probe(); }')).toBe('Shop\\Entity\\OrderLine')
  expect(await typeIn('foreach ($order->getLines() as $index => $line) { $index->probe(); }')).toBe('')
  expect(await typeIn('foreach ($order->getLines()->toArray() as $line) { $line->probe(); }')).toBe('Shop\\Entity\\OrderLine')
  expect(await typeIn('foreach ($unknown as $item) { $item->probe(); }')).toBe('')
  expect(
    await receiverTypeIn('    public function run(\\Shop\\Entity\\Basket $basket): void\n    {\n        foreach ($basket as $product) { $product->probe(); }\n    }', basket),
  ).toBe('Shop\\Entity\\Product')
})

test('a list built by appending and an array literal know their elements', async () => {
  expect(await typeIn('$invoices = [];\n$invoices[] = new Invoice($order);\nforeach ($invoices as $invoice) { $invoice->probe(); }')).toBe('Shop\\Entity\\Invoice')
  expect(await typeIn('$pair = [new Money(1, "EUR"), new Money(2, "EUR")];\n$pair[1]->probe();')).toBe('Shop\\Entity\\Money')
  expect(await typeIn('$byName = ["first" => $order];\nforeach ($byName as $each) { $each->probe(); }')).toBe('Shop\\Entity\\Order')
})

test('a destructured variable takes its entry of an array shape, or the element of a plain list', async () => {
  const pair = `    /**
     * @return array{0: Invoice, 1: Customer, total: Money}
     */
    private function pair(): array
    {
    }
`
  const probe = (body: string) => receiverTypeIn(`${pair}    public function run(Order $order): void\n    {\n${body}\n    }`)
  expect(await probe('[$invoice, $customer] = $this->pair();\n$customer->probe();')).toBe('Shop\\Entity\\Customer')
  expect(await probe('[$invoice, $customer] = $this->pair();\n$invoice->probe();')).toBe('Shop\\Entity\\Invoice')
  expect(await probe("['total' => $total] = $this->pair();\n$total->probe();")).toBe('Shop\\Entity\\Money')
  expect(await probe("$this->pair()['total']->probe();")).toBe('Shop\\Entity\\Money')
  expect(await probe('list($first, $second) = $order->getProducts();\n$second->probe();')).toBe('Shop\\Entity\\Product')
  expect(await probe('$rows[$order] = 1;\n$order->probe();')).toBe('Shop\\Entity\\Order')
})

test('an instanceof check types the variable where it holds, and nowhere else', async () => {
  const signature = 'public function run($document, $unknown): void'
  expect(await typeIn('if ($document instanceof Invoice) { $document->probe(); }', signature)).toBe('Shop\\Entity\\Invoice')
  expect(await typeIn('if ($document instanceof Invoice && $document->probe()) { }', signature)).toBe('Shop\\Entity\\Invoice')
  expect(await typeIn('if ($document instanceof Invoice) { }\n$document->probe();', signature)).toBe('')
  expect(await typeIn('if (!$document instanceof Invoice) { return; }\n$document->probe();', signature)).toBe('Shop\\Entity\\Invoice')
  expect(await typeIn('if (!($document instanceof Invoice)) { throw new \\LogicException(); }\n$document->probe();', signature)).toBe('Shop\\Entity\\Invoice')
  expect(await typeIn('if (!$document instanceof Invoice) { $x = 1; }\n$document->probe();', signature)).toBe('')
  expect(await typeIn('\\assert($document instanceof Order);\n$document->probe();', signature)).toBe('Shop\\Entity\\Order')
  expect(await typeIn('return $document instanceof Invoice ? $document->probe() : null;', signature)).toBe('Shop\\Entity\\Invoice')
})

test('an instanceof check on a property of the class types that property where it holds', async () => {
  const body = `    private HasTotal $subject;

    public function run(): void
    {
        if ($this->subject instanceof Invoice) {
            $this->subject->probe();
        }
    }`
  expect(await receiverTypeIn(body)).toBe('Shop\\Entity\\Invoice')
})

test('a call gives the declared return type of its method, looked up through traits, parents and interfaces', async () => {
  expect(await typeIn('$order->getTotal()->probe();')).toBe('Shop\\Entity\\Money')
  expect(await typeIn('$order->getCustomer()->probe();')).toBe('null|Shop\\Entity\\Customer')
  expect(await typeIn('$order->getProducts()->probe();')).toBe('array<Shop\\Entity\\Product>')
  expect(await typeIn('Money::zero()->probe();')).toBe('Shop\\Entity\\Money')
  expect(await typeIn('(new CheckoutFailed($order))->getOrder()->probe();')).toBe('Shop\\Entity\\Order')
  expect(await typeIn('$credit = new \\Shop\\Entity\\CreditNote($order);\n$credit->getOrder()->probe();')).toBe('Shop\\Entity\\Order')
  expect(await typeIn('$order->missing()->probe();')).toBe('')
  expect(await typeIn('zero_money()->probe();')).toBe('Shop\\Entity\\Money')
})

test('static, self and $this as a return type mean the receiver, through a whole fluent chain', async () => {
  expect(await typeIn('$order->markPaid()->probe();')).toBe('Shop\\Entity\\Order')
  expect(await typeIn('$total = $order->getTotal();\n$total->add($total)->probe();')).toBe('Shop\\Entity\\Money')
  const signature = 'public function run(\\Doctrine\\ORM\\QueryBuilder $query): void'
  expect(await typeIn('$query\n    ->where("a")\n    ->setParameter("a", 1)\n    ->probe();', signature)).toBe('Doctrine\\ORM\\QueryBuilder')
})

test('a repository documented as extending a generic one answers its entity', async () => {
  const signature = 'public function run(OrderRepository $orders, EntityManagerInterface $entityManager): void'
  expect(await typeIn('$orders->find(1)->probe();', signature)).toBe('Shop\\Entity\\Order|null')
  expect(await typeIn('$orders->findAll()->probe();', signature)).toBe('list<Shop\\Entity\\Order>')
  expect(await typeIn('foreach ($orders->findAll() as $each) { $each->probe(); }', signature)).toBe('Shop\\Entity\\Order')
  expect(await typeIn('$orders->findPaid()[0]->probe();', signature)).toBe('Shop\\Entity\\Order')
})

test('a placeholder of a method is bound by the class name given as argument', async () => {
  const signature = 'public function run(EntityManagerInterface $entityManager): void'
  expect(await typeIn('$entityManager->getRepository(Product::class)->probe();', signature)).toBe('Doctrine\\ORM\\EntityRepository<Shop\\Entity\\Product>')
  expect(await typeIn('$entityManager->getRepository(Product::class)->find(1)->probe();', signature)).toBe('Shop\\Entity\\Product|null')
  expect(await typeIn('$repository = $entityManager->getRepository(Customer::class);\n$one = $repository->find(1);\n$one->probe();', signature)).toBe(
    'Shop\\Entity\\Customer|null',
  )
})

test('getRepository answers the repository an entity names in its own mapping', async () => {
  const files = {
    'src/Entity/Coupon.php':
      '<?php\nnamespace Shop\\Entity;\nuse Shop\\Repository\\CouponRepository;\n#[ORM\\Entity(repositoryClass: CouponRepository::class)]\nclass Coupon {}\n',
    'src/Repository/CouponRepository.php':
      '<?php\nnamespace Shop\\Repository;\nuse Doctrine\\Bundle\\ServiceEntityRepository;\nuse Shop\\Entity\\Coupon;\n/** @extends ServiceEntityRepository<Coupon> */\nclass CouponRepository extends ServiceEntityRepository {}\n',
  }
  const body = (expression: string) =>
    `    public function run(EntityManagerInterface $entityManager): void\n    {\n        ${expression}->probe();\n    }`
  expect(await receiverTypeIn(body('$entityManager->getRepository(\\Shop\\Entity\\Coupon::class)'), files)).toBe('Shop\\Repository\\CouponRepository')
  expect(await receiverTypeIn(body('$entityManager->getRepository(\\Shop\\Entity\\Coupon::class)->find(1)'), files)).toBe('Shop\\Entity\\Coupon|null')
})

test('a class documented as implementing a generic interface binds the placeholders of that interface', async () => {
  const files = {
    'src/Entity/OrderList.php':
      '<?php\nnamespace Shop\\Entity;\nuse Doctrine\\Common\\Collections\\Collection;\n/**\n * @implements Collection<int, Order>\n */\nabstract class OrderList implements Collection {}\n',
  }
  const body = '    public function run(\\Shop\\Entity\\OrderList $list): void\n    {\n        $list->first()->probe();\n    }'
  expect(await receiverTypeIn(body, files)).toBe('Shop\\Entity\\Order|false')
})

test('a generic collection gives its element through its own methods', async () => {
  expect(await typeIn('$order->getLines()->first()->probe();')).toBe('Shop\\Entity\\OrderLine|false')
  expect(await typeIn('$order->getLines()->toArray()->probe();')).toBe('array<int, Shop\\Entity\\OrderLine>')
  expect(await typeIn('$order->getLines()->first()->getProduct()->probe();')).toBe('Shop\\Entity\\Product')
})

test('enum cases and the functions every enum has give the enum', async () => {
  expect(await typeIn('OrderStatus::Paid->probe();')).toBe('Shop\\Entity\\OrderStatus')
  expect(await typeIn('OrderStatus::from("paid")->probe();')).toBe('Shop\\Entity\\OrderStatus')
  expect(await typeIn('OrderStatus::tryFrom("paid")?->probe();')).toBe('Shop\\Entity\\OrderStatus')
  expect(await typeIn('foreach (OrderStatus::cases() as $status) { $status->probe(); }')).toBe('Shop\\Entity\\OrderStatus')
  expect(await typeIn('Order::STATUS_PAID->probe();')).toBe('')
})

test('ternaries, coalescing and match keep every class they may give', async () => {
  expect(await typeIn('$subject = $unknown ? $order : new Invoice($order);\n$subject->probe();')).toBe('Shop\\Entity\\Order|Shop\\Entity\\Invoice')
  expect(await typeIn('$subject = $order->getCustomer() ?? new Customer();\n$subject->probe();')).toBe('null|Shop\\Entity\\Customer')
  expect(await typeIn('$subject = match (true) { $unknown => $order, default => $order->getTotal() };\n$subject->probe();')).toBe('Shop\\Entity\\Order|Shop\\Entity\\Money')
})

test('functions that give back their argument or one of its elements keep its type', async () => {
  expect(await typeIn('foreach (array_filter($order->getProducts()) as $product) { $product->probe(); }')).toBe('Shop\\Entity\\Product')
  expect(await typeIn('$first = reset($order->getProducts());\n$first->probe();')).toBe('Shop\\Entity\\Product')
  expect(await typeIn('$count = count($order->getProducts());\n$count->probe();')).toBe('')
})

test('a value given by a class of PHP itself is known as such', async () => {
  const signature = 'public function run(\\DateTimeImmutable $day): void'
  expect(await typeIn('$day->probe();', signature)).toBe('DateTimeImmutable')
  expect(await typeIn('$day->modify("+1 day")->probe();', signature)).toBe('php-own-value')
})

test('unreadable constructs give no type instead of throwing', async () => {
  expect(await typeIn('$$name->probe();')).toBe('')
  expect(await typeIn('$object->{$name}->probe();')).toBe('')
  expect(await typeIn('${"a"}->probe();')).toBe('')
  expect(await typeIn('(function () { return 1; })()->probe();')).toBe('')
  expect(await typeIn('"text"->probe();')).toBe('scalar')
  expect(await typeIn('$a = $b; $b = $a; $a->probe();')).toBe('')
})

test('the native type gives way to the docblock only when it says less', async () => {
  const outline = outlineOfText('src/a.php', '<?php\nnamespace Shop;\nclass A {}\n')
  const typed = (typeText: string): PhpType => parseTypeAt(outline, typeText, 0)
  expect(typeLabelOf(preferredDeclaredType(typed('array'), typed('Order[]')))).toBe('array<Shop\\Order>')
  expect(typeLabelOf(preferredDeclaredType(typed('Collection'), typed('Collection<int, Order>')))).toBe('Shop\\Collection<int, Shop\\Order>')
  expect(typeLabelOf(preferredDeclaredType(typed('OrderInterface'), typed('Order')))).toBe('Shop\\OrderInterface')
  expect(typeLabelOf(preferredDeclaredType(typed('?Order'), []))).toBe('null|Shop\\Order')
  expect(typeLabelOf(preferredDeclaredType([], typed('Order')))).toBe('Shop\\Order')
  expect(typeLabelOf(parsePhpType('T', () => ({ kind: 'template', name: 'T' })))).toBe('T')
})
