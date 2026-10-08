import type { CommitGraphLine } from '../../types'
import { ROW_CLICK_TARGET_LENGTH } from '../constants'
import { DESKTOP_PIXELS_PER_COLUMN, GRAPH_ROW_PIXELS, commitGraphRowSvg } from './drawings'
import type { ExplorerActions, ViewElements } from './types'

export function renderCommitList(
  ui: ViewElements,
  input: {
    commitCount: number
    commitGraph: CommitGraphLine[]
    firstShownLineIndex: number
    shownGraphLines: CommitGraphLine[]
    repositoryWebUrl: string | null
    selectedCommitSha: string | null
    unpushedCommitShas: string[]
    pushState: 'idle' | 'armed' | 'pushing'
    actions: ExplorerActions
  },
) {
  const { Box, Button, Link, Svg, Text } = ui
  const graphColumns = Math.max(1, ...input.commitGraph.map(line => line.graph.length))
  // On the Desktop the lanes are drawn, all rows as wide as the widest so the commits line up; the terminal keeps
  // git's own characters.
  const renderGraph = (lineIndex: number, isSelected: boolean, graphText: string) =>
    Svg ? (
      <Box flexShrink={0} height={1} marginRight={1} flexDirection="column" justifyContent="center" overflow="hidden">
        <Svg
          source={commitGraphRowSvg(ui.theme, input.commitGraph, input.firstShownLineIndex + lineIndex, graphColumns, isSelected)}
          alt={graphText}
          width={graphColumns * DESKTOP_PIXELS_PER_COLUMN}
          height={GRAPH_ROW_PIXELS}
        />
      </Box>
    ) : (
      <Text color={ui.theme.hunk}>{graphText} </Text>
    )

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={ui.theme.border} backgroundColor={ui.theme.panelBackground} paddingX={1} marginBottom={1}>
      <Box flexDirection="row">
        <Box flexGrow={1}>
          <Text bold color={ui.theme.heading}>
            Branch commits <Text color={ui.theme.muted}>{input.commitCount}</Text>
          </Text>
        </Box>
        {input.unpushedCommitShas.length > 0 && (
          <Box key="push-branch-box" flexShrink={0}>
            <Button
              key="push-branch"
              variant={input.pushState === 'armed' ? 'primary' : undefined}
              label={pushLabelOf(input.pushState, input.unpushedCommitShas.length)}
              onPress={() => input.actions.pushBranch()}
            />
          </Box>
        )}
      </Box>
      {input.commitCount === 0 && <Text color={ui.theme.muted}>No commit since the base.</Text>}
      {input.shownGraphLines.map((line, lineIndex) => {
        const { commit } = line
        if (!commit) {
          return (
            <Box key={`graph-${lineIndex}`} flexDirection="row" height={1}>
              <Text color={ui.theme.muted}> {Svg ? '' : line.graph}</Text>
              {Svg && renderGraph(lineIndex, false, line.graph)}
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
              {renderGraph(lineIndex, isSelected, line.graph)}
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

function pushLabelOf(pushState: 'idle' | 'armed' | 'pushing', unpushedCommitCount: number): string {
  switch (pushState) {
    case 'idle':
      return `↑ push ${unpushedCommitCount} commit${unpushedCommitCount > 1 ? 's' : ''}`
    case 'armed':
      return '↑ press again to push'
    case 'pushing':
      return 'pushing…'
  }
}
