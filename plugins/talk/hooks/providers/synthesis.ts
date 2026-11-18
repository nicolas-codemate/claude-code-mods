import type { TalkLanguage } from '../../types'
import { wavDurationMs } from '../wav'
import type { VoiceToolkit } from './toolkit'

// One piece of speech ready to play: the command whose run is the sound, how long it lasts and where each word starts.
export type Synthesis = { playback: readonly string[]; durationMs: number; wordStartsMs: number[] }

export class SynthesisError extends Error {}

// What a voice is asked to say: the words as it should pronounce them, with its own options, and where to write its
// files, the path given without an extension so that each voice adds its own.
export type SynthesisRequest<Options, Found> = {
  speakableWords: readonly string[]
  options: Options
  language: TalkLanguage
  // Already brought within the speeds the voice takes.
  speed: number
  machine: Machine<Found>
  outputPathWithoutExtension: string
  // The words of the pieces just before and just after, null at either end: a voice that takes them keeps one tone
  // from piece to piece.
  previousText: string | null
  nextText: string | null
}

// The machine as one service sees it: what every service shares, and what that service found there.
export type Machine<Found> = { platform: string; wavPlayer: readonly string[] | null; found: Found }

export const NO_AUDIO_PLAYER = 'no audio player found (pw-play, paplay, aplay, afplay or ffplay)'

// How an answer is cut into the pieces sent to the voice: the first sentence alone, to start soon, then pieces made
// while the one before plays, so that a stop leaves at most one piece made for nothing. A cloud voice that cannot be
// told the text around a piece gets the answer whole: short pieces made its pace change from one to the next.
export type Chunking = { maxCharacters: number; isFirstSentenceAlone: boolean }

export type SpeedRange = { min: number; max: number }

const CURL_TIMEOUT_SECONDS = 60
export const SYNTHESIS_TIMEOUT_MS = 90_000

const bytesOfBase64 = (base64: string): Uint8Array => (Uint8Array as unknown as { fromBase64: (text: string) => Uint8Array }).fromBase64(base64)

export async function wavDurationOfFile(toolkit: VoiceToolkit, path: string): Promise<number> {
  const durationMs = wavDurationMs(bytesOfBase64(await toolkit.readBase64(path)))
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

export async function runOrFail(toolkit: VoiceToolkit, argv: readonly string[], stdin: string | undefined, what: string): Promise<string> {
  const { exitCode, stdout, stderr } = await toolkit.run(argv, { stdin, timeoutMs: SYNTHESIS_TIMEOUT_MS })
  if (exitCode !== 0) throw new SynthesisError(`${what} failed: ${failureMessageOf(stdout, stderr)}`)
  return stdout
}

// The API keys go to curl on its standard input, never in its arguments, which any process of the machine can list.
export const curlPost = (url: string, bodyPath: string, outputPath: string | null): string[] => [
  'curl', '-sS', '--fail-with-body', '--max-time', String(CURL_TIMEOUT_SECONDS), '-X', 'POST', url,
  '-H', 'Content-Type: application/json', '-H', '@-', '--data-binary', `@${bodyPath}`,
  ...(outputPath === null ? [] : ['-o', outputPath]),
]

export const wavPlaybackOf = (machine: Machine<unknown>, path: string): string[] => [...(machine.wavPlayer ?? []), path]

export const textOptionOf = (values: Readonly<Record<string, unknown>>, name: string): string =>
  typeof values[name] === 'string' ? (values[name] as string) : ''
