import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptDecoration, Register } from 'claude-code'

import type {
  Bookmark,
  BreadcrumbStep,
  CodePosition,
  KeyboardLayout,
  MarkedSymbol,
  NavigationTarget,
  PaletteItem,
  PaletteItemKind,
  PaletteMode,
  ResultRow,
  ResultsPanel,
  SelectedPlace,
  SymbolEntry,
  TextSearchScope,
  ColumnMode,
  TabsState,
  ViewedPlace,
} from '../types'
import { analysedLanguageOfPath, findImplementations, findParents, findUsages, resolveDefinition } from './analysis'
import type { AnalysedLanguage } from './analysis'
import {
  COMMAND_NAME,
  CONFIGURED_THEME_KEY,
  CURRENT_FILE_POLL_MS,
  SELECTION_POLL_MS,
  INDEX_MAX_AGE_MS,
  INLINE_NOTE_DURATION_MS,
  INDEX_REFRESH_DELAY_MS,
  LARGEST_COLORED_FILE_CHARACTERS,
  JUMP_LINE_SHARE_FROM_TOP,
  KEY_SCROLL_LINES,
  KEYBOARD_LAYOUT_TIMEOUT_MS,
  MIN_PANE_COLUMNS,
  NOTICE_DURATION_MS,
  OPEN_TABS_STORE_KEY_PREFIX,
  BOOKMARKS_STORE_KEY_PREFIX,
  OUTLINE_ITEM_LIMIT,
  PALETTE_ITEM_LIMIT,
  PALETTE_NEXT_KEY,
  PALETTE_PREVIOUS_KEY,
  PANE_ID,
  PANE_SHARE_OF_TERMINAL,
  PEEK_FILE_CACHE_SIZE,
  RESULT_ROW_KEY_PREFIX,
  PANE_TITLE,
  RECENT_PATH_LIMIT,
  RECENT_PATHS_STORE_KEY_PREFIX,
  SHOW_TOOL_FULL_NAME,
  DRAWER_ANIMATION_STEPS,
  DRAWER_FRAME_MS,
  EXPLORER_DEFAULT_WIDTH,
  EXPLORER_DIVIDER_KEY,
  EXPLORER_MODE_STORE_KEY,
  FILES_FILTER_ITEM_LIMIT,
  FILES_FILTER_NEXT_KEY,
  FILES_FILTER_PREVIOUS_KEY,
  EXPLORER_WIDTH_STORE_KEY,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_DIVIDER_KEY,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_WIDTH_STORE_KEY,
  TABS_MODE_STORE_KEY,
  SHOW_TOOL_NAME,
  TEXT_SEARCH_MATCH_LIMIT,
  WHEEL_TICK_LINES,
} from './constants'
import { buildProjectIndex, createEngineWorkspace } from './engine-workspace'
import type { EngineWorkspace } from './engine-workspace'
import { ancestorDirectoriesOf, directoriesToList, projectMembershipOf, sortedEntries, treeOffsetShowing, treeRowsOf } from './file-tree'
import type { DirectoryEntry, ProjectMembership, TreeRow } from './file-tree'
import { KEYBOARD_LAYOUT_SOURCES, keyboardLayoutOf } from './keyboard'
import { keymapOf } from './keymap'
import type { ShortcutAction } from './keymap'
import { EMPTY_HISTORY, historyAfterJump, historyAfterStep } from './navigation-history'
import { activeTabOf, NO_TABS, restoredTabsOf, savedTabsOf, tabsAfterActivating, tabsAfterClosing, tabsAfterOpening } from './tabs'
import type { TabClosing, TabView } from './tabs'
import { preparePaletteSource, searchPalette } from './palette-search'
import type { PaletteSource } from './palette-search'
import { phpSymbolsOfFile } from './php/analysis'
import { pathFromRoot, writtenPlaceOf, writtenSymbolOf } from './place-request'
import { scriptSymbolsOfFile } from './script/analysis'
import { firstMatchIndexFrom, isCaseSensitiveText, textMatchesInLines } from './text-search'
import { genericSymbolsOfFile } from './outline/generic-outline'
import { escapedForRegularExpression, isClassLikeKind, labelOfSymbol, wholeNamePattern } from './symbol-names'
import { tokenizeSource } from './syntax/tokenize'
import { wordAt } from './text-analysis'
import { drawnWidthOf } from './display-row'
import type { CutSide } from './display-row'
import { baseNameOf } from './paths'
import { lineRangeOf, linesWordOf, selectedLinesIn } from './selected-lines'
import { buildPaneModel, clampedTopLine, columnWidthsOf, firstShownIndexKeeping, SIDEWAYS_SCROLL_MARGIN_COLUMNS } from './view/model'
import type { PaneSnapshot, PeekSnapshot, ShownFile } from './view/model'
import { filesFilterFieldKey, paletteFieldKey, renderNarrowPane, renderPane } from './view/pane'
import { themeOf } from './view/theme'
import type { PaneActions, ViewElements } from './view/types'

const projectRootAtom = atom({ plugin: 'code-nav', key: 'projectRoot' } as const, null)
const currentPathAtom = atom({ plugin: 'code-nav', key: 'currentPath' } as const, null)
const topLineAtom = atom({ plugin: 'code-nav', key: 'topLine' } as const, 1)
const fileRevisionAtom = atom({ plugin: 'code-nav', key: 'fileRevision' } as const, 0)
const markedSymbolAtom = atom({ plugin: 'code-nav', key: 'markedSymbol' } as const, null)
const historyAtom = atom({ plugin: 'code-nav', key: 'history' } as const, EMPTY_HISTORY)
const tabsAtom = atom({ plugin: 'code-nav', key: 'tabs' } as const, NO_TABS)
const tabsModeAtom = atom({ plugin: 'code-nav', key: 'tabsMode' } as const, 'pinned')
const tabsDrawerOpennessAtom = atom({ plugin: 'code-nav', key: 'tabsDrawerOpenness' } as const, 0)
const explorerModeAtom = atom({ plugin: 'code-nav', key: 'explorerMode' } as const, 'drawer')
const drawerOpennessAtom = atom({ plugin: 'code-nav', key: 'drawerOpenness' } as const, 0)
const sidebarWidthAtom = atom({ plugin: 'code-nav', key: 'sidebarWidth' } as const, SIDEBAR_DEFAULT_WIDTH)
const explorerWidthAtom = atom({ plugin: 'code-nav', key: 'explorerWidth' } as const, EXPLORER_DEFAULT_WIDTH)
const expandedDirectoriesAtom = atom({ plugin: 'code-nav', key: 'expandedDirectories' } as const, [])
const treeOffsetAtom = atom({ plugin: 'code-nav', key: 'treeOffset' } as const, 0)
const treeRevisionAtom = atom({ plugin: 'code-nav', key: 'treeRevision' } as const, 0)
const filesFilterAtom = atom({ plugin: 'code-nav', key: 'filesFilter' } as const, { query: '', initialQuery: '', fieldNumber: 0, selectedIndex: 0, items: [] })
const recentPathsAtom = atom({ plugin: 'code-nav', key: 'recentPaths' } as const, [])
const touchedPathsAtom = atom({ plugin: 'code-nav', key: 'touchedPaths' } as const, [])
const paletteAtom = atom({ plugin: 'code-nav', key: 'palette' } as const, null)
const resultsPanelAtom = atom({ plugin: 'code-nav', key: 'resultsPanel' } as const, null)
const isPeekShownAtom = atom({ plugin: 'code-nav', key: 'isPeekShown' } as const, false)
const peekRevisionAtom = atom({ plugin: 'code-nav', key: 'peekRevision' } as const, 0)
const peekScrolledLinesAtom = atom({ plugin: 'code-nav', key: 'peekScrolledLines' } as const, 0)
const noticeAtom = atom({ plugin: 'code-nav', key: 'notice' } as const, null)
const inlineNoteAtom = atom({ plugin: 'code-nav', key: 'inlineNote' } as const, null)
const selectedLinesAtom = atom({ plugin: 'code-nav', key: 'selectedLines' } as const, null)
const scrolledColumnsAtom = atom({ plugin: 'code-nav', key: 'scrolledColumns' } as const, 0)
const bookmarksAtom = atom({ plugin: 'code-nav', key: 'bookmarks' } as const, [])
const isHelpShownAtom = atom({ plugin: 'code-nav', key: 'isHelpShown' } as const, false)
const isIndexingAtom = atom({ plugin: 'code-nav', key: 'isIndexing' } as const, false)
const indexSummaryAtom = atom({ plugin: 'code-nav', key: 'indexSummary' } as const, null)
const keyboardLayoutAtom = atom({ plugin: 'code-nav', key: 'keyboardLayout' } as const, 'unknown')
const claudeCodeThemeAtom = atom({ plugin: 'code-nav', key: 'claudeCodeTheme' } as const, null)
const configuredThemeAtom = atom({ plugin: 'code-nav', key: 'configuredTheme' } as const, null)
const requestedPaneColumnsAtom = atom({ plugin: 'code-nav', key: 'requestedPaneColumns' } as const, 0)

// What the session keeps outside its state: the project as last listed, the file shown as last read. A reload of the
// mod starts them over, and the pane reads them again when it is next drawn or used.
let workspace: EngineWorkspace | null = null
let workspaceBeingCreated: Promise<EngineWorkspace> | null = null
let paletteSource: PaletteSource | null = null
let shownFile: ShownFile | null = null
// The files previewed from the list under the code, the most recent last, a few of them kept.
const peekedFiles = new Map<string, ShownFile>()
let isPeekLoadScheduled = false
let shownFileModifiedAt = 0
let runningIndexBuild: Promise<void> | null = null
let isIndexBuildAskedAgain = false
let latestIndexRefreshRequestNumber = 0
let latestLookupNumber = 0
let isShownFileReloadScheduled = false
let latestNoticeNumber = 0
let latestInlineNoteNumber = 0
let latestPaletteFieldNumber = 0
// The scope a text was searched in last, offered again while a file is shown.
let lastTextScope: TextSearchScope = 'file'
let paletteContext: { recentPaths: readonly string[]; currentPath: string | null } = { recentPaths: [], currentPath: null }

const lastDrawnLayout = {
  codeRows: 40,
  codeColumns: 100,
  // The columns the code was drawn scrolled by, which the lines drawn may have brought back short of what was asked.
  scrolledColumns: 0,
  resultsTop: 0,
  resultsRows: 0,
  bodyColumns: 120,
  isPaneFocused: false,
  sidebarWidth: 0,
  sidebarWidthAtDragStart: 0,
  explorerWidth: 0,
  explorerWidthAtDragStart: 0,
  // The columns of the pane the explorer's rows take, for the wheel over them.
  treeFirstColumn: 0,
  treeLastColumn: -1,
  treeRowCount: 0,
  treeVisibleRows: 20,
  peekTop: 0,
  peekScrolledLinesRange: { lowest: 0, highest: 0 },
}

// The explorer's directory listings as last read, by directory path from the root ('' for the root itself). Listed
// when first opened, and read again once Claude has changed files.
const entriesByDirectory = new Map<string, DirectoryEntry[]>()
let isTreeListingScheduled = false
// The file the explorer scrolls to once its row is drawn: the one just shown.
let pathToReveal: string | null = null
// The project's files alone, prepared for the search of the files' own field, again for each listing of the project.
let filesOnlySourceOfIndex: { builtAt: number; source: PaletteSource } | null = null
let latestFilesFilterFieldNumber = 0
let membershipOfIndex: { builtAt: number; membership: ProjectMembership } = { builtAt: -1, membership: projectMembershipOf([], false) }

// --- The project ----------------------------------------------------------------------------------------------------

async function projectRootOf($: EngineInterface): Promise<string> {
  const sessionDirectory = await $.session.cwd()
  const gitRoot = await $.process
    .run(['git', 'rev-parse', '--show-toplevel'], { cwd: sessionDirectory })
    .then(result => (result.exitCode === 0 ? result.stdout.trim() : ''))
    .catch(() => '')

  return gitRoot === '' ? sessionDirectory : gitRoot
}

async function createWorkspace($: EngineInterface): Promise<EngineWorkspace> {
  const root = await projectRootOf($)
  const createdWorkspace = createEngineWorkspace($, root)
  workspace = createdWorkspace
  await update($, projectRootAtom, () => root)
  const savedRecentPaths = await $.store.get(`${RECENT_PATHS_STORE_KEY_PREFIX}${root}`).catch(() => undefined)
  if (Array.isArray(savedRecentPaths) && (await read($, recentPathsAtom)).length === 0) {
    const recentPaths = savedRecentPaths.filter((path): path is string => typeof path === 'string')
    await update($, recentPathsAtom, () => recentPaths)
  }
  await restoreTabs($, root)
  await restoreBookmarks($, root)
  void $.clock.after(0, () => refreshIndex($, false))

  return createdWorkspace
}

async function restoreBookmarks($: EngineInterface, root: string): Promise<void> {
  const saved: unknown = await $.store.get(`${BOOKMARKS_STORE_KEY_PREFIX}${root}`).catch(() => undefined)
  const bookmarks = Array.isArray(saved) ? saved.filter(isBookmark) : []
  await update($, bookmarksAtom, () => bookmarks)
}

function isBookmark(value: unknown): value is Bookmark {
  const candidate = value as Partial<Bookmark> | null
  return typeof candidate?.path === 'string' && typeof candidate.line === 'number' && typeof candidate.preview === 'string'
}

// The tabs of the last session on this project come back, the pane showing the one that was shown, unless something
// is already shown in this one.
async function restoreTabs($: EngineInterface, root: string): Promise<void> {
  const isAnythingShown = (await read($, tabsAtom)).tabs.length > 0 || (await read($, currentPathAtom)) !== null
  if (isAnythingShown) {
    return
  }
  const restoredTabs = restoredTabsOf(await $.store.get(`${OPEN_TABS_STORE_KEY_PREFIX}${root}`).catch(() => undefined))
  const activeTab = activeTabOf(restoredTabs)
  if (activeTab === null) {
    return
  }
  await update($, tabsAtom, () => restoredTabs)
  await update($, currentPathAtom, () => activeTab.path)
  await update($, topLineAtom, () => activeTab.topLine)
}

// Two callers arriving together share one creation: a second workspace would be left with an empty index.
function ensureWorkspace($: EngineInterface): Promise<EngineWorkspace> {
  if (workspace !== null) {
    return Promise.resolve(workspace)
  }
  workspaceBeingCreated ??= createWorkspace($).finally(() => {
    workspaceBeingCreated = null
  })

  return workspaceBeingCreated
}

async function buildIndex($: EngineInterface, projectWorkspace: EngineWorkspace): Promise<void> {
  await update($, isIndexingAtom, () => true)
  try {
    const index = await buildProjectIndex($, projectWorkspace.root)
    projectWorkspace.replaceIndex(index)
    paletteSource = preparePaletteSource(index.files, index.symbols)
    await update($, indexSummaryAtom, () => index.summary)
    entriesByDirectory.clear()
    await update($, treeRevisionAtom, revision => revision + 1)
  } catch (error) {
    await showNotice($, `The project could not be listed: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await update($, isIndexingAtom, () => false)
  }
  if ((await read($, paletteAtom)) !== null) {
    await fillPalette($)
  }
}

// The declarations are listed again when the last listing is old, or at once when a change is known (isForced); a
// palette already open is filled again with them. A listing asked for while one runs is made right after it, since
// the running one may have read the files before the change.
function refreshIndex($: EngineInterface, isForced: boolean): Promise<void> {
  if (runningIndexBuild !== null) {
    isIndexBuildAskedAgain ||= isForced
    return runningIndexBuild
  }
  runningIndexBuild = (async () => {
    const projectWorkspace = await ensureWorkspace($)
    const isFresh = (await $.clock.now()) - projectWorkspace.index().builtAt < INDEX_MAX_AGE_MS
    if (isForced || !isFresh || paletteSource === null) {
      await buildIndex($, projectWorkspace)
    }
    while (isIndexBuildAskedAgain) {
      isIndexBuildAskedAgain = false
      await buildIndex($, projectWorkspace)
    }
  })().finally(() => {
    runningIndexBuild = null
  })

  return runningIndexBuild
}

// Claude's tool calls come in bursts: the declarations are listed once, shortly after the last of them.
function refreshIndexSoon($: EngineInterface): void {
  latestIndexRefreshRequestNumber += 1
  const requestNumber = latestIndexRefreshRequestNumber
  void $.clock.after(INDEX_REFRESH_DELAY_MS, async () => {
    if (requestNumber === latestIndexRefreshRequestNumber) {
      await refreshIndex($, true)
    }
  })
}

// --- The explorer ------------------------------------------------------------------------------------------------------

async function listDirectory($: EngineInterface, directory: string): Promise<void> {
  const projectWorkspace = await ensureWorkspace($)
  const absolutePath = directory === '' ? projectWorkspace.root : `${projectWorkspace.root}/${directory}`
  const entries = await $.fs.list(absolutePath).catch(() => [])
  entriesByDirectory.set(
    directory,
    sortedEntries(entries.map(entry => ({ name: entry.name, isDirectory: entry.kind === 'dir' }))),
  )
}

// A drawing may not write: the directories it found opened but not listed are listed right after it.
function scheduleTreeListing($: EngineInterface, directories: readonly string[]): void {
  if (isTreeListingScheduled || directories.length === 0) {
    return
  }
  isTreeListingScheduled = true
  void $.clock.after(0, async () => {
    try {
      for (const directory of directories) {
        await listDirectory($, directory)
      }
      await update($, treeRevisionAtom, revision => revision + 1)
    } finally {
      isTreeListingScheduled = false
    }
  })
}

function projectMembership(): ProjectMembership {
  const index = workspace?.index()
  if (index === undefined || index.builtAt === 0) {
    return projectMembershipOf([], false)
  }
  if (membershipOfIndex.builtAt !== index.builtAt) {
    membershipOfIndex = { builtAt: index.builtAt, membership: projectMembershipOf(index.files, true) }
  }

  return membershipOfIndex.membership
}

async function currentTreeRows($: EngineInterface): Promise<TreeRow[]> {
  await read($, treeRevisionAtom)
  const expandedDirectories = new Set(await read($, expandedDirectoriesAtom))
  scheduleTreeListing($, directoriesToList(entriesByDirectory, expandedDirectories))

  return treeRowsOf(entriesByDirectory, expandedDirectories, projectMembership())
}

// The file shown gets its row in the explorer: its directories open, the explorer scrolled to it once drawn.
async function revealInTree($: EngineInterface, path: string): Promise<void> {
  const ancestors = ancestorDirectoriesOf(path)
  await update($, expandedDirectoriesAtom, expanded => [...new Set([...expanded, ...ancestors])])
  pathToReveal = path
}

async function openTreeRow($: EngineInterface, path: string, isDirectory: boolean): Promise<void> {
  if (!isDirectory) {
    await showPlace($, { path, line: 1 }, true)
    await foldDrawer($, 'files')
    return
  }
  const expanded = await read($, expandedDirectoriesAtom)
  if (expanded.includes(path)) {
    await update($, expandedDirectoriesAtom, directories => directories.filter(directory => directory !== path && !directory.startsWith(`${path}/`)))
    return
  }
  if (!entriesByDirectory.has(path)) {
    await listDirectory($, path)
  }
  await update($, expandedDirectoriesAtom, directories => [...directories, path])
}

function filesOnlySource(): PaletteSource | null {
  const index = workspace?.index()
  if (index === undefined || index.builtAt === 0) {
    return null
  }
  if (filesOnlySourceOfIndex?.builtAt !== index.builtAt) {
    filesOnlySourceOfIndex = { builtAt: index.builtAt, source: preparePaletteSource(index.files, []) }
  }

  return filesOnlySourceOfIndex.source
}

// A new field for each opening of the files, empty, so the keyboard goes to a field that holds nothing typed before.
async function resetFilesFilter($: EngineInterface): Promise<number> {
  latestFilesFilterFieldNumber += 1
  const fieldNumber = latestFilesFilterFieldNumber
  await update($, filesFilterAtom, () => ({ query: '', initialQuery: '', fieldNumber, selectedIndex: 0, items: [] }))

  return fieldNumber
}

async function updateFilesFilter($: EngineInterface, query: string): Promise<void> {
  const source = filesOnlySource()
  const recentPaths = [...(await read($, recentPathsAtom)), ...(await read($, touchedPathsAtom))]
  const context = { recentPaths: [...new Set(recentPaths)], currentPath: await read($, currentPathAtom) }
  const items = query.trim() === '' || source === null ? [] : searchPalette(query, source, context, FILES_FILTER_ITEM_LIMIT)
  await update($, filesFilterAtom, filter => ({ ...filter, query, selectedIndex: 0, items }))
}

async function moveFilesFilterSelection($: EngineInterface, step: 1 | -1): Promise<void> {
  await update($, filesFilterAtom, filter => ({ ...filter, selectedIndex: Math.max(0, Math.min(filter.items.length - 1, filter.selectedIndex + step)) }))
}

async function openFilesFilterItem($: EngineInterface, itemIndex: number): Promise<void> {
  const item = (await read($, filesFilterAtom)).items[itemIndex]
  if (item === undefined) {
    return
  }
  await showPlace($, { path: item.path, line: item.line }, true)
  await resetFilesFilter($)
  await foldDrawer($, 'files')
}

async function submitFilesFilter($: EngineInterface, query: string): Promise<void> {
  if ((await read($, filesFilterAtom)).query !== query) {
    await updateFilesFilter($, query)
  }
  await openFilesFilterItem($, (await read($, filesFilterAtom)).selectedIndex)
}

async function collapseTree($: EngineInterface): Promise<void> {
  await update($, expandedDirectoriesAtom, () => [])
  await update($, treeOffsetAtom, () => 0)
}

type DrawerSide = 'tabs' | 'files'

// The engine lists the values each line reads and writes, so each drawer's values are named where they are used.
async function drawerOpennessOf($: EngineInterface, side: DrawerSide): Promise<number> {
  switch (side) {
    case 'tabs':
      return read($, tabsDrawerOpennessAtom)
    case 'files':
      return read($, drawerOpennessAtom)
    default: {
      const unhandledSide: never = side
      return unhandledSide
    }
  }
}

async function setDrawerOpenness($: EngineInterface, side: DrawerSide, openness: number): Promise<void> {
  switch (side) {
    case 'tabs':
      await update($, tabsDrawerOpennessAtom, () => openness)
      return
    case 'files':
      await update($, drawerOpennessAtom, () => openness)
      return
    default: {
      const unhandledSide: never = side
      return unhandledSide
    }
  }
}

async function columnModeOf($: EngineInterface, side: DrawerSide): Promise<ColumnMode> {
  switch (side) {
    case 'tabs':
      return read($, tabsModeAtom)
    case 'files':
      return read($, explorerModeAtom)
    default: {
      const unhandledSide: never = side
      return unhandledSide
    }
  }
}

async function setColumnMode($: EngineInterface, side: DrawerSide, columnMode: ColumnMode): Promise<void> {
  switch (side) {
    case 'tabs':
      await update($, tabsModeAtom, () => columnMode)
      return
    case 'files':
      await update($, explorerModeAtom, () => columnMode)
      return
    default: {
      const unhandledSide: never = side
      return unhandledSide
    }
  }
}
const DRAWER_MODE_STORE_KEYS: Record<DrawerSide, string> = { tabs: TABS_MODE_STORE_KEY, files: EXPLORER_MODE_STORE_KEY }
const latestDrawerSlideNumbers: Record<DrawerSide, number> = { tabs: 0, files: 0 }

// A drawer slides a few frames rather than appear at once, so the eye follows where it comes from.
function slideDrawer($: EngineInterface, side: DrawerSide, isOpening: boolean): void {
  latestDrawerSlideNumbers[side] += 1
  const slideNumber = latestDrawerSlideNumbers[side]
  const steps = isOpening ? DRAWER_ANIMATION_STEPS : [...[...DRAWER_ANIMATION_STEPS].reverse().slice(1), 0]
  steps.forEach((openness, stepIndex) => {
    void $.clock.after(stepIndex * DRAWER_FRAME_MS, async () => {
      if (slideNumber === latestDrawerSlideNumbers[side]) {
        await setDrawerOpenness($, side, openness)
      }
    })
  })
}

async function isDrawerOpen($: EngineInterface, side: DrawerSide): Promise<boolean> {
  return (await columnModeOf($, side)) === 'drawer' && (await drawerOpennessOf($, side)) > 0
}

// The field of the files goes with them: a text left in it would stay in the way of Escape, unseen.
async function slideDrawerClosed($: EngineInterface, side: DrawerSide): Promise<void> {
  slideDrawer($, side, false)
  if (side === 'files') {
    await resetFilesFilter($)
  }
}

async function foldDrawer($: EngineInterface, side: DrawerSide): Promise<void> {
  if (await isDrawerOpen($, side)) {
    await slideDrawerClosed($, side)
  }
}

async function pinColumn($: EngineInterface, side: DrawerSide, isPinned: boolean): Promise<void> {
  const columnMode: ColumnMode = isPinned ? 'pinned' : 'drawer'
  latestDrawerSlideNumbers[side] += 1
  await setDrawerOpenness($, side, 0)
  await setColumnMode($, side, columnMode)
  await $.store.set(DRAWER_MODE_STORE_KEYS[side], columnMode).catch(() => undefined)
  const currentPath = await read($, currentPathAtom)
  if (side === 'files' && isPinned && currentPath !== null) {
    await revealInTree($, currentPath)
  }
}

// A drawer opens or folds; pinned, its key folds the column back into a drawer. Opening the files shows the file
// read among them.
async function toggleDrawer($: EngineInterface, side: DrawerSide): Promise<void> {
  if ((await columnModeOf($, side)) === 'pinned') {
    await pinColumn($, side, false)
    return
  }
  if (await isDrawerOpen($, side)) {
    await slideDrawerClosed($, side)
    return
  }
  const currentPath = await read($, currentPathAtom)
  if (side === 'files' && currentPath !== null) {
    await revealInTree($, currentPath)
  }
  slideDrawer($, side, true)
  if (side === 'files') {
    const fieldNumber = await resetFilesFilter($)
    // The field is drawn once the drawer has started to slide.
    void $.clock.after(DRAWER_FRAME_MS, async () => {
      await $.ui.focus({ requestId: PANE_ID, key: filesFilterFieldKey(fieldNumber) }).catch(() => undefined)
    })
  }
}

// --- Notices ----------------------------------------------------------------------------------------------------------

async function showNotice($: EngineInterface, text: string): Promise<void> {
  latestNoticeNumber += 1
  const noticeNumber = latestNoticeNumber
  await update($, noticeAtom, () => text)
  void $.clock.after(NOTICE_DURATION_MS, async () => {
    if (noticeNumber === latestNoticeNumber) {
      await update($, noticeAtom, () => null)
    }
  })
}

// A message about the name clicked is drawn under that name, where the eyes are, and goes after a while or at the
// next move.
async function showNoteAt($: EngineInterface, position: CodePosition, text: string): Promise<void> {
  latestInlineNoteNumber += 1
  const noteNumber = latestInlineNoteNumber
  await update($, inlineNoteAtom, () => ({ ...position, text }))
  void $.clock.after(INLINE_NOTE_DURATION_MS, async () => {
    if (noteNumber === latestInlineNoteNumber) {
      await update($, inlineNoteAtom, () => null)
    }
  })
}

async function clearInlineNote($: EngineInterface): Promise<void> {
  if ((await read($, inlineNoteAtom)) !== null) {
    latestInlineNoteNumber += 1
    await update($, inlineNoteAtom, () => null)
  }
}

async function clearNotice($: EngineInterface): Promise<void> {
  latestNoticeNumber += 1
  await update($, noticeAtom, () => null)
}

// --- The file shown ---------------------------------------------------------------------------------------------------

function absolutePathOf(root: string, path: string): string {
  return path.startsWith('/') ? path : `${root}/${path}`
}

async function readShownFile($: EngineInterface, path: string): Promise<boolean> {
  const projectWorkspace = await ensureWorkspace($)
  projectWorkspace.forgetFileText(path)
  const text = await projectWorkspace.readFile(path)
  if (text === null) {
    await showNotice($, `${path} could not be read.`)
    return false
  }
  if (text.includes('\u0000')) {
    await showNotice($, `${path} is not a text file.`)
    return false
  }
  // A file of several megabytes (a dump, a generated bundle) is shown as plain text: coloring it would hold the
  // session for a noticeable time and keep millions of pieces in memory.
  shownFile = shownFileOf(path, text)
  peekedFiles.delete(path)
  shownFileModifiedAt = await $.fs
    .stat(absolutePathOf(projectWorkspace.root, path))
    .then(stat => stat.mtimeMs)
    .catch(() => 0)
  await update($, fileRevisionAtom, revision => revision + 1)

  return true
}

function shownFileOf(path: string, text: string): ShownFile {
  const lines = text.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop()
  }
  const tokensByLine = text.length > LARGEST_COLORED_FILE_CHARACTERS ? [] : tokenizeSource(path, text)

  return { path, lines, tokensByLine }
}

async function loadPeekedFile($: EngineInterface, path: string): Promise<void> {
  if (shownFile?.path === path || peekedFiles.has(path)) {
    return
  }
  const text = await (await ensureWorkspace($)).readFile(path)
  if (text === null || text.includes('\u0000')) {
    return
  }
  peekedFiles.set(path, shownFileOf(path, text))
  for (const oldestPath of [...peekedFiles.keys()].slice(0, Math.max(0, peekedFiles.size - PEEK_FILE_CACHE_SIZE))) {
    peekedFiles.delete(oldestPath)
  }
  await update($, peekRevisionAtom, revision => revision + 1)
}

async function reloadShownFileWhenChanged($: EngineInterface): Promise<void> {
  const currentPath = await read($, currentPathAtom)
  if (currentPath === null || workspace === null || !(await isPaneOpen($))) {
    return
  }
  if (shownFile === null || shownFile.path !== currentPath) {
    // The state outlives a reload of the mod: the file it names may be gone since, with a change of branch say.
    if (!(await readShownFile($, currentPath))) {
      const tabs = await read($, tabsAtom)
      const tabIndex = tabs.tabs.findIndex(tab => tab.path === currentPath)
      await showActiveTab($, tabIndex === -1 ? { ...tabs, activeIndex: null } : tabsAfterClosing(tabs, 'active', null, tabIndex))
    }
    return
  }
  const modifiedAt = await $.fs
    .stat(absolutePathOf(workspace.root, currentPath))
    .then(stat => stat.mtimeMs)
    .catch(() => shownFileModifiedAt)
  if (modifiedAt !== shownFileModifiedAt) {
    await readShownFile($, currentPath)
  }
}

// --- Bookmarks ---------------------------------------------------------------------------------------------------------

async function saveBookmarks($: EngineInterface, bookmarks: Bookmark[]): Promise<void> {
  await update($, bookmarksAtom, () => bookmarks)
  const root = await read($, projectRootAtom)
  if (root !== null) {
    await $.store.set(`${BOOKMARKS_STORE_KEY_PREFIX}${root}`, bookmarks).catch(() => undefined)
  }
  if ((await read($, resultsPanelAtom))?.kind === 'bookmarks') {
    if (bookmarks.length === 0) {
      await update($, resultsPanelAtom, () => null)
      await update($, isPeekShownAtom, () => false)
    } else {
      await listBookmarks($)
    }
  }
}

// A click on a line's number marks it to come back to, a second click takes the mark off.
async function toggleBookmark($: EngineInterface, line: number): Promise<void> {
  const file = shownFile
  if (file === null) {
    return
  }
  const bookmarks = await read($, bookmarksAtom)
  const isBookmarked = bookmarks.some(bookmark => bookmark.path === file.path && bookmark.line === line)
  await saveBookmarks(
    $,
    isBookmarked
      ? bookmarks.filter(bookmark => bookmark.path !== file.path || bookmark.line !== line)
      : [...bookmarks, { path: file.path, line, preview: (file.lines[line - 1] ?? '').trim() }],
  )
}

async function removeBookmarkOfRow($: EngineInterface, rowIndex: number): Promise<void> {
  const resultsPanel = await read($, resultsPanelAtom)
  const row = resultsPanel?.kind === 'bookmarks' ? resultsPanel.rows[rowIndex] : undefined
  if (row === undefined) {
    return
  }
  const bookmarks = await read($, bookmarksAtom)
  await saveBookmarks($, bookmarks.filter(bookmark => bookmark.path !== row.path || bookmark.line !== row.line))
}

async function listBookmarks($: EngineInterface): Promise<void> {
  const bookmarks = await read($, bookmarksAtom)
  if (bookmarks.length === 0) {
    await showNotice($, 'No bookmark yet: click the number of a line to mark it.')
    return
  }
  const currentResults = await read($, resultsPanelAtom)
  await openResultsPanel($, {
    kind: 'bookmarks',
    title: 'click a line number to add or remove one',
    rows: bookmarks.map(bookmark => ({
      path: bookmark.path,
      line: bookmark.line,
      column: 0,
      matchLength: 0,
      label: baseNameOf(bookmark.path),
      preview: bookmark.preview,
      mark: 'exact',
      isDependency: false,
    })),
    selectedIndex: currentResults?.kind === 'bookmarks' && currentResults.selectedIndex !== null ? Math.min(currentResults.selectedIndex, bookmarks.length - 1) : null,
    firstShownIndex: currentResults?.kind === 'bookmarks' ? currentResults.firstShownIndex : 0,
  })
}

// --- Scrolling sideways ----------------------------------------------------------------------------------------------

// Half the width of the code at a time, as a page key moves half a screen: what was at the edge stays in sight.
function sidewaysStep(): number {
  return Math.max(8, Math.floor(lastDrawnLayout.codeColumns / 2))
}

// The columns scrolled out keep a name looked for in sight: unchanged when it already is, else enough for it to stand
// a third of the way in.
function scrolledColumnsShowing(column: number | null, scrolledColumns: number): number {
  const codeColumns = lastDrawnLayout.codeColumns
  if (column === null) {
    return scrolledColumns
  }
  const isInSight = column >= scrolledColumns && column < scrolledColumns + codeColumns - 4
  if (isInSight) {
    return scrolledColumns
  }

  return column < codeColumns - 4 ? 0 : Math.max(0, column - Math.floor(codeColumns / 3))
}

const widestLineColumnsOfFile = new WeakMap<ShownFile, number>()

function widestLineColumnsOf(file: ShownFile): number {
  const known = widestLineColumnsOfFile.get(file)
  if (known !== undefined) {
    return known
  }
  const widest = file.lines.reduce((widestSoFar, lineText) => Math.max(widestSoFar, drawnWidthOf(lineText)), 0)
  widestLineColumnsOfFile.set(file, widest)

  return widest
}

async function scrollCodeSideways($: EngineInterface, side: CutSide): Promise<void> {
  const file = shownFile
  if (file === null) {
    return
  }
  const widestLineColumns = widestLineColumnsOf(file)
  const lastScrolledColumns = Math.max(0, widestLineColumns - lastDrawnLayout.codeColumns + SIDEWAYS_SCROLL_MARGIN_COLUMNS)
  const step: Record<CutSide, number> = { before: -sidewaysStep(), after: sidewaysStep() }
  await update($, scrolledColumnsAtom, scrolledColumns =>
    Math.max(0, Math.min(lastScrolledColumns, Math.min(scrolledColumns, lastDrawnLayout.scrolledColumns) + step[side])),
  )
}

// --- Where the reading stands in the file ---------------------------------------------------------------------------

const symbolsOfFile = new WeakMap<ShownFile, readonly SymbolEntry[]>()

// Read once per text of a file: a new text is a new object.
function cachedSymbolsOf(file: ShownFile): readonly SymbolEntry[] {
  const known = symbolsOfFile.get(file)
  if (known !== undefined) {
    return known
  }
  const symbols = file === shownFile ? [...symbolsOfShownFile()].sort((first, second) => first.line - second.line) : []
  symbolsOfFile.set(file, symbols)

  return symbols
}

// The declaration the line is in, and those holding it: the last declared at or above the line, then its container
// up to the outermost. A declaration's end is not known, so a line below a method's closing brace still reads as in it.
function breadcrumbOf(file: ShownFile, line: number): BreadcrumbStep[] {
  const symbols = cachedSymbolsOf(file)
  const holderIndex = symbols.findLastIndex(symbol => symbol.line <= line)
  const steps: BreadcrumbStep[] = []
  let holder = symbols[holderIndex]
  let holderIndexInFile = holderIndex
  while (holder !== undefined && steps.length < 8) {
    steps.unshift({ name: holder.name, kind: holder.kind, line: holder.line })
    const containerName = holder.container
    if (containerName === null) {
      break
    }
    holderIndexInFile = symbols.findLastIndex((symbol, symbolIndex) => symbolIndex < holderIndexInFile && symbol.name === containerName)
    holder = symbols[holderIndexInFile]
  }

  return steps
}

// --- The lines selected, for Claude ------------------------------------------------------------------------------------

// A selection the person set aside keeps out of their messages until they select something else.
let setAsideSelectionText: string | null = null

async function selectedPlaceNow($: EngineInterface): Promise<SelectedPlace | null> {
  const file = shownFile
  if (file === null || file.path !== (await read($, currentPathAtom)) || !(await isPaneOpen($))) {
    return null
  }
  const selection = await $.ui.selection().catch(() => undefined)
  if (selection === undefined || selection.requestId !== undefined || selection.text === setAsideSelectionText) {
    return null
  }
  const topLine = clampedTopLine(await read($, topLineAtom), file.lines.length, lastDrawnLayout.codeRows)
  const lastLine = topLine + lastDrawnLayout.codeRows - 1
  const last = lastSelectionReading
  if (last !== null && last.text === selection.text && last.file === file && last.topLine === topLine && last.lastLine === lastLine) {
    return last.selectedPlace
  }
  const selectedLines = selectedLinesIn(selection.text, file.lines, { firstLine: topLine, lastLine })
  const selectedPlace = selectedLines === null ? null : { path: file.path, ...selectedLines }
  lastSelectionReading = { text: selection.text, file, topLine, lastLine, selectedPlace }

  return selectedPlace
}

// A selection left as it is is read again at every poll: what it was found to cover is kept until the selection, the
// file or the lines shown change.
let lastSelectionReading: { text: string; file: ShownFile; topLine: number; lastLine: number; selectedPlace: SelectedPlace | null } | null = null

// The engine raises nothing when the mouse selects: the selection is read again every little while, and the pane
// drawn again only when the lines it covers change.
async function followSelectedLines($: EngineInterface): Promise<void> {
  const selectedPlace = await selectedPlaceNow($)
  const shownPlace = await read($, selectedLinesAtom)
  const isSamePlace =
    selectedPlace?.path === shownPlace?.path && selectedPlace?.startLine === shownPlace?.startLine && selectedPlace?.endLine === shownPlace?.endLine
  if (!isSamePlace) {
    await update($, selectedLinesAtom, () => selectedPlace)
    await markSelectionInPrompt($)
  }
}

// After what the person types, a dim reminder that the lines go with the message; never part of the draft. The box
// draws none while empty, and drops it at each change of the draft: it is painted again after each one.
async function markSelectionInPrompt($: EngineInterface): Promise<void> {
  const selectedPlace = await read($, selectedLinesAtom)
  if (selectedPlace === null && !isSelectionMarkedInPrompt) {
    return
  }
  const text = (await $.prompt.read().catch(() => null))?.text
  if (text === undefined) {
    return
  }
  const decorations = selectionDecorationsOf(selectedPlace, text)
  await $.prompt.paint({ text, decorations }).catch(() => undefined)
  isSelectionMarkedInPrompt = decorations.length > 0
}

let isSelectionMarkedInPrompt = false

function selectionDecorationsOf(selectedPlace: SelectedPlace | null, text: string): PromptDecoration[] {
  if (selectedPlace === null || text === '') {
    return []
  }

  return [{ start: text.length, end: text.length, virtualText: `  ◆ ${selectedPlaceLabel(selectedPlace)} → Claude`, dimColor: true, italic: true }]
}

function selectedPlaceLabel(selectedPlace: SelectedPlace): string {
  return `${baseNameOf(selectedPlace.path)}:${lineRangeOf(selectedPlace)}`
}

async function setSelectionAside($: EngineInterface): Promise<void> {
  setAsideSelectionText = (await $.ui.selection().catch(() => undefined))?.text ?? null
  await update($, selectedLinesAtom, () => null)
}

function selectionContextOf(selectedPlace: SelectedPlace, lines: readonly string[]): string {
  const { path, startLine, endLine } = selectedPlace
  const extension = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1) : ''
  const selectedText = lines.slice(startLine - 1, endLine).join('\n')

  return [
    `The user has selected ${linesWordOf(selectedPlace)} ${lineRangeOf(selectedPlace)} of ${path} in the code-nav pane beside the conversation: what their message calls "this", "here" or "these lines" is likely this code.`,
    `\`\`\`${extension}`,
    selectedText,
    '```',
  ].join('\n')
}

async function isPaneOpen($: EngineInterface): Promise<boolean> {
  return (await $.ui.panes()).some(pane => pane.id === PANE_ID)
}

async function currentPlace($: EngineInterface): Promise<ViewedPlace | null> {
  const currentPath = await read($, currentPathAtom)
  if (currentPath === null) {
    return null
  }
  const markedSymbol = await read($, markedSymbolAtom)
  const topLine = await currentTopLine($, currentPath)

  return { path: currentPath, topLine, markedLine: markedSymbol?.path === currentPath ? markedSymbol.line : null }
}

// The first line shown, brought back inside the file when its text is read: a restored tab not read yet keeps its own.
async function currentTopLine($: EngineInterface, currentPath: string): Promise<number> {
  const topLine = await read($, topLineAtom)

  return shownFile?.path === currentPath ? clampedTopLine(topLine, shownFile.lines.length, lastDrawnLayout.codeRows) : topLine
}

async function currentTabView($: EngineInterface): Promise<TabView | null> {
  const currentPath = await read($, currentPathAtom)
  if (currentPath === null) {
    return null
  }

  return { topLine: await currentTopLine($, currentPath), markedSymbol: await read($, markedSymbolAtom) }
}

async function saveTabs($: EngineInterface, tabs: TabsState): Promise<void> {
  await update($, tabsAtom, () => tabs)
  const root = await read($, projectRootAtom)
  if (root !== null) {
    await $.store.set(`${OPEN_TABS_STORE_KEY_PREFIX}${root}`, savedTabsOf(tabs)).catch(() => undefined)
  }
}

// Shows the tab the state makes active as it was left. A tab whose file is gone since is closed on the way.
// What every way of landing somewhere shows: the file, where it is read, the name pointed at, the code scrolled
// sideways only as far as that name needs, the help put away.
async function showView($: EngineInterface, path: string, topLine: number, markedSymbol: MarkedSymbol | null, isSameFile: boolean): Promise<void> {
  await update($, currentPathAtom, () => path)
  await update($, topLineAtom, () => topLine)
  await update($, markedSymbolAtom, () => markedSymbol)
  await update($, scrolledColumnsAtom, scrolledColumns => scrolledColumnsShowing(markedSymbol?.startColumn ?? null, isSameFile ? scrolledColumns : 0))
  await update($, isHelpShownAtom, () => false)
}

async function showActiveTab($: EngineInterface, tabs: TabsState): Promise<void> {
  await clearInlineNote($)
  let state = tabs
  for (let activeTab = activeTabOf(state); activeTab !== null; activeTab = activeTabOf(state)) {
    if (shownFile?.path === activeTab.path || (await readShownFile($, activeTab.path))) {
      await saveTabs($, state)
      await showView($, activeTab.path, activeTab.topLine, activeTab.markedSymbol, false)
      await revealInTree($, activeTab.path)
      return
    }
    state = tabsAfterClosing(state, 'active', null)
  }
  shownFile = null
  await saveTabs($, state)
  await update($, currentPathAtom, () => null)
  await update($, topLineAtom, () => 1)
  await update($, markedSymbolAtom, () => null)
}

// Moving to another tab is a move as any jump: back returns to the tab left.
async function recordMove($: EngineInterface, leftPlace: ViewedPlace | null): Promise<void> {
  const landingPlace = await currentPlace($)
  if (landingPlace !== null && landingPlace.path !== leftPlace?.path) {
    await update($, historyAtom, history => historyAfterJump(history, leftPlace, landingPlace))
  }
}

async function activateTab($: EngineInterface, tabIndex: number): Promise<void> {
  await foldDrawer($, 'tabs')
  const leftPlace = await currentPlace($)
  await showActiveTab($, tabsAfterActivating(await read($, tabsAtom), tabIndex, await currentTabView($)))
  await recordMove($, leftPlace)
}

async function stepThroughTabs($: EngineInterface, step: 1 | -1): Promise<void> {
  const tabs = await read($, tabsAtom)
  if (tabs.activeIndex === null || tabs.tabs.length < 2) {
    await showNotice($, 'No other tab open.')
    return
  }
  await activateTab($, (tabs.activeIndex + step + tabs.tabs.length) % tabs.tabs.length)
}

async function closeTabs($: EngineInterface, closing: TabClosing, tabIndex?: number): Promise<void> {
  const tabs = await read($, tabsAtom)
  if (tabs.activeIndex === null) {
    await showNotice($, 'No tab open.')
    return
  }
  await showActiveTab($, tabsAfterClosing(tabs, closing, await currentTabView($), tabIndex ?? tabs.activeIndex))
}

// The first line to show so that a line jumped to sits a third of the way down; a line already in sight, away from
// the edges, moves nothing.
function topLineShowing(line: number, currentTopLine: number, isSameFile: boolean): number {
  const { codeRows } = lastDrawnLayout
  const edgeMargin = Math.min(3, Math.floor(codeRows / 4))
  const isComfortablyInSight = isSameFile && line >= currentTopLine + edgeMargin && line <= currentTopLine + codeRows - 1 - edgeMargin

  return isComfortablyInSight ? currentTopLine : Math.max(1, line - Math.floor(codeRows * JUMP_LINE_SHARE_FROM_TOP))
}

type PlaceToShow = { path: string; line: number; column?: number; nameLength?: number; name?: string }

// The name to point at on the line landed on: the word at the column given, else the name looked for wherever the
// line writes it, else the line alone.
function markedSymbolAt(place: PlaceToShow, lineText: string): MarkedSymbol {
  if (place.column !== undefined && place.nameLength !== undefined && place.nameLength > 0) {
    return { path: place.path, line: place.line, startColumn: place.column, endColumn: place.column + place.nameLength }
  }
  const wordAtColumn = place.column === undefined ? null : wordAt(lineText, place.column)
  if (wordAtColumn !== null && (place.name === undefined || wordAtColumn.name === place.name || place.column !== 0)) {
    return { path: place.path, line: place.line, startColumn: wordAtColumn.startColumn, endColumn: wordAtColumn.endColumn }
  }
  const nameColumn = place.name === undefined ? -1 : lineText.search(new RegExp(wholeNamePattern(place.name)))
  if (place.name !== undefined && nameColumn >= 0) {
    return { path: place.path, line: place.line, startColumn: nameColumn, endColumn: nameColumn + place.name.length }
  }

  return { path: place.path, line: place.line, startColumn: 0, endColumn: 0 }
}

async function rememberRecentPath($: EngineInterface, path: string): Promise<void> {
  const recentPaths = [path, ...(await read($, recentPathsAtom)).filter(recentPath => recentPath !== path)].slice(0, RECENT_PATH_LIMIT)
  await update($, recentPathsAtom, () => recentPaths)
  const root = await read($, projectRootAtom)
  if (root !== null) {
    await $.store.set(`${RECENT_PATHS_STORE_KEY_PREFIX}${root}`, recentPaths).catch(() => undefined)
  }
}

async function showPlace($: EngineInterface, place: PlaceToShow, isRecordedInHistory: boolean): Promise<boolean> {
  await clearInlineNote($)
  const leftPlace = await currentPlace($)
  const leavingView = await currentTabView($)
  const isSameFile = shownFile !== null && shownFile.path === place.path
  if (!isSameFile && !(await readShownFile($, place.path))) {
    return false
  }
  const lineCount = shownFile?.lines.length ?? 0
  const line = Math.max(1, Math.min(place.line, Math.max(1, lineCount)))
  // A file opened as a whole points at nothing: its first line is where reading starts, not a place looked for.
  const isWholeFileOpened = place.line <= 1 && place.column === undefined && place.name === undefined
  const markedSymbol = isWholeFileOpened ? null : markedSymbolAt({ ...place, line }, shownFile?.lines[line - 1] ?? '')
  const topLine = topLineShowing(line, leftPlace?.topLine ?? 1, isSameFile)
  await showView($, place.path, topLine, markedSymbol, isSameFile)
  if (isRecordedInHistory) {
    const landingPlace: ViewedPlace = { path: place.path, topLine, markedLine: markedSymbol === null ? null : line }
    await update($, historyAtom, history => historyAfterJump(history, leftPlace, landingPlace))
  }
  await saveTabs($, tabsAfterOpening(await read($, tabsAtom), place.path, leavingView, { topLine, markedSymbol }))
  if (!isSameFile) {
    await rememberRecentPath($, place.path)
    await revealInTree($, place.path)
  }

  return true
}

// A place whose file is gone since is passed over, so that the places before it stay within reach.
async function stepThroughHistory($: EngineInterface, step: 1 | -1): Promise<void> {
  let history = await read($, historyAtom)
  let leftPlace = await currentPlace($)
  const leavingView = await currentTabView($)
  for (;;) {
    const stepped = historyAfterStep(history, leftPlace, step)
    if (stepped === null) {
      await showNotice($, step === -1 ? 'Nowhere to go back to.' : 'Nowhere to go forward to.')
      return
    }
    const { place } = stepped
    const isSameFile = shownFile?.path === place.path
    if (isSameFile || (await readShownFile($, place.path))) {
      await update($, historyAtom, () => stepped.history)
      const markedSymbol: MarkedSymbol | null =
        place.markedLine === null ? null : { path: place.path, line: place.markedLine, startColumn: 0, endColumn: 0 }
      await showView($, place.path, place.topLine, markedSymbol, isSameFile)
      await saveTabs($, tabsAfterOpening(await read($, tabsAtom), place.path, leavingView, { topLine: place.topLine, markedSymbol }))
      await revealInTree($, place.path)
      return
    }
    history = stepped.history
    leftPlace = null
  }
}

async function scrollCodeBy($: EngineInterface, lines: number): Promise<void> {
  await clearInlineNote($)
  const lineCount = shownFile?.lines.length ?? 0
  await update($, topLineAtom, topLine => clampedTopLine(clampedTopLine(topLine, lineCount, lastDrawnLayout.codeRows) + lines, lineCount, lastDrawnLayout.codeRows))
}

// --- Definitions, usages, implementations -----------------------------------------------------------------------------

function rowOfTarget(target: NavigationTarget, nameLength: number): ResultRow {
  return {
    path: target.path,
    line: target.line,
    column: target.column,
    matchLength: nameLength,
    label: target.label,
    preview: target.preview,
    mark: target.certainty,
    isDependency: target.isDependency,
  }
}

// A list opens unwalked, at its top, about no text searched and with nothing to say, unless told otherwise.
type ResultsPanelOpening = Pick<ResultsPanel, 'kind' | 'title' | 'rows'> & Partial<Omit<ResultsPanel, 'kind' | 'title' | 'rows'>>

async function openResultsPanel($: EngineInterface, opening: ResultsPanelOpening): Promise<void> {
  const resultsPanel: ResultsPanel = { searchedText: null, selectedIndex: null, firstShownIndex: 0, isTruncated: false, note: null, ...opening }
  await update($, isPeekShownAtom, () => false)
  await update($, resultsPanelAtom, () => resultsPanel)
  await update($, isHelpShownAtom, () => false)
}

// The answer to a question asked of the analysis, or null when it failed or when the person has asked another
// question since: a slow answer arriving late must not move the pane away from where a later click took it.
async function latestAnswerOrNoticed<Answer>($: EngineInterface, question: () => Promise<Answer>): Promise<Answer | null> {
  latestLookupNumber += 1
  const lookupNumber = latestLookupNumber
  try {
    const answer = await question()

    return lookupNumber === latestLookupNumber ? answer : null
  } catch (error) {
    if (lookupNumber === latestLookupNumber) {
      await showNotice($, `The analysis failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    return null
  }
}

// The analyses find a class's file through the project's listing (where its composer.json is, which files are its
// own): a pane drawn again after a reload of the mod has none yet, and waits for it rather than answer wrong.
async function analysedWorkspace($: EngineInterface): Promise<EngineWorkspace> {
  const projectWorkspace = await ensureWorkspace($)
  if (projectWorkspace.index().builtAt === 0) {
    await refreshIndex($, false)
  }

  return projectWorkspace
}

async function listUsagesAt($: EngineInterface, position: CodePosition): Promise<void> {
  const projectWorkspace = await analysedWorkspace($)
  const answer = await latestAnswerOrNoticed($, () => findUsages(projectWorkspace, position))
  if (answer === null) {
    return
  }
  if (answer.symbol === null) {
    await showNoteAt($, position, answer.note ?? 'No name there to look usages up for.')
    return
  }
  if (answer.usages.length === 0) {
    await showNoteAt($, position, answer.note ?? `No usage of ${answer.title} in the project.`)
    return
  }
  const nameLength = answer.symbol.name.length
  await openResultsPanel($, {
    kind: 'usages',
    title: answer.title,
    rows: answer.usages.map(usage => ({
      path: usage.path,
      line: usage.line,
      column: usage.column,
      matchLength: nameLength,
      label: answer.title,
      preview: usage.preview,
      mark: usage.certainty,
      isDependency: false,
    })),
    isTruncated: answer.isTruncated,
    note: answer.note,
  })
}

// Up the hierarchy: the classes and interfaces a class extends or implements, or the methods a method overrides or
// implements, nearest first; the one there is opened at once.
async function listParentsAt($: EngineInterface, position: CodePosition): Promise<void> {
  await clearInlineNote($)
  const projectWorkspace = await analysedWorkspace($)
  const answer = await latestAnswerOrNoticed($, () => findParents(projectWorkspace, position))
  if (answer === null) {
    return
  }
  if (answer.symbol === null || answer.targets.length === 0) {
    await showNoteAt($, position, answer.note ?? 'No parent to go to from there.')
    return
  }
  const { title } = answer
  const [onlyTarget] = answer.targets
  if (answer.targets.length === 1 && onlyTarget !== undefined) {
    await showPlace($, { path: onlyTarget.path, line: onlyTarget.line, column: onlyTarget.column, name: answer.symbol.name }, true)
    await showNoteAt($, onlyTarget, `${onlyTarget.label} is the only parent of ${title}.`)
    return
  }
  await openResultsPanel($, {
    kind: 'parents',
    title,
    rows: answer.targets.map(target => rowOfTarget(target, answer.symbol?.name.length ?? 0)),
    note: answer.note,
  })
}

async function listImplementationsAt($: EngineInterface, position: CodePosition): Promise<void> {
  const projectWorkspace = await analysedWorkspace($)
  const answer = await latestAnswerOrNoticed($, () => findImplementations(projectWorkspace, position))
  if (answer === null) {
    return
  }
  if (answer.symbol === null) {
    await showNoteAt($, position, answer.note ?? 'No name there to look implementations up for.')
    return
  }
  if (answer.targets.length === 0) {
    await showNoteAt($, position, answer.note ?? `No implementation of ${answer.title} in the project.`)
    return
  }
  const nameLength = answer.symbol.name.length
  const [onlyTarget] = answer.targets
  if (answer.targets.length === 1 && onlyTarget !== undefined) {
    await showPlace($, { path: onlyTarget.path, line: onlyTarget.line, column: onlyTarget.column, name: answer.symbol.name }, true)
    await showNoteAt($, onlyTarget, `${onlyTarget.label} is the only implementation of ${answer.title}.`)
    return
  }
  await openResultsPanel($, {
    kind: 'implementations',
    title: answer.title,
    rows: answer.targets.map(target => rowOfTarget(target, nameLength)),
    note: answer.note,
  })
}

// A click on a name points at it, for its usages and implementations, and leaves the reading where it is.
async function markToken($: EngineInterface, lineNumber: number, column: number): Promise<void> {
  const file = shownFile
  const token = file?.tokensByLine[lineNumber - 1]?.find(candidate => candidate.startColumn === column)
  if (file === null || token === undefined) {
    return
  }
  await clearInlineNote($)
  await foldDrawer($, 'files')
  await foldDrawer($, 'tabs')
  await update($, markedSymbolAtom, () => ({ path: file.path, line: lineNumber, startColumn: token.startColumn, endColumn: token.endColumn }))
}

// The tag over a name: its declaration when the analysis finds one, the list when several may be meant, its usages
// when the name is the declaration itself.
async function activateToken($: EngineInterface, lineNumber: number, column: number): Promise<void> {
  const currentPath = await read($, currentPathAtom)
  if (currentPath === null) {
    return
  }
  await clearInlineNote($)
  await foldDrawer($, 'files')
  await foldDrawer($, 'tabs')
  const projectWorkspace = await analysedWorkspace($)
  const position: CodePosition = { path: currentPath, line: lineNumber, column }
  const answer = await latestAnswerOrNoticed($, () => resolveDefinition(projectWorkspace, position))
  if (answer === null) {
    return
  }
  const { symbol } = answer
  if (symbol === null) {
    await showNoteAt($, position, answer.note ?? 'Nothing to look up there.')
    return
  }
  const clickedSymbol: MarkedSymbol = { path: currentPath, line: symbol.line, startColumn: symbol.startColumn, endColumn: symbol.endColumn }
  if (answer.isOnDeclaration) {
    await update($, markedSymbolAtom, () => clickedSymbol)
    await listUsagesAt($, position)
    return
  }
  const exactTargets = answer.targets.filter(target => target.certainty === 'exact')
  const [onlyTarget] = exactTargets.length === 1 ? exactTargets : answer.targets.length === 1 ? answer.targets : []
  if (onlyTarget !== undefined) {
    await showPlace($, { path: onlyTarget.path, line: onlyTarget.line, column: onlyTarget.column, name: symbol.name }, true)
    return
  }
  await update($, markedSymbolAtom, () => clickedSymbol)
  if (answer.targets.length === 0) {
    await showNoteAt($, position, answer.note ?? `No declaration found for ${symbol.name}.`)
    return
  }
  await openResultsPanel($, {
    kind: 'definitions',
    title: symbol.name,
    rows: answer.targets.map(target => rowOfTarget(target, symbol.name.length)),
    note: answer.note,
  })
}

async function markedPosition($: EngineInterface): Promise<CodePosition | null> {
  const markedSymbol = await read($, markedSymbolAtom)
  if (markedSymbol === null || markedSymbol.endColumn <= markedSymbol.startColumn) {
    await showNotice($, 'Click a name first: usages and implementations are looked up for the name pointed at.')
    return null
  }

  return { path: markedSymbol.path, line: markedSymbol.line, column: markedSymbol.startColumn }
}

async function selectResultRow($: EngineInterface, rowIndex: number): Promise<ResultRow | null> {
  const resultsPanel = await read($, resultsPanelAtom)
  const row = resultsPanel?.rows[rowIndex]
  if (!resultsPanel || !row) {
    return null
  }
  const firstShownIndex = firstShownIndexKeeping(rowIndex, resultsPanel.firstShownIndex, Math.max(1, lastDrawnLayout.resultsRows), resultsPanel.rows.length)
  await update($, resultsPanelAtom, () => ({ ...resultsPanel, selectedIndex: rowIndex, firstShownIndex }))

  return row
}

// Going into a row's file hides the preview, its place now shown.
async function openResultRow($: EngineInterface, rowIndex: number): Promise<void> {
  const row = await selectResultRow($, rowIndex)
  if (row === null) {
    return
  }
  await update($, isPeekShownAtom, () => false)
  await showPlace($, { path: row.path, line: row.line, column: row.column, nameLength: row.matchLength }, true)
}

async function openPeekedRow($: EngineInterface): Promise<void> {
  const selectedIndex = (await read($, resultsPanelAtom))?.selectedIndex ?? null
  if (selectedIndex !== null) {
    await openResultRow($, selectedIndex)
  }
}

// Walking the list previews each place above it, the file read staying in place; the row walked to takes the
// keyboard, so Enter on it goes into its file.
async function stepThroughResults($: EngineInterface, step: 1 | -1): Promise<void> {
  const resultsPanel = await read($, resultsPanelAtom)
  if (resultsPanel === null || resultsPanel.rows.length === 0) {
    await showNotice($, 'No list to walk: click a declaration, or press u for the usages of the name pointed at.')
    return
  }
  const steppedIndex = resultsPanel.selectedIndex === null ? (step === 1 ? 0 : resultsPanel.rows.length - 1) : resultsPanel.selectedIndex + step
  await peekResultRow($, Math.max(0, Math.min(resultsPanel.rows.length - 1, steppedIndex)))
}

async function peekResultRow($: EngineInterface, rowIndex: number): Promise<void> {
  const row = await selectResultRow($, rowIndex)
  if (row === null) {
    return
  }
  await clearInlineNote($)
  if (row.path === (await read($, currentPathAtom))) {
    // A preview of the file read would show what the code above already holds: the code goes to the place instead.
    await update($, isPeekShownAtom, () => false)
    await showPlace($, { path: row.path, line: row.line, column: row.column, nameLength: row.matchLength }, false)
  } else {
    await update($, peekScrolledLinesAtom, () => 0)
    await update($, isPeekShownAtom, () => true)
    await loadPeekedFile($, row.path)
  }
  focusAfterNextDrawing($, `${RESULT_ROW_KEY_PREFIX}${rowIndex}`)
}

// A first press on a row previews it; a second press on the row previewed goes into its file.
async function pressResultRow($: EngineInterface, rowIndex: number): Promise<void> {
  const isRowPreviewed = (await read($, isPeekShownAtom)) && (await read($, resultsPanelAtom))?.selectedIndex === rowIndex
  if (isRowPreviewed) {
    await openResultRow($, rowIndex)
    return
  }
  await peekResultRow($, rowIndex)
}

// --- The palette --------------------------------------------------------------------------------------------------------

function symbolsOfShownFile(): SymbolEntry[] {
  if (shownFile === null) {
    return []
  }
  const { path } = shownFile
  const text = shownFile.lines.join('\n')
  // The text shown is read rather than the project's listing, which may be a few seconds behind an edit.
  const symbolsOfLanguage: Record<AnalysedLanguage, () => readonly SymbolEntry[]> = {
    php: () => phpSymbolsOfFile(path, text),
    script: () => scriptSymbolsOfFile(path, text),
    text: () => genericSymbolsOfFile(path, text),
  }

  return [...symbolsOfLanguage[analysedLanguageOfPath(path)]()]
}

const OUTLINE_INDENTATION = '  '

function outlineItems(query: string): PaletteItem[] {
  const symbols = shownFile === null ? [] : cachedSymbolsOf(shownFile)
  if (query.trim() === '') {
    // Read top to bottom, each declaration indented under the one holding it, as a tree of the file.
    const depthByName = new Map<string, number>()

    return symbols.map(symbol => {
      const depth = symbol.container === null ? 0 : (depthByName.get(symbol.container) ?? 0) + 1
      depthByName.set(symbol.name, depth)

      return {
        kind: 'symbol',
        symbolKind: symbol.kind,
        label: `${OUTLINE_INDENTATION.repeat(depth)}${symbol.name}`,
        detail: `line ${symbol.line}`,
        matchedIndexes: [],
        path: symbol.path,
        line: symbol.line,
      }
    })
  }
  const outlineSource = shownFile === null ? preparePaletteSource([], []) : cachedOutlineSourceOf(shownFile, symbols)

  return searchPalette(query, outlineSource, { recentPaths: [], currentPath: null }, PALETTE_ITEM_LIMIT).map(item => ({ ...item, detail: `line ${item.line}` }))
}

const outlineSourceOfFile = new WeakMap<ShownFile, PaletteSource>()

function cachedOutlineSourceOf(file: ShownFile, symbols: readonly SymbolEntry[]): PaletteSource {
  const known = outlineSourceOfFile.get(file)
  if (known !== undefined) {
    return known
  }
  const source = preparePaletteSource([], symbols)
  outlineSourceOfFile.set(file, source)

  return source
}

function paletteItemsFor(mode: PaletteMode, query: string): PaletteItem[] {
  const itemsOfMode: Record<PaletteMode, () => PaletteItem[]> = {
    everything: () => (paletteSource === null ? [] : searchPalette(query, paletteSource, paletteContext, PALETTE_ITEM_LIMIT)),
    outline: () => outlineItems(query).slice(0, OUTLINE_ITEM_LIMIT),
    textSearch: () => [],
  }

  return itemsOfMode[mode]()
}

// The rows are searched again for the text the palette holds now: after the project was listed again, say.
async function fillPalette($: EngineInterface): Promise<void> {
  await update($, paletteAtom, palette => {
    if (palette === null) {
      return null
    }
    const items = paletteItemsFor(palette.mode, palette.query)

    return { ...palette, items, selectedIndex: Math.min(palette.selectedIndex, Math.max(0, items.length - 1)) }
  })
}

// A key press is handled before the pane is drawn again, and the engine waits for an element still to be drawn:
// awaiting the focus there would hold the press. It settles once the next drawing is done.
function focusAfterNextDrawing($: EngineInterface, key: string): void {
  void $.ui.focus({ requestId: PANE_ID, key }).catch(() => undefined)
}

// The structure of the file opens on the declaration the reading is in: the last one starting at or above it.
function indexOfDeclarationHolding(items: readonly PaletteItem[], line: number): number {
  const lastIndexAbove = items.findLastIndex(item => item.line <= line)

  return Math.max(0, lastIndexAbove)
}

// The line pointed at while it is in sight, else the first line shown.
async function lineReadNow($: EngineInterface): Promise<number> {
  const markedSymbol = await read($, markedSymbolAtom)
  const file = shownFile
  const topLine = file === null ? await read($, topLineAtom) : clampedTopLine(await read($, topLineAtom), file.lines.length, lastDrawnLayout.codeRows)
  const isMarkedLineInSight =
    markedSymbol !== null &&
    markedSymbol.path === (await read($, currentPathAtom)) &&
    markedSymbol.line >= topLine &&
    markedSymbol.line < topLine + lastDrawnLayout.codeRows

  return isMarkedLineInSight ? markedSymbol.line : topLine
}

async function openPalette($: EngineInterface, mode: PaletteMode, initialQuery = '', requestedTextScope: TextSearchScope | null = null): Promise<void> {
  await ensureWorkspace($)
  latestPaletteFieldNumber += 1
  const fieldNumber = latestPaletteFieldNumber
  const recentPaths = [...(await read($, recentPathsAtom)), ...(await read($, touchedPathsAtom))]
  paletteContext = { recentPaths: [...new Set(recentPaths)], currentPath: await read($, currentPathAtom) }
  const items = paletteItemsFor(mode, initialQuery)
  const selectedIndex = mode === 'outline' && initialQuery === '' ? indexOfDeclarationHolding(items, await lineReadNow($)) : 0
  if (requestedTextScope !== null) {
    lastTextScope = requestedTextScope
  }
  const textScope: TextSearchScope = shownFile === null ? 'project' : lastTextScope
  await update($, paletteAtom, () => ({ mode, textScope, query: initialQuery, initialQuery, selectedIndex, fieldNumber, items }))
  await update($, isHelpShownAtom, () => false)
  await takeKeyboardAfterClick($)
  focusAfterNextDrawing($, paletteFieldKey(fieldNumber))
  void refreshIndex($, false)
}

// The pane asks for the keyboard without changing its width. Escape hands the keyboard back to the prompt even when
// the pane stays open, and a click on a name or a row presses it without moving the keyboard: in both cases the next
// key would otherwise be typed in the prompt. The engine refuses while the person has text in the prompt.
async function takeKeyboard($: EngineInterface): Promise<void> {
  await $.ui.open({ id: PANE_ID, title: PANE_TITLE, closeOnEscape: true, focus: true }).catch(() => undefined)
}

function takeKeyboardBack($: EngineInterface): void {
  void $.clock.after(0, () => takeKeyboard($))
}

async function takeKeyboardAfterClick($: EngineInterface): Promise<void> {
  if (!lastDrawnLayout.isPaneFocused) {
    await takeKeyboard($)
  }
}

async function closePalette($: EngineInterface): Promise<void> {
  await update($, paletteAtom, () => null)
}

// One write per key typed, so the pane is drawn once: the rows are searched first, then set with the text.
async function updatePaletteQuery($: EngineInterface, query: string): Promise<void> {
  const palette = await read($, paletteAtom)
  if (palette === null || palette.query === query) {
    return
  }
  const items = paletteItemsFor(palette.mode, query)
  await update($, paletteAtom, current => (current === null ? null : { ...current, query, selectedIndex: 0, items }))
  if (palette.mode === 'textSearch' && palette.textScope === 'file') {
    await showMatchesInShownFile($, query)
  }
}

async function movePaletteSelection($: EngineInterface, step: 1 | -1): Promise<void> {
  await update($, paletteAtom, palette =>
    palette === null ? null : { ...palette, selectedIndex: Math.max(0, Math.min(palette.items.length - 1, palette.selectedIndex + step)) },
  )
}

async function openPaletteItem($: EngineInterface, itemIndex: number): Promise<void> {
  const item = (await read($, paletteAtom))?.items[itemIndex]
  if (!item) {
    return
  }
  await closePalette($)
  // A declaration is pointed at by its name on its line; a file or a line of a file by the line alone.
  const namePointedAt: Record<PaletteItemKind, string | null> = { symbol: (item.label.split('::').pop() ?? item.label).trim(), file: null, line: null }
  const name = namePointedAt[item.kind]
  await showPlace($, { path: item.path, line: item.line, ...(name === null ? {} : { name }) }, true)
}

// The search in the file shown answers as the text is typed: every match listed under the code and lit in it, the
// code scrolled to the first match from where it was read.
async function showMatchesInShownFile($: EngineInterface, text: string): Promise<void> {
  const file = shownFile
  if (file === null) {
    return
  }
  if (text === '') {
    if ((await read($, resultsPanelAtom))?.kind === 'textSearch') {
      await update($, resultsPanelAtom, () => null)
    }
    return
  }
  const { matches, isTruncated } = textMatchesInLines(file.lines, text, TEXT_SEARCH_MATCH_LIMIT)
  const fileName = baseNameOf(file.path)
  await openResultsPanel($, {
    kind: 'textSearch',
    searchedText: text,
    title: `"${text}" in ${fileName}`,
    rows: matches.map(match => ({
      path: file.path,
      line: match.line,
      column: match.column,
      matchLength: text.length,
      label: text,
      preview: (file.lines[match.line - 1] ?? '').trim(),
      mark: 'match',
      isDependency: false,
    })),
    isTruncated,
    note: matches.length === 0 ? `"${text}" is not written in ${fileName}.` : null,
  })
  const firstMatch = matches[firstMatchIndexFrom(matches, await read($, topLineAtom))]
  if (firstMatch !== undefined) {
    await update($, topLineAtom, topLine => topLineShowing(firstMatch.line, topLine, true))
  }
}

async function setTextScope($: EngineInterface, textScope: TextSearchScope): Promise<void> {
  const palette = await read($, paletteAtom)
  if (palette === null || palette.mode !== 'textSearch' || palette.textScope === textScope) {
    return
  }
  lastTextScope = textScope
  await update($, paletteAtom, current => (current === null ? null : { ...current, textScope }))
  const textScopeEffects: Record<TextSearchScope, () => Promise<void>> = {
    file: () => showMatchesInShownFile($, palette.query),
    project: async () => {
      if ((await read($, resultsPanelAtom))?.kind === 'textSearch') {
        await update($, resultsPanelAtom, () => null)
      }
    },
  }
  await textScopeEffects[textScope]()
}

async function searchTextInProject($: EngineInterface, text: string): Promise<void> {
  if (text.trim() === '') {
    return
  }
  const projectWorkspace = await ensureWorkspace($)
  const literalPattern = escapedForRegularExpression(text)
  const searchOptions = { isCaseInsensitive: !isCaseSensitiveText(text), maxMatches: TEXT_SEARCH_MATCH_LIMIT + 1 }
  const matches = await latestAnswerOrNoticed($, () => projectWorkspace.search(literalPattern, searchOptions))
  if (matches === null) {
    return
  }
  await openResultsPanel($, {
    kind: 'textSearch',
    searchedText: text,
    title: `"${text}"`,
    rows: matches.slice(0, TEXT_SEARCH_MATCH_LIMIT).map(match => ({
      path: match.path,
      line: match.line,
      column: match.column,
      matchLength: text.length,
      label: text,
      preview: match.text.trim(),
      mark: 'match',
      isDependency: false,
    })),
    isTruncated: matches.length > TEXT_SEARCH_MATCH_LIMIT,
    note: matches.length === 0 ? `"${text}" is written nowhere in the project.` : null,
  })
}

async function submitPalette($: EngineInterface, query: string): Promise<void> {
  const palette = await read($, paletteAtom)
  if (palette === null) {
    return
  }
  if (palette.mode === 'textSearch') {
    await closePalette($)
    const submittedSearches: Record<TextSearchScope, () => Promise<void>> = {
      file: async () => {
        await showMatchesInShownFile($, query)
        const resultsPanel = await read($, resultsPanelAtom)
        const matches = resultsPanel?.kind === 'textSearch' ? resultsPanel.rows : []
        if (matches.length > 0) {
          await openResultRow($, firstMatchIndexFrom(matches, await read($, topLineAtom)))
        }
      },
      project: () => searchTextInProject($, query),
    }
    await submittedSearches[palette.textScope]()
    return
  }
  if (palette.query !== query) {
    await updatePaletteQuery($, query)
  }
  const selectedIndex = (await read($, paletteAtom))?.selectedIndex ?? 0
  await openPaletteItem($, selectedIndex)
}

// --- Shortcuts ------------------------------------------------------------------------------------------------------------

async function copyLocation($: EngineInterface): Promise<void> {
  const place = await currentPlace($)
  if (place === null) {
    await showNotice($, 'No file shown.')
    return
  }
  const location = `${place.path}:${place.markedLine ?? place.topLine}`
  const copied = await $.ui.copy({ text: location }).catch(() => ({ isCopied: false }))
  await showNotice($, copied.isCopied ? `Copied ${location}` : `Could not copy ${location}`)
}

async function runShortcut($: EngineInterface, action: ShortcutAction): Promise<void> {
  const lineCount = shownFile?.lines.length ?? 0
  const shortcuts: Record<ShortcutAction, () => Promise<void>> = {
    findEverything: () => openPalette($, 'everything'),
    fileOutline: () => (shownFile === null ? showNotice($, 'No file shown.') : openPalette($, 'outline')),
    searchText: () => openPalette($, 'textSearch'),
    showUsages: async () => {
      const position = await markedPosition($)
      if (position !== null) {
        await listUsagesAt($, position)
      }
    },
    showImplementations: async () => {
      const position = await markedPosition($)
      if (position !== null) {
        await listImplementationsAt($, position)
      }
    },
    nextTab: () => stepThroughTabs($, 1),
    previousTab: () => stepThroughTabs($, -1),
    closeTab: () => closeTabs($, 'active'),
    closeOtherTabs: () => closeTabs($, 'others'),
    closeTabsOnTheLeft: () => closeTabs($, 'left'),
    closeTabsOnTheRight: () => closeTabs($, 'right'),
    closeAllTabs: () => closeTabs($, 'all'),
    goBack: () => stepThroughHistory($, -1),
    goForward: () => stepThroughHistory($, 1),
    previousResult: () => stepThroughResults($, -1),
    nextResult: () => stepThroughResults($, 1),
    closeResults: async () => {
      await update($, resultsPanelAtom, () => null)
    },
    scrollUp: () => scrollCodeBy($, -KEY_SCROLL_LINES),
    scrollDown: () => scrollCodeBy($, KEY_SCROLL_LINES),
    goToTop: async () => {
      await update($, topLineAtom, () => 1)
    },
    goToEnd: async () => {
      await update($, topLineAtom, () => clampedTopLine(lineCount, lineCount, lastDrawnLayout.codeRows))
    },
    copyLocation: () => copyLocation($),
    toggleFiles: () => toggleDrawer($, 'files'),
    toggleTabsColumn: () => toggleDrawer($, 'tabs'),
    toggleHelp: async () => {
      await update($, isHelpShownAtom, isHelpShown => !isHelpShown)
    },
  }
  await shortcuts[action]()
}

function paneActions($: EngineInterface): PaneActions {
  const afterTakingKeyboard = async (action: () => Promise<void>) => {
    await takeKeyboardAfterClick($)
    await action()
  }

  return {
    runShortcut: action => afterTakingKeyboard(() => runShortcut($, action)),
    activateToken: (lineNumber, column) => afterTakingKeyboard(() => activateToken($, lineNumber, column)),
    markToken: (lineNumber, column) => afterTakingKeyboard(() => markToken($, lineNumber, column)),
    listParents: (lineNumber, column) =>
      afterTakingKeyboard(async () => {
        const currentPath = await read($, currentPathAtom)
        if (currentPath !== null) {
          await listParentsAt($, { path: currentPath, line: lineNumber, column })
        }
      }),
    updatePaletteQuery: query => updatePaletteQuery($, query),
    submitPalette: query => submitPalette($, query),
    openPaletteItem: itemIndex => afterTakingKeyboard(() => openPaletteItem($, itemIndex)),
    setTextScope: textScope => setTextScope($, textScope),
    openTextSearch: textScope => afterTakingKeyboard(() => openPalette($, 'textSearch', '', textScope)),
    pressResultRow: rowIndex => afterTakingKeyboard(() => pressResultRow($, rowIndex)),
    openResultRow: rowIndex => afterTakingKeyboard(() => openResultRow($, rowIndex)),
    openPeekedRow: () => afterTakingKeyboard(() => openPeekedRow($)),
    closePeek: async () => {
      await update($, isPeekShownAtom, () => false)
    },
    activateTab: tabIndex => afterTakingKeyboard(() => activateTab($, tabIndex)),
    closeTab: tabIndex => afterTakingKeyboard(() => closeTabs($, 'active', tabIndex)),
    openTreeRow: (path, isDirectory) => afterTakingKeyboard(() => openTreeRow($, path, isDirectory)),
    collapseTree: () => afterTakingKeyboard(() => collapseTree($)),
    toggleFilesDrawer: () => afterTakingKeyboard(() => toggleDrawer($, 'files')),
    pinFiles: isPinned => afterTakingKeyboard(() => pinColumn($, 'files', isPinned)),
    toggleTabsDrawer: () => afterTakingKeyboard(() => toggleDrawer($, 'tabs')),
    pinTabs: isPinned => afterTakingKeyboard(() => pinColumn($, 'tabs', isPinned)),
    updateFilesFilter: query => updateFilesFilter($, query),
    submitFilesFilter: query => submitFilesFilter($, query),
    openFilesFilterItem: itemIndex => afterTakingKeyboard(() => openFilesFilterItem($, itemIndex)),
    dismissNotice: () => clearNotice($),
    setSelectionAside: () => setSelectionAside($),
    toggleBookmark: line => afterTakingKeyboard(() => toggleBookmark($, line)),
    removeBookmarkOfRow: rowIndex => afterTakingKeyboard(() => removeBookmarkOfRow($, rowIndex)),
    listBookmarks: () => afterTakingKeyboard(() => listBookmarks($)),
    scrollCodeSideways: side => afterTakingKeyboard(() => scrollCodeSideways($, side)),
    goToLine: () => afterTakingKeyboard(() => openPalette($, 'everything', ':')),
    dismissInlineNote: () => clearInlineNote($),
  }
}

// --- Opening the pane, for the person and for Claude --------------------------------------------------------------------

async function openPane($: EngineInterface, isKeyboardTaken: boolean): Promise<{ isPlaced: boolean; reason?: string }> {
  const requestedPaneColumns = await read($, requestedPaneColumnsAtom)

  return $.ui.open({
    id: PANE_ID,
    title: PANE_TITLE,
    closeOnEscape: true,
    ...(isKeyboardTaken ? { focus: true as const } : {}),
    ...(requestedPaneColumns > 0 ? { columns: requestedPaneColumns } : {}),
  })
}

type ShownOutcome = { isShown: boolean; description: string }

function declarationsWritten(projectWorkspace: EngineWorkspace, writtenSymbol: string): SymbolEntry[] {
  const { containerName, name } = writtenSymbolOf(writtenSymbol)
  const isInContainer = (symbol: SymbolEntry) => containerName === null || symbol.container?.toLowerCase() === containerName.toLowerCase()
  const exactlyNamed = projectWorkspace.symbolsNamed(name).filter(isInContainer)
  if (exactlyNamed.length > 0) {
    return exactlyNamed
  }
  const lowerCaseName = name.toLowerCase()

  return projectWorkspace.symbols().filter(symbol => symbol.name.toLowerCase() === lowerCaseName && isInContainer(symbol))
}

async function showWrittenSymbol($: EngineInterface, projectWorkspace: EngineWorkspace, writtenSymbol: string): Promise<ShownOutcome> {
  const declarations = declarationsWritten(projectWorkspace, writtenSymbol)
  const classLikeDeclarations = declarations.filter(symbol => isClassLikeKind(symbol.kind))
  const preferredDeclarations = classLikeDeclarations.length > 0 && writtenSymbolOf(writtenSymbol).containerName === null ? classLikeDeclarations : declarations
  const [firstDeclaration] = preferredDeclarations
  if (firstDeclaration === undefined) {
    const suggestions = paletteSource === null ? [] : searchPalette(writtenSymbol, paletteSource, { recentPaths: [], currentPath: null }, 5)
    const [firstSuggestion] = suggestions
    if (firstSuggestion === undefined) {
      return { isShown: false, description: `No declaration named ${writtenSymbol} was found in the project, and nothing close to it.` }
    }

    return {
      isShown: false,
      description: `No declaration is named exactly ${writtenSymbol}. Closest names: ${suggestions.map(item => `${item.label} (${item.path}:${item.line})`).join(', ')}.`,
    }
  }
  await showPlace($, { path: firstDeclaration.path, line: firstDeclaration.line, name: firstDeclaration.name }, true)
  if (preferredDeclarations.length === 1) {
    return { isShown: true, description: `${labelOfSymbol(firstDeclaration)} at ${firstDeclaration.path}:${firstDeclaration.line}` }
  }
  await openResultsPanel($, {
    kind: 'definitions',
    title: writtenSymbol,
    rows: preferredDeclarations.slice(0, 200).map(symbol => ({
      path: symbol.path,
      line: symbol.line,
      column: 0,
      matchLength: 0,
      label: labelOfSymbol(symbol),
      preview: symbol.kind,
      mark: 'candidate',
      isDependency: false,
    })),
    selectedIndex: 0,
    isTruncated: preferredDeclarations.length > 200,
  })

  return {
    isShown: true,
    description: `${labelOfSymbol(firstDeclaration)} at ${firstDeclaration.path}:${firstDeclaration.line}, the first of ${preferredDeclarations.length} declarations of that name, all listed under the code`,
  }
}

async function showWrittenPath($: EngineInterface, projectWorkspace: EngineWorkspace, writtenPath: string, line: number | null): Promise<ShownOutcome> {
  const place = writtenPlaceOf(writtenPath)
  const path = pathFromRoot(projectWorkspace.root, place.path)
  if (path === null || path === '') {
    return { isShown: false, description: `${writtenPath} is outside the project (${projectWorkspace.root}).` }
  }
  const shownLine = line ?? place.line ?? 1
  if (await showPlace($, { path, line: shownLine }, true)) {
    return { isShown: true, description: `${path}${line ?? place.line ? ` line ${shownLine}` : ''}` }
  }
  const sameEnding = projectWorkspace.files().filter(file => file.endsWith(`/${path}`))
  const [onlyFile] = sameEnding
  if (sameEnding.length === 1 && onlyFile !== undefined && (await showPlace($, { path: onlyFile, line: shownLine }, true))) {
    return { isShown: true, description: `${onlyFile}${line ?? place.line ? ` line ${shownLine}` : ''}` }
  }

  return { isShown: false, description: `${path} does not exist in the project${sameEnding.length > 1 ? `; ${sameEnding.length} files end like it: ${sameEnding.slice(0, 5).join(', ')}` : ''}.` }
}

type ShowRequest = { path: string | null; line: number | null; symbol: string | null }

async function showRequested($: EngineInterface, request: ShowRequest, isKeyboardTaken: boolean): Promise<ShownOutcome> {
  const projectWorkspace = await ensureWorkspace($)
  if (request.symbol !== null || projectWorkspace.index().builtAt === 0) {
    await refreshIndex($, false)
  }
  let outcome: ShownOutcome
  if (request.path !== null) {
    outcome = await showWrittenPath($, projectWorkspace, request.path, request.line)
  } else if (request.symbol !== null) {
    outcome = await showWrittenSymbol($, projectWorkspace, request.symbol)
  } else {
    outcome = { isShown: true, description: 'the code pane' }
  }
  if (outcome.isShown) {
    await clearNotice($)
    const opened = await openPane($, isKeyboardTaken)
    if (!opened.isPlaced) {
      return { isShown: false, description: `${outcome.description} is ready, but the pane could not be placed: ${opened.reason ?? 'no room'}` }
    }
  }

  return outcome
}

// What follows /code-nav: nothing, a file with or without its line, or a name looked for among the declarations.
async function showCommandArguments($: EngineInterface, commandArguments: string): Promise<string> {
  const written = commandArguments.trim()
  if (written === '') {
    const opened = await openPane($, true)
    await ensureWorkspace($)
    void refreshIndex($, false)
    if ((await read($, currentPathAtom)) === null) {
      await openPalette($, 'everything')
    }

    return opened.isPlaced ? 'Code pane opened.' : `Code pane waiting: ${opened.reason ?? 'no room'}`
  }
  const projectWorkspace = await ensureWorkspace($)
  await refreshIndex($, false)
  const place = writtenPlaceOf(written)
  const path = pathFromRoot(projectWorkspace.root, place.path)
  const isFileOfProject = path !== null && (projectWorkspace.index().fileSet.has(path) || (await projectWorkspace.readFile(path)) !== null)
  const outcome = isFileOfProject
    ? await showRequested($, { path: written, line: null, symbol: null }, true)
    : await showRequested($, { path: null, line: null, symbol: written }, true)
  if (outcome.isShown) {
    return `Showing ${outcome.description}.`
  }
  await openPane($, true)
  await openPalette($, 'everything', written)

  return outcome.description
}

async function readThemes($: EngineInterface): Promise<void> {
  const rows = await $.config.list().catch(() => [])
  const claudeCodeThemeRow = rows.find(row => row.key === 'theme')
  await update($, claudeCodeThemeAtom, () => (typeof claudeCodeThemeRow?.value === 'string' ? claudeCodeThemeRow.value : null))
  const configuredThemeRow = rows.find(row => row.key === CONFIGURED_THEME_KEY)
  await update($, configuredThemeAtom, () => (typeof configuredThemeRow?.value === 'string' ? configuredThemeRow.value : null))
}

async function detectKeyboardLayout($: EngineInterface): Promise<KeyboardLayout> {
  for (const layoutSource of KEYBOARD_LAYOUT_SOURCES) {
    const keyboardLayout = await $.process
      .run(layoutSource.argv, { timeoutMs: KEYBOARD_LAYOUT_TIMEOUT_MS })
      .then(result => (result.exitCode === 0 ? keyboardLayoutOf(result.stdout, layoutSource.layoutPattern) : null))
      .catch(() => null)
    if (keyboardLayout !== null) {
      return keyboardLayout
    }
  }

  return 'unknown'
}

async function currentPeek($: EngineInterface): Promise<PeekSnapshot | null> {
  await read($, peekRevisionAtom)
  const resultsPanel = await read($, resultsPanelAtom)
  const row = resultsPanel?.selectedIndex === null || resultsPanel === null ? undefined : resultsPanel.rows[resultsPanel.selectedIndex]
  if (!(await read($, isPeekShownAtom)) || row === undefined) {
    return null
  }
  const file = shownFile?.path === row.path ? shownFile : (peekedFiles.get(row.path) ?? null)
  if (file === null && !isPeekLoadScheduled) {
    // A drawing may not write: the file a reload of the mod forgot is read right after it.
    isPeekLoadScheduled = true
    void $.clock.after(0, async () => {
      try {
        await loadPeekedFile($, row.path)
      } finally {
        isPeekLoadScheduled = false
      }
    })
  }

  return { path: row.path, line: row.line, column: row.column, matchLength: row.matchLength, scrolledLines: await read($, peekScrolledLinesAtom), file }
}

const declaredNamesByLineOfFile = new WeakMap<ShownFile, ReadonlyMap<number, ReadonlySet<string>>>()

// Read once per text of a file: a new text is a new object.
function declaredNamesByLineOf(file: ShownFile): ReadonlyMap<number, ReadonlySet<string>> {
  const known = declaredNamesByLineOfFile.get(file)
  if (known !== undefined) {
    return known
  }
  const namesByLine = new Map<number, Set<string>>()
  for (const symbol of cachedSymbolsOf(file)) {
    namesByLine.set(symbol.line, (namesByLine.get(symbol.line) ?? new Set()).add(symbol.name))
  }
  declaredNamesByLineOfFile.set(file, namesByLine)

  return namesByLine
}

function bookmarkedLinesOf(bookmarks: readonly Bookmark[], file: ShownFile | null): ReadonlySet<number> {
  return new Set(file === null ? [] : bookmarks.filter(bookmark => bookmark.path === file.path).map(bookmark => bookmark.line))
}

async function readPaneSnapshot($: EngineInterface): Promise<PaneSnapshot> {
  const currentPath = await read($, currentPathAtom)
  await read($, fileRevisionAtom)
  const file = shownFile !== null && shownFile.path === currentPath ? shownFile : null
  const palette = await read($, paletteAtom)
  const bookmarks = await read($, bookmarksAtom)

  return {
    file,
    declaredNamesByLine: file === null ? new Map() : declaredNamesByLineOf(file),
    currentPath,
    isDependencyFile: file !== null && workspace !== null && workspace.index().builtAt > 0 && !workspace.index().fileSet.has(file.path),
    topLine: await read($, topLineAtom),
    markedSymbol: await read($, markedSymbolAtom),
    history: await read($, historyAtom),
    tabs: await read($, tabsAtom),
    tabsMode: await read($, tabsModeAtom),
    tabsDrawerOpenness: await read($, tabsDrawerOpennessAtom),
    explorerMode: await read($, explorerModeAtom),
    drawerOpenness: await read($, drawerOpennessAtom),
    preferredSidebarWidth: await read($, sidebarWidthAtom),
    preferredExplorerWidth: await read($, explorerWidthAtom),
    treeRows: await currentTreeRows($),
    treeOffset: await read($, treeOffsetAtom),
    filesFilter: await read($, filesFilterAtom),
    palette,
    paletteItems: palette?.items ?? [],
    resultsPanel: await read($, resultsPanelAtom),
    peek: await currentPeek($),
    notice: await read($, noticeAtom),
    inlineNote: await read($, inlineNoteAtom),
    selectedLines: await read($, selectedLinesAtom),
    scrolledColumns: await read($, scrolledColumnsAtom),
    bookmarkedLines: bookmarkedLinesOf(bookmarks, file),
    bookmarkCount: bookmarks.length,
    breadcrumb: file === null ? [] : breadcrumbOf(file, await lineReadNow($)),
    isHelpShown: await read($, isHelpShownAtom),
    isIndexing: await read($, isIndexingAtom),
    indexSummary: await read($, indexSummaryAtom),
  }
}

const TOOLS_CHANGING_FILES = ['Edit', 'Write', 'NotebookEdit', 'Bash']
const TOOLS_NAMING_A_FILE = ['Read', 'Edit', 'Write', 'NotebookEdit']

const SHOW_TOOL_DESCRIPTION = [
  'Shows code to the user in the code navigation pane beside the conversation, where they read it and navigate it themselves',
  '(go to definition, usages, implementations). Give a file path, with a line when a precise place matters, or the name of',
  'a class, function or method (such as OrderRepository or OrderRepository::save) to open its declaration.',
  'Use it whenever the user asks to see, show, open or look at a file, a class, a function or a method, or wants to check',
  'with their own eyes some code you mentioned. It is read-only and changes nothing; it does not return the code to you.',
].join(' ')

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await readThemes($)
    const keyboardLayout = await detectKeyboardLayout($)
    await update($, keyboardLayoutAtom, () => keyboardLayout)
    $.clock.every(CURRENT_FILE_POLL_MS, () => reloadShownFileWhenChanged($))
    $.clock.every(SELECTION_POLL_MS, () => followSelectedLines($))
    const savedTabsMode = await $.store.get(TABS_MODE_STORE_KEY).catch(() => undefined)
    if (savedTabsMode === 'drawer' || savedTabsMode === 'pinned') {
      await update($, tabsModeAtom, () => savedTabsMode)
    }
    const savedColumnMode = await $.store.get(EXPLORER_MODE_STORE_KEY).catch(() => undefined)
    if (savedColumnMode === 'drawer' || savedColumnMode === 'pinned') {
      await update($, explorerModeAtom, () => savedColumnMode)
    }
    const savedExplorerWidth = await $.store.get(EXPLORER_WIDTH_STORE_KEY).catch(() => undefined)
    if (typeof savedExplorerWidth === 'number' && savedExplorerWidth >= SIDEBAR_MIN_WIDTH) {
      await update($, explorerWidthAtom, () => Math.round(savedExplorerWidth))
    }
    const savedSidebarWidth = await $.store.get(SIDEBAR_WIDTH_STORE_KEY).catch(() => undefined)
    if (typeof savedSidebarWidth === 'number' && savedSidebarWidth >= SIDEBAR_MIN_WIDTH) {
      await update($, sidebarWidthAtom, () => Math.round(savedSidebarWidth))
    }
    await $.command.register({
      name: COMMAND_NAME,
      description: 'Open the code navigation pane, on a file (path or path:line) or on a class or method name',
      argumentHint: '[path[:line] | name]',
    })
    await $.tool.register({
      name: SHOW_TOOL_NAME,
      description: SHOW_TOOL_DESCRIPTION,
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'A file path, relative to the project root or absolute. "src/Order.php:42" is read as line 42.' },
          line: { type: 'integer', description: 'The line to show, from 1.' },
          symbol: { type: 'string', description: 'A class, function or method name: "OrderRepository", "OrderRepository::save", "save".' },
        },
      },
    })

    return next(e)
  })

  // The lines selected in the pane go with the person's own message, seen by Claude and not shown in the conversation.
  on('prompt.submit', async ($, e, next) => {
    const file = shownFile
    if (e.command !== undefined || e.isMeta === true || file === null) {
      return next(e)
    }
    const selectedPlace = await selectedPlaceNow($)
    if (selectedPlace === null) {
      return next(e)
    }
    await update($, selectedLinesAtom, () => null)

    return next({ ...e, context: [...(e.context ?? []), selectionContextOf(selectedPlace, file.lines)] })
  })

  on('prompt.edit', async ($, e, next) => {
    const edited = await next(e)
    const ownDecorations = selectionDecorationsOf(await read($, selectedLinesAtom), edited.text)
    isSelectionMarkedInPrompt = ownDecorations.length > 0
    if (ownDecorations.length === 0) {
      return edited
    }

    return { ...edited, decorations: [...(edited.decorations ?? []), ...ownDecorations] }
  })

  // A recalled entry, a clear or a fill changes the draft without an edit.
  on('prompt.change', async ($, e, next) => {
    const result = await next(e)
    void $.clock.after(0, () => markSelectionInPrompt($))

    return result
  })

  on('config.set', async ($, e, next) => {
    const result = await next(e)
    if (e.key === 'theme' || e.key === CONFIGURED_THEME_KEY) {
      await readThemes($)
    }

    return result
  })

  on('command.run', { command: COMMAND_NAME }, async ($, e) => {
    await readThemes($)
    const requestedPaneColumns = Math.round(e.presentation.columns * PANE_SHARE_OF_TERMINAL)
    await update($, requestedPaneColumnsAtom, () => requestedPaneColumns)

    return { text: await showCommandArguments($, e.args) }
  })

  on('tool.call', { tool: SHOW_TOOL_FULL_NAME }, async ($, e) => {
    const input = e as { path?: unknown; line?: unknown; symbol?: unknown }
    const request: ShowRequest = {
      path: typeof input.path === 'string' && input.path.trim() !== '' ? input.path : null,
      line: typeof input.line === 'number' && Number.isFinite(input.line) ? Math.max(1, Math.round(input.line)) : null,
      symbol: typeof input.symbol === 'string' && input.symbol.trim() !== '' ? input.symbol : null,
    }
    if (request.path === null && request.symbol === null) {
      return { deny: 'Give a path or a symbol to show.' }
    }
    const outcome = await showRequested($, request, false)

    return { result: outcome.isShown ? `Shown to the user in the code pane: ${outcome.description}.` : `Nothing was shown: ${outcome.description}` }
  })

  // Claude reading or changing a file makes it one the person may want to see; a change may also touch the file shown
  // and the project's declarations.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    const toolName = String(e.tool)
    if (toolName === SHOW_TOOL_FULL_NAME) {
      return result
    }
    const namedPath = (e as { file_path?: unknown }).file_path
    if (TOOLS_NAMING_A_FILE.includes(toolName) && typeof namedPath === 'string' && workspace !== null) {
      const path = pathFromRoot(workspace.root, namedPath)
      if (path !== null) {
        await update($, touchedPathsAtom, touchedPaths => [path, ...touchedPaths.filter(touchedPath => touchedPath !== path)].slice(0, RECENT_PATH_LIMIT))
      }
    }
    if (TOOLS_CHANGING_FILES.includes(toolName) && workspace !== null && (await isPaneOpen($))) {
      await reloadShownFileWhenChanged($)
      refreshIndexSoon($)
    }

    return result
  })

  // The wheel moves the list under the code when the pointer is over it and the code everywhere else; the page keys
  // move the code by a page.
  on('ui.scroll', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const { pointer } = e
    const isOverTree = pointer !== undefined && pointer.column >= lastDrawnLayout.treeFirstColumn && pointer.column <= lastDrawnLayout.treeLastColumn
    if (isOverTree) {
      const lastOffset = Math.max(0, lastDrawnLayout.treeRowCount - lastDrawnLayout.treeVisibleRows)
      await update($, treeOffsetAtom, offset => Math.max(0, Math.min(lastOffset, Math.min(offset, lastOffset) + e.by * WHEEL_TICK_LINES)))
      return {}
    }
    const isOverPeek = pointer !== undefined && pointer.row > lastDrawnLayout.peekTop && pointer.row <= lastDrawnLayout.resultsTop && (await read($, isPeekShownAtom))
    if (isOverPeek) {
      const { lowest, highest } = lastDrawnLayout.peekScrolledLinesRange
      await update($, peekScrolledLinesAtom, scrolledLines => Math.max(lowest, Math.min(highest, scrolledLines + e.by * WHEEL_TICK_LINES)))
      return {}
    }
    const resultsPanel = await read($, resultsPanelAtom)
    const isOverResults = pointer !== undefined && resultsPanel !== null && pointer.row > lastDrawnLayout.resultsTop
    if (isOverResults) {
      const lastFirstIndex = Math.max(0, resultsPanel.rows.length - lastDrawnLayout.resultsRows)
      await update($, resultsPanelAtom, current =>
        current === null ? null : { ...current, selectedIndex: null, firstShownIndex: Math.max(0, Math.min(lastFirstIndex, current.firstShownIndex + e.by * WHEEL_TICK_LINES)) },
      )
      return {}
    }
    const pageLines = Math.max(1, lastDrawnLayout.codeRows - 2)
    await scrollCodeBy($, pointer !== undefined ? e.by * WHEEL_TICK_LINES : Math.sign(e.by) * Math.min(Math.abs(e.by), pageLines))

    return {}
  })

  // In the find field the arrows leave for the hidden buttons before and after it: the selected row moves instead,
  // and the keyboard stays in the field.
  on('ui.focus', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    const isFilesFilterArrow = e.element === FILES_FILTER_NEXT_KEY || e.element === FILES_FILTER_PREVIOUS_KEY
    if (isFilesFilterArrow && e.origin.kind === 'person') {
      const filesFilter = await read($, filesFilterAtom)
      await moveFilesFilterSelection($, e.element === FILES_FILTER_NEXT_KEY ? 1 : -1)

      return next({ ...e, element: filesFilterFieldKey(filesFilter.fieldNumber) })
    }
    const palette = await read($, paletteAtom)
    if (palette === null || e.origin.kind !== 'person' || (e.element !== PALETTE_NEXT_KEY && e.element !== PALETTE_PREVIOUS_KEY)) {
      return next(e)
    }
    if (palette.mode === 'textSearch') {
      await setTextScope($, e.element === PALETTE_NEXT_KEY ? 'project' : 'file')
    } else {
      await movePaletteSelection($, e.element === PALETTE_NEXT_KEY ? 1 : -1)
    }

    return next({ ...e, element: paletteFieldKey(palette.fieldNumber) })
  })

  // Escape first closes what is open over the code, the note about a name, the files, the palette then the help; only
// then the pane.
  on('ui.close', async ($, e, next) => {
    if (e.id !== PANE_ID || e.origin.kind !== 'person') {
      return next(e)
    }
    if ((await read($, inlineNoteAtom)) !== null) {
      await clearInlineNote($)
      takeKeyboardBack($)
      return { value: undefined }
    }
    const areFilesShown = (await columnModeOf($, 'files')) === 'pinned' || (await isDrawerOpen($, 'files'))
    if (areFilesShown && (await read($, filesFilterAtom)).query !== '' && (await read($, paletteAtom)) === null) {
      await resetFilesFilter($)
      takeKeyboardBack($)
      return { value: undefined }
    }
    const openDrawerSide = (await isDrawerOpen($, 'files')) ? 'files' : (await isDrawerOpen($, 'tabs')) ? 'tabs' : null
    if (openDrawerSide !== null) {
      slideDrawer($, openDrawerSide, false)
      takeKeyboardBack($)
      return { value: undefined }
    }
    if ((await read($, paletteAtom)) !== null) {
      await closePalette($)
      takeKeyboardBack($)
      return { value: undefined }
    }
    if (await read($, isHelpShownAtom)) {
      await update($, isHelpShownAtom, () => false)
      takeKeyboardBack($)
      return { value: undefined }
    }
    if ((await currentPeek($)) !== null) {
      await update($, isPeekShownAtom, () => false)
      takeKeyboardBack($)
      return { value: undefined }
    }

    return next(e)
  })

  // The divider reports the drag once the button comes up: the side column takes its new width then, kept for later.
  on('ui.message', { element: SIDEBAR_DIVIDER_KEY }, async ($, e, next) => {
    const message = e.data as { phase?: string; movedColumns?: number }
    if (message.phase === 'start') {
      lastDrawnLayout.sidebarWidthAtDragStart = lastDrawnLayout.sidebarWidth
    } else if (message.phase === 'end' && typeof message.movedColumns === 'number') {
      const draggedWidth = lastDrawnLayout.sidebarWidthAtDragStart + message.movedColumns
      const { sidebarWidth } = columnWidthsOf('pinned', await read($, explorerModeAtom), draggedWidth, lastDrawnLayout.explorerWidth, lastDrawnLayout.bodyColumns)
      await update($, sidebarWidthAtom, () => Math.max(SIDEBAR_MIN_WIDTH, sidebarWidth))
      await $.store.set(SIDEBAR_WIDTH_STORE_KEY, Math.max(SIDEBAR_MIN_WIDTH, sidebarWidth)).catch(() => undefined)
    }

    return next(e)
  })

  // The divider left of the files widens them when dragged to the left.
  on('ui.message', { element: EXPLORER_DIVIDER_KEY }, async ($, e, next) => {
    const message = e.data as { phase?: string; movedColumns?: number }
    if (message.phase === 'start') {
      lastDrawnLayout.explorerWidthAtDragStart = lastDrawnLayout.explorerWidth
    } else if (message.phase === 'end' && typeof message.movedColumns === 'number') {
      const draggedWidth = lastDrawnLayout.explorerWidthAtDragStart - message.movedColumns
      const { explorerWidth } = columnWidthsOf(lastDrawnLayout.sidebarWidth > 0 ? 'pinned' : 'drawer', 'pinned', lastDrawnLayout.sidebarWidth, draggedWidth, lastDrawnLayout.bodyColumns)
      await update($, explorerWidthAtom, () => Math.max(SIDEBAR_MIN_WIDTH, explorerWidth))
      await $.store.set(EXPLORER_WIDTH_STORE_KEY, Math.max(SIDEBAR_MIN_WIDTH, explorerWidth)).catch(() => undefined)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>The code pane needs the terminal.</Text>
    }
    const elements = $.ui.resolve(e)
    const ui: ViewElements = {
      ...elements,
      theme: themeOf((await read($, configuredThemeAtom)) ?? options.theme, await read($, claudeCodeThemeAtom)),
    }
    if (e.props.bodyColumns < MIN_PANE_COLUMNS) {
      return renderNarrowPane(ui, e.props.bodyColumns)
    }
    const snapshot = await readPaneSnapshot($)
    const model = buildPaneModel(snapshot, {
      bodyRows: e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 40,
      bodyColumns: e.props.bodyColumns,
    })
    const shownTree = model.explorerTree
    const treeFirstColumn = model.geometry.explorerWidth > 0 ? model.geometry.bodyColumns - model.geometry.explorerWidth : model.geometry.drawerLeft
    Object.assign(lastDrawnLayout, {
      isPaneFocused: e.props.isFocused,
      codeRows: model.geometry.codeRows,
      codeColumns: model.geometry.codeColumns,
      scrolledColumns: model.scrolledColumns,
      resultsTop: model.geometry.resultsTop,
      resultsRows: model.geometry.resultsRows,
      bodyColumns: model.geometry.bodyColumns,
      sidebarWidth: model.geometry.sidebarWidth,
      explorerWidth: model.geometry.explorerWidth,
      treeFirstColumn,
      treeLastColumn: shownTree === null ? -1 : model.geometry.bodyColumns - 1,
      treeRowCount: shownTree?.rowCount ?? 0,
      treeVisibleRows: shownTree?.visibleRows ?? 20,
      peekTop: model.geometry.codeTop + model.geometry.codeRows,
      peekScrolledLinesRange: model.peek?.scrolledLinesRange ?? { lowest: 0, highest: 0 },
    })
    const revealedRowIndex = pathToReveal === null || shownTree === null ? -1 : snapshot.treeRows.findIndex(row => row.path === pathToReveal)
    if (revealedRowIndex !== -1 && shownTree !== null) {
      const revealedOffset = treeOffsetShowing(revealedRowIndex, shownTree.firstRowIndex, shownTree.visibleRows, shownTree.rowCount)
      pathToReveal = null
      if (revealedOffset !== snapshot.treeOffset) {
        void $.clock.after(0, async () => {
          await update($, treeOffsetAtom, () => revealedOffset)
        })
      }
    }
    if (model.isFileLoading && !isShownFileReloadScheduled) {
      // A drawing may not write: the file a reload of the mod forgot is read right after it.
      isShownFileReloadScheduled = true
      void $.clock.after(0, async () => {
        try {
          await ensureWorkspace($)
          await reloadShownFileWhenChanged($)
        } finally {
          isShownFileReloadScheduled = false
        }
      })
    }
    const keymap = keymapOf(await read($, keyboardLayoutAtom))

    return renderPane(ui, { model, hotkeysOf: action => keymap[action], actions: paneActions($) })
  })
}
