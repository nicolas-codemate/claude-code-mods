import { expect, test } from 'claude-code/testing'

import { createTokenCollector } from './scanning'
import { scanStyle } from './style'

function readStyle(source: string): string[][] {
  const collector = createTokenCollector(source)
  scanStyle(source, 0, source.length, collector)
  const lines = source.split('\n')

  return collector.tokensByLine.map((lineTokens, lineIndex) =>
    lineTokens.map(token => `${token.kind} ${(lines[lineIndex] ?? '').slice(token.startColumn, token.endColumn)}`),
  )
}

test('a style sheet is plain text but for its comments and its strings', async () => {
  expect(readStyle('.order { /* total\n  row */ content: "a /* b */"; } // note\na { background: url(https://shop.test/a.png) }')).toEqual([
    ['text .order {', 'comment /* total'],
    ['comment row */', 'text content:', 'string "a /* b */"', 'text ; }', 'comment // note'],
    ['text a { background: url(https://shop.test/a.png) }'],
  ])
})

test('a comment left open runs to the end, a string left open to the end of its line', async () => {
  expect(readStyle("a { content: 'open\n} /* open\nb {}")).toEqual([
    ['text a { content:', "string 'open"],
    ['text }', 'comment /* open'],
    ['comment b {}'],
  ])
})
