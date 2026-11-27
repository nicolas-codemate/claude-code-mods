import { expect, test } from 'claude-code/testing'

import { readTokens, readTokensOfLines } from './test-support'

// The tokens of the lines of code written after an opening tag, which is left out of the result.
function readPhp(...codeLines: string[]): string[][] {
  return readTokensOfLines('src/Order.php', ['<?php', ...codeLines]).slice(1)
}

test('text outside the PHP tags is plain text, the tags are keywords', async () => {
  expect(readTokens('templates/order.php', '<h1>Order <?= $order->number ?></h1>\n<?php if ($paid): ?>\n  paid\n<?php endif ?>')).toEqual([
    ['text <h1>Order', 'keyword <?=', 'variable* $order', 'punctuation ->', 'property* number', 'keyword ?>', 'text </h1>'],
    ['keyword <?php', 'keyword if', 'punctuation (', 'variable* $paid', 'punctuation ):', 'keyword ?>'],
    ['text paid'],
    ['keyword <?php', 'keyword endif', 'keyword ?>'],
  ])
})

test('a name before a parenthesis is a call, a name after -> or :: a property unless it is called', async () => {
  expect(readPhp('$total = $this->cart?->total() + $order->lines[0]->price + Tax::RATE + count($lines);')).toEqual([
    [
      'variable* $total', 'punctuation =', 'keyword $this', 'punctuation ->', 'property* cart', 'punctuation ?->',
      'callName* total', 'punctuation ()', 'punctuation +', 'variable* $order', 'punctuation ->', 'property* lines',
      'punctuation [', 'number 0', 'punctuation ]->', 'property* price', 'punctuation +', 'typeName* Tax',
      'punctuation ::', 'property* RATE', 'punctuation +', 'callName* count', 'punctuation (', 'variable* $lines',
      'punctuation );',
    ],
  ])
})

test('the name of a class is a type name after new, extends, implements, instanceof and before ::', async () => {
  expect(
    readPhp(
      'final class OrderMailer extends Mailer implements Sender, \\Countable {}',
      '$order = new Order(Status::Draft);',
      'if ($order instanceof PaidOrder) { return Invoice::class; }',
      'enum Status: string implements HasLabel { case Draft = \'draft\'; }',
    ),
  ).toEqual([
    [
      'keyword final', 'keyword class', 'typeName* OrderMailer', 'keyword extends', 'typeName* Mailer',
      'keyword implements', 'typeName* Sender', 'punctuation ,', 'typeName* \\Countable', 'punctuation {}',
    ],
    [
      'variable* $order', 'punctuation =', 'keyword new', 'typeName* Order', 'punctuation (', 'typeName* Status',
      'punctuation ::', 'property* Draft', 'punctuation );',
    ],
    [
      'keyword if', 'punctuation (', 'variable* $order', 'keyword instanceof', 'typeName* PaidOrder', 'punctuation )',
      'punctuation {', 'keyword return', 'typeName* Invoice', 'punctuation ::', 'keyword class', 'punctuation ;',
      'punctuation }',
    ],
    [
      'keyword enum', 'typeName* Status', 'punctuation :', 'keyword string', 'keyword implements', 'typeName* HasLabel',
      'punctuation {', 'keyword case', 'name* Draft', 'punctuation =', "string 'draft'", 'punctuation ;', 'punctuation }',
    ],
  ])
})

test('parameter, property and return types are type names, built-in types keywords, default values plain code', async () => {
  expect(
    readPhp(
      'private ?OrderRepository $orders;',
      'public static function find(int $id, Order|Invoice|null $document = null, Status $status = Status::Draft): ?Order {}',
      '$sum = fn (Line $line, array ...$more): float => $line->price | FLAG;',
    ),
  ).toEqual([
    ['keyword private', 'punctuation ?', 'typeName* OrderRepository', 'variable* $orders', 'punctuation ;'],
    [
      'keyword public', 'keyword static', 'keyword function', 'callName* find', 'punctuation (', 'keyword int',
      'variable* $id', 'punctuation ,', 'typeName* Order', 'punctuation |', 'typeName* Invoice', 'punctuation |',
      'keyword null', 'variable* $document', 'punctuation =', 'keyword null', 'punctuation ,', 'typeName* Status',
      'variable* $status', 'punctuation =', 'typeName* Status', 'punctuation ::', 'property* Draft', 'punctuation ):',
      'punctuation ?', 'typeName* Order', 'punctuation {}',
    ],
    [
      'variable* $sum', 'punctuation =', 'keyword fn', 'punctuation (', 'typeName* Line', 'variable* $line',
      'punctuation ,', 'keyword array', 'punctuation ...', 'variable* $more', 'punctuation ):', 'keyword float',
      'punctuation =>', 'variable* $line', 'punctuation ->', 'property* price', 'punctuation |', 'name* FLAG',
      'punctuation ;',
    ],
  ])
})

test('a grouped type keeps its names as types, in a return type as in a parameter', async () => {
  expect(readPhp('function lines((Countable&Traversable)|null $lines): (Line&Priced)|null {}')).toEqual([
    [
      'keyword function', 'callName* lines', 'punctuation ((', 'typeName* Countable', 'punctuation &',
      'typeName* Traversable', 'punctuation )|', 'keyword null', 'variable* $lines', 'punctuation ):', 'punctuation (',
      'typeName* Line', 'punctuation &', 'typeName* Priced', 'punctuation )|', 'keyword null', 'punctuation {}',
    ],
  ])
})

test('promoted constructor parameters keep their types across lines and attributes', async () => {
  expect(
    readPhp(
      'public function __construct(',
      "    #[Autowire(service: 'shop.mailer')]",
      '    private readonly Mailer $mailer,',
      '    private Clock $clock,',
      ') {}',
    ).slice(1, 4),
  ).toEqual([
    ['punctuation #[', 'typeName* Autowire', 'punctuation (', 'name* service', 'punctuation :', "string 'shop.mailer'", 'punctuation )]'],
    ['keyword private', 'keyword readonly', 'typeName* Mailer', 'variable* $mailer', 'punctuation ,'],
    ['keyword private', 'typeName* Clock', 'variable* $clock', 'punctuation ,'],
  ])
})

test('use statements name types, a grouped use too, and a closure use captures variables', async () => {
  expect(
    readPhp(
      'namespace App\\Shop;',
      'use App\\Entity\\Order as ShopOrder;',
      'use App\\Entity\\{Product, Invoice};',
      'use function App\\Support\\format_price;',
      'class Cart { use HasLines, HasTotal; }',
      '$apply = function (Order $order) use ($tax, &$total): void {};',
    ),
  ).toEqual([
    ['keyword namespace', 'name* App\\Shop', 'punctuation ;'],
    ['keyword use', 'typeName* App\\Entity\\Order', 'keyword as', 'typeName* ShopOrder', 'punctuation ;'],
    ['keyword use', 'name* App\\Entity\\', 'punctuation {', 'typeName* Product', 'punctuation ,', 'typeName* Invoice', 'punctuation };'],
    ['keyword use', 'keyword function', 'name* App\\Support\\format_price', 'punctuation ;'],
    [
      'keyword class', 'typeName* Cart', 'punctuation {', 'keyword use', 'typeName* HasLines', 'punctuation ,',
      'typeName* HasTotal', 'punctuation ;', 'punctuation }',
    ],
    [
      'variable* $apply', 'punctuation =', 'keyword function', 'punctuation (', 'typeName* Order', 'variable* $order',
      'punctuation )', 'keyword use', 'punctuation (', 'variable* $tax', 'punctuation ,', 'punctuation &',
      'variable* $total', 'punctuation ):', 'keyword void', 'punctuation {};',
    ],
  ])
})

test('a catch names exception types, an attribute a class, its arguments are code and not a comment', async () => {
  expect(
    readPhp(
      "#[Route('/orders', name: 'order_list'), IsGranted(Role::Admin)]",
      'try {} catch (OrderNotFound | \\RuntimeException $error) {}',
      '# a comment',
    ),
  ).toEqual([
    [
      'punctuation #[', 'typeName* Route', 'punctuation (', "string '/orders'", 'punctuation ,', 'name* name',
      'punctuation :', "string 'order_list'", 'punctuation ),', 'typeName* IsGranted', 'punctuation (', 'typeName* Role',
      'punctuation ::', 'property* Admin', 'punctuation )]',
    ],
    [
      'keyword try', 'punctuation {}', 'keyword catch', 'punctuation (', 'typeName* OrderNotFound', 'punctuation |',
      'typeName* \\RuntimeException', 'variable* $error', 'punctuation )', 'punctuation {}',
    ],
    ['comment # a comment'],
  ])
})

test('a reserved word is a name where it declares a constant, labels an argument or follows an arrow', async () => {
  expect(
    readPhp('const LIST = 1;', 'public const string DEFAULT = self::LIST;', '$query->list(default: 1, class: Order::class);'),
  ).toEqual([
    ['keyword const', 'name* LIST', 'punctuation =', 'number 1', 'punctuation ;'],
    [
      'keyword public', 'keyword const', 'keyword string', 'name* DEFAULT', 'punctuation =', 'keyword self',
      'punctuation ::', 'property* LIST', 'punctuation ;',
    ],
    [
      'variable* $query', 'punctuation ->', 'callName* list', 'punctuation (', 'name* default', 'punctuation :',
      'number 1', 'punctuation ,', 'name* class', 'punctuation :', 'typeName* Order', 'punctuation ::', 'keyword class',
      'punctuation );',
    ],
  ])
})

test('comments and strings hold no code, a single-quoted string knows no variable', async () => {
  expect(
    readPhp(
      "$label = 'it\\'s $not // code'; // new Order()",
      '/* new Order()',
      '   still a comment */ $paid = "a \\" quote";',
    ),
  ).toEqual([
    ['variable* $label', 'punctuation =', "string 'it\\'s $not // code'", 'punctuation ;', 'comment // new Order()'],
    ['comment /* new Order()'],
    ['comment still a comment */', 'variable* $paid', 'punctuation =', 'string "a \\" quote"', 'punctuation ;'],
  ])
})

test('a double-quoted string sets its variables and its braced expressions apart', async () => {
  expect(readPhp('$line = "Order $order->number of {$customer->name()} costs \\$5";')).toEqual([
    [
      'variable* $line', 'punctuation =', 'string "Order', 'variable* $order', 'punctuation ->', 'property* number',
      'string of', 'punctuation {', 'variable* $customer', 'punctuation ->', 'callName* name', 'punctuation ()}',
      'string costs \\$5"', 'punctuation ;',
    ],
  ])
})

test('a heredoc runs to its closing label, a nowdoc holds no variable, code resumes after it', async () => {
  expect(
    readPhp(
      '$sql = <<<SQL',
      '    SELECT * FROM orders WHERE id = $id',
      '    SQL;',
      "$raw = <<<'TEXT'",
      'new $order',
      'TEXT;',
      'return new Order();',
    ),
  ).toEqual([
    ['variable* $sql', 'punctuation =', 'string <<<SQL'],
    ['string SELECT * FROM orders WHERE id =', 'variable* $id'],
    ['string SQL', 'punctuation ;'],
    ['variable* $raw', 'punctuation =', "string <<<'TEXT'"],
    ['string new $order'],
    ['string TEXT', 'punctuation ;'],
    ['keyword return', 'keyword new', 'typeName* Order', 'punctuation ();'],
  ])
})

test('a heredoc holding a null character stays one string, what follows its label on the opening line too', async () => {
  expect(readPhp('$a = <<<EOT junk', 'a\u0000b {$c', 'EOT;')).toEqual([
    ['variable* $a', 'punctuation =', 'string <<<EOT junk'],
    ['string a\u0000b', 'punctuation {', 'variable* $c'],
    ['string EOT', 'punctuation ;'],
  ])
})

test('a comment, a string or a heredoc left open runs to the end of the file', async () => {
  expect(readPhp('$a = 1; /* open', 'new Order()')).toEqual([
    ['variable* $a', 'punctuation =', 'number 1', 'punctuation ;', 'comment /* open'],
    ['comment new Order()'],
  ])
  expect(readPhp("$a = 'open", 'new Order()')).toEqual([['variable* $a', 'punctuation =', "string 'open"], ['string new Order()']])
  expect(readPhp('$a = <<<EOT', 'new Order()')).toEqual([['variable* $a', 'punctuation =', 'string <<<EOT'], ['string new Order()']])
})

test('a line comment stops at a closing tag', async () => {
  expect(readTokens('templates/order.php', '<?php // note ?> text')).toEqual([
    ['keyword <?php', 'comment // note', 'keyword ?>', 'text text'],
  ])
})

test('numbers and keywords are never navigable, names, variables, types, calls and properties are', async () => {
  expect(readPhp('return match (true) { default => 0x1F + 1_000.5 };')).toEqual([
    [
      'keyword return', 'keyword match', 'punctuation (', 'keyword true', 'punctuation )', 'punctuation {',
      'keyword default', 'punctuation =>', 'number 0x1F', 'punctuation +', 'number 1_000.5', 'punctuation };',
    ],
  ])
})
