import { expect, test } from 'claude-code/testing'

import type { Capabilities, TalkSettings } from './engines'
import { engineShownOf } from './engines'

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
  hasElevenLabsKey: false,
}

test('the settings line names the engine just chosen at once, and the one auto picks once the machine is known', async () => {
  expect(engineShownOf(settingsWith('system'), null)).toBe('system')
  expect(engineShownOf(settingsWith('piper'), machineWithPiper)).toBe('piper')
  expect(engineShownOf(settingsWith('auto'), machineWithPiper)).toBe('piper')
  expect(engineShownOf(settingsWith('auto'), null)).toBe(null)
})
