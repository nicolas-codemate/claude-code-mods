import { expect, test } from 'claude-code/testing'

import type { DirectoryEntry } from './file-tree'
import {
  ancestorDirectoriesOf,
  directoriesToList,
  projectMembershipOf,
  ROOT_DIRECTORY,
  sortedEntries,
  treeOffsetShowing,
  treeRowsOf,
} from './file-tree'

const directory = (name: string): DirectoryEntry => ({ name, isDirectory: true })
const file = (name: string): DirectoryEntry => ({ name, isDirectory: false })

const ENTRIES = new Map<string, DirectoryEntry[]>([
  [ROOT_DIRECTORY, sortedEntries([file('composer.json'), directory('vendor'), directory('src'), directory('.git')])],
  ['src', sortedEntries([file('Order.php'), directory('Entity')])],
  ['src/Entity', [file('Invoice.php')]],
  ['vendor', [directory('doctrine')]],
  ['vendor/doctrine', [file('EntityRepository.php')]],
])
const MEMBERSHIP = projectMembershipOf(['composer.json', 'src/Order.php', 'src/Entity/Invoice.php'], true)
const rowsAsText = (expanded: string[]) =>
  treeRowsOf(ENTRIES, new Set(expanded), MEMBERSHIP).map(
    row => `${'  '.repeat(row.depth)}${row.isDirectory ? (row.isExpanded ? '▾ ' : '▸ ') : ''}${row.name}${row.isIgnored ? ' (ignored)' : ''}`,
  )

test('directories come before files, each sorted by name whatever its case, and the git store is left out', async () => {
  expect(sortedEntries([file('b.php'), file('A.php'), directory('zeta'), directory('Alpha'), directory('.git'), file('file10.php'), file('file9.php')]).map(entry => entry.name)).toEqual([
    'Alpha',
    'zeta',
    'A.php',
    'b.php',
    'file9.php',
    'file10.php',
  ])
})

test('the rows list the entries of each expanded directory under it, indented', async () => {
  expect(rowsAsText([])).toEqual(['▸ src', '▸ vendor (ignored)', 'composer.json'])
  expect(rowsAsText(['src', 'src/Entity'])).toEqual(['▾ src', '  ▾ Entity', '    Invoice.php', '  Order.php', '▸ vendor (ignored)', 'composer.json'])
})

test('what git ignores is listed all the same, drawn apart with everything under it', async () => {
  expect(rowsAsText(['vendor', 'vendor/doctrine'])).toEqual([
    '▸ src',
    '▾ vendor (ignored)',
    '  ▾ doctrine (ignored)',
    '    EntityRepository.php (ignored)',
    'composer.json',
  ])
})

test('nothing is drawn apart while the project has not been listed yet', async () => {
  const rows = treeRowsOf(ENTRIES, new Set(), projectMembershipOf([], false))
  expect(rows.some(row => row.isIgnored)).toBe(false)
})

test('the directories of a file are its ancestors from the outermost, and the expanded ones not listed are asked for', async () => {
  expect(ancestorDirectoriesOf('vendor/doctrine/orm/EntityRepository.php')).toEqual(['vendor', 'vendor/doctrine', 'vendor/doctrine/orm'])
  expect(ancestorDirectoriesOf('composer.json')).toEqual([])
  expect(directoriesToList(new Map([[ROOT_DIRECTORY, []]]), new Set(['vendor/doctrine', 'vendor']))).toEqual(['vendor', 'vendor/doctrine'])
  expect(directoriesToList(new Map(), new Set())).toEqual([ROOT_DIRECTORY])
})

test('a row out of sight is brought a quarter of the way down, one in sight moves nothing', async () => {
  expect(treeOffsetShowing(5, 0, 20, 100)).toBe(0)
  expect(treeOffsetShowing(50, 0, 20, 100)).toBe(45)
  expect(treeOffsetShowing(98, 0, 20, 100)).toBe(80)
  expect(treeOffsetShowing(2, 30, 20, 100)).toBe(0)
})
