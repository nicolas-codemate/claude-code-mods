import { expect, test } from 'claude-code/testing'

import { FILE_DIFF, mountPane, openExplorer, stubWorld } from './test-support'

const VIEW_DIFF = ['diff --git a/src/Total.php b/src/Total.php', '--- a/src/Total.php', '+++ b/src/Total.php', FILE_DIFF, ''].join('\n')

function stubWatchWorld(on: Parameters<typeof stubWorld>[0], selectedText: string | undefined) {
  stubWorld(on, {
    withFocus: true,
    newFileContent: 'Check $total twice: $total\n',
    git: gitCommand => (gitCommand === 'diff --no-color --no-renames -U3 HEAD' ? { exitCode: 0, stdout: VIEW_DIFF } : undefined),
  })
  on('ui.selection', async () => ({ value: selectedText === undefined ? undefined : { text: selectedText } }) as never)
}

test('the text selected with the mouse is watched: counted per file, lit in the lines, walked from file to file', async ($, on) => {
  stubWatchWorld(on, '  $total \n')
  await openExplorer($)
  const pane = await mountPane($)
  const cursorRowKey = async () =>
    (await pane.findAll({ type: 'Box' })).find(box => box.key?.startsWith('row-') && box.children.length > 0 && JSON.stringify(box).includes('#1d2a3c'))?.key
  expect((await pane.find({ key: 'watch-selection' }))?.text).toBe('\u{1F50D} ')
  await pane.press({ key: 'file-src/Total.php' })
  expect(await pane.find({ key: 'watch-term' })).toBeUndefined()

  await pane.press({ key: 'watch-selection' })
  expect((await pane.find({ key: 'watch-term' }))?.props.value).toBe('$total')
  expect(await pane.find({ type: 'Text', text: '4 in 2 files' })).toBeDefined()
  expect(await pane.find({ key: 'watch-count-box-src/Total.php' })).toBeDefined()
  expect(await pane.find({ key: 'watch-count-box-notes.md' })).toBeDefined()
  const litMatches = (await pane.findAll({ type: 'Text', text: '$total' })).filter(text => text.props.backgroundColor === '#5c4813')
  expect(litMatches).toHaveLength(2)

  expect(await cursorRowKey()).toBe('row-2')
  expect((await pane.find({ key: 'watched-next' }))?.type).toBe('Button')
  await pane.press({ key: 'watched-next' })
  expect(await cursorRowKey()).toBe('row-3')
  await pane.press({ key: 'watched-next' })
  expect(await pane.find({ type: 'Text', text: /Check / })).toBeDefined()
  expect(await cursorRowKey()).toBe('row-1')
  await pane.press({ key: 'watched-previous' })
  expect(await cursorRowKey()).toBe('row-3')

  await pane.press({ key: 'clear-watch' })
  expect(await pane.find({ key: 'watch-term' })).toBeUndefined()
  expect(await pane.find({ key: 'watch-count-box-src/Total.php' })).toBeUndefined()
  expect(await pane.find({ key: 'watched-next' })).toBeUndefined()
  expect((await pane.find({ key: 'watch-selection' }))?.type).toBe('Button')
  await pane.unmount()
})

test('with nothing selected the term is typed, and Enter goes to its first occurrence', async ($, on) => {
  stubWatchWorld(on, undefined)
  await openExplorer($)
  const pane = await mountPane($)
  await pane.press({ key: 'file-src/Total.php' })

  await pane.press({ key: 'watch-selection' })
  expect((await pane.find({ key: 'watch-term' }))?.props.value).toBe('')
  await pane.input({ key: 'watch-term', text: '$tax', kind: 'change' })
  expect(await pane.find({ type: 'Text', text: '1 in 1 file' })).toBeDefined()
  await pane.input({ key: 'watch-term', text: 'nothing like this', kind: 'change' })
  expect(await pane.find({ type: 'Text', text: 'none' })).toBeDefined()

  const cursorRowKey = async () =>
    (await pane.findAll({ type: 'Box' })).find(box => box.key?.startsWith('row-') && box.children.length > 0 && JSON.stringify(box).includes('#1d2a3c'))?.key
  await pane.input({ key: 'watch-term', text: '$tax' })
  expect(await cursorRowKey()).toBe('row-4')
  expect((await pane.find({ key: 'watch-term' }))?.props.value).toBe('$tax')
  await pane.unmount()
})
