import { expect, test } from 'claude-code/testing'

import { elevenLabs } from './elevenlabs'
import type { Machine } from './synthesis'
import type { VoiceToolkit } from './toolkit'

const machine: Machine<null> = { platform: 'Linux', wavPlayer: ['pw-play'], found: null }

const options = { apiKey: 'secret-key', model: 'eleven_multilingual_v2', voiceId: 'EXAVITQu4vr4xnSDxMaL', pronunciationDictionaries: [] }

// A second of sound at 1000 bytes a second, as ElevenLabs sends it.
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

// A machine where curl answers ElevenLabs' JSON and the decoded audio lands as a file.
const toolkitAnswering = (answer: object, calls: Call[], written: Map<string, string>): VoiceToolkit => ({
  fetch: (async () => ({ ok: false, status: 500, text: '' })) as unknown as VoiceToolkit['fetch'],
  run: (async (argv: readonly string[], init?: { stdin?: string }) => {
    calls.push({ argv, stdin: init?.stdin })
    return { exitCode: 0, stdout: argv[0] === 'curl' ? JSON.stringify(answer) : '', stderr: '' }
  }) as unknown as VoiceToolkit['run'],
  readText: async path => written.get(path) ?? '',
  readBase64: async () => oneSecondWavBase64(),
  write: async (path, text) => {
    written.set(path, text)
  },
  exists: async () => true,
  fileNamesOf: async () => [],
  environmentVariable: async () => undefined,
})

test('ElevenLabs reads the words with the key on curl\'s standard input, each word timed by the characters it answers', async () => {
  const calls: Call[] = []
  const written = new Map<string, string>()
  const toolkit = toolkitAnswering({ audio_base64: 'UklGRg==', alignment: { character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6] } }, calls, written)

  const synthesis = await elevenLabs.synthesize(toolkit, {
    speakableWords: ['On', 'teste.'],
    options,
    language: 'fr',
    speed: 1.1,
    machine,
    outputPathWithoutExtension: '/tmp/answer-1-0',
    previousText: null,
    nextText: null,
  })

  const curl = calls.find(call => call.argv[0] === 'curl')
  expect(curl?.argv.join(' ')).not.toContain('secret-key')
  expect(curl?.stdin).toBe('xi-api-key: secret-key\n')
  expect(JSON.parse(written.get('/tmp/answer-1-0.request.json') ?? '{}')).toEqual({
    text: 'On teste.',
    model_id: 'eleven_multilingual_v2',
    language_code: 'fr',
    voice_settings: { speed: 1.1 },
  })
  expect(synthesis).toEqual({ playback: ['pw-play', '/tmp/answer-1-0.wav'], durationMs: 1000, wordStartsMs: [0, 300] })
})

test('ElevenLabs needs its key, and tells the session\'s cost in credits once the account told them', async () => {
  expect(elevenLabs.unavailabilityOf({ ...options, apiKey: '' }, machine)).toBe('no ElevenLabs API key: set it in /config or as ELEVENLABS_API_KEY')
  expect(elevenLabs.unavailabilityOf(options, machine)).toBe(null)
  expect(elevenLabs.costLabelOf({ characters: 640, audioSeconds: 40 }, { used: 1_640, limit: 10_000, usedAtStart: 1_000 })).toBe('640 credits · 8,360 left')
  expect(elevenLabs.costLabelOf({ characters: 640, audioSeconds: 40 }, null)).toBe('640 characters')
  expect(elevenLabs.costLabelOf({ characters: 0, audioSeconds: 0 }, null)).toBe(null)
})

test('the pronunciation dictionaries of the options go with every request, three at most, in their latest version', async () => {
  const toolkit = toolkitAnswering({ audio_base64: 'UklGRg==' }, [], new Map())
  const read = await elevenLabs.optionsOf(toolkit, { elevenlabsPronunciationDictionaries: 'dict-a, dict-b dict-c,dict-d' })
  expect(read.pronunciationDictionaries).toEqual(['dict-a', 'dict-b', 'dict-c'])

  const written = new Map<string, string>()
  await elevenLabs.synthesize(toolkitAnswering({ audio_base64: 'UklGRg==' }, [], written), {
    speakableWords: ['La', 'CI.'],
    options: { ...options, pronunciationDictionaries: ['dict-a'] },
    language: 'fr',
    speed: 1,
    machine,
    outputPathWithoutExtension: '/tmp/answer-2-0',
    previousText: null,
    nextText: null,
  })
  expect(JSON.parse(written.get('/tmp/answer-2-0.request.json') ?? '{}').pronunciation_dictionary_locators).toEqual([{ pronunciation_dictionary_id: 'dict-a' }])
})

test('a piece goes to ElevenLabs with the words of the pieces around it, which keep its tone and are not charged', async () => {
  const written = new Map<string, string>()
  await elevenLabs.synthesize(toolkitAnswering({ audio_base64: 'UklGRg==' }, [], written), {
    speakableWords: ['Ensuite,', 'on', 'fusionne.'],
    options,
    language: 'fr',
    speed: 1,
    machine,
    outputPathWithoutExtension: '/tmp/answer-3-1',
    previousText: 'La CI est verte.',
    nextText: 'Puis on publie.',
  })
  const body = JSON.parse(written.get('/tmp/answer-3-1.request.json') ?? '{}')
  expect([body.text, body.previous_text, body.next_text]).toEqual(['Ensuite, on fusionne.', 'La CI est verte.', 'Puis on publie.'])
})
