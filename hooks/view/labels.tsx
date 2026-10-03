import type { ChangedFile } from '../../types'
import type { ShortcutAction } from '../keymap'
import type { ExplorerActions, ThreadNavigation, ViewElements } from './types'

export function renderFileStats(ui: ViewElements, file: ChangedFile) {
  const { Text } = ui
  if (file.isUntracked) {
    return <Text color={ui.theme.added}>new</Text>
  }
  if (file.addedLines === null) {
    return <Text color={ui.theme.muted}>binary</Text>
  }

  return renderLineCounts(ui, file.addedLines, file.removedLines ?? 0)
}

export function renderLineCounts(ui: ViewElements, addedLines: number, removedLines: number) {
  const { Text } = ui

  return (
    <Text>
      <Text color={ui.theme.added}>+{addedLines}</Text> <Text color={ui.theme.removed}>-{removedLines}</Text>
    </Text>
  )
}

export function renderThreadNavigation(
  ui: ViewElements,
  threadNavigation: ThreadNavigation,
  hotkeyOf: (action: ShortcutAction) => string | undefined,
  actions: ExplorerActions,
) {
  const { Box, Button, Text } = ui
  if (threadNavigation.count === 0) {
    return null
  }
  const position = threadNavigation.position === null ? '–' : String(threadNavigation.position + 1)

  return (
    <Box flexDirection="row" flexShrink={0} marginRight={3}>
      <Text color={ui.theme.accent}>
        thread {position}/{threadNavigation.count}{' '}
      </Text>
      <Button key="thread-previous" plain hotkey={hotkeyOf('previousThread')} label="‹" onPress={() => actions.moveThread(-1)} />
      <Text> </Text>
      <Button key="thread-next" plain hotkey={hotkeyOf('nextThread')} label="›" onPress={() => actions.moveThread(1)} />
      {threadNavigation.currentGitHubThread && (
        <Box marginLeft={2}>
          <Button
            key="thread-toggle-resolved"
            plain
            hotkey={hotkeyOf('toggleThreadResolved')}
            label={threadNavigation.currentGitHubThread.isResolved ? '↺ unresolve' : '✓ resolve'}
            onPress={() => actions.toggleGitHubThreadResolved(threadNavigation.currentGitHubThread?.id ?? '')}
          />
        </Box>
      )}
    </Box>
  )
}
