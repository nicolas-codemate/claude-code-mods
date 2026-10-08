import { expect, test } from 'claude-code/testing'

import { themeModeOf, themeOf } from './view/theme'

test('the pane follows the Claude Code theme, and a forced other mode leaves the backgrounds to the terminal', async () => {
  expect(themeModeOf('auto', 'light-daltonized')).toBe('light')
  expect(themeModeOf('auto', 'dark')).toBe('dark')
  expect(themeModeOf('auto', null)).toBe('dark')
  expect(themeModeOf('light', 'dark')).toBe('light')
  expect(themeModeOf('dark', 'light')).toBe('dark')
  expect(themeOf('auto', 'light').panelBackground).toBe('#ffffff')
  expect(themeOf('light', 'dark').panelBackground).toBe(undefined)
  expect(themeOf('light', 'dark').accent).toBe('#0a5cc2')
})
