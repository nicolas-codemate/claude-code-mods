import { expect, test } from 'claude-code/testing'

import { BOOKMARKS_STORE_KEY_PREFIX, PALETTE_NEXT_KEY, PALETTE_PREVIOUS_KEY } from './constants'
import { SHOP_FILES } from './php/shop-project'
import {
  askClaudeToShow,
  firstShownLineNumber,
  lineNumberOf,
  markedLineNumber,
  mountPane,
  openFilesDrawer,
  moveFocusTo,
  paletteFieldKeyOf,
  paletteItemTexts,
  pressPageKey,
  resultRowTexts,
  ROOT,
  runCodeNav,
  shownPath,
  tabTexts,
  treeRowTexts,
  startSession,
  stubWorld,
  clickHintKeyOf,
  tokenKeyOf,
  wheel,
} from './test-support'
import { shortcutButtonKey } from './view/pane'

// Each of these tests loads the whole mod, its analyses included, which a busy machine does slowly.
const WHOLE_MOD_TEST = { timeoutMs: 30_000 }
const CHECKOUT = 'src/Service/Checkout.php'
const ORDER_REPOSITORY = 'src/Repository/OrderRepository.php'

test('the command alone opens the pane on the search, which finds a class by a few letters and opens it', WHOLE_MOD_TEST, async ($, on) => {
  stubWorld(on, SHOP_FILES)
  await startSession($)
  expect(await runCodeNav($)).toBe('Code pane opened.')
  const pane = await mountPane($)

  const fieldKey = await paletteFieldKeyOf(pane)
  expect(fieldKey).not.toBe('')
  await pane.input({ key: fieldKey, text: 'OrRe', kind: 'change' })
  expect((await paletteItemTexts(pane))[0]).toContain('OrderRepository')

  await pane.input({ key: fieldKey, text: 'OrRe' })
  expect(await shownPath(pane, SHOP_FILES)).toBe(ORDER_REPOSITORY)
  expect(await markedLineNumber(pane)).toBe(lineNumberOf(SHOP_FILES, ORDER_REPOSITORY, 'class OrderRepository'))
  expect(await paletteFieldKeyOf(pane)).toBe('')
  await pane.unmount()
})

test('the command opens a file on its line, or the declaration of a name', WHOLE_MOD_TEST, async ($, on) => {
  stubWorld(on, SHOP_FILES)
  await startSession($)

  expect(await runCodeNav($, `${CHECKOUT}:31`)).toBe(`Showing ${CHECKOUT} line 31.`)
  const pane = await mountPane($)
  expect(await shownPath(pane, SHOP_FILES)).toBe(CHECKOUT)
  expect(await markedLineNumber(pane)).toBe(31)

  const findPaidLine = lineNumberOf(SHOP_FILES, ORDER_REPOSITORY, 'function findPaid')
  expect(await runCodeNav($, 'OrderRepository::findPaid')).toBe(`Showing OrderRepository::findPaid at ${ORDER_REPOSITORY}:${findPaidLine}.`)
  expect(await shownPath(pane, SHOP_FILES)).toBe(ORDER_REPOSITORY)
  expect(await markedLineNumber(pane)).toBe(findPaidLine)
  await pane.unmount()
})

test('a click on a name only points at it, the reading staying, and u lists its usages', WHOLE_MOD_TEST, async ($, on) => {
  stubWorld(on, SHOP_FILES)
  await startSession($)
  await runCodeNav($, CHECKOUT)
  const pane = await mountPane($, { bodyRows: 60 })
  const callLine = lineNumberOf(SHOP_FILES, CHECKOUT, '$this->orders->save($order)')
  expect(await pane.find({ key: clickHintKeyOf(SHOP_FILES, CHECKOUT, '$this->orders->save($order)', 'save') })).toBeDefined()

  await pane.press({ key: tokenKeyOf(SHOP_FILES, CHECKOUT, '$this->orders->save($order)', 'save') })
  expect(await shownPath(pane, SHOP_FILES)).toBe(CHECKOUT)
  expect(await markedLineNumber(pane)).toBe(callLine)
  expect(await resultRowTexts(pane)).toEqual([])

  await pane.press({ key: shortcutButtonKey('showUsages', 'u') })
  expect(await pane.find({ type: 'Text', text: /^Usages · OrderRepository::save/ })).toBeDefined()
  await pane.unmount()
})

test('a click on the tag over a call goes to the method called, and back returns to the call', WHOLE_MOD_TEST, async ($, on) => {
  stubWorld(on, SHOP_FILES)
  await startSession($)
  await runCodeNav($, CHECKOUT)
  const pane = await mountPane($, { bodyRows: 60 })

  await pane.press({ key: clickHintKeyOf(SHOP_FILES, CHECKOUT, '$this->orders->save($order)', 'save') })
  expect(await shownPath(pane, SHOP_FILES)).toBe(ORDER_REPOSITORY)
  expect(await markedLineNumber(pane)).toBe(lineNumberOf(SHOP_FILES, ORDER_REPOSITORY, 'function save'))

  await pane.press({ key: shortcutButtonKey('goBack', 'q') })
  expect(await shownPath(pane, SHOP_FILES)).toBe(CHECKOUT)
  await pane.press({ key: shortcutButtonKey('goForward', 'd') })
  expect(await shownPath(pane, SHOP_FILES)).toBe(ORDER_REPOSITORY)
  await pane.unmount()
})

test('a click on a method of a dependency opens it, marked as a dependency', WHOLE_MOD_TEST, async ($, on) => {
  stubWorld(on, SHOP_FILES)
  await startSession($)
  await runCodeNav($, ORDER_REPOSITORY)
  const pane = await mountPane($)

  await pane.press({ key: clickHintKeyOf(SHOP_FILES, ORDER_REPOSITORY, '$this->createQueryBuilder(', 'createQueryBuilder') })
  expect(await shownPath(pane, SHOP_FILES)).toBe('vendor/doctrine/orm/src/EntityRepository.php')
  expect(await pane.find({ type: 'Text', text: ' dependency ' })).toBeDefined()
  await pane.unmount()
})

test('a click on a declaration lists its usages under the code, walked row by row', WHOLE_MOD_TEST, async ($, on) => {
  stubWorld(on, SHOP_FILES)
  await startSession($)
  await runCodeNav($, ORDER_REPOSITORY)
  const pane = await mountPane($)

  await pane.press({ key: clickHintKeyOf(SHOP_FILES, ORDER_REPOSITORY, 'public function save(', 'save') })
  const rows = await resultRowTexts(pane)
  expect(rows.length).toBeGreaterThan(0)
  expect(rows[0]).toContain(`${CHECKOUT}:`)
  expect(await pane.find({ type: 'Text', text: /^Usages · OrderRepository::save/ })).toBeDefined()

  await pane.press({ key: shortcutButtonKey('nextResult', 's') })
  expect(await shownPath(pane, SHOP_FILES)).toBe(ORDER_REPOSITORY)
  expect(await pane.find({ key: 'peek' })).toBeDefined()
  await pane.press({ key: shortcutButtonKey('closeResults', 'x') })
  expect(await pane.find({ key: 'peek' })).toBeUndefined()
  expect(await resultRowTexts(pane)).toEqual([])
  await pane.unmount()
})

test('the implementations of an interface are listed, or opened when there is only one', WHOLE_MOD_TEST, async ($, on) => {
  stubWorld(on, SHOP_FILES)
  await startSession($)
  await runCodeNav($, 'OrderFinder')
  const pane = await mountPane($)

  await pane.press({ key: shortcutButtonKey('showImplementations', 'i') })
  expect(await shownPath(pane, SHOP_FILES)).toBe(ORDER_REPOSITORY)
  expect(await pane.find({ type: 'Text', text: /is the only implementation of OrderFinder/ })).toBeDefined()
  await pane.unmount()
})

test('in the search field the arrows move the selected row and keep the keyboard in the field', WHOLE_MOD_TEST, async ($, on) => {
  const world = stubWorld(on, SHOP_FILES)
  await startSession($)
  await runCodeNav($)
  const pane = await mountPane($)
  const fieldKey = await paletteFieldKeyOf(pane)
  await pane.input({ key: fieldKey, text: 'Order', kind: 'change' })
  const items = await paletteItemTexts(pane)
  expect(items[0]?.startsWith('▸')).toBe(true)

  await moveFocusTo($, PALETTE_NEXT_KEY)
  expect((await paletteItemTexts(pane))[1]?.startsWith('▸')).toBe(true)
  expect(world.focusedKeys.at(-1)).toBe(fieldKey)
  await moveFocusTo($, PALETTE_PREVIOUS_KEY)
  await moveFocusTo($, PALETTE_PREVIOUS_KEY)
  expect((await paletteItemTexts(pane))[0]?.startsWith('▸')).toBe(true)
  await pane.unmount()
})

test('a text is searched in the file shown as it is typed, the matches counted and lit, Enter going to the first and listing them', WHOLE_MOD_TEST, async ($, on) => {
  stubWorld(on, SHOP_FILES)
  await startSession($)
  await runCodeNav($, CHECKOUT)
  const pane = await mountPane($, { bodyRows: 30 })

  await pane.press({ key: shortcutButtonKey('searchText', 'g') })
  expect((await pane.find({ key: 'text-scope-file' }))?.text).toBe('◉ in this file (Checkout.php)')
  const fieldKey = await paletteFieldKeyOf(pane)
  await pane.input({ key: fieldKey, text: 'unknown', kind: 'change' })
  const expectedLines = (SHOP_FILES[CHECKOUT] ?? '').split('\n').flatMap((lineText, lineIndex) => (lineText.toLowerCase().includes('unknown') ? [lineIndex + 1] : []))
  const title = `Search · "unknown" in Checkout.php · ${expectedLines.length}`
  expect(expectedLines.length).toBeGreaterThan(1)
  expect(await pane.find({ type: 'Text', text: title })).toBeDefined()
  expect(await resultRowTexts(pane)).toEqual([])

  await moveFocusTo($, PALETTE_NEXT_KEY)
  expect((await pane.find({ key: 'text-scope-project' }))?.text).toBe('◉ in the whole project')
  expect(await pane.find({ type: 'Text', text: title })).toBeUndefined()
  await moveFocusTo($, PALETTE_PREVIOUS_KEY)
  expect(await pane.find({ type: 'Text', text: title })).toBeDefined()

  await pane.input({ key: fieldKey, text: 'unknown' })
  expect(await paletteFieldKeyOf(pane)).toBe('')
  expect(await markedLineNumber(pane)).toBe(expectedLines[0])
  const rows = await resultRowTexts(pane)
  expect(rows).toHaveLength(expectedLines.length)
  expect(rows.every(row => row.includes(`${CHECKOUT}:`))).toBe(true)
  await pane.unmount()
})

test('a text is searched in every file and its lines listed under the code', WHOLE_MOD_TEST, async ($, on) => {
  stubWorld(on, SHOP_FILES)
  await startSession($)
  await runCodeNav($, ORDER_REPOSITORY)
  const pane = await mountPane($)

  await pane.press({ key: shortcutButtonKey('searchText', 'g') })
  await pane.press({ key: 'text-scope-project' })
  await pane.input({ key: await paletteFieldKeyOf(pane), text: 'STATUS_PAID' })
  const rows = await resultRowTexts(pane)
  expect(rows.some(row => row.includes(`${ORDER_REPOSITORY}:${lineNumberOf(SHOP_FILES, ORDER_REPOSITORY, 'STATUS_PAID')}`))).toBe(true)
  expect(rows.some(row => row.includes('src/Entity/Order.php:'))).toBe(true)
  expect(rows.some(row => row.includes('vendor/'))).toBe(false)
  await pane.unmount()
})

test('the menu bar searches the file shown, its previous and next buttons moving the code from match to match', WHOLE_MOD_TEST, async ($, on) => {
  stubWorld(on, SHOP_FILES)
  await startSession($)
  await runCodeNav($, ORDER_REPOSITORY)
  const pane = await mountPane($)
  const matchLines = (SHOP_FILES[ORDER_REPOSITORY] ?? '')
    .split('\n')
    .flatMap((line, lineIndex) => (line.includes('function') ? [lineIndex + 1] : []))
  expect(matchLines.length).toBeGreaterThan(2)

  await pane.press({ key: 'menu-search-in-file' })
  expect(await pane.find({ key: 'text-scope-file' })).toBeDefined()
  await pane.input({ key: await paletteFieldKeyOf(pane), text: 'function' })
  expect(await pane.find({ type: 'Text', text: '"function"' })).toBeDefined()

  await pane.press({ key: 'search-next' })
  const steppedLine = await markedLineNumber(pane)
  const steppedPosition = matchLines.indexOf(steppedLine ?? -1) + 1
  expect(steppedPosition).toBeGreaterThan(0)
  expect(await pane.find({ type: 'Text', text: ` · ${steppedPosition} / ${matchLines.length}  ` })).toBeDefined()
  expect(await shownPath(pane, SHOP_FILES)).toBe(ORDER_REPOSITORY)
  expect(await pane.find({ key: 'peek' })).toBeUndefined()

  await pane.press({ key: 'search-previous' })
  expect(await markedLineNumber(pane)).toBe(matchLines[Math.max(0, steppedPosition - 2)])
  await pane.press({ key: 'search-clear' })
  expect(await pane.find({ key: 'search-status' })).toBeUndefined()
  await pane.unmount()
})

test('the menu bar searches the whole project', WHOLE_MOD_TEST, async ($, on) => {
  stubWorld(on, SHOP_FILES)
  await startSession($)
  await runCodeNav($, ORDER_REPOSITORY)
  const pane = await mountPane($)

  await pane.press({ key: 'menu-search-in-project' })
  await pane.input({ key: await paletteFieldKeyOf(pane), text: 'STATUS_PAID' })
  expect((await resultRowTexts(pane)).some(row => row.includes('src/Entity/Order.php:'))).toBe(true)
  expect(await pane.find({ type: 'Text', text: '"STATUS_PAID"' })).toBeDefined()
  await pane.unmount()
})

test('the structure of the file opens from the menu, nested, on the declaration read, and a row goes to it', WHOLE_MOD_TEST, async ($, on) => {
  stubWorld(on, SHOP_FILES)
  await startSession($)
  const findLatestLine = lineNumberOf(SHOP_FILES, ORDER_REPOSITORY, 'public function findLatest')
  await runCodeNav($, `${ORDER_REPOSITORY}:${findLatestLine + 2}`)
  const pane = await mountPane($)

  await pane.press({ key: 'menu-structure' })
  const items = await paletteItemTexts(pane)
  expect(items.some(item => item.includes('C OrderRepository'))).toBe(true)
  expect(items.some(item => item.includes('m   save'))).toBe(true)
  const selectedItem = items.find(item => item.startsWith('▸'))
  expect(selectedItem).toContain('findLatest')

  await pane.press({ key: 'palette-item-0' })
  expect(await pane.find({ key: 'palette-box' })).toBeUndefined()
  expect(await markedLineNumber(pane)).toBe(lineNumberOf(SHOP_FILES, ORDER_REPOSITORY, 'class OrderRepository'))
  await pane.unmount()
})

test('lines selected with the mouse in the pane go to Claude with the next message, until set aside', WHOLE_MOD_TEST, async ($, on) => {
  const world = stubWorld(on, SHOP_FILES)
  await startSession($)
  await runCodeNav($, CHECKOUT)
  const pane = await mountPane($, { bodyRows: 60 })
  const callLine = lineNumberOf(SHOP_FILES, CHECKOUT, '$this->orders->save($order)')
  const lines = (SHOP_FILES[CHECKOUT] ?? '').split('\n')
  world.selectionText = [callLine - 1, callLine].map(lineNumber => `  ${lineNumber} ${lines[lineNumber - 1]}`).join('\n')
  world.promptText = 'Why'

  await world.clock.advance(1000)
  expect(await pane.find({ type: 'Text', text: `◆ Claude sees lines ${callLine - 1}-${callLine} with your next message ` })).toBeDefined()
  expect(world.promptVirtualTexts.at(-1)).toEqual([`  ◆ Checkout.php:${callLine - 1}-${callLine} → Claude`])
  const submitted = await $.prompt.submit({ text: 'Why is this saved twice?', wait: false, origin: { kind: 'composer' } } as never)
  expect(submitted.context?.[0]).toContain(`lines ${callLine - 1}-${callLine} of ${CHECKOUT}`)
  expect(submitted.context?.[0]).toContain('$this->orders->save($order);')
  expect(await pane.find({ key: 'selection-for-claude' })).toBeUndefined()

  await world.clock.advance(1000)
  await pane.press({ key: 'set-selection-aside' })
  expect(await pane.find({ key: 'selection-for-claude' })).toBeUndefined()
  const submittedAfterwards = await $.prompt.submit({ text: 'And now?', wait: false, origin: { kind: 'composer' } } as never)
  expect(submittedAfterwards.context ?? []).toEqual([])
  world.selectionText = 'The total is computed in save()'
  await world.clock.advance(1000)
  expect(await pane.find({ key: 'selection-for-claude' })).toBeUndefined()
  await pane.unmount()
})

test('the menu goes to a line of the file shown through the search, a colon typed for you', WHOLE_MOD_TEST, async ($, on) => {
  stubWorld(on, SHOP_FILES)
  await startSession($)
  await runCodeNav($, CHECKOUT)
  const pane = await mountPane($)

  await pane.press({ key: 'menu-go-to-line' })
  const fieldKey = await paletteFieldKeyOf(pane)
  expect((await pane.find({ key: fieldKey }))?.props.value).toBe(':')
  await pane.input({ key: fieldKey, text: ':20' })
  expect(await pane.find({ key: 'palette-box' })).toBeUndefined()
  expect(await markedLineNumber(pane)).toBe(20)
  await pane.unmount()
})

test('the header tells which declarations hold the line read, and a click on them opens the structure', WHOLE_MOD_TEST, async ($, on) => {
  stubWorld(on, SHOP_FILES)
  await startSession($)
  await runCodeNav($, `${ORDER_REPOSITORY}:${lineNumberOf(SHOP_FILES, ORDER_REPOSITORY, 'public function findLatest') + 2}`)
  const pane = await mountPane($)

  expect((await pane.find({ key: 'breadcrumb' }))?.text).toContain('OrderRepository › findLatest()')
  await pane.press({ key: 'breadcrumb' })
  expect((await pane.find({ key: await paletteFieldKeyOf(pane) }))?.props.label).toBe('structure')
  await pane.unmount()
})

test('a click on a line number sets a bookmark, listed from the menu and kept for the next session, a second click taking it off', WHOLE_MOD_TEST, async ($, on) => {
  const world = stubWorld(on, SHOP_FILES)
  await startSession($)
  await runCodeNav($, CHECKOUT)
  const pane = await mountPane($, { bodyRows: 60 })
  const callLine = lineNumberOf(SHOP_FILES, CHECKOUT, '$this->orders->save($order)')

  await pane.press({ key: `gutter-${callLine}` })
  expect((await pane.find({ key: `gutter-${callLine}` }))?.text?.startsWith('◆')).toBe(true)
  expect([...world.store.values()].some(value => JSON.stringify(value).includes('$this->orders->save($order);'))).toBe(true)
  await pane.press({ key: 'menu-bookmarks' })
  expect(await pane.find({ type: 'Text', text: /^Bookmarks · / })).toBeDefined()
  expect((await resultRowTexts(pane))[0]).toContain(`${CHECKOUT}:${callLine}`)

  await pane.press({ key: `gutter-${callLine}` })
  expect((await pane.find({ key: `gutter-${callLine}` }))?.text?.startsWith('◆')).toBe(false)
  expect(await resultRowTexts(pane)).toEqual([])
  await pane.unmount()
})

test('a line wider than the pane scrolls sideways from its cut marks, its names staying clickable', WHOLE_MOD_TEST, async ($, on) => {
  const longCall = `        $this->orders->save($order); // ${'a reminder written far too long for any pane '.repeat(6)}`
  const files = { ...SHOP_FILES, 'src/Service/Long.php': `<?php\n\nclass Long\n{\n    public function keep(): void\n    {\n${longCall}\n    }\n}\n` }
  stubWorld(on, files)
  await startSession($)
  await runCodeNav($, 'src/Service/Long.php')
  const pane = await mountPane($, { bodyColumns: 100 })

  await pane.press({ key: 'cut-after-7' })
  expect(await pane.find({ type: 'Text', text: /‹ from column \d+/ })).toBeDefined()
  expect(await pane.find({ key: 'cut-before-7' })).toBeDefined()
  await pane.press({ key: 'cut-before-7' })
  expect(await pane.find({ type: 'Text', text: /‹ from column/ })).toBeUndefined()
  expect(await pane.find({ key: clickHintKeyOf(files, 'src/Service/Long.php', '$this->orders->save(', 'save') })).toBeDefined()
  await pane.unmount()
})

test('the tag over a declaration goes up to what it overrides or implements', WHOLE_MOD_TEST, async ($, on) => {
  stubWorld(on, SHOP_FILES)
  await startSession($)
  await runCodeNav($, ORDER_REPOSITORY)
  const pane = await mountPane($, { bodyRows: 60 })
  const findLatestLine = lineNumberOf(SHOP_FILES, ORDER_REPOSITORY, 'public function findLatest')
  const column = (SHOP_FILES[ORDER_REPOSITORY] ?? '').split('\n')[findLatestLine - 1]?.indexOf('findLatest') ?? -1

  await pane.press({ key: `token-parents-${findLatestLine}-${column}` })
  expect(await shownPath(pane, SHOP_FILES)).toBe('src/Repository/OrderFinder.php')
  expect(await markedLineNumber(pane)).toBe(lineNumberOf(SHOP_FILES, 'src/Repository/OrderFinder.php', 'public function findLatest'))
  await pane.unmount()
})

test('the wheel and the page keys scroll the code, never past the end of the file', WHOLE_MOD_TEST, async ($, on) => {
  stubWorld(on, SHOP_FILES)
  await startSession($)
  await runCodeNav($, CHECKOUT)
  // 20 rows: the header, the menu bar and the bar under the code leave 17 to the code, a page key moving 15 of them.
  const pane = await mountPane($, { bodyRows: 20 })
  const codeRows = 17
  expect(await firstShownLineNumber(pane)).toBe(1)

  await wheel($, 2)
  expect(await firstShownLineNumber(pane)).toBe(7)
  await pressPageKey($, 20)
  expect(await firstShownLineNumber(pane)).toBe(7 + codeRows - 2)
  await pane.press({ key: shortcutButtonKey('goToEnd', 'e') })
  const lineCount = (SHOP_FILES[CHECKOUT] ?? '').split('\n').length - 1
  expect(await firstShownLineNumber(pane)).toBe(lineCount - codeRows + 1)
  await wheel($, 5)
  expect(await firstShownLineNumber(pane)).toBe(lineCount - codeRows + 1)
  await pane.unmount()
})

test('Claude shows a method by its name, the pane opening without taking the keyboard', WHOLE_MOD_TEST, async ($, on) => {
  const world = stubWorld(on, SHOP_FILES)
  await startSession($)
  expect(world.registeredToolNames).toEqual(['show'])

  const saveLine = lineNumberOf(SHOP_FILES, ORDER_REPOSITORY, 'function save')
  expect(await askClaudeToShow($, { symbol: 'OrderRepository::save' })).toBe(
    `Shown to the user in the code pane: OrderRepository::save at ${ORDER_REPOSITORY}:${saveLine}.`,
  )
  expect(world.openedPanes.at(-1)?.focus).toBe(false)
  const pane = await mountPane($, { isFocused: false })
  expect(await shownPath(pane, SHOP_FILES)).toBe(ORDER_REPOSITORY)
  expect(await markedLineNumber(pane)).toBe(saveLine)

  expect(await askClaudeToShow($, { path: `/work/shop/${CHECKOUT}`, line: 40 })).toBe(`Shown to the user in the code pane: ${CHECKOUT} line 40.`)
  expect(await markedLineNumber(pane)).toBe(40)
  expect(await askClaudeToShow($, { symbol: 'NoSuchThingAnywhere' })).toContain('Nothing was shown')
  expect(await askClaudeToShow($, { path: '/etc/passwd' })).toContain('outside the project')
  await pane.unmount()
})

test('a click made while the prompt holds the keyboard takes the keyboard for the pane', WHOLE_MOD_TEST, async ($, on) => {
  const world = stubWorld(on, SHOP_FILES)
  await startSession($)
  await askClaudeToShow($, { path: CHECKOUT })
  const pane = await mountPane($, { isFocused: false, bodyRows: 60 })
  const openingsBeforeClick = world.openedPanes.length

  await pane.press({ key: clickHintKeyOf(SHOP_FILES, CHECKOUT, '$this->orders->save($order)', 'save') })
  expect(world.openedPanes.slice(openingsBeforeClick)).toEqual([{ focus: true, columns: undefined }])
  await pane.unmount()
})

test('the file shown is read again when it changed on disk', WHOLE_MOD_TEST, async ($, on) => {
  const world = stubWorld(on, SHOP_FILES)
  await startSession($)
  await runCodeNav($, 'src/Repository/OrderFinder.php')
  const pane = await mountPane($)
  expect(await pane.find({ type: 'Button', text: 'findLatest' })).toBeDefined()

  world.textByPath['src/Repository/OrderFinder.php'] = (SHOP_FILES['src/Repository/OrderFinder.php'] ?? '').replace('findLatest', 'findNewest')
  world.modifiedAtByPath['src/Repository/OrderFinder.php'] = 2
  await world.clock.advance(2_000)
  expect(await pane.find({ type: 'Button', text: 'findNewest' })).toBeDefined()
  await pane.unmount()
})

test('each file opened gets a tab, a click on a tab shows it again where it was left', WHOLE_MOD_TEST, async ($, on) => {
  stubWorld(on, SHOP_FILES)
  await startSession($)
  await runCodeNav($, CHECKOUT)
  const pane = await mountPane($, { bodyRows: 30 })
  expect(await tabTexts(pane)).toEqual(['Checkout.php *'])
  await wheel($, 3)
  const scrolledTopLine = await firstShownLineNumber(pane)

  await pane.press({ key: clickHintKeyOf(SHOP_FILES, CHECKOUT, '$this->orders->save($order)', 'save') })
  expect(await tabTexts(pane)).toEqual(['Checkout.php', 'OrderRepository.php *'])

  await pane.press({ key: 'tab-0' })
  expect(await shownPath(pane, SHOP_FILES)).toBe(CHECKOUT)
  expect(await firstShownLineNumber(pane)).toBe(scrolledTopLine)
  expect(await tabTexts(pane)).toEqual(['Checkout.php *', 'OrderRepository.php'])
  await pane.press({ key: shortcutButtonKey('nextTab', 'n') })
  expect(await shownPath(pane, SHOP_FILES)).toBe(ORDER_REPOSITORY)
  await pane.press({ key: 'tab-number-1' })
  expect(await shownPath(pane, SHOP_FILES)).toBe(CHECKOUT)
  await pane.unmount()
})

test('walking the usages previews each place above the list, the file read staying, a click on a row previews it, a second or its open button goes in', WHOLE_MOD_TEST, async ($, on) => {
  const files = {
    ...SHOP_FILES,
    'src/Service/Refund.php': '<?php\n\nnamespace Shop\\Service;\n\nuse Shop\\Entity\\Order;\nuse Shop\\Repository\\OrderRepository;\n\nclass Refund\n{\n    public function __construct(private OrderRepository $orders) {}\n\n    public function refund(Order $order): void\n    {\n        $this->orders->save($order);\n    }\n}\n',
  }
  stubWorld(on, files)
  await startSession($)
  await runCodeNav($, ORDER_REPOSITORY)
  const pane = await mountPane($)
  await pane.press({ key: clickHintKeyOf(files, ORDER_REPOSITORY, 'public function save(', 'save') })
  expect((await resultRowTexts(pane)).length).toBeGreaterThan(1)

  await pane.press({ key: shortcutButtonKey('nextResult', 's') })
  expect(await shownPath(pane, files)).toBe(ORDER_REPOSITORY)
  expect(await tabTexts(pane)).toEqual(['OrderRepository.php *'])
  expect(await pane.find({ type: 'Text', text: /^src\/Service\/Checkout\.php:\d+$/ })).toBeDefined()
  await pane.press({ key: shortcutButtonKey('nextResult', 's') })
  const refundLine = lineNumberOf(files, 'src/Service/Refund.php', '$this->orders->save($order)')
  expect(await pane.find({ type: 'Text', text: `src/Service/Refund.php:${refundLine}` })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '$this' })).toBeDefined()

  await pane.press({ key: 'peek-open' })
  expect(await shownPath(pane, files)).toBe('src/Service/Refund.php')
  expect(await markedLineNumber(pane)).toBe(refundLine)
  expect(await pane.find({ key: 'peek' })).toBeUndefined()
  expect(await tabTexts(pane)).toEqual(['OrderRepository.php', 'Refund.php *'])

  await pane.press({ key: 'result-row-0' })
  expect(await shownPath(pane, files)).toBe('src/Service/Refund.php')
  expect(await pane.find({ type: 'Text', text: /^src\/Service\/Checkout\.php:\d+$/ })).toBeDefined()
  await pane.press({ key: 'result-row-0' })
  expect(await pane.find({ key: 'peek' })).toBeUndefined()
  expect(await tabTexts(pane)).toEqual(['OrderRepository.php', 'Refund.php', 'Checkout.php *'])

  await pane.press({ key: 'tab-number-1' })
  await pane.press({ key: 'result-open-1' })
  expect(await pane.find({ key: 'peek' })).toBeUndefined()
  expect(await shownPath(pane, files)).toBe('src/Service/Refund.php')
  expect(await markedLineNumber(pane)).toBe(refundLine)
  await pane.unmount()
})

test('the row under the title of the tabs closes those above or below the tab shown, the others or all of them', WHOLE_MOD_TEST, async ($, on) => {
  stubWorld(on, SHOP_FILES)
  await startSession($)
  for (const path of ['src/Entity/Order.php', 'src/Entity/Invoice.php', 'src/Entity/Product.php', 'src/Entity/Customer.php', 'src/Entity/Money.php']) {
    await runCodeNav($, path)
  }
  const pane = await mountPane($)
  await pane.press({ key: 'tab-number-3' })

  await pane.press({ key: 'tabs-action-closeTabsOnTheRight' })
  expect(await tabTexts(pane)).toEqual(['Order.php', 'Invoice.php', 'Product.php *'])
  await pane.press({ key: 'tabs-action-closeTabsOnTheLeft' })
  expect(await tabTexts(pane)).toEqual(['Product.php *'])
  await runCodeNav($, 'src/Entity/Order.php')
  await pane.press({ key: 'tabs-action-closeOtherTabs' })
  expect(await tabTexts(pane)).toEqual(['Order.php *'])
  await runCodeNav($, 'src/Entity/Invoice.php')
  await pane.press({ key: 'tabs-action-closeAllTabs' })
  expect(await tabTexts(pane)).toEqual([])
  expect(await pane.find({ key: 'tabs-actions' })).toBeUndefined()
  await pane.unmount()
})

test('the active tab, the others, the tabs on the left, on the right or all of them close from their keys', WHOLE_MOD_TEST, async ($, on) => {
  stubWorld(on, SHOP_FILES)
  await startSession($)
  for (const path of ['src/Entity/Order.php', 'src/Entity/Invoice.php', 'src/Entity/Product.php', 'src/Entity/Customer.php', 'src/Entity/Money.php']) {
    await runCodeNav($, path)
  }
  const pane = await mountPane($)
  await pane.press({ key: 'tab-number-3' })
  expect(await tabTexts(pane)).toEqual(['Order.php', 'Invoice.php', 'Product.php *', 'Customer.php', 'Money.php'])

  await pane.press({ key: shortcutButtonKey('closeTab', 'c') })
  expect(await tabTexts(pane)).toEqual(['Order.php', 'Invoice.php', 'Customer.php *', 'Money.php'])
  expect(await shownPath(pane, SHOP_FILES)).toBe('src/Entity/Customer.php')
  await pane.press({ key: shortcutButtonKey('closeTabsOnTheRight', 'o') })
  expect(await tabTexts(pane)).toEqual(['Order.php', 'Invoice.php', 'Customer.php *'])
  await pane.press({ key: shortcutButtonKey('closeTabsOnTheLeft', 'l') })
  expect(await tabTexts(pane)).toEqual(['Customer.php *'])

  await runCodeNav($, 'src/Entity/Order.php')
  await pane.press({ key: shortcutButtonKey('closeOtherTabs', 'b') })
  expect(await tabTexts(pane)).toEqual(['Order.php *'])
  await pane.press({ key: 'close-tab-0' })
  expect(await tabTexts(pane)).toEqual([])
  expect(await shownPath(pane, SHOP_FILES)).toBeUndefined()

  await runCodeNav($, 'src/Entity/Order.php')
  await runCodeNav($, 'src/Entity/Invoice.php')
  await pane.press({ key: shortcutButtonKey('closeAllTabs', 'm') })
  expect(await tabTexts(pane)).toEqual([])
  await pane.unmount()
})

test('the tabs opened for good come back in the next session, the one shown last shown again', WHOLE_MOD_TEST, async ($, on) => {
  const world = stubWorld(on, SHOP_FILES)
  world.store.set('openTabs|/work/shop', {
    tabs: [
      { path: 'src/Entity/Order.php', topLine: 1 },
      { path: CHECKOUT, topLine: 20 },
      { path: 'src/Gone.php', topLine: 1 },
    ],
    activePath: CHECKOUT,
  })
  await startSession($)
  await runCodeNav($)
  const pane = await mountPane($, { bodyRows: 20 })
  await world.clock.advance(1)

  expect(await tabTexts(pane)).toEqual(['Order.php', 'Checkout.php *', 'Gone.php'])
  expect(await shownPath(pane, SHOP_FILES)).toBe(CHECKOUT)
  expect(await firstShownLineNumber(pane)).toBe(20)
  await pane.press({ key: 'tab-2' })
  expect(await tabTexts(pane)).toEqual(['Order.php', 'Checkout.php *'])
  await pane.unmount()
})

test('the explorer lists the whole project, dependencies included, a folder opening with a click', WHOLE_MOD_TEST, async ($, on) => {
  const world = stubWorld(on, SHOP_FILES)
  await startSession($)
  await runCodeNav($)
  const pane = await mountPane($)
  await world.clock.advance(1)
  expect(await treeRowTexts(pane)).toEqual([])
  await openFilesDrawer(pane, world)
  expect(await treeRowTexts(pane)).toEqual(['▸ src/', '▸ vendor/', '• composer.json'])

  await pane.press({ key: 'tree-row-vendor' })
  await pane.press({ key: 'tree-row-vendor/legacy' })
  await pane.press({ key: 'tree-row-vendor/legacy/mailer' })
  expect(await treeRowTexts(pane)).toEqual(['▸ src/', '▾ vendor/', ' ▸ composer/', ' ▸ doctrine/', ' ▾ legacy/', '  ▾ mailer/', '   • Mailer.php', '• composer.json'])
  await pane.press({ key: 'tree-row-vendor/legacy/mailer/Mailer.php' })
  expect(await shownPath(pane, SHOP_FILES)).toBe('vendor/legacy/mailer/Mailer.php')
  expect(await tabTexts(pane)).toEqual(['Mailer.php *'])
  await world.clock.advance(500)
  expect(await treeRowTexts(pane)).toEqual([])

  await openFilesDrawer(pane, world)
  await pane.press({ key: 'tree-row-vendor' })
  expect(await treeRowTexts(pane)).toEqual(['▸ src/', '▸ vendor/', '• composer.json'])
  await pane.unmount()
})

test('the file shown has its folders opened in the explorer, its row lit', WHOLE_MOD_TEST, async ($, on) => {
  const world = stubWorld(on, SHOP_FILES)
  await startSession($)
  await runCodeNav($, ORDER_REPOSITORY)
  const pane = await mountPane($)
  await openFilesDrawer(pane, world)

  const rows = await treeRowTexts(pane)
  expect(rows.slice(0, 3)).toEqual(['▾ src/', ' ▸ Entity/', ' ▾ Repository/'])
  expect(rows).toContain('  • OrderRepository.php')
  await pane.press({ key: 'collapse-tree' })
  expect(await treeRowTexts(pane)).toEqual(['▸ src/', '▸ vendor/', '• composer.json'])
  await pane.unmount()
})

test('the files and the tabs open from their keys and fold back once one is picked, and stay once pinned', WHOLE_MOD_TEST, async ($, on) => {
  const world = stubWorld(on, SHOP_FILES)
  await startSession($)
  await runCodeNav($, ORDER_REPOSITORY)
  const pane = await mountPane($, { bodyColumns: 200 })
  expect(await pane.find({ key: 'files-toggle' })).toBeDefined()
  expect(await pane.find({ key: 'explorer-drawer' })).toBeUndefined()

  await pane.press({ key: shortcutButtonKey('toggleFiles', 'v') })
  await world.clock.advance(500)
  expect(await pane.find({ key: 'explorer-drawer' })).toBeDefined()
  await pane.press({ key: shortcutButtonKey('toggleFiles', 'v') })
  await world.clock.advance(500)
  expect(await pane.find({ key: 'explorer-drawer' })).toBeUndefined()

  await openFilesDrawer(pane, world)
  await pane.press({ key: 'pin-files' })
  expect(await pane.find({ key: 'explorer' })).toBeDefined()
  expect(await pane.find({ key: 'files-toggle' })).toBeUndefined()
  expect(world.store.get('explorerMode')).toBe('pinned')
  await pane.press({ key: 'tree-row-composer.json' })
  expect(await pane.find({ key: 'explorer' })).toBeDefined()
  await pane.press({ key: 'pin-files' })
  expect(await pane.find({ key: 'files-toggle' })).toBeDefined()

  await pane.press({ key: shortcutButtonKey('toggleTabsColumn', '0') })
  expect(await pane.find({ key: 'sidebar' })).toBeUndefined()
  expect(await tabTexts(pane)).toEqual(['OrderRepository.php', 'composer.json *'])
  expect(world.store.get('tabsMode')).toBe('drawer')

  await pane.press({ key: 'tabs-toggle' })
  await world.clock.advance(500)
  expect(await pane.find({ key: 'tabs-drawer' })).toBeDefined()
  await pane.press({ key: 'tab-0' })
  await world.clock.advance(500)
  expect(await pane.find({ key: 'tabs-drawer' })).toBeUndefined()
  expect(await shownPath(pane, SHOP_FILES)).toBe(ORDER_REPOSITORY)

  await pane.press({ key: 'tabs-toggle' })
  await world.clock.advance(500)
  await pane.press({ key: 'pin-tabs' })
  expect(await pane.find({ key: 'sidebar' })).toBeDefined()
  expect(await pane.find({ key: 'tabs-toggle' })).toBeUndefined()
  await pane.unmount()
})

test('a click in the code folds the drawer of files', WHOLE_MOD_TEST, async ($, on) => {
  const world = stubWorld(on, SHOP_FILES)
  await startSession($)
  await runCodeNav($, CHECKOUT)
  const pane = await mountPane($, { bodyRows: 60 })
  await openFilesDrawer(pane, world)
  expect(await pane.find({ key: 'explorer-drawer' })).toBeDefined()

  await pane.press({ key: clickHintKeyOf(SHOP_FILES, CHECKOUT, '$this->orders->save($order)', 'save') })
  await world.clock.advance(500)
  expect(await pane.find({ key: 'explorer-drawer' })).toBeUndefined()
  await pane.unmount()
})

test('a class clicked in a tab brought back from the last session opens, the project listed first if need be', WHOLE_MOD_TEST, async ($, on) => {
  const world = stubWorld(on, SHOP_FILES)
  world.store.set('openTabs|/work/shop', { tabs: [{ path: 'src/Service/InvoiceGenerator.php', topLine: 1 }], activePath: 'src/Service/InvoiceGenerator.php' })
  await startSession($)
  await runCodeNav($)
  await world.clock.advance(1)
  const pane = await mountPane($)
  await world.clock.advance(1)
  expect(await shownPath(pane, SHOP_FILES)).toBe('src/Service/InvoiceGenerator.php')

  await pane.press({ key: clickHintKeyOf(SHOP_FILES, 'src/Service/InvoiceGenerator.php', 'new Invoice(', 'Invoice') })
  expect(await shownPath(pane, SHOP_FILES)).toBe('src/Entity/Invoice.php')
  await pane.unmount()
})

test('a name with no usage says so in a frame right above it, closed by its mark, at the next move or after three seconds', WHOLE_MOD_TEST, async ($, on) => {
  const files = {
    ...SHOP_FILES,
    'src/Service/Archive.php': '<?php\n\nnamespace Shop\\Service;\n\nclass Archive\n{\n    public function purgeEverything(): void\n    {\n    }\n}\n',
  }
  const world = stubWorld(on, files)
  await startSession($)
  await runCodeNav($, 'src/Service/Archive.php')
  const pane = await mountPane($)

  await pane.press({ key: clickHintKeyOf(files, 'src/Service/Archive.php', 'function purgeEverything', 'purgeEverything') })
  expect(await pane.find({ type: 'Text', text: 'No usage of Archive::purgeEverything in the project.' })).toBeDefined()
  expect(await resultRowTexts(pane)).toEqual([])
  const frame = await pane.find({ key: 'inline-note' })
  expect(frame?.props.top).toBe(3)

  await pane.press({ key: 'dismiss-inline-note' })
  expect(await pane.find({ key: 'inline-note' })).toBeUndefined()
  await pane.press({ key: clickHintKeyOf(files, 'src/Service/Archive.php', 'function purgeEverything', 'purgeEverything') })
  await wheel($, 1)
  expect(await pane.find({ key: 'inline-note' })).toBeUndefined()
  await pane.press({ key: clickHintKeyOf(files, 'src/Service/Archive.php', 'function purgeEverything', 'purgeEverything') })
  await world.clock.advance(2_000)
  expect(await pane.find({ key: 'inline-note' })).toBeDefined()
  await world.clock.advance(1_500)
  expect(await pane.find({ key: 'inline-note' })).toBeUndefined()
  await pane.unmount()
})

test('each tab carries a tag of what its file holds', WHOLE_MOD_TEST, async ($, on) => {
  stubWorld(on, { ...SHOP_FILES, 'front/orders.ts': 'export const orders = []\n' })
  await startSession($)
  await runCodeNav($, ORDER_REPOSITORY)
  await runCodeNav($, 'front/orders.ts')
  const pane = await mountPane($)

  const tags = (await pane.findAll({ type: 'Text' })).map(element => element.text ?? '').filter(text => text === 'php ' || text === 'ts  ')
  expect(tags).toEqual(['ts  ', 'php ', 'ts  '])
  await pane.unmount()
})

test('a class clicked in a pane drawn again before the project was listed, after a reload of the mod, still opens', WHOLE_MOD_TEST, async ($, on) => {
  const world = stubWorld(on, SHOP_FILES)
  world.store.set('openTabs|/work/shop', { tabs: [{ path: 'src/Service/InvoiceGenerator.php', topLine: 1 }], activePath: 'src/Service/InvoiceGenerator.php' })
  await startSession($)
  const pane = await mountPane($)
  await world.clock.advance(1)
  await world.clock.advance(1)
  expect(await shownPath(pane, SHOP_FILES)).toBe('src/Service/InvoiceGenerator.php')

  await pane.press({ key: clickHintKeyOf(SHOP_FILES, 'src/Service/InvoiceGenerator.php', 'new Invoice(', 'Invoice') })
  expect(await shownPath(pane, SHOP_FILES)).toBe('src/Entity/Invoice.php')
  await pane.unmount()
})

test('the files are searched by a few letters of their path in their own field, the tree coming back once it is emptied', WHOLE_MOD_TEST, async ($, on) => {
  const world = stubWorld(on, SHOP_FILES)
  await startSession($)
  await runCodeNav($, CHECKOUT)
  const pane = await mountPane($)
  await openFilesDrawer(pane, world)
  const fieldKey = (await pane.findAll({ type: 'Input' })).map(element => element.key ?? '').find(key => key.startsWith('files-filter-')) ?? ''
  expect(fieldKey).not.toBe('')

  await pane.input({ key: fieldKey, text: 'ordrepo', kind: 'change' })
  const found = (await pane.findAll({ type: 'Button' })).filter(element => (element.key ?? '').startsWith('files-filter-item-')).map(element => element.text ?? '')
  expect(found[0]).toContain('OrderRepository.php')
  expect(found.some(text => text.includes('vendor/'))).toBe(false)
  expect(await treeRowTexts(pane)).toEqual([])

  await moveFocusTo($, 'files-filter-next')
  expect(world.focusedKeys.at(-1)).toBe(fieldKey)
  await pane.input({ key: fieldKey, text: 'ordrepo' })
  expect(await shownPath(pane, SHOP_FILES)).not.toBe(CHECKOUT)
  await world.clock.advance(500)
  expect(await pane.find({ key: 'explorer-drawer' })).toBeUndefined()

  await openFilesDrawer(pane, world)
  expect((await treeRowTexts(pane)).length).toBeGreaterThan(0)
  await pane.unmount()
})

test('a text typed in lower case is found in the whole project whatever its case, one with a capital letter in that case only', WHOLE_MOD_TEST, async ($, on) => {
  stubWorld(on, SHOP_FILES)
  await startSession($)
  await runCodeNav($, CHECKOUT)
  const pane = await mountPane($)
  const classLine = lineNumberOf(SHOP_FILES, ORDER_REPOSITORY, 'class OrderRepository')

  await pane.press({ key: 'menu-search-in-project' })
  await pane.input({ key: await paletteFieldKeyOf(pane), text: 'class orderrepository' })
  expect(await resultRowTexts(pane)).toEqual([expect.stringContaining(`${ORDER_REPOSITORY}:${classLine} `)])

  await pane.press({ key: 'menu-search-in-project' })
  await pane.input({ key: await paletteFieldKeyOf(pane), text: 'class orderRepository' })
  expect(await resultRowTexts(pane)).toEqual([])
  expect(await pane.find({ type: 'Text', text: '"class orderRepository" is written nowhere in the project.' })).toBeDefined()
  await pane.unmount()
})

test('going back to a file shows it from its first column, however far the file left was scrolled sideways', WHOLE_MOD_TEST, async ($, on) => {
  const longCall = `        $this->orders->save($order); // ${'a reminder written far too long for any pane '.repeat(7)}`
  const wideNote = `    // ${'a note on the width of this line '.repeat(4)}`
  const files = {
    ...SHOP_FILES,
    'src/Service/Wide.php': `<?php\n\nclass Wide\n{\n${wideNote}\n}\n`,
    'src/Service/Long.php': `<?php\n\nclass Long\n{\n    public function keep(): void\n    {\n${longCall}\n    }\n}\n`,
  }
  stubWorld(on, files)
  await startSession($)
  await runCodeNav($, 'src/Service/Wide.php')
  await runCodeNav($, 'src/Service/Long.php')
  const pane = await mountPane($, { bodyColumns: 100 })
  await pane.press({ key: 'cut-after-7' })
  expect(await pane.find({ type: 'Text', text: /‹ from column \d+/ })).toBeDefined()

  await pane.press({ key: shortcutButtonKey('goBack', 'q') })
  expect(await shownPath(pane, files)).toBe('src/Service/Wide.php')
  expect(await pane.find({ type: 'Text', text: /‹ from column/ })).toBeUndefined()
  expect(await pane.find({ key: 'cut-after-5' })).toBeDefined()
  expect(await pane.find({ key: clickHintKeyOf(files, 'src/Service/Wide.php', 'class Wide', 'Wide') })).toBeDefined()
  await pane.unmount()
})

test('the tag over a declaration of a language with no analysis lists where its name is written', WHOLE_MOD_TEST, async ($, on) => {
  const files = {
    'shop/billing.py': ['def compute_total(order):', '    return sum(line.price for line in order.lines)', ''].join('\n'),
    'shop/checkout.py': ['from shop.billing import compute_total', '', 'def checkout(order):', '    return compute_total(order)', ''].join('\n'),
  }
  stubWorld(on, files)
  await startSession($)
  await runCodeNav($, 'shop/billing.py')
  const pane = await mountPane($)
  const hintKey = clickHintKeyOf(files, 'shop/billing.py', 'def compute_total(', 'compute_total')
  expect((await pane.find({ key: hintKey }))?.props.label).toBe(' ↪ list usages ')

  await pane.press({ key: hintKey })
  expect(await pane.find({ type: 'Text', text: /^No declaration named/ })).toBeUndefined()
  const rows = await resultRowTexts(pane)
  expect(rows.some(row => row.includes('shop/checkout.py:1 '))).toBe(true)
  expect(rows.some(row => row.includes('shop/checkout.py:4 '))).toBe(true)
  await pane.unmount()
})

test('a bookmark whose line left its file is taken off from its row in the list of bookmarks', WHOLE_MOD_TEST, async ($, on) => {
  const notesOf = (lineCount: number) => Array.from({ length: lineCount }, (_, lineIndex) => `order note ${lineIndex + 1}`).join('\n')
  const files = { ...SHOP_FILES, 'docs/orders.txt': notesOf(60) }
  const world = stubWorld(on, files)
  await startSession($)
  await runCodeNav($, 'docs/orders.txt')
  const pane = await mountPane($, { bodyRows: 70 })
  await pane.press({ key: 'gutter-5' })
  await pane.press({ key: 'gutter-40' })
  world.textByPath['docs/orders.txt'] = notesOf(10)
  world.modifiedAtByPath['docs/orders.txt'] = 2
  await world.clock.advance(2000)
  expect(await pane.find({ key: 'gutter-40' })).toBeUndefined()

  await pane.press({ key: 'menu-bookmarks' })
  expect(await resultRowTexts(pane)).toEqual([expect.stringContaining('docs/orders.txt:5 '), expect.stringContaining('docs/orders.txt:40 ')])
  await pane.press({ key: 'result-remove-1' })
  expect(await resultRowTexts(pane)).toEqual([expect.stringContaining('docs/orders.txt:5 ')])
  expect(world.store.get(`${BOOKMARKS_STORE_KEY_PREFIX}${ROOT}`)).toEqual([{ path: 'docs/orders.txt', line: 5, preview: 'order note 5' }])

  await pane.press({ key: 'menu-search-in-project' })
  await pane.input({ key: await paletteFieldKeyOf(pane), text: 'order note 1' })
  expect(await pane.find({ key: 'result-open-0' })).toBeDefined()
  expect(await pane.find({ key: 'result-remove-0' })).toBeUndefined()
  await pane.unmount()
})
