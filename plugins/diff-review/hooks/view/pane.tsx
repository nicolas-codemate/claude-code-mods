import type { CommitGraphLine, ErrorNotice, PullRequestSummary, PushState, ReviewView } from '../../types'
import { COMMIT_PANEL_MAX_LINES, CURSOR_LINE_FOCUS_KEY, DIVIDER_KEY, MIN_PANE_COLUMNS, TWO_COLUMNS_MIN_WIDTH } from '../constants'
import { SHORTCUTS } from '../keymap'
import type { Keymap, ShortcutAction } from '../keymap'
import type { PaneGeometry } from '../layout'
import { pushLabelOf, renderCommitList } from './commits'
import { renderDiffView, renderLineShortcuts } from './diff'
import type { DiffViewInput } from './diff'
import type { HeaderTile } from './drawings'
import { isFiltered, renderFileList } from './file-list'
import type { FileListInput } from './file-list'
import { renderHeader } from './header'
import { renderHelp } from './help'
import { renderFileStats } from './labels'
import type { HelpInput } from './help'
import { renderOverview } from './overview'
import type { OverviewInput } from './overview'
import type { ExplorerActions, GitHubPage, ViewElements } from './types'
import { renderWatchBar } from './watch-bar'
import type { WatchBarInput } from './watch-bar'
import { renderCommitBar } from './commit-bar'
import type { CommitBarInput } from './commit-bar'
import { renderCommitMessage } from './commit-message'
import type { CommitMessageInput } from './commit-message'

export type PaneInput = {
  bodyRows: number
  bodyColumns: number
  geometry: PaneGeometry
  view: ReviewView
  location: string
  uncommittedFileCount: number
  branchCommitCount: number
  unpushedCommitShas: string[]
  pushState: PushState
  help: HelpInput | null
  loadError: string | null
  errorNotices: ErrorNotice[]
  pullRequest: PullRequestSummary | null
  viewedCount: { viewed: number; total: number }
  linesToView: { addedLines: number; removedLines: number }
  headerTiles: HeaderTile[]
  commitGraph: CommitGraphLine[]
  commitCount: number
  repositoryWebUrl: string | null
  gitHubPage: GitHubPage | null
  selectedCommitSha: string | null
  hotkeyOf: (action: ShortcutAction) => string | undefined
  idleShortcuts: { keymap: Keymap; claimedActions: ReadonlySet<ShortcutAction> } | null
  // Null while nothing is watched or being typed.
  watchBar: WatchBarInput | null
  commitBar: CommitBarInput | null
  commitMessage: CommitMessageInput | null
  fileList: Omit<FileListInput, 'width' | 'height' | 'isDrawer' | 'canPin'>
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
  const { Box, Button, Client, Text } = ui
  const { geometry } = input
  const shownGraphLines = input.commitGraph.slice(
    geometry.firstShownCommitLineIndex,
    geometry.firstShownCommitLineIndex + COMMIT_PANEL_MAX_LINES,
  )

  return (
    <Box flexDirection="column" backgroundColor={ui.theme.paneBackground} height={input.bodyRows} overflow="hidden">
      <Box key="cursor-line-box" display="none">
        <Button key={CURSOR_LINE_FOCUS_KEY} plain label="ask about the cursor's line" onPress={() => input.actions.askOnCursorLine()} />
      </Box>
      {renderHeader(ui, {
        view: input.view,
        location: input.location,
        uncommittedFileCount: input.uncommittedFileCount,
        branchCommitCount: input.branchCommitCount,
        unpushedCommitCount: input.unpushedCommitShas.length,
        pullRequest: input.pullRequest,
        viewedCount: input.viewedCount,
        linesToView: input.linesToView,
        tiles: input.headerTiles,
        bodyColumns: input.bodyColumns,
        gitHubPage: input.gitHubPage,
        hotkeyOf: input.hotkeyOf,
        actions: input.actions,
      })}
      {input.watchBar && renderWatchBar(ui, input.watchBar, input.hotkeyOf, input.actions)}
      {input.commitBar && renderCommitBar(ui, input.commitBar, input.hotkeyOf, input.actions)}
      {input.errorNotices.map(notice => (
        <Box
          key={`error-notice-${notice.id}`}
          flexDirection="row"
          flexShrink={0}
          height={3}
          marginX={1}
          borderStyle="round"
          borderColor={ui.theme.removed}
          paddingX={1}
        >
          <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
            <Text wrap="truncate-end">{notice.text}</Text>
          </Box>
          {notice.action === 'forcePush' && renderForcePushOfNotice(ui, notice.id, input.pushState, input.actions)}
          <Box key={`dismiss-error-box-${notice.id}`} flexShrink={0} marginLeft={1}>
            <Button
              key={`dismiss-error-${notice.id}`}
              plain
              hover={{ color: ui.theme.removed }}
              label="× dismiss"
              onPress={() => input.actions.dismissErrorNotice(notice.id)}
            />
          </Box>
        </Box>
      ))}
      {input.loadError && <Text color={ui.theme.removed}>{input.loadError}</Text>}
      {input.view === 'commits' &&
        renderCommitList(ui, {
          commitCount: input.commitCount,
          shownGraphLines,
          repositoryWebUrl: input.repositoryWebUrl,
          selectedCommitSha: input.selectedCommitSha,
          unpushedCommitShas: input.unpushedCommitShas,
          pushState: input.pushState,
          actions: input.actions,
        })}
      {input.commitMessage && renderCommitMessage(ui, input.commitMessage)}
      {input.help && renderHelp(ui, input.help, geometry.panelsHeight, input.bodyColumns, input.actions)}
      {geometry.isTwoColumns ? (
        <Box flexDirection="row" height={geometry.panelsHeight} display={input.help ? 'none' : 'flex'}>
          {renderFileList(ui, { ...input.fileList, width: geometry.fileListWidth, height: geometry.fileListBoxHeight, isDrawer: false, canPin: false })}
          <Client
            key={DIVIDER_KEY}
            module="./divider.tsx"
            props={{ rows: geometry.panelsHeight, color: ui.theme.border, draggingColor: ui.theme.accent }}
            width={1}
            height={geometry.panelsHeight}
          />
          {renderCodeBox(ui, input)}
        </Box>
      ) : (
        <Box flexDirection="column" height={geometry.panelsHeight} display={input.help ? 'none' : 'flex'}>
          {renderFileBar(ui, input)}
          <Box flexDirection="column" height={geometry.diffBoxHeight}>
            {renderCodeBox(ui, input)}
            {/* Closed, the drawer is still drawn hidden: its keys (files, filter, git add) keep working. */}
            <Box
              key="file-drawer-box"
              position="absolute"
              top={0}
              left={0}
              display={geometry.isFileDrawerOpen ? 'flex' : 'none'}
            >
              {renderFileList(ui, {
                ...input.fileList,
                width: geometry.fileListWidth,
                height: geometry.fileListBoxHeight,
                isDrawer: true,
                canPin: input.bodyColumns >= TWO_COLUMNS_MIN_WIDTH,
              })}
            </Box>
          </Box>
        </Box>
      )}
      {renderIdleShortcuts(ui, input)}
    </Box>
  )
}

function renderCodeBox(ui: ViewElements, input: PaneInput) {
  const { Box } = ui

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      height={input.geometry.diffBoxHeight}
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
  )
}

// Narrow or collapsed, the bar above the code says which file it shows and opens the file list over it.
function renderFileBar(ui: ViewElements, input: PaneInput) {
  const { Box, Button, Text } = ui
  const { fileList } = input
  const selectedFile = fileList.isOverviewShown ? undefined : fileList.files.find(file => file.path === fileList.selectedFilePath)
  const shownName = fileList.isOverviewShown && fileList.pullRequest ? 'Overview' : (selectedFile?.path ?? '')

  return (
    <Box flexDirection="row" height={1} paddingX={1} backgroundColor={ui.theme.headerBackground}>
      <Box key="file-drawer-toggle-box" flexShrink={0}>
        <Button
          key="file-drawer-toggle"
          plain
          hover={{ color: ui.theme.accent, bold: true }}
          label={`${input.geometry.isFileDrawerOpen ? '✕' : '≡'} Files ${isFiltered(fileList) ? `${fileList.shownFileCount} of ` : ''}${fileList.files.length}`}
          onPress={() => input.actions.toggleFileDrawer()}
        />
      </Box>
      {isFiltered(fileList) && (
        <Box flexShrink={0} marginLeft={1}>
          <Text color={ui.theme.filtered}>filtered</Text>
        </Box>
      )}
      <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden" marginLeft={2}>
        <Text color={ui.theme.heading} wrap="truncate-start">
          {shownName}
        </Text>
      </Box>
      {selectedFile && <Box flexShrink={0} marginLeft={1}>{renderFileStats(ui, selectedFile)}</Box>}
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

function renderForcePushOfNotice(ui: ViewElements, noticeId: string, pushState: PushState, actions: ExplorerActions) {
  const { Box, Button } = ui
  switch (pushState) {
    case 'rejected':
    case 'forceArmed':
      return (
        <Box key={`force-push-box-${noticeId}`} flexShrink={0} marginLeft={1}>
          <Button
            key={`force-push-${noticeId}`}
            variant={pushState === 'forceArmed' ? 'primary' : undefined}
            label={pushLabelOf(pushState, 0)}
            onPress={() => actions.pushBranch()}
          />
        </Box>
      )
    case 'idle':
    case 'armed':
    case 'pushing':
    case 'pushed':
      return null
  }
}
