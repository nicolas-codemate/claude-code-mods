import { expect, test } from 'claude-code/testing'

import type { Capabilities, TalkSettings } from './engines'
import { effectiveSpeedOf, engineShownOf, usedAtStartOf } from './engines'
import { failureMessageOf } from './providers/synthesis'

const settingsWith = (engine: TalkSettings['engine']): TalkSettings => ({
  engine,
  language: 'fr',
  speed: 1,
  providers: {
    elevenlabs: { apiKey: '', model: '', voiceId: '', pronunciationDictionaries: [] },
    openai: { apiKey: '', model: '', voice: 'marin' },
    piper: { command: '', voice: '', voiceName: '' },
    system: {},
  },
})

const machineWithPiper: Capabilities = {
  platform: 'Linux',
  wavPlayer: ['pw-play'],
  providers: {
    elevenlabs: null,
    openai: null,
    piper: { command: 'piper', voice: '/voices/fr_FR-siwis-medium.onnx', speakerId: null, python: null },
    system: 'spd-say',
  },
}

test('the settings line names the engine just chosen at once, and the one auto picks once the machine is known', async () => {
  expect(engineShownOf(settingsWith('system'), null)).toBe('system')
  expect(engineShownOf(settingsWith('piper'), machineWithPiper)).toBe('piper')
  expect(engineShownOf(settingsWith('auto'), machineWithPiper)).toBe('piper')
  expect(engineShownOf(settingsWith('auto'), null)).toBe(null)
})

test('a failed request says what the service answered, not curl\'s status line', async () => {
  const elevenLabsRefusal = JSON.stringify({ detail: { code: 'invalid_voice_settings', message: 'Invalid setting for speed received.' } })

  expect(failureMessageOf(elevenLabsRefusal, 'curl: (22) The requested URL returned error: 400')).toBe('Invalid setting for speed received.')
  expect(failureMessageOf('', 'curl: (6) Could not resolve host')).toBe('curl: (6) Could not resolve host')
})

test('a speed past what the engine takes is read at its nearest', async () => {
  expect(effectiveSpeedOf('elevenlabs', 1.4)).toBe(1.2)
  expect(effectiveSpeedOf('elevenlabs', 0.5)).toBe(0.7)
  expect(effectiveSpeedOf('piper', 1.4)).toBe(1.4)
})

test('the credits spent in the session keep adding up when the account\'s count starts again, at a new month or plan', async () => {
  expect(usedAtStartOf(undefined, 6_127)).toBe(6_127)
  expect(usedAtStartOf({ used: 6_300, limit: 10_000, usedAtStart: 6_127 }, 6_500)).toBe(6_127)
  // 173 credits spent before the count started again at 0; 40 since.
  expect(40 - usedAtStartOf({ used: 6_300, limit: 10_000, usedAtStart: 6_127 }, 40)).toBe(213)
  expect(usedAtStartOf({ used: 648, limit: 121_665, usedAtStart: 6_127 }, 700)).toBe(0)
})
