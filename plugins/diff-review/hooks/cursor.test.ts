import { expect, test } from 'claude-code/testing'

import type { DiffRow } from '../types'
import { cursorAtHunk, cursorStopsOf, firstChangeStop, movedCursor, offsetShowingCursor, stopOnNewLines } from './cursor'
import { pairRowsSideBySide } from './split-rows'

const ROWS: DiffRow[] = [
  { kind: 'hunk', text: '', oldNumber: null, newNumber: null },
  { kind: 'context', text: 'a', oldNumber: 1, newNumber: 1 },
  { kind: 'removed', text: 'b', oldNumber: 2, newNumber: null },
  { kind: 'added', text: 'c', oldNumber: null, newNumber: 2 },
  { kind: 'hunk', text: '', oldNumber: null, newNumber: null },
  { kind: 'context', text: 'd', oldNumber: 9, newNumber: 9 },
  { kind: 'added', text: 'e', oldNumber: null, newNumber: 10 },
]

test('the cursor stops on every line but hunk headers, on one line per pair side by side', async () => {
  expect(cursorStopsOf(ROWS, null)).toEqual([1, 2, 3, 5, 6])
  expect(cursorStopsOf(ROWS, pairRowsSideBySide(ROWS))).toEqual([1, 3, 5, 6])
  expect(firstChangeStop(ROWS, cursorStopsOf(ROWS, null))).toBe(2)
})

test('the cursor moves line by line within the file and jumps from hunk to hunk', async () => {
  const stops = cursorStopsOf(ROWS, null)
  expect(movedCursor(stops, 2, 1)).toBe(3)
  expect(movedCursor(stops, 6, 1)).toBe(6)
  expect(movedCursor(stops, 1, -1)).toBe(1)
  expect(cursorAtHunk(ROWS, stops, 2, 1)).toBe(5)
  expect(cursorAtHunk(ROWS, stops, 6, -1)).toBe(5)
  expect(cursorAtHunk(ROWS, stops, 5, -1)).toBe(1)
  expect(cursorAtHunk(ROWS, stops, 5, 1)).toBe(5)
})

test('the diff scrolls only when the cursor comes near an edge', async () => {
  expect(offsetShowingCursor(10, 0, 20)).toBe(0)
  expect(offsetShowingCursor(18, 0, 20)).toBe(2)
  expect(offsetShowingCursor(4, 5, 20)).toBe(1)
})

test('the cursor goes to the first stop on a given new line, else to the first one below the earliest', async () => {
  const stops = cursorStopsOf(ROWS, null)
  expect(stopOnNewLines(ROWS, stops, [2])).toBe(3)
  expect(stopOnNewLines(ROWS, stops, [99, 1])).toBe(1)
  expect(stopOnNewLines(ROWS, [1, 2], [2])).toBe(null)
  expect(stopOnNewLines(ROWS, stops, [])).toBe(null)
})
