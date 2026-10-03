import type { ChangedFile, PullRequestSummary, ViewedState } from '../../types'
import { FILE_BUTTON_KEY_PREFIX, FILE_FILTER_KEY, PULL_REQUEST_OVERVIEW_KEY, ROW_CLICK_TARGET_LENGTH } from '../constants'
import type { Keymap, ShortcutAction } from '../keymap'
import { fileNameOf } from '../git-parsing'
import { VIEWED_MARKS } from '../github-review'
import type { FileLine } from '../layout'
import { renderFileStats, renderLineCounts } from './labels'
import type { ExplorerActions, ViewElements } from './types'

export type FileListInput = {
  files: ChangedFile[]
  shownFileCount: number
  hiddenNoiseCount: number
  fileFilter: string
  isNoiseShown: boolean
  fileLines: FileLine[]
  shownFileLines: FileLine[]
  fileListOffset: number
  visibleFileLines: number
  width: number | undefined
  height: number
  selectedFilePath: string | null
  isOverviewShown: boolean
  pullRequest: PullRequestSummary | null
  viewedStateByPath: Record<string, ViewedState>
  hasUntrackedFiles: boolean
  hasStageActions: boolean
  markedPaths: string[]
  keymap: Keymap
  isTyping: boolean
  hotkeyOf: (action: ShortcutAction) => string | undefined
  actions: ExplorerActions
}

export function renderFileList(ui: ViewElements, input: FileListInput) {
  const { Box, Text } = ui
  const hasMoreAbove = input.fileListOffset > 0
  const hasMoreBelow = input.fileListOffset + input.visibleFileLines < input.fileLines.length

  return (
    <Box
      flexDirection="column"
      width={input.width}
      height={input.height}
      overflow="hidden"
      borderStyle="round"
      borderColor={ui.theme.border}
      backgroundColor={ui.theme.panelBackground}
      paddingX={1}
    >
      <Box flexDirection="row">
        <Box flexGrow={1}>
          <Text bold color={ui.theme.heading}>
            Files{'  '}
            <Text color={ui.theme.muted}>
              {input.shownFileCount === input.files.length ? input.files.length : `${input.shownFileCount} of ${input.files.length}`}
            </Text>
          </Text>
        </Box>
        <Text color={ui.theme.muted}>
          {hasMoreAbove ? '▲' : ' '}
          {hasMoreBelow ? '▼' : ' '}
        </Text>
      </Box>
      {renderFilter(ui, input)}
      <Box flexDirection="column" height={input.visibleFileLines} overflow="hidden">
        {input.files.length === 0 && <Text color={ui.theme.muted}>Nothing to review in this view.</Text>}
        {input.files.length > 0 && input.shownFileCount === 0 && <Text color={ui.theme.muted}>No file matches the filter.</Text>}
        {input.shownFileLines.map(fileLine => renderFileLine(ui, fileLine, input))}
      </Box>
      {(input.hiddenNoiseCount > 0 || input.isNoiseShown) && renderNoiseNotice(ui, input)}
      {renderNavigationHints(ui, input)}
      {input.hasStageActions && renderStageActions(ui, input)}
    </Box>
  )
}

function renderFilter(ui: ViewElements, input: FileListInput) {
  const { Box, Button, Input } = ui

  return (
    <Box flexDirection="row" height={1}>
      <Box flexShrink={0}>
        <Button key="focus-file-filter" plain hotkey={input.hotkeyOf('focusFileFilter')} label="/ " onPress={() => input.actions.focusFileFilter()} />
      </Box>
      <Box flexGrow={1}>
        <Input
          key={FILE_FILTER_KEY}
          value={input.fileFilter}
          placeholder="filter files…"
          onInput={value => input.actions.updateFileFilter(value)}
          onSubmit={value => input.actions.submitFileFilter(value)}
        />
      </Box>
    </Box>
  )
}

function renderNoiseNotice(ui: ViewElements, input: FileListInput) {
  const { Box, Button, Text } = ui

  return (
    <Box key="noise-notice" flexDirection="row" height={1} overflow="hidden">
      <Box flexGrow={1}>
        <Text color={ui.theme.muted}>
          {input.isNoiseShown ? 'lockfiles and generated files shown' : `+ ${input.hiddenNoiseCount} lockfile or generated file${input.hiddenNoiseCount > 1 ? 's' : ''} folded`}
        </Text>
      </Box>
      <Button key="toggle-noise" plain hover={{ color: ui.theme.accent }} label={input.isNoiseShown ? ' fold ' : ' show '} onPress={() => input.actions.toggleNoiseShown()} />
    </Box>
  )
}

function renderFileLine(ui: ViewElements, fileLine: FileLine, input: FileListInput) {
  const { Text } = ui
  if (fileLine.kind === 'spacer') {
    return <Text> </Text>
  }
  if (fileLine.kind === 'directory') {
    return (
      <Text color={ui.theme.directory} wrap="truncate-start">
        ▾ {fileLine.directory === '' ? './' : `${fileLine.directory}/`}
      </Text>
    )
  }
  if (fileLine.kind === 'overview') {
    return renderOverviewLine(ui, input)
  }

  return renderChangedFileLine(ui, fileLine.file, input)
}

function renderSelectionMark(ui: ViewElements, isSelected: boolean) {
  const { Box, Text } = ui

  return (
    <Box width={2} flexShrink={0}>
      <Text color={ui.theme.accent}>{isSelected ? '▎' : ' '}</Text>
    </Box>
  )
}

function renderOverviewLine(ui: ViewElements, input: FileListInput) {
  const { Box, Button, Text } = ui

  return (
    <Box flexDirection="row" height={1} backgroundColor={input.isOverviewShown ? ui.theme.selectedBackground : undefined}>
      {renderSelectionMark(ui, input.isOverviewShown)}
      <Box width={4} flexShrink={0}>
        <Text color={ui.theme.accent} bold>
          ☰
        </Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} height={1} overflow="hidden">
        <Button key={PULL_REQUEST_OVERVIEW_KEY} plain label={'Overview'.padEnd(ROW_CLICK_TARGET_LENGTH)} onPress={() => input.actions.showOverview()} />
      </Box>
      <Box flexShrink={0} marginLeft={1}>
        {renderLineCounts(ui, input.pullRequest?.additions ?? 0, input.pullRequest?.deletions ?? 0)}
      </Box>
    </Box>
  )
}

function renderChangedFileLine(ui: ViewElements, file: ChangedFile, input: FileListInput) {
  const { Box, Button, Text } = ui
  const isSelected = !input.isOverviewShown && file.path === input.selectedFilePath
  const viewedState = input.viewedStateByPath[file.path]
  const change = changeLetterOf(file)

  return (
    <Box flexDirection="row" height={1} backgroundColor={isSelected ? ui.theme.selectedBackground : undefined}>
      {renderSelectionMark(ui, isSelected)}
      {input.hasUntrackedFiles && (
        <Box width={6} flexShrink={0}>
          {file.isUntracked ? (
            <Button
              key={`mark-${file.path}`}
              label={input.markedPaths.includes(file.path) ? 'x' : ' '}
              onPress={() => input.actions.toggleMarked(file.path)}
            />
          ) : (
            <Text color={ui.theme.muted}>  ·</Text>
          )}
        </Box>
      )}
      <Box width={2} flexShrink={0}>
        <Text color={ui.theme[change.color]} bold>
          {change.letter}
        </Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} height={1} overflow="hidden">
        <Button
          key={`${FILE_BUTTON_KEY_PREFIX}${file.path}`}
          plain
          dimColor={viewedState === 'VIEWED'}
          label={fileNameOf(file.path).padEnd(ROW_CLICK_TARGET_LENGTH)}
          onPress={() => input.actions.selectFile(file.path)}
        />
      </Box>
      <Box flexShrink={0} marginLeft={1}>
        {renderFileStats(ui, file)}
      </Box>
      {input.pullRequest && (
        <Box key={`viewed-box-${file.path}`} width={4} flexShrink={0} marginLeft={1}>
          {viewedState ? (
            <Button
              key={`viewed-${file.path}`}
              plain
              dimColor={viewedState !== 'VIEWED'}
              hover={{ color: ui.theme.accent, bold: true }}
              label={VIEWED_MARKS[viewedState]}
              onPress={() => input.actions.toggleViewed(file.path)}
            />
          ) : (
            <Text color={ui.theme.lineNumber}> · </Text>
          )}
        </Box>
      )}
    </Box>
  )
}

function renderNavigationHints(ui: ViewElements, input: FileListInput) {
  const { Box } = ui
  const hints: Array<{ arrow: string; action: ShortcutAction; act: () => Promise<void> }> = [
    { arrow: '↑', action: 'previousFile', act: () => input.actions.moveFileSelection(-1) },
    { arrow: '↓', action: 'nextFile', act: () => input.actions.moveFileSelection(1) },
    { arrow: '←', action: 'previousView', act: () => input.actions.moveView(-1) },
    { arrow: '→', action: 'nextView', act: () => input.actions.moveView(1) },
  ]

  return (
    <Box flexDirection="row" marginTop={1} height={1} overflow="hidden">
      {hints.map(hint => renderNavigationHint(ui, hint.arrow, input.keymap[hint.action], hint.act, input.isTyping))}
    </Box>
  )
}

function renderNavigationHint(
  ui: ViewElements,
  arrow: string,
  hotkeys: readonly string[],
  move: () => Promise<void>,
  isTyping: boolean,
) {
  const { Box, Button } = ui

  return (
    <Box flexDirection="row" marginRight={2}>
      {hotkeys.map(hotkey => (
        <Box marginRight={1}>
          <Button
            key={`navigate-${hotkey}`}
            plain
            hotkey={isTyping ? undefined : hotkey}
            label={isTyping ? `${hotkey}: ${arrow}` : arrow}
            onPress={move}
          />
        </Box>
      ))}
    </Box>
  )
}

function renderStageActions(ui: ViewElements, input: FileListInput) {
  const { Box, Button } = ui
  const markedCount = input.markedPaths.length

  return (
    <Box flexDirection="row" height={1} overflow="hidden">
      {input.hasUntrackedFiles && (
        <Box flexDirection="row">
          <Box marginRight={2}>
            <Button
              key="mark-current"
              plain
              hotkey={input.hotkeyOf('markCurrentFile')}
              label="mark"
              onPress={() => input.actions.toggleCurrentFileMark()}
            />
          </Box>
          <Box marginRight={2}>
            <Button
              key="mark-all"
              plain
              hotkey={input.hotkeyOf('markAllNewFiles')}
              label="all new"
              onPress={() => input.actions.markAllNewFiles()}
            />
          </Box>
          <Box marginRight={2}>
            <Button
              key="stage"
              plain
              hotkey={input.hotkeyOf('stageMarkedFiles')}
              label={`git add${markedCount > 0 ? ` (${markedCount})` : ''}`}
              onPress={() => input.actions.stageMarkedFiles()}
            />
          </Box>
        </Box>
      )}
      <Button
        key="stage-all"
        plain
        hotkey={input.hotkeyOf('stageAllChanges')}
        label="add all"
        onPress={() => input.actions.stageAllChanges()}
      />
    </Box>
  )
}

// A for a file the change creates (or git does not track yet), D for one it deletes, M for one it modifies.
function changeLetterOf(file: ChangedFile): { letter: string; color: 'added' | 'removed' | 'commitSha' } {
  if (file.isUntracked || file.creation === 'created') {
    return { letter: 'A', color: 'added' }
  }

  return file.creation === 'deleted' ? { letter: 'D', color: 'removed' } : { letter: 'M', color: 'commitSha' }
}
