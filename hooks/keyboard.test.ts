import { expect, test } from 'claude-code/testing'

import { KEYBOARD_LAYOUT_SOURCES, keyboardLayoutOf } from './keyboard'

test('the desktop keyboard settings give the layout, French and Belgian ones being AZERTY', async () => {
  const [gnomeSource, x11Source] = KEYBOARD_LAYOUT_SOURCES
  expect(keyboardLayoutOf("[('xkb', 'fr')]", gnomeSource!.layoutPattern)).toBe('azerty')
  expect(keyboardLayoutOf("[('xkb', 'us'), ('xkb', 'fr')]", gnomeSource!.layoutPattern)).toBe('qwerty')
  expect(keyboardLayoutOf('rules: evdev\nlayout:     be\n', x11Source!.layoutPattern)).toBe('azerty')
  expect(keyboardLayoutOf('nothing here', x11Source!.layoutPattern)).toBe(null)
})
