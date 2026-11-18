import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Credits, EngineAvailability, Spending, Installation, Reading, SettingName, SpokenToken, TalkEngineName, TalkLanguage, VoiceCatalog, VoiceChoice, VoiceFilter } from '../types'
import {
  AUTO_ENGINE_ORDER,
  chunkingOf,
  creditsOf,
  currentModelOf,
  currentVoiceOf,
  usedAtStartOf,
  engineLabelOf,
  engineOf,
  fallbackVoiceLabelOf,
  effectiveSpeedOf,
  engineShownOf,
  isCloudEngine,
  isRespellingEnglishFor,
  modelOptionFieldOf,
  probeCapabilities,
  settingsOf,
  synthesize,
  unavailabilityOf,
  voiceOptionFieldOf,
  voiceDownloadsOf,
  voicesOf,
  withVoice,
} from './engines'
import type { Capabilities, TalkSettings } from './engines'
import { languageNameOf } from './languages'
import { InstallError, installPiper, isLocalVoiceToInstall } from './providers/piper-install'
import { SynthesisError } from './providers/synthesis'
import type { Synthesis } from './providers/synthesis'
import { voiceToolkitOf } from './providers/toolkit'
import { speakableWordOf } from './pronunciation'
import { chunksOf, sentenceStartOf, spokenTextOf, textOfTokens, tokensOf, wordsOf } from './spoken-text'
import { wordAtElapsedMs } from './timing'
import { SAMPLE_SENTENCES, TEST_SENTENCES } from './voices'
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
const NOTHING_SPENT = Object.fromEntries(AUTO_ENGINE_ORDER.map(engine => [engine, { characters: 0, audioSeconds: 0 }])) as Record<TalkEngineName, Spending>
const spendingAtom = atom({ plugin: 'talk', key: 'spending' } as const, NOTHING_SPENT)
const creditsAtom = atom({ plugin: 'talk', key: 'credits' } as const, {})
const isAwaitingAnswerAtom = atom({ plugin: 'talk', key: 'isAwaitingAnswer' } as const, false)
const animationFrameAtom = atom({ plugin: 'talk', key: 'animationFrame' } as const, 0)

const SUBCOMMANDS = ['on', 'off', 'stop', 'replay', 'status', 'test', 'setup'] as const
type Subcommand = (typeof SUBCOMMANDS)[number]

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
  // A stop or another reading may have come during the waits above: the sound it silenced is not started.
  if (generation !== readingGeneration) return
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
  const stopThisPlayer = () => void player.return(undefined as never)
  stopPlayback = stopThisPlayer
  try {
    for await (const _chunk of player) {
      // The player writes nothing worth reading; the loop lasts as long as the sound.
    }
  } finally {
    ticker.cancel()
    if (stopPlayback === stopThisPlayer) stopPlayback = null
  }
}

// Read for another mod, the band may be off: a reading that fails says why in a toast, the band not being there to.
async function readForAnotherMod($: EngineInterface, text: string): Promise<void> {
  await speak($, text)
  const reading = await read($, readingAtom)
  if (reading.phase === 'failed' && reading.error !== null && !(await read($, isActiveAtom))) $.ui.toast(`talk: ${reading.error}`)
}

async function speak($: EngineInterface, answer: string) {
  await readTokens($, tokensOf(spokenTextOf(answer)), 0)
}

// A voice other than the one in force, as a sample of it is read with.
type ForcedVoice = { settings: TalkSettings; capabilities: Capabilities; engine: TalkEngineName }

// Reads the words from fromWordIndex on, the ones before it shown as already spoken.
async function readTokens($: EngineInterface, tokens: SpokenToken[], fromWordIndex: number, forced: ForcedVoice | null = null) {
  silence()
  const generation = readingGeneration
  const words = wordsOf(tokens)
  if (words.length <= fromWordIndex) return
  await setReading($, () => ({ tokens, currentWordIndex: fromWordIndex - 1, phase: 'synthesizing', engine: null, error: null }))
  try {
    if (piperInstallation !== null) await piperInstallation
    if (generation !== readingGeneration) return
    const settings = forced?.settings ?? (await settingsOf($, pluginOptions))
    const found = forced?.capabilities ?? (await capabilitiesOf($, settings))
    const engine = forced?.engine ?? engineOf(settings, found)
    if (generation !== readingGeneration) return
    if (engine === null) {
      const wanted = settings.engine === 'auto' ? AUTO_ENGINE_ORDER : [settings.engine]
      const error = `No voice available: ${wanted.map(name => `${engineLabelOf(name)}: ${unavailabilityOf(name, settings, found) ?? ''}`).join('; ')}`
      await setReading($, reading => ({ ...reading, phase: 'failed', error }))
      return
    }
    await setReading($, reading => ({ ...reading, engine }))
    const directory = await audioDirectoryOf($)
    const isRespellingEnglish = isRespellingEnglishFor(engine)
    const { maxCharacters, isFirstSentenceAlone } = chunkingOf(engine)
    const chunks = chunksOf(words.slice(fromWordIndex), maxCharacters, isFirstSentenceAlone)
    const firstWordIndexes = chunks.map((_, index) => fromWordIndex + chunks.slice(0, index).reduce((count, chunk) => count + chunk.length, 0))
    const speakableWordsOf = (pieceWords: readonly string[]): string[] =>
      pieceWords.map(word => speakableWordOf(word, settings.language, isRespellingEnglish))
    // A reading taken up again keeps the sentence before it as the context of its first piece.
    const wordsBefore = words.slice(sentenceStartOf(words, fromWordIndex - 1), fromWordIndex)
    const contextOf = (index: number): string | null => {
      const pieceWords = index < 0 ? wordsBefore : chunks[index]
      return pieceWords === undefined || pieceWords.length === 0 ? null : speakableWordsOf(pieceWords).join(' ')
    }
    // Each piece is asked for once, and what it costs is counted as soon as it is made, a piece a stop cut short
    // included: it was charged all the same.
    const pendingPieces: Promise<Synthesis>[] = []
    const requestPiece = (index: number) => {
      const pieceWords = chunks[index]
      if (pieceWords === undefined || pendingPieces[index] !== undefined) return
      const piece = synthesize($, engine, {
        speakableWords: speakableWordsOf(pieceWords),
        settings,
        capabilities: found,
        outputPathWithoutExtension: `${directory}/answer-${generation}-${index}`,
        previousText: contextOf(index - 1),
        nextText: contextOf(index + 1),
      })
      pendingPieces[index] = piece
      piece.then(synthesis => recordSpending($, engine, pieceWords.join(' ').length, synthesis.durationMs / 1000)).catch(() => undefined)
    }

    requestPiece(0)
    // A cloud voice makes the second piece while the first, often one short sentence, plays: asked for only once the
    // first is back, it would leave a silence after it.
    if (isCloudEngine(engine)) requestPiece(1)
    for (const [index, firstWordIndex] of firstWordIndexes.entries()) {
      const pendingPiece = pendingPieces[index]
      if (pendingPiece === undefined) return
      const synthesis = await pendingPiece
      if (generation !== readingGeneration) return
      requestPiece(index + 1)
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
  if (engine === null) return
  const settings = await settingsOf($, pluginOptions)
  const credits = await creditsOf($, engine, settings).catch(() => null)
  if (credits === null) return
  await update($, creditsAtom, (known): Partial<Record<TalkEngineName, Credits>> => ({
    ...known,
    [engine]: { ...credits, usedAtStart: usedAtStartOf(known?.[engine], credits.used) },
  }))
}

async function replay($: EngineInterface) {
  const reading = await read($, readingAtom)
  await readTokens($, reading.tokens, 0)
}

async function refreshEngineAvailability($: EngineInterface): Promise<void> {
  const settings = await settingsOf($, pluginOptions)
  // Probed again, the previous findings kept until then: a drawing meanwhile still names the engine.
  const found = await probeCapabilities($, settings)
  capabilities = found
  const availability = Object.fromEntries(AUTO_ENGINE_ORDER.map(engine => [engine, unavailabilityOf(engine, settings, found)])) as EngineAvailability
  await update($, engineAvailabilityAtom, () => availability)
  // A voice named by an id is shown by its name once its list is read: a list read for another engine, before the
  // engine changed, or one that failed, is read again.
  const engine = engineOf(settings, found)
  const voice = currentVoiceOf(settings, found, engine)
  const catalog = await read($, voiceCatalogAtom)
  const isCatalogUsable = catalog !== null && catalog.engine === engine && catalog.status !== 'failed'
  if (engine !== null && voice !== null && fallbackVoiceLabelOf(engine, voice) === null && !isCatalogUsable) void loadVoiceCatalog($)
}

// The band changes the mode's options as /config does: the setting is saved and the mod reloads with it.
async function setOption($: EngineInterface, field: string, value: string | number): Promise<void> {
  const rows = await $.config.list()
  const row = rows.find(candidate => candidate.key === `talk.${field}` || (candidate.key.startsWith('talk@') && candidate.key.endsWith(`.${field}`)))
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

function setInstallation($: EngineInterface, installation: Installation | null) {
  return update($, installationAtom, () => installation)
}

// The installation is claimed before anything is awaited, so that two calls never install side by side.
function setUpLocalVoice($: EngineInterface, isAsked: boolean): Promise<void> {
  piperInstallation ??= installLocalVoice($, isAsked).finally(() => {
    piperInstallation = null
  })
  return piperInstallation
}

async function installLocalVoice($: EngineInterface, isAsked: boolean): Promise<void> {
  const settings = await settingsOf($, pluginOptions)
  if (!isAsked && !isLocalVoiceToInstall(settings, await capabilitiesOf($, settings), pluginOptions.autoInstall !== false)) return
  const home = (await $.env.get('HOME')) ?? ''
  try {
    await installPiper($, home, settings.language, async message => {
      await setInstallation($, { status: 'running', message })
    })
    await setInstallation($, null)
  } catch (error) {
    await setInstallation($, { status: 'failed', message: error instanceof InstallError ? error.message : String(error) })
  } finally {
    await refreshEngineAvailability($)
  }
}

async function engineInUseOf($: EngineInterface, settings: TalkSettings): Promise<TalkEngineName | null> {
  return engineOf(settings, await capabilitiesOf($, settings))
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
    const choices = await voicesOf($, engine, settings)
    await update($, voiceCatalogAtom, (): VoiceCatalog => ({ engine, status: 'ready', choices }))
  } catch (error) {
    await update($, voiceCatalogAtom, (): VoiceCatalog => ({ engine, status: 'failed', error: error instanceof Error ? error.message : String(error) }))
  }
}

// A voice still to fetch is downloaded the first time it is heard or chosen, its progress shown as it comes.
async function ensureVoiceOnMachine($: EngineInterface, engine: TalkEngineName, choice: VoiceChoice): Promise<void> {
  const downloads = voiceDownloadsOf(engine)
  if (choice.download === null || downloads === null) return
  const download = choice.download
  const toolkit = voiceToolkitOf($)
  await update($, voiceDownloadAtom, () => ({ download, label: choice.label, receivedBytes: 0, totalBytes: choice.sizeBytes }))
  const partialFile = await downloads.partialFileOf(toolkit, download)
  const progress = $.clock.every(DOWNLOAD_PROGRESS_TICK_MS, () => {
    void (async () => {
      if (!(await $.fs.exists(partialFile))) return
      const { size } = await $.fs.stat(partialFile)
      await update($, voiceDownloadAtom, current => (current === null ? null : { ...current, receivedBytes: size }))
    })().catch(() => {
      // Renamed to its final name between the two calls: the download has just ended.
    })
  })
  try {
    await downloads.download(toolkit, download)
  } finally {
    progress.cancel()
    await update($, voiceDownloadAtom, () => null)
  }
  // Every speaker of the voice came with it.
  await update($, voiceCatalogAtom, catalog =>
    catalog?.status === 'ready'
      ? { ...catalog, choices: catalog.choices.map(listed => (listed.download === download ? { ...listed, download: null, sizeBytes: null } : listed)) }
      : catalog,
  )
}

// The answer the samples stand in for while they are heard, kept from the first of a row of samples; and which sample
// is the latest, the one that puts the answer back.
let answerBeforeSamples: Reading | null = null
let latestSample = 0

// Reads the same sample sentence with one voice of the list, so that voices can be compared. The sample takes the band
// while it is heard; the answer comes back after, for replay and as the previous answer, and a sample that failed says
// why in a toast.
async function previewVoice($: EngineInterface, choice: VoiceChoice): Promise<void> {
  const catalog = await read($, voiceCatalogAtom)
  if (catalog === null) return
  silence()
  const sample = ++latestSample
  answerBeforeSamples ??= await read($, readingAtom)
  await update($, previewingVoiceAtom, () => choice.value)
  const sampleTokens = tokensOf(SAMPLE_SENTENCES[(await settingsOf($, pluginOptions)).language])
  try {
    await ensureVoiceOnMachine($, catalog.engine, choice)
    const settings = withVoice(await settingsOf($, pluginOptions), catalog.engine, choice.value)
    const capabilitiesWithVoice = await probeCapabilities($, settings)
    await readTokens($, sampleTokens, 0, { settings, capabilities: capabilitiesWithVoice, engine: catalog.engine })
  } catch (error) {
    await setReading($, reading => ({ ...reading, phase: 'failed', error: error instanceof Error ? error.message : String(error) }))
  }
  if (sample !== latestSample) return
  await update($, previewingVoiceAtom, () => null)
  const reading = await read($, readingAtom)
  const answerBefore = answerBeforeSamples
  answerBeforeSamples = null
  // A new answer may have taken the band meanwhile: it stays.
  if (answerBefore === null || textOfTokens(reading.tokens) !== textOfTokens(sampleTokens)) return
  if (reading.phase === 'failed' && reading.error !== null) $.ui.toast(`talk: ${reading.error}`)
  const isAnswer = answerBefore.tokens.length > 0
  await setReading($, () => ({ ...answerBefore, phase: isAnswer ? 'done' : 'idle', currentWordIndex: isAnswer ? wordsOf(answerBefore.tokens).length : -1, error: null }))
}

async function selectVoice($: EngineInterface, choice: VoiceChoice, beforeSaving: () => Promise<void>): Promise<void> {
  const catalog = await read($, voiceCatalogAtom)
  if (catalog === null) return
  if (choice.download !== null) {
    await update($, previewingVoiceAtom, () => choice.value)
    try {
      await ensureVoiceOnMachine($, catalog.engine, choice)
    } catch (error) {
      $.ui.toast(`talk: ${error instanceof Error ? error.message : String(error)}`)
      return
    } finally {
      await update($, previewingVoiceAtom, () => null)
    }
  }
  await beforeSaving()
  const field = voiceOptionFieldOf(catalog.engine)
  if (field !== null) await setOption($, field, choice.value)
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
    case 'model': {
      await closeSetting($)
      const engine = engineShownOf(await settingsOf($, pluginOptions), capabilities)
      const field = engine === null ? null : modelOptionFieldOf(engine)
      if (field !== null) await setOption($, field, pending)
      return
    }
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
  const voice = engine === null ? 'no voice is available, see /talk status' : `${engineLabelOf(engine)} reads the answers`
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
  const found = await probeCapabilities($, settings)
  capabilities = found
  const engine = engineOf(settings, found)
  const lines = [
    `Platform: ${found.platform}; audio player: ${found.wavPlayer?.[0] ?? 'none'}`,
    ...AUTO_ENGINE_ORDER.map(name => `${engineLabelOf(name)}: ${unavailabilityOf(name, settings, found) ?? 'available'}`),
    `Engine setting: ${settings.engine}; speaking now: ${engine === null ? 'none' : engineLabelOf(engine)}; language: ${settings.language}`,
  ]
  return lines.join('\n')
}

const subcommandOf = (args: string): Subcommand | null => {
  const word = args.trim().split(/\s+/)[0] || 'on'
  return SUBCOMMANDS.find(subcommand => subcommand === word) ?? null
}

export const register: Register = (on, options) => {
  // The noun other mods call; the talk.read hook below answers it, the engine interface in hand.
  on('engine.create', async (_, e, next) => {
    const built = await next(e)
    return { ...built, talk: { read: async () => undefined } }
  })

  on('talk.read', async ($, e) => {
    void readForAnotherMod($, e.text)
    return { value: undefined }
  })

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
    const { phase } = await read($, readingAtom)
    const isSounding = phase === 'synthesizing' || phase === 'speaking'
    if (e.origin.kind !== 'plugin' && e.text.trim() !== '' && isSounding) await stop($)
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
      return renderStartLine($, e, paletteOf(await read($, claudeCodeThemeAtom)), () => void turnOn($))
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
      currentModel: currentModelOf(settings, engineInUse),
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
      selectModel: model => void choose($, model),
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
