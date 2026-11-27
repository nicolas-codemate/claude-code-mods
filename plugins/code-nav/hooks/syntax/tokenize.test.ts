import { expect, test } from 'claude-code/testing'

import { readTokens } from './test-support'
import { tokenInvariantBreaches } from './token-invariants'
import { LONGEST_TOKENIZED_LINE, languageOfPath, tokenizeSource } from './tokenize'

test('every line gets its tokens, a carriage return and the whitespace belong to none', async () => {
  const tokensByLine = tokenizeSource('src/Order.php', '<?php\r\n\r\n\t$total = 1;\r\n')

  expect(tokensByLine).toEqual([
    [{ startColumn: 0, endColumn: 5, kind: 'keyword', isNavigable: false }],
    [],
    [
      { startColumn: 1, endColumn: 7, kind: 'variable', isNavigable: true },
      { startColumn: 8, endColumn: 9, kind: 'punctuation', isNavigable: false },
      { startColumn: 10, endColumn: 11, kind: 'number', isNavigable: false },
      { startColumn: 11, endColumn: 12, kind: 'punctuation', isNavigable: false },
    ],
    [],
  ])
})

test('a line beyond the longest tokenized one is a single text token and does not disturb the lines around it', async () => {
  const longLine = `  $data = '${'x'.repeat(LONGEST_TOKENIZED_LINE)}';`
  const source = ['<?php', '/* open', longLine, '*/ $after = 1;'].join('\n')
  const tokensByLine = tokenizeSource('src/Order.php', source)

  expect(tokensByLine[2]).toEqual([{ startColumn: 2, endColumn: longLine.length, kind: 'text', isNavigable: false }])
  expect(readTokens('src/Order.php', source)[3]).toEqual(['comment */', 'variable* $after', 'punctuation =', 'number 1', 'punctuation ;'])
})

test('an empty file has one line without tokens', async () => {
  expect(tokenizeSource('src/Order.php', '')).toEqual([[]])
})

test('each language family is read by its own scanner', async () => {
  const source = "# total // of 'the' order"
  const readings = ['a.php', 'a.ts', 'a.vue', 'a.html', 'a.json', 'a.sh', 'a.java', 'a.txt'].map(
    path => `${languageOfPath(path)}: ${readTokens(path, source)[0]?.join(', ')}`,
  )

  expect(readings).toEqual([
    "php: text # total // of 'the' order",
    "script: punctuation #, name* total, comment // of 'the' order",
    "vue: text # total // of 'the' order",
    "markup: text # total // of 'the' order",
    "data: punctuation #, name* total, comment // of 'the' order",
    "shell: comment # total // of 'the' order",
    "clike: punctuation #, name* total, comment // of 'the' order",
    "plain: punctuation #, name* total, punctuation //, name* of, punctuation ', name* the, punctuation ', name* order",
  ])
})

const NOISE_PIECES = [
  '<?php ', '?>', '"', "'", '`', '${', '{$', '}', '{{', '}}', '<', '>', '</', '/*', '*/', '/**', '//', '#', '#[',
  '<<<EOT', 'EOT', '\n', '\n', ' ', '$a', 'Order', '->', '::', '(', ')', '@param', '\\', '\u0000', 'é', '=', ':', '|',
  '-', '<script>', '<style>', '<!--', '%}', '{%', '&', '1.5', '<<EOF', 'EOF', '<template>', 'function', 'use', 'import',
  'from', '[', ']', '/', ',', ';', '?', '.', '\t', '\r\n', '<div', 'v-if=', '@click=', 'key:', '- ', '|\n', '@',
]

// A reproducible sequence of pieces of syntax glued at random: what no language would accept.
function noiseOf(seed: number, pieceCount: number): string {
  let state = seed
  let noise = ''
  for (let pieceIndex = 0; pieceIndex < pieceCount; pieceIndex++) {
    state = (state * 1103515245 + 12345) % 2147483648
    noise += NOISE_PIECES[Math.floor(state / 65536) % NOISE_PIECES.length] ?? ''
  }

  return noise
}

test('noise in any language yields sound tokens without throwing', async () => {
  const paths = [
    'a.php', 'a.ts', 'a.tsx', 'a.js', 'a.vue', 'a.html', 'a.twig', 'a.json', 'a.yaml', 'a.ini', 'a.sh', 'Makefile',
    'Dockerfile', 'a.java', 'a.txt',
  ]
  const breaches: string[] = []
  for (const path of paths) {
    for (let seed = 1; seed <= 150; seed++) {
      const noise = noiseOf(seed, 200)
      breaches.push(...tokenInvariantBreaches(noise, tokenizeSource(path, noise)).map(breach => `${path} seed ${seed}: ${breach}`))
    }
  }

  expect(breaches).toEqual([])
})

test('deep nesting does not overflow the stack', async () => {
  const depth = 20000
  const sources: [string, string][] = [
    ['a.ts', '`${'.repeat(depth)],
    ['a.tsx', 'x = ' + '<a>'.repeat(depth)],
    ['a.tsx', 'x = ' + '<a b={'.repeat(depth)],
    ['a.php', '<?php ' + '"{$a["'.repeat(depth)],
    ['a.vue', '<template>' + '<div>'.repeat(depth)],
  ]
  for (const [path, source] of sources) {
    const lines = source.match(/.{1,1000}/g) ?? []
    const text = lines.join('\n')

    expect(tokenInvariantBreaches(text, tokenizeSource(path, text))).toEqual([])
  }
})
