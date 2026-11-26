import { expect, test } from 'claude-code/testing'

import { SHOP_FILES } from './shop-project'
import { phpSymbolsOfFile } from './symbols'

test('a file lists its class with its constants, properties and methods, in the order of the file', async () => {
  const symbols = phpSymbolsOfFile('src/Entity/Order.php', SHOP_FILES['src/Entity/Order.php'] ?? '')
  expect(symbols.slice(0, 7)).toEqual([
    { name: 'Order', kind: 'class', path: 'src/Entity/Order.php', line: 9, container: null },
    { name: 'STATUS_PAID', kind: 'constant', path: 'src/Entity/Order.php', line: 11, container: 'Order' },
    { name: 'customer', kind: 'property', path: 'src/Entity/Order.php', line: 13, container: 'Order' },
    { name: 'lines', kind: 'property', path: 'src/Entity/Order.php', line: 16, container: 'Order' },
    { name: 'products', kind: 'property', path: 'src/Entity/Order.php', line: 19, container: 'Order' },
    { name: 'status', kind: 'property', path: 'src/Entity/Order.php', line: 21, container: 'Order' },
    { name: '__construct', kind: 'method', path: 'src/Entity/Order.php', line: 23, container: 'Order' },
  ])
  expect(symbols.filter(symbol => symbol.kind === 'method').map(symbol => symbol.name)).toEqual([
    '__construct', 'getId', 'getCustomer', 'getLines', 'getProducts', 'getTotal', 'getStatus', 'markPaid',
  ])
})

test('interfaces, traits and enums keep their kind, an enum case is a constant', async () => {
  const kindsOf = (path: string) => phpSymbolsOfFile(path, SHOP_FILES[path] ?? '').map(symbol => `${symbol.kind} ${symbol.name}`)
  expect(kindsOf('src/Entity/HasTotal.php')).toEqual(['interface HasTotal', 'method getTotal'])
  expect(kindsOf('src/Service/Loggable.php')).toEqual(['trait Loggable', 'method log'])
  expect(kindsOf('src/Entity/OrderStatus.php')).toEqual(['enum OrderStatus', 'constant Paid', 'constant Pending', 'method label'])
})

test('promoted constructor parameters are properties, functions and top-level constants have no container', async () => {
  expect(phpSymbolsOfFile('src/Entity/Money.php', SHOP_FILES['src/Entity/Money.php'] ?? '').filter(symbol => symbol.kind === 'property')).toEqual([
    { name: 'amount', kind: 'property', path: 'src/Entity/Money.php', line: 8, container: 'Money' },
    { name: 'currency', kind: 'property', path: 'src/Entity/Money.php', line: 9, container: 'Money' },
  ])
  const symbols = phpSymbolsOfFile('src/functions.php', `${SHOP_FILES['src/functions.php'] ?? ''}\nconst TAX_RATE = 20;\ndefine('SHOP_NAME', 'shop');\n`)
  expect(symbols.map(symbol => `${symbol.kind} ${symbol.name} ${String(symbol.container)}`)).toEqual([
    'function format_price null',
    'function zero_money null',
    'constant TAX_RATE null',
    'constant SHOP_NAME null',
  ])
})

test('closures, anonymous classes and local variables are not declarations', async () => {
  const symbols = phpSymbolsOfFile(
    'src/a.php',
    '<?php\nfunction make() {\n    $local = fn ($x) => $x;\n    return new class { public function hidden() {} };\n}\n',
  )
  expect(symbols.map(symbol => symbol.name)).toEqual(['make'])
})

test('a file that is not PHP or is broken lists what it can instead of throwing', async () => {
  expect(phpSymbolsOfFile('README.md', '# Shop\nclass Order {}')).toEqual([])
  expect(phpSymbolsOfFile('src/broken.php', '<?php class Broken { public function half( { $x = [; ').map(symbol => symbol.name)).toEqual(['Broken', 'half'])
  expect(phpSymbolsOfFile('src/empty.php', '')).toEqual([])
})
