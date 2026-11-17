import type { TalkLanguage, VoiceChoice, VoiceGender } from '../../types'
import { estimatedWordStartsMs, speakableTextOf, wordStartsFromVoiceWords } from '../timing'
import type { VoiceProvider } from './provider'
import type { Machine, Synthesis, SynthesisRequest } from './synthesis'
import { NO_AUDIO_PLAYER, runOrFail, SynthesisError, textOptionOf, wavDurationOfFile, wavPlaybackOf } from './synthesis'
import type { VoiceToolkit } from './toolkit'

// voice: the path of a voice file, which wins; voiceName: a voice of the Piper catalog, chosen in the band.
export type PiperOptions = { command: string; voice: string; voiceName: string }

// Piper as found on the machine. python: the interpreter of Piper's own environment, when it can tell when each word is
// spoken.
export type PiperFound = { command: string; voice: string; speakerId: number | null; python: string | null } | null

export const VOICES_ADDRESS = 'https://huggingface.co/rhasspy/piper-voices/resolve/main'

const DOWNLOAD_TIMEOUT_MS = 600_000
// A voice made of more speakers than this is a crowd read from audiobooks, of very uneven quality: left out.
const MAX_SPEAKERS_LISTED = 10

export const piperHomeOf = (home: string): string => `${home}/.local/share/piper`

type PiperCatalogEntry = {
  name: string
  quality: string
  num_speakers: number
  language: { code: string; family: string }
  speaker_id_map?: Record<string, number>
  files?: Record<string, { size_bytes: number }>
}

const capitalized = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1)

// The Piper catalog says nothing of its voices' gender either: the medium ones of the mod's languages, by name or by
// speaker. A voice not named here shows under All alone.
const PIPER_VOICE_GENDERS: Readonly<Record<string, VoiceGender>> = {
  kerstin: 'female', thorsten: 'male', thorsten_emotional: 'male', alan: 'male', alba: 'female', cori: 'female',
  jenny_dioco: 'female', northern_english_male: 'male', prudence: 'female', poppy: 'female', spike: 'male',
  obadiah: 'male', amy: 'female', bryce: 'male', hfc_female: 'female', hfc_male: 'male', joe: 'male', john: 'male',
  kathleen: 'female', kristin: 'female', kusal: 'male', lessac: 'female', ljspeech: 'female', mike: 'male',
  norman: 'male', reza_ibrahim: 'male', ryan: 'male', davefx: 'male', F: 'female', M: 'male', siwis: 'female',
  tom: 'male', jessica: 'female', pierre: 'male', paola: 'female', serena: 'female',
}

// A Piper voice is named `<key>` (fr_FR-siwis-medium) or, for one speaker of several, `<key>#<speaker>`.
export const piperVoiceKeyOf = (value: string): string => value.split('#')[0] ?? value

export const piperSpeakerOf = (value: string): string | null => value.split('#')[1] ?? null

// The voices the Piper project publishes for the language, as the band offers them: one per voice, one per speaker of
// a voice of a few speakers, medium quality alone. A low quality voice sounds worse; a high quality one takes, on a
// processor, as long to make a sentence as to say it, and several times longer with the timing of its words, too slow
// for a conversation.
export const piperChoicesOf = (catalog: Readonly<Record<string, PiperCatalogEntry>>, language: TalkLanguage): VoiceChoice[] => {
  return Object.entries(catalog)
    .filter(([, entry]) => entry.language.family === language && entry.num_speakers <= MAX_SPEAKERS_LISTED && entry.quality === 'medium')
    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
    .flatMap(([key, entry]) => {
      const region = entry.language.code.split('_')[1] ?? ''
      const regionLabel = language === 'en' || language === 'es' ? ` ${region}` : ''
      const voiceLabel = `${capitalized(entry.name.replace(/_/g, ' '))}${regionLabel}`
      const download = `${entry.language.family}/${entry.language.code}/${entry.name}/${entry.quality}/${key}`
      const speakers = entry.num_speakers > 1 ? Object.keys(entry.speaker_id_map ?? {}) : []
      const sizeBytes = entry.files?.[`${download}.onnx`]?.size_bytes ?? null
      if (speakers.length === 0) return [{ value: key, label: voiceLabel, download, sizeBytes, gender: PIPER_VOICE_GENDERS[entry.name] ?? null }]
      return speakers.map(speaker => ({
        value: `${key}#${speaker}`,
        label: `${voiceLabel} ${capitalized(speaker)}`,
        download,
        sizeBytes,
        gender: PIPER_VOICE_GENDERS[speaker] ?? PIPER_VOICE_GENDERS[entry.name] ?? null,
      }))
    })
}

let catalogRead: Readonly<Record<string, PiperCatalogEntry>> | null = null

async function catalogOf(toolkit: VoiceToolkit): Promise<Readonly<Record<string, PiperCatalogEntry>>> {
  if (catalogRead !== null) return catalogRead
  const { ok, status, text } = await toolkit.fetch(`${VOICES_ADDRESS}/voices.json`)
  if (!ok) throw new Error(`the list of Piper voices could not be read (HTTP ${status})`)
  catalogRead = JSON.parse(text) as Record<string, PiperCatalogEntry>
  return catalogRead
}

// Downloads one Piper voice, its model and its description, under a temporary name first: a voice cut short is never
// taken for a whole one.
export async function downloadPiperVoice(toolkit: VoiceToolkit, voicesDirectory: string, download: string): Promise<void> {
  const voiceName = download.slice(download.lastIndexOf('/') + 1)
  const script = 'set -e; mkdir -p "$1"; for suffix in .onnx.json .onnx; do curl -fsSL -o "$1/$2$suffix.part" "$3$suffix"; mv "$1/$2$suffix.part" "$1/$2$suffix"; done'
  const { exitCode, stderr } = await toolkit.run(['sh', '-c', script, 'sh', voicesDirectory, voiceName, `${VOICES_ADDRESS}/${download}`], {
    timeoutMs: DOWNLOAD_TIMEOUT_MS,
  })
  if (exitCode !== 0) throw new Error(`Downloading the voice failed: ${stderr.trim().slice(0, 300)}`)
}

async function optionsOf(_toolkit: VoiceToolkit, values: Readonly<Record<string, unknown>>): Promise<PiperOptions> {
  return { command: textOptionOf(values, 'piperCommand'), voice: textOptionOf(values, 'piperVoice'), voiceName: textOptionOf(values, 'piperVoiceName') }
}

async function firstVoiceOf(toolkit: VoiceToolkit, directory: string, language: TalkLanguage): Promise<string | null> {
  if (!(await toolkit.exists(directory))) return null
  const voices = (await toolkit.fileNamesOf(directory)).filter(name => name.endsWith('.onnx') && name.startsWith(`${language}_`)).sort()
  return voices[0] === undefined ? null : `${directory}/${voices[0]}`
}

// The catalog voice chosen in the band, when it is of the language and on the machine.
async function chosenVoiceOf(toolkit: VoiceToolkit, directory: string, options: PiperOptions, language: TalkLanguage): Promise<{ voice: string; speakerId: number | null } | null> {
  const key = piperVoiceKeyOf(options.voiceName)
  if (key === '' || !key.startsWith(`${language}_`)) return null
  const voice = `${directory}/${key}.onnx`
  if (!(await toolkit.exists(voice))) return null
  const speaker = piperSpeakerOf(options.voiceName)
  if (speaker === null) return { voice, speakerId: null }
  const description = JSON.parse(await toolkit.readText(`${voice}.json`)) as { speaker_id_map?: Record<string, number> }
  return { voice, speakerId: description.speaker_id_map?.[speaker] ?? null }
}

// The timing of each phoneme comes from Piper's Python library, which needs the onnx package beside it.
async function pythonOf(toolkit: VoiceToolkit, command: string): Promise<string | null> {
  if (!command.includes('/')) return null
  const python = `${command.slice(0, command.lastIndexOf('/'))}/python`
  if (!(await toolkit.exists(python))) return null
  const { exitCode } = await toolkit.run([python, '-c', 'import piper, onnx'])
  return exitCode === 0 ? python : null
}

async function findOnMachine(toolkit: VoiceToolkit, options: PiperOptions, language: TalkLanguage, installedCommands: ReadonlySet<string>): Promise<PiperFound> {
  const piperHome = piperHomeOf((await toolkit.environmentVariable('HOME')) ?? '')
  let command = options.command
  if (command === '' && installedCommands.has('piper')) command = 'piper'
  if (command === '' && (await toolkit.exists(`${piperHome}/venv/bin/piper`))) command = `${piperHome}/venv/bin/piper`
  if (command === '') return null
  const chosen = options.voice === '' ? await chosenVoiceOf(toolkit, `${piperHome}/voices`, options, language) : null
  const voice = options.voice !== '' ? options.voice : (chosen?.voice ?? (await firstVoiceOf(toolkit, `${piperHome}/voices`, language)))
  if (voice === null) return null
  return { command, voice, speakerId: chosen?.speakerId ?? null, python: await pythonOf(toolkit, command) }
}

// The voice in force as the list names it: the one chosen in the band when it is the one found, else the file's name.
const voiceOf = (options: PiperOptions, machine: Machine<PiperFound> | null): string | null => {
  const piper = machine?.found ?? null
  if (piper === null) return null
  if (options.voiceName !== '' && piper.voice.endsWith(`/${piperVoiceKeyOf(options.voiceName)}.onnx`)) return options.voiceName
  return piper.voice.slice(piper.voice.lastIndexOf('/') + 1).replace(/\.onnx$/, '')
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

async function synthesize(toolkit: VoiceToolkit, request: SynthesisRequest<PiperOptions, PiperFound>): Promise<Synthesis> {
  const piper = request.machine.found
  if (piper === null) throw new SynthesisError('Piper is not installed')
  const { text } = speakableTextOf(request.speakableWords)
  const audioPath = `${request.outputPathWithoutExtension}.wav`
  const lengthScale = String(1 / request.speed)
  if (piper.python !== null) {
    const speaker = piper.speakerId === null ? '' : String(piper.speakerId)
    const stdout = await runOrFail(toolkit, [piper.python, '-c', PIPER_TIMED_SYNTHESIS, piper.voice, audioPath, lengthScale, speaker], text, 'Piper')
    const voiceWordStartsMs = JSON.parse(stdout.trim().split('\n').pop() ?? '[]') as number[]
    const durationMs = await wavDurationOfFile(toolkit, audioPath)
    return {
      playback: wavPlaybackOf(request.machine, audioPath),
      durationMs,
      wordStartsMs: wordStartsFromVoiceWords(request.speakableWords, voiceWordStartsMs) ?? estimatedWordStartsMs(request.speakableWords, durationMs),
    }
  }
  const speakerArguments = piper.speakerId === null ? [] : ['-s', String(piper.speakerId)]
  await runOrFail(toolkit, [piper.command, '-m', piper.voice, '-f', audioPath, '--length-scale', lengthScale, ...speakerArguments], text, 'Piper')
  const durationMs = await wavDurationOfFile(toolkit, audioPath)
  return { playback: wavPlaybackOf(request.machine, audioPath), durationMs, wordStartsMs: estimatedWordStartsMs(request.speakableWords, durationMs) }
}

export const piper: VoiceProvider<PiperOptions, PiperFound> = {
  label: 'Piper',
  kind: 'local',
  voiceOptionField: 'piperVoiceName',
  speedRange: { min: 0.5, max: 2 },
  chunking: { maxCharacters: 260, isFirstSentenceAlone: true },
  isRespellingEnglish: true,
  isVoiceNamedById: false,
  commandsLookedFor: ['piper'],
  optionsOf,
  findOnMachine,
  unavailabilityOf: (_options, machine) => {
    if (machine.wavPlayer === null) return NO_AUDIO_PLAYER
    return machine.found === null ? 'Piper or a Piper voice of the language was not found (see the README to install it)' : null
  },
  voiceOf,
  withVoice: (options, voice) => ({ ...options, voice: '', voiceName: voice }),
  voicesOf: async (toolkit, _options, language) => piperChoicesOf(await catalogOf(toolkit), language),
  synthesize,
  costLabelOf: () => null,
  creditsOf: null,
}
