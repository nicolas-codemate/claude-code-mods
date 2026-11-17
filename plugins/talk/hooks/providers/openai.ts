import type { Spending, VoiceChoice, VoiceGender } from '../../types'
import { languageNameOf } from '../languages'
import { estimatedWordStartsMs, speakableTextOf } from '../timing'
import type { VoiceProvider } from './provider'
import type { Synthesis, SynthesisRequest } from './synthesis'
import { curlPost, failureMessageOf, NO_AUDIO_PLAYER, SYNTHESIS_TIMEOUT_MS, SynthesisError, textOptionOf, wavDurationOfFile, wavPlaybackOf } from './synthesis'
import type { VoiceToolkit } from './toolkit'

export type OpenAiOptions = { apiKey: string; model: string; voice: string }

// What OpenAI charges for a minute of voice from its speech model, roughly: its price is per token of text and of
// audio, about this much for a minute of speech.
const DOLLARS_PER_AUDIO_MINUTE = 0.015

const VOICES: readonly string[] = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse', 'marin', 'cedar']

// OpenAI says nothing of its voices' gender: as they sound. Alloy and Fable are left out, being neither.
const VOICE_GENDERS: Readonly<Record<string, VoiceGender>> = {
  ash: 'male', ballad: 'male', coral: 'female', echo: 'male', onyx: 'male', nova: 'female', sage: 'female',
  shimmer: 'female', verse: 'male', marin: 'female', cedar: 'male',
}

const capitalized = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1)

const CHOICES: readonly VoiceChoice[] = VOICES.map(voice => ({ value: voice, label: capitalized(voice), download: null, sizeBytes: null, gender: VOICE_GENDERS[voice] ?? null }))

async function optionsOf(toolkit: VoiceToolkit, values: Readonly<Record<string, unknown>>): Promise<OpenAiOptions> {
  return {
    apiKey: textOptionOf(values, 'openaiApiKey') || ((await toolkit.environmentVariable('OPENAI_API_KEY')) ?? ''),
    model: textOptionOf(values, 'openaiModel'),
    voice: textOptionOf(values, 'openaiVoice'),
  }
}

async function synthesize(toolkit: VoiceToolkit, request: SynthesisRequest<OpenAiOptions, null>): Promise<Synthesis> {
  const { options, outputPathWithoutExtension } = request
  const { text } = speakableTextOf(request.speakableWords)
  const bodyPath = `${outputPathWithoutExtension}.request.json`
  const audioPath = `${outputPathWithoutExtension}.wav`
  await toolkit.write(bodyPath, JSON.stringify({
    model: options.model,
    voice: options.voice,
    input: text,
    // The voice follows these words for its tone and its pace: a relaxed tone made it leave long silences between words.
    instructions: `Speak ${languageNameOf(request.language)} as a colleague in a lively conversation: warm and natural, at a brisk, steady pace, the words flowing on without pauses between them; pause briefly at the end of a sentence only. Pronounce English technical words as a developer would.`,
    response_format: 'wav',
    speed: request.speed,
  }))
  const { exitCode, stderr } = await toolkit.run(curlPost('https://api.openai.com/v1/audio/speech', bodyPath, audioPath), {
    stdin: `Authorization: Bearer ${options.apiKey}\n`,
    timeoutMs: SYNTHESIS_TIMEOUT_MS,
  })
  if (exitCode !== 0) {
    const errorBody = (await toolkit.exists(audioPath)) ? await toolkit.readText(audioPath) : ''
    throw new SynthesisError(`OpenAI failed: ${failureMessageOf(errorBody, stderr)}`)
  }
  const durationMs = await wavDurationOfFile(toolkit, audioPath)
  return { playback: wavPlaybackOf(request.machine, audioPath), durationMs, wordStartsMs: estimatedWordStartsMs(request.speakableWords, durationMs) }
}

// The dollars spent, as estimated from the minutes of voice made.
const costLabelOf = (spending: Spending): string => `≈ $${((spending.audioSeconds / 60) * DOLLARS_PER_AUDIO_MINUTE).toFixed(2)}`

export const openAi: VoiceProvider<OpenAiOptions, null> = {
  label: 'OpenAI',
  kind: 'cloud',
  voiceOptionField: 'openaiVoice',
  speedRange: { min: 0.5, max: 2 },
  chunking: { maxCharacters: 2_400, isFirstSentenceAlone: false },
  isRespellingEnglish: false,
  isVoiceNamedById: false,
  commandsLookedFor: [],
  optionsOf,
  findOnMachine: async () => null,
  unavailabilityOf: (options, machine) => {
    if (options.apiKey === '') return 'no OpenAI API key: set it in /config or as OPENAI_API_KEY'
    return machine.wavPlayer === null ? NO_AUDIO_PLAYER : null
  },
  voiceOf: options => options.voice,
  withVoice: (options, voice) => ({ ...options, voice }),
  voicesOf: async () => [...CHOICES],
  synthesize,
  costLabelOf,
  creditsOf: null,
}
