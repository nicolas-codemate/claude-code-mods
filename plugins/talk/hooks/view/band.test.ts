import { expect, test } from 'claude-code/testing'

import type { Reading } from '../../types'
import { tokensOf } from '../spoken-text'
import { costLabelOf } from '../engines'
import { isVoiceShownBy, speedsOf, thinkingLineOf, visibleTokensOf, voiceListLayoutOf } from './band'

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

test('a few voices are listed one per line, a long list in as few columns as keep it within the band', async () => {
  expect(voiceListLayoutOf(4, 130, 32, 20)).toEqual({ listColumns: 1, rowsPerColumn: 4 })
  expect(voiceListLayoutOf(26, 130, 32, 20)).toEqual({ listColumns: 4, rowsPerColumn: 7 })
  expect(voiceListLayoutOf(26, 130, 32, 6)).toEqual({ listColumns: 4, rowsPerColumn: 7 })
  expect(voiceListLayoutOf(26, 70, 32, 20)).toEqual({ listColumns: 2, rowsPerColumn: 13 })
})

test('an answer the band cannot hold whole is cut to its rows, even within a long sentence', async () => {
  const reading = readingOf('One very long sentence that goes on and on and does not stop at all.', 3)
  const shown = visibleTokensOf(reading, 20, 2).map(token => token.text).join('')

  // Wrapped between words at 20 columns: 'One very long' / 'sentence that goes'.
  expect(shown.trim()).toBe('One very long sentence that goes')
  expect(visibleTokensOf(reading, 20, 0)).toEqual([])
})

test('the speeds offered are those the engine reads at, its fastest included', async () => {
  expect(speedsOf('elevenlabs')).toEqual([0.75, 1, 1.2])
  expect(speedsOf('piper')).toEqual([0.75, 1, 1.25, 1.5, 2])
})

test('the gender filter keeps the voices of that gender, a voice of no known gender under All alone', async () => {
  const voice = (gender: 'female' | 'male' | null) => ({ value: 'v', label: 'V', download: null, sizeBytes: null, gender })

  expect(isVoiceShownBy('female', voice('female'))).toBe(true)
  expect(isVoiceShownBy('female', voice('male'))).toBe(false)
  expect(isVoiceShownBy('male', voice(null))).toBe(false)
  expect(isVoiceShownBy('all', voice(null))).toBe(true)
})

test('beside the engine, what the session cost: ElevenLabs credits, OpenAI dollars, nothing for a local voice', async () => {
  const nothing = { characters: 0, audioSeconds: 0 }
  const spending = { elevenlabs: { characters: 640, audioSeconds: 40 }, openai: { characters: 900, audioSeconds: 240 }, piper: nothing, system: nothing }

  expect(costLabelOf('elevenlabs', spending, { elevenlabs: { used: 1_640, limit: 10_000, usedAtStart: 1_000 } })).toBe('640 credits · 8,360 left')
  expect(costLabelOf('elevenlabs', spending, {})).toBe('640 characters')
  expect(costLabelOf('openai', spending, {})).toBe('≈ $0.06')
  expect(costLabelOf('piper', spending, {})).toBe(null)
})
