import { expect, test } from 'claude-code/testing'

import { readTokensOfLines, readTokensOfOnlyLine } from './test-support'

function readTypeScript(...codeLines: string[]): string[][] {
  return readTokensOfLines('src/order.ts', codeLines)
}

test('a name before a parenthesis is a call, a name after a dot a property unless it is called', async () => {
  expect(readTokensOfOnlyLine('src/order.ts', 'const total = cart.lines?.length + order.total() + sum(prices) + this.#count')).toEqual([
    'keyword const', 'name* total', 'punctuation =', 'name* cart', 'punctuation .', 'property* lines', 'punctuation ?.',
    'property* length', 'punctuation +', 'name* order', 'punctuation .', 'callName* total', 'punctuation ()',
    'punctuation +', 'callName* sum', 'punctuation (', 'name* prices', 'punctuation )', 'punctuation +', 'keyword this',
    'punctuation .', 'property* #count',
  ])
})

test('capitalized names are type names in type positions, primitive types keywords', async () => {
  expect(
    readTypeScript(
      'export interface OrderView extends View, Printable { order: Order | null; lines: Array<Line>; count: number }',
      'type Lines = Record<string, Line[]>',
      'class Cart extends Basket implements Countable {}',
      'const cart = new Cart() as Basket',
      'function total(order: Order, rate = TAX_RATE): Money {}',
      'const fallback = isPaid ? Paid : MAX_ITEMS',
    ),
  ).toEqual([
    [
      'keyword export', 'keyword interface', 'typeName* OrderView', 'keyword extends', 'typeName* View', 'punctuation ,',
      'typeName* Printable', 'punctuation {', 'name* order', 'punctuation :', 'typeName* Order', 'punctuation |',
      'keyword null', 'punctuation ;', 'name* lines', 'punctuation :', 'typeName* Array', 'punctuation <',
      'typeName* Line', 'punctuation >;', 'name* count', 'punctuation :', 'keyword number', 'punctuation }',
    ],
    [
      'keyword type', 'typeName* Lines', 'punctuation =', 'typeName* Record', 'punctuation <', 'keyword string',
      'punctuation ,', 'typeName* Line', 'punctuation []>',
    ],
    [
      'keyword class', 'typeName* Cart', 'keyword extends', 'typeName* Basket', 'keyword implements',
      'typeName* Countable', 'punctuation {}',
    ],
    [
      'keyword const', 'name* cart', 'punctuation =', 'keyword new', 'typeName* Cart', 'punctuation ()', 'keyword as',
      'typeName* Basket',
    ],
    [
      'keyword function', 'callName* total', 'punctuation (', 'name* order', 'punctuation :', 'typeName* Order',
      'punctuation ,', 'name* rate', 'punctuation =', 'name* TAX_RATE', 'punctuation ):', 'typeName* Money',
      'punctuation {}',
    ],
    [
      'keyword const', 'name* fallback', 'punctuation =', 'name* isPaid', 'punctuation ?', 'name* Paid', 'punctuation :',
      'name* MAX_ITEMS',
    ],
  ])
})

test('the return type of a function type is a type, the body of an arrow function is not', async () => {
  expect(
    readTypeScript('type Build = (order: Order) => Invoice', 'const build = (order: Order) => Draft', 'let lines: Map<string, (order: Order) => Line[]>'),
  ).toEqual([
    [
      'keyword type', 'typeName* Build', 'punctuation =', 'punctuation (', 'name* order', 'punctuation :',
      'typeName* Order', 'punctuation )', 'punctuation =>', 'typeName* Invoice',
    ],
    [
      'keyword const', 'name* build', 'punctuation =', 'punctuation (', 'name* order', 'punctuation :',
      'typeName* Order', 'punctuation )', 'punctuation =>', 'name* Draft',
    ],
    [
      'keyword let', 'name* lines', 'punctuation :', 'typeName* Map', 'punctuation <', 'keyword string', 'punctuation ,',
      'punctuation (', 'name* order', 'punctuation :', 'typeName* Order', 'punctuation )', 'punctuation =>',
      'typeName* Line', 'punctuation []>',
    ],
  ])
})

test('type arguments may start on the next line, a comparison never touches its left operand', async () => {
  expect(readTypeScript('const order = ref<', '  Order', '>(null)', 'const isSmall = count <', '  Limit')).toEqual([
    ['keyword const', 'name* order', 'punctuation =', 'callName* ref', 'punctuation <'],
    ['typeName* Order'],
    ['punctuation >(', 'keyword null', 'punctuation )'],
    ['keyword const', 'name* isSmall', 'punctuation =', 'name* count', 'punctuation <'],
    ['name* Limit'],
  ])
})

test('unbalanced closing brackets end the scan normally', async () => {
  expect(readTypeScript('})] const a = (b: (c) => D)')).toEqual([
    [
      'punctuation })]', 'keyword const', 'name* a', 'punctuation =', 'punctuation (', 'name* b', 'punctuation :',
      'punctuation (', 'name* c', 'punctuation )', 'punctuation =>', 'typeName* D', 'punctuation )',
    ],
  ])
})

test('the colon of a conditional expression announces a value, the colon of an optional member a type', async () => {
  expect(readTypeScript('const status = isPaid ? Paid : Draft, order: Order = found', 'interface Cart { total?(): Money; order?: Order }')).toEqual([
    [
      'keyword const', 'name* status', 'punctuation =', 'name* isPaid', 'punctuation ?', 'name* Paid', 'punctuation :',
      'name* Draft', 'punctuation ,', 'name* order', 'punctuation :', 'typeName* Order', 'punctuation =', 'name* found',
    ],
    [
      'keyword interface', 'typeName* Cart', 'punctuation {', 'name* total', 'punctuation ?():', 'typeName* Money',
      'punctuation ;', 'name* order', 'punctuation ?:', 'typeName* Order', 'punctuation }',
    ],
  ])
})

test('a call with type arguments is a call, its arguments types', async () => {
  expect(readTokensOfOnlyLine('src/order.ts', 'const order = ref<Order | null>(null), small = count < limit')).toEqual([
    'keyword const', 'name* order', 'punctuation =', 'callName* ref', 'punctuation <', 'typeName* Order', 'punctuation |',
    'keyword null', 'punctuation >(', 'keyword null', 'punctuation ),', 'name* small', 'punctuation =', 'name* count',
    'punctuation <', 'name* limit',
  ])
})

test('the file named by an import, an export from or a dynamic import is a navigable string', async () => {
  expect(
    readTypeScript(
      "import OrderList, { type Order, formatPrice as format } from './order-list'",
      "import './setup'",
      "export * from '../shared/money'",
      "const page = () => import('./pages/OrderPage.vue')",
      "const legacy = require('./legacy.cjs'), label = 'from here'",
    ),
  ).toEqual([
    [
      'keyword import', 'typeName* OrderList', 'punctuation ,', 'punctuation {', 'keyword type', 'typeName* Order',
      'punctuation ,', 'name* formatPrice', 'keyword as', 'name* format', 'punctuation }', 'keyword from',
      "string* './order-list'",
    ],
    ['keyword import', "string* './setup'"],
    ['keyword export', 'punctuation *', 'keyword from', "string* '../shared/money'"],
    [
      'keyword const', 'name* page', 'punctuation =', 'punctuation ()', 'punctuation =>', 'keyword import',
      'punctuation (', "string* './pages/OrderPage.vue'", 'punctuation )',
    ],
    [
      'keyword const', 'name* legacy', 'punctuation =', 'callName* require', 'punctuation (', "string* './legacy.cjs'",
      'punctuation ),', 'name* label', 'punctuation =', "string 'from here'",
    ],
  ])
})

test('the holes of a template literal are code, across lines and nested', async () => {
  expect(readTypeScript('const label = `Order ${order.number}', '  of ${names.map(name => `<${name}>`).join()} }`;', 'next()')).toEqual([
    ['keyword const', 'name* label', 'punctuation =', 'string `Order', 'punctuation ${', 'name* order', 'punctuation .', 'property* number', 'punctuation }'],
    [
      'string of', 'punctuation ${', 'name* names', 'punctuation .', 'callName* map', 'punctuation (', 'name* name',
      'punctuation =>', 'string `<', 'punctuation ${', 'name* name', 'punctuation }', 'string >`', 'punctuation ).',
      'callName* join', 'punctuation ()}', 'string }`', 'punctuation ;',
    ],
    ['callName* next', 'punctuation ()'],
  ])
})

test('a regular expression is told apart from a division', async () => {
  expect(readTypeScript('const half = total / 2 / count', 'const isPath = /^[/\\w]+\\/order$/i.test(path)', 'return /a "quote/.source')).toEqual([
    ['keyword const', 'name* half', 'punctuation =', 'name* total', 'punctuation /', 'number 2', 'punctuation /', 'name* count'],
    [
      'keyword const', 'name* isPath', 'punctuation =', 'string /^[/\\w]+\\/order$/i', 'punctuation .', 'callName* test',
      'punctuation (', 'name* path', 'punctuation )',
    ],
    ['keyword return', 'string /a "quote/', 'punctuation .', 'property* source'],
  ])
})

test('a contextual keyword is a name wherever the grammar does not expect it', async () => {
  expect(
    readTypeScript(
      'const type = order.type, from = 1, of = [type, from]',
      'for (const line of lines) static.get(type as string)',
      'declare module Shop { export type Id = string }',
      '({ default: 1, class: 2, async: 3 })',
    ),
  ).toEqual([
    [
      'keyword const', 'name* type', 'punctuation =', 'name* order', 'punctuation .', 'property* type', 'punctuation ,',
      'name* from', 'punctuation =', 'number 1', 'punctuation ,', 'name* of', 'punctuation =', 'punctuation [',
      'name* type', 'punctuation ,', 'name* from', 'punctuation ]',
    ],
    [
      'keyword for', 'punctuation (', 'keyword const', 'name* line', 'keyword of', 'name* lines', 'punctuation )',
      'name* static', 'punctuation .', 'callName* get', 'punctuation (', 'name* type', 'keyword as', 'keyword string',
      'punctuation )',
    ],
    [
      'keyword declare', 'keyword module', 'name* Shop', 'punctuation {', 'keyword export', 'keyword type',
      'typeName* Id', 'punctuation =', 'keyword string', 'punctuation }',
    ],
    [
      'punctuation ({', 'keyword default', 'punctuation :', 'number 1', 'punctuation ,', 'name* class', 'punctuation :',
      'number 2', 'punctuation ,', 'name* async', 'punctuation :', 'number 3', 'punctuation })',
    ],
  ])
})

test('comments and strings hold no code, an open block comment runs to the end of the file', async () => {
  expect(readTypeScript("const a = 'it\\'s // not a comment' // new Order()", 'const b = 1 /* open', 'new Order()')).toEqual([
    ['keyword const', 'name* a', 'punctuation =', "string 'it\\'s // not a comment'", 'comment // new Order()'],
    ['keyword const', 'name* b', 'punctuation =', 'number 1', 'comment /* open'],
    ['comment new Order()'],
  ])
})

test('an element of a tsx file names its component, its attributes and its children', async () => {
  expect(
    readTokensOfLines('src/OrderCard.tsx', [
      'const card = (',
      '  <Card title="Order" onPress={() => open(order.id)}>',
      "    Don't {order.total > 0 && <Price.Tag value={order.total} />} <br />",
      '  </Card>',
      ')',
      'const isSmall = count < limit',
    ]),
  ).toEqual([
    ['keyword const', 'name* card', 'punctuation =', 'punctuation ('],
    [
      'punctuation <', 'typeName* Card', 'attribute title', 'punctuation =', 'string "Order"', 'attribute onPress',
      'punctuation ={()', 'punctuation =>', 'callName* open', 'punctuation (', 'name* order', 'punctuation .',
      'property* id', 'punctuation )}>',
    ],
    [
      "text Don't", 'punctuation {', 'name* order', 'punctuation .', 'property* total', 'punctuation >', 'number 0',
      'punctuation &&', 'punctuation <', 'typeName* Price', 'punctuation .', 'typeName* Tag', 'attribute value',
      'punctuation ={', 'name* order', 'punctuation .', 'property* total', 'punctuation }', 'punctuation />}',
      'punctuation <', 'tag br', 'punctuation />',
    ],
    ['punctuation </', 'typeName* Card', 'punctuation >'],
    ['punctuation )'],
    ['keyword const', 'name* isSmall', 'punctuation =', 'name* count', 'punctuation <', 'name* limit'],
  ])
})

test('an attribute starting with a digit is kept whole', async () => {
  expect(readTokensOfOnlyLine('src/OrderCard.tsx', 'const card = <Card wide 2x />')).toEqual([
    'keyword const', 'name* card', 'punctuation =', 'punctuation <', 'typeName* Card', 'attribute wide', 'attribute 2x',
    'punctuation />',
  ])
})

test('a ts file has no element: an angle bracket opens type arguments or compares', async () => {
  expect(readTokensOfOnlyLine('src/order.ts', 'const first = <T>(items: T[]) => items[0]')).toEqual([
    'keyword const', 'name* first', 'punctuation =', 'punctuation <', 'typeName* T', 'punctuation >(', 'name* items',
    'punctuation :', 'typeName* T', 'punctuation [])', 'punctuation =>', 'name* items', 'punctuation [', 'number 0',
    'punctuation ]',
  ])
})
