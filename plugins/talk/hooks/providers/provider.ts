import type { Credits, Spending, TalkLanguage, VoiceChoice } from '../../types'
import type { Capabilities } from '../engines'
import type { Chunking, SpeedRange, Synthesis, SynthesisRequest } from './synthesis'
import type { VoiceToolkit } from './toolkit'

// What a voice service brings to talk mode. Each service is one file of this folder exporting an object of this shape;
// Options are its own settings, read from the plugin's options, which its fields in plugin.json declare. It reaches the
// machine and the network through the toolkit alone.
export interface VoiceProvider<Options> {
  readonly label: string
  // The plugin option the band saves the chosen voice in.
  readonly voiceOptionField: string
  readonly speedRange: SpeedRange
  readonly chunking: Chunking
  // A voice that reads every word in its own language gets the English words of an answer respelled.
  readonly isRespellingEnglish: boolean
  // A voice named by an id nobody can read is not shown by it until the list of voices gives its name.
  readonly isVoiceNamedById: boolean
  optionsOf(toolkit: VoiceToolkit, values: Readonly<Record<string, unknown>>): Promise<Options>
  // Why this machine cannot use the service, null when it can; whether there is an audio player is checked for all.
  unavailabilityOf(options: Options, machine: Capabilities): string | null
  voiceOf(options: Options): string | null
  withVoice(options: Options, voice: string): Options
  voicesOf(toolkit: VoiceToolkit, options: Options, language: TalkLanguage): Promise<VoiceChoice[]>
  synthesize(toolkit: VoiceToolkit, request: SynthesisRequest<Options>): Promise<Synthesis>
  // What the session has cost, as the band shows it beside the engine; null for a service that costs nothing.
  costLabelOf(spending: Spending, credits: Credits | null): string | null
  // The credits of the account, for a service that counts them; null for one that does not.
  readonly creditsOf: ((toolkit: VoiceToolkit, options: Options) => Promise<Pick<Credits, 'used' | 'limit'> | null>) | null
}
