import { expect, test } from 'claude-code/testing'

import type { ReviewThread } from '../types'
import {
  anchorKeyOf,
  fileAnchorPrefixOf,
  newThread,
  overviewAnchorKeyOf,
  parseAnchorKey,
  replyContextOf,
  restoredThreads,
  rowQuestionTarget,
  threadsInReadingOrder,
  withLastExchange,
} from './questions'

const ROWS = [
  { kind: 'hunk' as const, oldNumber: null, newNumber: null, text: 'class A' },
  { kind: 'context' as const, oldNumber: 10, newNumber: 10, text: 'keep' },
  { kind: 'added' as const, oldNumber: null, newNumber: 11, text: 'new' },
]

test('a line question names the line and carries the diff around it', async () => {
  const target = rowQuestionTarget({
    viewDescription: 'the uncommitted changes',
    repositoryRoot: '/work/shop',
    path: 'src/A.php',
    rows: ROWS,
    rowIndex: 2,
    contextRadius: 1,
  })
  expect(target?.anchorDescription).toBe('src/A.php, line 11 (added) in the uncommitted changes')
  expect(target?.context).toContain('  keep\n+ new')
  expect(rowQuestionTarget({ viewDescription: '', repositoryRoot: null, path: 'a', rows: ROWS, rowIndex: 9, contextRadius: 1 })).toBe(null)
})

test('anchors of one file share a prefix', async () => {
  expect(anchorKeyOf('pr', null, 'src/A.php', ROWS[2]!).startsWith(fileAnchorPrefixOf('pr', null, 'src/A.php'))).toBe(true)
})

test('a reply restates the thread, in full once the conversation was cleared', async () => {
  const thread: ReviewThread = {
    id: 't1',
    anchorKey: 'k',
    anchorDescription: 'src/A.php, line 11',
    exchanges: [{ question: 'Why?', answer: 'Because.', status: 'done' }],
    isContextCleared: false,
  }
  expect(replyContextOf(thread)).toContain('It started with the question: "Why?"')
  expect(replyContextOf({ ...thread, isContextCleared: true })).toContain('Your answer: Because.')
  expect(withLastExchange(thread, exchange => ({ ...exchange, answer: 'Now.' })).exchanges[0]?.answer).toBe('Now.')
})

test('an anchor key gives back its spot, and threads come in reading order', async () => {
  const lineAnchor = anchorKeyOf('pr', null, 'src/A.php', ROWS[2]!)
  expect(parseAnchorKey(lineAnchor)).toEqual({ kind: 'row', view: 'pr', commitSha: '', path: 'src/A.php', lineNumber: 11 })
  expect(parseAnchorKey(overviewAnchorKeyOf(42, 3, 'text'))).toEqual({ kind: 'overview', blockIndex: 3 })

  const threads = [
    newThread('late-in-b', anchorKeyOf('pr', null, 'src/B.php', { kind: 'added', oldNumber: null, newNumber: 40, text: '' }), '', 'q'),
    newThread('early-in-b', anchorKeyOf('pr', null, 'src/B.php', { kind: 'added', oldNumber: null, newNumber: 2, text: '' }), '', 'q'),
    newThread('in-a', lineAnchor, '', 'q'),
    newThread('overview', overviewAnchorKeyOf(42, 1, 'text'), '', 'q'),
    newThread('other-view', anchorKeyOf('uncommitted', null, 'src/A.php', ROWS[2]!), '', 'q'),
  ]
  const ordered = threadsInReadingOrder(threads, { view: 'pr', commitSha: null, orderedPaths: ['src/A.php', 'src/B.php'], hasOverview: true })
  expect(ordered.map(thread => thread.id)).toEqual(['overview', 'in-a', 'early-in-b', 'late-in-b'])
})

test('saved threads come back marked cleared, finished, and only when not already shown', async () => {
  const saved = [
    { id: 'shown', anchorKey: 'k', anchorDescription: 'd', exchanges: [], isContextCleared: false },
    { id: 'saved', anchorKey: 'k', anchorDescription: 'd', exchanges: [{ question: 'q', answer: 'half', status: 'answering' }], isContextCleared: false },
    { id: 'broken' },
  ]
  const restored = restoredThreads(saved, new Set(['shown']))
  expect(restored.map(thread => thread.id)).toEqual(['saved'])
  expect(restored[0]?.isContextCleared).toBe(true)
  expect(restored[0]?.exchanges[0]?.status).toBe('done')
  expect(restoredThreads('not a list', new Set())).toEqual([])
})
