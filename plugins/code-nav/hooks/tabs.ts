import type { MarkedSymbol, OpenTab, TabsState } from '../types'
import { MAX_OPEN_TABS } from './constants'
import { BADGE_COLUMNS } from './file-badge'
import { baseNameOf } from './paths'

// Which tabs a close removes, the active one being the reference for all but "all".
export type TabClosing = 'active' | 'others' | 'left' | 'right' | 'all'

// Where the active tab was scrolled and what it pointed at, kept in the tab when another one takes its place.
export type TabView = { topLine: number; markedSymbol: MarkedSymbol | null }

export const NO_TABS: TabsState = { tabs: [], activeIndex: null }

function withActiveView(state: TabsState, leavingView: TabView | null): OpenTab[] {
  return state.tabs.map((tab, tabIndex) => (tabIndex === state.activeIndex && leavingView !== null ? { ...tab, ...leavingView } : tab))
}

// Past the limit, the tab left the longest ago goes first, never the one being opened.
function withinLimit(tabs: OpenTab[], keptIndex: number): { tabs: OpenTab[]; keptIndex: number } {
  if (tabs.length <= MAX_OPEN_TABS) {
    return { tabs, keptIndex }
  }
  const droppedIndex = keptIndex === 0 ? 1 : 0

  return { tabs: tabs.filter((_, tabIndex) => tabIndex !== droppedIndex), keptIndex: droppedIndex < keptIndex ? keptIndex - 1 : keptIndex }
}

// The file of a tab already open is shown in that tab; otherwise a new tab goes right after the active one.
export function tabsAfterOpening(state: TabsState, path: string, leavingView: TabView | null, landingView: TabView): TabsState {
  const tabs = withActiveView(state, leavingView)
  const existingIndex = tabs.findIndex(tab => tab.path === path)
  if (existingIndex !== -1) {
    return {
      tabs: tabs.map((tab, tabIndex) => (tabIndex === existingIndex ? { ...tab, ...landingView } : tab)),
      activeIndex: existingIndex,
    }
  }
  const openedTab: OpenTab = { path, ...landingView }
  const insertionIndex = state.activeIndex === null ? tabs.length : state.activeIndex + 1
  const limited = withinLimit([...tabs.slice(0, insertionIndex), openedTab, ...tabs.slice(insertionIndex)], insertionIndex)

  return { tabs: limited.tabs, activeIndex: limited.keptIndex }
}

export function tabsAfterActivating(state: TabsState, tabIndex: number, leavingView: TabView | null): TabsState {
  if (tabIndex < 0 || tabIndex >= state.tabs.length) {
    return state
  }

  return { tabs: withActiveView(state, leavingView), activeIndex: tabIndex }
}

function isTabClosed(closing: TabClosing, tabIndex: number, activeIndex: number): boolean {
  const closedOf: Record<TabClosing, () => boolean> = {
    active: () => tabIndex === activeIndex,
    others: () => tabIndex !== activeIndex,
    left: () => tabIndex < activeIndex,
    right: () => tabIndex > activeIndex,
    all: () => true,
  }

  return closedOf[closing]()
}

// Closing the active tab shows its right neighbour, or its left one at the end of the strip, as an editor does.
export function tabsAfterClosing(state: TabsState, closing: TabClosing, leavingView: TabView | null, closedIndex = state.activeIndex): TabsState {
  if (state.activeIndex === null || closedIndex === null) {
    return state
  }
  const tabs = withActiveView(state, leavingView)
  const referenceIndex = closing === 'active' ? closedIndex : state.activeIndex
  const keptTabs = tabs.filter((_, tabIndex) => !isTabClosed(closing, tabIndex, referenceIndex))
  if (keptTabs.length === 0) {
    return NO_TABS
  }
  const activeTab = tabs[state.activeIndex]
  const stillActiveIndex = activeTab === undefined ? -1 : keptTabs.indexOf(activeTab)
  if (stillActiveIndex !== -1) {
    return { tabs: keptTabs, activeIndex: stillActiveIndex }
  }

  return { tabs: keptTabs, activeIndex: Math.min(referenceIndex, keptTabs.length - 1) }
}

export function activeTabOf(state: TabsState): OpenTab | null {
  return state.activeIndex === null ? null : (state.tabs[state.activeIndex] ?? null)
}

// A tab is named by its file. Two files of the same name are told apart by the nearest directories that differ.
export function tabLabelsOf(paths: readonly string[]): string[] {
  return paths.map(path => {
    const baseName = baseNameOf(path)
    const sameNamePaths = paths.filter(otherPath => otherPath !== path && baseNameOf(otherPath) === baseName)
    if (sameNamePaths.length === 0) {
      return baseName
    }
    const directories = path.split('/').slice(0, -1)
    for (let shownDepth = 1; shownDepth <= directories.length; shownDepth += 1) {
      const shownDirectories = directories.slice(-shownDepth).join('/')
      const isTold = sameNamePaths.every(otherPath => !otherPath.slice(0, -baseName.length - 1).endsWith(shownDirectories))
      if (isTold) {
        return `${baseName} · ${shownDirectories}`
      }
    }

    return `${baseName} · ${directories.join('/')}`
  })
}

export type ShownTab = { index: number; path: string; label: string; isActive: boolean }

export type TabStrip = { shownTabs: ShownTab[]; hiddenBeforeCount: number; hiddenAfterCount: number }

// A tab takes its file's tag, its label, a space on each side, its close mark and a separator.
export const TAB_CHROME_COLUMNS = BADGE_COLUMNS + 4
// "‹ 12 " or " 12 ›" when tabs are out of sight on that side.
const HIDDEN_COUNT_COLUMNS = 6

export function tabWidthOf(label: string): number {
  return label.length + TAB_CHROME_COLUMNS
}

// The tabs that fit in the strip, the active one always among them, its neighbours added on both sides in turn.
export function tabStripOf(state: TabsState, columns: number): TabStrip {
  const labels = tabLabelsOf(state.tabs.map(tab => tab.path))
  const shownTab = (index: number): ShownTab => ({
    index,
    path: state.tabs[index]?.path ?? '',
    label: labels[index] ?? '',
    isActive: index === state.activeIndex,
  })
  const totalWidth = labels.reduce((width, label) => width + tabWidthOf(label), 0)
  if (totalWidth <= columns) {
    return { shownTabs: labels.map((_, index) => shownTab(index)), hiddenBeforeCount: 0, hiddenAfterCount: 0 }
  }
  const room = Math.max(0, columns - 2 * HIDDEN_COUNT_COLUMNS)
  const centerIndex = state.activeIndex ?? 0
  let firstIndex = centerIndex
  let lastIndex = centerIndex
  let usedWidth = tabWidthOf(labels[centerIndex] ?? '')
  let isLeftTurn = false
  let isBlockedLeft = false
  let isBlockedRight = false
  while (!isBlockedLeft || !isBlockedRight) {
    const candidateIndex = isLeftTurn ? firstIndex - 1 : lastIndex + 1
    const candidateLabel = labels[candidateIndex]
    const isFitting = candidateLabel !== undefined && usedWidth + tabWidthOf(candidateLabel) <= room
    if (isFitting && isLeftTurn) {
      firstIndex = candidateIndex
    } else if (isFitting) {
      lastIndex = candidateIndex
    } else if (isLeftTurn) {
      isBlockedLeft = true
    } else {
      isBlockedRight = true
    }
    usedWidth += isFitting ? tabWidthOf(candidateLabel) : 0
    isLeftTurn = !isLeftTurn
  }

  return {
    shownTabs: labels.slice(firstIndex, lastIndex + 1).map((_, offset) => shownTab(firstIndex + offset)),
    hiddenBeforeCount: firstIndex,
    hiddenAfterCount: labels.length - 1 - lastIndex,
  }
}

// The tabs kept for the next session: the ones opened for good, each where it was left, and which was shown.
export type SavedTabs = { tabs: Array<{ path: string; topLine: number }>; activePath: string | null }

export function savedTabsOf(state: TabsState): SavedTabs {
  const activeTab = activeTabOf(state)

  return {
    tabs: state.tabs.map(tab => ({ path: tab.path, topLine: tab.topLine })),
    activePath: activeTab?.path ?? null,
  }
}

// What the store holds was written by an earlier version of the mod, or by hand: anything unreadable is left out.
export function restoredTabsOf(saved: unknown): TabsState {
  if (typeof saved !== 'object' || saved === null || !Array.isArray((saved as { tabs?: unknown }).tabs)) {
    return NO_TABS
  }
  const tabs: OpenTab[] = (saved as { tabs: unknown[] }).tabs.flatMap(savedTab => {
    const { path, topLine } = (savedTab ?? {}) as { path?: unknown; topLine?: unknown }

    return typeof path === 'string' && path !== ''
      ? [{ path, topLine: typeof topLine === 'number' && topLine >= 1 ? Math.floor(topLine) : 1, markedSymbol: null }]
      : []
  })
  if (tabs.length === 0) {
    return NO_TABS
  }
  const activePath = (saved as { activePath?: unknown }).activePath
  const activeIndex = tabs.findIndex(tab => tab.path === activePath)

  return { tabs: tabs.slice(0, MAX_OPEN_TABS), activeIndex: Math.min(activeIndex === -1 ? 0 : activeIndex, MAX_OPEN_TABS - 1) }
}
