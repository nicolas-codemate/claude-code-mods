import { expect, test } from 'claude-code/testing'

import { classReferenceAt, readPhpClick } from './click'
import type { PhpClick } from './click'
import { parsePhpOutline } from './outline'

const BASKET = `<?php

namespace Shop\\Service;

use Shop\\Entity\\{Order, Money as Amount};
use Shop\\Contract\\Priced;
use function Shop\\format_price;
use const Shop\\DEFAULT_CURRENCY;

/**
 * @template T of Order
 * @extends AbstractBasket<Order>
 */
#[AsService(tags: [Priced::class])]
final class Basket extends AbstractBasket implements Priced, \\Countable
{
    use Loggable;

    public const LIMIT = 10;

    private ?Order $current = null;

    public function __construct(private readonly Amount $total, int $limit = self::LIMIT)
    {
    }

    /**
     * @param Order[] $orders the Orders to add
     * @return T|null
     * @throws \\Shop\\Failure
     */
    public function add(array $orders, callable $onAdd): ?Amount
    {
        $first = $orders[0] ?? new Order();
        $first->getLines()?->first();
        $label = format_price($this->total) . DEFAULT_CURRENCY . PHP_EOL . strtoupper('order');
        static::$instances[] = $this;
        if ($first instanceof Priced) {
            return Amount::zero();
        }
        try {
            parent::add(orders: $orders);
        } catch (Failure | \\Throwable $failure) {
            return $this->current->status === Status::Paid ? null : $this->total;
        }

        return match (true) { default => $onAdd($first) };
    }
}
`

const outline = parsePhpOutline('src/Service/Basket.php', BASKET)

// The click on the middle of a name inside a snippet of the file.
function clickOn(snippet: string, name: string): PhpClick {
  const snippetOffset = BASKET.indexOf(snippet)
  if (snippetOffset === -1 || BASKET.indexOf(snippet, snippetOffset + 1) !== -1) {
    throw new Error(`"${snippet}" must appear exactly once`)
  }

  return readPhpClick(outline, snippetOffset + snippet.lastIndexOf(name) + Math.floor(name.length / 2))
}

function summaryOf(click: PhpClick): string {
  switch (click.kind) {
    case 'none':
      return 'none'
    case 'declaration':
      return `declaration of ${click.declaration.kind}`
    case 'classReference':
      return `class ${click.fullyQualifiedName}`
    case 'memberAccess':
      return `${click.memberKind} ${click.name}`
    case 'memberOfNamedClass':
      return `member ${click.name} of ${click.fullyQualifiedName}`
    case 'functionCall':
      return `function ${click.writtenName}`
    case 'variable':
      return `variable ${click.name}`
    case 'constantReference':
      return `constant ${click.name}`
    default: {
      const unhandledClick: never = click

      return unhandledClick
    }
  }
}

test('a member access is a method when called, a property or a constant otherwise', async () => {
  expect(summaryOf(clickOn('$first->getLines()', 'getLines'))).toBe('method getLines')
  expect(summaryOf(clickOn('?->first()', 'first'))).toBe('method first')
  expect(summaryOf(clickOn('$this->current->status', 'current'))).toBe('property current')
  expect(summaryOf(clickOn('$this->current->status', 'status'))).toBe('property status')
  expect(summaryOf(clickOn('Amount::zero()', 'zero'))).toBe('method zero')
  expect(summaryOf(clickOn('Status::Paid', 'Paid'))).toBe('constant Paid')
  expect(summaryOf(clickOn('= self::LIMIT', 'LIMIT'))).toBe('constant LIMIT')
  expect(summaryOf(clickOn('static::$instances', '$instances'))).toBe('property instances')
  expect(summaryOf(clickOn('parent::add(orders', 'add'))).toBe('method add')
})

test('a name where a class stands is a class reference, resolved by the imports and the namespace', async () => {
  expect(summaryOf(clickOn('new Order()', 'Order'))).toBe('class Shop\\Entity\\Order')
  expect(summaryOf(clickOn('private ?Order $current', 'Order'))).toBe('class Shop\\Entity\\Order')
  expect(summaryOf(clickOn('private readonly Amount $total', 'Amount'))).toBe('class Shop\\Entity\\Money')
  expect(summaryOf(clickOn('callable $onAdd): ?Amount', 'Amount'))).toBe('class Shop\\Entity\\Money')
  expect(summaryOf(clickOn('extends AbstractBasket implements', 'AbstractBasket'))).toBe('class Shop\\Service\\AbstractBasket')
  expect(summaryOf(clickOn('implements Priced, \\Countable', 'Priced'))).toBe('class Shop\\Contract\\Priced')
  expect(summaryOf(clickOn('implements Priced, \\Countable', 'Countable'))).toBe('class Countable')
  expect(summaryOf(clickOn('use Loggable;', 'Loggable'))).toBe('class Shop\\Service\\Loggable')
  expect(summaryOf(clickOn('$first instanceof Priced', 'Priced'))).toBe('class Shop\\Contract\\Priced')
  expect(summaryOf(clickOn('catch (Failure | \\Throwable', 'Failure'))).toBe('class Shop\\Service\\Failure')
  expect(summaryOf(clickOn('#[AsService(tags', 'AsService'))).toBe('class Shop\\Service\\AsService')
  expect(summaryOf(clickOn('tags: [Priced::class]', 'Priced'))).toBe('class Shop\\Contract\\Priced')
  expect(summaryOf(clickOn('Amount::zero()', 'Amount'))).toBe('class Shop\\Entity\\Money')
})

test('the names of a use statement are references to what they import', async () => {
  expect(summaryOf(clickOn('use Shop\\Contract\\Priced;', 'Priced'))).toBe('class Shop\\Contract\\Priced')
  expect(summaryOf(clickOn('{Order, Money as Amount}', 'Order'))).toBe('class Shop\\Entity\\Order')
  expect(summaryOf(clickOn('{Order, Money as Amount}', 'Money'))).toBe('class Shop\\Entity\\Money')
  expect(summaryOf(clickOn('{Order, Money as Amount}', 'Amount'))).toBe('class Shop\\Entity\\Money')
  expect(summaryOf(clickOn('use function Shop\\format_price;', 'format_price'))).toBe('function \\Shop\\format_price')
  expect(summaryOf(clickOn('use const Shop\\DEFAULT_CURRENCY;', 'DEFAULT_CURRENCY'))).toBe('constant Shop\\DEFAULT_CURRENCY')
})

test('self, static, parent and $this are references to the class around', async () => {
  expect(summaryOf(clickOn('= self::LIMIT', 'self'))).toBe('class Shop\\Service\\Basket')
  expect(summaryOf(clickOn('static::$instances', 'static'))).toBe('class Shop\\Service\\Basket')
  expect(summaryOf(clickOn('parent::add(orders', 'parent'))).toBe('class Shop\\Service\\AbstractBasket')
  expect(summaryOf(clickOn('[] = $this;', '$this'))).toBe('class Shop\\Service\\Basket')
})

test('the name right after a declaring keyword is a declaration', async () => {
  expect(summaryOf(clickOn('final class Basket extends', 'Basket'))).toBe('declaration of class')
  expect(summaryOf(clickOn('public function add(', 'add'))).toBe('declaration of method')
  expect(summaryOf(clickOn('public const LIMIT = 10', 'LIMIT'))).toBe('declaration of constant')
  expect(summaryOf(clickOn('private ?Order $current', '$current'))).toBe('declaration of property')
  expect(summaryOf(clickOn('private readonly Amount $total', '$total'))).toBe('declaration of property')
  expect(summaryOf(clickOn('int $limit = self', '$limit'))).toBe('declaration of parameter')
})

test('variables, plain function calls and constants are told apart', async () => {
  expect(summaryOf(clickOn('$first->getLines()', '$first'))).toBe('variable $first')
  expect(summaryOf(clickOn('$onAdd($first)', '$onAdd'))).toBe('variable $onAdd')
  expect(summaryOf(clickOn('format_price($this->total)', 'format_price'))).toBe('function format_price')
  expect(summaryOf(clickOn("strtoupper('order')", 'strtoupper'))).toBe('function strtoupper')
  expect(summaryOf(clickOn('. DEFAULT_CURRENCY .', 'DEFAULT_CURRENCY'))).toBe('constant DEFAULT_CURRENCY')
  expect(summaryOf(clickOn('. PHP_EOL .', 'PHP_EOL'))).toBe('constant PHP_EOL')
  expect(summaryOf(readPhpClick(parsePhpOutline('src/a.php', '<?php echo __DIR__;'), 13))).toBe('none')
})

test('class names in the types of docblock tags are references, placeholders and builtins are not', async () => {
  expect(summaryOf(clickOn('@param Order[] $orders', 'Order'))).toBe('class Shop\\Entity\\Order')
  expect(summaryOf(clickOn('@throws \\Shop\\Failure', 'Failure'))).toBe('class Shop\\Failure')
  expect(summaryOf(clickOn('@template T of Order', 'Order'))).toBe('class Shop\\Entity\\Order')
  expect(summaryOf(clickOn('@extends AbstractBasket<Order>', 'AbstractBasket'))).toBe('class Shop\\Service\\AbstractBasket')
  expect(summaryOf(clickOn('@return T|null', 'T'))).toBe('none')
  expect(summaryOf(clickOn('@return T|null', 'null'))).toBe('none')
  expect(summaryOf(clickOn('$orders the Orders to add', 'Orders'))).toBe('none')
})

test('keywords, builtin types, named arguments, strings and ::class answer nothing', async () => {
  expect(summaryOf(clickOn('return match (true)', 'match'))).toBe('none')
  expect(summaryOf(clickOn('return match (true)', 'return'))).toBe('none')
  expect(summaryOf(clickOn('add(array $orders, callable', 'array'))).toBe('none')
  expect(summaryOf(clickOn('parent::add(orders:', 'orders'))).toBe('none')
  expect(summaryOf(clickOn("strtoupper('order')", 'order'))).toBe('none')
  expect(summaryOf(clickOn('[Priced::class]', 'class'))).toBe('none')
  expect(summaryOf(clickOn('namespace Shop\\Service;', 'Service'))).toBe('none')
  expect(summaryOf(clickOn('? null : $this->total', 'null'))).toBe('none')
})

test('a click right after the last letter of a name still reads that name', async () => {
  const offsetAfterName = BASKET.indexOf('getLines()') + 'getLines'.length
  expect(summaryOf(readPhpClick(outline, offsetAfterName - 8))).toBe('method getLines')
  expect(readPhpClick(outline, BASKET.indexOf('    use Loggable;'))).toEqual({ kind: 'none' })
  expect(readPhpClick(outline, BASKET.length + 50)).toEqual({ kind: 'none' })
})

test('the range of a click covers the whole name, a qualified one included', async () => {
  const click = clickOn('implements Priced, \\Countable', 'Countable')
  expect(click.kind === 'classReference' ? BASKET.slice(click.range.start, click.range.end) : null).toBe('\\Countable')
})

test('only the names standing where a class does resolve to a class', async () => {
  const tokenIndexOf = (text: string) => outline.source.tokens.findIndex(token => token.text === text)
  expect(classReferenceAt(outline, tokenIndexOf('AbstractBasket'))).toBe('Shop\\Service\\AbstractBasket')
  expect(classReferenceAt(outline, tokenIndexOf('format_price'))).toBe(null)
  expect(classReferenceAt(outline, tokenIndexOf('getLines'))).toBe(null)
  expect(classReferenceAt(outline, tokenIndexOf('int'))).toBe(null)
  expect(classReferenceAt(outline, tokenIndexOf('Basket'))).toBe(null)
})
