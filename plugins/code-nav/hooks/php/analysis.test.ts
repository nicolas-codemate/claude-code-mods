import { expect, test } from 'claude-code/testing'

import { createMemoryWorkspace } from '../test-workspace'
import { findPhpImplementations, findPhpUsages, phpSymbolsOfFile, resolvePhpDefinition } from './analysis'
import { createShopWorkspace, positionIn } from './shop-project'

const MESSY = `<?php

declare(strict_types=1);

namespace Shop\\Messy;

use Shop\\Entity\\{Order, Money};
use Shop\\Repository\\OrderRepository;

#[AsController]
#[Route('/orders', name: 'orders_')]
final readonly class OrderController extends AbstractController
{
    public function __construct(
        #[Autowire(service: 'shop.orders')]
        private OrderRepository $orders,
        private \\Closure|null $onDone = null,
    ) {
    }

    #[Route(
        path: '/{id}',
        methods: ['GET'],
    )]
    public function show(
        #[MapEntity(id: 'id')]
        Order $order,
        int ...$extras,
    ): Money {
        $sql = <<<SQL
            SELECT * FROM orders WHERE id = {$order->getId()} -- $this->orders->save()
            SQL;
        $label = "Order #{$order->getId()} of {$order->getCustomer()?->getEmail()}";
        $formatter = $this->format(...);
        $total = $order
            ?->markPaid()
            // a remark between two links
            ->getTotal();
        $handler = static function (Order $each) use ($total): Money {
            return $each->getTotal()->add($total);
        };
        $lines = array_map(fn (Order $each): int => $each->getId(), [$order]);
        $status = match (true) {
            $order->getId() > 10 => $order->getStatus(),
            default => null,
        };

        return $this->orders->findLatest()?->getTotal() ?? $total;
    }

    private function format(Money $money): string
    {
        return \\sprintf('%d', $money->amount);
    }
}
`

function definitionIn(snippet: string, name: string) {
  const files = { 'src/Messy/OrderController.php': MESSY }

  return resolvePhpDefinition(createShopWorkspace(files), positionIn(files, 'src/Messy/OrderController.php', snippet, name))
}

async function labelsAt(snippet: string, name: string): Promise<string[]> {
  return (await definitionIn(snippet, name)).targets.map(target => `${target.label} ${target.certainty}`)
}

test('attributes, a multi-line signature and a readonly promoted property do not hide the types', async () => {
  expect(await labelsAt('return $this->orders->findLatest()', 'findLatest')).toEqual(['OrderRepository::findLatest exact'])
  expect(await labelsAt('findLatest()?->getTotal() ??', 'getTotal')).toEqual(['Order::getTotal exact'])
  expect(await labelsAt('Order $order,\n        int ...$extras', 'Order')).toEqual(['Order exact'])
  expect(await labelsAt("#[Autowire(service: 'shop.orders')]\n        private OrderRepository", 'OrderRepository')).toEqual(['OrderRepository exact'])
})

test('a nullsafe chain spanning several lines with a comment inside is followed', async () => {
  expect(await labelsAt('// a remark between two links\n            ->getTotal();', 'getTotal')).toEqual(['Order::getTotal exact'])
  expect(await labelsAt('?->markPaid()', 'markPaid')).toEqual(['Order::markPaid exact'])
})

test('closures, arrow functions, match and first-class callable syntax keep their types', async () => {
  expect(await labelsAt('$each->getTotal()->add($total)', 'add')).toEqual(['Money::add exact'])
  expect(await labelsAt('=> $each->getId(), [$order]', 'getId')).toEqual(['Order::getId exact'])
  expect(await labelsAt('=> $order->getStatus(),', 'getStatus')).toEqual(['Order::getStatus exact'])
  expect(await labelsAt('$this->format(...)', 'format')).toEqual(['OrderController::format exact'])
  expect(await labelsAt("\\sprintf('%d', $money->amount)", 'amount')).toEqual(['Money::$amount exact'])
})

test('what is written inside a heredoc or an interpolated string is text, not code', async () => {
  expect((await definitionIn('-- $this->orders->save()', 'save')).symbol).toBe(null)
  expect((await definitionIn('"Order #{$order->getId()} of', 'getId')).symbol).toBe(null)
  expect((await definitionIn("\\sprintf('%d'", 'sprintf')).note).toBe('sprintf is a PHP built-in function')
})

test('every position of a messy file and of broken code answers without throwing', async () => {
  const broken = '<?php\nclass Half extends {\n  function a( { $this->->b(; }\n  public $x = [1, 2\n  function c(): ?\n}\n$y = new class(;\n"unclosed {$a->b\n'
  const files = { 'src/Messy/OrderController.php': MESSY, 'src/broken.php': broken }
  const workspace = createShopWorkspace(files)
  let answeredPositions = 0
  for (const [path, text] of Object.entries(files)) {
    for (const [lineIndex, lineText] of text.split('\n').entries()) {
      for (let column = 0; column <= lineText.length; column += 1) {
        const position = { path, line: lineIndex + 1, column }
        const definition = await resolvePhpDefinition(workspace, position)
        answeredPositions += Array.isArray(definition.targets) ? 1 : 0
        if (column % 9 === 0) {
          await findPhpUsages(workspace, position)
          await findPhpImplementations(workspace, position)
        }
      }
    }
  }
  expect(answeredPositions).toBe(MESSY.length + broken.length + 2)
})

test('a search that fails is not passed off as an empty answer', async () => {
  const files = { 'src/a.php': '<?php\nclass A { function run() { $this->run(); } }\n' }
  const searchFailing = {
    ...createMemoryWorkspace(files),
    search: async () => {
      throw new Error('ripgrep gone')
    },
  }
  const failureOf = (answer: Promise<unknown>) => answer.then(() => null, (error: unknown) => (error instanceof Error ? error.message : String(error)))

  expect(await failureOf(findPhpUsages(searchFailing, positionIn(files, 'src/a.php', 'function run', 'run')))).toBe('ripgrep gone')
  expect(await failureOf(findPhpImplementations(searchFailing, positionIn(files, 'src/a.php', 'class A', 'A')))).toBe('ripgrep gone')
})

test('a file that cannot be read answers no symbol', async () => {
  expect(await resolvePhpDefinition(createMemoryWorkspace({}), { path: 'src/a.php', line: 1, column: 0 })).toEqual({
    symbol: null,
    targets: [],
    isOnDeclaration: false,
    note: null,
  })
})

test('the declarations of a file are exported for the project index', async () => {
  expect(phpSymbolsOfFile('src/Messy/OrderController.php', MESSY).map(symbol => `${symbol.kind} ${symbol.name}`)).toEqual([
    'class OrderController',
    'method __construct',
    'property orders',
    'property onDone',
    'method show',
    'method format',
  ])
})
