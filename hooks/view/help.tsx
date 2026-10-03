import { HELP_CLOSE_KEY } from '../constants'
import { SHORTCUT_GROUPS, shortcutsOfGroup } from '../keymap'
import type { Keymap } from '../keymap'
import type { ExplorerActions, ViewElements } from './types'

export type HelpInput = { keymap: Keymap; problems: string[] }

export function renderHelp(ui: ViewElements, input: HelpInput, height: number, actions: ExplorerActions) {
  const { Box, Button, Text } = ui

  return (
    <Box flexDirection="column" height={height} overflow="hidden" borderStyle="round" borderColor={ui.theme.accentBorder} backgroundColor={ui.theme.panelBackground} paddingX={2}>
      <Box flexDirection="row">
        <Box flexGrow={1}>
          <Text bold color={ui.theme.heading}>
            Keyboard shortcuts
          </Text>
        </Box>
        <Button key={HELP_CLOSE_KEY} label="× close" onPress={() => actions.toggleHelp()} />
      </Box>
      <Box flexDirection="row" flexWrap="wrap" marginTop={1}>
        {SHORTCUT_GROUPS.map(group => (
          <Box key={`help-${group}`} flexDirection="column" width={46} marginBottom={1} marginRight={2}>
            <Text bold color={ui.theme.accent}>
              {group}
            </Text>
            {shortcutsOfGroup(group).map(shortcut => (
              <Box key={`help-${shortcut.action}`} flexDirection="row">
                <Box width={8} flexShrink={0}>
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
      <Text color={ui.theme.muted}>
        Enter on the line under the cursor asks about it too; Escape closes a question, then this help, then the pane.
      </Text>
      <Text color={ui.theme.muted}>Remap a key in /config, under diff-review (Key: …): one letter or digit, several comma separated.</Text>
      {input.problems.map(problem => (
        <Text key={`help-problem-${problem}`} color={ui.theme.removed}>
          {problem}
        </Text>
      ))}
    </Box>
  )
}
