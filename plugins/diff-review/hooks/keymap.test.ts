import { expect, test } from 'claude-code/testing'

import { resolveKeymap } from './keymap'

test('the default keys follow the keyboard layout, and a layout not read keeps both', async () => {
  expect(resolveKeymap({}, 'azerty').keymap.previousFile).toEqual(['z'])
  expect(resolveKeymap({}, 'qwerty').keymap.previousView).toEqual(['a'])
  expect(resolveKeymap({}, 'unknown').keymap.previousFile).toEqual(['z', 'w'])
  expect(resolveKeymap({}, 'azerty').keymap.nextLine).toEqual(['j'])
  expect(resolveKeymap({}, 'azerty').problems).toEqual([])
})

test('a remapped key replaces the default, a refused one keeps it and says why, a shared one is reported', async () => {
  const remapped = resolveKeymap({ key_next_line: '6', key_previous_line: 'up', key_ask_on_line: '7, 8' }, 'azerty')
  expect(remapped.keymap.nextLine).toEqual(['6'])
  expect(remapped.keymap.previousLine).toEqual(['k'])
  expect(remapped.keymap.askOnLine).toEqual(['7', '8'])
  expect(remapped.problems).toEqual(['key_previous_line: "up" is not one letter or digit, the default stays.'])

  const clashing = resolveKeymap({ key_next_line: 's' }, 'azerty')
  expect(clashing.problems).toEqual(['"s" is bound to nextFile, nextLine: only the last one answers.'])
})
