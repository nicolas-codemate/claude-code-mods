import { expect, test } from 'claude-code/testing'

import type { DiffRow } from '../types'
import { pairRowsSideBySide, splitIndexOfRow } from './split-rows'

const ROWS: DiffRow[] = [
  { kind: 'hunk', text: '-1,4 +1,4', oldNumber: null, newNumber: null },
  { kind: 'context', text: '<?php', oldNumber: 1, newNumber: 1 },
  { kind: 'removed', text: '$a = 1;', oldNumber: 2, newNumber: null },
  { kind: 'removed', text: '$b = 1;', oldNumber: 3, newNumber: null },
  { kind: 'added', text: '$a = 2;', oldNumber: null, newNumber: 2 },
  { kind: 'context', text: 'return;', oldNumber: 4, newNumber: 3 },
  { kind: 'added', text: '// end', oldNumber: null, newNumber: 4 },
]

test('removed lines face the added lines of the same rank, unchanged lines stand on both sides', async () => {
  const splitRows = pairRowsSideBySide(ROWS)
  const describe = splitRows.map(splitRow =>
    splitRow.kind === 'hunk' ? 'hunk' : `${splitRow.left?.rowIndex ?? '-'}|${splitRow.right?.rowIndex ?? '-'}`,
  )
  expect(describe).toEqual(['hunk', '1|1', '2|4', '3|-', '5|5', '-|6'])
})

test('an added line before a removed one closes its change instead of pairing with it', async () => {
  const rows: DiffRow[] = [
    { kind: 'added', text: 'new', oldNumber: null, newNumber: 1 },
    { kind: 'removed', text: 'old', oldNumber: 1, newNumber: null },
  ]
  const splitRows = pairRowsSideBySide(rows)
  expect(splitRows.length).toBe(2)
})

test('a row of the diff is found on the line of the side-by-side view that holds it', async () => {
  const splitRows = pairRowsSideBySide(ROWS)
  expect(splitIndexOfRow(splitRows, 0)).toBe(0)
  expect(splitIndexOfRow(splitRows, 4)).toBe(2)
  expect(splitIndexOfRow(splitRows, 3)).toBe(3)
  expect(splitIndexOfRow(splitRows, 6)).toBe(5)
})
