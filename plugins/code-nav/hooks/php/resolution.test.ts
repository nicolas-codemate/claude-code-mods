import { expect, test } from 'claude-code/testing'

import { createMemoryWorkspace } from '../test-workspace'
import { parsePhpOutline } from './outline'
import { createPhpProject } from './project'
import { resolvePhpClick, scopeDeclaringVariable, variableOccurrencesIn } from './resolution'
import { createShopWorkspace, positionIn, shopPosition, SHOP_FILES } from './shop-project'

const CHECKOUT = 'src/Service/Checkout.php'
const REPORT = `<?php
function report(array $orders, $total) {
    $count = 0;
    $each = fn ($order) => $order->getTotal() + $total;
    $later = function ($order) use ($total, &$count) {
        $count += 1;
        $hidden = $total;
    };
    $ignored = function () {
        $total = 0;
        $count = 0;
    };

    return $count + $total;
}
$total = 1;
echo $total;
`

const reportOutline = parsePhpOutline('src/report.php', REPORT)

function tokenIndexOf(text: string, occurrence = 0): number {
  return reportOutline.source.tokens.flatMap((token, tokenIndex) => (token.text === text ? [tokenIndex] : []))[occurrence] ?? -1
}

function linesOf(tokenIndexes: number[]): number[] {
  return tokenIndexes.map(tokenIndex => REPORT.slice(0, reportOutline.source.tokens[tokenIndex]?.start ?? 0).split('\n').length)
}

test('a variable belongs to the function around it, an arrow function and a capturing closure share their parent variables', async () => {
  expect(scopeDeclaringVariable(reportOutline, '$total', tokenIndexOf('$total', 1))?.name).toBe('report')
  expect(scopeDeclaringVariable(reportOutline, '$total', tokenIndexOf('$hidden') + 2)?.name).toBe('report')
  expect(scopeDeclaringVariable(reportOutline, '$order', tokenIndexOf('$order', 1))?.kind).toBe('arrowFunction')
  expect(scopeDeclaringVariable(reportOutline, '$hidden', tokenIndexOf('$hidden'))?.kind).toBe('closure')
  expect(scopeDeclaringVariable(reportOutline, '$total', tokenIndexOf('$ignored') + 9)?.kind).toBe('closure')
  expect(scopeDeclaringVariable(reportOutline, '$total', reportOutline.source.tokens.length - 2)).toBe(null)
})

test('the occurrences of a variable leave out the functions that do not share it', async () => {
  const reportScope = reportOutline.functionScopes[0] ?? null
  expect(linesOf(variableOccurrencesIn(reportOutline, '$total', reportScope))).toEqual([2, 4, 5, 7, 14])
  expect(linesOf(variableOccurrencesIn(reportOutline, '$count', reportScope))).toEqual([3, 5, 6, 14])
  expect(linesOf(variableOccurrencesIn(reportOutline, '$total', null))).toEqual([16, 17])
})

test('the subject of a click is the same from a reference and from the declaration', async () => {
  const project = createPhpProject(createShopWorkspace())
  const fromReference = await resolvePhpClick(project, shopPosition(CHECKOUT, '$this->orders->save($order)', 'save'))
  const fromDeclaration = await resolvePhpClick(project, shopPosition('src/Repository/OrderRepository.php', 'public function save(Order $order)', 'save'))
  expect(fromReference.subject).toEqual({ kind: 'member', memberKind: 'method', name: 'save', declaringClassNames: ['Shop\\Repository\\OrderRepository'] })
  expect(fromDeclaration.subject).toEqual(fromReference.subject)
  expect((await resolvePhpClick(project, shopPosition(CHECKOUT, 'pay(Order $order, $unknown)', 'Order'))).subject).toEqual({
    kind: 'class',
    fullyQualifiedName: 'Shop\\Entity\\Order',
  })
  expect((await resolvePhpClick(project, shopPosition(CHECKOUT, '$unknown->save($order)', 'save'))).subject).toEqual({
    kind: 'member',
    memberKind: 'method',
    name: 'save',
    declaringClassNames: [],
  })
})

test('a union receiver answers the member of each of its classes', async () => {
  const files = {
    'src/Service/Totals.php':
      '<?php\nnamespace Shop\\Service;\nuse Shop\\Entity\\Invoice;\nuse Shop\\Entity\\Order;\nfunction total(Order|Invoice $document) {\n    return $document->getTotal();\n}\n',
  }
  const resolution = await resolvePhpClick(createPhpProject(createShopWorkspace(files)), positionIn(files, 'src/Service/Totals.php', '->getTotal()', 'getTotal'))
  expect(resolution.targets.map(target => `${target.label} ${target.certainty}`)).toEqual(['Order::getTotal exact', 'Invoice::getTotal exact'])
})

test('the members every enum has are said built in', async () => {
  const resolution = await resolvePhpClick(createPhpProject(createShopWorkspace()), shopPosition('src/Entity/OrderStatus.php', 'ucfirst($this->value)', 'value'))
  expect(resolution.targets).toEqual([])
  expect(resolution.note).toBe('value is built into every PHP enum')
})

test('a member inherited from several classes of PHP names them all', async () => {
  const files = {
    'src/Service/Basket.php':
      '<?php\nnamespace Shop\\Service;\ninterface Basket extends \\Countable, \\ArrayAccess {}\nfunction size(Basket $basket) {\n    return $basket->count();\n}\n',
  }
  const resolution = await resolvePhpClick(createPhpProject(createShopWorkspace(files)), positionIn(files, 'src/Service/Basket.php', '->count()', 'count'))
  expect(resolution.note).toBe('count belongs to one of Countable, ArrayAccess: PHP built-in classes')
})

test('a member read on what a class of PHP gives is said so instead of listing unrelated candidates', async () => {
  const files = { 'src/Service/Days.php': '<?php\nnamespace Shop\\Service;\nfunction next(\\DateTimeImmutable $day) {\n    return $day->modify("+1 day")->add($day);\n}\n' }
  const resolution = await resolvePhpClick(createPhpProject(createShopWorkspace(files)), positionIn(files, 'src/Service/Days.php', '->add($day)', 'add'))
  expect(resolution.targets).toEqual([])
  expect(resolution.note).toBe('add is called on a value a PHP built-in class gives')
})

test('a property the index does not list is searched by its declaration', async () => {
  const indexWithoutProperties = createMemoryWorkspace(SHOP_FILES)
  const resolution = await resolvePhpClick(createPhpProject(indexWithoutProperties), {
    ...shopPosition('src/Service/CheckoutFailed.php', 'return $this->order;', 'order'),
  })
  expect(resolution.targets.map(target => `${target.label} ${target.path}:${target.line} ${target.certainty}`)).toEqual([
    'CheckoutFailed::$order src/Service/CheckoutFailed.php:9 exact',
  ])
  const files = { 'src/Service/Guess.php': '<?php\nfunction guess($unknown) {\n    return $unknown->currency;\n}\n' }
  const guessed = await resolvePhpClick(createPhpProject(createMemoryWorkspace({ ...SHOP_FILES, ...files })), positionIn(files, 'src/Service/Guess.php', '->currency', 'currency'))
  expect(guessed.targets.map(target => `${target.label} ${target.path}:${target.line}:${target.column} ${target.certainty}`)).toEqual([
    'Money::$currency src/Entity/Money.php:9:31 candidate',
  ])
  expect(guessed.targets[0]?.preview).toBe('public readonly string $currency,')
})

test('a constant written in capitals that no file declares is said to come from PHP or a dependency', async () => {
  const files = { 'src/Service/Lines.php': "<?php\nconst SHOP_NAME = 'shop';\nfunction lines() {\n    return SHOP_NAME . PHP_EOL . lowercase;\n}\n" }
  const project = createPhpProject(createShopWorkspace(files))
  const declared = await resolvePhpClick(project, positionIn(files, 'src/Service/Lines.php', 'return SHOP_NAME', 'SHOP_NAME'))
  expect(declared.targets.map(target => `${target.label} ${target.path}:${target.line} ${target.certainty}`)).toEqual(['SHOP_NAME src/Service/Lines.php:2 exact'])
  const builtIn = await resolvePhpClick(project, positionIn(files, 'src/Service/Lines.php', '. PHP_EOL', 'PHP_EOL'))
  expect(builtIn.note).toBe('PHP_EOL is not declared in the project: a constant of PHP or of a dependency')
  expect((await resolvePhpClick(project, positionIn(files, 'src/Service/Lines.php', '. lowercase', 'lowercase'))).symbol).toBe(null)
})

test('a see tag naming a member goes to that member', async () => {
  const files = { 'src/Service/Notes.php': '<?php\nnamespace Shop\\Service;\n/**\n * @see \\Shop\\Entity\\Order::getTotal()\n */\nfunction notes() {}\n' }
  const resolution = await resolvePhpClick(createPhpProject(createShopWorkspace(files)), positionIn(files, 'src/Service/Notes.php', 'Order::getTotal', 'getTotal'))
  expect(resolution.targets.map(target => target.label)).toEqual(['Order::getTotal'])
})
