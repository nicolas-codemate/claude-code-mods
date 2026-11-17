import type { EngineInterface, RenderChildren, RenderInput } from 'claude-code'

import type { EngineAvailability, Installation, Reading, ReadingPhase, SettingName, SpokenToken, TalkEngineName, TalkLanguage, VoiceCatalog, VoiceChoice, VoiceDownload, VoiceFilter, Spending, Credits } from '../../types'
import { AUTO_ENGINE_ORDER, costLabelOf, effectiveSpeedOf, engineLabelOf, isVoiceNamedByIdFor, modelChoicesOf, speedRangeOf } from '../engines'
import { languageNameOf } from '../languages'
import { sentenceStartOf, wordsOf } from '../spoken-text'
import type { Palette } from './theme'

export type BandActions = {
  stop: () => void
  replay: () => void
  turnOff: () => void
  selectEngine: (engine: TalkEngineName | 'auto') => void
  selectLanguage: (language: TalkLanguage) => void
  selectModel: (model: string) => void
  selectSpeed: (speed: number) => void
  slower: () => void
  faster: () => void
  toggleSetting: (setting: SettingName) => void
  previewVoice: (choice: VoiceChoice) => void
  selectVoice: (choice: VoiceChoice) => void
  applySetting: () => void
  filterVoices: (filter: VoiceFilter) => void
  cancelSetting: () => void
}

export type BandInput = {
  reading: Reading
  openSetting: SettingName | null
  pendingChoice: string | null
  installation: Installation | null
  voiceCatalog: VoiceCatalog | null
  previewingVoice: string | null
  voiceDownload: VoiceDownload | null
  voiceFilter: VoiceFilter
  spending: Record<TalkEngineName, Spending>
  credits: Partial<Record<TalkEngineName, Credits>>
  isAwaitingAnswer: boolean
  animationFrame: number
  // The word of Claude Code's spinner for the turn under way, once drawn.
  thinkingWord: string | null
  engineInUse: TalkEngineName | null
  currentVoice: string | null
  currentModel: string | null
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

const SPEED_PRESETS: readonly number[] = [0.75, 1, 1.25, 1.5, 2]

// The speeds offered for an engine: the usual ones it takes, and its fastest.
export const speedsOf = (engine: TalkEngineName | null): number[] => {
  const { min, max } = speedRangeOf(engine)
  return [...new Set([...SPEED_PRESETS.filter(speed => speed >= min && speed <= max), max])].sort((a, b) => a - b)
}
const SPEED_STEP_LABEL = '0.05'
// The wait for the next answer is drawn as Claude Code draws its own thinking: a star that pulses, and the word of its
// spinner. Before the spinner has drawn one, a word of this list stands in, changing every few steps of the star.
const THINKING_GLYPHS: readonly string[] = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢']
const THINKING_WORDS: readonly string[] = ['Cogitating', 'Pondering', 'Mulling it over', 'Brewing', 'Musing', 'Noodling', 'Percolating', 'Thinking']
const FRAMES_PER_THINKING_WORD = 16
// The separator and the thinking line below the previous answer.
const THINKING_ROWS = 3

export const thinkingLineOf = (frame: number): { glyph: string; word: string } => ({
  glyph: THINKING_GLYPHS[frame % THINKING_GLYPHS.length] ?? '·',
  word: THINKING_WORDS[Math.floor(frame / FRAMES_PER_THINKING_WORD) % THINKING_WORDS.length] ?? 'Thinking',
})

// The rows of the band besides the answer and an open setting: its two borders, its status line, its settings line.
const BAND_FRAME_ROWS = 4
// The rows of an open setting besides its choices: its two borders and its title line, which holds Cancel and Apply.
const OPEN_SETTING_FRAME_ROWS = 3
// The line under the voice list that says how to use it, or how far a download has come, with the space above it.
const VOICE_HINT_ROWS = 2

// The rows a text takes once wrapped between words, as the terminal wraps it; a word longer than a row is cut.
const textRowsOf = (text: string, columns: number): number => {
  const width = Math.max(1, columns)
  return text.split('\n').reduce((rows, line) => {
    let lineRows = 1
    let used = 0
    for (const word of line.split(' ')) {
      const needed = used === 0 ? word.length : used + 1 + word.length
      if (needed <= width) {
        used = needed
        continue
      }
      lineRows += used === 0 ? 0 : 1
      lineRows += Math.max(0, Math.ceil(word.length / width) - 1)
      used = word.length % width === 0 && word.length > 0 ? width : word.length % width
    }
    return rows + lineRows
  }, 0)
}

const textOfTokens = (tokens: readonly SpokenToken[]): string => tokens.map(token => token.text).join('')

// The whole answer when it fits the rows the band is given; otherwise from the sentence being read on, as much of it as
// the rows hold, so that the band never grows past what Claude Code gives it.
export const visibleTokensOf = (reading: Reading, columns: number, rows: number): SpokenToken[] => {
  if (rows <= 0) return []
  if (textRowsOf(textOfTokens(reading.tokens), columns) <= rows) return reading.tokens
  const firstWord = sentenceStartOf(wordsOf(reading.tokens), Math.max(0, reading.currentWordIndex))
  const fromSentence = reading.tokens.slice(Math.max(0, reading.tokens.findIndex(token => token.wordIndex === firstWord)))
  const kept: SpokenToken[] = []
  for (const token of fromSentence) {
    if (textRowsOf(textOfTokens([...kept, token]), columns) > rows) break
    kept.push(token)
  }
  return kept
}

const PROGRESS_BAR_COLUMNS = 24
// The voice list's cells: the listen mark, then the name, cut past a length, then its state (in use, its size to
// download, its progress).
const HEAR_COLUMNS = 3
const MAX_NAME_COLUMNS = 16
const STATE_COLUMNS = 10
// The line drawn between two columns of voices.
const COLUMN_SEPARATOR = ' │ '
const MAX_VOICES_IN_ONE_COLUMN = 8

// How a list of voices is laid out: one column for a few voices, else columns filled from top to bottom, as few as keep
// it within the rows it is given and never more than fit side by side.
export const voiceListLayoutOf = (voiceCount: number, availableColumns: number, cellColumns: number, availableRows: number) => {
  const fittingColumns = Math.max(1, Math.floor(availableColumns / cellColumns))
  const wantedColumns = Math.max(Math.ceil(voiceCount / Math.max(1, availableRows)), Math.ceil(voiceCount / MAX_VOICES_IN_ONE_COLUMN))
  const listColumns = Math.min(fittingColumns, wantedColumns)
  return { listColumns, rowsPerColumn: Math.ceil(voiceCount / listColumns) }
}

const shortNameOf = (label: string): string => (label.length <= MAX_NAME_COLUMNS ? label : `${label.slice(0, MAX_NAME_COLUMNS - 1)}…`)
const BYTES_PER_MEGABYTE = 1_000_000

const percentOf = (download: VoiceDownload): number | null =>
  download.totalBytes === null || download.totalBytes === 0 ? null : Math.min(100, Math.floor((download.receivedBytes / download.totalBytes) * 100))

const progressBarOf = (percent: number): string => {
  const filled = Math.round((percent / 100) * PROGRESS_BAR_COLUMNS)
  return `${'█'.repeat(filled)}${'░'.repeat(PROGRESS_BAR_COLUMNS - filled)}`
}

const megabytesOf = (bytes: number): string => `${Math.round(bytes / BYTES_PER_MEGABYTE)} MB`


// The line above the prompt while talk mode is off: one click enters it.
export function renderStartLine($: EngineInterface, e: RenderInput<'AbovePrompt'>, palette: Palette, start: () => void) {
  const { Box, Text, Button } = $.ui.resolve(e)
  return (
    <Box flexDirection="row" justifyContent="flex-end">
      <Button key="start" plain onPress={start}>
        <Text color={palette.claude}>▶ Start a voice conversation</Text>
      </Button>
    </Box>
  )
}

const SETTING_LABELS: Readonly<Record<SettingName, string>> = { engine: 'Engine', model: 'Model', voice: 'Voice', speed: 'Speed', language: 'Language' }

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

type Choice = { value: string; label: string; isUnavailable?: boolean; detail?: string }

const VOICE_FILTER_LABELS: Readonly<Record<VoiceFilter, string>> = { all: 'All', female: 'Female', male: 'Male' }

export const isVoiceShownBy = (filter: VoiceFilter, choice: VoiceChoice): boolean => filter === 'all' || choice.gender === filter

// The name of the voice in force for the settings line: its label in the list once read, else its own name.
const voiceLabelOf = (input: BandInput): string => {
  const current = input.currentVoice
  if (current === null) return 'Voice'
  const listed = input.voiceCatalog?.status === 'ready' ? input.voiceCatalog.choices.find(choice => choice.value === current) : undefined
  if (listed !== undefined) return listed.label
  if (input.engineInUse !== null && isVoiceNamedByIdFor(input.engineInUse)) return 'Voice'
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
  // The frame says the state at a glance: Claude's color while the voice reads, another while Claude works.
  const frameColor =
    reading.phase === 'speaking' ? palette.claude : isAwaiting || isPreparingVoice ? palette.working : reading.phase === 'failed' ? palette.failed : palette.idle
  // The band keeps to the rows Claude Code gives it: an open setting takes what it needs, the answer what is left.
  const messageRows = (reading.error === null ? 0 : 1) + (input.installation === null ? 0 : 1)
  // The voice list, the tallest, takes the answer's rows too while it is open.
  const voiceListRows = e.props.maxRows - BAND_FRAME_ROWS - OPEN_SETTING_FRAME_ROWS - messageRows
  // While a setting is open, its choices take the answer's place.
  const answerRows = input.openSetting === null ? e.props.maxRows - BAND_FRAME_ROWS - messageRows : 0
  const choiceRows = e.props.maxRows - BAND_FRAME_ROWS - OPEN_SETTING_FRAME_ROWS - messageRows
  const phaseColor = phaseColorOf(reading.phase, palette)
  const chosenEngineReason = engineSetting === 'auto' || engineAvailability === null ? null : engineAvailability[engineSetting]
  const { engineInUse } = input
  // What the session has spent on the engine in use, beside its name.
  const cost = costLabelOf(engineInUse, input.spending, input.credits)
  // Shown for an engine of several models alone.
  const modelLabel = modelChoicesOf(engineInUse).find(choice => choice.value === input.currentModel)?.label ?? (modelChoicesOf(engineInUse).length > 0 ? 'Model' : null)
  // The speed the engine reads at, which the line shows: the one chosen may be past what the engine takes.
  const speedInUse = effectiveSpeedOf(engineInUse, input.speed)

  // One button per choice, a click away with the mouse: the chosen one stands out, one the machine cannot use is dimmed.
  // After a choice: in use, selected (to apply), or what else is worth saying of it.
  const stateOf = (isChosen: boolean, isSelected: boolean, otherwise: RenderChildren) =>
    isSelected ? <Text color={palette.claude}>● selected</Text> : isChosen ? <Text color={palette.speaking}>✓ in use</Text> : otherwise

  // One choice per line, as the voices are: its name, a click away, and after it whether it is in use or unavailable.
  const picker = (key: string, value: string, choices: readonly Choice[], onSelect: (value: string) => void) => {
    const nameColumns = Math.max(...choices.map(choice => choice.label.length)) + 3
    // What tells the choices apart gets a column of its own, before whether one is in use.
    const detailColumns = Math.max(0, ...choices.map(choice => choice.detail?.length ?? 0)) + 3
    // A terminal too short for one choice per line gets them side by side.
    if (choices.length > choiceRows) {
      return (
        <Box flexDirection="row" columnGap={2} flexWrap="wrap">
          {choices.map(choice => {
            const isChosen = choice.value === value
            const isSelected = !isChosen && choice.value === input.pendingChoice
            return (
              <Button key={`${key}-${choice.value}`} plain onPress={() => onSelect(choice.value)}>
                <Text bold={isChosen || isSelected} color={isSelected ? palette.claude : isChosen ? palette.speaking : undefined} dimColor={!isChosen && !isSelected && choice.isUnavailable === true}>
                  {isSelected ? '● ' : isChosen ? '✓ ' : ''}
                  {choice.label}
                </Text>
              </Button>
            )
          })}
        </Box>
      )
    }
    return (
      <Box flexDirection="column">
        {choices.map(choice => {
          const isChosen = choice.value === value
          const isSelected = !isChosen && choice.value === input.pendingChoice
          return (
            <Box key={`${key}-row-${choice.value}`} flexDirection="row">
              <Box width={nameColumns}>
                <Button key={`${key}-${choice.value}`} plain onPress={() => onSelect(choice.value)}>
                  <Text bold={isChosen || isSelected} color={isSelected ? palette.claude : isChosen ? palette.speaking : undefined} dimColor={!isChosen && !isSelected && choice.isUnavailable === true}>
                    {choice.label}
                  </Text>
                </Button>
              </Box>
              {choice.detail !== undefined && (
                <Box width={detailColumns}>
                  <Text dimColor>{choice.detail}</Text>
                </Box>
              )}
              {stateOf(isChosen, isSelected, choice.isUnavailable === true ? <Text dimColor>unavailable</Text> : null)}
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
        if (catalog.choices.length === 0) return <Text dimColor>{engineLabelOf(catalog.engine)} has a single voice here.</Text>
        const shownChoices = catalog.choices.filter(choice => isVoiceShownBy(input.voiceFilter, choice))
        if (shownChoices.length === 0) return <Text dimColor>No {VOICE_FILTER_LABELS[input.voiceFilter].toLowerCase()} voice is known here.</Text>
        // One voice per line, the names in a column wide enough for the longest, its state after it. A long list, as
        // English has, is laid out in columns read from top to bottom, so that the band stays short.
        const nameColumns = Math.max(...shownChoices.map(choice => shortNameOf(choice.label).length)) + 1
        const cellColumns = HEAR_COLUMNS + nameColumns + STATE_COLUMNS
        const { listColumns, rowsPerColumn } = voiceListLayoutOf(shownChoices.length, e.props.bodyColumns - 6, cellColumns + COLUMN_SEPARATOR.length, voiceListRows)
        const isHintShown = rowsPerColumn + VOICE_HINT_ROWS <= voiceListRows
        const voiceRowOf = (choice: VoiceChoice) => {
          const isChosen = choice.value === input.currentVoice
          const isSelected = !isChosen && choice.value === input.pendingChoice
          const isPreviewing = choice.value === input.previewingVoice
          const key = choice.download?.slice(choice.download.lastIndexOf('/') + 1) ?? null
          const isOnMachine = key === null || catalog.downloaded.includes(key)
          const download = input.voiceDownload !== null && input.voiceDownload.download === choice.download ? input.voiceDownload : null
          const percent = download === null ? null : percentOf(download)
          return (
            <Box key={`voice-${choice.value}`} flexDirection="row" width={cellColumns}>
              <Button key={`hear-${choice.value}`} plain onPress={() => actions.previewVoice(choice)}>
                <Text color={isPreviewing ? palette.preparing : palette.claude}>{isPreviewing ? '…  ' : '▶  '}</Text>
              </Button>
              <Box width={nameColumns}>
                <Button key={`choose-${choice.value}`} plain onPress={() => actions.selectVoice(choice)}>
                  <Text bold={isChosen || isSelected} color={isSelected ? palette.claude : isChosen ? palette.speaking : undefined} dimColor={!isChosen && !isSelected && !isOnMachine && download === null}>
                    {shortNameOf(choice.label)}
                  </Text>
                </Button>
              </Box>
              {download !== null ? (
                <Text color={palette.preparing}>{percent === null ? 'downloading…' : `↓ ${percent}%`}</Text>
              ) : (
                stateOf(isChosen, isSelected, !isOnMachine && <Text dimColor>↓ {choice.sizeBytes === null ? 'to download' : megabytesOf(choice.sizeBytes)}</Text>)
              )}
            </Box>
          )
        }
        return (
          <Box flexDirection="column">
            <Box flexDirection="row">
              {Array.from({ length: listColumns }, (_, column) => (
                <Box key={`voices-column-${column}`} flexDirection="row">
                  {column > 0 && (
                    <Box flexDirection="column">
                      {Array.from({ length: rowsPerColumn }, (_, row) => (
                        <Text key={`separator-${column}-${row}`} dimColor>
                          {COLUMN_SEPARATOR}
                        </Text>
                      ))}
                    </Box>
                  )}
                  <Box flexDirection="column">{shownChoices.slice(column * rowsPerColumn, (column + 1) * rowsPerColumn).map(voiceRowOf)}</Box>
                </Box>
              ))}
            </Box>
            {isHintShown && (
              <Box marginTop={1}>
                <Text dimColor>▶ listen · a name to choose it{catalog.choices.some(choice => choice.download !== null) ? ' · ↓ not on this machine yet: downloaded when first heard or chosen' : ''}</Text>
              </Box>
            )}
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
                ...AUTO_ENGINE_ORDER.map(choice => ({ value: choice, label: engineLabelOf(choice), isUnavailable: isEngineUnavailable(choice, engineAvailability) })),
              ],
              value => {
                if (isEngineChoice(value)) actions.selectEngine(value)
              },
            )}
            {engineSetting !== 'auto' && chosenEngineReason !== null && <Text color={palette.warning}>{chosenEngineReason}</Text>}
          </Box>
        )
      case 'model':
        return picker('model', input.currentModel ?? '', modelChoicesOf(input.engineInUse), value => actions.selectModel(value))
      case 'voice':
        return voiceChoicesOf(input.voiceCatalog)
      case 'speed':
        return (
          <Box flexDirection="column">
            {picker('speed', speedInUse.toFixed(2), speedsOf(input.engineInUse).map(speed => ({ value: speed.toFixed(2), label: `${speed.toFixed(2)}x` })), value => actions.selectSpeed(Number(value)))}
          </Box>
        )
      case 'language':
        return picker('language', input.language, LANGUAGES.map(language => ({ value: language, label: languageNameOf(language) })), value => {
          if (isLanguage(value)) actions.selectLanguage(value)
        })
    }
  }

  // Each part of the settings line is the shortcut to its own choices, opened above it.
  // While a setting is open the others are dimmed: it is applied or cancelled first.
  const settingItem = (setting: SettingName, label: string) => (
    <Button key={`setting-${setting}`} plain onPress={() => actions.toggleSetting(setting)}>
      <Text bold={input.openSetting === setting} underline={input.openSetting === setting} dimColor={input.openSetting !== null && input.openSetting !== setting}>
        {label}
      </Text>
    </Button>
  )

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={frameColor} paddingX={1}>
      <Box flexDirection="row" justifyContent="space-between">
        <Box flexDirection="row" columnGap={2}>
          <Text>
            <Text color={phaseColor ?? undefined} dimColor={phaseColor === null}>● </Text>
            <Text color={palette.claude} bold>
              Talk
            </Text>
            {input.voiceDownload !== null ? (
              // A download says how far it has come where it is always in sight, whatever the list below takes.
              <Text color={palette.preparing}>
                {' '}· Downloading {input.voiceDownload.label}{'  '}
                {percentOf(input.voiceDownload) === null
                  ? megabytesOf(input.voiceDownload.receivedBytes)
                  : `${progressBarOf(percentOf(input.voiceDownload) ?? 0)}  ${megabytesOf(input.voiceDownload.receivedBytes)} of ${megabytesOf(input.voiceDownload.totalBytes ?? 0)}`}
              </Text>
            ) : (
              <Text dimColor> · {PHASE_LABELS[reading.phase]}</Text>
            )}
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
          <Text dimColor>✕ End the voice conversation</Text>
        </Button>
      </Box>
      {input.installation !== null && (
        <Text color={input.installation.status === 'running' ? palette.preparing : palette.failed}>
          {input.installation.status === 'running' ? `Setting up the local voice: ${input.installation.message}...` : input.installation.message}
        </Text>
      )}
      {reading.error !== null && <Text color={palette.failed}>{reading.error}</Text>}
      {isShowingAnswer && isAwaiting && answerRows > 0 && (
        <Text color={palette.muted} italic>
          Previous answer
        </Text>
      )}
      {isShowingAnswer && isAwaiting && answerRows > 0 && (
        <Text wrap="wrap" color={palette.muted}>
          {visibleTokensOf(reading, e.props.bodyColumns - 4, answerRows - 1 - THINKING_ROWS).map(token => token.text).join('')}
        </Text>
      )}
      {(isAwaiting || isPreparingVoice) && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>{'─'.repeat(Math.max(1, e.props.bodyColumns - 4))}</Text>
          <Text color={isAwaiting ? palette.claude : palette.preparing}>
            <Text bold>{waitingLine.glyph}</Text> {isAwaiting ? (input.thinkingWord ?? waitingLine.word) : `Getting the voice ready${engineInUse === null ? '' : ` (${engineLabelOf(engineInUse)})`}`}…
          </Text>
        </Box>
      )}
      {isShowingAnswer && !isAwaiting && answerRows > 0 && (
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
          {/* The title line holds Cancel and Apply too, so that the choices keep every other row. */}
          <Box flexDirection="row" justifyContent="space-between" columnGap={3}>
            {input.openSetting === 'speed' ? (
              // The fine steps share the title's line as well, so that the speeds take no more rows than they are.
              <Box flexDirection="row" columnGap={1}>
                <Text dimColor>{SETTING_LABELS.speed}</Text>
                <Button key="slower" label="-" onPress={actions.slower} />
                <Button key="faster" label="+" onPress={actions.faster} />
                <Text dimColor>by {SPEED_STEP_LABEL}</Text>
                {input.pendingChoice !== null && <Text color={palette.claude}>{Number(input.pendingChoice).toFixed(2)}x</Text>}
              </Box>
            ) : input.openSetting === 'voice' ? (
              // The voices of one gender at a click, where the engine tells it.
              <Box flexDirection="row" columnGap={1}>
                <Text dimColor>{SETTING_LABELS.voice}</Text>
                {(['all', 'female', 'male'] as const).map(filter => (
                  <Button key={`voice-filter-${filter}`} plain onPress={() => actions.filterVoices(filter)}>
                    <Text bold={input.voiceFilter === filter} underline={input.voiceFilter === filter} color={input.voiceFilter === filter ? palette.claude : undefined} dimColor={input.voiceFilter !== filter}>
                      {VOICE_FILTER_LABELS[filter]}
                    </Text>
                  </Button>
                ))}
              </Box>
            ) : (
              <Text dimColor>{SETTING_LABELS[input.openSetting]}</Text>
            )}
            <Box flexDirection="row" columnGap={1}>
              <Button key="cancel-setting" label="Cancel" onPress={actions.cancelSetting} />
              <Button key="apply-setting" label="Apply" variant="primary" onPress={actions.applySetting} />
            </Box>
          </Box>
          {settingChoicesOf(input.openSetting)}
        </Box>
      )}
      <Box flexDirection="row" justifyContent="flex-end">
        <Box flexDirection="row">
        {settingItem('engine', engineInUse === null ? 'Auto' : engineLabelOf(engineInUse))}
        {cost !== null && <Text color={palette.preparing}> {cost}</Text>}
        <Text dimColor> · </Text>
        {modelLabel !== null && settingItem('model', modelLabel)}
        {modelLabel !== null && <Text dimColor> · </Text>}
        {settingItem('voice', voiceLabelOf(input))}
        <Text dimColor> · </Text>
        {settingItem('speed', `${speedInUse.toFixed(2)}x`)}
        <Text dimColor> · </Text>
        {settingItem('language', languageNameOf(input.language))}
        </Box>
      </Box>
    </Box>
  )
}
