import { HELP_CLOSE_KEY } from '../constants'
import { SHORTCUT_GROUPS, shortcutsOfGroup } from '../keymap'
import type { Keymap } from '../keymap'
import { wrappedLineCount } from './row-height'
import type { ExplorerActions, ViewElements } from './types'

export type HelpInput = { keymap: Keymap; problems: string[]; scrolledLines: number }

const GROUP_WIDTH = 46
const GROUP_GAP = 2
const KEY_COLUMN_WIDTH = 8
const PADDING_COLUMNS = 2 * 2 + 2
const FOOTER = [
  "Enter on the cursor's line asks about it; on a GitHub thread reached with n/p, c has Claude address it. Escape closes a question, then this help, then the pane.",
  'Remap a key in /config, under diff-review (Key: …): one letter or digit, several comma separated.',
]
// The title, the gap under it and the frame.
const HELP_CHROME_ROWS = 1 + 1 + 2

// The engine measures nothing drawn inside a pane: the groups' height is counted from their text, as the flex wrap lays
// them, a row of groups as tall as its tallest.
export function helpContentLineCount(bodyColumns: number): number {
  const contentColumns = bodyColumns - PADDING_COLUMNS
  const groupsPerRow = Math.max(1, Math.floor((contentColumns + GROUP_GAP) / (GROUP_WIDTH + GROUP_GAP)))
  const groupHeights = SHORTCUT_GROUPS.map(
    group =>
      1 + shortcutsOfGroup(group).reduce((height, shortcut) => height + wrappedLineCount(shortcut.description, Math.floor((GROUP_WIDTH - KEY_COLUMN_WIDTH) * 0.9)), 0),
  )
  let lineCount = 0
  for (let rowStart = 0; rowStart < groupHeights.length; rowStart += groupsPerRow) {
    lineCount += Math.max(...groupHeights.slice(rowStart, rowStart + groupsPerRow)) + 1
  }

  return lineCount
}

export function helpVisibleLineCount(height: number, bodyColumns: number, problemCount: number): number {
  const footerRows = FOOTER.reduce((rows, line) => rows + wrappedLineCount(line, bodyColumns - PADDING_COLUMNS), 0)

  return Math.max(1, height - HELP_CHROME_ROWS - footerRows - problemCount)
}

export function renderHelp(ui: ViewElements, input: HelpInput, height: number, bodyColumns: number, actions: ExplorerActions) {
  const { Box, Button, Text } = ui
  const isMoreBelow = input.scrolledLines + helpVisibleLineCount(height, bodyColumns, input.problems.length) < helpContentLineCount(bodyColumns)

  return (
    <Box flexDirection="column" height={height} overflow="hidden" borderStyle="round" borderColor={ui.theme.accentBorder} backgroundColor={ui.theme.panelBackground} paddingX={2}>
      <Box flexDirection="row" flexShrink={0}>
        <Box flexGrow={1}>
          <Text bold color={ui.theme.heading}>
            Keyboard shortcuts
          </Text>
        </Box>
        <Box flexShrink={0} marginRight={2}>
          <Text color={ui.theme.muted}>
            {input.scrolledLines > 0 ? '▲' : ' '}
            {isMoreBelow ? '▼ scroll for more' : ' '}
          </Text>
        </Box>
        <Button key={HELP_CLOSE_KEY} label="× close" onPress={() => actions.toggleHelp()} />
      </Box>
      <Box flexDirection="column" flexGrow={1} flexShrink={1} marginTop={1} overflow="hidden">
        <Box flexDirection="row" flexWrap="wrap" flexShrink={0} marginTop={-input.scrolledLines}>
          {SHORTCUT_GROUPS.map(group => (
            <Box key={`help-${group}`} flexDirection="column" width={GROUP_WIDTH} marginBottom={1} marginRight={GROUP_GAP}>
              <Text bold color={ui.theme.accent}>
                {group}
              </Text>
              {shortcutsOfGroup(group).map(shortcut => (
                <Box key={`help-${shortcut.action}`} flexDirection="row">
                  <Box width={KEY_COLUMN_WIDTH} flexShrink={0}>
                    <Text color={ui.theme.commitSha} bold>
                      {input.keymap[shortcut.action].join(' ')}
                    </Text>
                  </Box>
                  <Text>{shortcut.description}</Text>
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      </Box>
      {FOOTER.map(line => (
        <Box key={`help-footer-${line.slice(0, 12)}`} flexShrink={0}>
          <Text color={ui.theme.muted}>{line}</Text>
        </Box>
      ))}
      {input.problems.map(problem => (
        <Box key={`help-problem-${problem}`} flexShrink={0}>
          <Text color={ui.theme.removed}>{problem}</Text>
        </Box>
      ))}
    </Box>
  )
}
