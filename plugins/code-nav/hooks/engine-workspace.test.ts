import { expect, test } from 'claude-code/testing'

import { characterColumnOfByteColumn, parseSearchOutput, searchArgumentsOf } from './engine-workspace'

test('a column counted in bytes from 1 becomes an index in the line, whatever the characters before it', async () => {
  expect(characterColumnOfByteColumn('$order->save()', 9)).toBe(8)
  expect(characterColumnOfByteColumn('// café : $order->save()', 20)).toBe(18)
  expect(characterColumnOfByteColumn('// 価格 save()', 11)).toBe(6)
  expect(characterColumnOfByteColumn('save()', 1)).toBe(0)
})

test('each occurrence printed by ripgrep is read with its path from the root, its line and its column', async () => {
  const matches = parseSearchOutput(['./src/Order.php:12:9:$order->save();', './src/Invoice.php:4:5:    save($a); save($b);', './src/Invoice.php:4:15:    save($a); save($b);', ''].join('\n'), undefined)

  expect(matches).toEqual([
    { path: 'src/Invoice.php', line: 4, column: 4, text: '    save($a); save($b);' },
    { path: 'src/Invoice.php', line: 4, column: 14, text: '    save($a); save($b);' },
    { path: 'src/Order.php', line: 12, column: 8, text: '$order->save();' },
  ])
})

test('a line ending with a carriage return is read, without it', async () => {
  expect(parseSearchOutput('./src/order.ts:2:3:  save() {}\r\n', undefined)).toEqual([{ path: 'src/order.ts', line: 2, column: 2, text: '  save() {}' }])
})

test('a line ripgrep left out for its length has no match, rather than a match at a wrong column', async () => {
  expect(parseSearchOutput('./public/app.min.js:1:1224:[Omitted long line with 2 matches]\n./src/a.ts:1:1:save()\n', undefined)).toEqual([
    { path: 'src/a.ts', line: 1, column: 0, text: 'save()' },
  ])
})

test('the matches are cut to the number asked for, in path then line order', async () => {
  const output = ['./b.ts:1:1:save', './a.ts:9:1:save', './a.ts:2:1:save', ''].join('\n')

  expect(parseSearchOutput(output, 2).map(match => `${match.path}:${match.line}`)).toEqual(['a.ts:2', 'a.ts:9'])
})

test('a search names the directory searched, and reads what git ignores only when asked', async () => {
  expect(searchArgumentsOf('save', {}).at(-1)).toBe('./')
  expect(searchArgumentsOf('save', {}).includes('--no-ignore')).toBe(false)
  const dependencySearch = searchArgumentsOf('function save', { includeIgnored: true, globs: ['*.php'], directory: 'vendor' })
  expect(dependencySearch.includes('--no-ignore')).toBe(true)
  expect(dependencySearch.slice(-5)).toEqual(['--glob', '*.php', '--regexp', 'function save', 'vendor'])
})
