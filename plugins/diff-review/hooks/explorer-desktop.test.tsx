import { expect, test } from 'claude-code/testing'

import type { Mounted } from 'claude-code/testing'

import { mountDesktopPane, mountPane, openExplorer, stubWorld } from './test-support'

type Drawing = { alt: string; source: string; width?: number }

async function drawingsOf(pane: Mounted<'desktop', 'Pane'>): Promise<Drawing[]> {
  return (await pane.findAll({ type: 'Svg' })).map(drawing => drawing.props as Drawing)
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

const MERGED_BRANCH_LOG = [
  '*   m1\u001fm1s\u001fMerge the branch\u001fSomeone\u001f1 hour ago\u001fHEAD -> feat/tax',
  '|\\  ',
  '| * b1\u001fb1s\u001fBranch work\u001fSomeone\u001f2 hours ago\u001f',
  '* | a1\u001fa1s\u001fMain work\u001fSomeone\u001f3 hours ago\u001f',
  '|/  ',
  '* c0\u001fc0s\u001fStart\u001fSomeone\u001f4 hours ago\u001f',
  'o base000\u001fbase\u001fRelease\u001fSomeone\u001f1 day ago\u001forigin/main',
  '',
].join('\n')

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

test('on the Desktop the commits view draws its lanes, curves where a branch leaves or joins, and still selects a commit', async ($, on) => {
  stubWorld(on, { git: gitCommand => (gitCommand.startsWith('log ') ? { exitCode: 0, stdout: MERGED_BRANCH_LOG } : undefined) })
  await openExplorer($)
  const pane = await mountDesktopPane($)
  await pane.press({ key: 'view-commits' })

  const graphRows = (await drawingsOf(pane)).filter(drawing => !drawing.alt.startsWith('Files'))
  expect(graphRows.map(drawing => drawing.alt)).toEqual(['*', '|\\', '| *', '* |', '|/', '*', 'o'])
  const sourceOf = (alt: string) => graphRows.find(drawing => drawing.alt === alt)?.source ?? ''
  expect(sourceOf('|\\')).toMatch(/C/)
  expect(sourceOf('|/')).toMatch(/C/)
  expect(sourceOf('o')).toMatch(/<circle[^>]*fill="#1c2029"/)
  expect(new Set(graphRows.map(drawing => drawing.width)).size).toBe(1)
  expect(await pane.find({ type: 'Text', text: '|\\' })).toBeUndefined()

  await pane.press({ key: 'commit-b1' })
  const selectedRow = (await drawingsOf(pane)).find(drawing => drawing.alt === '| *')
  expect(selectedRow?.source).toMatch(/stroke="#6cb6ff"/)
  await pane.unmount()

  const terminalPane = await mountPane($)
  expect(await terminalPane.find({ type: 'Text', text: /\|\\/ })).toBeDefined()
  await terminalPane.unmount()
})

test('on the Desktop the header shows tiles of figures and a viewed bar, fewer when the pane is narrow', async ($, on) => {
  stubWorld(on, { gh: stubPullRequest })
  await openExplorer($)
  const pane = await mountDesktopPane($)
  const tilesOf = async (mounted: Mounted<'desktop', 'Pane'>) => (await drawingsOf(mounted)).find(drawing => drawing.alt.startsWith('Files'))

  expect((await tilesOf(pane))?.alt).toBe('Files 2, Lines 2 added, 1 removed')
  await pane.press({ key: 'view-pr' })
  const pullRequestTiles = await tilesOf(pane)
  expect(pullRequestTiles?.alt).toBe('Files 2, Lines 7 added, 1 removed, Viewed 1 of 2, To view 2 added, 1 removed')
  expect(pullRequestTiles?.source).toMatch(/>1\/2</)
  expect(await pane.find({ type: 'Text', text: /1\/2 files viewed on GitHub/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /PR #42/ })).toBeDefined()
  await pane.unmount()

  const narrowPane = await mountDesktopPane($, { bodyColumns: 180 })
  expect((await tilesOf(narrowPane))?.alt).toBe('Files 2, Lines 7 added, 1 removed')
  expect(await narrowPane.find({ type: 'Text', text: /1\/2 files viewed on GitHub/ })).toBeDefined()
  expect(await narrowPane.find({ type: 'Text', text: /to view/ })).toBeDefined()
  await narrowPane.unmount()

  const narrowestPane = await mountDesktopPane($, { bodyColumns: 140 })
  expect(await tilesOf(narrowestPane)).toBeUndefined()
  expect(await narrowestPane.find({ type: 'Text', text: /1\/2 files viewed on GitHub/ })).toBeDefined()
  await narrowestPane.unmount()

  const terminalPane = await mountPane($)
  expect(await terminalPane.findAll({ type: 'Svg' })).toEqual([])
  expect(await terminalPane.find({ type: 'Text', text: /^1\/2 $/ })).toBeDefined()
  await terminalPane.unmount()
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
  const pane = await mountDesktopPane($, { bodyColumns: 240 })
  const tilesOf = async () => (await drawingsOf(pane)).find(drawing => drawing.alt.startsWith('Files'))
  await pane.press({ key: 'view-pr' })
  expect((await tilesOf())?.alt).toContain('To view 2 added, 1 removed')

  await pane.press({ key: 'viewed-src/Total.php' })
  expect((await tilesOf())?.alt).toContain('Viewed 2 of 2, To view 0 added, 0 removed')

  await pane.press({ key: 'viewed-src/Tax.php' })
  expect((await tilesOf())?.alt).toContain('Viewed 1 of 2, To view 5 added, 0 removed')
  await pane.unmount()
})
