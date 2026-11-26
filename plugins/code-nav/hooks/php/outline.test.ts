import { expect, test } from 'claude-code/testing'

import {
  classAround,
  enclosingClassAt,
  enclosingFunctionScopeAt,
  lineTextAt,
  namespaceOf,
  parsePhpOutline,
  positionOfToken,
  resolveClassName,
  shortNameOf,
} from './outline'
import type { PhpFileOutline } from './outline'

const ORDER_SERVICE = `<?php

declare(strict_types=1);

namespace Shop\\Service;

use Shop\\Entity\\Order;
use Shop\\Entity\\{Product, Money as Amount};
use Shop\\Repository\\OrderRepository as Orders, Shop\\Mailer;
use function Shop\\format_price;
use const Shop\\DEFAULT_CURRENCY;

/**
 * Handles orders.
 */
#[AsService]
final class OrderService extends AbstractService implements Countable, \\Shop\\Contract\\Resettable
{
    use Loggable, Timestamps {
        Loggable::log as protected writeLog;
    }

    public const LIMIT = 10, OFFSET = 0;
    private const string PREFIX = 'order';

    /** @var Order[] */
    private array $pending = [], $done = [];
    public static ?Orders $shared = null;
    protected readonly Mailer|null $mailer;

    public function __construct(
        private readonly Orders $orders,
        #[Autowire(service: 'shop.clock')]
        protected ?Clock $clock = null,
        string $name = 'default',
    ) {
    }

    /**
     * @param Order[] $orders
     */
    #[Required]
    public static function totalOf(
        array $orders,
        Amount ...$extras,
    ): Amount {
        $sum = array_map(fn (Order $order): Amount => $order->getTotal(), $orders);
        $callback = function (Product $product) use ($sum, &$orders): void {
            $inner = static fn ($x) => $x;
        };

        return $sum[0];
    }

    abstract protected function reset(): void;
}

function helper(Order $order): string
{
    return '';
}

const VERSION = '1.0';
`

function tokenIndexOf(outline: PhpFileOutline, text: string, occurrence = 0): number {
  return outline.source.tokens.flatMap((token, tokenIndex) => (token.text === text ? [tokenIndex] : []))[occurrence] ?? -1
}

test('the namespace and every form of use statement are read', async () => {
  const outline = parsePhpOutline('src/Service/OrderService.php', ORDER_SERVICE)
  expect(outline.namespaceDeclarations.map(declaration => declaration.name)).toEqual(['Shop\\Service'])
  expect(Object.fromEntries(outline.classImports)).toEqual({
    Order: 'Shop\\Entity\\Order',
    Product: 'Shop\\Entity\\Product',
    Amount: 'Shop\\Entity\\Money',
    Orders: 'Shop\\Repository\\OrderRepository',
    Mailer: 'Shop\\Mailer',
  })
  expect(Object.fromEntries(outline.functionImports)).toEqual({ format_price: 'Shop\\format_price' })
  expect(Object.fromEntries(outline.constantImports)).toEqual({ DEFAULT_CURRENCY: 'Shop\\DEFAULT_CURRENCY' })
})

test('a written class name resolves through aliases, the namespace and a leading separator', async () => {
  const outline = parsePhpOutline('src/Service/OrderService.php', ORDER_SERVICE)
  expect(resolveClassName(outline, 'Shop\\Service', 'Amount')).toBe('Shop\\Entity\\Money')
  expect(resolveClassName(outline, 'Shop\\Service', 'Clock')).toBe('Shop\\Service\\Clock')
  expect(resolveClassName(outline, 'Shop\\Service', '\\DateTime')).toBe('DateTime')
  expect(resolveClassName(outline, 'Shop\\Service', 'Order\\Line')).toBe('Shop\\Entity\\Order\\Line')
  expect(resolveClassName(outline, '', 'Clock')).toBe('Clock')
  expect(shortNameOf('Shop\\Entity\\Order')).toBe('Order')
  expect(namespaceOf('Shop\\Entity\\Order')).toBe('Shop\\Entity')
  expect(namespaceOf('Order')).toBe('')
})

test('a class header gives its parents fully qualified, its docblock and its traits', async () => {
  const outline = parsePhpOutline('src/Service/OrderService.php', ORDER_SERVICE)
  const [classDeclaration] = outline.classes
  expect(classDeclaration?.kind).toBe('class')
  expect(classDeclaration?.fullyQualifiedName).toBe('Shop\\Service\\OrderService')
  expect(classDeclaration?.extendsNames).toEqual(['Shop\\Service\\AbstractService'])
  expect(classDeclaration?.implementsNames).toEqual(['Shop\\Service\\Countable', 'Shop\\Contract\\Resettable'])
  expect(classDeclaration?.traitNames).toEqual(['Shop\\Service\\Loggable', 'Shop\\Service\\Timestamps'])
  expect(classDeclaration?.docblock?.text.includes('Handles orders.')).toBe(true)
})

test('constants, properties and promoted constructor parameters are members of the class', async () => {
  const outline = parsePhpOutline('src/Service/OrderService.php', ORDER_SERVICE)
  const [classDeclaration] = outline.classes
  expect(classDeclaration?.constants.map(constant => constant.name)).toEqual(['LIMIT', 'OFFSET', 'PREFIX'])
  expect(classDeclaration?.properties.map(property => [property.name, property.typeText, property.isStatic, property.promotedBy !== null])).toEqual([
    ['pending', 'array', false, false],
    ['done', 'array', false, false],
    ['shared', '?Orders', true, false],
    ['mailer', 'Mailer|null', false, false],
    ['orders', 'Orders', false, true],
    ['clock', '?Clock', false, true],
  ])
  expect(classDeclaration?.properties[0]?.docblock?.text).toBe('/** @var Order[] */')
})

test('a method keeps its parameters, return type, docblock and modifiers over a multi-line signature', async () => {
  const outline = parsePhpOutline('src/Service/OrderService.php', ORDER_SERVICE)
  const methods = outline.classes[0]?.methods ?? []
  expect(methods.map(method => method.name)).toEqual(['__construct', 'totalOf', 'reset'])
  const totalOf = methods[1]
  expect(totalOf?.isStatic).toBe(true)
  expect(totalOf?.returnTypeText).toBe('Amount')
  expect(totalOf?.docblock?.text.includes('@param Order[] $orders')).toBe(true)
  expect(totalOf?.parameters.map(parameter => [parameter.name, parameter.typeText, parameter.isVariadic])).toEqual([
    ['$orders', 'array', false],
    ['$extras', 'Amount', true],
  ])
  expect(methods[0]?.parameters.map(parameter => parameter.isPromoted)).toEqual([true, true, false])
  expect(methods[2]?.hasBody).toBe(false)
})

test('closures and arrow functions are scopes of their own, nested in the function around', async () => {
  const outline = parsePhpOutline('src/Service/OrderService.php', ORDER_SERVICE)
  const scopes = outline.functionScopes.map(scope => [scope.kind, scope.name, scope.parentScope?.name ?? scope.parentScope?.kind ?? null])
  expect(scopes).toEqual([
    ['method', '__construct', null],
    ['method', 'totalOf', null],
    ['arrowFunction', null, 'totalOf'],
    ['closure', null, 'totalOf'],
    ['arrowFunction', null, 'closure'],
    ['method', 'reset', null],
    ['function', 'helper', null],
  ])
  const closure = outline.functionScopes[3]
  expect(closure?.capturedVariableNames).toEqual(['$sum', '$orders'])
  expect(closure?.parameters[0]?.typeText).toBe('Product')
  expect(enclosingFunctionScopeAt(outline, tokenIndexOf(outline, '$inner'))?.kind).toBe('closure')
  expect(enclosingFunctionScopeAt(outline, tokenIndexOf(outline, '$x', 1))?.kind).toBe('arrowFunction')
  expect(enclosingFunctionScopeAt(outline, tokenIndexOf(outline, 'VERSION'))).toBe(null)
  expect(enclosingClassAt(outline, tokenIndexOf(outline, '$inner'))?.name).toBe('OrderService')
  expect(enclosingClassAt(outline, tokenIndexOf(outline, 'helper'))).toBe(null)
})

test('top-level functions and constants are listed, the names of declarations are indexed by their token', async () => {
  const outline = parsePhpOutline('src/Service/OrderService.php', ORDER_SERVICE)
  expect(outline.functions.map(functionScope => functionScope.name)).toEqual(['helper'])
  expect(outline.constants.map(constant => constant.name)).toEqual(['VERSION'])
  expect(outline.declarationsByTokenIndex.get(tokenIndexOf(outline, 'OrderService'))?.kind).toBe('class')
  expect(outline.declarationsByTokenIndex.get(tokenIndexOf(outline, 'totalOf'))?.kind).toBe('method')
  expect(outline.declarationsByTokenIndex.get(tokenIndexOf(outline, '$pending'))?.kind).toBe('property')
  expect(outline.declarationsByTokenIndex.get(tokenIndexOf(outline, '$name'))?.kind).toBe('parameter')
  expect(outline.declarationsByTokenIndex.get(tokenIndexOf(outline, '$orders'))?.kind).toBe('property')
  expect(positionOfToken(outline, tokenIndexOf(outline, 'OrderService'))).toEqual({ line: 17, column: 12 })
  expect(lineTextAt(outline, 17)).toBe('final class OrderService extends AbstractService implements Countable, \\Shop\\Contract\\Resettable')
})

test('the names standing where a class does are marked: types, new, static access, attributes, catch, instanceof', async () => {
  const outline = parsePhpOutline(
    'src/a.php',
    '<?php\n#[Tag, Route("/a")]\nfunction run(Order|Draft $order): ?Invoice {\n  try { $x = new Basket(); Money::zero(); } catch (Failure | \\Throwable $e) {}\n  return $order instanceof Paid ? null : count($x);\n}\n',
  )
  const markedNames = [...outline.classReferenceTokenIndexes].sort((first, second) => first - second).map(tokenIndex => outline.source.tokens[tokenIndex]?.text)
  expect(markedNames).toEqual(['Tag', 'Route', 'Order', 'Draft', 'Invoice', 'Basket', 'Money', 'Failure', '\\Throwable', 'Paid'])
})

test('an enum lists its cases and constants, an interface its methods without body', async () => {
  const outline = parsePhpOutline(
    'src/Status.php',
    "<?php\nnamespace Shop;\nenum Status: string implements HasLabel\n{\n    case Paid = 'paid';\n    case Pending = 'pending';\n    const DEFAULT = self::Pending;\n    public function label(): string { return match ($this) { self::Paid => 'Paid', default => 'Pending' }; }\n}\ninterface HasLabel { public function label(): string; }\n",
  )
  const [status, hasLabel] = outline.classes
  expect(status?.kind).toBe('enum')
  expect(status?.implementsNames).toEqual(['Shop\\HasLabel'])
  expect(status?.constants.map(constant => [constant.name, constant.isEnumCase])).toEqual([['Paid', true], ['Pending', true], ['DEFAULT', false]])
  expect(hasLabel?.kind).toBe('interface')
  expect(hasLabel?.methods[0]?.hasBody).toBe(false)
})

test('an anonymous class is a class of its own, kept out of the named ones', async () => {
  const outline = parsePhpOutline(
    'src/a.php',
    '<?php\nclass Shop {\n  public function open(): Door {\n    return new class($this->key) extends Door implements Lockable {\n      public function lock(): void { $this->turn(); }\n    };\n  }\n}\n',
  )
  expect(outline.classes.map(classDeclaration => classDeclaration.name)).toEqual(['Shop'])
  expect(outline.anonymousClasses.map(classDeclaration => classDeclaration.extendsNames)).toEqual([['Door']])
  expect(enclosingClassAt(outline, tokenIndexOf(outline, 'turn'))?.name).toBe('')
  expect(outline.classes[0]?.properties).toEqual([])
  expect(outline.anonymousClasses[0]?.methods.map(method => method.name)).toEqual(['lock'])
})

test('a class keyword that declares nothing is not a class: ::class, a named argument, a method called class', async () => {
  const outline = parsePhpOutline('src/a.php', '<?php\n$name = Order::class;\n$x = build(class: Order::class, interface: 1);\n$y = $reflection->class;\nfunction enum() {}\n')
  expect(outline.classes).toEqual([])
  expect(outline.functions.map(functionScope => functionScope.name)).toEqual(['enum'])
})

test('the class right below an attribute is the class around it', async () => {
  const outline = parsePhpOutline('src/a.php', '<?php\n#[Tag(self::NAME)]\ninterface Handler { const NAME = "handler"; }\n')
  expect(classAround(outline, tokenIndexOf(outline, 'self'))?.name).toBe('Handler')
})

test('a file with two namespaces gives each class its own', async () => {
  const outline = parsePhpOutline('src/a.php', '<?php\nnamespace Shop\\A;\nclass One {}\nnamespace Shop\\B;\nclass Two extends One {}\n')
  expect(outline.classes.map(classDeclaration => classDeclaration.fullyQualifiedName)).toEqual(['Shop\\A\\One', 'Shop\\B\\Two'])
})

test('property hooks and broken code do not derail the members that follow', async () => {
  const outline = parsePhpOutline(
    'src/a.php',
    '<?php\nclass Basket {\n  public string $label { get => $this->label; set { $this->label = trim($value); } }\n  public int $count = 0;\n  public function add( { \n  public function size(): int { return $this->count; }\n',
  )
  expect(outline.classes[0]?.properties.map(property => property.name)).toEqual(['label', 'count'])
  expect(outline.classes[0]?.methods.map(method => method.name).includes('add')).toBe(true)
})
