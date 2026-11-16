import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { EngineAvailability, Installation, Reading, SpokenToken, TalkEngineName, TalkLanguage } from '../types'
import {
  AUTO_ENGINE_ORDER,
  engineLabels,
  engineOf,
  isRespellingEnglishFor,
  languageNameOf,
  probeCapabilities,
  synthesize,
  SynthesisError,
  whyUnavailable,
} from './engines'
import type { Capabilities, Synthesis, TalkSettings } from './engines'
import { InstallError, installPiper } from './piper-install'
import { speakableWordOf } from './pronunciation'
import { chunksOf, sentenceStartOf, spokenTextOf, tokensOf, wordsOf } from './spoken-text'
import { wordAtElapsedMs } from './timing'
import { renderBand } from './view/band'
import { paletteOf } from './view/theme'

const COMMAND = 'talk'
const PROMPT_SECTION_ID = 'talk:voice-conversation'
const CHUNK_MAX_CHARACTERS = 260
const KARAOKE_TICK_MS = 60
const SPEED_STEP = 0.05
const MIN_SPEED = 0.5
const MAX_SPEED = 2

const EMPTY_READING: Reading = { tokens: [], currentWordIndex: -1, phase: 'idle', engine: null, error: null }

const isActiveAtom = atom({ plugin: 'talk', key: 'isActive' } as const, false)
const readingAtom = atom({ plugin: 'talk', key: 'reading' } as const, EMPTY_READING)
const engineAvailabilityAtom = atom({ plugin: 'talk', key: 'engineAvailability' } as const, null)
const openSettingAtom = atom({ plugin: 'talk', key: 'openSetting' } as const, null)
const claudeCodeThemeAtom = atom({ plugin: 'talk', key: 'claudeCodeTheme' } as const, null)
const installationAtom = atom({ plugin: 'talk', key: 'installation' } as const, null)

const SUBCOMMANDS = ['on', 'off', 'stop', 'replay', 'status', 'test', 'setup'] as const
type Subcommand = (typeof SUBCOMMANDS)[number]

const TEST_SENTENCES: Readonly<Record<TalkLanguage, string>> = {
  fr: "Bonjour ! On teste la voix du mode conversation. Le repository est sur GitHub, et la méthode findByUserId lit la table user_subscriptions.",
  en: "Hello! This is a test of the talk mode voice. The repository is on GitHub, and the findByUserId method reads the user_subscriptions table.",
  es: "¡Hola! Esto es una prueba de la voz del modo conversación. El repositorio está en GitHub.",
  de: "Hallo! Das ist ein Test der Stimme des Gesprächsmodus. Das Repository liegt auf GitHub.",
  it: "Ciao! Questa è una prova della voce della modalità conversazione. Il repository è su GitHub.",
}

const voiceConversationInstructions = (language: TalkLanguage): string => `# Talk mode

Talk mode is on: the person is talking things through with you by voice, usually to brainstorm. They dictate their messages, and your final answer of each turn is read aloud to them by a speech synthesizer while a band above their prompt highlights each word. Write every final answer to be heard, in ${languageNameOf(language)}:

- Talk like a colleague thinking out loud with them: short answers, two to six sentences, one idea at a time. When you need their view, end on one question, not several.
- Plain spoken sentences only: no headings, tables, bullet lists, bold, emoji or links. Spell out what a symbol would say.
- Name code (a method, a table, a class) only when the name matters; otherwise say what it does.
- Anything that must be read rather than heard (code, a command, a path, a long list) goes in a fenced code block: it is shown on screen and never spoken, so the sentences around it must make sense without it.
- Their messages come from dictation: read misheard technical words for what they sound like.
- Tool calls and work go on as usual; only the final answer is spoken, so keep it to what they need to hear.`

async function settingsOf($: EngineInterface, options: Readonly<Record<string, unknown>>): Promise<TalkSettings> {
  const text = (name: string): string => (typeof options[name] === 'string' ? (options[name] as string) : '')
  const speed = typeof options.speed === 'number' && options.speed > 0 ? options.speed : 1
  return {
    engine: (text('engine') || 'auto') as TalkEngineName | 'auto',
    language: (text('language') || 'fr') as TalkLanguage,
    speed,
    openai: { apiKey: text('openaiApiKey') || ((await $.env.get('OPENAI_API_KEY')) ?? ''), model: text('openaiModel'), voice: text('openaiVoice') },
    elevenlabs: {
      apiKey: text('elevenlabsApiKey') || ((await $.env.get('ELEVENLABS_API_KEY')) ?? ''),
      model: text('elevenlabsModel'),
      voiceId: text('elevenlabsVoiceId'),
    },
    piper: { command: text('piperCommand'), voice: text('piperVoice') },
  }
}

// The session's sound, kept by the module: a reload drops it with the player it started.
let pluginOptions: Readonly<Record<string, unknown>> = {}
let capabilities: Capabilities | null = null
let audioDirectory: string | null = null
let readingGeneration = 0
let stopPlayback: (() => void) | null = null
// The installation of the local voice under way, which a reading waits for.
let piperInstallation: Promise<void> | null = null

async function capabilitiesOf($: EngineInterface, settings: TalkSettings): Promise<Capabilities> {
  capabilities ??= await probeCapabilities($, settings)
  return capabilities
}

async function audioDirectoryOf($: EngineInterface): Promise<string> {
  if (audioDirectory !== null) return audioDirectory
  const { stdout } = await $.process.run(['mktemp', '-d', '-t', 'claude-talk.XXXXXX'])
  audioDirectory = stdout.trim()
  return audioDirectory
}

function setReading($: EngineInterface, change: (reading: Reading) => Reading) {
  return update($, readingAtom, reading => change(reading ?? EMPTY_READING))
}

const silence = () => {
  readingGeneration++
  stopPlayback?.()
  stopPlayback = null
}

async function play($: EngineInterface, synthesis: Synthesis, firstWordIndex: number, generation: number) {
  const startedAt = await $.clock.now()
  let shownWordIndex = -1
  const ticker = $.clock.every(KARAOKE_TICK_MS, () => {
    void (async () => {
      const wordIndex = wordAtElapsedMs(synthesis.wordStartsMs, (await $.clock.now()) - startedAt)
      if (wordIndex < 0 || wordIndex === shownWordIndex || generation !== readingGeneration) return
      shownWordIndex = wordIndex
      await setReading($, reading => ({ ...reading, currentWordIndex: firstWordIndex + wordIndex }))
    })()
  })
  const player = $.process.spawn({ argv: synthesis.playback })
  stopPlayback = () => void player.return(undefined as never)
  try {
    for await (const _chunk of player) {
      // The player writes nothing worth reading; the loop lasts as long as the sound.
    }
  } finally {
    ticker.cancel()
  }
}

async function speak($: EngineInterface, answer: string) {
  await readTokens($, tokensOf(spokenTextOf(answer)), 0)
}

// Reads the words from fromWordIndex on, the ones before it shown as already spoken.
async function readTokens($: EngineInterface, tokens: SpokenToken[], fromWordIndex: number) {
  silence()
  const generation = readingGeneration
  const words = wordsOf(tokens)
  if (words.length <= fromWordIndex) return
  await setReading($, () => ({ tokens, currentWordIndex: fromWordIndex - 1, phase: 'synthesizing', engine: null, error: null }))
  if (piperInstallation !== null) await piperInstallation
  if (generation !== readingGeneration) return
  const settings = await settingsOf($, pluginOptions)
  const found = await capabilitiesOf($, settings)
  const engine = engineOf(settings, found)
  if (generation !== readingGeneration) return
  if (engine === null) {
    const wanted = settings.engine === 'auto' ? AUTO_ENGINE_ORDER : [settings.engine]
    const error = `No voice available: ${wanted.map(name => `${engineLabels[name]}: ${whyUnavailable(name, found)}`).join('; ')}`
    await setReading($, reading => ({ ...reading, phase: 'failed', error }))
    return
  }
  await setReading($, reading => ({ ...reading, engine }))
  const directory = await audioDirectoryOf($)
  const isRespellingEnglish = isRespellingEnglishFor(engine)
  const chunks = chunksOf(words.slice(fromWordIndex), CHUNK_MAX_CHARACTERS)
  const firstWordIndexes = chunks.map((_, index) => fromWordIndex + chunks.slice(0, index).reduce((count, chunk) => count + chunk.length, 0))
  const synthesisOf = (index: number): Promise<Synthesis> =>
    synthesize($, engine, {
      speakableWords: (chunks[index] ?? []).map(word => speakableWordOf(word, settings.language, isRespellingEnglish)),
      settings,
      capabilities: found,
      outputPathWithoutExtension: `${directory}/answer-${generation}-${index}`,
    })

  try {
    let pending = synthesisOf(0)
    for (const [index, firstWordIndex] of firstWordIndexes.entries()) {
      const synthesis = await pending
      if (generation !== readingGeneration) return
      if (index + 1 < chunks.length) {
        pending = synthesisOf(index + 1)
        pending.catch(() => undefined)
      }
      await setReading($, reading => ({ ...reading, phase: 'speaking' }))
      await play($, synthesis, firstWordIndex, generation)
      if (generation !== readingGeneration) return
    }
    await setReading($, reading => ({ ...reading, phase: 'done', currentWordIndex: words.length }))
  } catch (error) {
    if (generation !== readingGeneration) return
    const message = error instanceof SynthesisError ? error.message : `The voice failed: ${String(error)}`
    await setReading($, reading => ({ ...reading, phase: 'failed', error: message }))
  }
}

async function replay($: EngineInterface) {
  const reading = await read($, readingAtom)
  await readTokens($, reading.tokens, 0)
}

async function refreshEngineAvailability($: EngineInterface): Promise<void> {
  const settings = await settingsOf($, pluginOptions)
  capabilities = null
  const found = await capabilitiesOf($, settings)
  const reasonOf = (engine: TalkEngineName): string | null => (engineOf({ ...settings, engine }, found) === null ? whyUnavailable(engine, found) : null)
  const availability: EngineAvailability = {
    elevenlabs: reasonOf('elevenlabs'),
    openai: reasonOf('openai'),
    piper: reasonOf('piper'),
    system: reasonOf('system'),
  }
  await update($, engineAvailabilityAtom, () => availability)
}

// The band changes the mode's options as /config does: the setting is saved and the mod reloads with it.
async function setOption($: EngineInterface, field: 'engine' | 'language' | 'speed', value: string | number): Promise<void> {
  const rows = await $.config.list()
  const row = rows.find(candidate => candidate.key === `talk.${field}` || (candidate.key.startsWith('talk') && candidate.key.endsWith(`.${field}`)))
  if (row === undefined) {
    $.ui.toast(`talk: the ${field} option is not in /config`)
    return
  }
  const result = await $.config.set({ key: row.key, value })
  if ('deny' in result && result.deny !== undefined) $.ui.toast(`talk: ${result.deny}`)
}

async function changeSpeed($: EngineInterface, steps: number): Promise<void> {
  const settings = await settingsOf($, pluginOptions)
  const speed = Math.round(Math.min(MAX_SPEED, Math.max(MIN_SPEED, settings.speed + steps * SPEED_STEP)) * 100) / 100
  if (speed !== settings.speed) await setOption($, 'speed', speed)
}

async function readClaudeCodeTheme($: EngineInterface): Promise<void> {
  const rows = await $.config.list().catch(() => [])
  const theme = rows.find(row => row.key === 'theme')?.value
  await update($, claudeCodeThemeAtom, () => (typeof theme === 'string' ? theme : null))
}

// With no cloud voice to use, a natural voice is one install away: the local voice is set up unless the person
// chose another engine, named their own Piper, or turned the automatic install off.
async function shouldInstallPiper($: EngineInterface, settings: TalkSettings): Promise<boolean> {
  if (pluginOptions.autoInstall === false || settings.piper.command !== '' || settings.piper.voice !== '') return false
  const found = await capabilitiesOf($, settings)
  const isLocalVoiceComplete = found.piper !== null && found.piper.python !== null
  switch (settings.engine) {
    case 'elevenlabs':
    case 'openai':
    case 'system':
      return false
    case 'piper':
      return !isLocalVoiceComplete
    case 'auto': {
      const hasCloudVoice = engineOf({ ...settings, engine: 'elevenlabs' }, found) !== null || engineOf({ ...settings, engine: 'openai' }, found) !== null
      return !hasCloudVoice && !isLocalVoiceComplete
    }
  }
}

function setInstallation($: EngineInterface, installation: Installation | null) {
  return update($, installationAtom, () => installation)
}

async function setUpLocalVoice($: EngineInterface, isAsked: boolean): Promise<void> {
  if (piperInstallation !== null) return piperInstallation
  const settings = await settingsOf($, pluginOptions)
  if (!isAsked && !(await shouldInstallPiper($, settings))) return
  const home = (await $.env.get('HOME')) ?? ''
  piperInstallation = (async () => {
    try {
      await installPiper($, home, settings.language, async message => {
        await setInstallation($, { status: 'running', message })
      })
      await setInstallation($, null)
    } catch (error) {
      await setInstallation($, { status: 'failed', message: error instanceof InstallError ? error.message : String(error) })
    } finally {
      capabilities = null
      await refreshEngineAvailability($)
      piperInstallation = null
    }
  })()
  return piperInstallation
}

async function stop($: EngineInterface) {
  silence()
  await setReading($, reading => (reading.phase === 'synthesizing' || reading.phase === 'speaking' ? { ...reading, phase: 'stopped' } : reading))
}

async function turnOn($: EngineInterface): Promise<string> {
  await update($, isActiveAtom, () => true)
  await update($, readingAtom, () => EMPTY_READING)
  void setUpLocalVoice($, false)
  const settings = await settingsOf($, pluginOptions)
  await refreshEngineAvailability($)
  const engine = engineOf(settings, await capabilitiesOf($, settings))
  const voice = engine === null ? 'no voice is available, see /talk status' : `${engineLabels[engine]} reads the answers`
  return `Talk mode on (${languageNameOf(settings.language)}): ${voice}. Dictate with the voice key (hold space), /talk off to stop.`
}

async function turnOff($: EngineInterface): Promise<string> {
  await stop($)
  await update($, isActiveAtom, () => false)
  return 'Talk mode off.'
}

async function statusOf($: EngineInterface): Promise<string> {
  const settings = await settingsOf($, pluginOptions)
  capabilities = null
  const found = await capabilitiesOf($, settings)
  const engine = engineOf(settings, found)
  const lines = [
    `Platform: ${found.platform}; audio player: ${found.wavPlayer?.[0] ?? 'none'}`,
    ...AUTO_ENGINE_ORDER.map(name => {
      const isAvailable = engineOf({ ...settings, engine: name }, found) !== null
      return `${engineLabels[name]}: ${isAvailable ? 'available' : whyUnavailable(name, found)}`
    }),
    `Engine setting: ${settings.engine}; speaking now: ${engine === null ? 'none' : engineLabels[engine]}; language: ${settings.language}`,
  ]
  return lines.join('\n')
}

const subcommandOf = (args: string): Subcommand | null => {
  const word = args.trim().split(/\s+/)[0] || 'on'
  return SUBCOMMANDS.find(subcommand => subcommand === word) ?? null
}

export const register: Register = (on, options) => {
  pluginOptions = options

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Voice conversation: Claude answers aloud, word by word above the prompt',
      argumentHint: '[on|off|stop|replay|status|test|setup]',
      immediate: true,
    })
    await readClaudeCodeTheme($)
    // A reload (an option changed, or the mod's own files) ends the player of the module it replaces: the reading goes
    // on from the sentence it was in, with the options now in force.
    const interrupted = await read($, readingAtom)
    if (interrupted.phase === 'synthesizing' || interrupted.phase === 'speaking') {
      const fromWordIndex = sentenceStartOf(wordsOf(interrupted.tokens), Math.max(0, interrupted.currentWordIndex))
      void readTokens($, interrupted.tokens, fromWordIndex)
    }
    if (await read($, isActiveAtom)) {
      void refreshEngineAvailability($)
      void setUpLocalVoice($, false)
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    silence()
    if (audioDirectory !== null) await $.process.run(['rm', '-rf', audioDirectory])
    return next(e)
  })

  on('config.set', async ($, e, next) => {
    const result = await next(e)
    if (e.key === 'theme') await readClaudeCodeTheme($)
    return result
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const subcommand = subcommandOf(e.args)
    switch (subcommand) {
      case 'on':
        return { text: await turnOn($) }
      case 'off':
        return { text: await turnOff($) }
      case 'stop':
        await stop($)
        return { text: 'Stopped reading.' }
      case 'replay':
        void replay($)
        return { text: 'Reading the last answer again.' }
      case 'setup':
        void setUpLocalVoice($, true)
        return { text: 'Installing the local voice (Piper) under ~/.local/share/piper: the band follows its steps.' }
      case 'status':
        return { text: await statusOf($) }
      case 'test': {
        const settings = await settingsOf($, pluginOptions)
        void speak($, TEST_SENTENCES[settings.language])
        return { text: 'Reading a test sentence.' }
      }
      case null:
        return { text: `Unknown argument: ${e.args.trim()}. Use one of ${SUBCOMMANDS.join(', ')}.` }
    }
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!(await read($, isActiveAtom))) return composed
    const settings = await settingsOf($, pluginOptions)
    return { sections: [...composed.sections, { id: PROMPT_SECTION_ID, text: voiceConversationInstructions(settings.language), scope: 'session' }] }
  })

  // Only what the person sends cuts the voice: Claude Code also starts turns of its own, right after a command runs.
  on('prompt.submit', async ($, e, next) => {
    if (e.isMeta === undefined) await stop($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    if (e.agentId === undefined && e.reason === 'answer' && (await read($, isActiveAtom))) {
      // Saved before the hook returns: a reload at the end of the turn reads it from there.
      const tokens = tokensOf(spokenTextOf(e.answer))
      if (tokens.length > 0) {
        await setReading($, () => ({ tokens, currentWordIndex: -1, phase: 'synthesizing', engine: null, error: null }))
        void readTokens($, tokens, 0)
      }
    }
    return completed
  })

  // The person starting to type or dictate takes the floor, as in a conversation.
  on('prompt.change', async ($, e, next) => {
    if (e.origin.kind !== 'plugin' && e.text.trim() !== '' && stopPlayback !== null) await stop($)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const reading = await read($, readingAtom)
    const isSounding = reading.phase === 'synthesizing' || reading.phase === 'speaking'
    if (e.props.hasSurvey || !((await read($, isActiveAtom)) || isSounding)) return next(e)
    const settings = await settingsOf($, pluginOptions)
    return renderBand($, e, {
      reading,
      openSetting: await read($, openSettingAtom),
      installation: await read($, installationAtom),
      engineAvailability: await read($, engineAvailabilityAtom),
      engineSetting: settings.engine,
      language: settings.language,
      speed: settings.speed,
      palette: paletteOf(await read($, claudeCodeThemeAtom)),
    }, {
      stop: () => void stop($),
      replay: () => void replay($),
      turnOff: () => void turnOff($),
      selectEngine: engine => void setOption($, 'engine', engine),
      selectLanguage: language => void setOption($, 'language', language),
      selectSpeed: speed => void setOption($, 'speed', speed),
      slower: () => void changeSpeed($, -1),
      faster: () => void changeSpeed($, 1),
      toggleSetting: setting => void update($, openSettingAtom, open => (open === setting ? null : setting)),
    })
  })
}
