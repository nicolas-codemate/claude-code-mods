import { expect, test } from 'claude-code/testing'

import type { ResultsPanel } from '../../types'
import { EMPTY_HISTORY } from '../navigation-history'
import { NO_TABS } from '../tabs'
import { buildPaneModel, clampedTopLine, columnWidthsOf, firstShownIndexKeeping } from './model'
import type { PaneSnapshot, ShownFile } from './model'

const FILE: ShownFile = {
  path: 'src/Order.php',
  lines: Array.from({ length: 200 }, (_, lineIndex) => `line ${lineIndex + 1}`),
  tokensByLine: Array.from({ length: 200 }, () => []),
}

const SNAPSHOT: PaneSnapshot = {
  file: FILE,
  declaredNamesByLine: new Map(),
  selectedLines: null,
  scrolledColumns: 0,
  bookmarkedLines: new Set(),
  bookmarkCount: 0,
  breadcrumb: [],
  currentPath: FILE.path,
  isDependencyFile: false,
  topLine: 1,
  markedSymbol: null,
  history: EMPTY_HISTORY,
  tabs: NO_TABS,
  palette: null,
  paletteItems: [],
  resultsPanel: null,
  peek: null,
  notice: null,
  inlineNote: null,
  isHelpShown: false,
  isIndexing: false,
  indexSummary: null,
  tabsMode: 'drawer',
  tabsDrawerOpenness: 0,
  explorerMode: 'drawer',
  drawerOpenness: 0,
  preferredSidebarWidth: 30,
  preferredExplorerWidth: 30,
  treeRows: [],
  treeOffset: 0,
  revealedTreePath: null,
  filesFilter: { query: '', initialQuery: '', fieldNumber: 1, selectedIndex: 0, items: [] },
}

const usagesPanel = (rowCount: number): ResultsPanel => ({
  kind: 'usages',
  title: 'Order::total',
  rows: Array.from({ length: rowCount }, (_, rowIndex) => ({
    path: 'src/Order.php',
    line: 10 + rowIndex,
    column: 5,
    matchLength: 4,
    label: 'Order::total',
    preview: '',
    mark: 'confirmed',
    isDependency: false,
  })),
  selectedIndex: null,
  firstShownIndex: 0,
  isTruncated: false,
  note: null,
  searchedText: null,
})

test('the code takes the rows the header, the menu bar and the bar under the code leave', async () => {
  const model = buildPaneModel(SNAPSHOT, { bodyRows: 40, bodyColumns: 120 })

  expect(model.geometry.codeRows).toBe(36)
  expect(model.codeRows).toHaveLength(36)
  expect(model.codeRows[0]?.lineNumber).toBe(1)
  expect(model.geometry.gutterWidth).toBe(5)
})

test('the list under the code takes at most its share of the pane, the code the rest', async () => {
  const model = buildPaneModel({ ...SNAPSHOT, resultsPanel: usagesPanel(50) }, { bodyRows: 40, bodyColumns: 120 })

  expect(model.geometry.resultsRows).toBe(12)
  expect(model.geometry.codeRows).toBe(23)
  expect(model.geometry.resultsTop).toBe(26)

  const shortList = buildPaneModel({ ...SNAPSHOT, resultsPanel: usagesPanel(2) }, { bodyRows: 40, bodyColumns: 120 })
  expect(shortList.geometry.resultsRows).toBe(2)
})

test('the first line shown never leaves the file', async () => {
  expect(clampedTopLine(500, 200, 38)).toBe(163)
  expect(clampedTopLine(-4, 200, 38)).toBe(1)
  expect(clampedTopLine(10, 5, 38)).toBe(1)
  expect(buildPaneModel({ ...SNAPSHOT, topLine: 500 }, { bodyRows: 40, bodyColumns: 120 }).firstLine).toBe(165)
})

test('the usages listed are lit in the file shown, the name pointed at above them', async () => {
  const model = buildPaneModel(
    { ...SNAPSHOT, resultsPanel: usagesPanel(1), markedSymbol: { path: 'src/Order.php', line: 12, startColumn: 0, endColumn: 4 } },
    { bodyRows: 40, bodyColumns: 120 },
  )

  expect(model.codeRows[9]?.pieces.map(piece => [piece.text, piece.highlight])).toEqual([
    ['line ', null],
    ['10', 'match'],
  ])
  expect(model.codeRows[11]?.isMarkedLine).toBe(true)
  expect(model.codeRows[11]?.pieces[0]).toMatchObject({ text: 'line', highlight: 'marked' })
})

test('a list keeps its selected row in sight, moving no more than needed', async () => {
  expect(firstShownIndexKeeping(null, 4, 10, 50)).toBe(4)
  expect(firstShownIndexKeeping(6, 4, 10, 50)).toBe(4)
  expect(firstShownIndexKeeping(2, 4, 10, 50)).toBe(2)
  expect(firstShownIndexKeeping(20, 4, 10, 50)).toBe(11)
  expect(firstShownIndexKeeping(49, 45, 10, 50)).toBe(40)
})

test('a file not read yet shows as loading, and no file at all as nothing shown', async () => {
  expect(buildPaneModel({ ...SNAPSHOT, file: null }, { bodyRows: 40, bodyColumns: 120 }).isFileLoading).toBe(true)
  expect(buildPaneModel({ ...SNAPSHOT, file: null, currentPath: null }, { bodyRows: 40, bodyColumns: 120 }).isFileLoading).toBe(false)
})

test('a strip of tabs takes one row above the code once a file is open in a tab', async () => {
  const tabs = { tabs: [{ path: FILE.path, topLine: 1, markedSymbol: null }], activeIndex: 0 }
  const model = buildPaneModel({ ...SNAPSHOT, tabs }, { bodyRows: 40, bodyColumns: 120 })

  expect(model.geometry.codeTop).toBe(3)
  expect(model.geometry.codeRows).toBe(35)
  expect(model.tabStrip?.shownTabs).toEqual([{ index: 0, path: 'src/Order.php', label: 'Order.php', isActive: true }])
  expect(buildPaneModel(SNAPSHOT, { bodyRows: 40, bodyColumns: 120 }).tabStrip).toBeNull()
})

const SIDEBAR_TABS = { tabs: [{ path: FILE.path, topLine: 1, markedSymbol: null }], activeIndex: 0 }
const TREE_ROWS = Array.from({ length: 60 }, (_, rowIndex) => ({
  path: `src/File${rowIndex}.php`,
  name: `File${rowIndex}.php`,
  depth: 1,
  isDirectory: false,
  isExpanded: false,
  isIgnored: false,
}))

test('the tabs take the column left of the code, the files folded leave the code the rest', async () => {
  const model = buildPaneModel({ ...SNAPSHOT, tabs: SIDEBAR_TABS, tabsMode: 'pinned' as const, treeRows: TREE_ROWS }, { bodyRows: 40, bodyColumns: 120 })

  expect(model.geometry.sidebarWidth).toBe(30)
  expect(model.geometry.codeAreaColumns).toBe(89)
  expect(model.tabStrip).toBeNull()
  expect(model.explorerTree).toBeNull()
  expect(model.sidebar?.shownTabs).toEqual([{ index: 0, path: 'src/Order.php', fileName: 'Order.php', directory: 'src', isActive: true }])
})

test('the drawer of files slides over the right of the code as far as it is open, the code keeping its width', async () => {
  const snapshot = { ...SNAPSHOT, tabs: SIDEBAR_TABS, tabsMode: 'pinned' as const, treeRows: TREE_ROWS, treeOffset: 50 }
  const halfOpen = buildPaneModel({ ...snapshot, drawerOpenness: 0.5 }, { bodyRows: 40, bodyColumns: 120 })
  expect(halfOpen.geometry.drawerWidth).toBe(15)
  expect(halfOpen.geometry.drawerLeft).toBe(105)
  expect(halfOpen.geometry.codeAreaColumns).toBe(89)

  const open = buildPaneModel({ ...snapshot, drawerOpenness: 1 }, { bodyRows: 40, bodyColumns: 120 })
  expect(open.geometry.drawerWidth).toBe(30)
  expect(open.explorerTree?.top).toBe(4)
  expect(open.explorerTree?.visibleRows).toBe(35)
  expect(open.explorerTree?.firstRowIndex).toBe(25)
  expect(open.filesFilter?.isSearching).toBe(false)
})

test('the drawer of tabs slides over the left of the code as far as it is open, a strip of tabs above the code', async () => {
  const model = buildPaneModel({ ...SNAPSHOT, tabs: SIDEBAR_TABS, tabsDrawerOpenness: 1 }, { bodyRows: 40, bodyColumns: 120 })

  expect(model.geometry.sidebarWidth).toBe(0)
  expect(model.geometry.tabsDrawerWidth).toBe(30)
  expect(model.geometry.codeAreaColumns).toBe(120)
  expect(model.tabStrip?.shownTabs).toHaveLength(1)
  expect(model.sidebar?.shownTabs).toHaveLength(1)
  expect(buildPaneModel({ ...SNAPSHOT, tabs: SIDEBAR_TABS }, { bodyRows: 40, bodyColumns: 120 }).sidebar).toBeNull()
})

test('pinned, the files keep a column right of the code, with no drawer', async () => {
  const model = buildPaneModel(
    { ...SNAPSHOT, tabs: SIDEBAR_TABS, tabsMode: 'pinned' as const, explorerMode: 'pinned', drawerOpenness: 1, treeRows: TREE_ROWS },
    { bodyRows: 40, bodyColumns: 160 },
  )

  expect(model.geometry.explorerWidth).toBe(30)
  expect(model.geometry.drawerWidth).toBe(0)
  expect(model.geometry.codeAreaColumns).toBe(98)
  expect(model.explorerTree?.visibleRows).toBe(35)
})

test('the columns beside the code give way when the code would be left too narrow, and when the person hides them', async () => {
  expect(columnWidthsOf('pinned', 'drawer', 30, 30, 120)).toEqual({ sidebarWidth: 30, explorerWidth: 0, tabsMode: 'pinned' as const, explorerMode: 'drawer' })
  expect(columnWidthsOf('pinned', 'drawer', 80, 30, 120)).toEqual({ sidebarWidth: 59, explorerWidth: 0, tabsMode: 'pinned' as const, explorerMode: 'drawer' })
  expect(columnWidthsOf('pinned', 'drawer', 30, 30, 70)).toEqual({ sidebarWidth: 0, explorerWidth: 0, tabsMode: 'drawer', explorerMode: 'drawer' })
  expect(columnWidthsOf('drawer', 'drawer', 30, 30, 200)).toEqual({ sidebarWidth: 0, explorerWidth: 0, tabsMode: 'drawer', explorerMode: 'drawer' })
  expect(columnWidthsOf('pinned', 'pinned', 30, 30, 160)).toEqual({ sidebarWidth: 30, explorerWidth: 30, tabsMode: 'pinned' as const, explorerMode: 'pinned' })
  expect(columnWidthsOf('pinned', 'pinned', 30, 30, 100)).toEqual({ sidebarWidth: 30, explorerWidth: 0, tabsMode: 'pinned' as const, explorerMode: 'drawer' })
})

test('a note about a name is drawn right above it, or under it on the first rows', async () => {
  const tokensByLine = FILE.lines.map(() => [{ startColumn: 5, endColumn: 7, kind: 'name' as const, isNavigable: true }])
  const file = { ...FILE, tokensByLine }
  const note = (line: number) => ({ path: FILE.path, line, column: 5, text: 'No usage of x in the project.' })

  const above = buildPaneModel({ ...SNAPSHOT, file, inlineNote: note(10) }, { bodyRows: 40, bodyColumns: 120 })
  expect(above.inlineNoteBox).toEqual({ top: 6, left: 5 + 5, width: 35, text: 'No usage of x in the project.' })
  const under = buildPaneModel({ ...SNAPSHOT, file, inlineNote: note(2) }, { bodyRows: 40, bodyColumns: 120 })
  expect(under.inlineNoteBox?.top).toBe(2)
  expect(buildPaneModel({ ...SNAPSHOT, file, inlineNote: note(120) }, { bodyRows: 40, bodyColumns: 120 }).inlineNoteBox).toBeNull()
  expect(buildPaneModel({ ...SNAPSHOT, file, inlineNote: { ...note(10), path: 'other.php' } }, { bodyRows: 40, bodyColumns: 120 }).inlineNoteBox).toBeNull()
})

test('a place of the list is previewed between the code and the list, its line marked among the lines around it', async () => {
  const model = buildPaneModel(
    { ...SNAPSHOT, resultsPanel: usagesPanel(5), peek: { path: FILE.path, line: 120, column: 5, matchLength: 2, scrolledLines: 0, file: FILE } },
    { bodyRows: 40, bodyColumns: 120 },
  )

  expect(model.peek?.codeRows.map(row => row.lineNumber)).toEqual(Array.from({ length: 18 }, (_, rowIndex) => 114 + rowIndex))
  expect(model.peek?.codeRows.find(row => row.isMarkedLine)?.lineNumber).toBe(120)
  expect(model.geometry.codeRows).toBe(37 - 6 - 1 - 21)
  expect(model.geometry.resultsTop).toBe(2 + 9 + 1 + 21)
  const notRead = buildPaneModel({ ...SNAPSHOT, resultsPanel: usagesPanel(5), peek: { path: 'a.php', line: 1, column: 0, matchLength: 0, scrolledLines: 0, file: null } }, { bodyRows: 40, bodyColumns: 120 })
  expect(notRead.peek?.isLoading).toBe(true)
})

test('the preview scrolls through its file, its place staying marked, and stops at the first and last lines', async () => {
  const peekScrolledBy = (scrolledLines: number, line = 120) =>
    buildPaneModel({ ...SNAPSHOT, resultsPanel: usagesPanel(5), peek: { path: FILE.path, line, column: 5, matchLength: 2, scrolledLines, file: FILE } }, { bodyRows: 40, bodyColumns: 120 }).peek

  expect(peekScrolledBy(6)?.codeRows.map(row => row.lineNumber)[0]).toBe(120)
  expect(peekScrolledBy(-10)?.codeRows.map(row => row.lineNumber)[0]).toBe(104)
  expect(peekScrolledBy(2)?.codeRows.find(row => row.isMarkedLine)?.lineNumber).toBe(120)
  expect(peekScrolledBy(0)?.scrolledLinesRange).toEqual({ lowest: -113, highest: 200 - 18 + 1 - 114 })
  expect(peekScrolledBy(0, 2)?.scrolledLinesRange.lowest).toBe(0)
})

test('the structure of the file stands in the middle of the code, one steady rectangle, the code dimmed behind it', async () => {
  const palette = { mode: 'outline' as const, textScope: 'file' as const, query: '', initialQuery: '', selectedIndex: 0, fieldNumber: 1, items: [] }
  const model = buildPaneModel({ ...SNAPSHOT, palette }, { bodyRows: 40, bodyColumns: 120 })

  expect(model.isCodeDimmed).toBe(true)
  expect(model.geometry.paletteHeight).toBe(model.geometry.paletteShownItems + 4)
  expect(model.geometry.paletteTop).toBeGreaterThan(model.geometry.middleTop)
  expect(model.geometry.paletteTop + (model.geometry.paletteHeight ?? 0)).toBeLessThan(model.geometry.middleTop + model.geometry.middleRows)
  const leftMargin = model.geometry.paletteLeft - model.geometry.codeAreaLeft
  const rightMargin = model.geometry.codeAreaLeft + model.geometry.codeAreaColumns - model.geometry.paletteLeft - model.geometry.paletteWidth
  expect(Math.abs(leftMargin - rightMargin)).toBeLessThanOrEqual(1)

  const searchOverTheProject = buildPaneModel({ ...SNAPSHOT, palette: { ...palette, mode: 'everything' as const } }, { bodyRows: 40, bodyColumns: 120 })
  expect(searchOverTheProject.isCodeDimmed).toBe(false)
  expect(searchOverTheProject.geometry.paletteHeight).toBeNull()
  expect(searchOverTheProject.geometry.paletteTop).toBe(1)
})

test('a name declared on its line is told as listing its usages, any other name as going to its declaration', async () => {
  const lines = ['function total() {', '  return subtotal()', '}']
  const tokensByLine = [
    [
      { startColumn: 0, endColumn: 8, kind: 'keyword' as const, isNavigable: false },
      { startColumn: 9, endColumn: 14, kind: 'name' as const, isNavigable: true },
    ],
    [
      { startColumn: 2, endColumn: 8, kind: 'keyword' as const, isNavigable: false },
      { startColumn: 9, endColumn: 17, kind: 'callName' as const, isNavigable: true },
    ],
    [],
  ]
  const file: ShownFile = { path: 'src/total.js', lines, tokensByLine }
  const model = buildPaneModel({ ...SNAPSHOT, file, currentPath: file.path, declaredNamesByLine: new Map([[1, new Set(['total'])]]) }, { bodyRows: 40, bodyColumns: 120 })
  const hintsOfLine = (lineIndex: number) => model.codeRows[lineIndex]?.pieces.flatMap(piece => (piece.clickHint === null ? [] : [`${piece.text}:${piece.clickHint}`]))

  expect(hintsOfLine(0)).toEqual(['total:usages'])
  expect(hintsOfLine(1)).toEqual(['subtotal:definition'])
})

test('the code scrolled sideways further than the lines drawn need comes back so that the widest of them stays in sight', async () => {
  const room = { bodyRows: 40, bodyColumns: 120 }
  const overShortLines = buildPaneModel({ ...SNAPSHOT, scrolledColumns: 200 }, room)
  expect(overShortLines.scrolledColumns).toBe(0)
  expect(overShortLines.codeRows[0]?.pieces.map(piece => piece.text).join('')).toBe('line 1')

  const longLine = `$order->addLine(${'x'.repeat(150)});`
  const fileWithLongLine: ShownFile = { ...FILE, lines: [longLine, ...FILE.lines.slice(1)] }
  const overLongLine = buildPaneModel({ ...SNAPSHOT, file: fileWithLongLine, scrolledColumns: 200 }, room)
  expect(overLongLine.scrolledColumns).toBe(longLine.length - overLongLine.geometry.codeColumns + 2)
  expect(overLongLine.codeRows[0]?.pieces[0]?.cut).toBe('before')
  expect(overLongLine.codeRows[0]?.pieces.at(-1)?.text.endsWith(');')).toBe(true)
  expect(buildPaneModel({ ...SNAPSHOT, file: fileWithLongLine, scrolledColumns: 20 }, room).scrolledColumns).toBe(20)
})
