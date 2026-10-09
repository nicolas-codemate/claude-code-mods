import { WATCH_BAR_ROWS, WATCH_FIELD_KEY } from '../constants'
import type { ShortcutAction } from '../keymap'
import type { ExplorerActions, ViewElements } from './types'

export const WATCH_MARK = '\u{1F50D}'
const CLEAR_MARK = '\u{1F9F9}'


export type WatchBarInput = { term: string; matchCountByPath: Record<string, number> }

// The search runs through every change of the view: its bar stands above the panels, whatever file is shown.
export function renderWatchBar(
  ui: ViewElements,
  input: WatchBarInput,
  hotkeyOf: (action: ShortcutAction) => string | undefined,
  actions: ExplorerActions,
) {
  const { Box, Button, Input, Text } = ui
  const counts = Object.values(input.matchCountByPath)
  const matchCount = counts.reduce((total, count) => total + count, 0)

  return (
    <Box
      flexDirection="row"
      flexShrink={0}
      height={WATCH_BAR_ROWS}
      marginX={1}
      paddingX={1}
      borderStyle="round"
      borderColor={ui.theme.accentBorder}
      backgroundColor={ui.theme.headerBackground}
    >
      <Box flexShrink={0}>
        <Text color={ui.theme.watched}>{WATCH_MARK} </Text>
      </Box>
      <Box flexGrow={1}>
        <Input
          key={WATCH_FIELD_KEY}
          value={input.term}
          placeholder="search all changes…"
          onInput={value => actions.updateWatchedTerm(value)}
          onSubmit={value => actions.submitWatchedTerm(value)}
        />
      </Box>
      {input.term !== '' && (
        <Box key="watch-count-box" flexShrink={0} marginLeft={1}>
          <Text color={matchCount > 0 ? ui.theme.watched : ui.theme.muted}>
            {matchCount > 0 ? `${matchCount} in ${counts.length} file${counts.length > 1 ? 's' : ''}` : 'none'}
          </Text>
        </Box>
      )}
      {matchCount > 0 && (
        <Box key="watched-moves-box" flexShrink={0} marginLeft={2}>
          <Button
            key="watched-previous"
            plain
            hover={{ color: ui.theme.accent }}
            hotkey={hotkeyOf('previousWatchedMatch')}
            label="↑"
            onPress={() => actions.moveToWatchedMatch(-1)}
          />
          <Text> </Text>
          <Button
            key="watched-next"
            plain
            hover={{ color: ui.theme.accent }}
            hotkey={hotkeyOf('nextWatchedMatch')}
            label="↓"
            onPress={() => actions.moveToWatchedMatch(1)}
          />
        </Box>
      )}
      <Box key="clear-watch-box" flexShrink={0} marginLeft={2}>
        <Button key="clear-watch" plain hover={{ color: ui.theme.accent }} label={`${CLEAR_MARK} clear`} onPress={() => actions.clearWatchedTerm()} />
      </Box>
    </Box>
  )
}
