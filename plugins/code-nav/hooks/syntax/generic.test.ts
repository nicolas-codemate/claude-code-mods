import { expect, test } from 'claude-code/testing'

import { readTokensOfLines } from './test-support'

test('a C-like file has comments, strings, numbers, keywords and navigable names', async () => {
  expect(
    readTokensOfLines('src/Order.java', [
      'public class Order { // an order',
      '  /* its total',
      '     in cents */ long total = 1_000L;',
      "  String label = \"a \\\" // quote\"; char unit = 'c';",
      '}',
    ]),
  ).toEqual([
    ['keyword public', 'keyword class', 'name* Order', 'punctuation {', 'comment // an order'],
    ['comment /* its total'],
    ['comment in cents */', 'keyword long', 'name* total', 'punctuation =', 'number 1_000L', 'punctuation ;'],
    [
      'name* String', 'name* label', 'punctuation =', 'string "a \\" // quote"', 'punctuation ;', 'keyword char',
      'name* unit', 'punctuation =', "string 'c'", 'punctuation ;',
    ],
    ['punctuation }'],
  ])
})

test('an apostrophe that closes nowhere on its line opens no string', async () => {
  expect(readTokensOfLines('src/order.rs', ["fn first<'a>(order: &'a Order) {}", 'next()'])[1]).toEqual(['name* next', 'punctuation ()'])
})

test('a file of no known language has navigable names and numbers, a class name kept whole', async () => {
  expect(readTokensOfLines('docs/orders.md', ["# Orders don't use App\\Shop\\Order since 2.1, see `bin/console`."])).toEqual([
    [
      'punctuation #', 'name* Orders', 'name* don', "punctuation '", 'name* t', 'name* use', 'name* App\\Shop\\Order',
      'name* since', 'number 2.1', 'punctuation ,', 'name* see', 'punctuation `', 'name* bin', 'punctuation /',
      'name* console', 'punctuation `.',
    ],
  ])
})
