import type { ChangedFile } from '../../types'
import type { ShortcutAction } from '../keymap'
import { imagesAsLinks } from '../markdown'
import type { ExplorerActions, ThreadNavigation, ViewElements } from './types'

// A picture's link opens it in the browser on a plain click, the one place that draws it and holds the GitHub login a
// private repository's attachment needs.
export function renderMarkdownWithImages(ui: ViewElements, key: string, markdown: string, actions: ExplorerActions) {
  const { Markdown } = ui
  const { markdown: text, imageUrls } = imagesAsLinks(markdown)
  if (imageUrls.length === 0) {
    return <Markdown key={key} text={text} />
  }

  return (
    <Markdown
      key={key}
      text={text}
      pressableLinks={imageUrls}
      onLinkPress={link => actions.openOnGitHub({ url: link.href, description: 'image' })}
    />
  )
}

// A key and what it does, as a plain Button with a hotkey reads, for a move the keyboard makes and a click would not.
export function renderShortcutHint(ui: ViewElements, key: string, label: string, isDim: boolean) {
  const { Text } = ui

  return (
    <Text dimColor={isDim}>
      <Text color={ui.theme.accent}>{key}</Text>: {label}
    </Text>
  )
}

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
