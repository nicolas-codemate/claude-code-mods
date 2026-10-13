import { expect, test } from 'claude-code/testing'

import { buildFileLines, clampFileListWidth, computePaneGeometry, scrolledByLines } from './layout'
import type { GeometryInput } from './layout'

const GEOMETRY: GeometryInput = {
  bodyRows: 40,
  bodyColumns: 200,
  view: 'uncommitted',
  hasLoadError: false,
  errorNoticeCount: 0,
  hasPullRequestLine: false,
  commitLineCount: 0,
  selectedCommitLineIndex: 0,
  requestedCommitListOffset: null,
  fileLineCount: 10,
  hasStageActions: true,
  hasCommitAction: false,
  hasNoiseNotice: false,
  hasWatchBar: false,
  requestedFileListWidth: 50,
  requestedFileListOffset: 0,
  scrolledRowCount: 100,
  isScrollingPastEnd: false,
  isScrollingByLines: false,
  requestedDiffOffset: 0,
  hasLineShortcuts: false,
  isFileDrawerOpen: false,
  isFileListCollapsed: false,
}

test('a wide pane puts the list beside the diff, both as tall as the space under the tabs', async () => {
  const geometry = computePaneGeometry(GEOMETRY)
  expect(geometry.isTwoColumns).toBe(true)
  expect(geometry.panelsTop).toBe(3 + 1 + 1)
  expect(geometry.fileListBoxHeight).toBe(35)
  expect(geometry.visibleFileLines).toBe(35 - 7)
  expect(geometry.diffBoxHeight).toBe(35)
  expect(geometry.visibleDiffRows).toBe(32)
})

test('the search bar takes its framed rows above the panels', async () => {
  const geometry = computePaneGeometry({ ...GEOMETRY, hasWatchBar: true })
  expect(geometry.panelsTop).toBe(3 + 1 + 1 + 3)
  expect(geometry.diffBoxHeight).toBe(32)
})

test('the line of the pull request under the tabs takes one more row above the panels', async () => {
  expect(computePaneGeometry({ ...GEOMETRY, view: 'pr', hasPullRequestLine: true }).panelsTop).toBe(3 + 1 + 1 + 1)
})

test('the diff stops at its last screen, unless it may scroll past its end', async () => {
  expect(computePaneGeometry({ ...GEOMETRY, requestedDiffOffset: 500 }).diffOffset).toBe(68)
  expect(computePaneGeometry({ ...GEOMETRY, requestedDiffOffset: 500, isScrollingPastEnd: true }).diffOffset).toBe(99)
})

test('the commits view takes rows above the panels, and a narrow pane stacks them', async () => {
  const commits = computePaneGeometry({ ...GEOMETRY, view: 'commits', commitLineCount: 3 })
  expect(commits.panelsTop).toBe(3 + 1 + 1 + 2 + 1 + 3 + 1)
  expect(computePaneGeometry({ ...GEOMETRY, bodyColumns: 100 }).isTwoColumns).toBe(false)
})

test('the file list keeps its bounds and its lines group files under their directory', async () => {
  expect(clampFileListWidth(10, 200)).toBe(24)
  expect(clampFileListWidth(190, 200)).toBe(160)
  const file = (path: string) => ({ path, addedLines: 1, removedLines: 0, isUntracked: false })
  expect(buildFileLines([file('src/a.ts'), file('README.md')], true).map(line => line.kind)).toEqual([
    'overview', 'spacer', 'directory', 'file', 'spacer', 'directory', 'file',
  ])
})

test('a narrow pane gives the code the whole height under a bar, the file list opening over it as tall', async () => {
  const closed = computePaneGeometry({ ...GEOMETRY, bodyColumns: 100 })
  expect(closed.isTwoColumns).toBe(false)
  expect(closed.isFileDrawerOpen).toBe(false)
  expect(closed.diffBoxHeight).toBe(35 - 1)
  expect(closed.fileListBoxHeight).toBe(35 - 1)
  expect(closed.fileListWidth).toBe(50)
  expect(computePaneGeometry({ ...GEOMETRY, bodyColumns: 100, isFileDrawerOpen: true }).isFileDrawerOpen).toBe(true)
  expect(computePaneGeometry({ ...GEOMETRY, isFileDrawerOpen: true }).isFileDrawerOpen).toBe(false)
  const collapsed = computePaneGeometry({ ...GEOMETRY, isFileListCollapsed: true, isFileDrawerOpen: true })
  expect(collapsed.isTwoColumns).toBe(false)
  expect(collapsed.isFileDrawerOpen).toBe(true)
})

test('the diff scrolls line by line through a tall row, then on to the next, and stops with the last line on top', async () => {
  const rowHeights = [1, 1, 10, 1]
  expect(scrolledByLines({ rowIndex: 0, skippedLines: 0 }, 3, rowHeights, 12)).toEqual({ rowIndex: 2, skippedLines: 1 })
  expect(scrolledByLines({ rowIndex: 2, skippedLines: 1 }, 3, rowHeights, 12)).toEqual({ rowIndex: 2, skippedLines: 4 })
  expect(scrolledByLines({ rowIndex: 2, skippedLines: 8 }, 3, rowHeights, 12)).toEqual({ rowIndex: 3, skippedLines: 0 })
  expect(scrolledByLines({ rowIndex: 3, skippedLines: 0 }, 3, rowHeights, 12)).toEqual({ rowIndex: 3, skippedLines: 0 })
  expect(scrolledByLines({ rowIndex: 2, skippedLines: 1 }, -3, rowHeights, 12)).toEqual({ rowIndex: 0, skippedLines: 0 })
})

test('without a thread the diff stops once its last drawn line reaches the bottom', async () => {
  expect(scrolledByLines({ rowIndex: 0, skippedLines: 0 }, 30, [1, 4, 4, 1], 10 - 6)).toEqual({ rowIndex: 1, skippedLines: 3 })
})
