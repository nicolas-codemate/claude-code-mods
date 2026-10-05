import { expect, test } from 'claude-code/testing'

import type { DiffRow } from '../types'
import { languageOfPath, vueLanguagesByLineNumber, withVueLanguages } from './syntax-language'

const COMPONENT = [
  '<template>',
  '  <template v-if="total">',
  '    <p>{{ total }}</p>',
  '  </template>',
  '</template>',
  '',
  '<script setup lang="ts">',
  'const total = 1',
  '</script>',
  '',
  '<style scoped lang="scss">',
  'p { color: red; }',
  '</style>',
].join('\n')

test('a Behat feature is drawn as Gherkin, other files keep the language their path gives', () => {
  expect(languageOfPath('features/invoice.feature')).toBe('gherkin')
  expect(languageOfPath('src/Tax.php')).toBeUndefined()
})

test('each line of a Vue component takes the language of the block it sits in, a nested template staying markup', () => {
  const languages = vueLanguagesByLineNumber(COMPONENT)
  expect(languages.slice(1, 6)).toEqual(['xml', 'xml', 'xml', 'xml', 'xml'])
  expect(languages.slice(7, 10)).toEqual(['xml', 'typescript', 'xml'])
  expect(languages.slice(11, 14)).toEqual(['xml', 'scss', 'xml'])
  expect(vueLanguagesByLineNumber('<script>\nconst a = 1\n</script>')[2]).toBe('javascript')
})

test('a removed line reads its block in the old file, an added or unchanged one in the new file', () => {
  const oldContent = '<script>\nvar total = 1\n</script>'
  const rows: DiffRow[] = [
    { kind: 'hunk', text: '-1,3 +1,3', oldNumber: null, newNumber: null },
    { kind: 'removed', text: 'var total = 1', oldNumber: 2, newNumber: null },
    { kind: 'added', text: 'const total = 1', oldNumber: null, newNumber: 8 },
    { kind: 'context', text: '</script>', oldNumber: 3, newNumber: 9 },
  ]
  expect(withVueLanguages(rows, oldContent, COMPONENT).map(row => row.language)).toEqual([
    undefined,
    'javascript',
    'typescript',
    'xml',
  ])
})
