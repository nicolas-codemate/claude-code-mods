import { expect, test } from 'claude-code/testing'

import type { Mounted } from 'claude-code/testing'

import { mountDesktopPane, mountPane, openExplorer, stubWorld } from './test-support'

async function tileTextOf(pane: Mounted<'terminal', 'Pane'>, label: string): Promise<string | undefined> {
  return (await pane.find({ key: `tile-${label}` }))?.text
}

const PULL_REQUEST = {
  id: 'PR_1',
  number: 42,
  url: 'https://github.com/o/r/pull/42',
  title: 'Add tax',
  body: 'Adds the VAT on every invoice.',
  additions: 7,
  deletions: 1,
  changedFiles: 2,
}

function stubPullRequest(ghCommand: string) {
  if (ghCommand.startsWith('pr view')) {
    return { exitCode: 0, stdout: JSON.stringify(PULL_REQUEST) }
  }
  if (ghCommand.includes('reviewThreads')) {
    const thread = (id: string, isResolved: boolean) => ({
      id,
      isResolved,
      isOutdated: false,
      path: 'src/Total.php',
      line: 2,
      originalLine: 2,
      diffSide: 'RIGHT',
      comments: { nodes: [{ author: { login: 'reviewer' }, body: 'Why?', createdAt: '2026-01-01T00:00:00Z', url: 'https://github.com/o/r/pull/42#c' }] },
    })
    const reviewThreads = { nodes: [thread('T1', false), thread('T2', true)], pageInfo: { hasNextPage: false, endCursor: null } }
    return { exitCode: 0, stdout: JSON.stringify({ data: { node: { reviewThreads } } }) }
  }
  const files = {
    nodes: [
      { path: 'src/Tax.php', viewerViewedState: 'VIEWED' },
      { path: 'src/Total.php', viewerViewedState: 'UNVIEWED' },
    ],
    pageInfo: { hasNextPage: false, endCursor: null },
  }
  return { exitCode: 0, stdout: JSON.stringify({ data: { node: { files } } }) }
}

test('on the Desktop the explorer says it needs the terminal instead of drawing the pane', async ($, on) => {
  stubWorld(on)
  await openExplorer($)
  const pane = await mountDesktopPane($)

  expect(await pane.find({ type: 'Text', text: 'The review explorer needs the terminal.' })).toBeDefined()
  expect(await pane.find({ key: 'view-pr' })).toBeUndefined()
  await pane.unmount()
})

test('in the terminal the header shows its figures in framed tiles, the viewed count with a bar', async ($, on) => {
  stubWorld(on, { gh: stubPullRequest })
  await openExplorer($)
  const pane = await mountPane($, { bodyColumns: 220 })
  await pane.press({ key: 'view-pr' })
  const tileKeys = (await pane.findAll({ type: 'Box' })).map(box => box.key ?? '').filter(key => key.startsWith('tile-'))
  expect(tileKeys).toEqual(['tile-Files', 'tile-Lines', 'tile-Viewed', 'tile-To view'])
  expect(await pane.find({ type: 'Text', text: '████' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /1\/2 files viewed on GitHub/ })).toBeUndefined()
  await pane.unmount()

  const narrowPane = await mountPane($, { bodyColumns: 140 })
  expect((await narrowPane.findAll({ type: 'Box' })).some(box => (box.key ?? '').startsWith('tile-'))).toBe(false)
  expect(await narrowPane.find({ type: 'Text', text: /1\/2 files viewed on GitHub/ })).toBeDefined()
  await narrowPane.unmount()
})

test('the lines still to view go down as the files are ticked viewed', async ($, on) => {
  stubWorld(on, { gh: stubPullRequest })
  await openExplorer($)
  const pane = await mountPane($, { bodyColumns: 220 })
  await pane.press({ key: 'view-pr' })
  expect(await tileTextOf(pane, 'To view')).toContain('+2 −1')

  await pane.press({ key: 'viewed-src/Total.php' })
  expect(await tileTextOf(pane, 'Viewed')).toContain('2/2')
  expect(await tileTextOf(pane, 'To view')).toContain('+0 −0')

  await pane.press({ key: 'viewed-src/Tax.php' })
  expect(await tileTextOf(pane, 'Viewed')).toContain('1/2')
  expect(await tileTextOf(pane, 'To view')).toContain('+5 −0')
  await pane.unmount()
})
