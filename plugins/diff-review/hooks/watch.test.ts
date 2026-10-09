import { expect, test } from 'claude-code/testing'

import type { DiffRow } from '../types'
import { fileWithMatchesFrom, matchCountByPathOf, matchStopFrom, rowsByPathOfViewDiff, splitByTerm, watchedTermOf } from './watch'

test('a selection watches its first line, trimmed', async () => {
  expect(watchedTermOf('  $totalAmount  ')).toBe('$totalAmount')
  expect(watchedTermOf('\n  total = 1;\n  tax = 2;')).toBe('total = 1;')
  expect(watchedTermOf('   ')).toBe('')
})

test('a line splits around each occurrence of the term, case kept', async () => {
  expect(splitByTerm('$total = $total + $Total;', '$total')).toEqual([
    { text: '$total', isMatch: true },
    { text: ' = ', isMatch: false },
    { text: '$total', isMatch: true },
    { text: ' + $Total;', isMatch: false },
  ])
  expect(splitByTerm('abc', '')).toEqual([{ text: 'abc', isMatch: false }])
})

test('the diff of a view counts the occurrences of each file, hunk headers left out', async () => {
  const diffOutput = [
    'diff --git a/src/Total.php b/src/Total.php',
    '--- a/src/Total.php',
    '+++ b/src/Total.php',
    '@@ -1,2 +1,2 @@ function total()',
    ' $total = 0;',
    '-$total = 1;',
    '+$total = $total + 2;',
    'diff --git a/src/Old.php b/src/Old.php',
    '--- a/src/Old.php',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-$total = 3;',
    'diff --git a/src/Tax.php b/src/Tax.php',
    '--- a/src/Tax.php',
    '+++ b/src/Tax.php',
    '@@ -1 +1 @@',
    '-$tax = 1;',
    '+$tax = 2;',
    '',
  ].join('\n')
  const rowsByPath = rowsByPathOfViewDiff(diffOutput)
  expect(Object.keys(rowsByPath)).toEqual(['src/Total.php', 'src/Old.php', 'src/Tax.php'])
  expect(matchCountByPathOf(rowsByPath, '$total')).toEqual({ 'src/Total.php': 4, 'src/Old.php': 1 })
})

test('the next occurrence comes past the cursor, in either direction, and none past the last one', async () => {
  const row = (text: string): DiffRow => ({ kind: 'context', oldNumber: 1, newNumber: 1, text })
  const rows: DiffRow[] = [{ kind: 'hunk', oldNumber: null, newNumber: null, text: '' }, row('a'), row('total'), row('b'), row('total')]
  const stops = [1, 2, 3, 4]
  expect(matchStopFrom(rows, stops, 1, 'total', 1)).toBe(2)
  expect(matchStopFrom(rows, stops, 2, 'total', 1)).toBe(4)
  expect(matchStopFrom(rows, stops, 4, 'total', 1)).toBe(null)
  expect(matchStopFrom(rows, stops, 3, 'total', -1)).toBe(2)
  expect(matchStopFrom(rows, stops, null, 'total', -1)).toBe(4)
})

test('the next file holding the term goes round the list, the current file last', async () => {
  const paths = ['a', 'b', 'c', 'd']
  const counts = { b: 2, d: 1 }
  expect(fileWithMatchesFrom(paths, 'b', counts, 1)).toBe('d')
  expect(fileWithMatchesFrom(paths, 'd', counts, 1)).toBe('b')
  expect(fileWithMatchesFrom(paths, 'b', counts, -1)).toBe('d')
  expect(fileWithMatchesFrom(paths, null, counts, -1)).toBe('d')
  expect(fileWithMatchesFrom(paths, 'b', { b: 2 }, 1)).toBe('b')
  expect(fileWithMatchesFrom(paths, 'a', {}, 1)).toBe(null)
})
