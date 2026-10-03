import type { PullRequestSummary, ReviewView } from '../../types'
import { VIEW_LABELS, VIEW_ORDER, VIEW_SHORTCUTS } from '../constants'
import type { ShortcutAction } from '../keymap'
import type { ExplorerActions, GitHubPage, ViewElements } from './types'

export function renderHeader(
  ui: ViewElements,
  input: {
    view: ReviewView
    location: string
    activeViewCount: number
    pullRequest: PullRequestSummary | null
    viewedCount: { viewed: number; total: number }
    gitHubPage: GitHubPage | null
    hotkeyOf: (action: ShortcutAction) => string | undefined
    actions: ExplorerActions
  },
) {
  const { Box, Button, Link, Text } = ui
  const { gitHubPage, pullRequest, viewedCount } = input

  return (
    <Box flexDirection="row" alignItems="center">
      {VIEW_ORDER.map(view => {
        const isActive = view === input.view
        return (
          <Box
            key={`tab-${view}`}
            flexShrink={0}
            borderStyle="round"
            borderColor={isActive ? ui.theme.accent : ui.theme.border}
            backgroundColor={isActive ? ui.theme.activeTabBackground : undefined}
            marginRight={1}
          >
            <Button
              key={`view-${view}`}
              plain
              dimColor={!isActive}
              hotkey={input.hotkeyOf(VIEW_SHORTCUTS[view])}
              label={` ${VIEW_LABELS[view]}${isActive ? ` ${input.activeViewCount}` : ''} `}
              onPress={() => input.actions.switchView(view)}
            />
          </Box>
        )
      })}
      <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden" height={1} marginLeft={1}>
        <Text color={ui.theme.muted} wrap="truncate-start">
          {input.location}
        </Text>
      </Box>
      {pullRequest && (
        <Box marginLeft={1} flexShrink={0}>
          <Text color={ui.theme.accent} bold>
            <Link href={pullRequest.url}>PR #{pullRequest.number}</Link>
          </Text>
          <Text color={viewedCount.viewed === viewedCount.total ? ui.theme.added : ui.theme.muted}>
            {'  '}viewed {viewedCount.viewed}/{viewedCount.total}
          </Text>
        </Box>
      )}
      {gitHubPage && (
        <Box borderStyle="round" borderColor={ui.theme.border} backgroundColor={ui.theme.panelBackground} marginLeft={1} flexShrink={0}>
          <Button
            key="open-on-github"
            plain
            hotkey={input.hotkeyOf('openOnGitHub')}
            label={` ${gitHubPage.description} on GitHub ↗ `}
            onPress={() => input.actions.openOnGitHub(gitHubPage)}
          />
        </Box>
      )}
      <Box borderStyle="round" borderColor={ui.theme.border} backgroundColor={ui.theme.panelBackground} marginLeft={1} flexShrink={0}>
        <Button key="help" plain hotkey={input.hotkeyOf('toggleHelp')} label=" help " onPress={() => input.actions.toggleHelp()} />
      </Box>
      <Box borderStyle="round" borderColor={ui.theme.border} backgroundColor={ui.theme.panelBackground} marginLeft={1} flexShrink={0}>
        <Button key="refresh" plain label=" refresh " onPress={() => input.actions.refresh()} />
      </Box>
      <Box borderStyle="round" borderColor={ui.theme.border} backgroundColor={ui.theme.panelBackground} marginLeft={1} flexShrink={0}>
        <Button key="close" plain label=" close " onPress={() => input.actions.close()} />
      </Box>
    </Box>
  )
}

