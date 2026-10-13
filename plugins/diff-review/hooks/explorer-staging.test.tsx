import { expect, test } from 'claude-code/testing'

import { mountPane, openExplorer, stubWorld } from './test-support'

test('each file not staged carries its own git add, a file staged whole a mark, and add all stages everything', async ($, on) => {
  const gitAddCalls: string[] = []
  stubWorld(on, {
    newFileContent: 'hello\n',
    git: gitCommand => {
      if (gitCommand.startsWith('add ')) {
        gitAddCalls.push(gitCommand)
        return { exitCode: 0, stdout: '' }
      }
      if (gitCommand === 'diff --numstat --summary --no-renames HEAD') {
        return { exitCode: 0, stdout: '2\t1\tsrc/Total.php\n1\t0\tsrc/Tax.php\n3\t0\tdone.md\n' }
      }
      if (gitCommand === 'status --porcelain --untracked-files=all') {
        return { exitCode: 0, stdout: ' M src/Total.php\nMM src/Tax.php\nA  done.md\n?? notes.md\n' }
      }
      return undefined
    },
  })
  await openExplorer($)
  const pane = await mountPane($)
  expect((await pane.find({ key: 'stage-src/Total.php' }))?.text).toBe(' +')
  expect((await pane.find({ key: 'stage-notes.md' }))?.text).toBe(' +')
  expect((await pane.find({ key: 'stage-src/Tax.php' }))?.text).toBe(' ±')
  expect(await pane.find({ key: 'stage-done.md' })).toBeUndefined()
  expect(await pane.find({ text: ' ✓' })).toBeDefined()

  await pane.press({ key: 'stage-notes.md' })
  expect(gitAddCalls).toEqual(['add -- notes.md'])
  await pane.press({ key: 'stage-src/Tax.php' })
  expect(gitAddCalls[1]).toBe('add -- src/Tax.php')

  await pane.press({ key: 'file-src/Total.php' })
  expect((await pane.find({ key: 'stage-src/Total.php' }))?.text).toBe(' +')
  await pane.press({ key: 'stage-current' })
  expect(gitAddCalls[2]).toBe('add -- src/Total.php')

  await pane.press({ key: 'stage-all' })
  expect(gitAddCalls[3]).toBe('add --all')
  await pane.unmount()
})

test('while the pane is open, a change made outside Claude reaches the view at the next look at git status', async ($, on) => {
  let status = ' M src/Total.php\n?? notes.md\n'
  let statusReads = 0
  const world = stubWorld(on, {
    git: gitCommand => {
      if (gitCommand === 'status --porcelain --untracked-files=all') {
        statusReads += 1
        return { exitCode: 0, stdout: status }
      }
      if (gitCommand === 'ls-files --others --exclude-standard') {
        return { exitCode: 0, stdout: status.includes('todo.md') ? 'notes.md\ntodo.md\n' : 'notes.md\n' }
      }
      return undefined
    },
  })
  on('ui.panes', async () => ({ value: [{ id: 'diff-review' }] }) as never)
  await openExplorer($)
  const pane = await mountPane($)
  expect((await pane.find({ key: 'view-uncommitted' }))?.text).toBe('Uncommitted 2 ')

  const readsBeforeIdlePoll = statusReads
  await world.clock.advance(5000)
  expect(statusReads).toBe(readsBeforeIdlePoll + 1)

  status = ' M src/Total.php\n?? notes.md\n?? todo.md\n'
  await world.clock.advance(5000)
  expect((await pane.find({ key: 'view-uncommitted' }))?.text).toBe('Uncommitted 3 ')
  expect(await pane.find({ key: 'stage-todo.md' })).toBeDefined()
  await pane.unmount()
})
