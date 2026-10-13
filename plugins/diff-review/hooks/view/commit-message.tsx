import type { CommitSummary } from '../../types'
import { wrappedLineCount } from './row-height'
import type { ViewElements } from './types'

export type CommitMessageInput = { commit: CommitSummary; message: string }

// A long body stops after a few lines: the diff below is what the view is for.
const MESSAGE_MAX_LINES = 8
// The box's border and padding, across and down, and the line of the commit's sha, author and date.
const MESSAGE_HORIZONTAL_CHROME = 2 + 2
const MESSAGE_VERTICAL_CHROME = 2 + 1
const MESSAGE_BOTTOM_MARGIN = 1

// A control character in a text would stop the whole pane from being drawn: a message is shown without them.
export function shownMessageLinesOf(message: string): string[] {
  const lines = message
    .trimEnd()
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
    .split('\n')

  return lines.length > MESSAGE_MAX_LINES ? [...lines.slice(0, MESSAGE_MAX_LINES - 1), '…'] : lines
}

export function commitMessageRows(input: CommitMessageInput, bodyColumns: number): number {
  const textWidth = bodyColumns - MESSAGE_HORIZONTAL_CHROME
  const messageRows = shownMessageLinesOf(input.message).reduce((rows, line) => rows + wrappedLineCount(line, textWidth), 0)

  return MESSAGE_VERTICAL_CHROME + messageRows + MESSAGE_BOTTOM_MARGIN
}

export function renderCommitMessage(ui: ViewElements, input: CommitMessageInput) {
  const { Box, Text } = ui
  const [subject = '', ...body] = shownMessageLinesOf(input.message)

  return (
    <Box
      key="commit-message"
      flexDirection="column"
      flexShrink={0}
      borderStyle="round"
      borderColor={ui.theme.border}
      backgroundColor={ui.theme.panelBackground}
      paddingX={1}
      marginBottom={MESSAGE_BOTTOM_MARGIN}
    >
      <Text color={ui.theme.muted}>
        <Text color={ui.theme.commitSha}>{input.commit.shortSha}</Text> · {input.commit.author} · {input.commit.relativeDate}
      </Text>
      <Text bold color={ui.theme.heading}>
        {subject}
      </Text>
      {body.map((line, lineIndex) => (
        <Text key={`commit-message-line-${lineIndex}`}>{line === '' ? ' ' : line}</Text>
      ))}
    </Box>
  )
}
