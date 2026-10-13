import { expect, test } from 'claude-code/testing'

import { fileTypeBadgeOf } from './view/file-badges'
import { changedNewLinesOf, diffRangeArguments, openingViewOf, groupFilesByDirectory, commitsOfGraph, parseCommitGraph, parseNumstat, repositoryWebUrlOf, parseUnifiedDiff, stageStatesOf } from './git-parsing'

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

test('numstat lines are read, binary files have no counts', async () => {
  expect(parseNumstat('3\t1\tsrc/a.php\n-\t-\tlogo.png\n0\t4\told.php\n create mode 100644 logo.png\n delete mode 100644 old.php\n')).toEqual([
    { path: 'src/a.php', addedLines: 3, removedLines: 1, isUntracked: false },
    { path: 'logo.png', addedLines: null, removedLines: null, isUntracked: false, creation: 'created' },
    { path: 'old.php', addedLines: 0, removedLines: 4, isUntracked: false, creation: 'deleted' },
  ])
})

test('a graph log gives its commits with their lanes and refs, the base commit apart', async () => {
  const fields = (sha: string, subject: string, decoration: string) =>
    [sha, sha.slice(0, 3), subject, 'Someone', '2 hours ago', decoration].join('\u001f')
  const graph = parseCommitGraph(
    [
      `*   ${fields('m1m1', 'Merge main', 'HEAD -> feat/login, origin/feat/login')}`,
      '|\\  ',
      `| * ${fields('b2b2', 'Fix main', '')}`,
      `* | ${fields('a1a1', 'Fix login', 'tag: v1.2')}`,
      '|/  ',
      `o ${fields('base', 'Release', 'origin/main')}`,
    ].join('\n'),
  )
  expect(graph.map(line => line.graph)).toEqual(['*', '|\\', '| *', '* |', '|/', 'o'])
  expect(graph[0]?.commit).toEqual({
    sha: 'm1m1', shortSha: 'm1m', subject: 'Merge main', author: 'Someone', relativeDate: '2 hours ago', refs: ['feat/login', 'origin/feat/login'],
  })
  expect(graph[3]?.commit?.refs).toEqual(['tag: v1.2'])
  expect(graph[5]?.isBoundary).toBe(true)
  expect(commitsOfGraph(graph).map(commit => commit.sha)).toEqual(['m1m1', 'b2b2', 'a1a1'])
})

test('a remote gives the web page of its repository', async () => {
  expect(repositoryWebUrlOf('git@github.com:acme/shop.git\n')).toBe('https://github.com/acme/shop')
  expect(repositoryWebUrlOf('https://github.com/acme/shop.git')).toBe('https://github.com/acme/shop')
  expect(repositoryWebUrlOf('https://token@github.com/acme/shop')).toBe('https://github.com/acme/shop')
  expect(repositoryWebUrlOf('/srv/git/shop.git')).toBe(null)
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

test('a diff without context gives the new lines it changes, a removal the line just above it', async () => {
  expect(changedNewLinesOf(['@@ -3,2 +3,3 @@', '-a', '+b', '@@ -10 +11 @@', '+c', '@@ -20,2 +21,0 @@', '-d', '@@ -1 +0,0 @@'].join('\n'))).toEqual([3, 4, 5, 11, 21, 1])
  expect(changedNewLinesOf('')).toEqual([])
})

test('the pane opens on the uncommitted changes, else on the branch commits, else on the empty uncommitted view', async () => {
  expect(openingViewOf(3, 2)).toBe('uncommitted')
  expect(openingViewOf(0, 2)).toBe('pr')
  expect(openingViewOf(0, 0)).toBe('uncommitted')
})

test('git status tells a file staged whole, partly or not at all, a renamed one under its new path', async () => {
  expect(stageStatesOf('M  a.php\nMM b.php\n M c.php\n?? d.md\nR  old.php -> new.php\nD  e.php\n')).toEqual({
    'a.php': 'staged',
    'b.php': 'partlyStaged',
    'c.php': 'unstaged',
    'd.md': 'unstaged',
    'new.php': 'staged',
    'e.php': 'staged',
  })
})
