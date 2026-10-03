import type { CommitGraphLine, PullRequestSummary, ReviewView } from '../../types'
import { COMMIT_PANEL_MAX_LINES, DIVIDER_KEY, MIN_PANE_COLUMNS } from '../constants'
import { SHORTCUTS } from '../keymap'
import type { Keymap, ShortcutAction } from '../keymap'
import type { PaneGeometry } from '../layout'
import { renderCommitList } from './commits'
import { renderDiffView, renderLineShortcuts } from './diff'
import type { DiffViewInput } from './diff'
import { renderFileList } from './file-list'
import type { FileListInput } from './file-list'
import { renderHeader } from './header'
import { renderHelp } from './help'
import type { HelpInput } from './help'
import { renderOverview } from './overview'
import type { OverviewInput } from './overview'
import type { ExplorerActions, GitHubPage, ViewElements } from './types'

export type PaneInput = {
  bodyRows: number
  geometry: PaneGeometry
  view: ReviewView
  location: string
  activeViewCount: number
  help: HelpInput | null
  loadError: string | null
  pullRequest: PullRequestSummary | null
  viewedCount: { viewed: number; total: number }
  commitGraph: CommitGraphLine[]
  commitCount: number
  repositoryWebUrl: string | null
  gitHubPage: GitHubPage | null
  selectedCommitSha: string | null
  hotkeyOf: (action: ShortcutAction) => string | undefined
  idleShortcuts: { keymap: Keymap; claimedActions: ReadonlySet<ShortcutAction> } | null
  fileList: Omit<FileListInput, 'width' | 'height'>
  overview: OverviewInput | null
  diff: DiffViewInput
  actions: ExplorerActions
}

export function renderNarrowPane(ui: ViewElements, bodyColumns: number) {
  const { Box, Text } = ui

  return (
    <Box flexDirection="column" padding={1}>
      <Text color={ui.theme.commitSha} bold>
        The review pane needs at least {MIN_PANE_COLUMNS} columns (now {bodyColumns}).
      </Text>
      <Text color={ui.theme.muted}>Widen it by dragging the divider, or widen the terminal.</Text>
    </Box>
  )
}

export function renderPane(ui: ViewElements, input: PaneInput) {
  const { Box, Client, Text } = ui
  const { geometry } = input
  const shownGraphLines = input.commitGraph.slice(
    geometry.firstShownCommitLineIndex,
    geometry.firstShownCommitLineIndex + COMMIT_PANEL_MAX_LINES,
  )

  return (
    <Box flexDirection="column" backgroundColor={ui.theme.paneBackground} height={input.bodyRows} overflow="hidden">
      {renderHeader(ui, {
        view: input.view,
        location: input.location,
        activeViewCount: input.activeViewCount,
        pullRequest: input.pullRequest,
        viewedCount: input.viewedCount,
        gitHubPage: input.gitHubPage,
        hotkeyOf: input.hotkeyOf,
        actions: input.actions,
      })}
      {input.loadError && <Text color={ui.theme.removed}>{input.loadError}</Text>}
      {input.view === 'commits' &&
        renderCommitList(ui, {
          commitCount: input.commitCount,
          shownGraphLines,
          repositoryWebUrl: input.repositoryWebUrl,
          selectedCommitSha: input.selectedCommitSha,
          actions: input.actions,
        })}
      {input.help && renderHelp(ui, input.help, geometry.panelsHeight, input.actions)}
      <Box
        flexDirection={geometry.isTwoColumns ? 'row' : 'column'}
        height={geometry.panelsHeight}
        display={input.help ? 'none' : 'flex'}
      >
        {renderFileList(ui, {
          ...input.fileList,
          width: geometry.isTwoColumns ? geometry.fileListWidth : undefined,
          height: geometry.fileListBoxHeight,
        })}
        {geometry.isTwoColumns && (
          <Client
            key={DIVIDER_KEY}
            module="./divider.tsx"
            props={{ rows: geometry.panelsHeight, color: ui.theme.border, draggingColor: ui.theme.accent }}
            width={1}
            height={geometry.panelsHeight}
          />
        )}
        <Box
          flexDirection="column"
          flexGrow={1}
          height={geometry.diffBoxHeight}
          overflow="hidden"
          borderStyle="round"
          borderColor={ui.theme.border}
          backgroundColor={ui.theme.panelBackground}
        >
          <Box flexDirection="column" flexGrow={1} overflow="hidden">
            {input.overview ? renderOverview(ui, input.overview) : renderDiffView(ui, input.diff)}
          </Box>
          {!input.overview && input.diff.hasLineShortcuts && renderLineShortcuts(ui, input.diff)}
        </Box>
      </Box>
      {renderIdleShortcuts(ui, input)}
    </Box>
  )
}

// A key the pane binds nowhere goes on to the prompt and takes the keyboard with it: every shortcut with no button on
// screen gets a hidden one that only says it does nothing here. Drawn last, once every other button claimed its own.
function renderIdleShortcuts(ui: ViewElements, input: PaneInput) {
  const { Box, Button } = ui
  const idleShortcuts = input.idleShortcuts
  if (idleShortcuts === null) {
    return null
  }

  return (
    <Box key="idle-shortcuts" display="none">
      {SHORTCUTS.filter(shortcut => !idleShortcuts.claimedActions.has(shortcut.action)).map(shortcut => (
        <Button
          key={`idle-${shortcut.action}`}
          plain
          hotkey={idleShortcuts.keymap[shortcut.action][0]}
          label={shortcut.description}
          onPress={() => input.actions.explainIdleShortcut(shortcut.description)}
        />
      ))}
    </Box>
  )
}
