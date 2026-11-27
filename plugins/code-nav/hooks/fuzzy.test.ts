import { expect, test } from 'claude-code/testing'

import {
  characterMaskOf,
  fuzzyMatch,
  fuzzyMatchedIndexes,
  fuzzyMatchPath,
  fuzzyScore,
  highestFuzzyScore,
  highestFuzzyScoreWithoutPrefix,
  isFuzzySubsequence,
  prepareFuzzyQuery,
  unmatchedNamePenalty,
  wordStartCharacterMaskOf,
} from './fuzzy'

function scoreOf(queryText: string, name: string): number {
  return fuzzyMatch(queryText, name)?.score ?? Number.NEGATIVE_INFINITY
}

function pathScoreOf(queryText: string, path: string): number {
  return fuzzyMatchPath(queryText, path)?.score ?? Number.NEGATIVE_INFINITY
}

// The candidates from the best match to the worst, as the scores order them.
function ranked(queryText: string, names: readonly string[]): string[] {
  return names
    .filter(name => fuzzyMatch(queryText, name) !== null)
    .sort((first, second) => scoreOf(queryText, second) - scoreOf(queryText, first))
}

// The candidate with its matched characters between brackets.
function lit(queryText: string, name: string): string | null {
  const match = fuzzyMatch(queryText, name)

  return match && [...name].map((character, index) => (match.matchedIndexes.includes(index) ? `[${character}]` : character)).join('')
}

test('the characters of the query must appear in order, whatever their case', async () => {
  expect(fuzzyMatch('ordrepo', 'OrderRepository')?.matchedIndexes).toEqual([0, 1, 2, 5, 6, 7, 8])
  expect(fuzzyMatch('ORDER', 'order')?.matchedIndexes).toEqual([0, 1, 2, 3, 4])
  expect(fuzzyMatch('repoord', 'OrderRepository')).toBe(null)
  expect(fuzzyMatch('orderx', 'Order')).toBe(null)
  expect(fuzzyMatch('', 'Order')).toEqual({ score: 0, matchedIndexes: [] })
})

test('an exact match beats a prefix, a prefix a camel-case hump, a hump a run inside a word', async () => {
  expect(ranked('order', ['BorderRadius', 'PurchaseOrder', 'OrderRepository', 'Order', 'Reorder'])).toEqual([
    'Order',
    'OrderRepository',
    'PurchaseOrder',
    'Reorder',
    'BorderRadius',
  ])
  expect(ranked('save', ['unsaved', 'OrderSaver', 'saveOrder', 'save'])).toEqual(['save', 'saveOrder', 'OrderSaver', 'unsaved'])
})

test('camel-case humps and word starts are matched by their first letters', async () => {
  expect(lit('OrRe', 'OrderRepository')).toBe('[O][r]der[R][e]pository')
  expect(lit('ordrepo', 'OrderRepository')).toBe('[O][r][d]er[R][e][p][o]sitory')
  expect(lit('or_re', 'order_repository')).toBe('[o][r]der[_][r][e]pository')
  expect(lit('or-re', 'order-repository')).toBe('[o][r]der[-][r][e]pository')
  expect(lit('hs', 'HTTPServer')).toBe('[H]TTP[S]erver')
  expect(lit('o2i', 'order2Invoice')).toBe('[o]rder[2][I]nvoice')
  expect(scoreOf('OrRe', 'OrderRepository')).toBeGreaterThan(scoreOf('OrRe', 'CorrectResult'))
  expect(scoreOf('II', 'InvoiceItem')).toBeGreaterThan(scoreOf('II', 'Invoice'))
})

test('a run of consecutive characters beats the same characters scattered', async () => {
  expect(lit('voice', 'ProformaInvoice')).toBe('ProformaIn[v][o][i][c][e]')
  expect(scoreOf('voice', 'Invoice')).toBeGreaterThan(scoreOf('voice', 'ValidOrderInPlace'))
  expect(lit('rep', 'OrderReport')).toBe('Order[R][e][p]ort')
})

test('a character typed in upper case prefers the same character in upper case', async () => {
  expect(scoreOf('OrRe', 'OrderRepository')).toBeGreaterThan(scoreOf('orre', 'OrderRepository'))
  expect(scoreOf('order', 'Order')).toBe(scoreOf('order', 'order'))
})

test('of two names matched alike, the shorter wins', async () => {
  expect(ranked('ord', ['OrderRepository', 'Order', 'OrderLine'])).toEqual(['Order', 'OrderLine', 'OrderRepository'])
  expect(unmatchedNamePenalty(3, 5)).toBeLessThan(unmatchedNamePenalty(3, 15))
  expect(unmatchedNamePenalty(5, 5)).toBe(0)
})

test('a path is matched in its file name rather than in its directories, and prefers fewer directories', async () => {
  expect(fuzzyMatchPath('order', 'src/Order/OrderRepository.php')?.matchedIndexes).toEqual([10, 11, 12, 13, 14])
  expect(pathScoreOf('order', 'src/Repository/Order.php')).toBeGreaterThan(pathScoreOf('order', 'src/Order/Repository.php'))
  expect(pathScoreOf('order', 'src/Order.php')).toBeGreaterThan(pathScoreOf('order', 'src/Shop/Domain/Order.php'))
  expect(fuzzyMatchPath('src/ord', 'src/Order/Invoice.php')?.matchedIndexes).toEqual([0, 1, 2, 3, 4, 5, 6])
  expect(fuzzyMatchPath('src/ord', 'tests/Order/Invoice.php')).toBe(null)
})

test('a file name is matched exactly up to its first dot', async () => {
  expect(scoreOf('order', 'order.service.ts')).toBeGreaterThan(scoreOf('order', 'orders.service.ts'))
  expect(scoreOf('order.service', 'order.service.ts')).toBeGreaterThan(scoreOf('order.service', 'order.services.ts'))
})

test('a prepared query scores and lights candidates given in both cases', async () => {
  const query = prepareFuzzyQuery('OrRe')
  expect(fuzzyScore(query, 'OrderRepository', 'orderrepository', 0)).toBe(scoreOf('OrRe', 'OrderRepository'))
  expect(fuzzyMatchedIndexes(query, 'OrderRepository', 'orderrepository', 0)).toEqual([0, 1, 5, 6])
  expect(fuzzyScore(query, 'Invoice', 'invoice', 0)).toBe(null)
  expect(fuzzyMatchedIndexes(query, 'Invoice', 'invoice', 0)).toEqual([])
  expect(isFuzzySubsequence(query, 'orderrepository')).toBe(true)
  expect(isFuzzySubsequence(query, 'repository')).toBe(false)
})

test('a candidate lacking one character of the query is rejected on its character mask', async () => {
  const query = prepareFuzzyQuery('or_2')
  const holdsEveryCharacter = (name: string) => (characterMaskOf(name.toLowerCase()) & query.characterMask) === query.characterMask
  expect(holdsEveryCharacter('order_v2')).toBe(true)
  expect(holdsEveryCharacter('order_v9')).toBe(true)
  expect(holdsEveryCharacter('order-v2')).toBe(false)
  expect(holdsEveryCharacter('OrderV2')).toBe(false)
  expect(holdsEveryCharacter('invoice_2')).toBe(false)
})

const SHOP_NAMES = [
  'Order',
  'order',
  'OrderRepository',
  'order_repository',
  'OrderLine',
  'PurchaseOrder',
  'Reorder',
  'BorderRadius',
  'Invoice',
  'InvoiceItem',
  'ProformaInvoice',
  'HTTPServer',
  'order2Invoice',
  'save',
  'saveOrder',
  'unsaved',
  'isPaid',
  'testOrderIsSavedWithItsLines',
  'ORDER_STATUS_PAID',
  'o',
]
const SHOP_QUERIES = ['o', 'or', 'ord', 'order', 'OrRe', 'orre', 'ii', 'II', 'voice', 'save', 'sv', 'e', 'er', 'rd', 'osp', 'O_S', 'tois', 'i2']

test('no score exceeds the ceilings a search relies on to leave a name out before aligning it', async () => {
  for (const queryText of SHOP_QUERIES) {
    const query = prepareFuzzyQuery(queryText)
    for (const name of SHOP_NAMES) {
      const lowerCaseName = name.toLowerCase()
      const score = fuzzyScore(query, name, lowerCaseName, 0)
      if (score === null) {
        continue
      }
      const lengthPenalty = unmatchedNamePenalty(queryText.length, name.length)
      const isWholeName = name.length === queryText.length
      expect(score).toBeLessThanOrEqual(highestFuzzyScore(query, isWholeName) - lengthPenalty)
      if (!lowerCaseName.startsWith(query.lowerCaseText)) {
        const ceiling = highestFuzzyScoreWithoutPrefix(query, wordStartCharacterMaskOf(name, lowerCaseName), lowerCaseName[0] === query.lowerCaseText[0])
        expect(`${queryText} in ${name}: ${score <= ceiling - lengthPenalty}`).toBe(`${queryText} in ${name}: true`)
      }
    }
  }
})

test('the ceiling of a name is lower when the query cannot start any of its words', async () => {
  const query = prepareFuzzyQuery('ete')
  const ceilingOf = (name: string) => highestFuzzyScoreWithoutPrefix(query, wordStartCharacterMaskOf(name, name.toLowerCase()), false)
  expect(ceilingOf('budgetLine')).toBeLessThan(ceilingOf('EmailTemplateEditor'))
})
