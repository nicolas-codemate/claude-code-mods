import { expect, test } from 'claude-code/testing'

import type { IndexedLanguage } from './project-index'
import { declarationSearches, parseDeclarationSearchOutput } from './project-index'

function argumentAfter(argv: readonly string[], flag: string): string {
  return argv[argv.indexOf(flag) + 1] ?? ''
}

function argumentsAfterEvery(argv: readonly string[], flag: string): string[] {
  return argv.flatMap((argument, index) => (argument === flag ? [argv[index + 1] ?? ''] : []))
}

// What ripgrep prints for one of the searches over files held in memory. The pattern, the replacement and the globs
// are read from the search's own arguments and run as JavaScript: a heading per file, then "line:replacement" per
// matching line, then a blank line.
function printedBySearch(language: IndexedLanguage, textByPath: Record<string, string>): string {
  const search = declarationSearches().find(candidate => candidate.language === language)
  if (!search) {
    return ''
  }
  const pattern = new RegExp(argumentAfter(search.argv, '--regexp'))
  const replacement = argumentAfter(search.argv, '--replace')
  const extensions = argumentsAfterEvery(search.argv, '--glob').map(glob => glob.replace('*', ''))
  const searchedDirectory = search.argv.at(-1) ?? ''

  return Object.entries(textByPath)
    .filter(([path]) => extensions.some(extension => path.endsWith(extension)))
    .flatMap(([path, text]) => {
      const printedLines = text.split('\n').flatMap((lineText, lineIndex) => {
        const match = lineText.match(pattern)

        return match ? [`${lineIndex + 1}:${replacement.replace(/\$(\d+)/g, (_group, groupNumber) => match[Number(groupNumber)] ?? '')}`] : []
      })

      return printedLines.length === 0 ? [] : [[`${searchedDirectory}${path}`, ...printedLines, ''].join('\n')]
    })
    .join('\n')
}

function declarationsOf(language: IndexedLanguage, textByPath: Record<string, string>): string[] {
  return parseDeclarationSearchOutput(language, printedBySearch(language, textByPath)).map(
    symbol => `${symbol.kind} ${symbol.container === null ? '' : `${symbol.container}::`}${symbol.name} ${symbol.path}:${symbol.line}`,
  )
}

test('one search per language lists the declarations of the files git tracks, from the project root', async () => {
  const searches = declarationSearches()
  expect(searches.map(search => search.language)).toEqual(['php', 'script'])
  for (const search of searches) {
    expect(search.argv.includes('--no-ignore')).toBe(false)
    expect(search.argv.at(-1)).toBe('./')
    expect(() => new RegExp(argumentAfter(search.argv, '--regexp'))).not.toThrow()
  }
  expect(argumentsAfterEvery(searches[0]?.argv ?? [], '--glob')).toEqual(['*.php'])
  expect(argumentsAfterEvery(searches[1]?.argv ?? [], '--glob')).toEqual(['*.ts', '*.tsx', '*.mts', '*.cts', '*.js', '*.jsx', '*.mjs', '*.cjs', '*.vue'])
})

test('a PHP class is listed with its constants and its methods, whatever their modifiers', async () => {
  const declarations = declarationsOf('php', {
    'src/Order/OrderRepository.php': [
      '<?php',
      'namespace Shop\\Order;',
      'use function Shop\\Support\\money;',
      'final readonly class OrderRepository extends Repository implements Countable',
      '{',
      '    public const TABLE = "orders";',
      '    private const int PAGE_SIZE = 20;',
      '    private array $orders = [];',
      '    public function __construct(private Connection $connection) {}',
      '    public static function fromConnection(Connection $connection): self',
      '    abstract protected function &rows(): array;',
      '    function count(): int',
      '    {',
      '        $total = array_map(function (Order $order) { return $order->total(); }, $this->orders);',
      '        switch ($total) {',
      '            case 0:',
      '            case Order::EMPTY:',
      '                return 0;',
      '        }',
      '        return array_sum(array_map(static fn (Order $order) => 1, $this->orders));',
      '    }',
      '}',
    ].join('\n'),
  })
  expect(declarations).toEqual([
    'class OrderRepository src/Order/OrderRepository.php:4',
    'constant OrderRepository::TABLE src/Order/OrderRepository.php:6',
    'constant OrderRepository::PAGE_SIZE src/Order/OrderRepository.php:7',
    'method OrderRepository::__construct src/Order/OrderRepository.php:9',
    'method OrderRepository::fromConnection src/Order/OrderRepository.php:10',
    'method OrderRepository::rows src/Order/OrderRepository.php:11',
    'method OrderRepository::count src/Order/OrderRepository.php:12',
  ])
})

test('PHP interfaces, traits and enums hold their members, an enum its cases', async () => {
  const declarations = declarationsOf('php', {
    'src/Order/OrderStatus.php': [
      '<?php',
      'enum OrderStatus: string implements HasLabel',
      '{',
      "    case Paid = 'paid';",
      '    case Cancelled;',
      '    const DEFAULT = self::Paid;',
      '    public function label(): string',
      '}',
    ].join('\n'),
    'src/Order/Priced.php': ['<?php', 'interface Priced', '{', '    public function total(): Money;', '}'].join('\n'),
    'src/Order/HasTotal.php': ['<?php', 'trait HasTotal', '{', '    protected function sum(): Money', '}'].join('\n'),
  })
  expect(declarations).toEqual([
    'enum OrderStatus src/Order/OrderStatus.php:2',
    'constant OrderStatus::Paid src/Order/OrderStatus.php:4',
    'constant OrderStatus::Cancelled src/Order/OrderStatus.php:5',
    'constant OrderStatus::DEFAULT src/Order/OrderStatus.php:6',
    'method OrderStatus::label src/Order/OrderStatus.php:7',
    'interface Priced src/Order/Priced.php:2',
    'method Priced::total src/Order/Priced.php:4',
    'trait HasTotal src/Order/HasTotal.php:2',
    'method HasTotal::sum src/Order/HasTotal.php:4',
  ])
})

test('a PHP member belongs to the class-like declared above it, a function starting its line to none', async () => {
  const declarations = declarationsOf('php', {
    'tests/InvoiceTest.php': [
      '<?php',
      'const TAX_RATE = 20;',
      'function money(int $cents): Money',
      '{',
      '}',
      'class InvoiceTest extends TestCase',
      '{',
      '    public function testTotal(): void',
      '}',
      'class InvoiceStub extends Invoice',
      '{',
      '    public function total(): Money',
      '}',
      'function invoiceOf(Order $order): Invoice',
    ].join('\n'),
  })
  expect(declarations).toEqual([
    'constant TAX_RATE tests/InvoiceTest.php:2',
    'function money tests/InvoiceTest.php:3',
    'class InvoiceTest tests/InvoiceTest.php:6',
    'method InvoiceTest::testTotal tests/InvoiceTest.php:8',
    'class InvoiceStub tests/InvoiceTest.php:10',
    'method InvoiceStub::total tests/InvoiceTest.php:12',
    'function invoiceOf tests/InvoiceTest.php:14',
  ])
})

test('TypeScript functions, classes, interfaces, type aliases and enums are listed, exported or not', async () => {
  const declarations = declarationsOf('script', {
    'src/order/order.ts': [
      "import type { Product } from './product'",
      'export interface Order {',
      '  id: string',
      '}',
      'export type OrderLine = { product: Product; quantity: number }',
      'type Priced<Item> = Item & { price: number }',
      'export enum OrderStatus {',
      "  Paid = 'paid',",
      '}',
      'export const enum Currency {',
      '}',
      'export function totalOf(order: Order): number {',
      '  function lineTotal(line: OrderLine): number {',
      '    return line.quantity',
      '  }',
      '  return 0',
      '}',
      'export default async function loadOrder(id: string): Promise<Order> {',
      'export function* orderLines(order: Order) {',
      'declare function legacyTotal(order: Order): number',
      'export abstract class OrderStore {',
      '}',
      "export type { Product } from './product'",
    ].join('\n'),
  })
  expect(declarations).toEqual([
    'interface Order src/order/order.ts:2',
    'type OrderLine src/order/order.ts:5',
    'type Priced src/order/order.ts:6',
    'enum OrderStatus src/order/order.ts:7',
    'enum Currency src/order/order.ts:10',
    'function totalOf src/order/order.ts:12',
    'function lineTotal src/order/order.ts:13',
    'function loadOrder src/order/order.ts:18',
    'function orderLines src/order/order.ts:19',
    'function legacyTotal src/order/order.ts:20',
    'class OrderStore src/order/order.ts:21',
  ])
})

test('a variable is listed when it starts its line or is exported, as a function when it holds one', async () => {
  const declarations = declarationsOf('script', {
    'src/order/cart.ts': [
      'export const TAX_RATE = 0.2',
      'const cart: Product[] = []',
      'let lastOrder: Order | null = null',
      'var legacyCart = []',
      'export const addToCart = (product: Product): void => {',
      '  const quantity = 1',
      '  const double = (value: number) => value * 2',
      '}',
      'const removeFromCart = async (',
      '  product: Product,',
      ') => {',
      '}',
      'export const cartTotal = function (): number {',
      'const priceOf = product => product.price',
      'const identity = <Item>(item: Item): Item => item',
      'const subtotal = (cart.length + 1) * 2',
      'const { length } = cart',
      'declare module "shop" {',
      '  export const SHOP_NAME: string',
      '  const hidden: string',
      '}',
    ].join('\n'),
  })
  expect(declarations).toEqual([
    'constant TAX_RATE src/order/cart.ts:1',
    'constant cart src/order/cart.ts:2',
    'variable lastOrder src/order/cart.ts:3',
    'variable legacyCart src/order/cart.ts:4',
    'function addToCart src/order/cart.ts:5',
    'function removeFromCart src/order/cart.ts:9',
    'function cartTotal src/order/cart.ts:13',
    'function priceOf src/order/cart.ts:14',
    'function identity src/order/cart.ts:15',
    'constant subtotal src/order/cart.ts:16',
    'constant SHOP_NAME src/order/cart.ts:19',
  ])
})

test('the methods of a TypeScript class are told apart from the calls and the control statements in their bodies', async () => {
  const declarations = declarationsOf('script', {
    'src/order/order-repository.ts': [
      'export class OrderRepository implements Repository<Order> {',
      '  private readonly orders = new Map<string, Order>()',
      '  constructor(private readonly client: HttpClient) {',
      '    super(client)',
      '  }',
      '  async save(order: Order): Promise<void> {',
      '    if (order.lines.length === 0) {',
      '      throw new Error("empty")',
      '    }',
      '    for (const line of order.lines) {',
      '      this.check(line)',
      '    }',
      '    await this.client.post(order, () => {',
      '    })',
      '    notify(order)',
      '  }',
      '  static create(): OrderRepository {',
      '  get size(): number {',
      '  find(id: string, fallback: () => Order = emptyOrder) {',
      '  protected abstract check(',
      '    line: OrderLine,',
      '  ): void',
      '}',
      'export interface Repository<Item> {',
      '  save(item: Item): Promise<void>',
      '  find(id: string): Item | undefined;',
      '  readonly size: number',
      '}',
    ].join('\n'),
  })
  expect(declarations).toEqual([
    'class OrderRepository src/order/order-repository.ts:1',
    'method OrderRepository::constructor src/order/order-repository.ts:3',
    'method OrderRepository::save src/order/order-repository.ts:6',
    'method OrderRepository::create src/order/order-repository.ts:17',
    'method OrderRepository::size src/order/order-repository.ts:18',
    'method OrderRepository::find src/order/order-repository.ts:19',
    'method OrderRepository::check src/order/order-repository.ts:20',
    'interface Repository src/order/order-repository.ts:24',
    'method Repository::save src/order/order-repository.ts:25',
    'method Repository::find src/order/order-repository.ts:26',
  ])
})

test('outside a class, what is written like a method is not one: a field of a GraphQL query, a method of an object', async () => {
  const declarations = declarationsOf('script', {
    'src/order/order.graphql.ts': [
      'export const ORDER_QUERY = gql`',
      '  query Order($id: ID!) {',
      '    GetOrder(id: $id) {',
      '      lines(first: 10) {',
      '      }',
      '    }',
      '  }',
      '`',
      'export const orderStore = {',
      '  async load(id: string) {',
      '  reset() {',
      '}',
    ].join('\n'),
  })
  expect(declarations).toEqual(['constant ORDER_QUERY src/order/order.graphql.ts:1', 'constant orderStore src/order/order.graphql.ts:9'])
})

test('a Vue component lists the declarations of its script, nothing of its template or its styles', async () => {
  const declarations = declarationsOf('script', {
    'src/components/OrderList.vue': [
      '<template>',
      '  <ul class="orders">',
      '    <li v-for="order in orders" :key="order.id">Total (tax included): {{ format(order) }}</li>',
      '  </ul>',
      '</template>',
      '<script setup lang="ts">',
      'interface Props {',
      '  orders: Order[]',
      '}',
      'const props = defineProps<Props>()',
      'const emit = defineEmits(["select"])',
      'function format(order: Order): string {',
      '}',
      'const onSelect = (order: Order) => {',
      '}',
      '</script>',
      '<style scoped lang="scss">',
      '.orders {',
      '  li:not(.selected) {',
      '  }',
      '}',
      '</style>',
    ].join('\n'),
  })
  expect(declarations).toEqual([
    'interface Props src/components/OrderList.vue:7',
    'constant props src/components/OrderList.vue:10',
    'constant emit src/components/OrderList.vue:11',
    'function format src/components/OrderList.vue:12',
    'function onSelect src/components/OrderList.vue:14',
  ])
})

test('each language reads its own files only', async () => {
  const textByPath = {
    'src/Order.php': '<?php\nclass Order\n{\n}',
    'src/order.ts': 'export class Order {\n}',
    'src/order.jsx': 'export function OrderRow() {\n}',
    'README.md': 'class Documentation',
  }
  expect(declarationsOf('php', textByPath)).toEqual(['class Order src/Order.php:2'])
  expect(declarationsOf('script', textByPath)).toEqual(['class Order src/order.ts:1', 'function OrderRow src/order.jsx:1'])
})

test('the output is read whatever its line endings, with or without the searched directory before the paths', async () => {
  const output = ['src/Order.php', '3:class Order', '5: const TAX', '7:\tfunction total', '', './src/money.php', '2:function money', ''].join(
    '\r\n',
  )
  expect(parseDeclarationSearchOutput('php', output)).toEqual([
    { name: 'Order', kind: 'class', path: 'src/Order.php', line: 3, container: null },
    { name: 'TAX', kind: 'constant', path: 'src/Order.php', line: 5, container: 'Order' },
    { name: 'total', kind: 'method', path: 'src/Order.php', line: 7, container: 'Order' },
    { name: 'money', kind: 'function', path: 'src/money.php', line: 2, container: null },
  ])
  expect(parseDeclarationSearchOutput('php', '')).toEqual([])
  expect(parseDeclarationSearchOutput('php', 'src/Order.php\nnot a declaration\n4:unknown Order\n')).toEqual([])
})
