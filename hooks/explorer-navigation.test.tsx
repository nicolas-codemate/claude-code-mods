import { expect, test } from 'claude-code/testing'

import { hasQuestionField, mountPane, openExplorer, questionFieldKey, reopenExplorer, stubWorld } from './test-support'

test('the explorer walks the three views and picks files and commits', async ($, on) => {
  stubWorld(on, { newFileContent: '# notes\nhello\n' })
  await openExplorer($)
  const pane = await mountPane($)

  expect(await pane.find({ type: 'Text', text: /▾ src\// })).toBeDefined()
  expect(await pane.find({ type: 'Button', text: 'Total.php' })).toBeDefined()
  expect(await pane.find({ type: 'Button', text: 'notes.md' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^notes\.md$/ })).toBeDefined()
  expect(await pane.find({ type: 'Code', text: 'hello' })).toBeDefined()

  await pane.press({ key: 'file-src/Total.php' })
  expect(await pane.find({ type: 'Code', text: '$tax = 0.2;' })).toBeDefined()

  await pane.press({ key: 'view-pr' })
  expect(await pane.find({ type: 'Button', text: 'Tax.php' })).toBeDefined()
  expect(await pane.find({ type: 'Button', text: 'notes.md' })).toBeUndefined()

  await pane.press({ key: 'view-commits' })
  expect(await pane.find({ type: 'Button', text: 'Add tax' })).toBeDefined()
  await pane.press({ key: 'commit-c1' })
  expect(await pane.find({ type: 'Text', text: /^src\/Total\.php$/ })).toBeDefined()
  await pane.unmount()
})

test('reopening the explorer closes any question and comes back to the first file', async ($, on) => {
  stubWorld(on, { newFileContent: 'hello\n' })
  await openExplorer($)
  const firstPane = await mountPane($)
  await firstPane.press({ key: 'file-src/Total.php' })
  await firstPane.press({ key: 'ask-1' })
  await firstPane.input({ key: await questionFieldKey(firstPane), text: 'draft', kind: 'change' })
  await firstPane.unmount()

  await reopenExplorer($)
  const reopenedPane = await mountPane($)
  expect(await hasQuestionField(reopenedPane)).toBe(false)
  expect(await reopenedPane.find({ type: 'Text', text: /^notes\.md$/ })).toBeDefined()
  await reopenedPane.unmount()
})

test('z/w and s walk the files, q/a and d walk the views, on AZERTY and QWERTY alike', async ($, on) => {
  stubWorld(on, { newFileContent: 'hello\n' })
  await openExplorer($)
  const pane = await mountPane($)
  const selectedFileHeader = async () =>
    (await pane.findAll({ type: 'Text', text: /^(notes\.md|src\/Total\.php|src\/Tax\.php)$/ }))[0]?.text

  expect(await selectedFileHeader()).toBe('notes.md')
  await pane.press({ key: 'navigate-s' })
  expect(await selectedFileHeader()).toBe('src/Total.php')
  await pane.press({ key: 'navigate-s' })
  expect(await selectedFileHeader()).toBe('src/Total.php')
  await pane.press({ key: 'navigate-z' })
  expect(await selectedFileHeader()).toBe('notes.md')
  await pane.press({ key: 'navigate-s' })
  await pane.press({ key: 'navigate-w' })
  expect(await selectedFileHeader()).toBe('notes.md')

  await pane.press({ key: 'navigate-d' })
  expect(await pane.find({ type: 'Button', text: 'Tax.php' })).toBeDefined()
  await pane.press({ key: 'navigate-d' })
  expect(await pane.find({ type: 'Text', text: 'Branch commits' })).toBeDefined()
  await pane.press({ key: 'navigate-q' })
  await pane.press({ key: 'navigate-a' })
  expect(await pane.find({ type: 'Button', text: 'notes.md' })).toBeDefined()
  await pane.unmount()
})

test('an AZERTY keyboard gets z q s d alone', async ($, on) => {
  stubWorld(on, { keyboardLayoutSource: "[('xkb', 'fr')]\n" })
  await openExplorer($)
  const pane = await mountPane($)
  for (const azertyKey of ['z', 'q', 's', 'd']) {
    expect(await pane.find({ key: `navigate-${azertyKey}` })).toBeDefined()
  }
  for (const qwertyOnlyKey of ['w', 'a']) {
    expect(await pane.find({ key: `navigate-${qwertyOnlyKey}` })).toBeUndefined()
  }
  await pane.unmount()
})

test('the close button closes the whole pane', async ($, on) => {
  const world = stubWorld(on)
  await openExplorer($)
  const pane = await mountPane($)
  await pane.press({ key: 'close' })
  expect(world.closedPaneIds).toEqual(['diff-review'])
  await pane.unmount()
})

test('the filter narrows the file list and lockfiles stay folded until shown', async ($, on) => {
  stubWorld(on, {
    git: gitCommand => (gitCommand.startsWith('ls-files') ? { exitCode: 0, stdout: 'notes.md\npackage-lock.json\n' } : undefined),
  })
  await openExplorer($)
  let pane = await mountPane($)
  expect(await pane.find({ type: 'Button', text: 'package-lock.json' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /1 lockfile or generated file folded/ })).toBeDefined()
  await pane.press({ key: 'toggle-noise' })
  expect(await pane.find({ type: 'Button', text: 'package-lock.json' })).toBeDefined()

  await pane.input({ key: 'file-filter', text: 'total', kind: 'change' })
  expect(await pane.find({ type: 'Button', text: 'Total.php' })).toBeDefined()
  expect(await pane.find({ type: 'Button', text: 'notes.md' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /^1 of 3$/ })).toBeDefined()
  await pane.unmount()

  pane = await mountPane($)
  await pane.input({ key: 'file-filter', text: 'nothing like this', kind: 'change' })
  expect(await pane.find({ type: 'Text', text: 'No file matches the filter.' })).toBeDefined()
  await pane.unmount()
})

test('a hunk header widens the context of its file, up to the whole file', async ($, on) => {
  const contextArguments: string[] = []
  stubWorld(on, {
    git: gitCommand => {
      const contextArgument = gitCommand.match(/^diff --no-color --no-renames (-U\d+)/)?.[1]
      if (contextArgument) contextArguments.push(contextArgument)
      return undefined
    },
  })
  await openExplorer($)
  const pane = await mountPane($)
  await pane.press({ key: 'file-src/Total.php' })
  await pane.press({ key: 'expand-context-0' })
  await pane.press({ key: 'expand-context-0' })
  await pane.press({ key: 'whole-file-0' })
  expect(contextArguments.slice(-4)).toEqual(['-U3', '-U23', '-U43', '-U1000000'])
  expect(await pane.find({ key: 'whole-file-0' })).toBeUndefined()

  await pane.press({ key: 'file-notes.md' })
  expect(await pane.find({ key: 'expand-context-0' })).toBeUndefined()
  await pane.unmount()
})

test('the commits view draws the branch graph and opens the selected commit or the PR on GitHub', async ($, on) => {
  const world = stubWorld(on)
  await openExplorer($)
  const pane = await mountPane($)
  expect(await pane.find({ key: 'open-on-github' })).toBeUndefined()

  await pane.press({ key: 'view-commits' })
  expect(await pane.find({ type: 'Text', text: /\(feat\/tax\)/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Release' })).toBeDefined()
  expect(await pane.find({ key: 'commit-base000' })).toBeUndefined()
  const commitLinks = (await pane.findAll({ type: 'Link' })).map(link => link.props.href)
  expect(commitLinks).toContain('https://github.com/acme/shop/commit/c2')
  await pane.press({ key: 'commit-c1' })
  await pane.press({ key: 'open-on-github' })
  expect(world.openedUrls).toEqual(['https://github.com/acme/shop/commit/c1'])
  await pane.unmount()
})

test('the line cursor starts on the first change, walks the lines and asks about the one it is on', async ($, on) => {
  stubWorld(on, { withFocus: true })
  await openExplorer($)
  const pane = await mountPane($)
  await pane.press({ key: 'file-src/Total.php' })
  const cursorRowKey = async () =>
    (await pane.findAll({ type: 'Box' })).find(box => box.key?.startsWith('row-') && box.children.length > 0 && JSON.stringify(box).includes('#1d2a3c'))?.key
  expect(await cursorRowKey()).toBe('row-2')
  await pane.press({ key: 'cursor-down' })
  expect(await cursorRowKey()).toBe('row-3')
  await pane.press({ key: 'cursor-up' })
  await pane.press({ key: 'cursor-up' })
  await pane.press({ key: 'cursor-up' })
  expect(await cursorRowKey()).toBe('row-1')
  await pane.press({ key: 'cursor-down' })
  await pane.press({ key: 'ask-on-line' })
  expect(await hasQuestionField(pane)).toBe(true)
  await pane.unmount()
})

test('the help lists every shortcut and closes with its key or its button', async ($, on) => {
  stubWorld(on)
  await openExplorer($)
  const pane = await mountPane($)
  await pane.press({ key: 'help' })
  expect(await pane.find({ type: 'Text', text: 'Keyboard shortcuts' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'Ask Claude about the line (Enter too)' })).toBeDefined()
  await pane.press({ key: 'help' })
  expect(await pane.find({ type: 'Text', text: 'Keyboard shortcuts' })).toBeUndefined()
  await pane.press({ key: 'help' })
  await pane.press({ key: 'help-close' })
  expect(await pane.find({ type: 'Text', text: 'Keyboard shortcuts' })).toBeUndefined()
  await pane.unmount()
})

test('a key remapped in the plugin options drives its shortcut', { options: { key_next_line: '9' } }, async ($, on) => {
  stubWorld(on)
  await openExplorer($)
  const pane = await mountPane($)
  await pane.press({ key: 'file-src/Total.php' })
  expect((await pane.find({ key: 'cursor-down' }))?.props.hotkey).toBe('9')
  await pane.unmount()
})
