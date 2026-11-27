import { expect, test } from 'claude-code/testing'

import { fileBadgeOf } from './file-badge'
import { analysisOfPath, NAVIGATED_LANGUAGES, navigatedLanguageOfPath, symbolsOfFileInAnyLanguage } from './languages'
import { languageOfPath } from './syntax/language'

test('a file is navigated in the language its extension names, any other file by its words', async () => {
  expect(navigatedLanguageOfPath('src/Order/OrderRepository.php')).toBe('php')
  expect(navigatedLanguageOfPath('assets/cart/Cart.VUE')).toBe('script')
  expect(navigatedLanguageOfPath('assets/cart/cart.d.ts')).toBe('script')
  expect(navigatedLanguageOfPath('bin/import_orders.py')).toBeNull()
  expect(navigatedLanguageOfPath('Makefile')).toBeNull()
  expect(navigatedLanguageOfPath('config.php/README')).toBeNull()
  expect(analysisOfPath('src/Order.php')).toBe(NAVIGATED_LANGUAGES.php.analysis)
})

test('every extension of a navigated language is also coloured and badged', async () => {
  for (const [language, support] of Object.entries(NAVIGATED_LANGUAGES)) {
    for (const extension of support.extensions) {
      const path = `src/example.${extension}`
      expect({ language, extension, isColoured: languageOfPath(path) !== 'plain' }).toEqual({ language, extension, isColoured: true })
      expect({ language, extension, badge: fileBadgeOf(path).label === '·' }).toEqual({ language, extension, badge: false })
    }
  }
})

test('the structure of a file comes from its language, or from the shapes of its format', async () => {
  expect(symbolsOfFileInAnyLanguage('src/Order.php', '<?php\nclass Order\n{\n    public function total(): int {}\n}\n').map(symbol => symbol.name)).toEqual(['Order', 'total'])
  expect(symbolsOfFileInAnyLanguage('bin/import_orders.py', 'class Importer:\n    def run(self):\n        pass\n').map(symbol => symbol.name)).toEqual(['Importer', 'run'])
})

