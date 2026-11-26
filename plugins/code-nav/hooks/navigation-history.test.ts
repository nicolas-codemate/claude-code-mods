import { expect, test } from 'claude-code/testing'

import type { ViewedPlace } from '../types'
import { canGoBack, canGoForward, EMPTY_HISTORY, historyAfterJump, historyAfterStep } from './navigation-history'

const place = (path: string, topLine = 1): ViewedPlace => ({ path, topLine, markedLine: null })

test('a jump remembers the place left as it was scrolled and lands on the new one', async () => {
  const afterFirst = historyAfterJump(EMPTY_HISTORY, null, place('src/Order.php'))
  const afterSecond = historyAfterJump(afterFirst, place('src/Order.php', 40), place('src/Invoice.php', 12))

  expect(afterSecond.places).toEqual([place('src/Order.php', 40), place('src/Invoice.php', 12)])
  expect(afterSecond.index).toBe(1)
  expect(canGoBack(afterSecond)).toBe(true)
  expect(canGoForward(afterSecond)).toBe(false)
})

test('going back then forward finds each place as it was left', async () => {
  const history = historyAfterJump(historyAfterJump(EMPTY_HISTORY, null, place('a.php')), place('a.php', 5), place('b.php'))
  const back = historyAfterStep(history, place('b.php', 90), -1)

  expect(back?.place).toEqual(place('a.php', 5))
  expect(back && canGoForward(back.history)).toBe(true)
  const forward = back && historyAfterStep(back.history, place('a.php', 7), 1)
  expect(forward?.place).toEqual(place('b.php', 90))
  expect(forward?.history.places[0]).toEqual(place('a.php', 7))
})

test('a jump made after going back drops what forward still held', async () => {
  const history = historyAfterJump(historyAfterJump(EMPTY_HISTORY, null, place('a.php')), place('a.php'), place('b.php'))
  const back = historyAfterStep(history, place('b.php'), -1)
  const jumped = back && historyAfterJump(back.history, place('a.php', 3), place('c.php'))

  expect(jumped?.places.map(viewedPlace => viewedPlace.path)).toEqual(['a.php', 'c.php'])
})

test('there is nowhere to go from the first place, nor past the last', async () => {
  const history = historyAfterJump(EMPTY_HISTORY, null, place('a.php'))

  expect(historyAfterStep(EMPTY_HISTORY, null, -1)).toBeNull()
  expect(historyAfterStep(history, place('a.php'), -1)).toBeNull()
  expect(historyAfterStep(history, place('a.php'), 1)).toBeNull()
})
