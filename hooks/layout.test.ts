import { expect, test } from 'claude-code/testing'

import { buildFileLines, clampFileListWidth, computePaneGeometry } from './layout'
import type { GeometryInput } from './layout'

const GEOMETRY: GeometryInput = {
  bodyRows: 40,
  bodyColumns: 200,
  view: 'uncommitted',
  hasLoadError: false,
  commitLineCount: 0,
  selectedCommitLineIndex: 0,
  fileLineCount: 10,
  hasStageActions: true,
  hasNoiseNotice: false,
  requestedFileListWidth: 50,
  requestedFileListOffset: 0,
  scrolledRowCount: 100,
  isScrollingPastEnd: false,
  requestedDiffOffset: 0,
  hasLineShortcuts: false,
}

test('a wide pane puts the list beside the diff, both as tall as the space under the tabs', async () => {
  const geometry = computePaneGeometry(GEOMETRY)
  expect(geometry.isTwoColumns).toBe(true)
  expect(geometry.panelsTop).toBe(3)
  expect(geometry.fileListBoxHeight).toBe(37)
  expect(geometry.visibleFileLines).toBe(37 - 7)
  expect(geometry.diffBoxHeight).toBe(37)
  expect(geometry.visibleDiffRows).toBe(34)
})

test('the diff stops at its last screen, unless it may scroll past its end', async () => {
  expect(computePaneGeometry({ ...GEOMETRY, requestedDiffOffset: 500 }).diffOffset).toBe(66)
  expect(computePaneGeometry({ ...GEOMETRY, requestedDiffOffset: 500, isScrollingPastEnd: true }).diffOffset).toBe(99)
})

test('the commits view takes rows above the panels, and a narrow pane stacks them', async () => {
  const commits = computePaneGeometry({ ...GEOMETRY, view: 'commits', commitLineCount: 3 })
  expect(commits.panelsTop).toBe(3 + 2 + 1 + 3 + 1)
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
