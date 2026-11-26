import { expect, test } from 'claude-code/testing'

import type { TabsState } from '../types'
import { MAX_OPEN_TABS } from './constants'
import { NO_TABS, restoredTabsOf, savedTabsOf, tabLabelsOf, tabsAfterActivating, tabsAfterClosing, tabsAfterOpening, tabStripOf, tabWidthOf } from './tabs'

const AT_TOP = { topLine: 1, markedSymbol: null }

function opened(paths: readonly string[]): TabsState {
  return paths.reduce((state, path) => tabsAfterOpening(state, path, AT_TOP, AT_TOP), NO_TABS)
}

const pathsOf = (state: TabsState) => state.tabs.map(tab => tab.path)
const activePathOf = (state: TabsState) => (state.activeIndex === null ? null : state.tabs[state.activeIndex]?.path)

test('a file opens in a new tab right after the active one, and a file already open goes back to its tab', async () => {
  const state = tabsAfterOpening(tabsAfterActivating(opened(['Order.php', 'Invoice.php']), 0, AT_TOP), 'Product.php', AT_TOP, AT_TOP)
  expect(pathsOf(state)).toEqual(['Order.php', 'Product.php', 'Invoice.php'])
  expect(activePathOf(state)).toBe('Product.php')

  const reopened = tabsAfterOpening(state, 'Invoice.php', AT_TOP, { topLine: 40, markedSymbol: null })
  expect(pathsOf(reopened)).toEqual(['Order.php', 'Product.php', 'Invoice.php'])
  expect(activePathOf(reopened)).toBe('Invoice.php')
  expect(reopened.tabs[2]?.topLine).toBe(40)
})

test('the tab left keeps where it was scrolled, and finds it again when activated', async () => {
  const state = tabsAfterOpening(opened(['Order.php']), 'Invoice.php', { topLine: 120, markedSymbol: null }, AT_TOP)
  expect(state.tabs[0]?.topLine).toBe(120)
  const back = tabsAfterActivating(state, 0, { topLine: 33, markedSymbol: null })
  expect(activePathOf(back)).toBe('Order.php')
  expect(back.tabs[1]?.topLine).toBe(33)
})

test('closing the active tab shows its right neighbour, or the left one at the end', async () => {
  const middle = tabsAfterActivating(opened(['A.php', 'B.php', 'C.php']), 1, AT_TOP)
  const afterMiddle = tabsAfterClosing(middle, 'active', AT_TOP)
  expect(pathsOf(afterMiddle)).toEqual(['A.php', 'C.php'])
  expect(activePathOf(afterMiddle)).toBe('C.php')

  const afterLast = tabsAfterClosing(afterMiddle, 'active', AT_TOP)
  expect(pathsOf(afterLast)).toEqual(['A.php'])
  expect(activePathOf(afterLast)).toBe('A.php')
  expect(tabsAfterClosing(afterLast, 'active', AT_TOP)).toEqual(NO_TABS)
})

test('a tab closed by its own mark may be another than the active one, which stays shown', async () => {
  const state = tabsAfterClosing(tabsAfterActivating(opened(['A.php', 'B.php', 'C.php']), 2, AT_TOP), 'active', AT_TOP, 0)
  expect(pathsOf(state)).toEqual(['B.php', 'C.php'])
  expect(activePathOf(state)).toBe('C.php')
})

test('the others, the tabs on the left, on the right, or all of them are closed around the active one', async () => {
  const state = tabsAfterActivating(opened(['A.php', 'B.php', 'C.php', 'D.php']), 1, AT_TOP)
  expect(pathsOf(tabsAfterClosing(state, 'others', AT_TOP))).toEqual(['B.php'])
  expect(pathsOf(tabsAfterClosing(state, 'left', AT_TOP))).toEqual(['B.php', 'C.php', 'D.php'])
  expect(pathsOf(tabsAfterClosing(state, 'right', AT_TOP))).toEqual(['A.php', 'B.php'])
  expect(activePathOf(tabsAfterClosing(state, 'right', AT_TOP))).toBe('B.php')
  expect(tabsAfterClosing(state, 'all', AT_TOP)).toEqual(NO_TABS)
})

test('past the limit of open tabs the oldest one leaves, never the one just opened', async () => {
  const paths = Array.from({ length: MAX_OPEN_TABS + 1 }, (_, index) => `File${index}.php`)
  const state = opened(paths)
  expect(state.tabs).toHaveLength(MAX_OPEN_TABS)
  expect(state.tabs[0]?.path).toBe('File1.php')
  expect(activePathOf(state)).toBe(`File${MAX_OPEN_TABS}.php`)
})

test('a tab is named by its file, and two files of the same name by the directories that tell them apart', async () => {
  expect(tabLabelsOf(['src/Entity/Order.php', 'src/Order/Service/Order.php', 'src/Invoice.php'])).toEqual([
    'Order.php · Entity',
    'Order.php · Service',
    'Invoice.php',
  ])
  expect(tabLabelsOf(['shop/Admin/Order/Show.vue', 'shop/Front/Order/Show.vue'])).toEqual(['Show.vue · Admin/Order', 'Show.vue · Front/Order'])
})

test('tabs too many for the strip show around the active one, the hidden ones counted on each side', async () => {
  const paths = Array.from({ length: 12 }, (_, index) => `Tab${String(index).padStart(2, '0')}.php`)
  const state = tabsAfterActivating(opened(paths), 6, AT_TOP)
  const strip = tabStripOf(state, 4 * tabWidthOf('Tab00.php') + 12)

  expect(strip.shownTabs.map(tab => tab.index)).toEqual([5, 6, 7, 8])
  expect(strip.shownTabs.find(tab => tab.isActive)?.index).toBe(6)
  expect(strip.hiddenBeforeCount).toBe(5)
  expect(strip.hiddenAfterCount).toBe(3)
  expect(tabStripOf(state, 1000).shownTabs).toHaveLength(12)
})

test('the tabs are kept for the next session, each where it was left', async () => {
  const state = tabsAfterOpening(opened(['Order.php', 'Invoice.php']), 'Cart.php', { topLine: 50, markedSymbol: null }, AT_TOP)
  const saved = savedTabsOf(state)
  expect(saved).toEqual({ tabs: [{ path: 'Order.php', topLine: 1 }, { path: 'Invoice.php', topLine: 50 }, { path: 'Cart.php', topLine: 1 }], activePath: 'Cart.php' })

  const restored = restoredTabsOf(JSON.parse(JSON.stringify({ ...saved, activePath: 'Invoice.php' })))
  expect(pathsOf(restored)).toEqual(['Order.php', 'Invoice.php', 'Cart.php'])
  expect(activePathOf(restored)).toBe('Invoice.php')
  expect(restored.tabs[1]?.topLine).toBe(50)
})

test('tabs saved in an unreadable shape are left out', async () => {
  expect(restoredTabsOf(undefined)).toEqual(NO_TABS)
  expect(restoredTabsOf({ tabs: 'Order.php' })).toEqual(NO_TABS)
  expect(pathsOf(restoredTabsOf({ tabs: [{ path: 'Order.php', topLine: -3 }, { path: 42 }, null] }))).toEqual(['Order.php'])
  expect(restoredTabsOf({ tabs: [{ path: 'Order.php', topLine: -3 }] }).tabs[0]?.topLine).toBe(1)
})
