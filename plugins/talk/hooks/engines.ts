import type { EngineInterface } from 'claude-code'

import type { Credits, Spending, TalkEngineName, TalkLanguage, VoiceChoice } from '../types'
import { isLanguage } from './languages'
import { ENGINE_NAMES, PROVIDERS } from './providers'
import type { ProviderFindings, ProviderOptions } from './providers'
import type { ModelChoice } from './providers/provider'
import type { Chunking, Machine, SpeedRange, Synthesis } from './providers/synthesis'
import { textOptionOf } from './providers/synthesis'
import { voiceToolkitOf } from './providers/toolkit'

export type TalkSettings = {
  engine: TalkEngineName | 'auto'
  language: TalkLanguage
  speed: number
  // Each engine's own options, as its provider reads them.
  providers: ProviderOptions
}

export type Capabilities = {
  platform: string
  wavPlayer: readonly string[] | null
  // What each engine found on the machine.
  providers: ProviderFindings
}

export const AUTO_ENGINE_ORDER: readonly TalkEngineName[] = ENGINE_NAMES

const isEngineName = (value: string): value is TalkEngineName => ENGINE_NAMES.some(engine => engine === value)

const WAV_PLAYERS: readonly (readonly string[])[] = [
  ['afplay'],
  ['pw-play'],
  ['paplay'],
  ['aplay', '-q'],
  ['ffplay', '-nodisp', '-autoexit', '-loglevel', 'quiet'],
]

async function installedCommandsOf($: EngineInterface, commands: readonly string[]): Promise<Set<string>> {
  const { stdout } = await $.process.run(['sh', '-c', 'for c in "$@"; do command -v "$c" >/dev/null 2>&1 && echo "$c"; done', 'sh', ...commands])
  return new Set(stdout.split('\n').filter(line => line !== ''))
}

export async function settingsOf($: EngineInterface, values: Readonly<Record<string, unknown>>): Promise<TalkSettings> {
  const engine = textOptionOf(values, 'engine')
  const language = textOptionOf(values, 'language')
  const toolkit = voiceToolkitOf($)
  const optionsOf = async <Name extends TalkEngineName>(engine: Name): Promise<ProviderOptions[Name]> => PROVIDERS[engine].optionsOf(toolkit, values)
  const providers = Object.fromEntries(await Promise.all(ENGINE_NAMES.map(async engine => [engine, await optionsOf(engine)]))) as ProviderOptions
  return {
    // A value outside the lists, from a hand-edited settings file, falls back on the defaults.
    engine: isEngineName(engine) ? engine : 'auto',
    language: isLanguage(language) ? language : 'fr',
    speed: typeof values.speed === 'number' && values.speed > 0 ? values.speed : 1,
    providers,
  }
}

export async function probeCapabilities($: EngineInterface, settings: TalkSettings): Promise<Capabilities> {
  const { stdout: platform } = await $.process.run(['uname', '-s'])
  const looked = [...WAV_PLAYERS.map(player => player[0] ?? ''), ...ENGINE_NAMES.flatMap(engine => PROVIDERS[engine].commandsLookedFor)]
  const installed = await installedCommandsOf($, looked)
  const toolkit = voiceToolkitOf($)
  const foundBy = async <Name extends TalkEngineName>(engine: Name): Promise<ProviderFindings[Name]> =>
    PROVIDERS[engine].findOnMachine(toolkit, settings.providers[engine], settings.language, installed)
  const providers = Object.fromEntries(await Promise.all(ENGINE_NAMES.map(async engine => [engine, await foundBy(engine)]))) as ProviderFindings
  return { platform: platform.trim(), wavPlayer: WAV_PLAYERS.find(player => installed.has(player[0] ?? '')) ?? null, providers }
}

const machineOf = <Name extends TalkEngineName>(engine: Name, capabilities: Capabilities): Machine<ProviderFindings[Name]> => ({
  platform: capabilities.platform,
  wavPlayer: capabilities.wavPlayer,
  found: capabilities.providers[engine],
})

// Why this machine cannot use the engine; null when it can.
export const unavailabilityOf = <Name extends TalkEngineName>(engine: Name, settings: TalkSettings, capabilities: Capabilities): string | null =>
  PROVIDERS[engine].unavailabilityOf(settings.providers[engine], machineOf(engine, capabilities))

export const engineOf = (settings: TalkSettings, capabilities: Capabilities): TalkEngineName | null => {
  if (settings.engine !== 'auto') return unavailabilityOf(settings.engine, settings, capabilities) === null ? settings.engine : null
  return AUTO_ENGINE_ORDER.find(engine => unavailabilityOf(engine, settings, capabilities) === null) ?? null
}

// The engine the settings line names: the one chosen, at once, or the one auto picks once the machine is probed. Not
// the engine of the last answer read, which an engine just chosen has not read anything with yet.
export const engineShownOf = (settings: TalkSettings, found: Capabilities | null): TalkEngineName | null =>
  settings.engine !== 'auto' ? settings.engine : found === null ? null : engineOf(settings, found)

// The voice in force for the engine, as the band's list names it, from what the machine was found to have: a drawing
// runs no command.
export const currentVoiceOf = <Name extends TalkEngineName>(settings: TalkSettings, found: Capabilities | null, engine: Name | null): string | null =>
  engine === null ? null : PROVIDERS[engine].voiceOf(settings.providers[engine], found === null ? null : machineOf(engine, found))

export const withVoice = <Name extends TalkEngineName>(settings: TalkSettings, engine: Name, voice: string): TalkSettings => {
  const providers: ProviderOptions = { ...settings.providers }
  providers[engine] = PROVIDERS[engine].withVoice(settings.providers[engine], voice)
  return { ...settings, engine, providers }
}

export function voicesOf($: EngineInterface, engine: TalkEngineName, settings: TalkSettings): Promise<VoiceChoice[]> {
  const listed = <Name extends TalkEngineName>(name: Name) => PROVIDERS[name].voicesOf(voiceToolkitOf($), settings.providers[name], settings.language)
  return listed(engine)
}

// The account's credits, for an engine that counts them.
export async function creditsOf($: EngineInterface, engine: TalkEngineName, settings: TalkSettings): Promise<Pick<Credits, 'used' | 'limit'> | null> {
  const counted = async <Name extends TalkEngineName>(name: Name) => {
    const read = PROVIDERS[name].creditsOf
    return read === null ? null : read(voiceToolkitOf($), settings.providers[name])
  }
  return counted(engine)
}

export const costLabelOf = (engine: TalkEngineName | null, spending: Record<TalkEngineName, Spending>, credits: Partial<Record<TalkEngineName, Credits>>): string | null =>
  engine === null ? null : PROVIDERS[engine].costLabelOf(spending[engine], credits[engine] ?? null)

// The credits the account had used when the session first read them. The account's count starts again at a new month or
// a new plan: what the session had spent before is then kept, counted from the new count.
// Counted from 0, the new count's start, less what the session had spent before: it may be below 0.
export const usedAtStartOf = (known: Credits | undefined, used: number): number => {
  if (known === undefined) return used
  if (used >= known.usedAtStart) return known.usedAtStart
  return 0 - Math.max(0, known.used - known.usedAtStart)
}

export const chunkingOf = (engine: TalkEngineName): Chunking => PROVIDERS[engine].chunking

export const speedRangeOf = (engine: TalkEngineName | null): SpeedRange => (engine === null ? PROVIDERS.piper.speedRange : PROVIDERS[engine].speedRange)

// The speed an engine reads at: the one chosen, brought within what the engine takes.
export const effectiveSpeedOf = (engine: TalkEngineName | null, speed: number): number => {
  const { min, max } = speedRangeOf(engine)
  return Math.min(max, Math.max(min, speed))
}

type EngineSynthesisRequest = { speakableWords: readonly string[]; settings: TalkSettings; capabilities: Capabilities; outputPathWithoutExtension: string }

export function synthesize($: EngineInterface, engine: TalkEngineName, request: EngineSynthesisRequest): Promise<Synthesis> {
  const { speakableWords, settings, capabilities, outputPathWithoutExtension } = request
  const spoken = <Name extends TalkEngineName>(name: Name) =>
    PROVIDERS[name].synthesize(voiceToolkitOf($), {
      speakableWords,
      options: settings.providers[name],
      language: settings.language,
      speed: effectiveSpeedOf(name, settings.speed),
      machine: machineOf(name, capabilities),
      outputPathWithoutExtension,
    })
  return spoken(engine)
}

export const isRespellingEnglishFor = (engine: TalkEngineName): boolean => PROVIDERS[engine].isRespellingEnglish

export const isVoiceNamedByIdFor = (engine: TalkEngineName): boolean => PROVIDERS[engine].isVoiceNamedById

export const isCloudEngine = (engine: TalkEngineName): boolean => PROVIDERS[engine].kind === 'cloud'

export const voiceOptionFieldOf = (engine: TalkEngineName): string | null => PROVIDERS[engine].voiceOptionField

export const engineLabelOf = (engine: TalkEngineName): string => PROVIDERS[engine].label

export const modelChoicesOf = (engine: TalkEngineName | null): readonly ModelChoice[] => (engine === null ? [] : (PROVIDERS[engine].models?.choices ?? []))

export const modelOptionFieldOf = (engine: TalkEngineName): string | null => PROVIDERS[engine].models?.optionField ?? null

export const currentModelOf = <Name extends TalkEngineName>(settings: TalkSettings, engine: Name | null): string | null =>
  engine === null ? null : PROVIDERS[engine].modelOf(settings.providers[engine])
