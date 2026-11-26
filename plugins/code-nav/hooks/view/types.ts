import type { Elements } from 'claude-code'

import type { TextSearchScope } from '../../types'
import type { CutSide } from '../display-row'
import type { ShortcutAction } from '../keymap'
import type { Theme } from './theme'

// The elements a view draws with, and the colors of the pane's theme.
export type ViewElements = Pick<Elements['terminal'], 'Box' | 'Button' | 'Client' | 'Input' | 'Text'> & { theme: Theme }

export type PaneActions = {
  runShortcut: (action: ShortcutAction) => Promise<void>
  activateToken: (lineNumber: number, column: number) => Promise<void>
  markToken: (lineNumber: number, column: number) => Promise<void>
  listParents: (lineNumber: number, column: number) => Promise<void>
  updatePaletteQuery: (query: string) => Promise<void>
  submitPalette: (query: string) => Promise<void>
  openPaletteItem: (itemIndex: number) => Promise<void>
  setTextScope: (textScope: TextSearchScope) => Promise<void>
  openTextSearch: (textScope: TextSearchScope) => Promise<void>
  pressResultRow: (rowIndex: number) => Promise<void>
  openResultRow: (rowIndex: number) => Promise<void>
  openPeekedRow: () => Promise<void>
  closePeek: () => Promise<void>
  activateTab: (tabIndex: number) => Promise<void>
  closeTab: (tabIndex: number) => Promise<void>
  openTreeRow: (path: string, isDirectory: boolean) => Promise<void>
  collapseTree: () => Promise<void>
  toggleFilesDrawer: () => Promise<void>
  pinFiles: (isPinned: boolean) => Promise<void>
  toggleTabsDrawer: () => Promise<void>
  pinTabs: (isPinned: boolean) => Promise<void>
  updateFilesFilter: (query: string) => Promise<void>
  submitFilesFilter: (query: string) => Promise<void>
  openFilesFilterItem: (itemIndex: number) => Promise<void>
  dismissNotice: () => Promise<void>
  dismissInlineNote: () => Promise<void>
  setSelectionAside: () => Promise<void>
  toggleBookmark: (line: number) => Promise<void>
  removeBookmarkOfRow: (rowIndex: number) => Promise<void>
  listBookmarks: () => Promise<void>
  scrollCodeSideways: (side: CutSide) => Promise<void>
  goToLine: () => Promise<void>
}

export type HotkeysOf = (action: ShortcutAction) => readonly string[]
