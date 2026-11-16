import { expect, test } from 'claude-code/testing'

import { paletteOf, themeModeOf } from './view/theme'

test('the band follows the Claude Code theme, a light one included', async () => {
  expect(themeModeOf('light')).toBe('light')
  expect(themeModeOf('light-daltonized')).toBe('light')
  expect(themeModeOf('dark-ansi')).toBe('dark')
  expect(themeModeOf(null)).toBe('dark')
  expect(paletteOf('light').person).toBe('#0a5cc2')
  expect(paletteOf('dark').person).toBe('#5fb4e8')
})
