import type { EngineInterface } from 'claude-code'

import type { TalkEngineName, TalkLanguage } from '../types'
import { alignedWordStartsMs, estimatedWordStartsMs, speakableTextOf, wordStartsFromVoiceWords } from './timing'
import { piperSpeakerOf, piperVoiceKeyOf } from './voices'
import { wavDurationMs } from './wav'

export type TalkSettings = {
  engine: TalkEngineName | 'auto'
  language: TalkLanguage
  speed: number
  openai: { apiKey: string; model: string; voice: string }
  elevenlabs: { apiKey: string; model: string; voiceId: string }
  // voice: the path of a voice file, which wins; voiceName: a voice of the Piper catalog, chosen in the band.
  piper: { command: string; voice: string; voiceName: string }
}

export type SystemVoice = 'say' | 'espeak-ng' | 'spd-say'

export type Capabilities = {
  platform: string
  wavPlayer: readonly string[] | null
  // python: the interpreter of Piper's own environment, when it can tell when each word is spoken.
  piper: { command: string; voice: string; speakerId: number | null; python: string | null } | null
  systemVoice: SystemVoice | null
  hasOpenAiKey: boolean
  hasElevenLabsKey: boolean
}

// One piece of speech ready to play: the command whose run is the sound, how long it lasts and where each word starts.
export type Synthesis = { playback: readonly string[]; durationMs: number; wordStartsMs: number[] }

export class SynthesisError extends Error {}

const CURL_TIMEOUT_SECONDS = 60
const SYNTHESIS_TIMEOUT_MS = 90_000
// How long a system voice that writes no file takes per character at normal speed, to pace the words on screen.
const SYSTEM_VOICE_MS_PER_CHARACTER = 65

const LANGUAGE_NAMES: Readonly<Record<TalkLanguage, string>> = {
  fr: 'French',
  en: 'English',
  es: 'Spanish',
  de: 'German',
  it: 'Italian',
}

export const languageNameOf = (language: TalkLanguage): string => LANGUAGE_NAMES[language]

const WAV_PLAYERS: readonly (readonly string[])[] = [
  ['afplay'],
  ['pw-play'],
  ['paplay'],
  ['aplay', '-q'],
  ['ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet'],
]

const SYSTEM_VOICES: readonly SystemVoice[] = ['say', 'espeak-ng', 'spd-say']

async function installedCommandsOf($: EngineInterface, commands: readonly string[]): Promise<Set<string>> {
  const { stdout } = await $.process.run(['sh', '-c', 'for c in "$@"; do command -v "$c" >/dev/null 2>&1 && echo "$c"; done', 'sh', ...commands])
  return new Set(stdout.split('\n').filter(line => line !== ''))
}

async function firstPiperVoiceOf($: EngineInterface, directory: string, language: TalkLanguage): Promise<string | null> {
  if (!(await $.fs.exists(directory))) return null
  const voices = (await $.fs.list(directory))
    .filter(entry => entry.kind === 'file' && entry.name.endsWith('.onnx') && entry.name.startsWith(`${language}_`))
    .map(entry => entry.name)
    .sort()
  return voices[0] === undefined ? null : `${directory}/${voices[0]}`
}

async function piperOf($: EngineInterface, settings: TalkSettings, installed: Set<string>): Promise<Capabilities['piper']> {
  const home = (await $.env.get('HOME')) ?? ''
  const piperHome = `${home}/.local/share/piper`
  let command = settings.piper.command
  if (command === '' && installed.has('piper')) command = 'piper'
  if (command === '' && (await $.fs.exists(`${piperHome}/venv/bin/piper`))) command = `${piperHome}/venv/bin/piper`
  if (command === '') return null
  const chosen = settings.piper.voice === '' ? await chosenPiperVoiceOf($, `${piperHome}/voices`, settings) : null
  const voice = settings.piper.voice !== '' ? settings.piper.voice : (chosen?.voice ?? (await firstPiperVoiceOf($, `${piperHome}/voices`, settings.language)))
  if (voice === null) return null
  return { command, voice, speakerId: chosen?.speakerId ?? null, python: await piperPythonOf($, command) }
}

// The catalog voice chosen in the band, when it is of the language and on the machine.
async function chosenPiperVoiceOf($: EngineInterface, directory: string, settings: TalkSettings): Promise<{ voice: string; speakerId: number | null } | null> {
  const key = piperVoiceKeyOf(settings.piper.voiceName)
  if (key === '' || !key.startsWith(`${settings.language}_`)) return null
  const voice = `${directory}/${key}.onnx`
  if (!(await $.fs.exists(voice))) return null
  const speaker = piperSpeakerOf(settings.piper.voiceName)
  if (speaker === null) return { voice, speakerId: null }
  const description = JSON.parse(await $.fs.read(`${voice}.json`)) as { speaker_id_map?: Record<string, number> }
  return { voice, speakerId: description.speaker_id_map?.[speaker] ?? null }
}

// The timing of each phoneme comes from Piper's Python library, which needs the onnx package beside it.
async function piperPythonOf($: EngineInterface, command: string): Promise<string | null> {
  if (!command.includes('/')) return null
  const python = `${command.slice(0, command.lastIndexOf('/'))}/python`
  if (!(await $.fs.exists(python))) return null
  const { exitCode } = await $.process.run([python, '-c', 'import piper, onnx'])
  return exitCode === 0 ? python : null
}

export async function probeCapabilities($: EngineInterface, settings: TalkSettings): Promise<Capabilities> {
  const { stdout: platform } = await $.process.run(['uname', '-s'])
  const installed = await installedCommandsOf($, [...WAV_PLAYERS.map(player => player[0] ?? ''), ...SYSTEM_VOICES, 'piper'])
  return {
    platform: platform.trim(),
    wavPlayer: WAV_PLAYERS.find(player => installed.has(player[0] ?? '')) ?? null,
    piper: await piperOf($, settings, installed),
    systemVoice: SYSTEM_VOICES.find(voice => installed.has(voice)) ?? null,
    hasOpenAiKey: settings.openai.apiKey !== '',
    hasElevenLabsKey: settings.elevenlabs.apiKey !== '',
  }
}

const isEngineAvailable = (engine: TalkEngineName, capabilities: Capabilities): boolean => {
  switch (engine) {
    case 'elevenlabs':
      return capabilities.hasElevenLabsKey && capabilities.wavPlayer !== null
    case 'openai':
      return capabilities.hasOpenAiKey && capabilities.wavPlayer !== null
    case 'piper':
      return capabilities.piper !== null && capabilities.wavPlayer !== null
    case 'system':
      return capabilities.systemVoice !== null && (capabilities.systemVoice === 'spd-say' || capabilities.wavPlayer !== null)
  }
}

export const AUTO_ENGINE_ORDER: readonly TalkEngineName[] = ['elevenlabs', 'openai', 'piper', 'system']

export const engineOf = (settings: TalkSettings, capabilities: Capabilities): TalkEngineName | null => {
  if (settings.engine !== 'auto') return isEngineAvailable(settings.engine, capabilities) ? settings.engine : null
  return AUTO_ENGINE_ORDER.find(engine => isEngineAvailable(engine, capabilities)) ?? null
}

// The engine the settings line names: the one chosen, at once, or the one auto picks once the machine is probed. Not
// the engine of the last answer read, which an engine just chosen has not read anything with yet.
export const engineShownOf = (settings: TalkSettings, found: Capabilities | null): TalkEngineName | null =>
  settings.engine !== 'auto' ? settings.engine : found === null ? null : engineOf(settings, found)

export const whyUnavailable = (engine: TalkEngineName, capabilities: Capabilities): string => {
  if (capabilities.wavPlayer === null && !(engine === 'system' && capabilities.systemVoice === 'spd-say'))
    return 'no audio player found (pw-play, paplay, aplay, afplay or ffplay)'
  switch (engine) {
    case 'elevenlabs':
      return 'no ElevenLabs API key: set it in /config or as ELEVENLABS_API_KEY'
    case 'openai':
      return 'no OpenAI API key: set it in /config or as OPENAI_API_KEY'
    case 'piper':
      return 'Piper or a Piper voice of the language was not found (see the README to install it)'
    case 'system':
      return 'no system voice found (say, espeak-ng or spd-say)'
  }
}

const bytesOfBase64 = (base64: string): Uint8Array => (Uint8Array as unknown as { fromBase64: (text: string) => Uint8Array }).fromBase64(base64)

async function wavDurationOfFile($: EngineInterface, path: string): Promise<number> {
  const { base64 } = await $.fs.read(path, { as: 'bytes' })
  const durationMs = wavDurationMs(bytesOfBase64(base64))
  if (durationMs === null) throw new SynthesisError(`the voice wrote no readable WAV file (${path})`)
  return durationMs
}

// What a failed command says: the message of the JSON error a service answered with (curl keeps it on standard output),
// else its own words.
export const failureMessageOf = (stdout: string, stderr: string): string => {
  try {
    const answer = JSON.parse(stdout) as { detail?: { message?: string } | string; error?: { message?: string } }
    const message = typeof answer.detail === 'string' ? answer.detail : (answer.detail?.message ?? answer.error?.message)
    if (message !== undefined) return message
  } catch {
    // Not a JSON answer: the command's own output says what went wrong.
  }
  return (stdout.trim() || stderr.trim()).slice(0, 300)
}

async function runOrFail($: EngineInterface, argv: readonly string[], stdin: string | undefined, what: string): Promise<string> {
  const { exitCode, stdout, stderr } = await $.process.run(argv, { stdin, timeoutMs: SYNTHESIS_TIMEOUT_MS })
  if (exitCode !== 0) throw new SynthesisError(`${what} failed: ${failureMessageOf(stdout, stderr)}`)
  return stdout
}

// The API keys go to curl on its standard input, never in its arguments, which any process of the machine can list.
const curlPost = (url: string, bodyPath: string, outputPath: string | null): string[] => [
  'curl', '-sS', '--fail-with-body', '--max-time', String(CURL_TIMEOUT_SECONDS), '-X', 'POST', url,
  '-H', 'Content-Type: application/json', '-H', '@-', '--data-binary', `@${bodyPath}`,
  ...(outputPath === null ? [] : ['-o', outputPath]),
]

type SynthesisRequest = { speakableWords: readonly string[]; settings: TalkSettings; capabilities: Capabilities; outputPathWithoutExtension: string }

const wavPlaybackOf = (capabilities: Capabilities, path: string): string[] => [...(capabilities.wavPlayer ?? []), path]

async function synthesizeWithElevenLabs($: EngineInterface, request: SynthesisRequest): Promise<Synthesis> {
  const { settings, outputPathWithoutExtension } = request
  const { text, wordStartOffsets } = speakableTextOf(request.speakableWords)
  const bodyPath = `${outputPathWithoutExtension}.request.json`
  const audioPath = `${outputPathWithoutExtension}.wav`
  await $.fs.write(bodyPath, JSON.stringify({
    text,
    model_id: settings.elevenlabs.model,
    language_code: settings.language,
    voice_settings: { speed: settings.speed },
  }))
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(settings.elevenlabs.voiceId)}/with-timestamps?output_format=wav_24000`
  const stdout = await runOrFail($, curlPost(url, bodyPath, null), `xi-api-key: ${settings.elevenlabs.apiKey}\n`, 'ElevenLabs')
  const response = JSON.parse(stdout) as { audio_base64?: string; alignment?: { character_start_times_seconds?: number[]; character_end_times_seconds?: number[] } }
  if (response.audio_base64 === undefined) throw new SynthesisError('ElevenLabs answered no audio')
  await runOrFail($, ['sh', '-c', 'base64 -d > "$1"', 'sh', audioPath], response.audio_base64, 'Decoding the ElevenLabs audio')
  const starts = response.alignment?.character_start_times_seconds ?? []
  const durationMs = await wavDurationOfFile($, audioPath)
  return {
    playback: wavPlaybackOf(request.capabilities, audioPath),
    durationMs,
    wordStartsMs: starts.length > 0 ? alignedWordStartsMs(wordStartOffsets, starts) : estimatedWordStartsMs(request.speakableWords, durationMs),
  }
}

async function synthesizeWithOpenAi($: EngineInterface, request: SynthesisRequest): Promise<Synthesis> {
  const { settings, outputPathWithoutExtension } = request
  const { text } = speakableTextOf(request.speakableWords)
  const bodyPath = `${outputPathWithoutExtension}.request.json`
  const audioPath = `${outputPathWithoutExtension}.wav`
  await $.fs.write(bodyPath, JSON.stringify({
    model: settings.openai.model,
    voice: settings.openai.voice,
    input: text,
    // The voice follows these words for its tone and its pace: a relaxed tone made it leave long silences between words.
    instructions: `Speak ${languageNameOf(settings.language)} as a colleague in a lively conversation: warm and natural, at a brisk, steady pace, the words flowing on without pauses between them; pause briefly at the end of a sentence only. Pronounce English technical words as a developer would.`,
    response_format: 'wav',
    speed: settings.speed,
  }))
  const { exitCode, stderr } = await $.process.run(curlPost('https://api.openai.com/v1/audio/speech', bodyPath, audioPath), {
    stdin: `Authorization: Bearer ${settings.openai.apiKey}\n`,
    timeoutMs: SYNTHESIS_TIMEOUT_MS,
  })
  if (exitCode !== 0) {
    const errorBody = (await $.fs.exists(audioPath)) ? await $.fs.read(audioPath) : ''
    throw new SynthesisError(`OpenAI failed: ${failureMessageOf(errorBody, stderr)}`)
  }
  const durationMs = await wavDurationOfFile($, audioPath)
  return { playback: wavPlaybackOf(request.capabilities, audioPath), durationMs, wordStartsMs: estimatedWordStartsMs(request.speakableWords, durationMs) }
}

// Writes the WAV and prints when each word the voice heard starts: a word starts at the first phoneme after a space.
const PIPER_TIMED_SYNTHESIS = `
import json, sys, wave
from piper import PiperVoice, SynthesisConfig
voice = PiperVoice.load(sys.argv[1], include_alignments=True)
speaker_id = int(sys.argv[4]) if sys.argv[4] else None
starts, samples, rate, is_word_start = [], 0, 1, True
with wave.open(sys.argv[2], "wb") as out:
    for index, chunk in enumerate(voice.synthesize(sys.stdin.read(), SynthesisConfig(length_scale=float(sys.argv[3]), speaker_id=speaker_id), include_alignments=True)):
        if index == 0:
            out.setframerate(chunk.sample_rate); out.setsampwidth(chunk.sample_width); out.setnchannels(chunk.sample_channels)
        rate = chunk.sample_rate
        for alignment in chunk.phoneme_alignments or []:
            if alignment.phoneme == " ":
                is_word_start = True
            elif is_word_start and alignment.phoneme.strip() and alignment.phoneme not in "^$_,.;:!?":
                starts.append(samples * 1000 / rate)
                is_word_start = False
            samples += alignment.num_samples
        out.writeframes(chunk.audio_int16_bytes)
print(json.dumps(starts))
`

async function synthesizeWithPiper($: EngineInterface, request: SynthesisRequest): Promise<Synthesis> {
  const piper = request.capabilities.piper
  if (piper === null) throw new SynthesisError('Piper is not installed')
  const { text } = speakableTextOf(request.speakableWords)
  const audioPath = `${request.outputPathWithoutExtension}.wav`
  const lengthScale = String(1 / request.settings.speed)
  if (piper.python !== null) {
    const speaker = piper.speakerId === null ? '' : String(piper.speakerId)
    const stdout = await runOrFail($, [piper.python, '-c', PIPER_TIMED_SYNTHESIS, piper.voice, audioPath, lengthScale, speaker], text, 'Piper')
    const voiceWordStartsMs = JSON.parse(stdout.trim().split('\n').pop() ?? '[]') as number[]
    const durationMs = await wavDurationOfFile($, audioPath)
    return {
      playback: wavPlaybackOf(request.capabilities, audioPath),
      durationMs,
      wordStartsMs: wordStartsFromVoiceWords(request.speakableWords, voiceWordStartsMs) ?? estimatedWordStartsMs(request.speakableWords, durationMs),
    }
  }
  const speakerArguments = piper.speakerId === null ? [] : ['-s', String(piper.speakerId)]
  await runOrFail($, [piper.command, '-m', piper.voice, '-f', audioPath, '--length-scale', lengthScale, ...speakerArguments], text, 'Piper')
  const durationMs = await wavDurationOfFile($, audioPath)
  return { playback: wavPlaybackOf(request.capabilities, audioPath), durationMs, wordStartsMs: estimatedWordStartsMs(request.speakableWords, durationMs) }
}

async function synthesizeWithSystemVoice($: EngineInterface, request: SynthesisRequest): Promise<Synthesis> {
  const { settings, capabilities, speakableWords } = request
  const { text } = speakableTextOf(speakableWords)
  const audioPath = `${request.outputPathWithoutExtension}.wav`
  switch (capabilities.systemVoice) {
    case 'say':
      await runOrFail($, ['say', '-r', String(Math.round(180 * settings.speed)), '-o', audioPath, '--data-format=LEI16@22050', '-f', '-'], text, 'say')
      break
    case 'espeak-ng':
      await runOrFail($, ['espeak-ng', '-v', settings.language, '-s', String(Math.round(160 * settings.speed)), '-w', audioPath, '--stdin'], text, 'espeak-ng')
      break
    case 'spd-say': {
      const durationMs = (text.length * SYSTEM_VOICE_MS_PER_CHARACTER) / settings.speed
      const rate = String(Math.max(-100, Math.min(100, Math.round((settings.speed - 1) * 100))))
      return { playback: ['spd-say', '-w', '-l', settings.language, '-r', rate, text], durationMs, wordStartsMs: estimatedWordStartsMs(speakableWords, durationMs) }
    }
    case null:
      throw new SynthesisError('no system voice is installed')
  }
  const durationMs = await wavDurationOfFile($, audioPath)
  return { playback: wavPlaybackOf(capabilities, audioPath), durationMs, wordStartsMs: estimatedWordStartsMs(speakableWords, durationMs) }
}

// How an answer is cut into the pieces sent to the voice. A local voice gets the first sentence alone, to start soon,
// then pieces made while the one before plays. A cloud voice gets the answer whole: a short first piece made it start
// slowly, its pace found on the pieces after.
export type Chunking = { maxCharacters: number; isFirstSentenceAlone: boolean }

const CHUNKINGS: Readonly<Record<TalkEngineName, Chunking>> = {
  elevenlabs: { maxCharacters: 2_400, isFirstSentenceAlone: false },
  openai: { maxCharacters: 2_400, isFirstSentenceAlone: false },
  piper: { maxCharacters: 260, isFirstSentenceAlone: true },
  system: { maxCharacters: 260, isFirstSentenceAlone: true },
}

export const chunkingOf = (engine: TalkEngineName): Chunking => CHUNKINGS[engine]

// What OpenAI charges for a minute of voice from its speech model, roughly: its price is per token of text and of
// audio, about this much for a minute of speech.
export const OPENAI_DOLLARS_PER_AUDIO_MINUTE = 0.015

export type SpeedRange = { min: number; max: number }

// The speeds each engine reads at: ElevenLabs refuses any other, the band offers no more than twice the normal pace.
const SPEED_RANGES: Readonly<Record<TalkEngineName, SpeedRange>> = {
  elevenlabs: { min: 0.7, max: 1.2 },
  openai: { min: 0.5, max: 2 },
  piper: { min: 0.5, max: 2 },
  system: { min: 0.5, max: 2 },
}

export const speedRangeOf = (engine: TalkEngineName | null): SpeedRange => (engine === null ? SPEED_RANGES.piper : SPEED_RANGES[engine])

// The speed an engine reads at: the one chosen, brought within what the engine takes.
export const effectiveSpeedOf = (engine: TalkEngineName | null, speed: number): number => {
  const { min, max } = speedRangeOf(engine)
  return Math.min(max, Math.max(min, speed))
}

export function synthesize($: EngineInterface, engine: TalkEngineName, chosen: SynthesisRequest): Promise<Synthesis> {
  const request = { ...chosen, settings: { ...chosen.settings, speed: effectiveSpeedOf(engine, chosen.settings.speed) } }
  switch (engine) {
    case 'elevenlabs':
      return synthesizeWithElevenLabs($, request)
    case 'openai':
      return synthesizeWithOpenAi($, request)
    case 'piper':
      return synthesizeWithPiper($, request)
    case 'system':
      return synthesizeWithSystemVoice($, request)
  }
}

// Local voices read every word in their own language, so the English words of a French answer are respelled for them.
export const isRespellingEnglishFor = (engine: TalkEngineName): boolean => {
  switch (engine) {
    case 'elevenlabs':
    case 'openai':
      return false
    case 'piper':
    case 'system':
      return true
  }
}

export const engineLabels: Readonly<Record<TalkEngineName, string>> = {
  elevenlabs: 'ElevenLabs',
  openai: 'OpenAI',
  piper: 'Piper',
  system: 'System voice',
}
