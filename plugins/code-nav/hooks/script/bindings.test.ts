import { expect, test } from 'claude-code/testing'

import { plainTypeNameIndex, readBindingPattern, readParameterList } from './bindings'
import { matchBrackets } from './structure'
import { tokenizeScript } from './tokenizer'

function read(text: string) {
  const tokens = tokenizeScript(text)

  return { tokens, matchingIndexes: matchBrackets(tokens) }
}

test('a destructuring pattern binds its names, renamed, nested, defaulted or collected', async () => {
  const { tokens, matchingIndexes } = read('{ orders, load: reload, paging: { page = 1 }, ...rest } = useOrders()')
  const pattern = readBindingPattern(tokens, matchingIndexes, 0)
  expect(pattern.boundNames.map(boundName => [tokens[boundName.tokenIndex]?.text, boundName.sourceProperty])).toEqual([
    ['orders', 'orders'],
    ['reload', 'load'],
    ['page', null],
    ['rest', null],
  ])
  expect(tokens[pattern.indexAfterPattern]?.text).toBe('=')
})

test('a renamed name remembers the key it is read from', async () => {
  const { tokens, matchingIndexes } = read('{ load: reload }')
  const [boundName] = readBindingPattern(tokens, matchingIndexes, 0).boundNames
  expect(tokens[boundName?.keyTokenIndex ?? -1]?.text).toBe('load')
})

test('an array pattern binds its elements and skips its holes', async () => {
  const { tokens, matchingIndexes } = read('[first, , third = 3, ...others]')
  expect(
    readBindingPattern(tokens, matchingIndexes, 0).boundNames.map(boundName => tokens[boundName.tokenIndex]?.text),
  ).toEqual(['first', 'third', 'others'])
})

test('parameters are read with their type and default value, a constructor property is told apart', async () => {
  const { tokens, matchingIndexes } = read(
    '(private readonly client: HttpClient, { force = false }: Options = {}, ...ids: string[])',
  )
  const parameters = readParameterList(tokens, matchingIndexes, 1, tokens.length - 1)
  expect(parameters.map(parameter => parameter.boundNames.map(boundName => tokens[boundName.tokenIndex]?.text))).toEqual([
    ['client'],
    ['force'],
    ['ids'],
  ])
  expect(parameters.map(parameter => parameter.isProperty)).toEqual([true, false, false])
  expect(parameters.map(parameter => tokens[parameter.typeTokenIndex ?? -1]?.text)).toEqual([
    'HttpClient',
    'Options',
    'string',
  ])
  expect(tokens[parameters[1]?.defaultValueTokenIndex ?? -1]?.text).toBe('{')
})

test('the "this" of a function signature is no parameter', async () => {
  const { tokens, matchingIndexes } = read('(this: Window, event: Event)')
  expect(
    readParameterList(tokens, matchingIndexes, 1, tokens.length - 1).map(
      parameter => tokens[parameter.boundNames[0]?.tokenIndex ?? -1]?.text,
    ),
  ).toEqual(['event'])
})

test('a type is a plain name when it is one name, alone, with type arguments or allowing null', async () => {
  const cases: Array<[string, string | null]> = [
    ['Order = x', 'Order'],
    ['Order | null,', 'Order'],
    ['Shop.Order)', 'Order'],
    ['Order[]', null],
    ['Ref<Order>', 'Ref'],
    ['Repository<Order> | null = x', 'Repository'],
    ['Repository<Order>[]', null],
    ['string', null],
    ['Order | Invoice', null],
    ['{ id: string }', null],
  ]
  for (const [text, expectedName] of cases) {
    const { tokens, matchingIndexes } = read(text)
    const nameIndex = plainTypeNameIndex(tokens, matchingIndexes, 0)
    expect(nameIndex === null ? null : (tokens[nameIndex]?.text ?? null)).toBe(expectedName)
  }
})
