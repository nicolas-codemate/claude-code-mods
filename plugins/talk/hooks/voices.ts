import type { EngineInterface } from 'claude-code'

import type { TalkLanguage, VoiceChoice } from '../types'

export const PIPER_VOICES_ADDRESS = 'https://huggingface.co/rhasspy/piper-voices/resolve/main'

const DOWNLOAD_TIMEOUT_MS = 600_000
// A voice made of more speakers than this is a crowd read from audiobooks, of very uneven quality: left out.
const MAX_SPEAKERS_LISTED = 10

export const OPENAI_VOICES: readonly string[] = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse', 'marin', 'cedar']

// The sentence every voice is heard on, to compare them: a question as Claude asks one, with the English words of a
// developer.
export const SAMPLE_SENTENCES: Readonly<Record<TalkLanguage, string>> = {
  fr: 'Tu veux que je crée la pull request sur GitHub ? On attend la CI, et après on fait la code review ensemble.',
  en: 'Shall I open the pull request on GitHub? We wait for the CI, and then we do the code review together.',
  es: '¿Quieres que cree la pull request en GitHub? Esperamos la CI, y después hacemos la code review juntos.',
  de: 'Soll ich den Pull Request auf GitHub anlegen? Wir warten auf die CI, und dann machen wir zusammen das Code Review.',
  it: 'Vuoi che apra la pull request su GitHub? Aspettiamo la CI, e poi facciamo insieme la code review.',
}

type PiperCatalogEntry = {
  name: string
  quality: string
  num_speakers: number
  language: { code: string; family: string }
  speaker_id_map?: Record<string, number>
  files?: Record<string, { size_bytes: number }>
}

const capitalized = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1)

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
      if (speakers.length === 0) return [{ value: key, label: voiceLabel, download, sizeBytes }]
      return speakers.map(speaker => ({ value: `${key}#${speaker}`, label: `${voiceLabel} ${capitalized(speaker)}`, download, sizeBytes }))
    })
}

let piperCatalog: Readonly<Record<string, PiperCatalogEntry>> | null = null

export async function piperCatalogOf($: EngineInterface): Promise<Readonly<Record<string, PiperCatalogEntry>>> {
  if (piperCatalog !== null) return piperCatalog
  const { ok, status, text } = await $.http.fetch(`${PIPER_VOICES_ADDRESS}/voices.json`)
  if (!ok) throw new Error(`the list of Piper voices could not be read (HTTP ${status})`)
  piperCatalog = JSON.parse(text) as Record<string, PiperCatalogEntry>
  return piperCatalog
}

export async function elevenLabsChoicesOf($: EngineInterface, apiKey: string): Promise<VoiceChoice[]> {
  const { ok, status, text } = await $.http.fetch('https://api.elevenlabs.io/v1/voices', { headers: { 'xi-api-key': apiKey } })
  if (!ok) throw new Error(`the ElevenLabs voices could not be read (HTTP ${status})`)
  const { voices } = JSON.parse(text) as { voices: { voice_id: string; name: string }[] }
  return voices.map(voice => ({ value: voice.voice_id, label: voice.name.split(' - ')[0] ?? voice.name, download: null, sizeBytes: null }))
}

export const openAiChoices: readonly VoiceChoice[] = OPENAI_VOICES.map(voice => ({ value: voice, label: capitalized(voice), download: null, sizeBytes: null }))

// Downloads one Piper voice, its model and its description, under a temporary name first: a voice cut short is never
// taken for a whole one.
export async function downloadPiperVoice($: EngineInterface, voicesDirectory: string, download: string): Promise<void> {
  const voiceName = download.slice(download.lastIndexOf('/') + 1)
  const script = 'set -e; mkdir -p "$1"; for suffix in .onnx.json .onnx; do curl -fsSL -o "$1/$2$suffix.part" "$3$suffix"; mv "$1/$2$suffix.part" "$1/$2$suffix"; done'
  const { exitCode, stderr } = await $.process.run(['sh', '-c', script, 'sh', voicesDirectory, voiceName, `${PIPER_VOICES_ADDRESS}/${download}`], {
    timeoutMs: DOWNLOAD_TIMEOUT_MS,
  })
  if (exitCode !== 0) throw new Error(`Downloading the voice failed: ${stderr.trim().slice(0, 300)}`)
}
