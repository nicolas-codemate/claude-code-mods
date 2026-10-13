import { expect, test } from 'claude-code/testing'

import { shownMessageLinesOf } from './view/commit-message'
import { mountPane, openExplorer, stubWorld } from './test-support'

test('the commits view shows the whole message of the selected commit, its body included', async ($, on) => {
  stubWorld(on, {
    git: gitCommand => {
      if (gitCommand === 'log -1 --format=%B c2') return { exitCode: 0, stdout: 'Add tax\n\n- Compute the tax on the subtotal\n' }
      if (gitCommand === 'log -1 --format=%B c1') return { exitCode: 0, stdout: 'Fix total\n' }
      return undefined
    },
  })
  await openExplorer($)
  const pane = await mountPane($)
  await pane.press({ key: 'view-commits' })
  expect(await pane.find({ type: 'Text', text: /c2s · Someone · 1 hour ago/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '- Compute the tax on the subtotal' })).toBeDefined()

  await pane.press({ key: 'commit-c1' })
  expect(await pane.find({ type: 'Text', text: /c1s · Someone · 2 hours ago/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '- Compute the tax on the subtotal' })).toBeUndefined()
  await pane.unmount()
})

test('a long commit message stops after a few lines', async () => {
  const message = ['Subject', '', ...Array.from({ length: 12 }, (_, index) => `- line ${index}`)].join('\n')
  const shown = shownMessageLinesOf(message)
  expect(shown).toHaveLength(8)
  expect(shown.at(-1)).toBe('…')
  expect(shownMessageLinesOf('Subject\n')).toEqual(['Subject'])
  expect(shownMessageLinesOf('Colored \u001b[31mred\u001b[0m\n')).toEqual(['Colored [31mred[0m'])
})
