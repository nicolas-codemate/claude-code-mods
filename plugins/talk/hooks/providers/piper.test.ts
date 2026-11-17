import { expect, test } from 'claude-code/testing'

import type { PiperFound } from './piper'
import { piper, piperChoicesOf, piperSpeakerOf, piperVoiceKeyOf } from './piper'
import type { Machine } from './synthesis'
import type { VoiceToolkit } from './toolkit'

const entry = (code: string, name: string, quality: string, speakers: Record<string, number> = {}) => ({
  files: { [`${code.split('_')[0]}/${code}/${name}/${quality}/${code}-${name}-${quality}.onnx`]: { size_bytes: 63_000_000 } },
  name,
  quality,
  num_speakers: Math.max(1, Object.keys(speakers).length),
  language: { code, family: code.split('_')[0] ?? '' },
  speaker_id_map: speakers,
})

test('the Piper voices of the language are listed, one per speaker with its gender, medium quality alone, crowds left out', async () => {
  const catalog = {
    'fr_FR-gilles-low': entry('fr_FR', 'gilles', 'low'),
    'fr_FR-tom-high': entry('fr_FR', 'tom', 'high'),
    'fr_FR-siwis-medium': entry('fr_FR', 'siwis', 'medium'),
    'fr_FR-upmc-medium': entry('fr_FR', 'upmc', 'medium', { jessica: 0, pierre: 1 }),
    'fr_FR-mls-medium': entry('fr_FR', 'mls', 'medium', Object.fromEntries(Array.from({ length: 125 }, (_, index) => [`${index}`, index]))),
    'en_US-lessac-medium': entry('en_US', 'lessac', 'medium'),
  }

  expect(piperChoicesOf(catalog, 'fr')).toEqual([
    { value: 'fr_FR-siwis-medium', label: 'Siwis', download: 'fr/fr_FR/siwis/medium/fr_FR-siwis-medium', sizeBytes: 63_000_000, gender: 'female' },
    { value: 'fr_FR-upmc-medium#jessica', label: 'Upmc Jessica', download: 'fr/fr_FR/upmc/medium/fr_FR-upmc-medium', sizeBytes: 63_000_000, gender: 'female' },
    { value: 'fr_FR-upmc-medium#pierre', label: 'Upmc Pierre', download: 'fr/fr_FR/upmc/medium/fr_FR-upmc-medium', sizeBytes: 63_000_000, gender: 'male' },
  ])
  expect(piperChoicesOf(catalog, 'en')).toEqual([{ value: 'en_US-lessac-medium', label: 'Lessac US', download: 'en/en_US/lessac/medium/en_US-lessac-medium', sizeBytes: 63_000_000, gender: 'female' }])
})

test('a voice of several speakers names the speaker after its key', async () => {
  expect(piperVoiceKeyOf('fr_FR-upmc-medium#pierre')).toBe('fr_FR-upmc-medium')
  expect(piperSpeakerOf('fr_FR-upmc-medium#pierre')).toBe('pierre')
  expect(piperSpeakerOf('fr_FR-siwis-medium')).toBe(null)
})

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

const PIPER_HOME = '/home/ada/.local/share/piper'

// A machine holding the files given, with their text, where each command prints what stdoutOf says.
const toolkitWith = (files: Record<string, string>, calls: Call[] = [], stdoutOf: (argv: readonly string[]) => string = () => ''): VoiceToolkit => ({
  fetch: (async () => ({ ok: false, status: 500, text: '' })) as unknown as VoiceToolkit['fetch'],
  run: (async (argv: readonly string[], init?: { stdin?: string }) => {
    calls.push({ argv, stdin: init?.stdin })
    return { exitCode: 0, stdout: stdoutOf(argv), stderr: '' }
  }) as unknown as VoiceToolkit['run'],
  readText: async path => files[path] ?? '',
  readBase64: async () => oneSecondWavBase64(),
  write: async () => {},
  exists: async path => Object.keys(files).some(file => file === path || file.startsWith(`${path}/`)),
  fileNamesOf: async directory => Object.keys(files).filter(file => file.startsWith(`${directory}/`)).map(file => file.slice(directory.length + 1)).filter(name => !name.includes('/')),
  environmentVariable: async name => (name === 'HOME' ? '/home/ada' : undefined),
})

const noOptions = { command: '', voice: '', voiceName: '' }

test('Piper is found by the command of the options, else on the PATH, else in its own environment', async () => {
  const voices = { [`${PIPER_HOME}/voices/fr_FR-siwis-medium.onnx`]: '' }

  expect(await piper.findOnMachine(toolkitWith(voices), { ...noOptions, command: '/opt/piper/piper' }, 'fr', new Set(['piper']))).toEqual({
    command: '/opt/piper/piper',
    voice: `${PIPER_HOME}/voices/fr_FR-siwis-medium.onnx`,
    speakerId: null,
    python: null,
  })
  expect((await piper.findOnMachine(toolkitWith(voices), noOptions, 'fr', new Set(['piper'])))?.command).toBe('piper')
  expect((await piper.findOnMachine(toolkitWith({ ...voices, [`${PIPER_HOME}/venv/bin/piper`]: '' }), noOptions, 'fr', new Set()))?.command).toBe(`${PIPER_HOME}/venv/bin/piper`)
  expect(await piper.findOnMachine(toolkitWith(voices), noOptions, 'fr', new Set())).toBe(null)
})

test('Piper speaks with the catalog voice chosen, its speaker numbered as the voice\'s description says', async () => {
  const toolkit = toolkitWith({
    [`${PIPER_HOME}/voices/fr_FR-siwis-medium.onnx`]: '',
    [`${PIPER_HOME}/voices/fr_FR-upmc-medium.onnx`]: '',
    [`${PIPER_HOME}/voices/fr_FR-upmc-medium.onnx.json`]: JSON.stringify({ speaker_id_map: { jessica: 0, pierre: 1 } }),
  })

  expect(await piper.findOnMachine(toolkit, { ...noOptions, voiceName: 'fr_FR-upmc-medium#pierre' }, 'fr', new Set(['piper']))).toEqual({
    command: 'piper',
    voice: `${PIPER_HOME}/voices/fr_FR-upmc-medium.onnx`,
    speakerId: 1,
    python: null,
  })
})

test('without a voice chosen of the language, Piper takes the first voice of the language, and is not found without one', async () => {
  const toolkit = toolkitWith({
    [`${PIPER_HOME}/voices/en_US-lessac-medium.onnx`]: '',
    [`${PIPER_HOME}/voices/fr_FR-upmc-medium.onnx`]: '',
    [`${PIPER_HOME}/voices/fr_FR-siwis-medium.onnx`]: '',
    [`${PIPER_HOME}/voices/fr_FR-siwis-medium.onnx.json`]: '{}',
  })

  expect((await piper.findOnMachine(toolkit, { ...noOptions, voiceName: 'en_US-lessac-medium' }, 'fr', new Set(['piper'])))?.voice).toBe(`${PIPER_HOME}/voices/fr_FR-siwis-medium.onnx`)
  expect(await piper.findOnMachine(toolkit, noOptions, 'de', new Set(['piper']))).toBe(null)
  expect(await piper.findOnMachine(toolkitWith({}), noOptions, 'fr', new Set(['piper']))).toBe(null)
})

test('Piper\'s own Python is used when it can load Piper', async () => {
  const command = `${PIPER_HOME}/venv/bin/piper`
  const calls: Call[] = []
  const toolkit = toolkitWith({ [command]: '', [`${PIPER_HOME}/venv/bin/python`]: '', [`${PIPER_HOME}/voices/fr_FR-siwis-medium.onnx`]: '' }, calls)

  expect((await piper.findOnMachine(toolkit, noOptions, 'fr', new Set()))?.python).toBe(`${PIPER_HOME}/venv/bin/python`)
  expect(calls).toEqual([{ argv: [`${PIPER_HOME}/venv/bin/python`, '-c', 'import piper, onnx'], stdin: undefined }])
})

const machineWith = (found: PiperFound): Machine<PiperFound> => ({ platform: 'Linux', wavPlayer: ['pw-play'], found })

test('with its Python, Piper times each word as the script\'s last line of output says', async () => {
  const calls: Call[] = []
  const toolkit = toolkitWith({}, calls, () => 'loading the voice\n[120, 640]\n')

  const synthesis = await piper.synthesize(toolkit, {
    speakableWords: ['On', 'teste.'],
    options: noOptions,
    language: 'fr',
    speed: 2,
    machine: machineWith({ command: '/venv/bin/piper', voice: '/voices/fr_FR-upmc-medium.onnx', speakerId: 1, python: '/venv/bin/python' }),
    outputPathWithoutExtension: '/tmp/answer-1-0',
  })

  expect(calls.length).toBe(1)
  expect(calls[0]?.argv[0]).toBe('/venv/bin/python')
  expect(calls[0]?.argv.slice(3)).toEqual(['/voices/fr_FR-upmc-medium.onnx', '/tmp/answer-1-0.wav', '0.5', '1'])
  expect(calls[0]?.stdin).toBe('On teste.')
  expect(synthesis).toEqual({ playback: ['pw-play', '/tmp/answer-1-0.wav'], durationMs: 1000, wordStartsMs: [120, 640] })
})

test('without its Python, the piper command writes the WAV at a length scale of one over the speed, for the speaker found', async () => {
  const calls: Call[] = []

  const synthesis = await piper.synthesize(toolkitWith({}, calls), {
    speakableWords: ['On', 'teste.'],
    options: noOptions,
    language: 'fr',
    speed: 0.5,
    machine: machineWith({ command: 'piper', voice: '/voices/fr_FR-upmc-medium.onnx', speakerId: 1, python: null }),
    outputPathWithoutExtension: '/tmp/answer-2-0',
  })

  expect(calls).toEqual([{ argv: ['piper', '-m', '/voices/fr_FR-upmc-medium.onnx', '-f', '/tmp/answer-2-0.wav', '--length-scale', '2', '-s', '1'], stdin: 'On teste.' }])
  expect(synthesis).toEqual({ playback: ['pw-play', '/tmp/answer-2-0.wav'], durationMs: 1000, wordStartsMs: [0, 187.5] })
})

test('the Piper voice in force is the one chosen in the band when found, else the voice file\'s name', async () => {
  const found = { command: 'piper', voice: '/voices/fr_FR-upmc-medium.onnx', speakerId: 1, python: null }

  expect(piper.voiceOf({ ...noOptions, voiceName: 'fr_FR-upmc-medium#pierre' }, machineWith(found))).toBe('fr_FR-upmc-medium#pierre')
  expect(piper.voiceOf({ ...noOptions, voiceName: 'fr_FR-siwis-medium' }, machineWith(found))).toBe('fr_FR-upmc-medium')
  expect(piper.voiceOf(noOptions, machineWith(null))).toBe(null)
  expect(piper.voiceOf(noOptions, null)).toBe(null)
  expect(piper.withVoice({ command: 'piper', voice: '/voices/mine.onnx', voiceName: '' }, 'fr_FR-siwis-medium')).toEqual({ command: 'piper', voice: '', voiceName: 'fr_FR-siwis-medium' })
})

test('a Piper voice is named after its key while its list is not read, a speaker after the voice', async () => {
  expect(piper.voiceLabelOf('fr_FR-siwis-medium')).toBe('Siwis')
  expect(piper.voiceLabelOf('fr_FR-upmc-medium#pierre')).toBe('Upmc Pierre')
  expect(piper.voiceLabelOf('en_US-hfc_female-medium')).toBe('Hfc female')
})
