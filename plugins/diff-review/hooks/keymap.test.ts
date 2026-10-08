import { expect, test } from 'claude-code/testing'

import { keymapOf, SHORTCUTS } from './keymap'

test('the default keys follow the keyboard layout, and a layout not read keeps both', async () => {
  expect(keymapOf('azerty').previousFile).toEqual(['z'])
  expect(keymapOf('qwerty').previousView).toEqual(['a'])
  expect(keymapOf('unknown').previousFile).toEqual(['z', 'w'])
  expect(keymapOf('azerty').nextLine).toEqual(['j'])
})

test('no two shortcuts share a key, whatever the layout', async () => {
  for (const layout of ['azerty', 'qwerty', 'unknown'] as const) {
    const keymap = keymapOf(layout)
    const keys = SHORTCUTS.flatMap(shortcut => keymap[shortcut.action])
    expect(new Set(keys).size).toBe(keys.length)
  }
})
