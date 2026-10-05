import { expect, test } from 'claude-code/testing'

import { progressBarCells } from './view/drawings'

test('the progress bar fills whole cells, then one cell by eighths, and always spans its width', async () => {
  expect(progressBarCells(0, 12, 8)).toEqual({ filled: '', rest: '        ' })
  expect(progressBarCells(7, 12, 8)).toEqual({ filled: '████▋', rest: '   ' })
  expect(progressBarCells(12, 12, 8)).toEqual({ filled: '████████', rest: '' })
  expect(progressBarCells(3, 0, 8)).toEqual({ filled: '', rest: '        ' })
})
