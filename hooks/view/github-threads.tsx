import type { GitHubReviewThread } from '../../types'
import { ROW_CLICK_TARGET_LENGTH } from '../constants'
import type { ExplorerActions, ViewElements } from './types'

const GITHUB_THREAD_INDENT = 16

export type GitHubThreadInput = { expandedThreadIds: string[]; currentThreadId: string | null; actions: ExplorerActions }

// A resolved conversation folds to one line, as GitHub shows it, until opened or reached with the keyboard.
export function renderGitHubThread(ui: ViewElements, thread: GitHubReviewThread, input: GitHubThreadInput) {
  const { Box, Button, Link, Markdown, Text } = ui
  const firstComment = thread.comments[0]
  const isCurrent = thread.id === input.currentThreadId
  const isFolded = thread.isResolved && !isCurrent && !input.expandedThreadIds.includes(thread.id)
  const borderColor = isCurrent ? ui.theme.accent : ui.theme.gitHubThreadBorder
  const status = [
    thread.isResolved ? 'resolved' : null,
    thread.isOutdated ? `outdated${thread.originalLine ? `, was line ${thread.originalLine}` : ''}` : null,
    thread.comments.length > 1 ? `${thread.comments.length} comments` : null,
  ]
    .filter(part => part !== null)
    .join(' · ')
  if (isFolded) {
    const summary = `▸ GitHub · ${status} · @${firstComment?.author ?? 'ghost'}: ${plainFirstLineOf(firstComment?.body ?? '')}`
    return (
      <Box key={`github-thread-${thread.id}`} flexShrink={0} marginLeft={GITHUB_THREAD_INDENT} height={1} overflow="hidden">
        <Button
          key={`github-thread-toggle-${thread.id}`}
          plain
          dimColor={!isCurrent}
          label={summary.padEnd(ROW_CLICK_TARGET_LENGTH)}
          onPress={() => input.actions.toggleGitHubThread(thread.id)}
        />
      </Box>
    )
  }

  return (
    <Box
      key={`github-thread-${thread.id}`}
      flexDirection="column"
      flexShrink={0}
      marginLeft={GITHUB_THREAD_INDENT}
      marginRight={2}
      marginY={1}
      borderStyle="round"
      borderColor={borderColor}
      backgroundColor={ui.theme.gitHubThreadBackground}
      paddingX={1}
    >
      <Box flexDirection="row">
        <Box flexGrow={1} flexShrink={1} minWidth={0}>
          <Text color={ui.theme.gitHubThread} bold wrap="truncate-end">
            ● GitHub{status ? <Text color={ui.theme.muted}> · {status}</Text> : null}
          </Text>
        </Box>
        {firstComment?.url && (
          <Box flexShrink={0} marginLeft={1}>
            <Text color={ui.theme.accent}>
              <Link href={firstComment.url}>open ↗</Link>
            </Text>
          </Box>
        )}
        <Box key={`github-thread-resolve-box-${thread.id}`} flexShrink={0} marginLeft={2}>
          <Button
            key={`github-thread-resolve-${thread.id}`}
            plain
            dimColor
            hover={{ color: ui.theme.accent }}
            label={thread.isResolved ? '↺ unresolve' : '✓ resolve'}
            onPress={() => input.actions.toggleGitHubThreadResolved(thread.id)}
          />
        </Box>
        {thread.isResolved && (
          <Box flexShrink={0} marginLeft={2}>
            <Button
              key={`github-thread-toggle-${thread.id}`}
              plain
              label="▾ fold"
              onPress={() => input.actions.toggleGitHubThread(thread.id)}
            />
          </Box>
        )}
      </Box>
      {thread.comments.map((comment, commentIndex) => (
        <Box key={`comment-${commentIndex}`} flexDirection="column" flexShrink={0} marginTop={commentIndex === 0 ? 0 : 1}>
          <Text>
            <Text color={ui.theme.commitSha} bold>
              @{comment.author}
            </Text>
            <Text color={ui.theme.muted}> · {comment.createdAt.slice(0, 10)}</Text>
          </Text>
          <Markdown text={comment.body} />
        </Box>
      ))}
    </Box>
  )
}

function plainFirstLineOf(markdown: string): string {
  return (markdown.split('\n')[0] ?? '').replace(/[*_`~]+/g, '').replace(/^#+\s*/, '')
}
