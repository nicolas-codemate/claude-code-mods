import type { EngineInterface, RenderChildren, RenderInput } from 'claude-code'

import type { EngineAvailability, Installation, Reading, ReadingPhase, SettingName, SpokenToken, TalkEngineName, TalkLanguage } from '../../types'
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
}

export type BandInput = {
  reading: Reading
  openSetting: SettingName | null
  installation: Installation | null
  engineAvailability: EngineAvailability | null
  engineSetting: TalkEngineName | 'auto'
  language: TalkLanguage
  speed: number
  palette: Palette
}

const PHASE_LABELS: Readonly<Record<ReadingPhase, string>> = {
  idle: 'Your turn: hold space and talk',
  synthesizing: 'Getting the voice ready',
  speaking: 'Speaking',
  done: 'Your turn: hold space and talk',
  stopped: 'Stopped',
  failed: 'The voice failed',
}

export const LANGUAGES: readonly TalkLanguage[] = ['fr', 'en', 'es', 'de', 'it']

const SPEED_PRESETS: readonly number[] = [0.75, 1, 1.1, 1.25, 1.5, 1.75, 2]

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

const SETTING_LABELS: Readonly<Record<SettingName, string>> = { engine: 'Voice', speed: 'Speed', language: 'Language' }

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

// The band above the prompt while talk mode is on: the answer the voice is reading, and the settings.
export function renderBand($: EngineInterface, e: RenderInput<'AbovePrompt'>, input: BandInput, actions: BandActions) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const { reading, palette, engineAvailability, engineSetting } = input
  const isSounding = reading.phase === 'synthesizing' || reading.phase === 'speaking'
  const isShowingAnswer = reading.tokens.length > 0
  const answerRows = e.props.maxRows - BAND_FRAME_ROWS - (reading.error === null ? 0 : 1) - (input.installation === null ? 0 : 1) - (input.openSetting === null ? 0 : OPEN_SETTING_ROWS)
  const phaseColor = phaseColorOf(reading.phase, palette)
  const chosenEngineReason = engineSetting === 'auto' || engineAvailability === null ? null : engineAvailability[engineSetting]
  const engineInUse = reading.engine ?? (engineSetting === 'auto' ? null : engineSetting)

  // One button per choice, a click away with the mouse: the chosen one stands out, one the machine cannot use is dimmed.
  const picker = (key: string, value: string, choices: readonly Choice[], onSelect: (value: string) => void) => (
    <Box flexDirection="row" columnGap={1} flexWrap="wrap">
      {choices.map(choice => {
        const isChosen = choice.value === value
        return (
          <Button key={`${key}-${choice.value}`} variant={isChosen ? 'primary' : undefined} onPress={() => onSelect(choice.value)}>
            <Text bold={isChosen} dimColor={!isChosen && choice.isUnavailable === true}>
              {choice.label}
            </Text>
          </Button>
        )
      })}
    </Box>
  )

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
      case 'speed':
        return (
          <Box flexDirection="row" columnGap={2} flexWrap="wrap">
            {picker('speed', input.speed.toFixed(2), SPEED_PRESETS.map(speed => ({ value: speed.toFixed(2), label: `${speed.toFixed(2)}x` })), value => actions.selectSpeed(Number(value)))}
            <Box flexDirection="row" columnGap={1}>
              <Button key="slower" label="-" onPress={actions.slower} />
              <Button key="faster" label="+" onPress={actions.faster} />
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
        <Box flexDirection="row">
          {settingItem('engine', engineInUse === null ? 'Auto' : engineLabels[engineInUse])}
          <Text dimColor> · </Text>
          {settingItem('speed', `${input.speed.toFixed(2)}x`)}
          <Text dimColor> · </Text>
          {settingItem('language', languageNameOf(input.language))}
          <Text dimColor>  </Text>
          <Button key="off" plain onPress={actions.turnOff}>
            <Text dimColor>off</Text>
          </Button>
        </Box>
      </Box>
      {input.installation !== null && (
        <Text color={input.installation.status === 'running' ? palette.preparing : palette.failed}>
          {input.installation.status === 'running' ? `Setting up the local voice: ${input.installation.message}...` : input.installation.message}
        </Text>
      )}
      {reading.error !== null && <Text color={palette.failed}>{reading.error}</Text>}
      {isShowingAnswer && (
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
        <Box flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
          <Text dimColor>{SETTING_LABELS[input.openSetting]}</Text>
          {settingChoicesOf(input.openSetting)}
        </Box>
      )}
    </Box>
  )
}
