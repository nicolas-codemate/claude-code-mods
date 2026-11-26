import { expect, test } from 'claude-code/testing'

import { selectedLinesIn } from './selected-lines'

const LINES = [
  '<?php',
  '',
  'class OrderRepository',
  '{',
  '    public function save(Order $order): void',
  '    {',
  "        $this->persist($order);",
  '    }',
  '}',
]
const ALL_SHOWN = { firstLine: 1, lastLine: LINES.length }

test('whole rows selected with their line numbers give those lines', async () => {
  const selection = ['   5     public function save(Order $order): void', '   6     {', "▸  7         $this->persist($order);"].join('\n')

  expect(selectedLinesIn(selection, LINES, ALL_SHOWN)).toEqual({ startLine: 5, endLine: 7 })
})

test('a selection starting in the middle of a line counts that line, the next rows giving the numbers', async () => {
  const selection = ['function save(Order $order): void', '   6     {', '   7         $this->persist('].join('\n')

  expect(selectedLinesIn(selection, LINES, ALL_SHOWN)).toEqual({ startLine: 5, endLine: 7 })
})

test('a few words of one line with no number are found back among the lines shown, when one line only holds them', async () => {
  expect(selectedLinesIn('persist($order)', LINES, ALL_SHOWN)).toEqual({ startLine: 7, endLine: 7 })
  expect(selectedLinesIn('    {', LINES, ALL_SHOWN)).toBeNull()
  expect(selectedLinesIn('persist($order)', LINES, { firstLine: 1, lastLine: 5 })).toBeNull()
})

test('text that is not the code shown is not taken for a selection of it', async () => {
  expect(selectedLinesIn('The total is computed in save()', LINES, ALL_SHOWN)).toBeNull()
  expect(selectedLinesIn('   5 return $total;', LINES, ALL_SHOWN)).toBeNull()
  expect(selectedLinesIn('', LINES, ALL_SHOWN)).toBeNull()
})

test('a line cut for the width of the pane still matches its line', async () => {
  expect(selectedLinesIn('   5     public function save(Order…', LINES, ALL_SHOWN)).toEqual({ startLine: 5, endLine: 5 })
})

test('rows selected across the screen keep the line of the file, the tabs beside it left out', async () => {
  const selection = [
    "        $this->persist($order);",
    '        src/Repository/OrderRepository    │   8     }',
    '   php OrderRepository.php            × │   9 }',
  ].join('\n')

  expect(selectedLinesIn(selection, LINES, ALL_SHOWN)).toEqual({ startLine: 7, endLine: 9 })
  expect(selectedLinesIn('   6     {\n   7         $this->persist($order);   │ src/', LINES, ALL_SHOWN)).toEqual({ startLine: 6, endLine: 7 })
})
