import type { ChangedFile, ReviewView } from '../types'
import {
  COMMIT_PANEL_MAX_LINES,
  MIN_DIFF_WIDTH,
  WATCH_BAR_ROWS,
  MIN_FILE_LIST_WIDTH,
  TWO_COLUMNS_MIN_WIDTH,
} from './constants'
import { groupFilesByDirectory } from './git-parsing'

export type FileLine =
  | { kind: 'overview' }
  | { kind: 'spacer' }
  | { kind: 'directory'; directory: string; fileCount: number; isFolded: boolean }
  | { kind: 'file'; file: ChangedFile }

export function clampOffset(offset: number, itemCount: number, visibleCount: number): number {
  return Math.max(0, Math.min(offset, itemCount - visibleCount))
}

// The diff's first shown row, and how many of its drawn lines are already above the top: a wrapped line or a thread
// taller than the panel is read a few lines at a time instead of leaving at once with its row.
export type DiffScrollPosition = { rowIndex: number; skippedLines: number }

export function scrolledByLines(
  position: DiffScrollPosition,
  linesToMove: number,
  rowHeights: readonly number[],
  lastTopLine: number,
): DiffScrollPosition {
  const linesAbove = rowHeights.slice(0, position.rowIndex).reduce((total, height) => total + height, 0)
  let remainingLines = Math.max(0, Math.min(linesAbove + position.skippedLines + linesToMove, lastTopLine))
  for (const [rowIndex, height] of rowHeights.entries()) {
    if (remainingLines < height) {
      return { rowIndex, skippedLines: remainingLines }
    }
    remainingLines -= height
  }

  return { rowIndex: 0, skippedLines: 0 }
}

// The top line that keeps a growing thread's end in sight: the diff only moves down, and never past the line the thread
// is about, so a thread taller than the panel shows its question first.
export function topLineFollowingRow(rowHeights: readonly number[], rowIndex: number, currentTopLine: number, visibleLines: number): number {
  const linesAbove = rowHeights.slice(0, rowIndex).reduce((total, height) => total + height, 0)
  const rowBottom = linesAbove + (rowHeights[rowIndex] ?? 0)

  return Math.max(currentTopLine, Math.min(rowBottom - visibleLines, linesAbove))
}

export function clampFileListWidth(width: number, bodyColumns: number): number {
  return Math.max(MIN_FILE_LIST_WIDTH, Math.min(width, bodyColumns - MIN_DIFF_WIDTH))
}

// A folded directory keeps its own line, its files go out of the list.
export function buildFileLines(files: ChangedFile[], hasOverview: boolean, foldedDirectories: readonly string[] = []): FileLine[] {
  return [
    ...(hasOverview ? [{ kind: 'overview' as const }] : []),
    ...groupFilesByDirectory(files).flatMap(group => {
      const isFolded = foldedDirectories.includes(group.directory)
      return [
        { kind: 'spacer' as const },
        { kind: 'directory' as const, directory: group.directory, fileCount: group.files.length, isFolded },
        ...(isFolded ? [] : group.files.map(file => ({ kind: 'file' as const, file }))),
      ]
    }),
  ]
}

export type GeometryInput = {
  bodyRows: number
  bodyColumns: number
  view: ReviewView
  hasLoadError: boolean
  errorNoticeCount: number
  hasPullRequestLine: boolean
  commitLineCount: number
  selectedCommitLineIndex: number
  // Set by the wheel over the commit list; absent, the list follows the selected commit.
  requestedCommitListOffset: number | null
  fileLineCount: number
  hasStageActions: boolean
  commitBarRows: number
  hasNoiseNotice: boolean
  // The bar of the searched term, under the header.
  hasWatchBar: boolean
  requestedFileListWidth: number
  requestedFileListOffset: number
  scrolledRowCount: number
  // A thread or a question under the last rows would stay cut off: the diff then scrolls until its last row is on top.
  isScrollingPastEnd: boolean
  // The diff of a file scrolls by drawn lines and clamps itself, its long lines wrapping on several.
  isScrollingByLines: boolean
  requestedDiffOffset: number
  // The row of line shortcuts under a file's diff.
  hasLineShortcuts: boolean
  isFileDrawerOpen: boolean
  isFileListCollapsed: boolean
}

export type PaneGeometry = {
  isTwoColumns: boolean
  // Narrow or collapsed, the file list is a drawer over the code, opened from a bar above it.
  isFileDrawerOpen: boolean
  panelsTop: number
  panelsHeight: number
  firstShownCommitLineIndex: number
  commitPanelRows: number
  fileListWidth: number
  fileListBoxHeight: number
  visibleFileLines: number
  fileListOffset: number
  diffBoxHeight: number
  visibleDiffRows: number
  diffOffset: number
}

const TAB_ROWS = 3
const LOCATION_LINE_ROWS = 1
const HEADER_BOTTOM_PADDING_ROWS = 1
const BORDER_ROWS = 2
const PANEL_TITLE_ROWS = 1
const NAVIGATION_HINT_ROWS = 2
const FILTER_ROWS = 1
const MIN_PANELS_HEIGHT = 8
const FILE_BAR_ROWS = 1
// One line of text in a frame.
const ERROR_NOTICE_ROWS = 3

// The pane is drawn to exactly its height so the engine never scrolls it; each panel scrolls on its own instead.
export function computePaneGeometry(input: GeometryInput): PaneGeometry {
  const isTwoColumns = !input.isFileListCollapsed && input.bodyColumns >= TWO_COLUMNS_MIN_WIDTH
  const firstShownCommitLineIndex = clampOffset(
    input.requestedCommitListOffset ?? input.selectedCommitLineIndex - 2,
    input.commitLineCount,
    COMMIT_PANEL_MAX_LINES,
  )
  const shownCommitLineCount = Math.min(COMMIT_PANEL_MAX_LINES, input.commitLineCount)
  const commitPanelRows = input.view === 'commits' ? BORDER_ROWS + PANEL_TITLE_ROWS + Math.max(1, shownCommitLineCount) + 1 : 0
  const panelsTop =
    TAB_ROWS +
    LOCATION_LINE_ROWS +
    (input.hasPullRequestLine ? 1 : 0) +
    HEADER_BOTTOM_PADDING_ROWS +
    (input.hasLoadError ? 1 : 0) +
    (input.hasWatchBar ? WATCH_BAR_ROWS : 0) +
    input.commitBarRows +
    input.errorNoticeCount * ERROR_NOTICE_ROWS +
    commitPanelRows
  const panelsHeight = Math.max(MIN_PANELS_HEIGHT, input.bodyRows - panelsTop)

  const fileListChromeRows =
    BORDER_ROWS +
    PANEL_TITLE_ROWS +
    FILTER_ROWS +
    NAVIGATION_HINT_ROWS +
    (input.hasStageActions ? 1 : 0) +
    (input.hasNoiseNotice ? 1 : 0)
  const fileListBoxHeight = isTwoColumns ? panelsHeight : panelsHeight - FILE_BAR_ROWS
  const visibleFileLines = Math.max(1, fileListBoxHeight - fileListChromeRows)

  const diffBoxHeight = isTwoColumns ? panelsHeight : panelsHeight - FILE_BAR_ROWS
  const visibleDiffRows = Math.max(1, diffBoxHeight - BORDER_ROWS - PANEL_TITLE_ROWS - (input.hasLineShortcuts ? 1 : 0))

  return {
    isTwoColumns,
    isFileDrawerOpen: !isTwoColumns && input.isFileDrawerOpen,
    panelsTop,
    panelsHeight,
    firstShownCommitLineIndex,
    commitPanelRows,
    fileListWidth: clampFileListWidth(input.requestedFileListWidth, input.bodyColumns),
    fileListBoxHeight,
    visibleFileLines,
    fileListOffset: clampOffset(input.requestedFileListOffset, input.fileLineCount, visibleFileLines),
    diffBoxHeight,
    visibleDiffRows,
    diffOffset: clampOffset(input.requestedDiffOffset, input.scrolledRowCount, input.isScrollingPastEnd || input.isScrollingByLines ? 1 : visibleDiffRows),
  }
}
