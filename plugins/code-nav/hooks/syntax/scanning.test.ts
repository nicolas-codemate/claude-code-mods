import { expect, test } from 'claude-code/testing'

import { createTokenCollector, offsetAfterNumber, offsetAfterQuotedString } from './scanning'

test('a piece spanning several lines is cut at each line end and loses the whitespace around it', async () => {
  const text = '  /* first\r\n     second */  x'
  const collector = createTokenCollector(text)
  collector.add(2, text.indexOf('*/') + 2, 'comment', false)
  collector.add(text.length - 1, text.length, 'name', true)

  expect(collector.tokensByLine).toEqual([
    [{ startColumn: 2, endColumn: 10, kind: 'comment', isNavigable: false }],
    [
      { startColumn: 5, endColumn: 14, kind: 'comment', isNavigable: false },
      { startColumn: 16, endColumn: 17, kind: 'name', isNavigable: true },
    ],
  ])
})

test('touching punctuation is kept as one piece, touching names are not', async () => {
  const collector = createTokenCollector('());ab')
  collector.add(0, 1, 'punctuation', false)
  collector.add(1, 3, 'punctuation', false)
  collector.add(3, 4, 'punctuation', false)
  collector.add(4, 5, 'name', true)
  collector.add(5, 6, 'name', true)

  expect(collector.tokensByLine[0]?.map(token => [token.startColumn, token.endColumn])).toEqual([
    [0, 4],
    [4, 5],
    [5, 6],
  ])
})

test('a piece that would overlap the previous one keeps only what lies after it', async () => {
  const collector = createTokenCollector('abcdef')
  collector.add(0, 4, 'string', false)
  collector.add(2, 6, 'name', true)
  collector.add(1, 3, 'number', false)

  expect(collector.tokensByLine[0]?.map(token => [token.startColumn, token.endColumn])).toEqual([
    [0, 4],
    [4, 6],
  ])
})

test('a number runs over its separators, its base, its exponent and its unit', async () => {
  const endOf = (source: string) => offsetAfterNumber(source, 0, source.length)

  expect(endOf('1_000;')).toBe(5)
  expect(endOf('0x1F+1')).toBe(4)
  expect(endOf('1.5e-3)')).toBe(6)
  expect(endOf('10px;')).toBe(4)
  expect(endOf('1..2')).toBe(1)
  expect(endOf('0xE+1')).toBe(3)
})

test('a string ends at its closing quote, an escaped quote left inside, an open one at the end of its line', async () => {
  expect(offsetAfterQuotedString(String.raw`'it\'s' + 1`, 0, 11, false)).toBe(7)
  expect(offsetAfterQuotedString('"open\nnext"', 0, 11, false)).toBe(5)
  expect(offsetAfterQuotedString('"open\nnext"', 0, 11, true)).toBe(11)
})
