import { expect, test } from 'claude-code/testing'

import { diffRangeArguments, fileTypeBadgeOf, groupFilesByDirectory, parseCommitLog, parseNumstat, parseUnifiedDiff } from './git-parsing'

test('a unified diff becomes rows numbered on both sides', async () => {
  const rows = parseUnifiedDiff(
    ['diff --git a/a.php b/a.php', 'index 1..2 100644', '--- a/a.php', '+++ b/a.php', '@@ -10,3 +10,3 @@ class A', ' keep', '-old', '+new', ' end', '\\ No newline at end of file'].join('\n'),
  )
  expect(rows.map(row => row.kind)).toEqual(['hunk', 'context', 'removed', 'added', 'context'])
  expect(rows[1]).toEqual({ kind: 'context', oldNumber: 10, newNumber: 10, text: 'keep' })
  expect(rows[2]).toEqual({ kind: 'removed', oldNumber: 11, newNumber: null, text: 'old' })
  expect(rows[3]).toEqual({ kind: 'added', oldNumber: null, newNumber: 11, text: 'new' })
  expect(rows[4]).toEqual({ kind: 'context', oldNumber: 12, newNumber: 12, text: 'end' })
})

test('numstat and log lines are read, binary files have no counts', async () => {
  expect(parseNumstat('3\t1\tsrc/a.php\n-\t-\tlogo.png\n')).toEqual([
    { path: 'src/a.php', addedLines: 3, removedLines: 1, isUntracked: false },
    { path: 'logo.png', addedLines: null, removedLines: null, isUntracked: false },
  ])
  expect(parseCommitLog('abc123\u001fabc\u001fFix login\u001fSomeone\u001f2 hours ago\n')[0]).toEqual({
    sha: 'abc123', shortSha: 'abc', subject: 'Fix login', author: 'Someone', relativeDate: '2 hours ago',
  })
})

test('each view compares what it should', async () => {
  expect(diffRangeArguments('uncommitted', null, null)).toEqual(['HEAD'])
  expect(diffRangeArguments('pr', 'base1', null)).toEqual(['base1', 'HEAD'])
  expect(diffRangeArguments('pr', null, null)).toBe(null)
  expect(diffRangeArguments('commits', 'base1', 'c1')).toEqual(['c1~1', 'c1'])
})

test('files are grouped by directory and badged by type', async () => {
  const file = (path: string) => ({ path, addedLines: 1, removedLines: 0, isUntracked: false })
  const groups = groupFilesByDirectory([file('src/b.php'), file('README.md'), file('src/a.ts')])
  expect(groups.map(group => group.directory)).toEqual(['', 'src'])
  expect(groups[1]?.files.map(groupFile => groupFile.path)).toEqual(['src/a.ts', 'src/b.php'])
  expect(fileTypeBadgeOf('src/Invoice.php').badge).toBe('php')
  expect(fileTypeBadgeOf('Makefile').badge).toBe('··')
})
