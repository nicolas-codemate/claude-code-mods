import { expect, test } from 'claude-code/testing'

import type { Capabilities, TalkSettings } from './engines'
import { effectiveSpeedOf, engineShownOf } from './engines'
import { failureMessageOf } from './providers/synthesis'

const settingsWith = (engine: TalkSettings['engine']): TalkSettings => ({
  engine,
  language: 'fr',
  speed: 1,
  openai: { apiKey: '', model: '', voice: 'marin' },
  elevenlabs: { apiKey: '', model: '', voiceId: '' },
  piper: { command: '', voice: '', voiceName: '' },
})

const machineWithPiper: Capabilities = {
  platform: 'Linux',
  wavPlayer: ['pw-play'],
  piper: { command: 'piper', voice: '/voices/fr_FR-siwis-medium.onnx', speakerId: null, python: null },
  systemVoice: 'spd-say',
  hasOpenAiKey: false,
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
