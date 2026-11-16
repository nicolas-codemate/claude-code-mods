import type { EngineInterface, RenderChildren, RenderInput } from 'claude-code'

import type { EngineAvailability, Installation, Reading, ReadingPhase, SettingName, SpokenToken, TalkEngineName, TalkLanguage, VoiceCatalog, VoiceChoice, VoiceDownload } from '../../types'
import { AUTO_ENGINE_ORDER, engineLabels, languageNameOf } from '../engines'
import { sentenceStartOf, wordsOf } from '../spoken-text'
import type { Palette } from './theme'

export type BandActions = {
  stop: () => void
  replay: () => void
  turnOff: () => void
  selectEngine: (engine: TalkEngineName | 'auto') => void
  selectLanguage: (language: TalkLanguage) => void
  selectSpeed: (speed: number) => void
  slower: () => void
  faster: () => void
  toggleSetting: (setting: SettingName) => void
  previewVoice: (choice: VoiceChoice) => void
  selectVoice: (choice: VoiceChoice) => void
}

export type BandInput = {
  reading: Reading
  openSetting: SettingName | null
  installation: Installation | null
  voiceCatalog: VoiceCatalog | null
  previewingVoice: string | null
  voiceDownload: VoiceDownload | null
  isAwaitingAnswer: boolean
  animationFrame: number
  engineInUse: TalkEngineName | null
  currentVoice: string | null
  engineAvailability: EngineAvailability | null
  engineSetting: TalkEngineName | 'auto'
  language: TalkLanguage
  speed: number
  palette: Palette
}

const PHASE_LABELS: Readonly<Record<ReadingPhase, string>> = {
  idle: 'Your turn: hold space and talk',
  synthesizing: 'Answer received',
  speaking: 'Speaking',
  done: 'Your turn: hold space and talk',
  stopped: 'Stopped',
  failed: 'The voice failed',
}

export const LANGUAGES: readonly TalkLanguage[] = ['fr', 'en', 'es', 'de', 'it']

const SPEED_PRESETS: readonly number[] = [0.75, 1, 1.1, 1.25, 1.5, 1.75, 2]
const SPEED_STEP_LABEL = '0.05'
// The wait for the next answer is drawn as Claude Code draws its own thinking: a star that pulses, and a word that
// changes every few steps of it.
const THINKING_GLYPHS: readonly string[] = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢']
const THINKING_WORDS: readonly string[] = ['Cogitating', 'Pondering', 'Mulling it over', 'Brewing', 'Musing', 'Noodling', 'Percolating', 'Thinking']
const FRAMES_PER_THINKING_WORD = 16
// The separator and the thinking line below the previous answer.
const THINKING_ROWS = 3

export const thinkingLineOf = (frame: number): { glyph: string; word: string } => ({
  glyph: THINKING_GLYPHS[frame % THINKING_GLYPHS.length] ?? '·',
  word: THINKING_WORDS[Math.floor(frame / FRAMES_PER_THINKING_WORD) % THINKING_WORDS.length] ?? 'Thinking',
})

// The rows of the band besides the answer: its two borders and its status line.
const BAND_FRAME_ROWS = 3
// The rows an open setting takes: its own borders, its title and its choices.
const OPEN_SETTING_ROWS = 5

const textRowsOf = (text: string, columns: number): number =>
  text.split('\n').reduce((rows, line) => rows + Math.max(1, Math.ceil(line.length / Math.max(1, columns))), 0)

// The whole answer when it fits the rows the band is given; otherwise from the sentence being read on.
export const visibleTokensOf = (reading: Reading, columns: number, rows: number): SpokenToken[] => {
  const wholeText = reading.tokens.map(token => token.text).join('')
  if (textRowsOf(wholeText, columns) <= rows) return reading.tokens
  const firstWord = sentenceStartOf(wordsOf(reading.tokens), Math.max(0, reading.currentWordIndex))
  const firstToken = reading.tokens.findIndex(token => token.wordIndex === firstWord)
  return reading.tokens.slice(Math.max(0, firstToken))
}

const PROGRESS_BAR_COLUMNS = 24
const BYTES_PER_MEGABYTE = 1_000_000

const percentOf = (download: VoiceDownload): number | null =>
  download.totalBytes === null || download.totalBytes === 0 ? null : Math.min(100, Math.floor((download.receivedBytes / download.totalBytes) * 100))

const progressBarOf = (percent: number): string => {
  const filled = Math.round((percent / 100) * PROGRESS_BAR_COLUMNS)
  return `${'█'.repeat(filled)}${'░'.repeat(PROGRESS_BAR_COLUMNS - filled)}`
}

const megabytesOf = (bytes: number): string => `${Math.round(bytes / BYTES_PER_MEGABYTE)} MB`

// The two buttons that enter and leave the mode, in the language of the conversation.
const MODE_BUTTON_LABELS: Readonly<Record<TalkLanguage, { start: string; end: string }>> = {
  fr: { start: 'Démarrer une conversation vocale', end: 'Terminer la conversation vocale' },
  en: { start: 'Start a voice conversation', end: 'End the voice conversation' },
  es: { start: 'Iniciar una conversación por voz', end: 'Terminar la conversación por voz' },
  de: { start: 'Sprachgespräch starten', end: 'Sprachgespräch beenden' },
  it: { start: 'Avvia una conversazione vocale', end: 'Termina la conversazione vocale' },
}

// The line above the prompt while talk mode is off: one click enters it.
export function renderStartLine($: EngineInterface, e: RenderInput<'AbovePrompt'>, language: TalkLanguage, palette: Palette, start: () => void) {
  const { Box, Text, Button } = $.ui.resolve(e)
  return (
    <Box flexDirection="row" justifyContent="flex-end">
      <Button key="start" plain onPress={start}>
        <Text color={palette.claude}>▶ {MODE_BUTTON_LABELS[language].start}</Text>
      </Button>
    </Box>
  )
}

const SETTING_LABELS: Readonly<Record<SettingName, string>> = { engine: 'Engine', voice: 'Voice', speed: 'Speed', language: 'Language' }

const phaseColorOf = (phase: ReadingPhase, palette: Palette): string | null => {
  switch (phase) {
    case 'synthesizing':
      return palette.preparing
    case 'speaking':
      return palette.speaking
    case 'failed':
      return palette.failed
    case 'idle':
    case 'done':
    case 'stopped':
      return null
  }
}

export type WordState = 'spoken' | 'current' | 'upcoming'

export const wordStateOf = (token: SpokenToken, reading: Reading): WordState => {
  if (token.wordIndex === null || reading.phase === 'done') return 'spoken'
  if (token.wordIndex < reading.currentWordIndex) return 'spoken'
  if (token.wordIndex === reading.currentWordIndex) return 'current'
  return 'upcoming'
}

const isEngineUnavailable = (engine: TalkEngineName, availability: EngineAvailability | null): boolean =>
  availability !== null && availability[engine] !== null

const isEngineChoice = (value: string): value is TalkEngineName | 'auto' => value === 'auto' || AUTO_ENGINE_ORDER.some(engine => engine === value)

const isLanguage = (value: string): value is TalkLanguage => LANGUAGES.some(language => language === value)

type Choice = { value: string; label: string; isUnavailable?: boolean }

// The name of the voice in force for the settings line: its label in the list once read, else its own name.
const voiceLabelOf = (input: BandInput): string => {
  const current = input.currentVoice
  if (current === null) return 'Voice'
  const listed = input.voiceCatalog?.status === 'ready' ? input.voiceCatalog.choices.find(choice => choice.value === current) : undefined
  if (listed !== undefined) return listed.label
  const [key = current, speaker] = current.split('#')
  const name = key.split('-')[1] ?? key
  const capitalized = (word: string) => word.charAt(0).toUpperCase() + word.slice(1)
  return speaker === undefined ? capitalized(name.replace(/_/g, ' ')) : `${capitalized(name)} ${capitalized(speaker)}`
}

// The band above the prompt while talk mode is on: the answer the voice is reading, and the settings.
export function renderBand($: EngineInterface, e: RenderInput<'AbovePrompt'>, input: BandInput, actions: BandActions) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const { reading, palette, engineAvailability, engineSetting } = input
  const isSounding = reading.phase === 'synthesizing' || reading.phase === 'speaking'
  const isShowingAnswer = reading.tokens.length > 0
  // The person has spoken again: the answer shown is the previous one until the next comes.
  const isAwaiting = input.isAwaitingAnswer && !isSounding
  const isPreparingVoice = reading.phase === 'synthesizing' && !isAwaiting
  const waitingLine = thinkingLineOf(input.animationFrame)
  const answerRows = e.props.maxRows - BAND_FRAME_ROWS - (reading.error === null ? 0 : 1) - (input.installation === null ? 0 : 1) - (input.openSetting === null ? 0 : OPEN_SETTING_ROWS)
  const phaseColor = phaseColorOf(reading.phase, palette)
  const chosenEngineReason = engineSetting === 'auto' || engineAvailability === null ? null : engineAvailability[engineSetting]
  const { engineInUse } = input

  // One button per choice, a click away with the mouse: the chosen one stands out, one the machine cannot use is dimmed.
  // One choice per line, as the voices are: its name, a click away, and after it whether it is in use or unavailable.
  const picker = (key: string, value: string, choices: readonly Choice[], onSelect: (value: string) => void) => {
    const nameColumns = Math.max(...choices.map(choice => choice.label.length)) + 3
    return (
      <Box flexDirection="column">
        {choices.map(choice => {
          const isChosen = choice.value === value
          return (
            <Box key={`${key}-row-${choice.value}`} flexDirection="row">
              <Box width={nameColumns}>
                <Button key={`${key}-${choice.value}`} plain onPress={() => onSelect(choice.value)}>
                  <Text bold={isChosen} color={isChosen ? palette.speaking : undefined} dimColor={!isChosen && choice.isUnavailable === true}>
                    {choice.label}
                  </Text>
                </Button>
              </Box>
              {isChosen ? <Text color={palette.speaking}>✓ in use</Text> : choice.isUnavailable === true && <Text dimColor>unavailable</Text>}
            </Box>
          )
        })}
      </Box>
    )
  }

  // Each voice can be heard on the same sentence before it is chosen; a Piper voice not yet on the machine downloads then.
  const voiceChoicesOf = (catalog: VoiceCatalog | null): RenderChildren => {
    if (catalog === null) return <Text dimColor>No engine is available, so there is no voice to choose.</Text>
    switch (catalog.status) {
      case 'loading':
        return <Text dimColor>Reading the list of voices...</Text>
      case 'failed':
        return <Text color={palette.failed}>{catalog.error}</Text>
      case 'ready':
        if (catalog.choices.length === 0) return <Text dimColor>{engineLabels[catalog.engine]} has a single voice here.</Text>
        // One voice per line, the names in a column wide enough for the longest, its state after it.
        const nameColumns = Math.max(...catalog.choices.map(choice => choice.label.length)) + 3
        return (
          <Box flexDirection="column">
            {catalog.choices.map(choice => {
              const isChosen = choice.value === input.currentVoice
              const isPreviewing = choice.value === input.previewingVoice
              const key = choice.download?.slice(choice.download.lastIndexOf('/') + 1) ?? null
              const isOnMachine = key === null || catalog.downloaded.includes(key)
              const download = input.voiceDownload !== null && input.voiceDownload.download === choice.download ? input.voiceDownload : null
              const percent = download === null ? null : percentOf(download)
              return (
                <Box key={`voice-${choice.value}`} flexDirection="row">
                  <Button key={`hear-${choice.value}`} plain onPress={() => actions.previewVoice(choice)}>
                    <Text color={isPreviewing ? palette.preparing : palette.claude}>{isPreviewing ? '…  ' : '▶  '}</Text>
                  </Button>
                  <Box width={nameColumns}>
                    <Button key={`choose-${choice.value}`} plain onPress={() => actions.selectVoice(choice)}>
                      <Text bold={isChosen} color={isChosen ? palette.speaking : undefined} dimColor={!isChosen && !isOnMachine && download === null}>
                        {choice.label}
                      </Text>
                    </Button>
                  </Box>
                  {download !== null ? (
                    <Text color={palette.preparing}>{percent === null ? 'downloading…' : `${percent}%`}</Text>
                  ) : isChosen ? (
                    <Text color={palette.speaking}>✓ in use</Text>
                  ) : (
                    !isOnMachine && <Text dimColor>↓ {choice.sizeBytes === null ? 'to download' : megabytesOf(choice.sizeBytes)}</Text>
                  )}
                </Box>
              )
            })}
            <Box marginTop={1}>
            {input.voiceDownload !== null ? (
              <Text color={palette.preparing}>
                Downloading {input.voiceDownload.label}{'  '}
                {percentOf(input.voiceDownload) === null
                  ? megabytesOf(input.voiceDownload.receivedBytes)
                  : `${progressBarOf(percentOf(input.voiceDownload) ?? 0)}  ${megabytesOf(input.voiceDownload.receivedBytes)} of ${megabytesOf(input.voiceDownload.totalBytes ?? 0)}`}
              </Text>
            ) : (
              <Text dimColor>▶ listen · a name to choose it{catalog.engine === 'piper' ? ' · ↓ not on this machine yet: downloaded when first heard or chosen' : ''}</Text>
            )}
            </Box>
          </Box>
        )
    }
  }

  const settingChoicesOf = (setting: SettingName): RenderChildren => {
    switch (setting) {
      case 'engine':
        return (
          <Box flexDirection="column">
            {picker(
              'engine',
              engineSetting,
              [
                { value: 'auto', label: 'Auto' },
                ...AUTO_ENGINE_ORDER.map(choice => ({ value: choice, label: engineLabels[choice], isUnavailable: isEngineUnavailable(choice, engineAvailability) })),
              ],
              value => {
                if (isEngineChoice(value)) actions.selectEngine(value)
              },
            )}
            {engineSetting !== 'auto' && chosenEngineReason !== null && <Text color={palette.warning}>{chosenEngineReason}</Text>}
          </Box>
        )
      case 'voice':
        return voiceChoicesOf(input.voiceCatalog)
      case 'speed':
        return (
          <Box flexDirection="column">
            {picker('speed', input.speed.toFixed(2), SPEED_PRESETS.map(speed => ({ value: speed.toFixed(2), label: `${speed.toFixed(2)}x` })), value => actions.selectSpeed(Number(value)))}
            <Box flexDirection="row" columnGap={1} marginTop={1}>
              <Button key="slower" label="-" onPress={actions.slower} />
              <Button key="faster" label="+" onPress={actions.faster} />
              <Text dimColor>by {SPEED_STEP_LABEL}</Text>
            </Box>
          </Box>
        )
      case 'language':
        return picker('language', input.language, LANGUAGES.map(language => ({ value: language, label: languageNameOf(language) })), value => {
          if (isLanguage(value)) actions.selectLanguage(value)
        })
    }
  }

  // Each part of the settings line is the shortcut to its own choices, opened above it.
  const settingItem = (setting: SettingName, label: string) => (
    <Button key={`setting-${setting}`} plain onPress={() => actions.toggleSetting(setting)}>
      <Text bold={input.openSetting === setting} underline={input.openSetting === setting}>
        {label}
      </Text>
    </Button>
  )

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={palette.claude} borderDimColor={!isSounding} paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row" columnGap={2}>
          <Text>
            <Text color={phaseColor ?? undefined} dimColor={phaseColor === null}>● </Text>
            <Text color={palette.claude} bold>
              Talk
            </Text>
            <Text dimColor> · {PHASE_LABELS[reading.phase]}</Text>
          </Text>
          {isSounding ? (
            <Button key="stop" plain onPress={actions.stop}>
              <Text color={palette.failed}>■ stop</Text>
            </Button>
          ) : (
            reading.tokens.length > 0 && (
              <Button key="replay" plain onPress={actions.replay}>
                <Text dimColor>▶ replay</Text>
              </Button>
            )
          )}
        </Box>
        <Button key="end" plain onPress={actions.turnOff}>
          <Text dimColor>✕ {MODE_BUTTON_LABELS[input.language].end}</Text>
        </Button>
      </Box>
      {input.installation !== null && (
        <Text color={input.installation.status === 'running' ? palette.preparing : palette.failed}>
          {input.installation.status === 'running' ? `Setting up the local voice: ${input.installation.message}...` : input.installation.message}
        </Text>
      )}
      {reading.error !== null && <Text color={palette.failed}>{reading.error}</Text>}
      {isShowingAnswer && isAwaiting && <Text dimColor italic>Previous answer</Text>}
      {isShowingAnswer && isAwaiting && (
        <Text wrap="wrap" dimColor>
          {visibleTokensOf(reading, e.props.bodyColumns - 4, answerRows - 1 - THINKING_ROWS).map(token => token.text).join('')}
        </Text>
      )}
      {(isAwaiting || isPreparingVoice) && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>{'─'.repeat(Math.max(1, e.props.bodyColumns - 4))}</Text>
          <Text color={isAwaiting ? palette.claude : palette.preparing}>
            <Text bold>{waitingLine.glyph}</Text> {isAwaiting ? waitingLine.word : `Getting the voice ready${engineInUse === null ? '' : ` (${engineLabels[engineInUse]})`}`}…
          </Text>
        </Box>
      )}
      {isShowingAnswer && !isAwaiting && (
        <Text wrap="wrap">
          {visibleTokensOf(reading, e.props.bodyColumns - 4, answerRows).map(token => {
            const state = wordStateOf(token, reading)
            switch (state) {
              case 'spoken':
                return <Text>{token.text}</Text>
              case 'current':
                return <Text inverse bold>{token.text}</Text>
              case 'upcoming':
                return <Text dimColor>{token.text}</Text>
            }
          })}
        </Text>
      )}
      {input.openSetting !== null && (
        // Opened above the item of the settings line it belongs to, on the right as that line is.
        <Box alignSelf="flex-end" flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
          <Text dimColor>{SETTING_LABELS[input.openSetting]}</Text>
          {settingChoicesOf(input.openSetting)}
        </Box>
      )}
      <Box flexDirection="row" justifyContent="flex-end">
        {settingItem('engine', engineInUse === null ? 'Auto' : engineLabels[engineInUse])}
        <Text dimColor> · </Text>
        {settingItem('voice', voiceLabelOf(input))}
        <Text dimColor> · </Text>
        {settingItem('speed', `${input.speed.toFixed(2)}x`)}
        <Text dimColor> · </Text>
        {settingItem('language', languageNameOf(input.language))}
      </Box>
    </Box>
  )
}
