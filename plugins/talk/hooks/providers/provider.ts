import type { Credits, Spending, TalkLanguage, VoiceChoice } from '../../types'
import type { Chunking, Machine, SpeedRange, Synthesis, SynthesisRequest } from './synthesis'
import type { VoiceToolkit } from './toolkit'

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
  readonly speedRange: SpeedRange
  readonly chunking: Chunking
  // A voice that reads every word in its own language gets the English words of an answer respelled.
  readonly isRespellingEnglish: boolean
  // A voice named by an id nobody can read is not shown by it until the list of voices gives its name.
  readonly isVoiceNamedById: boolean
  // The commands it looks for on the PATH: the machine is searched once for those of every service.
  readonly commandsLookedFor: readonly string[]
  optionsOf(toolkit: VoiceToolkit, values: Readonly<Record<string, unknown>>): Promise<Options>
  findOnMachine(toolkit: VoiceToolkit, options: Options, language: TalkLanguage, installedCommands: ReadonlySet<string>): Promise<Found>
  // Why this machine cannot use the service, the lack of an audio player included; null when it can.
  unavailabilityOf(options: Options, machine: Machine<Found>): string | null
  // The voice in force, as its list names it; machine is null until the machine has been searched.
  voiceOf(options: Options, machine: Machine<Found> | null): string | null
  withVoice(options: Options, voice: string): Options
  voicesOf(toolkit: VoiceToolkit, options: Options, language: TalkLanguage): Promise<VoiceChoice[]>
  synthesize(toolkit: VoiceToolkit, request: SynthesisRequest<Options, Found>): Promise<Synthesis>
  // What the session has cost, as the band shows it beside the engine; null for a service that costs nothing.
  costLabelOf(spending: Spending, credits: Credits | null): string | null
  // The credits of the account, for a service that counts them; null for one that does not.
  readonly creditsOf: ((toolkit: VoiceToolkit, options: Options) => Promise<Pick<Credits, 'used' | 'limit'> | null>) | null
}
