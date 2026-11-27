import { expect, test } from 'claude-code/testing'

import {
  bindingVisibleAt,
  enclosingScopeOfKind,
  innermostScopeAt,
  isScopeWithin,
  membersNamed,
  valueScopeOf,
} from './declarations'
import { readScriptStructure } from './structure-reading'
import { tokenizeScript } from './tokenizer'

const TEXT = [
  "const order = 'outer'",
  'function show(order: Order) {',
  '  for (const line of order.lines) { print(line) }',
  '  for (const line of order.returns) { print(line) }',
  '  return order',
  '}',
  'class Cart { total = 0; add() { return this.total } }',
  'const settings = { currency: 1 }',
].join('\n')
const tokens = tokenizeScript(TEXT)
const structure = readScriptStructure(tokens)

function tokenIndexOfNth(text: string, occurrence: number): number {
  return tokens.map((token, index) => (token.text === text ? index : -1)).filter(index => index !== -1)[occurrence - 1] ?? -1
}

function lineOfDeclaration(name: string, tokenIndex: number): number | null {
  const declaration = bindingVisibleAt(structure, name, tokenIndex)

  return declaration === null ? null : TEXT.slice(0, tokens[declaration.nameTokenIndex]?.start).split('\n').length
}

test('a name refers to the binding of the innermost scope around it', async () => {
  expect(lineOfDeclaration('order', tokenIndexOfNth('order', 5))).toBe(2)
  expect(lineOfDeclaration('order', tokenIndexOfNth('const', 1))).toBe(1)
})

test('two loops declaring the same name each keep theirs', async () => {
  expect(lineOfDeclaration('line', tokenIndexOfNth('line', 2))).toBe(3)
  expect(lineOfDeclaration('line', tokenIndexOfNth('line', 4))).toBe(4)
})

test('a member is no binding: it is never what a bare name refers to', async () => {
  expect(bindingVisibleAt(structure, 'total', tokenIndexOfNth('total', 2))).toBe(null)
  expect(bindingVisibleAt(structure, 'currency', tokens.length - 1)).toBe(null)
})

test('the value of a class or of a constant opens the scope holding its members', async () => {
  const cart = bindingVisibleAt(structure, 'Cart', 0)
  const settings = bindingVisibleAt(structure, 'settings', 0)
  const cartScope = cart === null ? null : valueScopeOf(structure, cart)
  const settingsScope = settings === null ? null : valueScopeOf(structure, settings)
  expect(cartScope?.kind).toBe('class')
  expect(settingsScope?.kind).toBe('object')
  expect(cartScope === null ? [] : membersNamed(cartScope, 'add').map(member => member.kind)).toEqual(['method'])
  expect(settingsScope === null ? [] : membersNamed(settingsScope, 'total')).toEqual([])
})

test('the scope around a token and its ancestors are found', async () => {
  const scopeOfThis = innermostScopeAt(structure, tokenIndexOfNth('this', 1))
  const classScope = enclosingScopeOfKind(scopeOfThis, ['class'])
  expect(scopeOfThis.kind).toBe('function')
  expect(classScope?.owner?.name).toBe('Cart')
  expect(classScope !== null && isScopeWithin(scopeOfThis, classScope)).toBe(true)
  expect(isScopeWithin(structure.fileScope, scopeOfThis)).toBe(false)
})
