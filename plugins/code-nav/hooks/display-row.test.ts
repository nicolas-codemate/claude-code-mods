import { expect, test } from 'claude-code/testing'

import type { SourceToken } from '../types'
import { displayRowOf } from './display-row'

const LINE = '    return $order->total();'
const TOKENS: SourceToken[] = [
  { startColumn: 4, endColumn: 10, kind: 'keyword', isNavigable: false },
  { startColumn: 11, endColumn: 17, kind: 'variable', isNavigable: true },
  { startColumn: 17, endColumn: 19, kind: 'punctuation', isNavigable: false },
  { startColumn: 19, endColumn: 24, kind: 'callName', isNavigable: true },
  { startColumn: 24, endColumn: 27, kind: 'punctuation', isNavigable: false },
]

test('a line is cut into pieces, the names a click may look up each alone with their column', async () => {
  const pieces = displayRowOf(LINE, TOKENS, [], 80)

  expect(pieces.map(piece => piece.text).join('')).toBe(LINE)
  expect(pieces.filter(piece => piece.navigableColumn !== null).map(piece => [piece.text, piece.navigableColumn])).toEqual([
    ['$order', 11],
    ['total', 19],
  ])
})

test('what draws alike and is not clickable is merged into one piece, whitespace included', async () => {
  const pieces = displayRowOf('// a comment', [{ startColumn: 0, endColumn: 12, kind: 'comment', isNavigable: false }], [], 80)

  expect(pieces).toEqual([{ text: '// a comment', kind: 'comment', navigableColumn: null, highlight: null, cut: null }])
})

test('a tab is widened to the next stop of four columns', async () => {
  const pieces = displayRowOf('\ta\tb', [
    { startColumn: 1, endColumn: 2, kind: 'name', isNavigable: true },
    { startColumn: 3, endColumn: 4, kind: 'name', isNavigable: true },
  ], [], 80)

  expect(pieces.map(piece => piece.text).join('')).toBe('    a   b')
})

test('a line wider than the pane is cut with a mark, and what is cut is not clickable', async () => {
  const pieces = displayRowOf(LINE, TOKENS, [], 16)

  expect(pieces.map(piece => piece.text).join('')).toBe('    return $ord…')
  expect(pieces.map(piece => piece.text).join('')).toHaveLength(16)
})

test('the name pointed at is lit whole, and a match inside a comment is lit alone', async () => {
  const marked = displayRowOf(LINE, TOKENS, [{ startColumn: 19, endColumn: 24, kind: 'marked' }], 80)
  expect(marked.filter(piece => piece.highlight === 'marked').map(piece => piece.text)).toEqual(['total'])

  const comment = '// pays the order twice'
  const matched = displayRowOf(comment, [{ startColumn: 0, endColumn: comment.length, kind: 'comment', isNavigable: false }], [
    { startColumn: 12, endColumn: 17, kind: 'match' },
  ], 80)
  expect(matched.map(piece => [piece.text, piece.highlight])).toEqual([
    ['// pays the ', null],
    ['order', 'match'],
    [' twice', null],
  ])
})

test('the name pointed at wins over a match on the same name', async () => {
  const pieces = displayRowOf(LINE, TOKENS, [
    { startColumn: 19, endColumn: 24, kind: 'match' },
    { startColumn: 19, endColumn: 24, kind: 'marked' },
  ], 80)

  expect(pieces.find(piece => piece.text === 'total')?.highlight).toBe('marked')
})

test('a line cut right where a piece ends keeps to the width given, the mark taking the last column', async () => {
  const tokens: SourceToken[] = [
    { startColumn: 0, endColumn: 5, kind: 'name', isNavigable: true },
    { startColumn: 6, endColumn: 9, kind: 'name', isNavigable: true },
  ]
  const pieces = displayRowOf('abcde fgh', tokens, [], 5)

  expect(pieces.map(piece => piece.text).join('')).toBe('abcd…')
})

test('a line scrolled to the right starts with a mark in place of what is out of sight, its names still clickable', async () => {
  const pieces = displayRowOf(LINE, TOKENS, [], 80, 10)

  expect(pieces.map(piece => piece.text).join('')).toBe('‹$order->total();')
  expect(pieces[0]?.cut).toBe('before')
  expect(pieces.filter(piece => piece.navigableColumn !== null).map(piece => [piece.text, piece.navigableColumn])).toEqual([
    ['$order', 11],
    ['total', 19],
  ])
  expect(displayRowOf(LINE, TOKENS, [], 16).at(-1)?.cut).toBe('after')
  expect(displayRowOf('short', [], [], 80, 10)).toEqual([])
})
