import { expect, test } from 'claude-code/testing'

import type { UsagesAnswer } from '../../types'
import { createShopWorkspace, positionIn, shopPosition } from './shop-project'
import { findPhpUsages } from './usages'

const CHECKOUT = 'src/Service/Checkout.php'

function usagesAt(path: string, snippet: string, name: string): Promise<UsagesAnswer> {
  return findPhpUsages(createShopWorkspace(), shopPosition(path, snippet, name))
}

function placesOf(answer: UsagesAnswer): string[] {
  return answer.usages.map(usage => `${usage.path}:${usage.line} ${usage.certainty}`)
}

test('the usages of a method are confirmed by the type of each receiver, an unrelated class is dropped', async () => {
  const answer = await usagesAt('src/Repository/OrderRepository.php', 'public function save(Order $order)', 'save')
  expect(answer.title).toBe('OrderRepository::save')
  expect(placesOf(answer)).toEqual(['src/Service/Checkout.php:34 confirmed', 'src/Service/Checkout.php:40 unverified'])
  expect(answer.usages[0]).toEqual({ path: CHECKOUT, line: 34, column: 23, preview: '$this->orders->save($order);', certainty: 'confirmed' })
  expect(answer.isTruncated).toBe(false)
  expect(answer.symbol?.description).toBe('method save of OrderRepository')
})

test('usages asked from a reference are those of the declaration it leads to', async () => {
  const fromReference = await usagesAt(CHECKOUT, '$this->orders->save($order)', 'save')
  expect(fromReference.title).toBe('OrderRepository::save')
  expect(placesOf(fromReference)).toEqual(['src/Service/Checkout.php:34 confirmed', 'src/Service/Checkout.php:40 unverified'])
})

test('a call through a parent, a child, an interface or an implementer is a confirmed usage', async () => {
  const files = {
    'src/Service/Totals.php': `<?php
namespace Shop\\Service;
use Shop\\Entity\\CreditNote;
use Shop\\Entity\\HasTotal;
use Shop\\Entity\\Invoice;
use Shop\\Entity\\Product;
function totals(HasTotal $any, Invoice $invoice, CreditNote $credit, Product $product, \\DateTime $date) {
    $any->getTotal();
    $invoice->getTotal();
    $credit->getTotal();
    $product->getTotal();
    $date->getTotal();
    // $invoice->getTotal() in a comment
    return '$invoice->getTotal()';
}
`,
  }
  const answer = await findPhpUsages(createShopWorkspace(files), positionIn(files, 'src/Service/Totals.php', '$invoice->getTotal();', 'getTotal'))
  expect(answer.title).toBe('Invoice::getTotal')
  expect(placesOf(answer).filter(place => place.startsWith('src/Service/Totals.php'))).toEqual([
    'src/Service/Totals.php:8 confirmed',
    'src/Service/Totals.php:9 confirmed',
    'src/Service/Totals.php:10 confirmed',
  ])
  expect(placesOf(answer).filter(place => place.startsWith('src/Service/Checkout.php'))).toEqual([
    'src/Service/Checkout.php:36 confirmed',
    'src/Service/Checkout.php:41 unverified',
  ])
  expect(placesOf(answer).some(place => place.startsWith('src/Entity/Invoice.php'))).toBe(false)
})

test('confirmed usages come before the unverified ones', async () => {
  const answer = await usagesAt('src/Entity/Order.php', 'public function getTotal(): Money', 'getTotal')
  const certainties = answer.usages.map(usage => usage.certainty)
  expect(certainties).toEqual([...certainties].sort())
  expect(certainties.includes('confirmed') && certainties.includes('unverified')).toBe(true)
})

test('the usages of a property and of a constant read the same way', async () => {
  const ofProperty = await usagesAt('src/Entity/Money.php', 'public readonly int $amount', '$amount')
  expect(ofProperty.title).toBe('Money::$amount')
  expect(placesOf(ofProperty)).toEqual(['src/Entity/Money.php:20 confirmed', 'src/Entity/Money.php:20 confirmed', 'src/functions.php:9 confirmed'])
  const ofConstant = await usagesAt('src/Entity/Order.php', 'const STATUS_PAID', 'STATUS_PAID')
  expect(ofConstant.title).toBe('Order::STATUS_PAID')
  expect(placesOf(ofConstant)).toEqual(['src/Repository/OrderRepository.php:29 confirmed', 'src/Service/Checkout.php:99 confirmed'])
  const ofEnumCase = await usagesAt('src/Entity/OrderStatus.php', "case Paid = 'paid'", 'Paid')
  expect(placesOf(ofEnumCase)).toEqual(['src/Entity/Order.php:66 confirmed', 'src/Service/Checkout.php:45 confirmed'])
})

test('a member whose class could not be read lists every access to its name, unverified', async () => {
  const answer = await usagesAt(CHECKOUT, '$unknown->save($order)', 'save')
  expect(answer.title).toBe('save')
  expect(placesOf(answer)).toEqual(['src/Service/Checkout.php:34 unverified', 'src/Service/Checkout.php:40 unverified'])
  expect(answer.note).toBe('The class holding save could not be read: every access to that name is listed')
})

test('the usages of a class are every reference resolving to it but its use statements: types, new, static access, docblocks', async () => {
  const answer = await usagesAt('src/Entity/Money.php', 'final class Money', 'Money')
  expect(answer.title).toBe('Money')
  expect(answer.usages.every(usage => usage.certainty === 'confirmed')).toBe(true)
  expect(placesOf(answer).filter(place => place.startsWith('src/Service/Checkout.php'))).toEqual([
    'src/Service/Checkout.php:32 confirmed',
    'src/Service/Checkout.php:50 confirmed',
  ])
  expect(placesOf(answer).filter(place => place.startsWith('src/Entity/Money.php'))).toEqual(['src/Entity/Money.php:18 confirmed'])
  expect(placesOf(answer).includes('src/functions.php:5 confirmed')).toBe(false)
  expect(placesOf(answer).includes('src/functions.php:7 confirmed')).toBe(true)
  expect(placesOf(answer).includes('src/Entity/HasTotal.php:7 confirmed')).toBe(true)
})

test('a class of the same short name in another namespace is not a usage', async () => {
  const files = {
    'src/Billing/Order.php': '<?php\nnamespace Shop\\Billing;\nclass Order {}\n',
    'src/Billing/Ledger.php': '<?php\nnamespace Shop\\Billing;\nclass Ledger {\n    /** @var Order[] */\n    private array $orders = [];\n    public function add(Order $order): void {}\n}\n',
  }
  const answer = await findPhpUsages(createShopWorkspace(files), positionIn(files, 'src/Billing/Order.php', 'class Order', 'Order'))
  expect(placesOf(answer)).toEqual(['src/Billing/Ledger.php:4 confirmed', 'src/Billing/Ledger.php:6 confirmed'])
})

test('the usages of a function are its calls, of a variable its occurrences in its function', async () => {
  const ofFunction = await usagesAt('src/functions.php', 'function format_price', 'format_price')
  expect(placesOf(ofFunction)).toEqual(['src/Service/Checkout.php:45 confirmed'])
  const ofVariable = await usagesAt(CHECKOUT, '$total = $invoice->getTotal()', '$total')
  expect(ofVariable.title).toBe('$total')
  expect(placesOf(ofVariable)).toEqual(['src/Service/Checkout.php:45 confirmed', 'src/Service/Checkout.php:50 confirmed'])
  const ofParameter = await usagesAt(CHECKOUT, 'pay(Order $order, $unknown)', '$unknown')
  expect(placesOf(ofParameter).map(place => place.split(' ')[0])).toEqual([40, 41, 42, 43].map(line => `src/Service/Checkout.php:${line}`))
})

test('more matches than the analysis reads are reported as truncated', async () => {
  const calls = Array.from({ length: 1100 }, (_, index) => `    $order->getId(); // ${index}`).join('\n')
  const files = { 'src/Service/Many.php': `<?php\nnamespace Shop\\Service;\nuse Shop\\Entity\\Order;\nfunction many(Order $order) {\n${calls}\n}\n` }
  const answer = await findPhpUsages(createShopWorkspace(files), shopPosition('src/Entity/Order.php', 'public function getId(): int', 'getId'))
  expect(answer.isTruncated).toBe(true)
  expect(answer.usages.length).toBe(1000)
})

test('a search cut at its limit before reaching any usage says it stopped there, not that there is none', async () => {
  const callsOnInvoices = Array.from({ length: 1100 }, (_, index) => `    $invoice->getId(); // ${index}`).join('\n')
  const files = {
    'src/Accounting/InvoiceExport.php': `<?php\nnamespace Shop\\Accounting;\nuse Shop\\Entity\\Invoice;\nfunction export(Invoice $invoice) {\n${callsOnInvoices}\n}\n`,
  }
  const answer = await findPhpUsages(createShopWorkspace(files), shopPosition('src/Entity/Order.php', 'public function getId(): int', 'getId'))
  expect(answer.usages).toEqual([])
  expect(answer.isTruncated).toBe(true)
  expect(answer.note).toBe('No usage of Order::getId among the first 1000 places getId is written: the search stopped there.')
})

test('a click on nothing has no usages', async () => {
  const answer = await usagesAt(CHECKOUT, 'return null;', 'null')
  expect(answer).toEqual({ symbol: null, title: '', usages: [], isTruncated: false, note: null })
})
