import type { Credits, Spending, VoiceChoice, VoiceGender } from '../../types'
import { alignedWordStartsMs, estimatedWordStartsMs, speakableTextOf } from '../timing'
import type { VoiceProvider } from './provider'
import type { Synthesis, SynthesisRequest } from './synthesis'
import { curlPost, runOrFail, SynthesisError, textOptionOf, wavDurationOfFile, wavPlaybackOf } from './synthesis'
import type { VoiceToolkit } from './toolkit'

export type ElevenLabsOptions = { apiKey: string; model: string; voiceId: string }

const API_ADDRESS = 'https://api.elevenlabs.io/v1'

async function optionsOf(toolkit: VoiceToolkit, values: Readonly<Record<string, unknown>>): Promise<ElevenLabsOptions> {
  return {
    apiKey: textOptionOf(values, 'elevenlabsApiKey') || ((await toolkit.environmentVariable('ELEVENLABS_API_KEY')) ?? ''),
    model: textOptionOf(values, 'elevenlabsModel'),
    voiceId: textOptionOf(values, 'elevenlabsVoiceId'),
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

async function synthesize(toolkit: VoiceToolkit, request: SynthesisRequest<ElevenLabsOptions>): Promise<Synthesis> {
  const { options, outputPathWithoutExtension } = request
  const { text, wordStartOffsets } = speakableTextOf(request.speakableWords)
  const bodyPath = `${outputPathWithoutExtension}.request.json`
  const audioPath = `${outputPathWithoutExtension}.wav`
  await toolkit.write(bodyPath, JSON.stringify({
    text,
    model_id: options.model,
    language_code: request.language,
    voice_settings: { speed: request.speed },
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

export const elevenLabs: VoiceProvider<ElevenLabsOptions> = {
  label: 'ElevenLabs',
  voiceOptionField: 'elevenlabsVoiceId',
  // ElevenLabs refuses any other speed.
  speedRange: { min: 0.7, max: 1.2 },
  chunking: { maxCharacters: 2_400, isFirstSentenceAlone: false },
  isRespellingEnglish: false,
  isVoiceNamedById: true,
  optionsOf,
  unavailabilityOf: options => (options.apiKey === '' ? 'no ElevenLabs API key: set it in /config or as ELEVENLABS_API_KEY' : null),
  voiceOf: options => options.voiceId,
  withVoice: (options, voice) => ({ ...options, voiceId: voice }),
  voicesOf,
  synthesize,
  costLabelOf,
  creditsOf,
}
