import { expect, test } from 'claude-code/testing'

import { readTokensOfLines } from './test-support'

function readDocblock(...docblockLines: string[]): string[][] {
  return readTokensOfLines('src/OrderRepository.php', ['<?php', ...docblockLines]).slice(1)
}

test('the class names of a tag type are type names, its variable a variable, the rest stays comment', async () => {
  expect(
    readDocblock(
      '/**',
      ' * Finds the orders of a customer, Paid ones first.',
      ' *',
      ' * @param Collection<int, Order>|null $orders The orders already loaded',
      ' * @return Order[]',
      ' * @throws \\App\\Shop\\OrderNotFound When nothing matches',
      ' */',
    ),
  ).toEqual([
    ['comment /**'],
    ['comment * Finds the orders of a customer, Paid ones first.'],
    ['comment *'],
    [
      'comment *', 'keyword @param', 'typeName* Collection', 'comment <int,', 'typeName* Order', 'comment >|null',
      'variable* $orders', 'comment The orders already loaded',
    ],
    ['comment *', 'keyword @return', 'typeName* Order', 'comment []'],
    ['comment *', 'keyword @throws', 'typeName* \\App\\Shop\\OrderNotFound', 'comment When nothing matches'],
    ['comment */'],
  ])
})

test('generic tags name their classes, a template its own name and its bound', async () => {
  expect(
    readDocblock(
      '/**',
      ' * @template TEntity of Order',
      ' * @extends Repository<TEntity>',
      ' * @implements Finder<int, Order>',
      ' * @phpstan-var array{id: int, product: Product, status?: Status::*} $row',
      ' */',
    ).slice(1, 5),
  ).toEqual([
    ['comment *', 'keyword @template', 'typeName* TEntity', 'comment of', 'typeName* Order'],
    ['comment *', 'keyword @extends', 'typeName* Repository', 'comment <', 'typeName* TEntity', 'comment >'],
    ['comment *', 'keyword @implements', 'typeName* Finder', 'comment <int,', 'typeName* Order', 'comment >'],
    [
      'comment *', 'keyword @phpstan-var', 'comment array{id: int, product:', 'typeName* Product', 'comment , status?:',
      'typeName* Status', 'comment ::*}', 'variable* $row',
    ],
  ])
})

test('a one-line docblock is read like a line of a long one', async () => {
  expect(readDocblock('/** @var Order|null $order */ $order = null;')).toEqual([
    [
      'comment /**', 'keyword @var', 'typeName* Order', 'comment |null', 'variable* $order', 'comment */',
      'variable* $order', 'punctuation =', 'keyword null', 'punctuation ;',
    ],
  ])
})

test('a type expression goes on after a colon or a bar and over the lines an open bracket spans', async () => {
  expect(
    readDocblock(
      '/**',
      ' * @param callable(Order, int): Invoice $build',
      ' * @return array{',
      ' *   order: Order,',
      ' *   lines: list<Line>,',
      ' * } | null the parts',
      ' */',
    ).slice(1, 6),
  ).toEqual([
    [
      'comment *', 'keyword @param', 'comment callable(', 'typeName* Order', 'comment , int):', 'typeName* Invoice',
      'variable* $build',
    ],
    ['comment *', 'keyword @return', 'comment array{'],
    ['comment *   order:', 'typeName* Order', 'comment ,'],
    ['comment *   lines: list<', 'typeName* Line', 'comment >,'],
    ['comment * } | null the parts'],
  ])
})

test('a method tag names its types and its parameters, a see tag a class but not an address', async () => {
  expect(
    readDocblock(
      '/**',
      ' * @method static Order create(Customer $customer, array $lines)',
      ' * @see OrderRepository::findPaid() and {@see Invoice}',
      ' * @see https://shop.test/Docs/Orders',
      ' * @deprecated since the Cart rewrite',
      ' */',
    ).slice(1, 5),
  ).toEqual([
    [
      'comment *', 'keyword @method', 'comment static', 'typeName* Order', 'comment create(', 'typeName* Customer',
      'variable* $customer', 'comment , array', 'variable* $lines', 'comment )',
    ],
    ['comment *', 'keyword @see', 'typeName* OrderRepository', 'comment ::findPaid() and {', 'keyword @see', 'typeName* Invoice', 'comment }'],
    ['comment *', 'keyword @see', 'comment https://shop.test/Docs/Orders'],
    ['comment *', 'keyword @deprecated', 'comment since the Cart rewrite'],
  ])
})

test('an annotation written as a class is a type name, an address in the prose is no tag', async () => {
  expect(readDocblock('/**', ' * @ORM\\Column(type="string")', ' * Mail sales@shop.test about it', ' */').slice(1, 3)).toEqual([
    ['comment * @', 'typeName* ORM\\Column', 'comment (type="string")'],
    ['comment * Mail sales@shop.test about it'],
  ])
})

test('a word starting with a digit or following a member separator is no class name', async () => {
  expect(readDocblock('/** @return array<5Orders, Status::\\Draft> */')).toEqual([
    ['comment /**', 'keyword @return', 'comment array<5Orders,', 'typeName* Status', 'comment ::\\Draft> */'],
  ])
})

test('a plain block comment has no tags, an open docblock runs to the end of the file', async () => {
  expect(readDocblock('/* @var Order $order */')).toEqual([['comment /* @var Order $order */']])
  expect(readDocblock('/**', ' * @return Order', 'new Order()')).toEqual([
    ['comment /**'],
    ['comment *', 'keyword @return', 'typeName* Order'],
    ['comment new Order()'],
  ])
})
