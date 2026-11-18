import type { TalkEngineName } from '../../types'
import { elevenLabs } from './elevenlabs'
import { openAi } from './openai'
import { piper } from './piper'
import type { VoiceProvider } from './provider'
import { systemVoice } from './system-voice'

// Every voice service, in the order auto tries them. Its key is the engine's name, as TalkEngineName and the engine
// option of plugin.json list it.
const REGISTERED = {
  elevenlabs: elevenLabs,
  openai: openAi,
  piper,
  system: systemVoice,
} satisfies Record<TalkEngineName, VoiceProvider<any, any>>

type OptionsOf<Provider> = Provider extends VoiceProvider<infer Options, any> ? Options : never
type FoundOf<Provider> = Provider extends VoiceProvider<any, infer Found> ? Found : never

export type ProviderOptions = { [Name in TalkEngineName]: OptionsOf<(typeof REGISTERED)[Name]> }
export type ProviderFindings = { [Name in TalkEngineName]: FoundOf<(typeof REGISTERED)[Name]> }

// Typed per engine, so that the options and findings of one engine go only to its own provider.
export const PROVIDERS: { readonly [Name in TalkEngineName]: VoiceProvider<ProviderOptions[Name], ProviderFindings[Name]> } = REGISTERED

export const ENGINE_NAMES = Object.keys(REGISTERED) as readonly TalkEngineName[]
