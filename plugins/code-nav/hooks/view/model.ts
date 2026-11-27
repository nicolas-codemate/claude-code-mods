import type {
  ColumnMode,
  FilesFilterState,
  IndexSummary,
  InlineNote,
  MarkedSymbol,
  NavigationHistory,
  PaletteItem,
  PaletteMode,
  PaletteState,
  BreadcrumbStep,
  ResultsPanel,
  SelectedPlace,
  SourceToken,
  TabsState,
} from '../../types'
import {
  CODE_MIN_COLUMNS_BESIDE_SIDEBAR,
  PALETTE_MAX_SHOWN_ITEMS,
  PEEK_MAX_CODE_ROWS,
  PEEK_SHARE_OF_ROWS,
  PALETTE_MAX_WIDTH,
  STRUCTURE_MAX_SHOWN_ITEMS,
  STRUCTURE_MAX_WIDTH,
  RESULTS_PANEL_MIN_ROWS,
  RESULTS_PANEL_SHARE_OF_BODY,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_TABS_SHARE,
} from '../constants'
import { displayRowOf, drawnWidthOf } from '../display-row'
import type { TreeRow } from '../file-tree'
import type { ColumnRange, DisplayPiece } from '../display-row'
import { canGoBack, canGoForward } from '../navigation-history'
import { parentDirectoryOf } from '../file-tree'
import { tabStripOf } from '../tabs'
import type { TabStrip } from '../tabs'
import { baseNameOf } from '../paths'

// The file shown, read and cut into colored pieces once when it is opened.
export type ShownFile = { path: string; lines: readonly string[]; tokensByLine: readonly (readonly SourceToken[])[] }

// A place of the list under the code previewed above it: the file once read, the place in it.
export type PeekSnapshot = { path: string; line: number; column: number; matchLength: number; scrolledLines: number; file: ShownFile | null }

export type PaneSnapshot = {
  file: ShownFile | null
  // The names the file shown declares, by line, so that a click on one is told apart as listing its usages.
  declaredNamesByLine: ReadonlyMap<number, ReadonlySet<string>>
  // The path the pane was asked to show while its text is still being read.
  currentPath: string | null
  // The file shown belongs to a dependency git ignores, not to the project's own sources.
  isDependencyFile: boolean
  topLine: number
  markedSymbol: MarkedSymbol | null
  history: NavigationHistory
  tabs: TabsState
  palette: PaletteState | null
  paletteItems: readonly PaletteItem[]
  resultsPanel: ResultsPanel | null
  peek: PeekSnapshot | null
  notice: string | null
  inlineNote: InlineNote | null
  selectedLines: SelectedPlace | null
  scrolledColumns: number
  bookmarkedLines: ReadonlySet<number>
  bookmarkCount: number
  breadcrumb: BreadcrumbStep[]
  isHelpShown: boolean
  isIndexing: boolean
  indexSummary: IndexSummary | null
  // The side column with the tabs and the files, when the person keeps it and the pane is wide enough.
  tabsMode: ColumnMode
  tabsDrawerOpenness: number
  explorerMode: ColumnMode
  drawerOpenness: number
  preferredSidebarWidth: number
  preferredExplorerWidth: number
  treeRows: readonly TreeRow[]
  treeOffset: number
  revealedTreePath: string | null
  filesFilter: FilesFilterState
}

export type PaneRoom = { bodyRows: number; bodyColumns: number }

// What a click on a name does, told by a tag shown as the pointer rests on it: a declaration lists its usages, any
// other name goes to its declaration.
export type ClickHint = 'definition' | 'usages'

export type CodePiece = DisplayPiece & { clickHint: ClickHint | null }

export type CodeRow = { lineNumber: number; isMarkedLine: boolean; isBookmarked: boolean; pieces: CodePiece[] }

export type PaneGeometry = {
  bodyRows: number
  bodyColumns: number
  codeTop: number
  codeRows: number
  gutterWidth: number
  resultsTop: number
  // Where the preview of a row of the list starts, under the code and its bar.
  peekTop: number
  // 1 when a file is shown, its bar of declarations read drawn under the code; 0 otherwise.
  breadcrumbBarRows: number
  // Rows of the list under the code, its title row left out; 0 when there is no list.
  resultsRows: number
  paletteTop: number
  paletteLeft: number
  paletteWidth: number
  paletteShownItems: number
  // A fixed height keeps the structure of the file one steady rectangle while its rows are filtered; null lets the
  // palette fit what it shows.
  paletteHeight: number | null
  // The rows between the header and the bar under the code: the side column's, and the code's with its list.
  middleTop: number
  middleRows: number
  // 0 when the side column is not drawn.
  sidebarWidth: number
  // The column of files pinned right of the code; 0 when the files are a drawer.
  explorerWidth: number
  // The drawer of files over the right of the code, as far as it is open; 0 when folded or pinned.
  drawerWidth: number
  drawerLeft: number
  // The drawer of tabs over the left of the code, as far as it is open; 0 when folded or pinned.
  tabsDrawerWidth: number
  // Where the code and the list under it start, right of the side column and its divider.
  codeAreaLeft: number
  codeAreaColumns: number
  // The columns the code itself takes, its gutter left out.
  codeColumns: number
}

// Where the note about a name is drawn, within the code and its list: above the name, so the lines it is read with
// stay in sight, or under it on the first rows.
export type InlineNoteBox = { top: number; left: number; width: number; text: string }

// Where a text search stands, for the menu bar: the text, the match the list has selected (null before the first
// step) and how many were found.
export type TextSearchStatus = { text: string; selectedPosition: number | null; matchCount: number; isTruncated: boolean }

// The preview drawn between the code and the list: a title naming the place, then the lines around it.
export type PeekView = {
  path: string
  line: number
  gutterWidth: number
  codeRows: CodeRow[]
  isLoading: boolean
  // How far the wheel may move the preview up and down from where it opens before running out of lines.
  scrolledLinesRange: { lowest: number; highest: number }
}

export type SidebarTab = { index: number; path: string; fileName: string; directory: string; isActive: boolean }

export type SidebarTreeRow = TreeRow & { isShown: boolean }

// The search of the files: its field, and while it holds a text the files found in place of the tree, the selected one
// kept in sight.
export type FilesFilterView = {
  fieldNumber: number
  initialQuery: string
  isSearching: boolean
  shownItems: PaletteItem[]
  firstShownIndex: number
  selectedIndex: number
  itemCount: number
}

// The files as drawn: the rows in sight from the first, and where they start.
export type FileTreeView = { top: number; visibleRows: number; firstRowIndex: number; rowCount: number; shownRows: SidebarTreeRow[] }

// The column of tabs left of the code: its title, then two rows per tab in sight.
export type Sidebar = {
  top: number
  rows: number
  tabListRows: number
  tabCount: number
  shownTabs: SidebarTab[]
}

export type PaneModel = {
  geometry: PaneGeometry
  path: string | null
  isDependencyFile: boolean
  lineCount: number
  // The first line drawn, which is topLine brought back inside the file.
  firstLine: number
  codeRows: CodeRow[]
  isFileLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  // Null while no file is open in a tab: the strip is not drawn.
  tabStrip: TabStrip | null
  sidebar: Sidebar | null
  // The files as drawn in their pinned column or in the drawer; null while folded.
  explorerTree: FileTreeView | null
  filesFilter: FilesFilterView | null
  tabsMode: ColumnMode
  explorerMode: ColumnMode
  tabCount: number
  palette: PaletteState | null
  paletteItems: readonly PaletteItem[]
  firstShownPaletteItemIndex: number
  resultsPanel: ResultsPanel | null
  firstShownResultIndex: number
  peek: PeekView | null
  textSearchStatus: TextSearchStatus | null
  // The code read stands back, dimmed, behind a preview or the structure of the file drawn over it.
  isCodeDimmed: boolean
  // The lines selected in the pane that Claude will read with the next message.
  selectedLines: SelectedPlace | null
  scrolledColumns: number
  bookmarkCount: number
  // The declarations holding the line read, outermost first.
  breadcrumb: BreadcrumbStep[]
  notice: string | null
  inlineNoteBox: InlineNoteBox | null
  isHelpShown: boolean
  isIndexing: boolean
  indexSummary: IndexSummary | null
}

const HEADER_ROWS = 1
const MENU_BAR_ROWS = 1
const BREADCRUMB_BAR_ROWS = 1
const SIDEBAR_TITLE_ROWS = 1
const FILES_FILTER_ROWS = 1
// A tab of the side column takes two rows: its file's name, and the directory holding it.
export const SIDEBAR_ROWS_PER_TAB = 2
// The row of the tabs' closing actions, under their title.
export const TABS_ACTIONS_ROWS = 1
const DIVIDER_COLUMNS = 1
const TAB_STRIP_ROWS = 1
const FOOTER_ROWS = 1
const NOTICE_ROWS = 1
const RESULTS_TITLE_ROWS = 1
const PEEK_TITLE_ROWS = 1
export const PEEK_FRAME_THICKNESS = 1
// The gutter holds the mark of the line pointed at, the line number and one space.
const GUTTER_MARK_COLUMNS = 1
const GUTTER_MIN_NUMBER_COLUMNS = 3
const PALETTE_SIDE_MARGIN = 2
// The palette's border, its field, the row counting what is shown.
const PALETTE_CHROME_ROWS = 4
// Rows left free above and below the structure of the file, the code showing around it.
const STRUCTURE_VERTICAL_MARGIN = 2
// Scrolled to its end, a long line stops two columns short of the right edge, clear of where its cut mark would stand.
export const SIDEWAYS_SCROLL_MARGIN_COLUMNS = 2

// The search over the project and the text search open over the top of the pane; the structure of the file stands in
// the middle of the code it lists.
type PalettePlacement = 'top' | 'centeredOnCode'

const PALETTE_PLACEMENT_OF_MODE: Record<PaletteMode, PalettePlacement> = { everything: 'top', outline: 'centeredOnCode', textSearch: 'top', goToLine: 'top' }

type PaletteBox = { top: number; left: number; width: number; shownItems: number; height: number | null }

type PaletteRoom = { bodyRows: number; bodyColumns: number; middleTop: number; middleRows: number; codeAreaLeft: number; codeAreaColumns: number }

function paletteBoxOf(mode: PaletteMode | null, room: PaletteRoom): PaletteBox {
  const placement = mode === null ? 'top' : PALETTE_PLACEMENT_OF_MODE[mode]
  switch (placement) {
    case 'top': {
      const width = Math.max(20, Math.min(PALETTE_MAX_WIDTH, room.bodyColumns - 2 * PALETTE_SIDE_MARGIN))
      const shownItems = Math.max(1, Math.min(PALETTE_MAX_SHOWN_ITEMS, room.bodyRows - HEADER_ROWS - MENU_BAR_ROWS - PALETTE_CHROME_ROWS - FOOTER_ROWS))

      return { top: 1, left: Math.max(0, Math.floor((room.bodyColumns - width) / 2)), width, shownItems, height: null }
    }
    case 'centeredOnCode': {
      const width = Math.max(20, Math.min(STRUCTURE_MAX_WIDTH, room.codeAreaColumns - 2 * PALETTE_SIDE_MARGIN))
      const shownItems = Math.max(1, Math.min(STRUCTURE_MAX_SHOWN_ITEMS, room.middleRows - PALETTE_CHROME_ROWS - 2 * STRUCTURE_VERTICAL_MARGIN))
      const height = shownItems + PALETTE_CHROME_ROWS

      return {
        top: room.middleTop + Math.max(0, Math.floor((room.middleRows - height) / 2)),
        left: room.codeAreaLeft + Math.max(0, Math.floor((room.codeAreaColumns - width) / 2)),
        width,
        shownItems,
        height,
      }
    }
    default: {
      const unknownPlacement: never = placement

      return unknownPlacement
    }
  }
}

export function clampedTopLine(topLine: number, lineCount: number, codeRows: number): number {
  const lastTopLine = Math.max(1, lineCount - codeRows + 1)

  return Math.max(1, Math.min(topLine, lastTopLine))
}

// The window of a list that keeps its selected row in sight, moved no more than needed from where it stood.
export function firstShownIndexKeeping(selectedIndex: number | null, firstShownIndex: number, shownCount: number, totalCount: number): number {
  const lastFirstIndex = Math.max(0, totalCount - shownCount)
  const boundedFirstIndex = Math.max(0, Math.min(firstShownIndex, lastFirstIndex))
  if (selectedIndex === null) {
    return boundedFirstIndex
  }
  if (selectedIndex < boundedFirstIndex) {
    return selectedIndex
  }
  if (selectedIndex >= boundedFirstIndex + shownCount) {
    return Math.min(lastFirstIndex, selectedIndex - shownCount + 1)
  }

  return boundedFirstIndex
}

export function resultsRowCount(resultsPanel: ResultsPanel | null, bodyRows: number): number {
  if (resultsPanel === null) {
    return 0
  }
  const mostRows = Math.max(RESULTS_PANEL_MIN_ROWS, Math.floor(bodyRows * RESULTS_PANEL_SHARE_OF_BODY))

  return Math.max(1, Math.min(resultsPanel.rows.length, mostRows))
}

// The places the list under the code is about in one file, by line: read once per drawing, not once per line drawn.
function matchesByLineOf(snapshot: PaneSnapshot, path: string): Map<number, ColumnRange[]> {
  const matchesByLine = new Map<number, ColumnRange[]>()
  for (const row of snapshot.resultsPanel?.rows ?? []) {
    if (row.path === path && row.matchLength > 0) {
      matchesByLine.set(row.line, [...(matchesByLine.get(row.line) ?? []), { startColumn: row.column, endColumn: row.column + row.matchLength, kind: 'match' }])
    }
  }

  return matchesByLine
}

function highlightsOfLine(snapshot: PaneSnapshot, matchesByLine: ReadonlyMap<number, ColumnRange[]>, path: string, lineNumber: number): ColumnRange[] {
  const highlights: ColumnRange[] = [...(matchesByLine.get(lineNumber) ?? [])]
  const { markedSymbol } = snapshot
  if (markedSymbol !== null && markedSymbol.path === path && markedSymbol.line === lineNumber) {
    highlights.push({ startColumn: markedSymbol.startColumn, endColumn: markedSymbol.endColumn, kind: 'marked' })
  }

  return highlights
}

export type ColumnWidths = { sidebarWidth: number; explorerWidth: number; tabsMode: ColumnMode; explorerMode: ColumnMode }

// The widths of the columns beside the code as asked, made narrower or given up when the code would be left too
// narrow: pinned tabs or files turn back into drawers when they do not fit.
export function columnWidthsOf(
  tabsMode: ColumnMode,
  explorerMode: ColumnMode,
  preferredSidebarWidth: number,
  preferredExplorerWidth: number,
  bodyColumns: number,
): ColumnWidths {
  const roomBesideCode = bodyColumns - CODE_MIN_COLUMNS_BESIDE_SIDEBAR
  const roomForTabs = roomBesideCode - DIVIDER_COLUMNS
  const isTabsColumnFitting = tabsMode === 'pinned' && roomForTabs >= SIDEBAR_MIN_WIDTH
  const sidebarWidth = isTabsColumnFitting ? Math.max(SIDEBAR_MIN_WIDTH, Math.min(preferredSidebarWidth, roomForTabs)) : 0
  const tabsColumnMode: ColumnMode = isTabsColumnFitting ? 'pinned' : 'drawer'
  const roomForFiles = roomBesideCode - (sidebarWidth === 0 ? 0 : sidebarWidth + DIVIDER_COLUMNS) - DIVIDER_COLUMNS
  const widthsOfMode: Record<ColumnMode, () => ColumnWidths> = {
    drawer: () => ({ sidebarWidth, explorerWidth: 0, tabsMode: tabsColumnMode, explorerMode: 'drawer' }),
    pinned: () =>
      roomForFiles < SIDEBAR_MIN_WIDTH
        ? widthsOfMode.drawer()
        : { sidebarWidth, explorerWidth: Math.max(SIDEBAR_MIN_WIDTH, Math.min(preferredExplorerWidth, roomForFiles)), tabsMode: tabsColumnMode, explorerMode: 'pinned' },
  }

  return widthsOfMode[explorerMode]()
}

function fileTreeViewOf(snapshot: PaneSnapshot, top: number, visibleRows: number, currentPath: string | null): FileTreeView {
  const rowCount = snapshot.treeRows.length
  const firstRowIndex = Math.max(0, Math.min(snapshot.treeOffset, rowCount - visibleRows))

  return {
    top,
    visibleRows,
    firstRowIndex,
    rowCount,
    shownRows: snapshot.treeRows.slice(firstRowIndex, firstRowIndex + visibleRows).map(row => ({ ...row, isShown: row.path === currentPath })),
  }
}

function filesFilterViewOf(filesFilter: FilesFilterState, visibleRows: number): FilesFilterView {
  const firstShownIndex = firstShownIndexKeeping(filesFilter.selectedIndex, 0, visibleRows, filesFilter.items.length)

  return {
    fieldNumber: filesFilter.fieldNumber,
    initialQuery: filesFilter.initialQuery,
    isSearching: filesFilter.query.trim() !== '',
    shownItems: filesFilter.items.slice(firstShownIndex, firstShownIndex + visibleRows),
    firstShownIndex,
    selectedIndex: filesFilter.selectedIndex,
    itemCount: filesFilter.items.length,
  }
}

function sidebarOf(snapshot: PaneSnapshot, top: number, rows: number): Sidebar {
  const { tabs, activeIndex } = snapshot.tabs
  const mostShownTabs = Math.max(1, Math.floor((rows - SIDEBAR_TITLE_ROWS - TABS_ACTIONS_ROWS) / SIDEBAR_ROWS_PER_TAB))
  const shownTabCount = Math.min(tabs.length, mostShownTabs)
  const tabListRows = Math.max(1, shownTabCount * SIDEBAR_ROWS_PER_TAB)
  const firstTabIndex = firstShownIndexKeeping(activeIndex, 0, shownTabCount, tabs.length)

  return {
    top,
    rows,
    tabListRows,
    tabCount: tabs.length,
    shownTabs: tabs.slice(firstTabIndex, firstTabIndex + shownTabCount).map((tab, offset) => ({
      index: firstTabIndex + offset,
      path: tab.path,
      fileName: baseNameOf(tab.path),
      directory: parentDirectoryOf(tab.path),
      isActive: firstTabIndex + offset === activeIndex,
    })),
  }
}

// The drawer leaves the code a sliver to its left, so it reads as laid over the code rather than in its place.
const CODE_COLUMNS_LEFT_BESIDE_DRAWER = 12

const INLINE_NOTE_ROWS = 3
// The note's frame, the space inside it on each side, and its close mark with a space before it.
const INLINE_NOTE_CHROME_COLUMNS = 6

function inlineNoteBoxOf(
  note: InlineNote | null,
  file: ShownFile | null,
  shownCodeRows: readonly CodeRow[],
  placement: { firstLine: number; codeTop: number; gutterWidth: number; areaColumns: number; areaRows: number },
): InlineNoteBox | null {
  if (note === null || file === null || note.path !== file.path) {
    return null
  }
  const rowIndex = note.line - placement.firstLine
  const codeRow = shownCodeRows[rowIndex]
  if (codeRow === undefined) {
    return null
  }
  let drawnColumn = 0
  for (const piece of codeRow.pieces) {
    if (piece.navigableColumn !== null && piece.navigableColumn >= note.column) {
      break
    }
    drawnColumn += piece.text.length
  }
  const width = Math.max(INLINE_NOTE_CHROME_COLUMNS + 1, Math.min(note.text.length + INLINE_NOTE_CHROME_COLUMNS, placement.areaColumns - 2))
  const left = Math.max(0, Math.min(placement.gutterWidth + drawnColumn, placement.areaColumns - width))
  const rowTop = placement.codeTop + rowIndex
  const isRoomAbove = rowTop - INLINE_NOTE_ROWS >= 0

  return { top: isRoomAbove ? rowTop - INLINE_NOTE_ROWS : Math.min(rowTop + 1, Math.max(0, placement.areaRows - INLINE_NOTE_ROWS)), left, width, text: note.text }
}

function peekViewOf(peek: PeekSnapshot, codeRows: number, columns: number): PeekView {
  const { file } = peek
  if (file === null) {
    return { path: peek.path, line: peek.line, gutterWidth: 0, codeRows: [], isLoading: true, scrolledLinesRange: { lowest: 0, highest: 0 } }
  }
  const lineCount = file.lines.length
  const openingFirstLine = peek.line - Math.floor(codeRows / 3)
  const lastFirstLine = Math.max(1, lineCount - codeRows + 1)
  const scrolledLinesRange = { lowest: Math.min(0, 1 - openingFirstLine), highest: Math.max(0, lastFirstLine - openingFirstLine) }
  const firstLine = Math.max(1, Math.min(openingFirstLine + peek.scrolledLines, lastFirstLine))
  const lastLine = Math.min(lineCount, firstLine + codeRows - 1)
  const gutterWidth = GUTTER_MARK_COLUMNS + Math.max(GUTTER_MIN_NUMBER_COLUMNS, String(lastLine).length) + 1
  const peekCodeRows: CodeRow[] = []
  for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
    const isPeekedLine = lineNumber === peek.line
    const highlights: ColumnRange[] = isPeekedLine && peek.matchLength > 0 ? [{ startColumn: peek.column, endColumn: peek.column + peek.matchLength, kind: 'match' }] : []
    peekCodeRows.push({
      lineNumber,
      isMarkedLine: isPeekedLine,
      isBookmarked: false,
      pieces: displayRowOf(file.lines[lineNumber - 1] ?? '', file.tokensByLine[lineNumber - 1] ?? [], highlights, Math.max(1, columns - gutterWidth)).map(piece => ({ ...piece, clickHint: null })),
    })
  }

  return { path: peek.path, line: peek.line, gutterWidth, codeRows: peekCodeRows, isLoading: false, scrolledLinesRange }
}

function textSearchStatusOf(resultsPanel: ResultsPanel | null): TextSearchStatus | null {
  if (resultsPanel === null || resultsPanel.searchedText === null) {
    return null
  }

  return {
    text: resultsPanel.searchedText,
    selectedPosition: resultsPanel.selectedIndex === null ? null : resultsPanel.selectedIndex + 1,
    matchCount: resultsPanel.rows.length,
    isTruncated: resultsPanel.isTruncated,
  }
}

function clickHintOf(piece: DisplayPiece, namesDeclaredOnLine: ReadonlySet<string> | undefined): ClickHint | null {
  if (piece.navigableColumn === null) {
    return null
  }

  return namesDeclaredOnLine?.has(piece.text) ? 'usages' : 'definition'
}

// The code stays scrolled sideways no further than the widest line drawn needs: past it, every row would draw empty,
// with no mark left to scroll back from, once that line is edited shorter or scrolled out of sight.
function scrolledColumnsKeepingWidestLineInSight(drawnLines: readonly string[], codeColumns: number, scrolledColumns: number): number {
  const widestDrawnColumns = drawnLines.reduce((widestSoFar, lineText) => Math.max(widestSoFar, drawnWidthOf(lineText)), 0)
  const furthestUsefulScroll = widestDrawnColumns <= codeColumns ? 0 : widestDrawnColumns - codeColumns + SIDEWAYS_SCROLL_MARGIN_COLUMNS

  return Math.min(scrolledColumns, furthestUsefulScroll)
}

export function buildPaneModel(snapshot: PaneSnapshot, room: PaneRoom): PaneModel {
  const { file } = snapshot
  const lineCount = file?.lines.length ?? 0
  const noticeRows = snapshot.notice === null ? 0 : NOTICE_ROWS
  const resultsRows = resultsRowCount(snapshot.resultsPanel, room.bodyRows)
  const resultsBlockRows = snapshot.resultsPanel === null ? 0 : resultsRows + RESULTS_TITLE_ROWS
  const { sidebarWidth, explorerWidth, tabsMode, explorerMode } = columnWidthsOf(
    snapshot.tabsMode,
    snapshot.explorerMode,
    snapshot.preferredSidebarWidth,
    snapshot.preferredExplorerWidth,
    room.bodyColumns,
  )
  const codeAreaLeft = sidebarWidth === 0 ? 0 : sidebarWidth + DIVIDER_COLUMNS
  const codeAreaColumns = room.bodyColumns - codeAreaLeft - (explorerWidth === 0 ? 0 : explorerWidth + DIVIDER_COLUMNS)
  const openness = explorerMode === 'drawer' ? Math.max(0, Math.min(1, snapshot.drawerOpenness)) : 0
  const fullDrawerWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(snapshot.preferredExplorerWidth, codeAreaColumns - CODE_COLUMNS_LEFT_BESIDE_DRAWER))
  const drawerWidth = Math.round(fullDrawerWidth * openness)
  const isExplorerShown = explorerWidth > 0 || drawerWidth > 0
  const explorerRowsBelowTop = room.bodyRows - HEADER_ROWS - MENU_BAR_ROWS - noticeRows - FOOTER_ROWS - SIDEBAR_TITLE_ROWS - FILES_FILTER_ROWS
  const explorerRows = Math.max(1, explorerRowsBelowTop)
  const tabsOpenness = tabsMode === 'drawer' ? Math.max(0, Math.min(1, snapshot.tabsDrawerOpenness)) : 0
  const fullTabsDrawerWidth = Math.max(SIDEBAR_MIN_WIDTH, Math.min(snapshot.preferredSidebarWidth, codeAreaColumns - CODE_COLUMNS_LEFT_BESIDE_DRAWER))
  const tabsDrawerWidth = Math.round(fullTabsDrawerWidth * tabsOpenness)
  const tabStripRows = snapshot.tabs.tabs.length === 0 || sidebarWidth > 0 ? 0 : TAB_STRIP_ROWS
  const middleTop = HEADER_ROWS + MENU_BAR_ROWS + noticeRows
  const middleRows = Math.max(1, room.bodyRows - middleTop - FOOTER_ROWS)
  const peekCodeRows = snapshot.peek === null ? 0 : Math.max(1, Math.min(PEEK_MAX_CODE_ROWS, Math.floor(middleRows * PEEK_SHARE_OF_ROWS)))
  const peekBlockRows = snapshot.peek === null ? 0 : peekCodeRows + PEEK_TITLE_ROWS + 2 * PEEK_FRAME_THICKNESS
  // The bar naming the declarations read stays under the code of any file shown, so that the code does not move when
  // the reading enters or leaves a declaration.
  const breadcrumbBarRows = file !== null || snapshot.currentPath !== null ? BREADCRUMB_BAR_ROWS : 0
  const codeRows = Math.max(1, middleRows - tabStripRows - breadcrumbBarRows - resultsBlockRows - peekBlockRows)
  const codeTop = middleTop + tabStripRows
  const gutterWidth = GUTTER_MARK_COLUMNS + Math.max(GUTTER_MIN_NUMBER_COLUMNS, String(lineCount).length) + 1
  const codeColumns = Math.max(1, codeAreaColumns - gutterWidth)
  const firstLine = clampedTopLine(snapshot.topLine, lineCount, codeRows)
  const paletteBox = paletteBoxOf(snapshot.palette?.mode ?? null, { ...room, middleTop, middleRows, codeAreaLeft, codeAreaColumns })
  const paletteShownItems = paletteBox.shownItems

  const lastLine = Math.min(lineCount, firstLine + codeRows - 1)
  const scrolledColumns = scrolledColumnsKeepingWidestLineInSight(file?.lines.slice(firstLine - 1, lastLine) ?? [], codeColumns, snapshot.scrolledColumns)
  const shownCodeRows: CodeRow[] = []
  if (file !== null) {
    const matchesByLine = matchesByLineOf(snapshot, file.path)
    for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
      shownCodeRows.push({
        lineNumber,
        isMarkedLine: snapshot.markedSymbol?.path === file.path && snapshot.markedSymbol.line === lineNumber,
        isBookmarked: snapshot.bookmarkedLines.has(lineNumber),
        pieces: displayRowOf(
          file.lines[lineNumber - 1] ?? '',
          file.tokensByLine[lineNumber - 1] ?? [],
          highlightsOfLine(snapshot, matchesByLine, file.path, lineNumber),
          codeColumns,
          scrolledColumns,
        ).map(piece => ({ ...piece, clickHint: clickHintOf(piece, snapshot.declaredNamesByLine.get(lineNumber)) })),
      })
    }
  }

  return {
    geometry: {
      bodyRows: room.bodyRows,
      bodyColumns: room.bodyColumns,
      codeTop,
      codeRows,
      gutterWidth,
      resultsTop: codeTop + codeRows + breadcrumbBarRows + peekBlockRows,
      peekTop: codeTop + codeRows + breadcrumbBarRows,
      breadcrumbBarRows,
      resultsRows,
      paletteTop: paletteBox.top,
      paletteLeft: paletteBox.left,
      paletteWidth: paletteBox.width,
      paletteShownItems,
      paletteHeight: paletteBox.height,
      middleTop,
      middleRows,
      sidebarWidth,
      explorerWidth,
      drawerWidth,
      drawerLeft: room.bodyColumns - drawerWidth,
      tabsDrawerWidth,
      codeAreaLeft,
      codeAreaColumns,
      codeColumns,
    },
    path: file?.path ?? snapshot.currentPath,
    isDependencyFile: snapshot.isDependencyFile,
    lineCount,
    firstLine,
    codeRows: shownCodeRows,
    isFileLoading: file === null && snapshot.currentPath !== null,
    canGoBack: canGoBack(snapshot.history),
    canGoForward: canGoForward(snapshot.history),
    tabStrip: tabStripRows === 0 ? null : tabStripOf(snapshot.tabs, Math.max(1, codeAreaColumns - 2)),
    tabCount: snapshot.tabs.tabs.length,
    sidebar: sidebarWidth === 0 && tabsDrawerWidth === 0 ? null : sidebarOf(snapshot, middleTop, middleRows),
    tabsMode,
    explorerTree: isExplorerShown ? fileTreeViewOf(snapshot, middleTop + SIDEBAR_TITLE_ROWS + FILES_FILTER_ROWS, explorerRows, snapshot.revealedTreePath ?? file?.path ?? snapshot.currentPath) : null,
    filesFilter: isExplorerShown ? filesFilterViewOf(snapshot.filesFilter, explorerRows) : null,
    explorerMode,
    palette: snapshot.palette,
    paletteItems: snapshot.paletteItems,
    firstShownPaletteItemIndex: firstShownIndexKeeping(snapshot.palette?.selectedIndex ?? null, 0, paletteShownItems, snapshot.paletteItems.length),
    resultsPanel: snapshot.resultsPanel,
    textSearchStatus: textSearchStatusOf(snapshot.resultsPanel),
    isCodeDimmed: snapshot.peek !== null || paletteBox.height !== null,
    selectedLines: snapshot.selectedLines,
    scrolledColumns,
    bookmarkCount: snapshot.bookmarkCount,
    breadcrumb: snapshot.breadcrumb,
    peek: snapshot.peek === null ? null : peekViewOf(snapshot.peek, peekCodeRows, codeAreaColumns - 2 * PEEK_FRAME_THICKNESS),
    firstShownResultIndex:
      snapshot.resultsPanel === null
        ? 0
        : firstShownIndexKeeping(
            snapshot.resultsPanel.selectedIndex,
            snapshot.resultsPanel.firstShownIndex,
            resultsRows,
            snapshot.resultsPanel.rows.length,
          ),
    notice: snapshot.notice,
    inlineNoteBox: inlineNoteBoxOf(snapshot.inlineNote, file, shownCodeRows, {
      firstLine,
      codeTop: tabStripRows,
      gutterWidth,
      areaColumns: codeAreaColumns,
      areaRows: middleRows,
    }),
    isHelpShown: snapshot.isHelpShown,
    isIndexing: snapshot.isIndexing,
    indexSummary: snapshot.indexSummary,
  }
}
