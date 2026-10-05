import type { ChangedFile, DiffRow, GitHubReviewThread, ReviewThread, ReviewView } from '../../types'
import { ASK_BUTTON_KEY_PREFIX, ASK_ON_LINE_KEY, LINE_NUMBER_BUTTON_KEY_PREFIX } from '../constants'
import { isGitHubThreadOnRow, unplacedGitHubThreadsOf } from '../github-review'
import type { Keymap, ShortcutAction } from '../keymap'
import { anchorKeyOf } from '../questions'
import type { SplitRow, SplitSide } from '../split-rows'
import { languageOfPath } from '../syntax-language'
import { fileTypeBadgeOf } from './file-badges'
import { renderFileStats, renderShortcutHint, renderThreadNavigation } from './labels'
import { renderGitHubThread } from './github-threads'
import { ROW_MARKS, rowBackgroundOf, rowColorOf } from './theme'
import { renderThreadsAndQuestion } from './threads'
import type { ExplorerActions, QuestionState, ThreadNavigation, ViewElements } from './types'

// Wider than any pane: its box cuts it to the room left beside the hunk's heading.
const HUNK_RULE = '─'.repeat(400)

export type DiffViewInput = {
  view: ReviewView
  selectedCommitSha: string | null
  selectedFile: ChangedFile | undefined
  diffRows: DiffRow[]
  // The rows paired old against new when the side-by-side view is on, null in the unified view.
  splitRows: SplitRow[] | null
  canSplitView: boolean
  // The row the keyboard's line cursor is on, by its index in diffRows.
  cursorRowIndex: number | null
  hasLineShortcuts: boolean
  canMarkViewed: boolean
  // The keyboard went to a GitHub thread: asking then has Claude address it.
  isOnGitHubThread: boolean
  keymap: Keymap
  isWholeFile: boolean
  diffOffset: number
  visibleDiffRows: number
  threads: ReviewThread[]
  // The GitHub review conversations of the shown file, in the PR view.
  gitHubThreads: GitHubReviewThread[]
  expandedGitHubThreadIds: string[]
  currentThreadId: string | null
  questionState: QuestionState
  threadNavigation: ThreadNavigation
  hotkeyOf: (action: ShortcutAction) => string | undefined
  actions: ExplorerActions
}

export function renderDiffView(ui: ViewElements, input: DiffViewInput) {
  const { Box, Text } = ui
  const { selectedFile } = input
  if (!selectedFile) {
    return (
      <Box paddingX={1}>
        <Text color={ui.theme.muted}>Pick a file on the left.</Text>
      </Box>
    )
  }
  const shownEnd = input.diffOffset + input.visibleDiffRows
  const unplacedGitHubThreads = input.diffOffset === 0 ? unplacedGitHubThreadsOf(input.gitHubThreads, selectedFile.path, input.diffRows) : []

  return (
    <Box flexDirection="column">
      {renderFileHeader(ui, selectedFile, input)}
      {input.diffRows.length === 0 && (
        <Box paddingX={1}>
          <Text color={ui.theme.muted}>No textual change in this file.</Text>
        </Box>
      )}
      {unplacedGitHubThreads.map(thread => renderGitHubThread(ui, thread, gitHubThreadInputOf(input)))}
      {input.splitRows
        ? input.splitRows
            .slice(input.diffOffset, shownEnd)
            .map((splitRow, shownRowIndex) => renderSplitRow(ui, splitRow, input.diffOffset + shownRowIndex, selectedFile, input))
        : input.diffRows
            .slice(input.diffOffset, shownEnd)
            .map((row, shownRowIndex) => renderRow(ui, row, input.diffOffset + shownRowIndex, selectedFile, input))}
    </Box>
  )
}

function renderFileHeader(ui: ViewElements, file: ChangedFile, input: DiffViewInput) {
  const { Box, Button, Text } = ui
  const typeBadge = fileTypeBadgeOf(file.path)
  const rowCount = (input.splitRows ?? input.diffRows).length

  return (
    <Box flexDirection="row" flexShrink={0} backgroundColor={ui.theme.headerBackground} paddingX={1}>
      <Box width={4} flexShrink={0}>
        <Text color={typeBadge.color} bold>
          {typeBadge.badge}
        </Text>
      </Box>
      <Box flexGrow={1}>
        <Text bold color={ui.theme.heading} wrap="truncate-start">
          {file.path}
        </Text>
      </Box>
      {renderThreadNavigation(ui, input.threadNavigation, input.hotkeyOf, input.actions)}
      <Box flexShrink={0} marginRight={3}>
        <Button
          key="toggle-split-view"
          plain
          dimColor={!input.canSplitView}
          hotkey={input.hotkeyOf('toggleSplitView')}
          label={input.splitRows ? '≡ unified' : '⇆ split'}
          onPress={() => (input.canSplitView ? input.actions.toggleSplitView() : input.actions.explainSplitViewWidth())}
        />
      </Box>
      {rowCount > input.visibleDiffRows && (
        <Text color={ui.theme.muted}>
          {input.diffOffset + 1}–{Math.min(input.diffOffset + input.visibleDiffRows, rowCount)} / {rowCount}
          {'   '}
        </Text>
      )}
      {renderFileStats(ui, file)}
    </Box>
  )
}

function renderHunkHeader(ui: ViewElements, row: DiffRow, rowIndex: number, file: ChangedFile, input: DiffViewInput) {
  const { Box, Button, Text } = ui
  const canWidenContext = !file.isUntracked && !input.isWholeFile

  return (
    <Box key={`hunk-${rowIndex}`} flexDirection="row" paddingX={1} flexShrink={0} height={1}>
      <Box flexShrink={1} minWidth={0} overflow="hidden">
        <Text color={ui.theme.hunk} wrap="truncate-end">
          {'@@ '}
          {row.text}{' '}
        </Text>
      </Box>
      {/* No width of its own: the rule only fills what the context leaves, and a long context is cut instead. */}
      <Box flexGrow={1} flexShrink={0} width={0} height={1} overflow="hidden">
        <Text color={ui.theme.border} wrap="truncate-end">
          {HUNK_RULE}
        </Text>
      </Box>
      {canWidenContext && (
        <Box key={`hunk-actions-${rowIndex}`} flexDirection="row" flexShrink={0}>
          <Button
            key={`expand-context-${rowIndex}`}
            plain
            dimColor
            hover={{ color: ui.theme.accent }}
            label=" ↕ more context "
            onPress={() => input.actions.expandContext(file.path)}
          />
          <Button
            key={`whole-file-${rowIndex}`}
            plain
            dimColor
            hover={{ color: ui.theme.accent }}
            label=" whole file "
            onPress={() => input.actions.showWholeFile(file.path)}
          />
        </Box>
      )}
    </Box>
  )
}

function renderRow(ui: ViewElements, row: DiffRow, rowIndex: number, file: ChangedFile, input: DiffViewInput) {
  const { Box, Text } = ui
  if (row.kind === 'hunk') {
    return renderHunkHeader(ui, row, rowIndex, file, input)
  }
  const anchorKey = anchorKeyOf(input.view, input.selectedCommitSha, file.path, row)
  const lineNumbers = `${String(row.oldNumber ?? '').padStart(5)}${String(row.newNumber ?? '').padStart(5)}`
  const isCursor = rowIndex === input.cursorRowIndex

  return (
    <Box key={`row-${rowIndex}`} flexDirection="column" flexShrink={0}>
      <Box flexDirection="row" alignItems="flex-start" backgroundColor={isCursor ? ui.theme.cursorBackground : rowBackgroundOf(ui.theme, row.kind)}>
        {renderAskGutter(ui, rowIndex, anchorKey, isCursor, input)}
        {renderLineNumberButton(ui, rowIndex, anchorKey, lineNumbers, isCursor, input)}
        <Box flexShrink={0} height={1}>
          <Text color={rowColorOf(ui.theme, row.kind)}> {ROW_MARKS[row.kind]} </Text>
        </Box>
        {renderCode(ui, row, file.path)}
      </Box>
      {renderRowThreads(ui, row, rowIndex, file, input)}
    </Box>
  )
}

function renderSplitRow(ui: ViewElements, splitRow: SplitRow, splitIndex: number, file: ChangedFile, input: DiffViewInput) {
  const { Box } = ui
  if (splitRow.kind === 'hunk') {
    return renderHunkHeader(ui, splitRow.row, splitRow.rowIndex, file, input)
  }
  const { left, right } = splitRow
  // An unchanged line stands on both sides but is one line: its buttons and threads go with the right side only.
  const isSameRowOnBothSides = left !== null && left.rowIndex === right?.rowIndex
  const sidesWithThreads = [isSameRowOnBothSides ? null : left, right].flatMap(side => (side ? [side] : []))

  return (
    <Box key={`split-${splitIndex}`} flexDirection="column" flexShrink={0}>
      <Box flexDirection="row" alignItems="stretch">
        {renderSplitSide(ui, left, 'old', !isSameRowOnBothSides, file, input)}
        <Box width={1} flexShrink={0} backgroundColor={ui.theme.border} />
        {renderSplitSide(ui, right, 'new', true, file, input)}
      </Box>
      {sidesWithThreads.map(side => (
        <Box key={`threads-${side.rowIndex}`} flexDirection="column">
          {renderRowThreads(ui, side.row, side.rowIndex, file, input)}
        </Box>
      ))}
    </Box>
  )
}

function renderSplitSide(
  ui: ViewElements,
  side: SplitSide | null,
  version: 'old' | 'new',
  hasButtons: boolean,
  file: ChangedFile,
  input: DiffViewInput,
) {
  const { Box, Text } = ui
  if (side === null) {
    return <Box width="50%" flexGrow={1} minWidth={0} />
  }
  const { row, rowIndex } = side
  const anchorKey = anchorKeyOf(input.view, input.selectedCommitSha, file.path, row)
  const lineNumber = String((version === 'old' ? row.oldNumber : row.newNumber) ?? '').padStart(5)
  const isCursor = hasButtons && rowIndex === input.cursorRowIndex

  return (
    <Box width="50%" flexGrow={1} minWidth={0} flexDirection="row" alignItems="flex-start" backgroundColor={isCursor ? ui.theme.cursorBackground : rowBackgroundOf(ui.theme, row.kind)}>
      {hasButtons ? (
        renderAskGutter(ui, rowIndex, anchorKey, isCursor, input)
      ) : (
        <Box width={4} height={1} flexShrink={0} />
      )}
      {hasButtons ? (
        renderLineNumberButton(ui, rowIndex, anchorKey, lineNumber, isCursor, input)
      ) : (
        <Box flexShrink={0} height={1}>
          <Text color={ui.theme.lineNumber}>{lineNumber}</Text>
        </Box>
      )}
      <Box flexShrink={0} height={1}>
        <Text color={rowColorOf(ui.theme, row.kind)}> {ROW_MARKS[row.kind]} </Text>
      </Box>
      {renderCode(ui, row, file.path)}
    </Box>
  )
}

// The [+] shows under the pointer only; the line cursor's arrow sits in the same place otherwise.
function renderAskGutter(ui: ViewElements, rowIndex: number, anchorKey: string, isCursor: boolean, input: DiffViewInput) {
  const { Box, Button, Text } = ui

  return (
    <Box width={4} height={1} flexShrink={0}>
      {isCursor && (
        <Box position="absolute">
          <Text color={ui.theme.accent} bold>
            {' ▶'}
          </Text>
        </Box>
      )}
      <Box display="none" hover={{ display: 'flex' }} backgroundColor={ui.theme.panelBackground}>
        <Button key={`${ASK_BUTTON_KEY_PREFIX}${rowIndex}`} plain label="[+]" onPress={() => input.actions.openQuestion(anchorKey)} />
      </Box>
    </Box>
  )
}

function renderLineNumberButton(
  ui: ViewElements,
  rowIndex: number,
  anchorKey: string,
  label: string,
  isCursor: boolean,
  input: DiffViewInput,
) {
  const { Box, Button } = ui

  return (
    <Box flexShrink={0} height={1}>
      <Button
        key={`${LINE_NUMBER_BUTTON_KEY_PREFIX}${rowIndex}`}
        plain
        dimColor={!isCursor}
        hover={{ color: ui.theme.accent, bold: true }}
        label={label}
        onPress={() => input.actions.openQuestion(anchorKey)}
      />
    </Box>
  )
}

function renderCode(ui: ViewElements, row: DiffRow, path: string) {
  const { Box, Code, Text } = ui

  return (
    <Box flexGrow={1} flexShrink={1} minWidth={0} flexDirection="column">
      {row.text.trim() === '' ? <Text> </Text> : <Code source={row.text} path={path} language={row.language ?? languageOfPath(path)} wrap="wrap" />}
    </Box>
  )
}

function renderRowThreads(ui: ViewElements, row: DiffRow, rowIndex: number, file: ChangedFile, input: DiffViewInput) {
  const { Box } = ui
  const anchorKey = anchorKeyOf(input.view, input.selectedCommitSha, file.path, row)

  return (
    <Box flexDirection="column" flexShrink={0}>
      {input.gitHubThreads
        .filter(thread => isGitHubThreadOnRow(thread, file.path, row))
        .map(thread => renderGitHubThread(ui, thread, gitHubThreadInputOf(input)))}
      {renderThreadsAndQuestion(ui, {
        anchorKey,
        threads: input.threads,
        questionState: input.questionState,
        actions: input.actions,
        ask: question => input.actions.askAboutRow(anchorKey, rowIndex, question),
        armForPrompt: () => input.actions.armRowQuestion(anchorKey, rowIndex),
      })}
    </Box>
  )
}

function gitHubThreadInputOf(input: DiffViewInput) {
  return { expandedThreadIds: input.expandedGitHubThreadIds, currentThreadId: input.currentThreadId, actions: input.actions }
}

export function renderLineShortcuts(ui: ViewElements, input: DiffViewInput) {
  const { Box, Button } = ui
  const shortcuts: Array<{ key: string; action: ShortcutAction; label: string; isMove?: boolean; onPress: () => Promise<void> }> = [
    { key: 'cursor-down', action: 'nextLine', label: '↓ line', isMove: true, onPress: () => input.actions.moveCursor(1) },
    { key: 'cursor-up', action: 'previousLine', label: '↑ line', isMove: true, onPress: () => input.actions.moveCursor(-1) },
    { key: 'hunk-next', action: 'nextHunk', label: '↓ hunk', isMove: true, onPress: () => input.actions.moveCursorToHunk(1) },
    { key: 'hunk-previous', action: 'previousHunk', label: '↑ hunk', isMove: true, onPress: () => input.actions.moveCursorToHunk(-1) },
    { key: ASK_ON_LINE_KEY, action: 'askOnLine', label: input.isOnGitHubThread ? 'address comment' : 'ask', onPress: () => input.actions.askOnCursorLine() },
    { key: 'reply-on-line', action: 'replyOnLine', label: 'reply', onPress: () => input.actions.replyOnCursorLine() },
  ]
  const path = input.selectedFile?.path
  // Kept once the whole file shows: a shortcut whose button vanished would drop the keyboard back to the prompt.
  if (path && !input.selectedFile?.isUntracked) {
    shortcuts.push(
      { key: 'more-context', action: 'moreContext', label: 'context', onPress: () => input.actions.expandContext(path) },
      { key: 'whole-file', action: 'wholeFile', label: 'whole file', onPress: () => input.actions.showWholeFile(path) },
    )
  }
  if (input.canMarkViewed) {
    shortcuts.push({ key: 'mark-viewed-next', action: 'markViewedAndNext', label: 'viewed, next', onPress: () => input.actions.markViewedAndNext() })
  }

  return (
    <Box flexDirection="row" flexShrink={0} height={1} overflow="hidden" paddingX={1}>
      {shortcuts.map(shortcut => {
        const hotkey = input.hotkeyOf(shortcut.action)
        const typedKey = input.keymap[shortcut.action][0] ?? ''
        // A move only names its key; its hidden button carries it.
        if (shortcut.isMove) {
          return (
            <Box key={`box-${shortcut.key}`} marginRight={2} flexShrink={0}>
              {renderShortcutHint(ui, typedKey, shortcut.label, hotkey === undefined)}
              <Box display="none">
                <Button key={shortcut.key} plain hotkey={hotkey} label={shortcut.label} onPress={shortcut.onPress} />
              </Box>
            </Box>
          )
        }
        return (
          <Box key={`box-${shortcut.key}`} marginRight={2} flexShrink={0}>
            <Button
              key={shortcut.key}
              plain
              dimColor={hotkey === undefined}
              hotkey={hotkey}
              label={hotkey === undefined ? `${typedKey}: ${shortcut.label}` : shortcut.label}
              onPress={shortcut.onPress}
            />
          </Box>
        )
      })}
    </Box>
  )
}
