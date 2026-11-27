import { expect, test } from 'claude-code/testing'

import { firstMatchIndexFrom, textMatchesInLines } from './text-search'

const LINES = ['$order->total();', 'Order::total($order)', '// totally new total']

test('a text typed in lower case is found whatever its case, every time it is written on a line', async () => {
  expect(textMatchesInLines(LINES, 'total', 50).matches).toEqual([
    { line: 1, column: 8 },
    { line: 2, column: 7 },
    { line: 3, column: 3 },
    { line: 3, column: 15 },
  ])
  expect(textMatchesInLines(LINES, 'order', 50).matches.map(match => match.line)).toEqual([1, 2, 2])
})

test('a text with a capital letter is found in that case only', async () => {
  expect(textMatchesInLines(LINES, 'Order', 50).matches).toEqual([{ line: 2, column: 0 }])
})

test('the matches stop at the limit, saying more were left, and an empty text finds nothing', async () => {
  expect(textMatchesInLines(LINES, 'total', 2)).toEqual({ matches: [{ line: 1, column: 8 }, { line: 2, column: 7 }], isTruncated: true })
  expect(textMatchesInLines(LINES, '', 50)).toEqual({ matches: [], isTruncated: false })
})

test('a search lands on the first match from the first line shown, else on the first of the file', async () => {
  const matches = [{ line: 3, column: 0 }, { line: 40, column: 2 }, { line: 90, column: 1 }]
  expect(firstMatchIndexFrom(matches, 30)).toBe(1)
  expect(firstMatchIndexFrom(matches, 1)).toBe(0)
  expect(firstMatchIndexFrom(matches, 95)).toBe(0)
})
