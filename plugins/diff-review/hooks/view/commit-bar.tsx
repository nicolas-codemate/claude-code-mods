import type { CommitRequest, ReviewThread } from '../../types'
import type { ShortcutAction } from '../keymap'
import { ARMED_BANNER_ROWS, THREAD_HORIZONTAL_CHROME_WITHOUT_INDENT, threadHeight } from './row-height'
import { renderArmedBanner, renderThread } from './threads'
import type { ExplorerActions, ViewElements } from './types'

export type CommitBarInput = {
  stagedFileCount: number
  commitRequest: CommitRequest
  // Claude's answers to the commit request and the person's replies, drawn as a line's thread is.
  thread: ReviewThread | null
  isReplyArmed: boolean
  isAnswerPulseLit: boolean
}

const COMMIT_BAR_MARGIN_COLUMNS = 2
const COMMIT_ACTION_ROWS = 1

export function commitBarRows(input: CommitBarInput, bodyColumns: number): number {
  const threadTextWidth = bodyColumns - COMMIT_BAR_MARGIN_COLUMNS - THREAD_HORIZONTAL_CHROME_WITHOUT_INDENT

  return (
    COMMIT_ACTION_ROWS + (input.thread ? threadHeight(input.thread, threadTextWidth) : 0) + (input.isReplyArmed ? ARMED_BANNER_ROWS : 0)
  )
}

export function renderCommitBar(
  ui: ViewElements,
  input: CommitBarInput,
  hotkeyOf: (action: ShortcutAction) => string | undefined,
  actions: ExplorerActions,
) {
  const { Box } = ui

  return (
    <Box key="commit-bar" flexDirection="column" flexShrink={0} marginX={1}>
      {renderCommitAction(ui, input, hotkeyOf, actions)}
      {input.thread && renderThread(ui, input.thread, actions, input.isAnswerPulseLit, 0)}
      {input.isReplyArmed && renderArmedBanner(ui, actions, 0)}
    </Box>
  )
}

function renderCommitAction(
  ui: ViewElements,
  input: CommitBarInput,
  hotkeyOf: (action: ShortcutAction) => string | undefined,
  actions: ExplorerActions,
) {
  const { Box, Button, Text } = ui
  switch (input.commitRequest.state) {
    case 'requested':
      return (
        <Box key="commit-action" height={1}>
          <Text color={ui.theme.muted}>Claude is committing…</Text>
        </Box>
      )
    case 'idle':
    case 'awaitingReply':
      return (
        <Box key="commit-action" flexDirection="row" height={1}>
          {input.stagedFileCount > 0 && (
            <Box flexShrink={0}>
              <Button
                key="commit"
                variant="primary"
                hotkey={hotkeyOf('commitStaged')}
                label={`✓ commit ${input.stagedFileCount} staged file${input.stagedFileCount === 1 ? '' : 's'}`}
                onPress={() => actions.requestCommit()}
              />
            </Box>
          )}
          {input.commitRequest.state === 'awaitingReply' && (
            <Text color={ui.theme.muted} wrap="truncate-end">
              {'  '}Claude awaits your reply
            </Text>
          )}
        </Box>
      )
  }
}
