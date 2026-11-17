import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Credits, EngineAvailability, Spending, Installation, Reading, SettingName, SpokenToken, TalkEngineName, TalkLanguage, VoiceCatalog, VoiceChoice, VoiceFilter } from '../types'
import {
  AUTO_ENGINE_ORDER,
  chunkingOf,
  engineLabels,
  engineOf,
  effectiveSpeedOf,
  engineShownOf,
  isRespellingEnglishFor,
  languageNameOf,
  probeCapabilities,
  synthesize,
  whyUnavailable,
} from './engines'
import type { Capabilities, TalkSettings } from './engines'
import { InstallError, installPiper, piperHomeOf } from './piper-install'
import { elevenLabs } from './providers/elevenlabs'
import { SynthesisError } from './providers/synthesis'
import { voiceToolkitOf } from './providers/toolkit'
import type { Synthesis } from './providers/synthesis'
import { speakableWordOf } from './pronunciation'
import { chunksOf, sentenceStartOf, spokenTextOf, tokensOf, wordsOf } from './spoken-text'
import { wordAtElapsedMs } from './timing'
import { downloadPiperVoice, openAiChoices, piperCatalogOf, piperChoicesOf, SAMPLE_SENTENCES } from './voices'
import { renderBand, renderStartLine } from './view/band'
import { paletteOf } from './view/theme'

const COMMAND = 'talk'
const PROMPT_SECTION_ID = 'talk:voice-conversation'
const KARAOKE_TICK_MS = 60
const DOWNLOAD_PROGRESS_TICK_MS = 300
const ANIMATION_TICK_MS = 150
const SPEED_STEP = 0.05

const EMPTY_READING: Reading = { tokens: [], currentWordIndex: -1, phase: 'idle', engine: null, error: null }

const isActiveAtom = atom({ plugin: 'talk', key: 'isActive' } as const, false)
const readingAtom = atom({ plugin: 'talk', key: 'reading' } as const, EMPTY_READING)
const engineAvailabilityAtom = atom({ plugin: 'talk', key: 'engineAvailability' } as const, null)
const openSettingAtom = atom({ plugin: 'talk', key: 'openSetting' } as const, null)
const pendingChoiceAtom = atom({ plugin: 'talk', key: 'pendingChoice' } as const, null)
const claudeCodeThemeAtom = atom({ plugin: 'talk', key: 'claudeCodeTheme' } as const, null)
const installationAtom = atom({ plugin: 'talk', key: 'installation' } as const, null)
const voiceCatalogAtom = atom({ plugin: 'talk', key: 'voiceCatalog' } as const, null)
const previewingVoiceAtom = atom({ plugin: 'talk', key: 'previewingVoice' } as const, null)
const voiceDownloadAtom = atom({ plugin: 'talk', key: 'voiceDownload' } as const, null)
const voiceFilterAtom = atom({ plugin: 'talk', key: 'voiceFilter' } as const, 'all')
const NOTHING_SPENT: Record<TalkEngineName, Spending> = {
  elevenlabs: { characters: 0, audioSeconds: 0 },
  openai: { characters: 0, audioSeconds: 0 },
  piper: { characters: 0, audioSeconds: 0 },
  system: { characters: 0, audioSeconds: 0 },
}
const spendingAtom = atom({ plugin: 'talk', key: 'spending' } as const, NOTHING_SPENT)
const creditsAtom = atom({ plugin: 'talk', key: 'credits' } as const, {})
const isAwaitingAnswerAtom = atom({ plugin: 'talk', key: 'isAwaitingAnswer' } as const, false)
const animationFrameAtom = atom({ plugin: 'talk', key: 'animationFrame' } as const, 0)

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

Talk mode is on: the person is talking things through with you by voice, usually to brainstorm. They dictate their messages, and your final answer of each turn is read aloud to them by a speech synthesizer while a band above their prompt highlights each word. Write every final answer to be heard, in ${languageNameOf(language)}, the language the voice speaks, whatever language the person writes in or any other instruction asks for:

- Talk like a colleague thinking out loud with them: short answers, two to six sentences, one idea at a time. When you need their view, end on one question, not several.
- Plain spoken sentences only: no headings, tables, bullet lists, bold, emoji or links. Spell out what a symbol would say.
- Name code (a method, a table, a class) only when the name matters; otherwise say what it does.
- Anything that must be read rather than heard (code, a command, a path, a long list) goes in a fenced code block: it is shown on screen and never spoken, so the sentences around it must make sense without it.
- Sources and links go last, as a list of markdown links: they are shown and never spoken, so never name a URL or a source's title in a sentence.
- Their messages come from dictation: read misheard technical words for what they sound like.
- Tool calls and work go on as usual; only the final answer is spoken, so keep it to what they need to hear.`

const spokenLanguageNoteOf = (language: TalkLanguage): string =>
  `Talk mode: answer in ${languageNameOf(language)}, the language the voice speaks, whatever language this message or any setting asks for.`

async function settingsOf($: EngineInterface, options: Readonly<Record<string, unknown>>): Promise<TalkSettings> {
  const text = (name: string): string => (typeof options[name] === 'string' ? (options[name] as string) : '')
  const speed = typeof options.speed === 'number' && options.speed > 0 ? options.speed : 1
  return {
    engine: (text('engine') || 'auto') as TalkEngineName | 'auto',
    language: (text('language') || 'fr') as TalkLanguage,
    speed,
    openai: { apiKey: text('openaiApiKey') || ((await $.env.get('OPENAI_API_KEY')) ?? ''), model: text('openaiModel'), voice: text('openaiVoice') },
    elevenlabs: await elevenLabs.optionsOf(voiceToolkitOf($), options),
    piper: { command: text('piperCommand'), voice: text('piperVoice'), voiceName: text('piperVoiceName') },
  }
}

// The session's sound, kept by the module: a reload drops it with the player it started.
let pluginOptions: Readonly<Record<string, unknown>> = {}
let capabilities: Capabilities | null = null
let audioDirectory: string | null = null
let readingGeneration = 0
let stopPlayback: (() => void) | null = null
// The word Claude Code's spinner draws for the turn under way, which the band says too; null between turns.
let spinnerWord: string | null = null
// The animation of a wait, running only while there is one.
let animation: { cancel: () => void } | null = null
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

async function setReading($: EngineInterface, change: (reading: Reading) => Reading) {
  await update($, readingAtom, reading => change(reading ?? EMPTY_READING))
  await syncAnimation($)
}

// The band animates two waits: for Claude's answer, then for the voice that reads it.
async function syncAnimation($: EngineInterface): Promise<void> {
  const isWaiting = (await read($, isAwaitingAnswerAtom)) || (await read($, readingAtom)).phase === 'synthesizing'
  if (isWaiting && animation === null) {
    animation = $.clock.every(ANIMATION_TICK_MS, () => {
      void update($, animationFrameAtom, frame => (frame ?? 0) + 1)
    })
  }
  if (!isWaiting && animation !== null) {
    animation.cancel()
    animation = null
  }
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
// A voice other than the one in force, as a sample of it is read with.
type ForcedVoice = { settings: TalkSettings; capabilities: Capabilities; engine: TalkEngineName }

async function readTokens($: EngineInterface, tokens: SpokenToken[], fromWordIndex: number, forced: ForcedVoice | null = null) {
  silence()
  const generation = readingGeneration
  const words = wordsOf(tokens)
  if (words.length <= fromWordIndex) return
  await setReading($, () => ({ tokens, currentWordIndex: fromWordIndex - 1, phase: 'synthesizing', engine: null, error: null }))
  if (piperInstallation !== null) await piperInstallation
  if (generation !== readingGeneration) return
  const settings = forced?.settings ?? (await settingsOf($, pluginOptions))
  const found = forced?.capabilities ?? (await capabilitiesOf($, settings))
  const engine = forced?.engine ?? engineOf(settings, found)
  if (generation !== readingGeneration) return
  if (engine === null) {
    const wanted = settings.engine === 'auto' ? AUTO_ENGINE_ORDER : [settings.engine]
    const error = `No voice available: ${wanted.map(name => `${engineLabels[name]}: ${whyUnavailable(name, settings, found)}`).join('; ')}`
    await setReading($, reading => ({ ...reading, phase: 'failed', error }))
    return
  }
  await setReading($, reading => ({ ...reading, engine }))
  const directory = await audioDirectoryOf($)
  const isRespellingEnglish = isRespellingEnglishFor(engine)
  const { maxCharacters, isFirstSentenceAlone } = chunkingOf(engine)
  const chunks = chunksOf(words.slice(fromWordIndex), maxCharacters, isFirstSentenceAlone)
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
      await recordSpending($, engine, (chunks[index] ?? []).join(' ').length, synthesis.durationMs / 1000)
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
    void refreshCredits($, engine)
  } catch (error) {
    if (generation !== readingGeneration) return
    const message = error instanceof SynthesisError ? error.message : `The voice failed: ${String(error)}`
    await setReading($, reading => ({ ...reading, phase: 'failed', error: message }))
  }
}

// What the conversation spends on its voices, a piece of voice at a time.
async function recordSpending($: EngineInterface, engine: TalkEngineName, characters: number, audioSeconds: number): Promise<void> {
  await update($, spendingAtom, (spending): Record<TalkEngineName, Spending> => {
    const all = spending ?? NOTHING_SPENT
    return { ...all, [engine]: { characters: all[engine].characters + characters, audioSeconds: all[engine].audioSeconds + audioSeconds } }
  })
}

// The account's credits as the engine's API tells them, for an engine that counts them; those used when the session
// first read them are kept, to count what it spent since.
async function refreshCredits($: EngineInterface, engine: TalkEngineName | null): Promise<void> {
  const settings = await settingsOf($, pluginOptions)
  const creditsOf = async () => {
    switch (engine) {
      case 'elevenlabs':
        return elevenLabs.creditsOf?.(voiceToolkitOf($), settings.elevenlabs) ?? null
      case 'openai':
      case 'piper':
      case 'system':
      case null:
        return null
    }
  }
  const credits = await creditsOf().catch(() => null)
  if (engine === null || credits === null) return
  await update($, creditsAtom, (known): Partial<Record<TalkEngineName, Credits>> => ({
    ...known,
    [engine]: { ...credits, usedAtStart: known?.[engine]?.usedAtStart ?? credits.used },
  }))
}

async function replay($: EngineInterface) {
  const reading = await read($, readingAtom)
  await readTokens($, reading.tokens, 0)
}

async function refreshEngineAvailability($: EngineInterface): Promise<void> {
  const settings = await settingsOf($, pluginOptions)
  capabilities = null
  const found = await capabilitiesOf($, settings)
  const reasonOf = (engine: TalkEngineName): string | null => (engineOf({ ...settings, engine }, found) === null ? whyUnavailable(engine, settings, found) : null)
  const availability: EngineAvailability = {
    elevenlabs: reasonOf('elevenlabs'),
    openai: reasonOf('openai'),
    piper: reasonOf('piper'),
    system: reasonOf('system'),
  }
  await update($, engineAvailabilityAtom, () => availability)
  // A cloud voice is named by an id: its list is read now, so that the settings line can show its name.
  const engine = engineOf(settings, found)
  if ((engine === 'elevenlabs' || engine === 'openai') && (await read($, voiceCatalogAtom)) === null) void loadVoiceCatalog($)
}

// The band changes the mode's options as /config does: the setting is saved and the mod reloads with it.
async function setOption($: EngineInterface, field: string, value: string | number): Promise<void> {
  const rows = await $.config.list()
  const row = rows.find(candidate => candidate.key === `talk.${field}` || (candidate.key.startsWith('talk') && candidate.key.endsWith(`.${field}`)))
  if (row === undefined) {
    $.ui.toast(`talk: the ${field} option is not in /config`)
    return
  }
  const result = await $.config.set({ key: row.key, value })
  if ('deny' in result && result.deny !== undefined) $.ui.toast(`talk: ${result.deny}`)
}

// A choice in the open setting waits for Apply; the fine speed steps move from the speed chosen so far.
async function choose($: EngineInterface, value: string): Promise<void> {
  await update($, pendingChoiceAtom, () => value)
}

async function changeSpeed($: EngineInterface, steps: number): Promise<void> {
  const pending = await read($, pendingChoiceAtom)
  const settings = await settingsOf($, pluginOptions)
  const engine = engineShownOf(settings, capabilities)
  const from = pending === null ? effectiveSpeedOf(engine, settings.speed) : Number(pending)
  const speed = Math.round(effectiveSpeedOf(engine, from + steps * SPEED_STEP) * 100) / 100
  await choose($, speed.toFixed(2))
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

async function engineInUseOf($: EngineInterface, settings: TalkSettings): Promise<TalkEngineName | null> {
  return engineOf(settings, await capabilitiesOf($, settings))
}

// The voice in force for the engine, as the band's list names it, from what the machine was found to have: a drawing
// runs no command.
const currentVoiceOf = (settings: TalkSettings, found: Capabilities | null, engine: TalkEngineName | null): string | null => {
  switch (engine) {
    case 'elevenlabs':
      return elevenLabs.voiceOf(settings.elevenlabs)
    case 'openai':
      return settings.openai.voice
    case 'piper': {
      const piper = found?.piper ?? null
      if (piper === null) return null
      if (settings.piper.voiceName !== '' && piper.voice.endsWith(`/${settings.piper.voiceName.split('#')[0]}.onnx`)) return settings.piper.voiceName
      return piper.voice.slice(piper.voice.lastIndexOf('/') + 1).replace(/\.onnx$/, '')
    }
    case 'system':
    case null:
      return null
  }
}

async function piperVoicesDirectoryOf($: EngineInterface): Promise<string> {
  return `${piperHomeOf((await $.env.get('HOME')) ?? '')}/voices`
}

async function loadVoiceCatalog($: EngineInterface): Promise<void> {
  const settings = await settingsOf($, pluginOptions)
  const engine = await engineInUseOf($, settings)
  if (engine === null) {
    await update($, voiceCatalogAtom, () => null)
    return
  }
  await update($, voiceCatalogAtom, (): VoiceCatalog => ({ engine, status: 'loading' }))
  try {
    const choicesOf = async (): Promise<VoiceChoice[]> => {
      switch (engine) {
        case 'piper':
          return piperChoicesOf(await piperCatalogOf($), settings.language)
        case 'openai':
          return [...openAiChoices]
        case 'elevenlabs':
          return elevenLabs.voicesOf(voiceToolkitOf($), settings.elevenlabs, settings.language)
        case 'system':
          return []
      }
    }
    const choices = await choicesOf()
    const directory = await piperVoicesDirectoryOf($)
    const downloaded = (await $.fs.exists(directory)) ? (await $.fs.list(directory)).map(entry => entry.name.replace(/\.onnx$/, '')) : []
    await update($, voiceCatalogAtom, (): VoiceCatalog => ({ engine, status: 'ready', choices, downloaded }))
  } catch (error) {
    await update($, voiceCatalogAtom, (): VoiceCatalog => ({ engine, status: 'failed', error: error instanceof Error ? error.message : String(error) }))
  }
}

// A Piper voice is downloaded the first time it is heard or chosen.
async function ensurePiperVoice($: EngineInterface, choice: VoiceChoice): Promise<void> {
  if (choice.download === null) return
  const directory = await piperVoicesDirectoryOf($)
  const key = choice.download.slice(choice.download.lastIndexOf('/') + 1)
  if (await $.fs.exists(`${directory}/${key}.onnx`)) return
  const download = choice.download
  await update($, voiceDownloadAtom, () => ({ download, label: choice.label, receivedBytes: 0, totalBytes: choice.sizeBytes }))
  // The model is written under a temporary name while it comes: its size so far is the progress.
  const partialModel = `${directory}/${key}.onnx.part`
  const progress = $.clock.every(DOWNLOAD_PROGRESS_TICK_MS, () => {
    void (async () => {
      if (!(await $.fs.exists(partialModel))) return
      const { size } = await $.fs.stat(partialModel)
      await update($, voiceDownloadAtom, current => (current === null ? null : { ...current, receivedBytes: size }))
    })()
  })
  try {
    await downloadPiperVoice($, directory, download)
  } finally {
    progress.cancel()
    await update($, voiceDownloadAtom, () => null)
  }
  await update($, voiceCatalogAtom, catalog => (catalog?.status === 'ready' ? { ...catalog, downloaded: [...catalog.downloaded, key] } : catalog))
}

function withVoice(settings: TalkSettings, engine: TalkEngineName, value: string): TalkSettings {
  switch (engine) {
    case 'elevenlabs':
      return { ...settings, engine, elevenlabs: elevenLabs.withVoice(settings.elevenlabs, value) }
    case 'openai':
      return { ...settings, engine, openai: { ...settings.openai, voice: value } }
    case 'piper':
      return { ...settings, engine, piper: { ...settings.piper, voice: '', voiceName: value } }
    case 'system':
      return { ...settings, engine }
  }
}

// Reads the same sample sentence with one voice of the list, so that voices can be compared.
const textOfTokens = (tokens: readonly SpokenToken[]): string => tokens.map(token => token.text).join('')

async function previewVoice($: EngineInterface, choice: VoiceChoice): Promise<void> {
  const catalog = await read($, voiceCatalogAtom)
  if (catalog === null) return
  silence()
  // The sample takes the band while it is heard; the answer it stood in for comes back after, for replay and as the
  // previous answer.
  const answerBefore = await read($, readingAtom)
  await update($, previewingVoiceAtom, () => choice.value)
  try {
    await ensurePiperVoice($, choice)
    const settings = withVoice(await settingsOf($, pluginOptions), catalog.engine, choice.value)
    const capabilitiesWithVoice = await probeCapabilities($, settings)
    const sampleTokens = tokensOf(SAMPLE_SENTENCES[settings.language])
    await readTokens($, sampleTokens, 0, { settings, capabilities: capabilitiesWithVoice, engine: catalog.engine })
    const reading = await read($, readingAtom)
    if (reading.tokens === sampleTokens || textOfTokens(reading.tokens) === textOfTokens(sampleTokens)) {
      const isAnswer = answerBefore.tokens.length > 0
      await setReading($, () => ({ ...answerBefore, phase: isAnswer ? 'done' : 'idle', currentWordIndex: isAnswer ? wordsOf(answerBefore.tokens).length : -1, error: null }))
    }
  } catch (error) {
    await setReading($, reading => ({ ...reading, phase: 'failed', error: error instanceof Error ? error.message : String(error) }))
  } finally {
    await update($, previewingVoiceAtom, () => null)
  }
}

async function selectVoice($: EngineInterface, choice: VoiceChoice, beforeSaving: () => Promise<void>): Promise<void> {
  const catalog = await read($, voiceCatalogAtom)
  if (catalog === null) return
  switch (catalog.engine) {
    case 'piper':
      await update($, previewingVoiceAtom, () => choice.value)
      try {
        await ensurePiperVoice($, choice)
      } finally {
        await update($, previewingVoiceAtom, () => null)
      }
      await beforeSaving()
      await setOption($, 'piperVoiceName', choice.value)
      return
    case 'openai':
      await beforeSaving()
      await setOption($, 'openaiVoice', choice.value)
      return
    case 'elevenlabs':
      await beforeSaving()
      await setOption($, elevenLabs.voiceOptionField, choice.value)
      return
    case 'system':
      await beforeSaving()
      return
  }
}

// While a setting is open, the others wait: its own item closes it, as Cancel does.
async function toggleSetting($: EngineInterface, setting: SettingName): Promise<void> {
  const open = await read($, openSettingAtom)
  if (open !== null) {
    if (open === setting) await closeSetting($)
    return
  }
  await update($, pendingChoiceAtom, () => null)
  await update($, openSettingAtom, () => setting)
  if (setting === 'voice') await loadVoiceCatalog($)
}

async function closeSetting($: EngineInterface): Promise<void> {
  await update($, openSettingAtom, () => null)
  await update($, pendingChoiceAtom, () => null)
}

// Saves the choice made in the open setting and closes it; the save reloads the mod with it.
async function applySetting($: EngineInterface): Promise<void> {
  const open = await read($, openSettingAtom)
  const pending = await read($, pendingChoiceAtom)
  if (open === null || pending === null) {
    await closeSetting($)
    return
  }
  switch (open) {
    case 'engine':
      await closeSetting($)
      await setOption($, 'engine', pending)
      return
    case 'language':
      await closeSetting($)
      await setOption($, 'language', pending)
      return
    case 'speed':
      await closeSetting($)
      await setOption($, 'speed', Number(pending))
      return
    case 'voice': {
      const catalog = await read($, voiceCatalogAtom)
      const choice = catalog?.status === 'ready' ? catalog.choices.find(candidate => candidate.value === pending) : undefined
      if (choice === undefined) {
        await closeSetting($)
        return
      }
      // The voice is downloaded before the list closes, so that its progress stays in sight.
      await selectVoice($, choice, () => closeSetting($))
      return
    }
  }
}

async function stop($: EngineInterface) {
  silence()
  await setReading($, reading => (reading.phase === 'synthesizing' || reading.phase === 'speaking' ? { ...reading, phase: 'stopped' } : reading))
}

async function turnOn($: EngineInterface): Promise<string> {
  await update($, isActiveAtom, () => true)
  await update($, readingAtom, () => EMPTY_READING)
  // The spending adds up over the whole session, the mode turned off and on again included.
  void setUpLocalVoice($, false)
  const settings = await settingsOf($, pluginOptions)
  await refreshEngineAvailability($)
  const engine = engineOf(settings, await capabilitiesOf($, settings))
  void refreshCredits($, engine)
  const voice = engine === null ? 'no voice is available, see /talk status' : `${engineLabels[engine]} reads the answers`
  return `Talk mode on (${languageNameOf(settings.language)}): ${voice}. Dictate with the voice key (hold space), /talk off to stop.`
}

// From the person's message to Claude's answer, the band says the answer it shows is no longer the latest.
async function startAwaiting($: EngineInterface): Promise<void> {
  await update($, animationFrameAtom, () => 0)
  await update($, isAwaitingAnswerAtom, () => true)
  await syncAnimation($)
}

async function stopAwaiting($: EngineInterface): Promise<void> {
  await update($, isAwaitingAnswerAtom, () => false)
  await syncAnimation($)
}

async function turnOff($: EngineInterface): Promise<string> {
  await stop($)
  await stopAwaiting($)
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
      return `${engineLabels[name]}: ${isAvailable ? 'available' : whyUnavailable(name, settings, found)}`
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
    await syncAnimation($)
    const interrupted = await read($, readingAtom)
    if (interrupted.phase === 'synthesizing' || interrupted.phase === 'speaking') {
      const fromWordIndex = sentenceStartOf(wordsOf(interrupted.tokens), Math.max(0, interrupted.currentWordIndex))
      void readTokens($, interrupted.tokens, fromWordIndex)
    }
    if (await read($, isActiveAtom)) {
      void refreshEngineAvailability($)
      void setUpLocalVoice($, false)
      // The engine or the language may have just changed: the list of voices is read again for them.
      if ((await read($, openSettingAtom)) === 'voice') void loadVoiceCatalog($)
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
    if (e.isMeta !== undefined || e.command !== undefined || !(await read($, isActiveAtom))) return next(e)
    await startAwaiting($)
    // Claude Code's own language setting is told the model after the system prompt's sections, out of the mod's reach:
    // the voice's language rides with each message, where it is read last.
    const settings = await settingsOf($, pluginOptions)
    return next({ ...e, context: [...(e.context ?? []), spokenLanguageNoteOf(settings.language)] })
  })

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    if (e.agentId === undefined) {
      spinnerWord = null
      await stopAwaiting($)
    }
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

  // Read as the spinner goes by, left as Claude Code draws it. A drawing writes no state: the band's own animation
  // draws it again several times a second, and reads the word then.
  on('ui.render', { component: 'Spinner' }, ($, e, next) => {
    spinnerWord = e.props.message ?? e.props.word
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const reading = await read($, readingAtom)
    const isSounding = reading.phase === 'synthesizing' || reading.phase === 'speaking'
    if (e.props.hasSurvey) return next(e)
    const settings = await settingsOf($, pluginOptions)
    if (!(await read($, isActiveAtom)) && !isSounding) {
      if (pluginOptions.showStartButton === false) return next(e)
      return renderStartLine($, e, settings.language, paletteOf(await read($, claudeCodeThemeAtom)), () => void turnOn($))
    }
    const engineInUse = engineShownOf(settings, capabilities)
    return renderBand($, e, {
      reading,
      openSetting: await read($, openSettingAtom),
      pendingChoice: await read($, pendingChoiceAtom),
      installation: await read($, installationAtom),
      voiceCatalog: await read($, voiceCatalogAtom),
      previewingVoice: await read($, previewingVoiceAtom),
      voiceDownload: await read($, voiceDownloadAtom),
      voiceFilter: await read($, voiceFilterAtom),
      spending: await read($, spendingAtom),
      credits: await read($, creditsAtom),
      isAwaitingAnswer: await read($, isAwaitingAnswerAtom),
      animationFrame: await read($, animationFrameAtom),
      thinkingWord: spinnerWord,
      engineInUse,
      currentVoice: currentVoiceOf(settings, capabilities, engineInUse),
      engineAvailability: await read($, engineAvailabilityAtom),
      engineSetting: settings.engine,
      language: settings.language,
      speed: settings.speed,
      palette: paletteOf(await read($, claudeCodeThemeAtom)),
    }, {
      stop: () => void stop($),
      replay: () => void replay($),
      turnOff: () => void turnOff($),
      selectEngine: engine => void choose($, engine),
      selectLanguage: language => void choose($, language),
      selectSpeed: speed => void choose($, speed.toFixed(2)),
      slower: () => void changeSpeed($, -1),
      faster: () => void changeSpeed($, 1),
      toggleSetting: setting => void toggleSetting($, setting),
      previewVoice: choice => void previewVoice($, choice),
      selectVoice: choice => void choose($, choice.value),
      applySetting: () => void applySetting($),
      filterVoices: (filter: VoiceFilter) => void update($, voiceFilterAtom, () => filter),
      cancelSetting: () => void closeSetting($),
    })
  })
}
