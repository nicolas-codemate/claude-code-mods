import { expect, test } from 'claude-code/testing'

import type { SourceToken } from '../../types'
import { tokenInvariantBreaches } from './token-invariants'

function token(startColumn: number, endColumn: number): SourceToken {
  return { startColumn, endColumn, kind: 'name', isNavigable: true }
}

test('sound tokens breach nothing', async () => {
  expect(tokenInvariantBreaches('  order total\r\n', [[token(2, 7), token(8, 13)], []])).toEqual([])
})

test('each way tokens can be unsound is reported', async () => {
  expect(tokenInvariantBreaches('order', [])).toEqual(['0 arrays of tokens for 1 lines', 'line 1: the character at 0 belongs to no token'])
  expect(tokenInvariantBreaches('order', [[token(0, 9)]])[0]).toBe('line 1: name "order" at 0-9 is empty or outside its line of 5 characters')
  expect(tokenInvariantBreaches('order total', [[token(0, 5), token(4, 11)]])[0]).toBe(
    'line 1: name "r total" at 4-11 starts before the previous token ends at 5',
  )
  expect(tokenInvariantBreaches('order total', [[token(0, 6), token(6, 11)]])).toEqual(['line 1: name "order " at 0-6 starts or ends on whitespace'])
  expect(tokenInvariantBreaches('order', [[token(0, 3), token(3, 5)]])).toEqual([
    'line 1: name "ord" at 0-3 starts or ends in the middle of a word',
    'line 1: name "er" at 3-5 starts or ends in the middle of a word',
  ])
  expect(tokenInvariantBreaches('order total', [[token(0, 5)]])).toEqual(['line 1: the character at 6 belongs to no token'])
})
