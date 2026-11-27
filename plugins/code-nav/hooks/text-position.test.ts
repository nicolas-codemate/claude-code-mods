import { expect, test } from 'claude-code/testing'

import { lineAndColumnOfOffset, lineNumberTypedIn, lineStartOffsetsOf, lineTextAt, offsetOfLineAndColumn } from './text-position'

const TEXT = 'const total = 1\n\nexport { total }\r\nlast'

test('an offset is a line counted from 1 and a column counted from 0', async () => {
  const lineStartOffsets = lineStartOffsetsOf(TEXT)
  expect(lineStartOffsets).toEqual([0, 16, 17, 35])
  expect(lineAndColumnOfOffset(lineStartOffsets, 0)).toEqual({ line: 1, column: 0 })
  expect(lineAndColumnOfOffset(lineStartOffsets, 26)).toEqual({ line: 3, column: 9 })
  expect(lineAndColumnOfOffset(lineStartOffsets, 16)).toEqual({ line: 2, column: 0 })
})

test('a line and a column give back the offset, a line the file does not have gives none', async () => {
  const lineStartOffsets = lineStartOffsetsOf(TEXT)
  expect(offsetOfLineAndColumn(lineStartOffsets, 3, 9)).toBe(26)
  expect(offsetOfLineAndColumn(lineStartOffsets, 9, 0)).toBe(null)
})

test('the text of a line leaves its line break and carriage return out', async () => {
  const lineStartOffsets = lineStartOffsetsOf(TEXT)
  expect(lineTextAt(TEXT, lineStartOffsets, 3)).toBe('export { total }')
  expect(lineTextAt(TEXT, lineStartOffsets, 4)).toBe('last')
  expect(lineTextAt(TEXT, lineStartOffsets, 2)).toBe('')
  expect(lineTextAt(TEXT, lineStartOffsets, 7)).toBe('')
})

test('a line to go to is a number of the file, typed with or without a colon', async () => {
  expect(lineNumberTypedIn('42', 100)).toBe(42)
  expect(lineNumberTypedIn(' :7 ', 100)).toBe(7)
  expect(lineNumberTypedIn('0', 100)).toBeNull()
  expect(lineNumberTypedIn('101', 100)).toBeNull()
  expect(lineNumberTypedIn('4a', 100)).toBeNull()
  expect(lineNumberTypedIn('', 100)).toBeNull()
})
