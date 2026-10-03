import type { ChangedFile, ReviewView } from '../types'
import {
  COMMIT_PANEL_MAX_LINES,
  MIN_DIFF_WIDTH,
  MIN_FILE_LIST_WIDTH,
  TWO_COLUMNS_MIN_WIDTH,
} from './constants'
import { groupFilesByDirectory } from './git-parsing'

export type FileLine =
  | { kind: 'overview' }
  | { kind: 'spacer' }
  | { kind: 'directory'; directory: string }
  | { kind: 'file'; file: ChangedFile }

export function clampOffset(offset: number, itemCount: number, visibleCount: number): number {
  return Math.max(0, Math.min(offset, itemCount - visibleCount))
}

export function clampFileListWidth(width: number, bodyColumns: number): number {
  return Math.max(MIN_FILE_LIST_WIDTH, Math.min(width, bodyColumns - MIN_DIFF_WIDTH))
}

export function buildFileLines(files: ChangedFile[], hasOverview: boolean): FileLine[] {
  return [
    ...(hasOverview ? [{ kind: 'overview' as const }] : []),
    ...groupFilesByDirectory(files).flatMap(group => [
      { kind: 'spacer' as const },
      { kind: 'directory' as const, directory: group.directory },
      ...group.files.map(file => ({ kind: 'file' as const, file })),
    ]),
  ]
}

export type GeometryInput = {
  bodyRows: number
  bodyColumns: number
  view: ReviewView
  hasLoadError: boolean
  commitLineCount: number
  selectedCommitLineIndex: number
  fileLineCount: number
  hasStageActions: boolean
  hasNoiseNotice: boolean
  requestedFileListWidth: number
  requestedFileListOffset: number
  scrolledRowCount: number
  // A thread or a question under the last rows would stay cut off: the diff then scrolls until its last row is on top.
  isScrollingPastEnd: boolean
  requestedDiffOffset: number
  // The row of line shortcuts under a file's diff.
  hasLineShortcuts: boolean
}

export type PaneGeometry = {
  isTwoColumns: boolean
  panelsTop: number
  panelsHeight: number
  firstShownCommitLineIndex: number
  fileListWidth: number
  fileListBoxHeight: number
  visibleFileLines: number
  fileListOffset: number
  diffBoxHeight: number
  visibleDiffRows: number
  diffOffset: number
}

const TAB_ROWS = 3
const BORDER_ROWS = 2
const PANEL_TITLE_ROWS = 1
const NAVIGATION_HINT_ROWS = 2
const FILTER_ROWS = 1
const MIN_PANELS_HEIGHT = 8

// The pane is drawn to exactly its height so the engine never scrolls it; each panel scrolls on its own instead.
export function computePaneGeometry(input: GeometryInput): PaneGeometry {
  const isTwoColumns = input.bodyColumns >= TWO_COLUMNS_MIN_WIDTH
  const firstShownCommitLineIndex = clampOffset(input.selectedCommitLineIndex - 2, input.commitLineCount, COMMIT_PANEL_MAX_LINES)
  const shownCommitLineCount = Math.min(COMMIT_PANEL_MAX_LINES, input.commitLineCount)
  const commitPanelRows = input.view === 'commits' ? BORDER_ROWS + PANEL_TITLE_ROWS + Math.max(1, shownCommitLineCount) + 1 : 0
  const panelsTop = TAB_ROWS + (input.hasLoadError ? 1 : 0) + commitPanelRows
  const panelsHeight = Math.max(MIN_PANELS_HEIGHT, input.bodyRows - panelsTop)

  const fileListChromeRows =
    BORDER_ROWS +
    PANEL_TITLE_ROWS +
    FILTER_ROWS +
    NAVIGATION_HINT_ROWS +
    (input.hasStageActions ? 1 : 0) +
    (input.hasNoiseNotice ? 1 : 0)
  const fileListBoxHeight = isTwoColumns
    ? panelsHeight
    : Math.min(input.fileLineCount + fileListChromeRows, Math.max(fileListChromeRows + 3, Math.floor(panelsHeight / 3)))
  const visibleFileLines = Math.max(1, fileListBoxHeight - fileListChromeRows)

  const diffBoxHeight = isTwoColumns ? panelsHeight : Math.max(4, panelsHeight - fileListBoxHeight)
  const visibleDiffRows = Math.max(1, diffBoxHeight - BORDER_ROWS - PANEL_TITLE_ROWS - (input.hasLineShortcuts ? 1 : 0))

  return {
    isTwoColumns,
    panelsTop,
    panelsHeight,
    firstShownCommitLineIndex,
    fileListWidth: clampFileListWidth(input.requestedFileListWidth, input.bodyColumns),
    fileListBoxHeight,
    visibleFileLines,
    fileListOffset: clampOffset(input.requestedFileListOffset, input.fileLineCount, visibleFileLines),
    diffBoxHeight,
    visibleDiffRows,
    diffOffset: clampOffset(input.requestedDiffOffset, input.scrolledRowCount, input.isScrollingPastEnd ? 1 : visibleDiffRows),
  }
}
