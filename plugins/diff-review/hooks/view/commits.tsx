import type { CommitGraphLine, PushState } from '../../types'
import { ROW_CLICK_TARGET_LENGTH } from '../constants'
import type { ExplorerActions, ViewElements } from './types'

export function renderCommitList(
  ui: ViewElements,
  input: {
    commitCount: number
    shownGraphLines: CommitGraphLine[]
    repositoryWebUrl: string | null
    selectedCommitSha: string | null
    unpushedCommitShas: string[]
    pushState: PushState
    actions: ExplorerActions
  },
) {
  const { Box, Button, Link, Text } = ui

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={ui.theme.border} backgroundColor={ui.theme.panelBackground} paddingX={1} marginBottom={1}>
      <Box flexDirection="row">
        <Box flexGrow={1}>
          <Text bold color={ui.theme.heading}>
            Branch commits <Text color={ui.theme.muted}>{input.commitCount}</Text>
          </Text>
        </Box>
        {(input.unpushedCommitShas.length > 0 || input.pushState !== 'idle') && (
          <Box key="push-branch-box" flexShrink={0}>
            {renderPushControl(ui, input.pushState, input.unpushedCommitShas.length, input.actions)}
          </Box>
        )}
      </Box>
      {input.commitCount === 0 && <Text color={ui.theme.muted}>No commit since the base.</Text>}
      {input.shownGraphLines.map((line, lineIndex) => {
        const { commit } = line
        if (!commit) {
          return (
            <Box key={`graph-${lineIndex}`} flexDirection="row" height={1}>
              <Text color={ui.theme.muted}> {line.graph}</Text>
            </Box>
          )
        }
        const isSelected = !line.isBoundary && commit.sha === input.selectedCommitSha
        const shortSha = input.repositoryWebUrl ? (
          <Link href={`${input.repositoryWebUrl}/commit/${commit.sha}`}>{commit.shortSha}</Link>
        ) : (
          commit.shortSha
        )
        return (
          <Box key={`graph-${lineIndex}`} flexDirection="row" height={1} backgroundColor={isSelected ? ui.theme.selectedBackground : undefined}>
            <Text color={isSelected ? ui.theme.accent : ui.theme.muted}>{isSelected ? '▌' : ' '}</Text>
            <Box flexShrink={0} flexDirection="row">
              <Text color={ui.theme.hunk}>{line.graph} </Text>
              <Text color={ui.theme.commitSha}>{shortSha} </Text>
              {commit.refs.length > 0 && <Text color={ui.theme.directory}>({commit.refs.join(', ')}) </Text>}
              {!line.isBoundary && input.unpushedCommitShas.includes(commit.sha) && <Text color={ui.theme.accent}>↑ not pushed </Text>}
            </Box>
            <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
              {line.isBoundary ? (
                <Text color={ui.theme.muted} wrap="truncate-end">
                  {commit.subject}
                </Text>
              ) : (
                <Button
                  key={`commit-${commit.sha}`}
                  plain
                  label={commit.subject.padEnd(ROW_CLICK_TARGET_LENGTH)}
                  onPress={() => input.actions.selectCommit(commit.sha)}
                />
              )}
            </Box>
            <Box flexShrink={0}>
              <Text color={ui.theme.muted}>
                {'  '}
                {commit.author}, {commit.relativeDate}
              </Text>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

function renderPushControl(ui: ViewElements, pushState: PushState, unpushedCommitCount: number, actions: ExplorerActions) {
  const { Button, Text } = ui
  switch (pushState) {
    case 'pushing':
      return <Text color={ui.theme.muted}>pushing…</Text>
    case 'pushed':
      return <Text color={ui.theme.added}>✓ pushed</Text>
    case 'idle':
    case 'armed':
    case 'rejected':
    case 'forceArmed':
      return (
        <Button
          key="push-branch"
          variant={pushState === 'armed' || pushState === 'forceArmed' ? 'primary' : undefined}
          label={pushLabelOf(pushState, unpushedCommitCount)}
          onPress={() => actions.pushBranch()}
        />
      )
  }
}

function pushLabelOf(pushState: 'idle' | 'armed' | 'rejected' | 'forceArmed', unpushedCommitCount: number): string {
  switch (pushState) {
    case 'idle':
      return `↑ push ${unpushedCommitCount} commit${unpushedCommitCount > 1 ? 's' : ''}`
    case 'armed':
      return '↑ press again to push'
    case 'rejected':
      return '⚠ force push (with lease)'
    case 'forceArmed':
      return '⚠ press again to force push'
  }
}
