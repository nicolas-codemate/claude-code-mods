import { expect, test } from 'claude-code/testing'

import type { Machine } from './synthesis'
import { systemVoice } from './system-voice'
import type { SystemVoiceCommand } from './system-voice'
import type { VoiceToolkit } from './toolkit'

const machineWith = (found: SystemVoiceCommand | null, wavPlayer: readonly string[] | null = ['pw-play']): Machine<SystemVoiceCommand | null> => ({ platform: 'Linux', wavPlayer, found })

// A second of sound at 1000 bytes a second.
const oneSecondWavBase64 = (): string => {
  const bytes = new Uint8Array(44 + 1000)
  const view = new DataView(bytes.buffer)
  const writeAscii = (offset: number, text: string) => [...text].forEach((character, index) => (bytes[offset + index] = character.charCodeAt(0)))
  writeAscii(0, 'RIFF')
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint32(28, 1000, true)
  writeAscii(36, 'data')
  view.setUint32(40, 1000, true)
  return btoa(String.fromCharCode(...bytes))
}

type Call = { argv: readonly string[]; stdin: string | undefined }

const toolkitRecording = (calls: Call[]): VoiceToolkit => ({
  fetch: (async () => ({ ok: false, status: 500, text: '' })) as unknown as VoiceToolkit['fetch'],
  run: (async (argv: readonly string[], init?: { stdin?: string }) => {
    calls.push({ argv, stdin: init?.stdin })
    return { exitCode: 0, stdout: '', stderr: '' }
  }) as unknown as VoiceToolkit['run'],
  readText: async () => '',
  readBase64: async () => oneSecondWavBase64(),
  write: async () => {},
  exists: async () => true,
  fileNamesOf: async () => [],
  environmentVariable: async () => undefined,
})

test('spd-say plays the words itself, writing no file, its length estimated from the text and the speed', async () => {
  const calls: Call[] = []

  const synthesis = await systemVoice.synthesize(toolkitRecording(calls), {
    speakableWords: ['On', 'teste.'],
    options: {},
    language: 'fr',
    speed: 1.5,
    machine: machineWith('spd-say', null),
    outputPathWithoutExtension: '/tmp/answer-1-0',
    previousText: null,
    nextText: null,
  })

  expect(calls).toEqual([])
  expect(synthesis).toEqual({ playback: ['spd-say', '-w', '-l', 'fr', '-r', '50', 'On teste.'], durationMs: 390, wordStartsMs: [0, 73.125] })
})

test('espeak-ng writes a WAV of the words in the language, at a rate scaled by the speed', async () => {
  const calls: Call[] = []

  const synthesis = await systemVoice.synthesize(toolkitRecording(calls), {
    speakableWords: ['On', 'teste.'],
    options: {},
    language: 'fr',
    speed: 1.5,
    machine: machineWith('espeak-ng'),
    outputPathWithoutExtension: '/tmp/answer-2-0',
    previousText: null,
    nextText: null,
  })

  expect(calls).toEqual([{ argv: ['espeak-ng', '-v', 'fr', '-s', '240', '-w', '/tmp/answer-2-0.wav', '--stdin'], stdin: 'On teste.' }])
  expect(synthesis).toEqual({ playback: ['pw-play', '/tmp/answer-2-0.wav'], durationMs: 1000, wordStartsMs: [0, 187.5] })
})

test('the system voice needs an audio player unless spd-say plays it, and a system voice installed', async () => {
  expect(systemVoice.unavailabilityOf({}, machineWith('espeak-ng', null))).toBe('no audio player found (pw-play, paplay, aplay, afplay or ffplay)')
  expect(systemVoice.unavailabilityOf({}, machineWith('spd-say', null))).toBe(null)
  expect(systemVoice.unavailabilityOf({}, machineWith(null))).toBe('no system voice found (say, espeak-ng or spd-say)')
  expect(systemVoice.unavailabilityOf({}, machineWith('say'))).toBe(null)
})

test('the system voice found is the first installed of say, espeak-ng and spd-say', async () => {
  const toolkit = toolkitRecording([])

  expect(await systemVoice.findOnMachine(toolkit, {}, 'fr', new Set(['spd-say', 'espeak-ng', 'say']))).toBe('say')
  expect(await systemVoice.findOnMachine(toolkit, {}, 'fr', new Set(['spd-say', 'espeak-ng']))).toBe('espeak-ng')
  expect(await systemVoice.findOnMachine(toolkit, {}, 'fr', new Set(['spd-say']))).toBe('spd-say')
  expect(await systemVoice.findOnMachine(toolkit, {}, 'fr', new Set(['piper']))).toBe(null)
})
