import { estimatedWordStartsMs, speakableTextOf } from '../timing'
import type { VoiceProvider } from './provider'
import type { Synthesis, SynthesisRequest } from './synthesis'
import { NO_AUDIO_PLAYER, runOrFail, SynthesisError, wavDurationOfFile, wavPlaybackOf } from './synthesis'
import type { VoiceToolkit } from './toolkit'

export type SystemVoiceCommand = 'say' | 'espeak-ng' | 'spd-say'

// The system voice has no option of its own: it speaks the mod's language at the mod's speed.
export type SystemVoiceOptions = Readonly<Record<string, never>>

const COMMANDS: readonly SystemVoiceCommand[] = ['say', 'espeak-ng', 'spd-say']

// How long a system voice that writes no file takes per character at normal speed, to pace the words on screen.
const MS_PER_CHARACTER = 65

async function synthesize(toolkit: VoiceToolkit, request: SynthesisRequest<SystemVoiceOptions, SystemVoiceCommand | null>): Promise<Synthesis> {
  const { language, speed, speakableWords } = request
  const { text } = speakableTextOf(speakableWords)
  const audioPath = `${request.outputPathWithoutExtension}.wav`
  switch (request.machine.found) {
    case 'say':
      await runOrFail(toolkit, ['say', '-r', String(Math.round(180 * speed)), '-o', audioPath, '--data-format=LEI16@22050', '-f', '-'], text, 'say')
      break
    case 'espeak-ng':
      await runOrFail(toolkit, ['espeak-ng', '-v', language, '-s', String(Math.round(160 * speed)), '-w', audioPath, '--stdin'], text, 'espeak-ng')
      break
    case 'spd-say': {
      const durationMs = (text.length * MS_PER_CHARACTER) / speed
      const rate = String(Math.max(-100, Math.min(100, Math.round((speed - 1) * 100))))
      return { playback: ['spd-say', '-w', '-l', language, '-r', rate, text], durationMs, wordStartsMs: estimatedWordStartsMs(speakableWords, durationMs) }
    }
    case null:
      throw new SynthesisError('no system voice is installed')
  }
  const durationMs = await wavDurationOfFile(toolkit, audioPath)
  return { playback: wavPlaybackOf(request.machine, audioPath), durationMs, wordStartsMs: estimatedWordStartsMs(speakableWords, durationMs) }
}

export const systemVoice: VoiceProvider<SystemVoiceOptions, SystemVoiceCommand | null> = {
  label: 'System voice',
  kind: 'local',
  voiceOptionField: null,
  models: null,
  speedRange: { min: 0.5, max: 2 },
  chunking: { maxCharacters: 260, isFirstSentenceAlone: true },
  isRespellingEnglish: true,
  isVoiceNamedById: false,
  commandsLookedFor: COMMANDS,
  optionsOf: async () => ({}),
  findOnMachine: async (_toolkit, _options, _language, installedCommands) => COMMANDS.find(command => installedCommands.has(command)) ?? null,
  unavailabilityOf: (_options, machine) => {
    // spd-say plays its own sound.
    if (machine.wavPlayer === null && machine.found !== 'spd-say') return NO_AUDIO_PLAYER
    return machine.found === null ? 'no system voice found (say, espeak-ng or spd-say)' : null
  },
  voiceOf: () => null,
  withVoice: options => options,
  modelOf: () => null,
  voicesOf: async () => [],
  synthesize,
  costLabelOf: () => null,
  creditsOf: null,
}
