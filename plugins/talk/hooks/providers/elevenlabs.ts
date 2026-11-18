import type { Credits, Spending, VoiceChoice, VoiceGender } from '../../types'
import { alignedWordStartsMs, estimatedWordStartsMs, speakableTextOf } from '../timing'
import type { VoiceProvider } from './provider'
import type { Synthesis, SynthesisRequest } from './synthesis'
import { curlPost, NO_AUDIO_PLAYER, runOrFail, SynthesisError, textOptionOf, wavDurationOfFile, wavPlaybackOf } from './synthesis'
import type { VoiceToolkit } from './toolkit'

// pronunciationDictionaries: the ids of dictionaries of the account, applied to every request in their latest version.
export type ElevenLabsOptions = { apiKey: string; model: string; voiceId: string; pronunciationDictionaries: readonly string[] }

// ElevenLabs takes no more dictionaries in one request.
const MAX_PRONUNCIATION_DICTIONARIES = 3

const API_ADDRESS = 'https://api.elevenlabs.io/v1'

async function optionsOf(toolkit: VoiceToolkit, values: Readonly<Record<string, unknown>>): Promise<ElevenLabsOptions> {
  return {
    apiKey: textOptionOf(values, 'elevenlabsApiKey') || ((await toolkit.environmentVariable('ELEVENLABS_API_KEY')) ?? ''),
    model: textOptionOf(values, 'elevenlabsModel'),
    voiceId: textOptionOf(values, 'elevenlabsVoiceId'),
    pronunciationDictionaries: textOptionOf(values, 'elevenlabsPronunciationDictionaries')
      .split(/[\s,]+/)
      .filter(id => id !== '')
      .slice(0, MAX_PRONUNCIATION_DICTIONARIES),
  }
}

async function voicesOf(toolkit: VoiceToolkit, options: ElevenLabsOptions): Promise<VoiceChoice[]> {
  const { ok, status, text } = await toolkit.fetch(`${API_ADDRESS}/voices`, { headers: { 'xi-api-key': options.apiKey } })
  if (!ok) throw new Error(`the ElevenLabs voices could not be read (HTTP ${status})`)
  const { voices } = JSON.parse(text) as { voices: { voice_id: string; name: string; labels?: { gender?: string } }[] }
  const genderOf = (gender: string | undefined): VoiceGender | null => (gender === 'female' || gender === 'male' ? gender : null)
  return voices.map(voice => ({
    value: voice.voice_id,
    label: voice.name.split(' - ')[0] ?? voice.name,
    download: null,
    sizeBytes: null,
    gender: genderOf(voice.labels?.gender),
  }))
}

// The credits of the account: those used this month and how many it has.
async function creditsOf(toolkit: VoiceToolkit, options: ElevenLabsOptions): Promise<Pick<Credits, 'used' | 'limit'> | null> {
  if (options.apiKey === '') return null
  const { ok, text } = await toolkit.fetch(`${API_ADDRESS}/user/subscription`, { headers: { 'xi-api-key': options.apiKey } })
  if (!ok) return null
  const { character_count, character_limit } = JSON.parse(text) as { character_count?: number; character_limit?: number }
  return character_count === undefined || character_limit === undefined ? null : { used: character_count, limit: character_limit }
}

async function synthesize(toolkit: VoiceToolkit, request: SynthesisRequest<ElevenLabsOptions, null>): Promise<Synthesis> {
  const { options, outputPathWithoutExtension } = request
  const { text, wordStartOffsets } = speakableTextOf(request.speakableWords)
  const bodyPath = `${outputPathWithoutExtension}.request.json`
  const audioPath = `${outputPathWithoutExtension}.wav`
  await toolkit.write(bodyPath, JSON.stringify({
    text,
    model_id: options.model,
    language_code: request.language,
    voice_settings: { speed: request.speed },
    ...(options.pronunciationDictionaries.length === 0
      ? {}
      : { pronunciation_dictionary_locators: options.pronunciationDictionaries.map(id => ({ pronunciation_dictionary_id: id })) }),
  }))
  const url = `${API_ADDRESS}/text-to-speech/${encodeURIComponent(options.voiceId)}/with-timestamps?output_format=wav_24000`
  const stdout = await runOrFail(toolkit, curlPost(url, bodyPath, null), `xi-api-key: ${options.apiKey}\n`, 'ElevenLabs')
  const response = JSON.parse(stdout) as { audio_base64?: string; alignment?: { character_start_times_seconds?: number[] } }
  if (response.audio_base64 === undefined) throw new SynthesisError('ElevenLabs answered no audio')
  await runOrFail(toolkit, ['sh', '-c', 'base64 -d > "$1"', 'sh', audioPath], response.audio_base64, 'Decoding the ElevenLabs audio')
  const starts = response.alignment?.character_start_times_seconds ?? []
  const durationMs = await wavDurationOfFile(toolkit, audioPath)
  return {
    playback: wavPlaybackOf(request.machine, audioPath),
    durationMs,
    wordStartsMs: starts.length > 0 ? alignedWordStartsMs(wordStartOffsets, starts) : estimatedWordStartsMs(request.speakableWords, durationMs),
  }
}

// The credits the account counts once its API has told them, else the characters read, which is what it charges.
const costLabelOf = (spending: Spending, credits: Credits | null): string | null => {
  if (credits === null) return spending.characters === 0 ? null : `${spending.characters.toLocaleString('en-US')} characters`
  return `${(credits.used - credits.usedAtStart).toLocaleString('en-US')} credits · ${(credits.limit - credits.used).toLocaleString('en-US')} left`
}

export const elevenLabs: VoiceProvider<ElevenLabsOptions, null> = {
  label: 'ElevenLabs',
  kind: 'cloud',
  voiceOptionField: 'elevenlabsVoiceId',
  // Every voice speaks with either model.
  models: {
    optionField: 'elevenlabsModel',
    choices: [
      { value: 'eleven_multilingual_v2', label: 'Multilingual v2', detail: 'the most natural, 1 credit a character' },
      { value: 'eleven_flash_v2_5', label: 'Flash v2.5', detail: 'starts sooner, half a credit a character' },
    ],
  },
  // ElevenLabs refuses any other speed.
  speedRange: { min: 0.7, max: 1.2 },
  chunking: { maxCharacters: 2_400, isFirstSentenceAlone: false },
  isRespellingEnglish: false,
  commandsLookedFor: [],
  optionsOf,
  findOnMachine: async () => null,
  unavailabilityOf: (options, machine) => {
    if (options.apiKey === '') return 'no ElevenLabs API key: set it in /config or as ELEVENLABS_API_KEY'
    return machine.wavPlayer === null ? NO_AUDIO_PLAYER : null
  },
  voiceOf: options => options.voiceId,
  withVoice: (options, voice) => ({ ...options, voiceId: voice }),
  modelOf: options => options.model,
  // An ElevenLabs voice is an id until the list of voices gives its name.
  voiceLabelOf: () => null,
  voicesOf,
  synthesize,
  costLabelOf,
  voiceDownloads: null,
  creditsOf,
}
