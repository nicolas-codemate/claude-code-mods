import type { Credits, Spending, TalkLanguage, VoiceChoice } from '../../types'
import type { Chunking, Machine, SpeedRange, Synthesis, SynthesisRequest } from './synthesis'
import type { VoiceToolkit } from './toolkit'

// A model the service speaks with, and what tells it apart from the others, as the band lists it.
export type ModelChoice = { value: string; label: string; detail: string }

// What a voice service brings to talk mode. Each service is one file of this folder exporting an object of this shape,
// listed in ./index.ts. Options are its own settings, read from the plugin's options, which its fields in plugin.json
// declare; Found is what it looks for on the machine, null for a service that needs nothing there. It reaches the
// machine and the network through the toolkit alone.
export interface VoiceProvider<Options, Found> {
  readonly label: string
  // A cloud voice needs a key and the network; a local one runs on the machine.
  readonly kind: 'cloud' | 'local'
  // The plugin option the band saves the chosen voice in; null for a service of a single voice.
  readonly voiceOptionField: string | null
  // The models the band offers and the plugin option it saves the chosen one in; null for a service of one model.
  readonly models: { readonly optionField: string; readonly choices: readonly ModelChoice[] } | null
  readonly speedRange: SpeedRange
  readonly chunking: Chunking
  // A voice that reads every word in its own language gets the English words of an answer respelled.
  readonly isRespellingEnglish: boolean
  // The commands it looks for on the PATH: the machine is searched once for those of every service.
  readonly commandsLookedFor: readonly string[]
  optionsOf(toolkit: VoiceToolkit, values: Readonly<Record<string, unknown>>): Promise<Options>
  findOnMachine(toolkit: VoiceToolkit, options: Options, language: TalkLanguage, installedCommands: ReadonlySet<string>): Promise<Found>
  // Why this machine cannot use the service, the lack of an audio player included; null when it can.
  unavailabilityOf(options: Options, machine: Machine<Found>): string | null
  // The voice in force, as its list names it; machine is null until the machine has been searched.
  voiceOf(options: Options, machine: Machine<Found> | null): string | null
  withVoice(options: Options, voice: string): Options
  modelOf(options: Options): string | null
  // The name of a voice told by its value alone, while its list is not read; null for a voice named by an id nobody
  // can read.
  voiceLabelOf(voice: string): string | null
  voicesOf(toolkit: VoiceToolkit, options: Options, language: TalkLanguage): Promise<VoiceChoice[]>
  synthesize(toolkit: VoiceToolkit, request: SynthesisRequest<Options, Found>): Promise<Synthesis>
  // What the session has cost, as the band shows it beside the engine; null for a service that costs nothing.
  costLabelOf(spending: Spending, credits: Credits | null): string | null
  // The credits of the account, for a service that counts them; null for one that does not.
  // For a service whose voices are fetched the first time they are used: the file a voice grows in while it comes, which
  // tells the download's progress, and the download itself; null for a service whose voices need nothing on the machine.
  readonly voiceDownloads: {
    partialFileOf(toolkit: VoiceToolkit, download: string): Promise<string>
    download(toolkit: VoiceToolkit, download: string): Promise<void>
  } | null
  readonly creditsOf: ((toolkit: VoiceToolkit, options: Options) => Promise<Pick<Credits, 'used' | 'limit'> | null>) | null
}
