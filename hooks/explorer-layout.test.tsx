import { expect, test } from 'claude-code/testing'

import { hasQuestionField, mountPane, openExplorer, stubWorld, wheel } from './test-support'

test('the pane asks for two thirds of the terminal', async ($, on) => {
  const world = stubWorld(on)
  await openExplorer($, 300)
  expect(world.requestedPaneColumns).toEqual([200])
})

test('the wheel scrolls the diff or the file list under the pointer, the other one stays put', async ($, on) => {
  const longDiff = ['@@ -1,0 +1,120 @@', ...Array.from({ length: 120 }, (_, index) => `+line ${index + 1}`)].join('\n')
  const manyNewFiles = Array.from({ length: 40 }, (_, index) => `zz-docs/note-${String(index).padStart(2, '0')}.md`).join('\n')
  stubWorld(on, {
    newFileContent: 'hello\n',
    git: gitCommand => {
      if (gitCommand.startsWith('ls-files')) return { exitCode: 0, stdout: manyNewFiles }
      if (gitCommand.startsWith('diff --no-color')) return { exitCode: 0, stdout: longDiff }
      return undefined
    },
  })
  await openExplorer($)

  let pane = await mountPane($, { bodyRows: 30 })
  expect(await pane.find({ type: 'Code', text: /^line 1$/ })).toBeDefined()
  expect(await pane.find({ type: 'Button', text: 'Total.php' })).toBeDefined()
  await pane.unmount()

  await wheel($, 120, 2)
  pane = await mountPane($, { bodyRows: 30 })
  expect(await pane.find({ type: 'Code', text: /^line 1$/ })).toBeUndefined()
  expect(await pane.find({ type: 'Code', text: /^line 7$/ })).toBeDefined()
  expect(await pane.find({ type: 'Button', text: 'Total.php' })).toBeDefined()
  await pane.unmount()

  await wheel($, 10, 3)
  pane = await mountPane($, { bodyRows: 30 })
  expect(await pane.find({ type: 'Button', text: 'Total.php' })).toBeUndefined()
  expect(await pane.find({ type: 'Code', text: /^line 7$/ })).toBeDefined()
  await pane.unmount()
})

test('a pane narrower than the minimum asks to be widened, and long lines wrap instead of being cut', async ($, on) => {
  stubWorld(on)
  await openExplorer($)
  const narrowPane = await mountPane($, { bodyColumns: 52 })
  expect(await narrowPane.find({ type: 'Text', text: /needs at least 60 columns \(now 52\)/ })).toBeDefined()
  expect(await narrowPane.find({ type: 'Button', text: 'Total.php' })).toBeUndefined()
  await narrowPane.unmount()

  const widePane = await mountPane($)
  await widePane.press({ key: 'file-src/Total.php' })
  const codeLine = await widePane.find({ type: 'Code', text: '$tax = 0.2;' })
  expect((codeLine?.props as { wrap?: string } | undefined)?.wrap).toBe('wrap')
  await widePane.unmount()
})

test('a narrow pane shows the code alone, the file list opening over it and closing once a file is picked', async ($, on) => {
  stubWorld(on)
  await openExplorer($)
  const pane = await mountPane($, { bodyColumns: 100 })
  const isDrawerOpen = async () => (await pane.find({ key: 'file-drawer-box' }))?.props.display === 'flex'
  expect(await pane.find({ key: 'file-divider' })).toBeUndefined()
  expect(await isDrawerOpen()).toBe(false)
  expect((await pane.find({ key: 'file-drawer-toggle' }))?.text).toBe('☰ Files 2')
  expect(await pane.find({ type: 'Text', text: 'notes.md' })).toBeDefined()

  await pane.press({ key: 'file-drawer-toggle' })
  expect(await isDrawerOpen()).toBe(true)
  expect((await pane.find({ key: 'file-drawer-toggle' }))?.text).toBe('✕ Files 2')
  await pane.press({ key: 'file-src/Total.php' })
  expect(await isDrawerOpen()).toBe(false)
  expect(await pane.find({ type: 'Text', text: 'src/Total.php' })).toBeDefined()

  await pane.press({ key: 'navigate-z' })
  expect(await isDrawerOpen()).toBe(false)
  expect(await pane.find({ type: 'Text', text: 'notes.md' })).toBeDefined()

  await pane.press({ key: 'focus-file-filter' })
  expect(await isDrawerOpen()).toBe(true)
  await pane.input({ key: 'file-filter', text: 'total' })
  expect(await isDrawerOpen()).toBe(false)
  expect(await pane.find({ type: 'Text', text: 'src/Total.php' })).toBeDefined()

  await pane.press({ key: 'file-drawer-toggle' })
  await pane.press({ key: 'file-drawer-toggle' })
  expect(await isDrawerOpen()).toBe(false)
  await pane.unmount()
})

test('a wide pane can collapse the file list behind the bar, the code then taking the whole width, and pin it back', async ($, on) => {
  stubWorld(on)
  await openExplorer($)
  let pane = await mountPane($)
  expect(await pane.find({ key: 'file-divider' })).toBeDefined()
  expect(await pane.find({ key: 'file-list-pin' })).toBeUndefined()

  await pane.press({ key: 'file-list-collapse' })
  expect(await pane.find({ key: 'file-divider' })).toBeUndefined()
  expect(await pane.find({ key: 'file-list-collapse' })).toBeUndefined()
  await pane.press({ key: 'file-drawer-toggle' })
  expect((await pane.find({ key: 'file-drawer-box' }))?.props.display).toBe('flex')
  expect((await pane.find({ key: 'file-list-pin' }))?.text).toBe('\u{1F4CC} pin')
  await pane.press({ key: 'file-src/Total.php' })
  expect((await pane.find({ key: 'file-drawer-box' }))?.props.display).toBe('none')
  await pane.unmount()

  pane = await mountPane($)
  expect(await pane.find({ key: 'file-divider' })).toBeUndefined()
  await pane.press({ key: 'file-list-pin' })
  expect(await pane.find({ key: 'file-divider' })).toBeDefined()
  await pane.unmount()

  const narrowPane = await mountPane($, { bodyColumns: 100 })
  expect(await narrowPane.find({ key: 'file-list-pin' })).toBeUndefined()
  expect(await narrowPane.find({ key: 'file-list-collapse' })).toBeUndefined()
  await narrowPane.unmount()
})

test('dragging the divider sets the width of the file list, within bounds', async ($, on) => {
  stubWorld(on, { withStore: true })
  await openExplorer($)
  const fileListWidth = async (pane: Awaited<ReturnType<typeof mountPane>>) =>
    (await pane.findAll({ type: 'Box' }))
      .map(box => box.props as { width?: number; borderStyle?: string })
      .find(props => props.borderStyle === 'round' && typeof props.width === 'number' && props.width >= 24)?.width
  const dragDivider = async (pane: Awaited<ReturnType<typeof mountPane>>, movedColumns: number) => {
    await pane.pointer({ type: 'down', x: 0, y: 5, button: 'left', in: 'file-divider' } as never)
    await pane.pointer({ type: 'up', x: movedColumns, y: 5, button: 'left', in: 'file-divider' } as never)
  }

  let pane = await mountPane($)
  expect(await fileListWidth(pane)).toBe(50)
  await dragDivider(pane, 20)
  await pane.unmount()
  pane = await mountPane($)
  expect(await fileListWidth(pane)).toBe(70)

  await dragDivider(pane, -200)
  await pane.unmount()
  pane = await mountPane($)
  expect(await fileListWidth(pane)).toBe(24)
  await pane.unmount()
})

test('a wide diff switches to the side-by-side view and back, and stays unified when narrow', async ($, on) => {
  const world = stubWorld(on, { withStore: true })
  await openExplorer($)
  let pane = await mountPane($)
  await pane.press({ key: 'file-src/Total.php' })
  expect(await pane.find({ key: 'line-1' })).toBeDefined()
  await pane.press({ key: 'toggle-split-view' })
  expect(world.store.get('isSplitViewPreferred')).toBe(true)
  expect(await pane.find({ type: 'Button', text: /≡ unified/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^\s+1$/ })).toBeDefined()
  expect(await pane.find({ key: 'line-2' })).toBeDefined()
  expect(await pane.find({ key: 'line-4' })).toBeDefined()
  await pane.press({ key: 'ask-2' })
  expect(await hasQuestionField(pane)).toBe(true)
  await pane.unmount()

  pane = await mountPane($, { bodyColumns: 150 })
  expect(await pane.find({ key: 'toggle-split-view' })).toBeDefined()
  await pane.press({ key: 'toggle-split-view' })
  expect(await pane.find({ type: 'Text', text: /^\s+1$/ })).toBeUndefined()
  await pane.unmount()

  pane = await mountPane($)
  await pane.press({ key: 'toggle-split-view' })
  expect(await pane.find({ type: 'Button', text: /⇆ split/ })).toBeDefined()
  expect(world.store.get('isSplitViewPreferred')).toBe(false)
  await pane.unmount()
})

test('a light Claude Code theme draws the panels light', async ($, on) => {
  stubWorld(on)
  on('config.list', async () => ({ value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: 'light', provider: { plugin: 'engine', tier: 'core' }, isLocked: false }] }) as never)
  await openExplorer($)
  const pane = await mountPane($)
  expect(JSON.stringify(await pane.findAll({ type: 'Box' }))).toContain('#f6f5f1')
  await pane.unmount()
})

test('the header buttons are pills: no border or padding around the label a click takes, the active view lit', async ($, on) => {
  stubWorld(on)
  await openExplorer($)
  const pane = await mountPane($)
  const pillOf = async (key: string) => (await pane.find({ key: `${key}-box` }))?.props

  expect(await pillOf('view-uncommitted')).toEqual({ key: 'view-uncommitted-box', display: 'flex', flexShrink: 0, height: 1, backgroundColor: '#2b4a6e', marginRight: 1 })
  expect(await pillOf('refresh')).toEqual({ key: 'refresh-box', display: 'flex', flexShrink: 0, height: 1, backgroundColor: '#2a2f3a', marginLeft: 1 })
  expect((await pane.find({ key: 'view-pr' }))?.text).toBe('PR ')
  expect((await pane.find({ key: 'refresh' }))?.text).toBe(' refresh ')

  await pane.press({ key: 'view-pr' })
  expect((await pillOf('view-pr'))?.backgroundColor).toBe('#2b4a6e')
  expect((await pillOf('view-uncommitted'))?.backgroundColor).toBe('#2a2f3a')
  await pane.unmount()
})
