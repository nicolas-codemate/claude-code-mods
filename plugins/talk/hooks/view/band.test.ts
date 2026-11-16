import { expect, test } from 'claude-code/testing'

import type { Reading } from '../../types'
import { tokensOf } from '../spoken-text'
import { thinkingLineOf, visibleTokensOf } from './band'

const readingOf = (text: string, currentWordIndex: number): Reading => ({ tokens: tokensOf(text), currentWordIndex, phase: 'speaking', engine: 'piper', error: null })

test('an answer too long for the band is shown from the sentence being read on', async () => {
  const reading = readingOf('First sentence here. Second one now. Third.', 4)
  const textOf = (columns: number, rows: number) => visibleTokensOf(reading, columns, rows).map(token => token.text).join('')

  expect(textOf(80, 3)).toBe('First sentence here. Second one now. Third.')
  expect(textOf(20, 2)).toBe('Second one now. Third.')
})

test('the wait for the next answer pulses as Claude Code thinks, its word changing every few steps', async () => {
  expect(thinkingLineOf(0)).toEqual({ glyph: '·', word: 'Cogitating' })
  expect(thinkingLineOf(5)).toEqual({ glyph: '✽', word: 'Cogitating' })
  expect(thinkingLineOf(16).word).toBe('Pondering')
  expect(thinkingLineOf(16 * 8).word).toBe('Cogitating')
})
