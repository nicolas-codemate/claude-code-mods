import { expect, test } from 'claude-code/testing'

import { stringTokenValue, tokenIndexAtOffset, tokenizeScript } from './tokenizer'

function kindsAndTexts(text: string, hasMarkup = false): string[] {
  return tokenizeScript(text, { hasMarkup }).map(token => `${token.kind}:${token.text}`)
}

test('comments leave no token and a string is one token whatever it holds', async () => {
  expect(kindsAndTexts('const total = 1 // not code\n/* nor this */ let label = "a // b"')).toEqual([
    'identifier:const',
    'identifier:total',
    'punctuation:=',
    'number:1',
    'identifier:let',
    'identifier:label',
    'punctuation:=',
    'string:"a // b"',
  ])
})

test('a template literal is cut into its text and the code of its substitutions', async () => {
  expect(kindsAndTexts('`total: ${order.total} for ${`#${id}`}`')).toEqual([
    'template:`total: ',
    'punctuation:${',
    'identifier:order',
    'punctuation:.',
    'identifier:total',
    'punctuation:}',
    'template: for ',
    'punctuation:${',
    'template:`#',
    'punctuation:${',
    'identifier:id',
    'punctuation:}',
    'template:`',
    'punctuation:}',
    'template:`',
  ])
})

test('a slash opens a regular expression where a value may start and divides elsewhere', async () => {
  expect(kindsAndTexts('const pattern = /a\\/[/"]{2}/g')).toEqual([
    'identifier:const',
    'identifier:pattern',
    'punctuation:=',
    'regularExpression:/a\\/[/"]{2}/g',
  ])
  expect(kindsAndTexts('total / count / 2')).toEqual([
    'identifier:total',
    'punctuation:/',
    'identifier:count',
    'punctuation:/',
    'number:2',
  ])
  expect(kindsAndTexts('return /order/.test(name)').slice(0, 2)).toEqual(['identifier:return', 'regularExpression:/order/'])
})

test('an arrow and an optional chain are one token each, two closing angle brackets stay two', async () => {
  expect(kindsAndTexts('(a) => a?.b ?? c')).toEqual([
    'punctuation:(',
    'identifier:a',
    'punctuation:)',
    'punctuation:=>',
    'identifier:a',
    'punctuation:?.',
    'identifier:b',
    'punctuation:??',
    'identifier:c',
  ])
  expect(kindsAndTexts('Map<string, Array<Order>>').slice(-2)).toEqual(['punctuation:>', 'punctuation:>'])
  expect(kindsAndTexts('flag ? .5 : 1')).toEqual([
    'identifier:flag',
    'punctuation:?',
    'number:.5',
    'punctuation::',
    'number:1',
  ])
})

test('the text of a JSX element is no code, its component names are identifiers', async () => {
  const tokens = kindsAndTexts('return <Box title="it\'s">don\'t {order.id} <Text.Bold/></Box>', true)
  expect(tokens).toEqual([
    'identifier:return',
    'punctuation:<',
    'identifier:Box',
    'markupName:title',
    'punctuation:=',
    'string:"it\'s"',
    'punctuation:>',
    'punctuation:{',
    'identifier:order',
    'punctuation:.',
    'identifier:id',
    'punctuation:}',
    'punctuation:<',
    'identifier:Text',
    'punctuation:.',
    'identifier:Bold',
    'punctuation:/',
    'punctuation:>',
    'punctuation:<',
    'punctuation:/',
    'identifier:Box',
    'punctuation:>',
  ])
})

test('a comparison and type arguments are not JSX, a lower-case tag names no declaration', async () => {
  expect(
    kindsAndTexts('count < limit && useState<Order>(order)', true).filter(token => token.startsWith('markupName')),
  ).toEqual([])
  expect(kindsAndTexts('const row = <box flexGrow={1} />', true)).toEqual([
    'identifier:const',
    'identifier:row',
    'punctuation:=',
    'punctuation:<',
    'markupName:box',
    'markupName:flexGrow',
    'punctuation:=',
    'punctuation:{',
    'number:1',
    'punctuation:}',
    'punctuation:/',
    'punctuation:>',
  ])
})

test('a token knows whether a line break precedes it', async () => {
  const tokens = tokenizeScript('const a = 1\nconst b = 2 /* same\nline */ + 3')
  expect(tokens.filter(token => token.followsLineBreak).map(token => token.text)).toEqual(['const', '+'])
})

test('a range of the text is tokenized with the offsets of the whole text', async () => {
  const text = '<p>{{ order.total }}</p>'
  const tokens = tokenizeScript(text, { start: 5, end: 18 })
  expect(tokens.map(token => [token.text, token.start])).toEqual([
    ['order', 6],
    ['.', 11],
    ['total', 12],
  ])
})

test('an unterminated string or template ends with the text and never throws', async () => {
  expect(kindsAndTexts("const a = 'open")).toEqual(['identifier:const', 'identifier:a', 'punctuation:=', "string:'open"])
  expect(kindsAndTexts('`open ${a').map(token => token.split(':')[0])).toEqual(['template', 'punctuation', 'identifier'])
})

test('the token under an offset is found, none between tokens', async () => {
  const tokens = tokenizeScript('load(order)  // done')
  expect(tokens[tokenIndexAtOffset(tokens, 6)]?.text).toBe('order')
  expect(tokenIndexAtOffset(tokens, 11)).toBe(-1)
  expect(tokenIndexAtOffset(tokens, 16)).toBe(-1)
})

test('the value of a string token leaves its quotes out', async () => {
  const [specifier] = tokenizeScript("'@/api/orders'")
  expect(specifier === undefined ? '' : stringTokenValue(specifier)).toBe('@/api/orders')
})
