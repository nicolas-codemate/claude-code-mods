import { expect, test } from 'claude-code/testing'

import { mountPane, openExplorer, stubWorld } from './test-support'

test('new files can be marked one by one or all at once, then added to the index', async ($, on) => {
  const gitAddCalls: string[] = []
  stubWorld(on, {
    newFileContent: 'hello\n',
    git: gitCommand => {
      if (gitCommand.startsWith('add ')) {
        gitAddCalls.push(gitCommand)
        return { exitCode: 0, stdout: '' }
      }
      if (gitCommand.startsWith('ls-files')) return { exitCode: 0, stdout: 'notes.md\ntodo.md\n' }
      return undefined
    },
  })
  await openExplorer($)
  const pane = await mountPane($)
  expect(await pane.find({ key: 'mark-src/Total.php' })).toBeUndefined()

  await pane.press({ key: 'mark-todo.md' })
  expect((await pane.find({ key: 'mark-todo.md' }))?.text).toBe('x')
  expect(await pane.find({ type: 'Button', text: 'git add (1)' })).toBeDefined()
  await pane.press({ key: 'stage' })
  expect(gitAddCalls).toEqual(['add -- todo.md'])

  await pane.press({ key: 'mark-all' })
  await pane.press({ key: 'stage' })
  expect(gitAddCalls[1]).toBe('add -- notes.md todo.md')

  await pane.press({ key: 'stage' })
  expect(gitAddCalls[2]).toBe('add -- notes.md')

  await pane.press({ key: 'stage-all' })
  expect(gitAddCalls[3]).toBe('add --all')
  await pane.unmount()
})
