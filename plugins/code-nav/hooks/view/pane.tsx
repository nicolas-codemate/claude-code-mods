import type { RenderChildren } from 'claude-code'

import type { BreadcrumbStep, ColumnMode, SymbolKind, PaletteItem, TextSearchScope, PaletteItemKind, PaletteMode, ResultRow, ResultRowMark, ResultsKind, ResultsPanel } from '../../types'
import {
  CLOSE_TAB_BUTTON_KEY_PREFIX,
  FILES_FILTER_FIELD_KEY_PREFIX,
  FILES_FILTER_ITEM_KEY_PREFIX,
  FILES_FILTER_NEXT_KEY,
  FILES_FILTER_PREVIOUS_KEY,
  EXPLORER_DIVIDER_KEY,
  MIN_PANE_COLUMNS,
  PALETTE_FIELD_KEY_PREFIX,
  PALETTE_ITEM_KEY_PREFIX,
  PALETTE_CLOSE_KEY,
  PALETTE_NEXT_KEY,
  PALETTE_PREVIOUS_KEY,
  PEEK_OPEN_KEY,
  RESULT_ROW_KEY_PREFIX,
  SIDEBAR_DIVIDER_KEY,
  SHORTCUT_KEY_PREFIX,
  TAB_BUTTON_KEY_PREFIX,
  TREE_ROW_KEY_PREFIX,
  TEXT_SCOPE_KEY_PREFIX,
  TOKEN_HINT_KEY_PREFIX,
  TOKEN_KEY_PREFIX,
} from '../constants'
import { BADGE_COLUMNS, fileBadgeOf } from '../file-badge'
import { SHORTCUT_GROUPS, shortcutsOfGroup, SHORTCUTS } from '../keymap'
import { BOOKMARK_SIGN, MARKED_LINE_SIGN } from '../display-row'
import type { CutSide } from '../display-row'
import type { ShortcutAction } from '../keymap'
import { PEEK_FRAME_THICKNESS, SIDEBAR_ROWS_PER_TAB } from './model'
import type { ClickHint, CodeRow, FilesFilterView, FileTreeView, PaneModel, PeekView, Sidebar, TextSearchStatus } from './model'
import { highlightBackgroundOf, RESULT_MARK_SIGNS, SYMBOL_KIND_LETTERS } from './theme'
import type { HotkeysOf, PaneActions, ViewElements } from './types'
import { baseNameOf } from '../paths'
import { lineRangeOf, linesWordOf } from '../selected-lines'
import { lineNumberTypedIn } from '../text-position'

export type PaneInput = { model: PaneModel; hotkeysOf: HotkeysOf; actions: PaneActions }

// The shortcuts drawn in the bar under the code; every other one keeps its key through a hidden button.
const FOOTER_ACTIONS: readonly ShortcutAction[] = ['findEverything', 'fileOutline', 'goToLine', 'searchInFile', 'showUsages', 'showImplementations', 'closeTab', 'toggleTabsColumn', 'toggleFiles', 'copyLocation', 'toggleHelp']
const HEADER_ACTIONS: readonly ShortcutAction[] = ['goBack', 'goForward']
const RESULTS_ACTIONS: readonly ShortcutAction[] = ['previousResult', 'nextResult', 'closeResults']

const HEADER_LABELS: Partial<Record<ShortcutAction, string>> = { goBack: '◀', goForward: '▶' }

const PALETTE_FIELD_LABELS: Record<PaletteMode, string> = { everything: 'find', outline: 'structure', textSearch: 'grep', goToLine: 'go to line' }
const PALETTE_PLACEHOLDERS: Record<PaletteMode, string> = {
  everything: 'a file, a class or a method: OrRe, Order::save, src/Order, name:42',
  outline: 'a symbol of this file',
  textSearch: 'a text to search',
  goToLine: 'a line number',
}
const PALETTE_SUBMIT_LABELS: Record<PaletteMode, string> = { everything: 'open', outline: 'go', textSearch: 'search', goToLine: 'go' }
const RESULTS_HEADINGS: Record<ResultsKind, string> = {
  definitions: 'Declarations',
  usages: 'Usages',
  implementations: 'Implementations',
  parents: 'Parents',
  textSearch: 'Search',
  bookmarks: 'Bookmarks',
}
// A row that names no declaration: a file, or a line of the file shown. A symbol row is signed by its kind instead.
const SIGNS_OF_ITEMS_WITHOUT_SYMBOL: Record<PaletteItemKind, string> = { file: '◇', line: '#', symbol: '·' }
// The usages list repeats one name on every row, so its rows show where they are and what the line says instead.
const IS_LABEL_SHOWN_IN_RESULTS: Record<ResultsKind, boolean> = { definitions: true, implementations: true, parents: true, usages: false, textSearch: false, bookmarks: false }
// A bookmark is taken off from its row too: its line may have left the file, its number no longer drawn to click.
const IS_REMOVABLE_IN_RESULTS: Record<ResultsKind, boolean> = { definitions: false, implementations: false, parents: false, usages: false, textSearch: false, bookmarks: true }
const IS_MARK_OF_UNVERIFIED_ROW: Record<ResultRowMark, boolean> = { exact: false, confirmed: false, match: false, candidate: true, unverified: true }

export function shortcutButtonKey(action: ShortcutAction, hotkey: string): string {
  return `${SHORTCUT_KEY_PREFIX}${action}-${hotkey}`
}

export function paletteFieldKey(fieldNumber: number): string {
  return `${PALETTE_FIELD_KEY_PREFIX}${fieldNumber}`
}

export function tokenButtonKey(lineNumber: number, column: number): string {
  return `${TOKEN_KEY_PREFIX}${lineNumber}-${column}`
}

export function tokenHintKey(lineNumber: number, column: number): string {
  return `${TOKEN_HINT_KEY_PREFIX}${lineNumber}-${column}`
}

function truncatedEnd(text: string, columns: number): string {
  if (columns <= 0) {
    return ''
  }

  return text.length <= columns ? text : `${text.slice(0, columns - 1)}…`
}

// A path too long for its room keeps its end, which names the file.
function truncatedStart(text: string, columns: number): string {
  if (columns <= 0) {
    return ''
  }

  return text.length <= columns ? text : `…${text.slice(text.length - (columns - 1))}`
}

// The palette lies over the code: what is under it is drawn as plain text. The engine tells the element holding the
// keyboard by its place among the pane's controls, so the code scrolling or a list appearing under the palette as
// its field is typed in must not add or take away a control ahead of the field.
function isPaneClickable(input: PaneInput): boolean {
  return input.model.palette === null
}

function clickableWhenPaneIs(ui: ViewElements, input: PaneInput, key: string, onPress: () => Promise<void>, ...children: RenderChildren[]) {
  const { Box, Button } = ui
  if (!isPaneClickable(input)) {
    return <Box flexDirection="row">{children}</Box>
  }

  return (
    <Button key={key} plain onPress={onPress}>
      {children}
    </Button>
  )
}

export function renderNarrowPane(ui: ViewElements, bodyColumns: number) {
  const { Box, Text } = ui

  return (
    <Box flexDirection="column" padding={1}>
      <Text color={ui.theme.notice} bold>
        The code pane needs at least {MIN_PANE_COLUMNS} columns (now {bodyColumns}).
      </Text>
      <Text color={ui.theme.muted}>Widen it by dragging its edge, or widen the terminal.</Text>
    </Box>
  )
}

function renderShortcutButtons(ui: ViewElements, input: PaneInput, action: ShortcutAction, label: string, isDimmed = false) {
  const { Box, Button } = ui
  const [shownHotkey, ...otherHotkeys] = input.hotkeysOf(action)
  if (shownHotkey === undefined) {
    return null
  }

  return (
    <Box key={`shortcut-box-${action}`} flexDirection="row" flexShrink={0} marginRight={2}>
      <Button
        key={shortcutButtonKey(action, shownHotkey)}
        plain
        dimColor={isDimmed}
        hotkey={shownHotkey}
        label={label}
        onPress={() => input.actions.runShortcut(action)}
      />
      <Box key={`shortcut-other-keys-${action}`} display="none">
        {otherHotkeys.map(hotkey => (
          <Button key={shortcutButtonKey(action, hotkey)} plain hotkey={hotkey} label={label} onPress={() => input.actions.runShortcut(action)} />
        ))}
      </Box>
    </Box>
  )
}

function renderHiddenShortcuts(ui: ViewElements, input: PaneInput, shownActions: readonly ShortcutAction[]) {
  const { Box, Button } = ui

  return (
    <Box key="hidden-shortcuts" display="none">
      {SHORTCUTS.filter(shortcut => !shownActions.includes(shortcut.action)).flatMap(shortcut =>
        input.hotkeysOf(shortcut.action).map(hotkey => (
          <Button
            key={shortcutButtonKey(shortcut.action, hotkey)}
            plain
            hotkey={hotkey}
            label={shortcut.label}
            onPress={() => input.actions.runShortcut(shortcut.action)}
          />
        )),
      )}
    </Box>
  )
}

const BREADCRUMB_SUFFIXES: Record<SymbolKind, string> = {
  class: '',
  interface: '',
  trait: '',
  enum: '',
  function: '()',
  method: '()',
  constant: '',
  property: '',
  type: '',
  variable: '',
  section: '',
}

const BREADCRUMB_LEAD = '  › '
const PATH_COLUMNS_ALWAYS_SHOWN = 50

function breadcrumbLabelOf(breadcrumb: readonly BreadcrumbStep[]): string {
  return breadcrumb.map(step => `${step.name}${BREADCRUMB_SUFFIXES[step.kind]}`).join(' › ')
}

// Where the reading stands: the declarations holding the line read, the innermost kept when they do not fit; a click
// opens the structure of the file.
function renderBreadcrumb(ui: ViewElements, input: PaneInput, columns: number) {
  const { breadcrumb } = input.model
  const { Box, Button, Text } = ui
  if (breadcrumb.length === 0 || columns <= BREADCRUMB_LEAD.length + 3) {
    return null
  }
  const label = truncatedStart(breadcrumbLabelOf(breadcrumb), columns - BREADCRUMB_LEAD.length)
  const text = (
    <Text color={ui.theme.heading}>
      <Text color={ui.theme.border}>{BREADCRUMB_LEAD}</Text>
      {label}
    </Text>
  )

  return (
    <Box flexShrink={0}>
      {isPaneClickable(input) ? (
        <Button key="breadcrumb" plain label={label} onPress={() => input.actions.runShortcut('fileOutline')}>
          {text}
        </Button>
      ) : (
        text
      )}
    </Box>
  )
}

function renderHeader(ui: ViewElements, input: PaneInput) {
  const { Box, Button, Text } = ui
  const { model } = input
  const lastShownLine = Math.min(model.lineCount, model.firstLine + model.geometry.codeRows - 1)
  const position = model.lineCount === 0 ? '' : `  ${model.firstLine}-${lastShownLine} of ${model.lineCount}`
  const indexText = model.isIndexing
    ? 'indexing…'
    : model.indexSummary === null
      ? ''
      : `${model.indexSummary.fileCount} files · ${model.indexSummary.symbolCount} names · ${model.indexSummary.durationMs} ms`
  const dependencyTag = model.isDependencyFile ? ' dependency ' : ''
  const scrolledText = model.scrolledColumns > 0 ? `  ‹ from column ${model.scrolledColumns + 1}` : ''
  const columnsBesideIndex = 16 + BADGE_COLUMNS + FILES_TOGGLE_COLUMNS + TABS_TOGGLE_COLUMNS + position.length + dependencyTag.length + scrolledText.length + 4
  // The path comes first, its end at least; the declarations read take what it leaves, up to a third of the header;
  // the size of the index, the least needed, goes when they would not all fit.
  const pathColumns = model.path?.length ?? 0
  const breadcrumbWanted = model.breadcrumb.length === 0 ? 0 : Math.min(breadcrumbLabelOf(model.breadcrumb).length + BREADCRUMB_LEAD.length, Math.floor(model.geometry.bodyColumns / 3))
  const isIndexShown = model.geometry.bodyColumns - columnsBesideIndex - pathColumns - breadcrumbWanted >= indexText.length
  const fixedColumns = columnsBesideIndex + (isIndexShown ? indexText.length : 0)
  const breadcrumbRoom = Math.max(0, Math.min(breadcrumbWanted, model.geometry.bodyColumns - fixedColumns - Math.min(pathColumns, PATH_COLUMNS_ALWAYS_SHOWN)))
  const pathRoom = Math.max(10, model.geometry.bodyColumns - fixedColumns - breadcrumbRoom)

  return (
    <Box flexDirection="row" height={1} flexShrink={0} backgroundColor={ui.theme.headerBackground} paddingX={1}>
      {model.tabsMode === 'drawer' && (
        <Box key="tabs-toggle-box" flexShrink={0} marginRight={2} backgroundColor={model.geometry.tabsDrawerWidth > 0 ? ui.theme.selectedBackground : undefined}>
          <Button key="tabs-toggle" plain label="≡ Tabs" onPress={() => input.actions.toggleTabsDrawer()}>
            <Text color={ui.theme.accent} bold>
              {' ≡ Tabs '}
            </Text>
          </Button>
        </Box>
      )}
      {renderShortcutButtons(ui, input, 'goBack', HEADER_LABELS.goBack ?? 'back', !model.canGoBack)}
      {renderShortcutButtons(ui, input, 'goForward', HEADER_LABELS.goForward ?? 'forward', !model.canGoForward)}
      <Box flexGrow={1} flexShrink={1} minWidth={0} flexDirection="row" overflow="hidden">
        {model.path !== null && renderFileBadge(ui, model.path)}
        <Text color={ui.theme.heading} bold wrap="truncate-end">
          {model.path === null ? 'No file shown' : truncatedStart(model.path, pathRoom)}
        </Text>
        {dependencyTag !== '' && <Text color={ui.theme.dependency}>{dependencyTag}</Text>}
        {renderBreadcrumb(ui, input, breadcrumbRoom)}
        <Box flexShrink={0}>
          <Text color={ui.theme.muted}>{position}</Text>
          {scrolledText !== '' && <Text color={ui.theme.accent}>{scrolledText}</Text>}
        </Box>
      </Box>
      {isIndexShown && (
        <Box flexShrink={0}>
          <Text color={ui.theme.muted}>{indexText}</Text>
        </Box>
      )}
      {model.explorerMode === 'drawer' && (
        <Box key="files-toggle-box" flexShrink={0} marginLeft={2} backgroundColor={model.geometry.drawerWidth > 0 ? ui.theme.selectedBackground : undefined}>
          <Button key="files-toggle" plain label="≡ Files" onPress={() => input.actions.toggleFilesDrawer()}>
            <Text color={ui.theme.accent} bold>
              {' ≡ Files '}
            </Text>
          </Button>
        </Box>
      )}
    </Box>
  )
}

function renderMenuButton(ui: ViewElements, key: string, label: string, hint: string, onPress: () => Promise<void>) {
  const { Box, Button, Text } = ui

  return (
    <Box key={`${key}-box`} flexShrink={0} marginRight={1}>
      <Button key={key} plain label={label} onPress={onPress}>
        <Text color={ui.theme.accent} bold>
          {` ${label} `}
        </Text>
        {hint !== '' && <Text color={ui.theme.muted}>{`${hint} `}</Text>}
      </Button>
    </Box>
  )
}

// What the buttons after it act on: the file shown, or the whole project.
function renderMenuGroupTitle(ui: ViewElements, title: string) {
  const { Text } = ui

  return <Text color={ui.theme.muted}>{`${title} `}</Text>
}

function renderMenuSeparator(ui: ViewElements) {
  const { Text } = ui

  return <Text color={ui.theme.border}>{'│ '}</Text>
}

// The searches, always within one click, and where the last text search stands with its previous and next match.
function renderMenuBar(ui: ViewElements, input: PaneInput) {
  const { Box, Button, Text } = ui
  const { theme } = ui
  const status = input.model.textSearchStatus
  const [findHotkey = ''] = input.hotkeysOf('findEverything')
  const [structureHotkey = ''] = input.hotkeysOf('fileOutline')
  const [lineHotkey = ''] = input.hotkeysOf('goToLine')
  const [fileSearchHotkey = ''] = input.hotkeysOf('searchInFile')
  const [projectSearchHotkey = ''] = input.hotkeysOf('searchInProject')

  return (
    <Box key="menu-bar" flexDirection="row" height={1} flexShrink={0} paddingX={1} backgroundColor={theme.paletteBackground} overflow="hidden">
      {renderMenuGroupTitle(ui, 'FILE')}
      {renderMenuButton(ui, 'menu-structure', '☰ Structure', structureHotkey, () => input.actions.runShortcut('fileOutline'))}
      {renderMenuButton(ui, 'menu-go-to-line', '↧ Line', lineHotkey, () => input.actions.runShortcut('goToLine'))}
      {renderMenuButton(ui, 'menu-search-in-file', '⌕ Search', fileSearchHotkey, () => input.actions.runShortcut('searchInFile'))}
      {renderMenuSeparator(ui)}
      {renderMenuGroupTitle(ui, 'PROJECT')}
      {renderMenuButton(ui, 'menu-find', '⌕ Find', findHotkey, () => input.actions.runShortcut('findEverything'))}
      {renderMenuButton(ui, 'menu-search-in-project', '⌕ Search', projectSearchHotkey, () => input.actions.runShortcut('searchInProject'))}
      {renderMenuSeparator(ui)}
      {renderMenuButton(ui, 'menu-bookmarks', '◆ Bookmarks', input.model.bookmarkCount === 0 ? '' : String(input.model.bookmarkCount), () => input.actions.listBookmarks())}
      {renderSelectionForClaude(ui, input)}
      {status !== null && (
        <Box key="search-status" flexDirection="row" flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
          <Text color={theme.border}>{'│ '}</Text>
          <Box flexShrink={1} minWidth={0} overflow="hidden">
            <Text color={theme.heading} bold wrap="truncate-end">
              "{status.text}"
            </Text>
          </Box>
          <Text color={theme.muted}>{` · ${searchPositionText(status)}  `}</Text>
          {isPaneClickable(input) && status.matchCount > 0 && (
            <Box key="search-steps" flexDirection="row" flexShrink={0}>
              <Button key="search-previous" plain label="◀ previous" onPress={() => input.actions.runShortcut('previousResult')} />
              <Text>  </Text>
              <Button key="search-next" plain label="next ▶" onPress={() => input.actions.runShortcut('nextResult')} />
              <Text>  </Text>
            </Box>
          )}
          {isPaneClickable(input) && <Button key="search-clear" plain dimColor label="×" onPress={() => input.actions.runShortcut('closeResults')} />}
        </Box>
      )}
    </Box>
  )
}

// The lines selected with the mouse that Claude reads with the next message, until set aside.
function renderSelectionForClaude(ui: ViewElements, input: PaneInput) {
  const { Box, Button, Text } = ui
  const { selectedLines } = input.model
  if (selectedLines === null) {
    return null
  }
  const lineRange = `${linesWordOf(selectedLines)} ${lineRangeOf(selectedLines)}`

  return (
    <Box key="selection-for-claude" flexDirection="row" flexShrink={0} marginRight={2}>
      <Text color={ui.theme.border}>{'│ '}</Text>
      <Text color={ui.theme.notice}>{`◆ Claude sees ${lineRange} with your next message `}</Text>
      {isPaneClickable(input) && <Button key="set-selection-aside" plain dimColor label="×" onPress={() => input.actions.setSelectionAside()} />}
    </Box>
  )
}

function searchPositionText(status: TextSearchStatus): string {
  const count = `${status.matchCount}${status.isTruncated ? '+' : ''}`
  if (status.matchCount === 0) {
    return 'no match'
  }

  return status.selectedPosition === null ? `${count} ${status.matchCount === 1 ? 'match' : 'matches'}` : `${status.selectedPosition} / ${count}`
}

// What a tab's button is called, by a screen reader as by a test: its file, and whether it is the one shown.
export function tabButtonLabelOf(name: string, isActive: boolean): string {
  return isActive ? `${name} (shown)` : name
}

// The tabs that fit, the active one drawn on the code's background.
function renderTabStrip(ui: ViewElements, input: PaneInput) {
  const { Box, Button, Text } = ui
  const { theme } = ui
  const { tabStrip } = input.model
  if (tabStrip === null) {
    return null
  }

  return (
    <Box key="tab-strip" flexDirection="row" height={1} flexShrink={0} paddingX={1} overflow="hidden" backgroundColor={theme.headerBackground}>
      {tabStrip.hiddenBeforeCount > 0 && <Text color={theme.muted}>‹ {tabStrip.hiddenBeforeCount} </Text>}
      {tabStrip.shownTabs.map(tab => (
        <Box key={`tab-box-${tab.index}`} flexDirection="row" flexShrink={0} backgroundColor={tab.isActive ? theme.panelBackground : undefined}>
          <Text> </Text>
          {renderFileBadge(ui, tab.path)}
          <Button key={`strip-${TAB_BUTTON_KEY_PREFIX}${tab.index}`} plain label={tabButtonLabelOf(tab.label, tab.isActive)} onPress={() => input.actions.activateTab(tab.index)}>
            <Text color={tab.isActive ? theme.heading : theme.muted} bold={tab.isActive}>
              {`${tab.label} `}
            </Text>
          </Button>
          <Button key={`strip-${CLOSE_TAB_BUTTON_KEY_PREFIX}${tab.index}`} plain dimColor label="×" onPress={() => input.actions.closeTab(tab.index)} />
          <Text color={theme.border}>│</Text>
        </Box>
      ))}
      {tabStrip.hiddenAfterCount > 0 && <Text color={theme.muted}> {tabStrip.hiddenAfterCount} ›</Text>}
    </Box>
  )
}

function renderNotice(ui: ViewElements, input: PaneInput) {
  const { Box, Button, Text } = ui
  if (input.model.notice === null) {
    return null
  }

  return (
    <Box key="notice-box" flexDirection="row" height={1} flexShrink={0} paddingX={1}>
      <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
        <Text color={ui.theme.notice} wrap="truncate-end">
          {truncatedEnd(input.model.notice, Math.max(1, input.model.geometry.bodyColumns - 6))}
        </Text>
      </Box>
      {isPaneClickable(input) && <Button key="dismiss-notice" plain dimColor label="×" onPress={() => input.actions.dismissNotice()} />}
    </Box>
  )
}

const CLICK_HINT_LABELS: Record<ClickHint, string> = { definition: ' ↪ go to definition ', usages: ' ↪ list usages ' }
// A declaration may override or implement one above it: what it is a version of is one click up.
const IS_PARENT_HINT_SHOWN: Record<ClickHint, boolean> = { definition: false, usages: true }
const PARENTS_HINT_LABEL = ' ↑ parents '

// Above the name the pointer rests on, or under it on the first row where there is no room above: the one place a
// click goes somewhere, so that a click on the name itself only points at it.
function renderClickHint(ui: ViewElements, input: PaneInput, row: CodeRow, navigableColumn: number, clickHint: ClickHint, isFirstRow: boolean) {
  const { Box, Button, Text } = ui

  return (
    <Box position="absolute" top={isFirstRow ? 1 : -1} left={0} display="none" hover={{ display: 'flex' }}>
      <Button key={tokenHintKey(row.lineNumber, navigableColumn)} plain label={CLICK_HINT_LABELS[clickHint]} onPress={() => input.actions.activateToken(row.lineNumber, navigableColumn)}>
        <Text color={ui.theme.accent} backgroundColor={ui.theme.headerBackground}>
          {CLICK_HINT_LABELS[clickHint]}
        </Text>
      </Button>
      {IS_PARENT_HINT_SHOWN[clickHint] && (
        <Button key={`token-parents-${row.lineNumber}-${navigableColumn}`} plain label={PARENTS_HINT_LABEL} onPress={() => input.actions.listParents(row.lineNumber, navigableColumn)}>
          <Text color={ui.theme.accent} backgroundColor={ui.theme.headerBackground}>
            {PARENTS_HINT_LABEL}
          </Text>
        </Button>
      )}
    </Box>
  )
}

const CUT_LABELS: Record<CutSide, string> = { before: 'scroll left', after: 'scroll right' }

// The mark of the line pointed at or of a bookmark, then the line's number: a click on it sets or takes off a bookmark.
function renderGutter(ui: ViewElements, input: PaneInput, row: CodeRow, numberColumns: number) {
  const { Box, Button, Text } = ui
  const { theme } = ui
  const isBehindOverlay = input.model.isCodeDimmed
  const sign = row.isMarkedLine ? MARKED_LINE_SIGN : row.isBookmarked ? BOOKMARK_SIGN : ' '
  const signColor = isBehindOverlay ? theme.overlaidCode : row.isMarkedLine ? theme.accent : theme.notice
  const numberColor = isBehindOverlay ? theme.overlaidCode : row.isMarkedLine ? theme.accent : row.isBookmarked ? theme.notice : theme.lineNumber
  const number = String(row.lineNumber).padStart(numberColumns)
  if (!isPaneClickable(input)) {
    return (
      <Text color={numberColor}>
        <Text color={signColor}>{sign}</Text>
        {number}{' '}
      </Text>
    )
  }

  return (
    <Box key={`gutter-box-${row.lineNumber}`} flexDirection="row" flexShrink={0}>
      <Button key={`gutter-${row.lineNumber}`} plain label={number} hover={{ underline: true }} onPress={() => input.actions.toggleBookmark(row.lineNumber)}>
        <Text color={numberColor}>
          <Text color={signColor}>{sign}</Text>
          {number}
        </Text>
      </Button>
      <Text> </Text>
    </Box>
  )
}

function renderCodeRow(ui: ViewElements, input: PaneInput, row: CodeRow, isFirstRow: boolean) {
  const { Box, Button, Text } = ui
  const { theme } = ui
  const numberColumns = input.model.geometry.gutterWidth - 2
  const isBehindOverlay = input.model.isCodeDimmed

  return (
    <Box
      key={`line-${row.lineNumber}`}
      flexDirection="row"
      height={1}
      flexShrink={0}
      backgroundColor={row.isMarkedLine && !isBehindOverlay ? theme.markedLineBackground : undefined}
    >
      {renderGutter(ui, input, row, numberColumns)}
      {row.pieces.map(piece => {
        const text = (
          <Text color={isBehindOverlay ? theme.overlaidCode : theme.tokenColors[piece.kind]} backgroundColor={isBehindOverlay ? undefined : highlightBackgroundOf(theme, piece.highlight)}>
            {piece.text}
          </Text>
        )
        const { cut } = piece
        if (cut !== null) {
          return isPaneClickable(input) ? (
            <Button key={`cut-${cut}-${row.lineNumber}`} plain label={CUT_LABELS[cut]} onPress={() => input.actions.scrollCodeSideways(cut)}>
              <Text color={isBehindOverlay ? theme.overlaidCode : theme.accent}>{piece.text}</Text>
            </Button>
          ) : (
            text
          )
        }
        const { navigableColumn, clickHint } = piece
        if (navigableColumn === null || clickHint === null || !isPaneClickable(input)) {
          return text
        }

        return (
          <Box key={`token-hover-${row.lineNumber}-${navigableColumn}`} flexDirection="row" flexShrink={0}>
            <Button
              key={tokenButtonKey(row.lineNumber, navigableColumn)}
              plain
              hover={{ underline: true }}
              onPress={() => input.actions.markToken(row.lineNumber, navigableColumn)}
            >
              {text}
            </Button>
            {renderClickHint(ui, input, row, navigableColumn, clickHint, isFirstRow)}
          </Box>
        )
      })}
    </Box>
  )
}

function renderCode(ui: ViewElements, input: PaneInput) {
  const { Box, Text } = ui
  const { model } = input
  if (model.codeRows.length === 0) {
    const message = model.isFileLoading
      ? `Reading ${model.path ?? ''}…`
      : model.path === null
        ? 'No file shown yet. Press f to find a file, a class or a method by name.'
        : 'This file is empty.'

    return (
      <Box flexDirection="column" height={model.geometry.codeRows} flexShrink={0} padding={1}>
        <Text color={ui.theme.muted}>{message}</Text>
        {model.path === null && <Text color={ui.theme.muted}>Click a name in the code to go to its declaration; click a declaration to list its usages.</Text>}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" height={model.geometry.codeRows} flexShrink={0} overflow="hidden" backgroundColor={ui.theme.panelBackground}>
      {model.codeRows.map((row, rowIndex) => renderCodeRow(ui, input, row, rowIndex === 0))}
    </Box>
  )
}

// The place of the list's selected row, previewed between the code and the list without leaving the file read.
function renderPeek(ui: ViewElements, input: PaneInput, peek: PeekView) {
  const { Box, Button, Text } = ui
  const { theme } = ui
  const location = `${peek.path}:${peek.line}`
  const titleChromeColumns = 'PREVIEW '.length + BADGE_COLUMNS + '[ Open file ⏎ ]'.length + '  ×'.length + 4 + 2 * PEEK_FRAME_THICKNESS
  const titleColumns = Math.max(1, input.model.geometry.codeAreaColumns - titleChromeColumns)

  return (
    <Box key="peek" flexDirection="column" flexShrink={0} backgroundColor={theme.paletteBackground} borderStyle="round" borderColor={theme.accent}>
      <Box key="peek-title" flexDirection="row" height={1} flexShrink={0} paddingX={1} backgroundColor={theme.headerBackground}>
        <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
          <Text color={theme.accent} bold>
            {'PREVIEW '}
          </Text>
          {renderFileBadge(ui, peek.path)}
          <Text color={theme.heading} wrap="truncate-end">{truncatedStart(location, titleColumns)}</Text>
        </Box>
        {isPaneClickable(input) && <Button key={PEEK_OPEN_KEY} variant="primary" label="Open file ⏎" onPress={() => input.actions.openPeekedRow()} />}
        <Text>  </Text>
        {isPaneClickable(input) && <Button key="peek-close" plain dimColor label="×" onPress={() => input.actions.closePeek()} />}
      </Box>
      {peek.isLoading && <Text color={theme.muted}>  Reading {peek.path}…</Text>}
      {peek.codeRows.map(row => (
        <Box key={`peek-line-${row.lineNumber}`} flexDirection="row" height={1} flexShrink={0} backgroundColor={row.isMarkedLine ? theme.markedLineBackground : undefined}>
          <Text color={row.isMarkedLine ? theme.accent : theme.lineNumber}>
            {row.isMarkedLine ? MARKED_LINE_SIGN : ' '}
            {String(row.lineNumber).padStart(peek.gutterWidth - 2)}{' '}
          </Text>
          {row.pieces.map(piece => (
            <Text color={theme.tokenColors[piece.kind]} backgroundColor={highlightBackgroundOf(theme, piece.highlight)}>
              {piece.text}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  )
}

function locationOf(row: ResultRow): string {
  return `${row.path}:${row.line}`
}

function resultsTitleOf(resultsPanel: ResultsPanel): string {
  const unverifiedCount = resultsPanel.rows.filter(row => IS_MARK_OF_UNVERIFIED_ROW[row.mark]).length
  const count = `${resultsPanel.rows.length}${resultsPanel.isTruncated ? '+' : ''}`
  const uncertainty = unverifiedCount > 0 && unverifiedCount < resultsPanel.rows.length ? `, ${unverifiedCount} not verified` : ''

  return `${RESULTS_HEADINGS[resultsPanel.kind]} · ${resultsPanel.title} · ${count}${uncertainty}`
}

// Beside the place of each row: the one click that goes into its file, the rest of the row previewing it.
const RESULT_OPEN_LABEL = ' ↗ open '
const RESULT_OPEN_KEY_PREFIX = 'result-open-'
const RESULT_REMOVE_LABEL = ' × remove '
const RESULT_REMOVE_KEY_PREFIX = 'result-remove-'
const RESULT_PREVIEW_KEY_PREFIX = 'result-preview-'

function renderResults(ui: ViewElements, input: PaneInput) {
  const { Box, Button, Text } = ui
  const { theme } = ui
  const { model } = input
  const { resultsPanel } = model
  if (resultsPanel === null) {
    return null
  }
  const shownRows = resultsPanel.rows.slice(model.firstShownResultIndex, model.firstShownResultIndex + model.geometry.resultsRows)
  const labelColumns = IS_LABEL_SHOWN_IN_RESULTS[resultsPanel.kind] ? Math.min(40, Math.max(0, ...shownRows.map(row => row.label.length))) : 0
  const locationColumns = Math.min(Math.floor(model.geometry.codeAreaColumns * 0.45), Math.max(0, ...shownRows.map(row => locationOf(row).length)))
  const isRemoveShown = IS_REMOVABLE_IN_RESULTS[resultsPanel.kind] && isPaneClickable(input)
  const removeColumns = isRemoveShown ? RESULT_REMOVE_LABEL.length : 0
  const previewColumns = Math.max(0, model.geometry.codeAreaColumns - 2 - 2 - (labelColumns > 0 ? labelColumns + 2 : 0) - locationColumns - 1 - RESULT_OPEN_LABEL.length - removeColumns - 1)

  return (
    <Box key="results-box" flexDirection="column" flexShrink={0}>
      <Box flexDirection="row" height={1} flexShrink={0} backgroundColor={theme.headerBackground} paddingX={1}>
        <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
          <Text color={theme.heading} bold wrap="truncate-end">
            {truncatedEnd(resultsTitleOf(resultsPanel), Math.max(1, model.geometry.codeAreaColumns - 40))}
          </Text>
        </Box>
        {isPaneClickable(input) &&
          RESULTS_ACTIONS.map(action => renderShortcutButtons(ui, input, action, SHORTCUTS.find(shortcut => shortcut.action === action)?.label ?? action))}
      </Box>
      {resultsPanel.rows.length === 0 && (
        <Box height={1} paddingX={1}>
          <Text color={theme.muted}>{resultsPanel.note ?? 'Nothing found.'}</Text>
        </Box>
      )}
      {shownRows.map((row, shownIndex) => {
        const rowIndex = model.firstShownResultIndex + shownIndex
        const isSelected = rowIndex === resultsPanel.selectedIndex

        return (
          <Box
            key={`result-box-${rowIndex}`}
            flexDirection="row"
            height={1}
            flexShrink={0}
            paddingX={1}
            backgroundColor={isSelected ? theme.selectedBackground : theme.panelBackground}
          >
            {clickableWhenPaneIs(
              ui,
              input,
              `${RESULT_ROW_KEY_PREFIX}${rowIndex}`,
              () => input.actions.pressResultRow(rowIndex),
              <Text color={theme.resultMarkColors[row.mark]}>{RESULT_MARK_SIGNS[row.mark]} </Text>,
              labelColumns > 0 ? <Text color={theme.heading}>{truncatedEnd(row.label, labelColumns).padEnd(labelColumns + 2)}</Text> : null,
              <Text color={row.isDependency ? theme.dependency : theme.accent}>{truncatedStart(locationOf(row), locationColumns).padEnd(locationColumns + 1)}</Text>,
            )}
            {clickableWhenPaneIs(
              ui,
              input,
              `${RESULT_OPEN_KEY_PREFIX}${rowIndex}`,
              () => input.actions.openResultRow(rowIndex),
              <Text color={theme.accent}>{RESULT_OPEN_LABEL}</Text>,
            )}
            {isRemoveShown && (
              <Button key={`${RESULT_REMOVE_KEY_PREFIX}${rowIndex}`} plain dimColor label={RESULT_REMOVE_LABEL} onPress={() => input.actions.removeBookmarkOfRow(rowIndex)} />
            )}
            <Text> </Text>
            {clickableWhenPaneIs(
              ui,
              input,
              `${RESULT_PREVIEW_KEY_PREFIX}${rowIndex}`,
              () => input.actions.pressResultRow(rowIndex),
              <Text color={theme.text}>{truncatedEnd(row.preview, previewColumns)}</Text>,
            )}
          </Box>
        )
      })}
    </Box>
  )
}

function renderFooter(ui: ViewElements, input: PaneInput) {
  const { Box } = ui

  return (
    <Box key="footer-box" flexDirection="row" height={1} flexShrink={0} paddingX={1} backgroundColor={ui.theme.headerBackground} overflow="hidden">
      {FOOTER_ACTIONS.map(action => renderShortcutButtons(ui, input, action, SHORTCUTS.find(shortcut => shortcut.action === action)?.label ?? action))}
    </Box>
  )
}

function renderHelp(ui: ViewElements, input: PaneInput) {
  const { Box, Text } = ui
  const { theme } = ui

  return (
    <Box key="help-box" flexDirection="column" height={input.model.geometry.codeRows} flexShrink={0} paddingX={2} paddingY={1} overflow="hidden">
      <Text color={theme.heading} bold>
        Click a name to go to its declaration. Click a declaration to list its usages.
      </Text>
      <Text color={theme.muted}>The keys below work while the pane holds the keyboard: click in it, or press the focus chord.</Text>
      {SHORTCUT_GROUPS.map(group => (
        <Box key={`help-group-${group}`} flexDirection="column" marginTop={1}>
          <Text color={theme.accent} bold>
            {group}
          </Text>
          {shortcutsOfGroup(group).map(shortcut => (
            <Text color={theme.text}>
              <Text color={theme.notice}>{(input.hotkeysOf(shortcut.action).join(' / ') || 'mouse').padEnd(7)}</Text>
              {shortcut.description}
            </Text>
          ))}
        </Box>
      ))}
      <Box marginTop={1}>
        <Text color={theme.muted}>1 to 9 show the tab of that number. Escape closes what is open, then the pane. In the find field: ↑ ↓ pick a row, Enter opens it.</Text>
      </Box>
    </Box>
  )
}

function matchedLabelPieces(label: string, matchedIndexes: readonly number[]): Array<{ text: string; isMatched: boolean }> {
  const matched = new Set(matchedIndexes)
  const pieces: Array<{ text: string; isMatched: boolean }> = []
  for (const [characterIndex, character] of [...label].entries()) {
    const isMatched = matched.has(characterIndex)
    const previousPiece = pieces[pieces.length - 1]
    if (previousPiece && previousPiece.isMatched === isMatched) {
      previousPiece.text += character
    } else {
      pieces.push({ text: character, isMatched })
    }
  }

  return pieces
}

function renderPaletteItem(ui: ViewElements, input: PaneInput, item: PaletteItem, itemIndex: number, isSelected: boolean, innerColumns: number) {
  const { Box, Button, Text } = ui
  const { theme } = ui
  const sign = item.symbolKind !== null ? SYMBOL_KIND_LETTERS[item.symbolKind] : SIGNS_OF_ITEMS_WITHOUT_SYMBOL[item.kind]
  const signColor = item.symbolKind !== null ? theme.symbolKindColors[item.symbolKind] : theme.muted
  const label = truncatedEnd(item.label, Math.max(8, innerColumns - 4))
  const detail = truncatedStart(item.detail, Math.max(0, innerColumns - 4 - label.length - 2))

  return (
    <Box key={`palette-item-box-${itemIndex}`} flexDirection="row" height={1} flexShrink={0} backgroundColor={isSelected ? theme.selectedBackground : undefined}>
      <Button key={`${PALETTE_ITEM_KEY_PREFIX}${itemIndex}`} plain onPress={() => input.actions.openPaletteItem(itemIndex)}>
        <Text color={isSelected ? theme.accent : theme.muted}>{isSelected ? '▸' : ' '}</Text>
        <Text color={signColor}>{sign} </Text>
        {matchedLabelPieces(label, item.matchedIndexes).map(piece => (
          <Text color={piece.isMatched ? theme.accent : theme.heading} bold={piece.isMatched}>
            {piece.text}
          </Text>
        ))}
        <Text color={theme.muted}>{detail === '' ? '' : `  ${detail}`}</Text>
      </Button>
    </Box>
  )
}

const TEXT_SCOPES: readonly TextSearchScope[] = ['file', 'project']

// Where the text is searched, one choice lit; a click or the arrows of the field pick the other.
function renderTextScopes(ui: ViewElements, input: PaneInput, textScope: TextSearchScope) {
  const { Box, Button, Text } = ui
  const { theme } = ui
  const fileName = input.model.path === null ? '' : baseNameOf(input.model.path)
  const labels: Record<TextSearchScope, string> = { file: `in this file${fileName === '' ? '' : ` (${fileName})`}`, project: 'in the whole project' }

  return (
    <Box key="text-scopes" flexDirection="row" height={1} flexShrink={0}>
      {TEXT_SCOPES.map(scope => (
        <Box key={`text-scope-box-${scope}`} flexDirection="row" flexShrink={0} marginRight={3}>
          <Button key={`${TEXT_SCOPE_KEY_PREFIX}${scope}`} plain label={labels[scope]} onPress={() => input.actions.setTextScope(scope)}>
            <Text color={scope === textScope ? theme.accent : theme.muted} bold={scope === textScope}>
              {`${scope === textScope ? '◉' : '○'} ${labels[scope]}`}
            </Text>
          </Button>
        </Box>
      ))}
    </Box>
  )
}

function renderPalette(ui: ViewElements, input: PaneInput) {
  const { Box, Button, Input, Text } = ui
  const { theme } = ui
  const { model } = input
  const { palette } = model
  if (palette === null) {
    return null
  }
  const innerColumns = model.geometry.paletteWidth - 4
  const shownItems = model.paletteItems.slice(model.firstShownPaletteItemIndex, model.firstShownPaletteItemIndex + model.geometry.paletteShownItems)
  const statusOfRows = () => {
    if (model.paletteItems.length > 0) {
      return `${model.paletteItems.length} shown · ↑ ↓ pick · Enter opens · Esc closes`
    }
    if (model.isIndexing) {
      return 'Listing the project…'
    }

    return palette.query === '' ? 'Type a few letters · Esc closes' : 'Nothing matches'
  }
  const statusOfMode: Record<PaletteMode, () => string> = {
    everything: statusOfRows,
    outline: statusOfRows,
    textSearch: () => {
      const statusOfScope: Record<TextSearchScope, () => string> = {
        file: () => {
          const matchCount = model.resultsPanel?.kind === 'textSearch' ? model.resultsPanel.rows.length : 0
          const found = palette.query === '' ? 'Type a text' : `${matchCount}${model.resultsPanel?.isTruncated ? '+' : ''} in this file`

          return `${found} · Enter goes to the first · ↑ ↓ where · Esc closes`
        },
        project: () => 'Enter searches every file · ↑ ↓ where · Esc closes',
      }

      return statusOfScope[palette.textScope]()
    },
    goToLine: () => {
      const typedLine = lineNumberTypedIn(palette.query, model.lineCount)
      if (palette.query.trim() === '' || typedLine !== null) {
        return `${typedLine === null ? 'A line' : `Line ${typedLine}`} of ${model.lineCount} · Enter goes there · Esc closes`
      }

      return `Not a line of this file: type a number from 1 to ${model.lineCount}`
    },
  }
  const status = statusOfMode[palette.mode]()

  return (
    <Box
      key="palette-box"
      position="absolute"
      top={model.geometry.paletteTop}
      left={model.geometry.paletteLeft}
      width={model.geometry.paletteWidth}
      {...(model.geometry.paletteHeight === null ? {} : { height: model.geometry.paletteHeight })}
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.accentBorder}
      backgroundColor={theme.paletteBackground}
      paddingX={1}
    >
      <Box key="palette-field-row" flexDirection="row" flexShrink={0}>
        <Box key="palette-field-column" flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
          <Box key="palette-previous-box" display="none">
            <Button key={PALETTE_PREVIOUS_KEY} plain label="previous row" onPress={() => undefined} />
          </Box>
          <Input
            key={paletteFieldKey(palette.fieldNumber)}
            label={PALETTE_FIELD_LABELS[palette.mode]}
            placeholder={PALETTE_PLACEHOLDERS[palette.mode]}
            value={palette.initialQuery}
            submitLabel={PALETTE_SUBMIT_LABELS[palette.mode]}
            autoFocus
            onInput={value => input.actions.updatePaletteQuery(value)}
            onSubmit={value => input.actions.submitPalette(value)}
          />
          <Box key="palette-next-box" display="none">
            <Button key={PALETTE_NEXT_KEY} plain label="next row" onPress={() => undefined} />
          </Box>
        </Box>
        <Button key={PALETTE_CLOSE_KEY} plain dimColor label="×" onPress={() => input.actions.closePalette()} />
      </Box>
      {palette.mode === 'textSearch' && renderTextScopes(ui, input, palette.textScope)}
      <Box key="palette-items" flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden">
        {shownItems.map((item, shownIndex) => {
          const itemIndex = model.firstShownPaletteItemIndex + shownIndex

          return renderPaletteItem(ui, input, item, itemIndex, itemIndex === palette.selectedIndex, innerColumns)
        })}
      </Box>
      <Text color={theme.muted}>{truncatedEnd(status, innerColumns)}</Text>
    </Box>
  )
}

// The note about a name, in a frame over the code right under the name clicked.
function renderInlineNote(ui: ViewElements, input: PaneInput) {
  const { Box, Button, Text } = ui
  const noteBox = input.model.inlineNoteBox
  if (noteBox === null) {
    return null
  }

  return (
    <Box
      key="inline-note"
      position="absolute"
      top={noteBox.top}
      left={noteBox.left}
      width={noteBox.width}
      height={3}
      borderStyle="round"
      borderColor={ui.theme.notice}
      backgroundColor={ui.theme.paletteBackground}
      paddingX={1}
      flexDirection="row"
    >
      <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
        <Text color={ui.theme.notice}>{truncatedEnd(noteBox.text, noteBox.width - 6)}</Text>
      </Box>
      <Text> </Text>
      {isPaneClickable(input) && <Button key="dismiss-inline-note" plain label="×" onPress={() => input.actions.dismissInlineNote()} />}
    </Box>
  )
}

const TAB_NUMBER_KEY_COUNT = 9

// The keys 1 to 9 show the tab of that number, wherever the tabs are drawn.
function renderTabNumberKeys(ui: ViewElements, input: PaneInput) {
  const { Box, Button } = ui

  return (
    <Box key="tab-number-keys" display="none">
      {Array.from({ length: Math.min(TAB_NUMBER_KEY_COUNT, input.model.tabCount) }, (_, tabIndex) => (
        <Button key={`tab-number-${tabIndex + 1}`} plain hotkey={String(tabIndex + 1)} label={`tab ${tabIndex + 1}`} onPress={() => input.actions.activateTab(tabIndex)} />
      ))}
    </Box>
  )
}

function renderFileBadge(ui: ViewElements, path: string) {
  const { Text } = ui
  const badge = fileBadgeOf(path)

  return (
    <Text color={badge.color} bold>
      {badge.label.padEnd(BADGE_COLUMNS)}
    </Text>
  )
}

function renderSidebarTitle(ui: ViewElements, title: string, detail: string, columns: number) {
  const { Box, Text } = ui

  return (
    <Box key={`sidebar-title-${title}`} flexDirection="row" height={1} flexShrink={0} paddingX={1}>
      <Text color={ui.theme.accent} bold>
        {title}
      </Text>
      <Text color={ui.theme.muted}>{truncatedStart(detail === '' ? '' : ` ${detail}`, Math.max(0, columns - title.length - 2))}</Text>
    </Box>
  )
}

function renderSidebarTabs(ui: ViewElements, input: PaneInput, sidebar: Sidebar, width: number) {
  const { Box, Button, Text } = ui
  const { theme } = ui
  const nameColumns = Math.max(1, width - 7 - BADGE_COLUMNS)
  const directoryColumns = Math.max(1, width - 5)

  return (
    <Box key="sidebar-tabs" flexDirection="column" height={sidebar.tabListRows} flexShrink={0} overflow="hidden">
      {sidebar.tabCount === 0 && <Text color={theme.muted}>   No file open</Text>}
      {sidebar.shownTabs.map(tab => (
        <Box
          key={`sidebar-tab-${tab.index}`}
          flexDirection="column"
          height={SIDEBAR_ROWS_PER_TAB}
          flexShrink={0}
          backgroundColor={tab.isActive ? theme.selectedBackground : undefined}
        >
          <Box flexDirection="row" height={1}>
            <Text color={theme.accent}>{tab.isActive ? '▌' : ' '}</Text>
            <Text color={theme.lineNumber}>{tab.index < TAB_NUMBER_KEY_COUNT ? `${tab.index + 1} ` : '  '}</Text>
            {renderFileBadge(ui, tab.path)}
            <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
              <Button key={`${TAB_BUTTON_KEY_PREFIX}${tab.index}`} plain label={tabButtonLabelOf(tab.fileName, tab.isActive)} onPress={() => input.actions.activateTab(tab.index)}>
                <Text color={tab.isActive ? theme.heading : theme.text} bold={tab.isActive}>
                  {truncatedEnd(tab.fileName, nameColumns)}
                </Text>
              </Button>
            </Box>
            <Button key={`${CLOSE_TAB_BUTTON_KEY_PREFIX}${tab.index}`} plain dimColor label="×" onPress={() => input.actions.closeTab(tab.index)} />
            <Text> </Text>
          </Box>
          <Box flexDirection="row" height={1}>
            <Text color={theme.accent}>{tab.isActive ? '▌' : ' '}</Text>
            <Text color={theme.muted}>{`   ${' '.repeat(BADGE_COLUMNS)}${truncatedStart(tab.directory === '' ? '.' : tab.directory, directoryColumns - BADGE_COLUMNS)}`}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  )
}

const COLLAPSE_TREE_LABEL = '⊟ fold all'

// One column per level: the side column is narrow, and a project's files sit eight or ten directories deep.
const TREE_INDENT = ' '

const FILE_MARK = '• '

// A directory is drawn in its own color with a slash after its name, its folding arrow before; a file has a dot in
// the color of its kind of file in the same place.
function renderFileTree(ui: ViewElements, input: PaneInput, tree: FileTreeView, columns: number) {
  const { Box, Button, Text } = ui
  const { theme } = ui

  return (
    <Box key="file-tree" flexDirection="column" height={tree.visibleRows} flexShrink={0} overflow="hidden">
      {tree.rowCount === 0 && <Text color={theme.muted}>   Listing the project…</Text>}
      {tree.shownRows.map(row => {
        const indent = TREE_INDENT.repeat(row.depth)
        const mark = row.isDirectory ? (row.isExpanded ? '▾ ' : '▸ ') : FILE_MARK
        const markColor = row.isDirectory ? theme.directory : fileBadgeOf(row.path).color
        const name = row.isDirectory ? `${row.name}/` : row.name
        const nameColor = row.isShown ? theme.accent : row.isIgnored ? theme.muted : row.isDirectory ? theme.directory : theme.text

        return (
          <Box key={`tree-box-${row.path}`} flexDirection="row" height={1} flexShrink={0} backgroundColor={row.isShown ? theme.selectedBackground : undefined}>
            <Button key={`${TREE_ROW_KEY_PREFIX}${row.path}`} plain onPress={() => input.actions.openTreeRow(row.path, row.isDirectory)}>
              <Text>{indent}</Text>
              <Text color={markColor} dimColor={row.isIgnored}>
                {mark}
              </Text>
              <Text color={nameColor} bold={row.isShown || (row.isDirectory && !row.isIgnored)}>
                {truncatedEnd(name, Math.max(1, columns - indent.length - mark.length))}
              </Text>
            </Button>
          </Box>
        )
      })}
    </Box>
  )
}

// The header's button that opens the files, with the margin before it.
const FILES_TOGGLE_COLUMNS = 11
const TABS_TOGGLE_COLUMNS = 10

const PIN_LABELS: Record<ColumnMode, string> = { drawer: 'pin', pinned: 'unpin' }

// The title of the files: where the rows in sight stand, then pinning, folding everything and, in the drawer, closing.
function renderFileTreeTitle(ui: ViewElements, input: PaneInput, tree: FileTreeView, width: number) {
  const { Box, Button, Text } = ui
  const { explorerMode } = input.model
  const lastShownRow = Math.min(tree.rowCount, tree.firstRowIndex + tree.visibleRows)
  const position = tree.rowCount > tree.visibleRows ? `${tree.firstRowIndex + 1}-${lastShownRow}/${tree.rowCount}` : ''
  const isDrawer = explorerMode === 'drawer'
  const buttonsColumns = PIN_LABELS[explorerMode].length + 2 + COLLAPSE_TREE_LABEL.length + 1 + (isDrawer ? 2 : 0)

  return (
    <Box key="files-title" flexDirection="row" height={1} flexShrink={0}>
      <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
        {renderSidebarTitle(ui, 'FILES', position, width - buttonsColumns)}
      </Box>
      <Button key="pin-files" plain dimColor label={PIN_LABELS[explorerMode]} onPress={() => input.actions.pinFiles(isDrawer)} />
      <Text>  </Text>
      <Button key="collapse-tree" plain dimColor label={COLLAPSE_TREE_LABEL} onPress={() => input.actions.collapseTree()} />
      {isDrawer && <Text> </Text>}
      {isDrawer && <Button key="close-files" plain label="×" onPress={() => input.actions.toggleFilesDrawer()} />}
      <Text> </Text>
    </Box>
  )
}

// The title of the tabs: how many are open, then pinning and, in the drawer, closing.
function renderTabsTitle(ui: ViewElements, input: PaneInput, sidebar: Sidebar, width: number) {
  const { Box, Button, Text } = ui
  const { tabsMode } = input.model
  const isDrawer = tabsMode === 'drawer'
  const buttonsColumns = PIN_LABELS[tabsMode].length + 1 + (isDrawer ? 2 : 0)

  return (
    <Box key="tabs-title" flexDirection="row" height={1} flexShrink={0}>
      <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
        {renderSidebarTitle(ui, 'TABS', sidebar.tabCount === 0 ? '' : String(sidebar.tabCount), width - buttonsColumns)}
      </Box>
      <Button key="pin-tabs" plain dimColor label={PIN_LABELS[tabsMode]} onPress={() => input.actions.pinTabs(isDrawer)} />
      {isDrawer && <Text> </Text>}
      {isDrawer && <Button key="close-tabs" plain label="×" onPress={() => input.actions.toggleTabsDrawer()} />}
      <Text> </Text>
    </Box>
  )
}

// What the tabs' keys close, within a click: relative to the tab shown.
function renderTabsActions(ui: ViewElements, input: PaneInput, sidebar: Sidebar) {
  const { Box, Button, Text } = ui
  if (sidebar.tabCount === 0) {
    return null
  }
  const closings: Array<{ action: ShortcutAction; label: string }> = [
    { action: 'closeTabsOnTheLeft', label: 'above' },
    { action: 'closeTabsOnTheRight', label: 'below' },
    { action: 'closeOtherTabs', label: 'others' },
    { action: 'closeAllTabs', label: 'all' },
  ]

  return (
    <Box key="tabs-actions" flexDirection="row" height={1} flexShrink={0} paddingX={1} overflow="hidden">
      <Text color={ui.theme.muted}>close </Text>
      {closings.map(({ action, label }, closingIndex) => (
        <Box key={`tabs-action-box-${action}`} flexDirection="row" flexShrink={0}>
          {closingIndex > 0 && <Text color={ui.theme.border}> · </Text>}
          <Button key={`tabs-action-${action}`} plain dimColor label={label} onPress={() => input.actions.runShortcut(action)} />
        </Box>
      ))}
    </Box>
  )
}

// The column of tabs pinned left of the code.
function renderSidebar(ui: ViewElements, input: PaneInput, sidebar: Sidebar) {
  const { Box } = ui
  const width = input.model.geometry.sidebarWidth

  return (
    <Box key="sidebar" flexDirection="column" width={width} flexShrink={0} height={sidebar.rows} overflow="hidden" backgroundColor={ui.theme.headerBackground}>
      {renderTabsTitle(ui, input, sidebar, width)}
      {renderTabsActions(ui, input, sidebar)}
      {renderSidebarTabs(ui, input, sidebar, width)}
    </Box>
  )
}

// The tabs sliding over the left of the code, as far as their drawer is open.
function renderTabsDrawer(ui: ViewElements, input: PaneInput, sidebar: Sidebar) {
  const { Box, Text } = ui
  const { geometry } = input.model
  const contentWidth = Math.max(1, geometry.tabsDrawerWidth - 1)

  return (
    <Box key="tabs-drawer" position="absolute" top={0} left={0} width={geometry.tabsDrawerWidth} height={geometry.middleRows} flexDirection="row" backgroundColor={ui.theme.paletteBackground}>
      <Box flexDirection="column" width={contentWidth} flexShrink={0} overflow="hidden">
        {renderTabsTitle(ui, input, sidebar, contentWidth)}
        {renderTabsActions(ui, input, sidebar)}
        {renderSidebarTabs(ui, input, sidebar, contentWidth)}
      </Box>
      <Box flexDirection="column" width={1} flexShrink={0}>
        {Array.from({ length: geometry.middleRows }, () => (
          <Text color={ui.theme.accentBorder}>▕</Text>
        ))}
      </Box>
    </Box>
  )
}

export function filesFilterFieldKey(fieldNumber: number): string {
  return `${FILES_FILTER_FIELD_KEY_PREFIX}${fieldNumber}`
}

// The field that searches the files by a few letters of their path. The arrows leave it for the hidden buttons
// around it, which the pane turns into moving the selected file.
function renderFilesFilterField(ui: ViewElements, input: PaneInput, filter: FilesFilterView) {
  const { Box, Button, Input } = ui

  return (
    <Box key="files-filter-box" flexDirection="column" height={1} flexShrink={0} paddingX={1}>
      <Box key="files-filter-previous-box" display="none">
        <Button key={FILES_FILTER_PREVIOUS_KEY} plain label="previous file" onPress={() => undefined} />
      </Box>
      <Input
        key={filesFilterFieldKey(filter.fieldNumber)}
        label="⌕"
        placeholder="find a file by its path"
        value={filter.initialQuery}
        submitLabel="open"
        onInput={value => input.actions.updateFilesFilter(value)}
        onSubmit={value => input.actions.submitFilesFilter(value)}
      />
      <Box key="files-filter-next-box" display="none">
        <Button key={FILES_FILTER_NEXT_KEY} plain label="next file" onPress={() => undefined} />
      </Box>
    </Box>
  )
}

// The files found, each by its name with the letters typed lit, its directory dim after it.
function renderFilesFilterResults(ui: ViewElements, input: PaneInput, filter: FilesFilterView, rows: number, columns: number) {
  const { Box, Button, Text } = ui
  const { theme } = ui

  return (
    <Box key="files-filter-results" flexDirection="column" height={rows} flexShrink={0} overflow="hidden">
      {filter.itemCount === 0 && <Text color={theme.muted}>   No file matches</Text>}
      {filter.shownItems.map((item, shownIndex) => {
        const itemIndex = filter.firstShownIndex + shownIndex
        const isSelected = itemIndex === filter.selectedIndex
        const label = truncatedEnd(item.label, Math.max(4, columns - 4))
        const detail = truncatedStart(item.detail, Math.max(0, columns - 4 - label.length - 1))

        return (
          <Box key={`files-filter-item-box-${itemIndex}`} flexDirection="row" height={1} flexShrink={0} backgroundColor={isSelected ? theme.selectedBackground : undefined}>
            <Button key={`${FILES_FILTER_ITEM_KEY_PREFIX}${itemIndex}`} plain onPress={() => input.actions.openFilesFilterItem(itemIndex)}>
              <Text color={isSelected ? theme.accent : theme.muted}>{isSelected ? '▸' : ' '}</Text>
              <Text color={fileBadgeOf(item.path).color}>{FILE_MARK}</Text>
              {matchedLabelPieces(label, item.matchedIndexes).map(piece => (
                <Text color={piece.isMatched ? theme.accent : theme.text} bold={piece.isMatched}>
                  {piece.text}
                </Text>
              ))}
              <Text color={theme.muted}>{detail === '' ? '' : ` ${detail}`}</Text>
            </Button>
          </Box>
        )
      })}
    </Box>
  )
}

// Under the title of the files, their search, then what it found or the tree.
function renderFilesBody(ui: ViewElements, input: PaneInput, tree: FileTreeView, columns: number) {
  const filter = input.model.filesFilter
  if (filter === null) {
    return renderFileTree(ui, input, tree, columns)
  }

  return [
    renderFilesFilterField(ui, input, filter),
    filter.isSearching ? renderFilesFilterResults(ui, input, filter, tree.visibleRows, columns) : renderFileTree(ui, input, tree, columns),
  ]
}

// The files pinned in a column right of the code.
function renderExplorer(ui: ViewElements, input: PaneInput, tree: FileTreeView) {
  const { Box } = ui
  const { geometry } = input.model

  return (
    <Box key="explorer" flexDirection="column" width={geometry.explorerWidth} flexShrink={0} height={geometry.middleRows} overflow="hidden" backgroundColor={ui.theme.headerBackground}>
      {renderFileTreeTitle(ui, input, tree, geometry.explorerWidth)}
      {renderFilesBody(ui, input, tree, geometry.explorerWidth - 1)}
    </Box>
  )
}

// The files sliding over the right of the code, as far as the drawer is open.
function renderExplorerDrawer(ui: ViewElements, input: PaneInput, tree: FileTreeView) {
  const { Box, Text } = ui
  const { geometry } = input.model
  const contentWidth = Math.max(1, geometry.drawerWidth - 1)

  return (
    <Box key="explorer-drawer" position="absolute" top={0} left={geometry.drawerLeft} width={geometry.drawerWidth} height={geometry.middleRows} flexDirection="row" backgroundColor={ui.theme.paletteBackground}>
      <Box flexDirection="column" width={1} flexShrink={0}>
        {Array.from({ length: geometry.middleRows }, () => (
          <Text color={ui.theme.accentBorder}>▏</Text>
        ))}
      </Box>
      <Box flexDirection="column" width={contentWidth} flexShrink={0} overflow="hidden">
        {renderFileTreeTitle(ui, input, tree, contentWidth)}
        {renderFilesBody(ui, input, tree, contentWidth - 1)}
      </Box>
    </Box>
  )
}

export function renderPane(ui: ViewElements, input: PaneInput) {
  const { Box, Client } = ui
  const { model } = input
  const { geometry, sidebar } = model
  const shownActions = [...HEADER_ACTIONS, ...FOOTER_ACTIONS, ...(model.resultsPanel === null || !isPaneClickable(input) ? [] : RESULTS_ACTIONS)]

  return (
    <Box flexDirection="column" backgroundColor={ui.theme.paneBackground} height={geometry.bodyRows} overflow="hidden">
      {renderHeader(ui, input)}
      {renderMenuBar(ui, input)}
      {renderNotice(ui, input)}
      <Box key="middle" flexDirection="row" height={geometry.middleRows} flexShrink={0}>
        {geometry.sidebarWidth > 0 && sidebar !== null && renderSidebar(ui, input, sidebar)}
        {geometry.sidebarWidth > 0 && (
          <Client
            key={SIDEBAR_DIVIDER_KEY}
            module="./divider.tsx"
            props={{ rows: geometry.middleRows, color: ui.theme.border, draggingColor: ui.theme.accent }}
            width={1}
            height={geometry.middleRows}
          />
        )}
        <Box key="code-area" flexDirection="column" width={geometry.codeAreaColumns} flexShrink={0} height={geometry.middleRows} overflow="hidden">
          {renderTabStrip(ui, input)}
          {model.isHelpShown ? renderHelp(ui, input) : renderCode(ui, input)}
          {model.peek !== null && renderPeek(ui, input, model.peek)}
          {renderResults(ui, input)}
          {renderInlineNote(ui, input)}
        </Box>
        {geometry.explorerWidth > 0 && (
          <Client
            key={EXPLORER_DIVIDER_KEY}
            module="./divider.tsx"
            props={{ rows: geometry.middleRows, color: ui.theme.border, draggingColor: ui.theme.accent }}
            width={1}
            height={geometry.middleRows}
          />
        )}
        {geometry.explorerWidth > 0 && model.explorerTree !== null && renderExplorer(ui, input, model.explorerTree)}
        {geometry.drawerWidth > 0 && model.explorerTree !== null && renderExplorerDrawer(ui, input, model.explorerTree)}
        {geometry.tabsDrawerWidth > 0 && sidebar !== null && renderTabsDrawer(ui, input, sidebar)}
      </Box>
      {renderFooter(ui, input)}
      {renderHiddenShortcuts(ui, input, shownActions)}
      {renderTabNumberKeys(ui, input)}
      {renderPalette(ui, input)}
    </Box>
  )
}
