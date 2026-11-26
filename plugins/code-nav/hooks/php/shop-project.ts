import type { CodePosition } from '../../types'
import { createMemoryWorkspace } from '../test-workspace'
import type { Workspace } from '../workspace'
import { phpSymbolsOfFile } from './symbols'

// A made-up shop, for the tests: its own code under src/, two dependencies under vendor/ located by Composer's tables.
export const SHOP_FILES: Record<string, string> = {
  'composer.json': '{ "autoload": { "psr-4": { "Shop\\\\": "src/" } } }',
  'vendor/composer/autoload_psr4.php': `<?php

$vendorDir = dirname(__DIR__);
$baseDir = dirname($vendorDir);

return array(
    'Shop\\\\' => array($baseDir . '/src'),
    'Doctrine\\\\ORM\\\\' => array($vendorDir . '/doctrine/orm/src'),
    'Doctrine\\\\Bundle\\\\' => array($vendorDir . '/doctrine/bundle/src'),
    'Doctrine\\\\Common\\\\Collections\\\\' => array($vendorDir . '/doctrine/collections/legacy', $vendorDir . '/doctrine/collections/src'),
);
`,
  'vendor/composer/autoload_classmap.php': `<?php

$vendorDir = dirname(__DIR__);
$baseDir = dirname($vendorDir);

return array(
    'Legacy_Mailer' => $vendorDir . '/legacy/mailer/Mailer.php',
);
`,
  'vendor/doctrine/orm/src/EntityRepository.php': `<?php

namespace Doctrine\\ORM;

/**
 * @template T of object
 */
class EntityRepository
{
    /**
     * @return object|null
     * @psalm-return T|null
     */
    public function find(mixed $id): ?object
    {
    }

    /**
     * @psalm-return list<T>
     */
    public function findAll(): array
    {
    }

    public function createQueryBuilder(string $alias): QueryBuilder
    {
    }
}
`,
  'vendor/doctrine/orm/src/QueryBuilder.php': `<?php

namespace Doctrine\\ORM;

class QueryBuilder
{
    public function where(string $predicate): static
    {
        return $this;
    }

    public function setParameter(string $key, mixed $value): static
    {
        return $this;
    }

    public function getResult(): mixed
    {
    }
}
`,
  'vendor/doctrine/orm/src/EntityManagerInterface.php': `<?php

namespace Doctrine\\ORM;

interface EntityManagerInterface
{
    /**
     * @param class-string<T> $className
     *
     * @return EntityRepository<T>
     *
     * @template T of object
     */
    public function getRepository(string $className): EntityRepository;

    public function persist(object $entity): void;

    public function flush(): void;
}
`,
  'vendor/doctrine/bundle/src/ServiceEntityRepository.php': `<?php

namespace Doctrine\\Bundle;

use Doctrine\\ORM\\EntityRepository;

/**
 * @template T of object
 * @template-extends EntityRepository<T>
 */
class ServiceEntityRepository extends EntityRepository
{
}
`,
  'vendor/doctrine/collections/src/Collection.php': `<?php

namespace Doctrine\\Common\\Collections;

/**
 * @template TKey of array-key
 * @template T
 */
interface Collection
{
    /**
     * @return T|false
     */
    public function first();

    /**
     * @return array<TKey, T>
     */
    public function toArray(): array;

    public function count(): int;
}
`,
  'vendor/doctrine/collections/src/ArrayCollection.php': `<?php

namespace Doctrine\\Common\\Collections;

/**
 * @template TKey of array-key
 * @template T
 * @implements Collection<TKey, T>
 */
class ArrayCollection implements Collection
{
    public function first()
    {
    }

    public function toArray(): array
    {
    }

    public function count(): int
    {
    }
}
`,
  'vendor/legacy/mailer/Mailer.php': `<?php

class Legacy_Mailer
{
    public function send(string $recipient): bool
    {
    }

    public function sendLater(string $recipient): bool
    {
    }
}
`,
  'src/functions.php': `<?php

namespace Shop;

use Shop\\Entity\\Money;

function format_price(Money $money): string
{
    return sprintf('%d %s', $money->amount, $money->currency);
}

function zero_money(): Money
{
    return Money::zero();
}
`,
  'src/Entity/Money.php': `<?php

namespace Shop\\Entity;

final class Money
{
    public function __construct(
        public readonly int $amount,
        public readonly string $currency,
    ) {
    }

    public static function zero(): self
    {
        return new self(0, 'EUR');
    }

    public function add(Money $other): self
    {
        return new self($this->amount + $other->amount, $this->currency);
    }
}
`,
  'src/Entity/HasTotal.php': `<?php

namespace Shop\\Entity;

interface HasTotal
{
    public function getTotal(): Money;
}
`,
  'src/Entity/OrderStatus.php': `<?php

namespace Shop\\Entity;

enum OrderStatus: string
{
    case Paid = 'paid';
    case Pending = 'pending';

    public function label(): string
    {
        return ucfirst($this->value);
    }
}
`,
  'src/Entity/Customer.php': `<?php

namespace Shop\\Entity;

class Customer
{
    private string $email = '';

    public function getEmail(): string
    {
        return $this->email;
    }

    /**
     * @return array<int, Order>
     */
    public function getOrders(): array
    {
        return [];
    }
}
`,
  'src/Entity/Product.php': `<?php

namespace Shop\\Entity;

class Product
{
    public string $name = '';

    public function getName(): string
    {
        return $this->name;
    }

    public function getPrice(): Money
    {
        return Money::zero();
    }
}
`,
  'src/Entity/OrderLine.php': `<?php

namespace Shop\\Entity;

class OrderLine
{
    private Product $product;

    public function getProduct(): Product
    {
        return $this->product;
    }

    public function getQuantity(): int
    {
        return 1;
    }
}
`,
  'src/Entity/Order.php': `<?php

namespace Shop\\Entity;

use Doctrine\\Common\\Collections\\ArrayCollection;
use Doctrine\\Common\\Collections\\Collection;

#[Entity]
class Order implements HasTotal
{
    public const STATUS_PAID = 'paid';

    private ?Customer $customer = null;

    /** @var Collection<int, OrderLine> */
    private Collection $lines;

    /** @var Product[] */
    private array $products = [];

    private OrderStatus $status = OrderStatus::Pending;

    public function __construct()
    {
        $this->lines = new ArrayCollection();
    }

    public function getId(): int
    {
        return 1;
    }

    public function getCustomer(): ?Customer
    {
        return $this->customer;
    }

    /**
     * @return Collection<int, OrderLine>
     */
    public function getLines(): Collection
    {
        return $this->lines;
    }

    /**
     * @return Product[]
     */
    public function getProducts(): array
    {
        return $this->products;
    }

    public function getTotal(): Money
    {
        return Money::zero();
    }

    public function getStatus(): OrderStatus
    {
        return $this->status;
    }

    public function markPaid(): static
    {
        $this->status = OrderStatus::Paid;

        return $this;
    }
}
`,
  'src/Entity/Invoice.php': `<?php

namespace Shop\\Entity;

class Invoice implements HasTotal
{
    public function __construct(private readonly Order $order)
    {
    }

    public function getId(): int
    {
        return 2;
    }

    public function getOrder(): Order
    {
        return $this->order;
    }

    public function getTotal(): Money
    {
        return $this->order->getTotal();
    }
}
`,
  'src/Entity/CreditNote.php': `<?php

namespace Shop\\Entity;

class CreditNote extends Invoice
{
    public function getTotal(): Money
    {
        return Money::zero();
    }
}
`,
  'src/Repository/OrderFinder.php': `<?php

namespace Shop\\Repository;

use Shop\\Entity\\Order;

interface OrderFinder
{
    public function findLatest(): ?Order;
}
`,
  'src/Repository/OrderRepository.php': `<?php

namespace Shop\\Repository;

use Doctrine\\Bundle\\ServiceEntityRepository;
use Shop\\Entity\\Order;

/**
 * @extends ServiceEntityRepository<Order>
 */
class OrderRepository extends ServiceEntityRepository implements OrderFinder
{
    public function save(Order $order): void
    {
    }

    public function findLatest(): ?Order
    {
        return $this->findAll()[0] ?? null;
    }

    /**
     * @return Order[]
     */
    public function findPaid(): array
    {
        return $this->createQueryBuilder('o')
            ->where('o.status = :status')
            ->setParameter('status', Order::STATUS_PAID)
            ->getResult();
    }
}
`,
  'src/Repository/ProductRepository.php': `<?php

namespace Shop\\Repository;

use Doctrine\\Bundle\\ServiceEntityRepository;
use Shop\\Entity\\Product;

/**
 * @extends ServiceEntityRepository<Product>
 *
 * @method Product|null findOneByName(string $name)
 */
class ProductRepository extends ServiceEntityRepository
{
    public function save(Product $product): void
    {
    }
}
`,
  'src/Service/Loggable.php': `<?php

namespace Shop\\Service;

trait Loggable
{
    protected function log(string $message): void
    {
    }
}
`,
  'src/Service/InvoiceGenerator.php': `<?php

namespace Shop\\Service;

use Shop\\Entity\\Invoice;
use Shop\\Entity\\Order;

class InvoiceGenerator
{
    use Loggable;

    public function generate(Order $order): Invoice
    {
        $this->log('generating');

        return new Invoice($order);
    }
}
`,
  'src/Service/Checkout.php': `<?php

namespace Shop\\Service;

use Doctrine\\ORM\\EntityManagerInterface;
use Shop\\Entity\\{Customer, Money as Amount};
use Shop\\Entity\\Order;
use Shop\\Entity\\OrderStatus;
use Shop\\Repository\\OrderFinder;
use Shop\\Repository\\OrderRepository;
use function Shop\\format_price;

class Checkout
{
    private InvoiceGenerator $invoiceGenerator;

    /** @var OrderFinder */
    private $finder;

    private $mailer;

    public function __construct(
        private readonly OrderRepository $orders,
        private readonly EntityManagerInterface $entityManager,
        InvoiceGenerator $invoiceGenerator,
        \\Legacy_Mailer $mailer,
    ) {
        $this->invoiceGenerator = $invoiceGenerator;
        $this->mailer = $mailer;
    }

    public function pay(Order $order, $unknown): ?Amount
    {
        $this->orders->save($order);
        $invoice = $this->invoiceGenerator->generate($order);
        $total = $invoice->getTotal();
        $paid = $order->markPaid()->getCustomer();
        $latest = $this->orders->find(12);
        $latest->getStatus()->label();
        $unknown->save($order);
        $unknown->getTotal();
        $unknown->sendLater('someone');
        $unknown->vanish();
        $this->mailer->send($paid?->getEmail());
        echo format_price($total), count([1]), OrderStatus::Paid->label();
        if ($order->getStatus() === OrderStatus::from('paid')) {
            return null;
        }

        return $total->add(Amount::zero());
    }

    /**
     * @param Order[] $orders
     * @param iterable<Customer> $customers
     */
    public function summarize(array $orders, iterable $customers, \\DateTimeImmutable $day): string
    {
        foreach ($orders as $order) {
            $order->getTotal();
        }
        foreach ($order->getLines() as $index => $line) {
            $line->getProduct()->getPrice();
        }
        foreach ($customers as $customer) {
            foreach ($customer->getOrders() as $customerOrder) {
                $customerOrder->getId();
            }
        }
        $first = $order->getLines()->first();
        $names = array_map(fn (Order $each) => $each->getCustomer()?->getEmail(), $orders);
        $labels = array_map(function ($each) use ($day) {
            return $day->format('Y') . $each->label();
        }, $orders);
        $repository = $this->entityManager->getRepository(Order::class);
        $found = $repository->find(1);
        $found->getProducts()[0]->getName();
        /** @var Customer $guest */
        $guest = $this->container->get('guest');
        $guest->getEmail();
        try {
            $this->finder->findLatest();
        } catch (CheckoutFailed | \\RuntimeException $failure) {
            $failure->getOrder();
            $failure->getMessage();
        }
        $copy = (clone $found)
            ->markPaid()
            ?->getTotal();
        $maker = new InvoiceGenerator();
        $maker->generate($found)->getOrder();
        $sender = $this->mailer->send(...);

        return static::class . self::describe($found);
    }

    private static function describe(Order $order): string
    {
        return $order instanceof Order ? Order::STATUS_PAID : '';
    }
}
`,
  'src/Service/CheckoutFailed.php': `<?php

namespace Shop\\Service;

use Shop\\Entity\\Order;

class CheckoutFailed extends \\RuntimeException
{
    public function __construct(private Order $order)
    {
        parent::__construct('failed');
    }

    public function getOrder(): Order
    {
        return $this->order;
    }
}
`,
}

export function createShopWorkspace(additionalFiles: Record<string, string> = {}): Workspace {
  return createMemoryWorkspace({ ...SHOP_FILES, ...additionalFiles }, { symbolsOfFile: (path, text) => (path.endsWith('.php') ? phpSymbolsOfFile(path, text) : []) })
}

// The position of a name inside a snippet of a file: positionIn(files, path, '$this->orders->save', 'save') clicks
// in the middle of "save". The snippet must be found once, or the test would click somewhere unexpected.
export function positionIn(files: Record<string, string>, path: string, snippet: string, name: string): CodePosition {
  const text = files[path] ?? ''
  const snippetOffset = text.indexOf(snippet)
  if (snippetOffset === -1 || text.indexOf(snippet, snippetOffset + 1) !== -1) {
    throw new Error(`"${snippet}" must appear exactly once in ${path}`)
  }
  const nameOffsetInSnippet = snippet.lastIndexOf(name)
  if (nameOffsetInSnippet === -1) {
    throw new Error(`"${name}" is not part of "${snippet}"`)
  }
  const offset = snippetOffset + nameOffsetInSnippet + Math.floor(name.length / 2)
  const lineStartOffset = text.lastIndexOf('\n', offset - 1) + 1

  return { path, line: text.slice(0, offset).split('\n').length, column: offset - lineStartOffset }
}

export function shopPosition(path: string, snippet: string, name: string): CodePosition {
  return positionIn(SHOP_FILES, path, snippet, name)
}
