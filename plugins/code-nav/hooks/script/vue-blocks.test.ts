import { expect, test } from 'claude-code/testing'

import { readVueBlocks } from './vue-blocks'

test('the script blocks and the template of a component are located in the file', async () => {
  const text = [
    '<script lang="ts">',
    'export default {}',
    '</script>',
    '<script setup lang="ts">',
    'const total = 1',
    '</script>',
    '<template>',
    '  <p>{{ total }}</p>',
    '</template>',
  ].join('\n')
  const blocks = readVueBlocks(text)
  expect(blocks.scriptRanges.map(range => text.slice(range.start, range.end).trim())).toEqual([
    'export default {}',
    'const total = 1',
  ])
  expect(text.slice(blocks.templateRange?.start, blocks.templateRange?.end).trim()).toBe('<p>{{ total }}</p>')
  expect(blocks.hasMarkup).toBe(false)
})

test('the template block ends at its own closing tag, past the template tags inside it', async () => {
  const text = [
    '<template>',
    '  <OrderTable>',
    '    <template #footer><p>total</p></template>',
    '  </OrderTable>',
    '</template>',
    '<script setup>',
    'const a = 1',
    '</script>',
  ].join('\n')
  const blocks = readVueBlocks(text)
  expect(text.slice(blocks.templateRange?.start, blocks.templateRange?.end)).toContain('#footer')
  expect(text.slice(blocks.templateRange?.start, blocks.templateRange?.end)).not.toContain('const a')
  expect(blocks.scriptRanges.length).toBe(1)
})

test('a script written in TSX holds markup, a file without script has no script range', async () => {
  expect(readVueBlocks('<script setup lang="tsx">\nconst row = <p />\n</script>').hasMarkup).toBe(true)
  expect(readVueBlocks('<template><p>Welcome</p></template>').scriptRanges).toEqual([])
})

test('a block left open runs to the end of the file', async () => {
  const text = '<script setup>\nconst open = 1'
  expect(readVueBlocks(text).scriptRanges).toEqual([{ start: '<script setup>'.length, end: text.length }])
})
