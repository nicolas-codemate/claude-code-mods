import { expect, test } from 'claude-code/testing'

import { argumentRangesBetween, endOfExpressionFrom, isCallableName, parsePhpExpression, receiverExpressionOf, startOfAccessChain } from './expression'
import type { PhpExpression } from './expression'
import { tokenizePhp } from './tokens'
import type { PhpTokenizedSource } from './tokens'

function sourceOf(code: string): PhpTokenizedSource {
  return tokenizePhp(`<?php ${code}`)
}

// A compact spelling of an expression tree, to compare whole chains in one line.
function shapeOf(expression: PhpExpression): string {
  switch (expression.kind) {
    case 'variable':
      return expression.name
    case 'name':
      return expression.name
    case 'instantiation':
      return `new ${expression.className ?? '?'}`
    case 'methodCall':
      return `${shapeOf(expression.receiver)}${expression.isStatic ? '::' : '->'}${expression.name}(${expression.argumentRanges.length})`
    case 'propertyAccess':
      return `${shapeOf(expression.receiver)}${expression.isStatic ? '::$' : '->'}${expression.name}`
    case 'classConstant':
      return `${shapeOf(expression.receiver)}::${expression.name}`
    case 'functionCall':
      return `${expression.name}(${expression.argumentRanges.length})`
    case 'invocation':
      return `${shapeOf(expression.callee)}()`
    case 'elementAccess':
      return `${shapeOf(expression.receiver)}[${expression.key ?? ''}]`
    case 'arrayLiteral':
      return 'array'
    case 'alternatives':
      return expression.alternatives.map(shapeOf).join(' | ')
    case 'closure':
    case 'scalar':
    case 'unknown':
      return expression.kind
    default: {
      const unhandledExpression: never = expression

      return unhandledExpression
    }
  }
}

function receiverShapeOf(code: string, memberName: string): string {
  const source = sourceOf(code)
  const memberTokenIndex = source.tokens.findLastIndex(token => token.text === memberName)

  return shapeOf(receiverExpressionOf(source, memberTokenIndex))
}

function valueShapeOf(code: string): string {
  const source = sourceOf(`$value = ${code};`)

  return shapeOf(parsePhpExpression(source, { start: 2, end: endOfExpressionFrom(source, 2) }))
}

test('the receiver of a member is the whole chain before it', async () => {
  expect(receiverShapeOf('$this->orders->find($id)->getTotal();', 'getTotal')).toBe('$this->orders->find(1)')
  expect(receiverShapeOf('return $order?->getCustomer()?->getEmail();', 'getEmail')).toBe('$order->getCustomer(0)')
  expect(receiverShapeOf('Money::zero()->add($other);', 'add')).toBe('Money::zero(0)')
  expect(receiverShapeOf('static::$instances[$key]->reset();', 'reset')).toBe('static::$instances[]')
  expect(receiverShapeOf("$rows['total']->format();", 'format')).toBe('$rows[total]')
  expect(receiverShapeOf('$a = $b + $order->getTotal();', 'getTotal')).toBe('$order')
  expect(receiverShapeOf('foo($x, $order->getLines()[0]->getProduct());', 'getProduct')).toBe('$order->getLines(0)[0]')
})

test('new, clone and parentheses start a chain', async () => {
  expect(receiverShapeOf('(new InvoiceGenerator($a, $b))->generate($order);', 'generate')).toBe('new InvoiceGenerator')
  expect(receiverShapeOf('new InvoiceGenerator()->generate($order);', 'generate')).toBe('new InvoiceGenerator')
  expect(receiverShapeOf('(clone $this->query)->where($x);', 'where')).toBe('$this->query')
  expect(receiverShapeOf('($fallback ?? $this->primary)->send();', 'send')).toBe('$fallback | $this->primary')
  expect(receiverShapeOf('format_price($total)->render();', 'render')).toBe('format_price(1)')
  expect(receiverShapeOf('$factory()->build();', 'build')).toBe('$factory()')
})

test('a chain spread over several lines reads as on one', async () => {
  expect(receiverShapeOf('$query\n    ->where("a")\n    // a remark\n    ->orderBy("b")\n    ?->getResult();', 'getResult')).toBe('$query->where(1)->orderBy(1)')
})

test('what stands before a member and is no chain is unknown', async () => {
  expect(receiverShapeOf('$object->{$name}->call();', 'call')).toBe('unknown')
  expect(receiverShapeOf('match ($a) { 1 => $x }->call();', 'call')).toBe('unknown')
})

test('the value of an assignment is read through ternaries, coalescing, match arms and nested assignments', async () => {
  expect(valueShapeOf('$first ?? $this->second ?? new Third()')).toBe('$first | $this->second | new Third')
  expect(valueShapeOf('$isPaid ? $order->getInvoice() : null')).toBe('$order->getInvoice(0) | scalar')
  expect(valueShapeOf('$cached ?: $this->load()')).toBe('$cached | $this->load(0)')
  expect(valueShapeOf('$other = new Order()')).toBe('new Order')
  expect(valueShapeOf('match ($kind) { Kind::A, Kind::B => new First(), default => $this->second }')).toBe('new First | $this->second')
  expect(valueShapeOf('clone $order')).toBe('$order')
  expect(valueShapeOf('&$this->cache')).toBe('$this->cache')
})

test('scalars, closures and array literals are told apart from chains', async () => {
  expect(valueShapeOf("'a' . $order->getId()")).toBe('scalar')
  expect(valueShapeOf('$order instanceof Paid')).toBe('scalar')
  expect(valueShapeOf('!$order->isPaid()')).toBe('scalar')
  expect(valueShapeOf('fn (Order $o) => $o->getTotal()')).toBe('closure')
  expect(valueShapeOf('static function () use ($x) { return $x; }')).toBe('closure')
  expect(valueShapeOf('[new Order(), new Order()]')).toBe('array')
  expect(valueShapeOf('Order::class')).toBe('Order::class')
  expect(valueShapeOf('(string) $order')).toBe('unknown')
})

test('arguments are split on the commas of their own level, a named one loses its name', async () => {
  const source = sourceOf('create($a, [1, 2], name: $b->c(1, 2), fn ($x, $y) => $x);')
  const ranges = argumentRangesBetween(source, 1, source.matchingBracketIndexes[1] ?? -1)
  expect(ranges.map(range => source.tokens.slice(range.start, range.end).map(token => token.text).join(''))).toEqual([
    '$a',
    '[1,2]',
    '$b->c(1,2)',
    'fn($x,$y)=>$x',
  ])
})

test('an expression ends at its semicolon or at the bracket closing what holds it', async () => {
  const source = sourceOf('if ($order = $this->find($id, [1])) { $x; }')
  const assignmentIndex = source.tokens.findIndex(token => token.text === '=')
  expect(source.tokens[endOfExpressionFrom(source, assignmentIndex + 1)]?.text).toBe(')')
  expect(startOfAccessChain(source, source.tokens.findIndex(token => token.text === '$this'))).toBe(assignmentIndex + 1)
})

test('language constructs written like calls are not function names', async () => {
  expect(['isset', 'array', 'match', 'if', 'function', 'static'].map(isCallableName)).toEqual([false, false, false, false, false, false])
  expect(['count', 'format_price', 'Shop\\helper'].map(isCallableName)).toEqual([true, true, true])
})
