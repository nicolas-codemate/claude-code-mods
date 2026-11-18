import { expect, test } from 'claude-code/testing'

import { openAi } from './openai'
import type { Machine } from './synthesis'
import { SynthesisError } from './synthesis'
import type { VoiceToolkit } from './toolkit'

const machine: Machine<null> = { platform: 'Linux', wavPlayer: ['pw-play'], found: null }

const options = { apiKey: 'secret-key', model: 'gpt-4o-mini-tts', voice: 'coral' }

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

// A machine where curl ends with the exit code given, and the files written hold what the map holds.
const toolkitAnswering = (curlExitCode: number, calls: Call[], written: Map<string, string>, environment: Record<string, string> = {}): VoiceToolkit => ({
  fetch: (async () => ({ ok: false, status: 500, text: '' })) as unknown as VoiceToolkit['fetch'],
  run: (async (argv: readonly string[], init?: { stdin?: string }) => {
    calls.push({ argv, stdin: init?.stdin })
    return { exitCode: argv[0] === 'curl' ? curlExitCode : 0, stdout: '', stderr: curlExitCode === 0 ? '' : 'curl: (22) The requested URL returned error: 401' }
  }) as unknown as VoiceToolkit['run'],
  readText: async path => written.get(path) ?? '',
  readBase64: async () => oneSecondWavBase64(),
  write: async (path, text) => {
    written.set(path, text)
  },
  exists: async path => written.has(path),
  fileNamesOf: async () => [],
  environmentVariable: async name => environment[name],
})

test('OpenAI is asked for a WAV of the words in the voice, language and speed chosen, the key on curl\'s standard input', async () => {
  const calls: Call[] = []
  const written = new Map<string, string>()

  const synthesis = await openAi.synthesize(toolkitAnswering(0, calls, written), {
    speakableWords: ['On', 'teste.'],
    options,
    language: 'fr',
    speed: 1.25,
    machine,
    outputPathWithoutExtension: '/tmp/answer-1-0',
    previousText: null,
    nextText: null,
  })

  const curl = calls.find(call => call.argv[0] === 'curl')
  expect(curl?.argv.join(' ')).not.toContain('secret-key')
  expect(curl?.argv).toContain('https://api.openai.com/v1/audio/speech')
  expect(curl?.stdin).toBe('Authorization: Bearer secret-key\n')
  const body = JSON.parse(written.get('/tmp/answer-1-0.request.json') ?? '{}')
  expect(body).toEqual({
    model: 'gpt-4o-mini-tts',
    voice: 'coral',
    input: 'On teste.',
    instructions: body.instructions,
    response_format: 'wav',
    speed: 1.25,
  })
  expect(body.instructions).toContain('Speak French')
  expect(synthesis).toEqual({ playback: ['pw-play', '/tmp/answer-1-0.wav'], durationMs: 1000, wordStartsMs: [0, 187.5] })
})

test('when curl fails, the error is the message OpenAI wrote in place of the audio', async () => {
  const written = new Map([['/tmp/answer-2-0.wav', JSON.stringify({ error: { message: 'Incorrect API key provided' } })]])

  const failure = await openAi
    .synthesize(toolkitAnswering(22, [], written), {
      speakableWords: ['Bonjour.'],
      options,
      language: 'fr',
      speed: 1,
      machine,
      outputPathWithoutExtension: '/tmp/answer-2-0',
      previousText: null,
      nextText: null,
    })
    .then(() => null, (error: unknown) => error)

  expect(failure instanceof SynthesisError).toBe(true)
  expect((failure as Error).message).toBe('OpenAI failed: Incorrect API key provided')
})

test('OpenAI needs its key and an audio player', async () => {
  expect(openAi.unavailabilityOf({ ...options, apiKey: '' }, machine)).toBe('no OpenAI API key: set it in /config or as OPENAI_API_KEY')
  expect(openAi.unavailabilityOf(options, { ...machine, wavPlayer: null })).toBe('no audio player found (pw-play, paplay, aplay, afplay or ffplay)')
  expect(openAi.unavailabilityOf(options, machine)).toBe(null)
})

test('the session\'s cost with OpenAI is told in dollars from the seconds of audio made', async () => {
  expect(openAi.costLabelOf({ characters: 3_000, audioSeconds: 120 }, null)).toBe('≈ $0.03')
  expect(openAi.costLabelOf({ characters: 0, audioSeconds: 0 }, null)).toBe('≈ $0.00')
})

test('the OpenAI key is read from the options, else from the OPENAI_API_KEY environment variable', async () => {
  const toolkit = toolkitAnswering(0, [], new Map(), { OPENAI_API_KEY: 'key-from-environment' })

  expect(await openAi.optionsOf(toolkit, { openaiApiKey: 'key-from-config', openaiModel: 'gpt-4o-mini-tts', openaiVoice: 'onyx' })).toEqual({
    apiKey: 'key-from-config',
    model: 'gpt-4o-mini-tts',
    voice: 'onyx',
  })
  expect((await openAi.optionsOf(toolkit, {})).apiKey).toBe('key-from-environment')
  expect((await openAi.optionsOf(toolkitAnswering(0, [], new Map()), {})).apiKey).toBe('')
})
