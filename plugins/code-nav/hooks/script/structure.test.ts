import { expect, test } from 'claude-code/testing'

import {
  arrowIndexAfterParameters,
  indexAfterAngleGroup,
  indexAfterExpression,
  indexAfterType,
  matchBrackets,
  startsFunctionExpression,
} from './structure'
import { tokenizeScript } from './tokenizer'

function read(text: string) {
  const tokens = tokenizeScript(text)

  return {
    tokens,
    matchingIndexes: matchBrackets(tokens),
    indexOf: (tokenText: string) => tokens.findIndex(token => token.text === tokenText),
  }
}

test('each bracket knows the one that closes it, a substitution of a template included', async () => {
  const { tokens, matchingIndexes } = read('load({ ids: [1, `${a}`] })')
  const pairs = tokens.flatMap((token, index) =>
    (matchingIndexes[index] ?? -1) > index ? [`${token.text}${tokens[matchingIndexes[index] ?? 0]?.text}`] : [],
  )
  expect(pairs).toEqual(['()', '{}', '[]', '${}'])
})

test('a bracket left open matches nothing and the ones inside it still match', async () => {
  const { tokens, matchingIndexes } = read('function load( { return [1] }')
  expect(matchingIndexes[tokens.findIndex(token => token.text === '(')]).toBe(-1)
  expect(matchingIndexes[tokens.findIndex(token => token.text === '[')]).toBe(tokens.findIndex(token => token.text === ']'))
})

test('type arguments are skipped as a whole', async () => {
  const { tokens, matchingIndexes, indexOf } = read('Map<string, Array<{ id: string }>> = x')
  expect(tokens[indexAfterAngleGroup(tokens, matchingIndexes, indexOf('<'))]?.text).toBe('=')
})

test('a type ends where the code goes on: a default value, a body, another parameter', async () => {
  const cases: Array<[string, string]> = [
    ['Order = x', '='],
    ['Promise<Order[]> {', '{'],
    ['(order: Order) => void, next', ','],
    ["{ id: string } | null | 'none')", ')'],
    ['order is PaidOrder {', '{'],
    ['Order extends Paid ? Invoice : never;', ';'],
    ['typeof ORDERS[number]\nconst next = 1', 'const'],
    ['readonly Order[] = []', '='],
    ['Shop.Order<Line>)', ')'],
  ]
  for (const [text, expectedNextToken] of cases) {
    const { tokens, matchingIndexes } = read(text)
    expect(tokens[indexAfterType(tokens, matchingIndexes, 0)]?.text).toBe(expectedNextToken)
  }
})

test('an expression ends at a semicolon, at a comma when asked, or where a new statement starts', async () => {
  const semicolon = read('load(a, b).then(done); next()')
  expect(semicolon.tokens[indexAfterExpression(semicolon.tokens, semicolon.matchingIndexes, 0, false)]?.text).toBe(';')
  const comma = read('first(1, 2), second = 3')
  expect(comma.tokens[indexAfterExpression(comma.tokens, comma.matchingIndexes, 0, true)]?.text).toBe(',')
  const newLine = read('orders\n  .filter(isPaid)\n  .map(toInvoice)\nconst next = 1')
  expect(newLine.tokens[indexAfterExpression(newLine.tokens, newLine.matchingIndexes, 0, true)]?.text).toBe('const')
  const ternary = read('isPaid\n  ? invoice\n  : null\nreturn invoice')
  expect(ternary.tokens[indexAfterExpression(ternary.tokens, ternary.matchingIndexes, 0, true)]?.text).toBe('return')
})

test('the commas of type arguments end no expression', async () => {
  const { tokens, matchingIndexes } = read('new Map<string, Order>(), second')
  const endIndex = indexAfterExpression(tokens, matchingIndexes, 0, true)
  expect(tokens[endIndex]?.text).toBe(',')
  expect(tokens[endIndex + 1]?.text).toBe('second')
})

test('parentheses followed by an arrow, with or without a return type, are the parameters of a function', async () => {
  const plain = read('(order) => order.id')
  expect(plain.tokens[arrowIndexAfterParameters(plain.tokens, plain.matchingIndexes, 0)]?.text).toBe('=>')
  const typed = read('(order: Order): Promise<() => void> => { }')
  expect(arrowIndexAfterParameters(typed.tokens, typed.matchingIndexes, 0)).toBe(
    typed.tokens.findLastIndex(token => token.text === '=>'),
  )
  const call = read('(order) + 1')
  expect(arrowIndexAfterParameters(call.tokens, call.matchingIndexes, 0)).toBe(-1)
  const methodBody = read('(id: string): () => void { }')
  expect(arrowIndexAfterParameters(methodBody.tokens, methodBody.matchingIndexes, 0)).toBe(-1)
})

test('a value that starts a function is told from any other value', async () => {
  for (const text of [
    'function () {}',
    'async function load() {}',
    '(a) => a',
    'async (a): Promise<void> => {}',
    'order => order.id',
    '<T>(value: T) => value',
  ]) {
    const { tokens, matchingIndexes } = read(text)
    expect(startsFunctionExpression(tokens, matchingIndexes, 0)).toBe(true)
  }
  for (const text of ['computed(() => 1)', '(a + b) * 2', 'order.id', 'async']) {
    const { tokens, matchingIndexes } = read(text)
    expect(startsFunctionExpression(tokens, matchingIndexes, 0)).toBe(false)
  }
})
