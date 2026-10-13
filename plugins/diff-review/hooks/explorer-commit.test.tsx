import { expect, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import type { On } from 'claude-code'

import { answerTurn, mountPane, openExplorer, stubWorld } from './test-support'

function stubCommitWorld(on: On, stagedPaths: string) {
  let head = 'c2'
  const appendedTexts: string[] = []
  const world = stubWorld(on, {
    git: gitCommand => {
      if (gitCommand === 'diff --cached --name-only') return { exitCode: 0, stdout: stagedPaths }
      if (gitCommand === 'rev-parse HEAD') return { exitCode: 0, stdout: `${head}\n` }
      return undefined
    },
  })
  on('session.append', async (_, e, next) => {
    const content = (e as unknown as { message: { content: Array<{ text: string }> } }).message.content
    appendedTexts.push(...content.map(block => block.text))
    return next(e)
  })

  return { world, appendedTexts, commit: () => (head = 'c3') }
}

// The branch's commits are listed in the commits view only.
async function isCommitsViewShown(pane: Mounted<'terminal', 'Pane'>): Promise<boolean> {
  return (await pane.find({ key: 'commit-c2' })) !== undefined
}

async function openPane($: Engine): Promise<Mounted<'terminal', 'Pane'>> {
  await openExplorer($)
  return mountPane($)
}

test('the commit button shows only once something is staged', async ($, on) => {
  stubCommitWorld(on, '')
  const pane = await openPane($)
  expect(await pane.find({ key: 'commit' })).toBeUndefined()
  await pane.unmount()
})

test('the commit button has Claude commit the staged files, then shows the commits once HEAD moved', async ($, on) => {
  const { world, appendedTexts, commit } = stubCommitWorld(on, 'src/Total.php\nnotes.md\n')
  const pane = await openPane($)
  expect((await pane.find({ key: 'commit' }))?.text).toBe('✓ commit 2 staged files')

  await pane.press({ key: 'commit' })
  expect(world.submittedPrompts.map(prompt => prompt.text)).toEqual(['commit the staged changes'])
  expect(appendedTexts.join(' ')).toContain('only that: do not stage any other change')
  expect(await pane.find({ text: 'Claude is committing…' })).toBeDefined()
  expect(await pane.find({ key: 'commit' })).toBeUndefined()

  commit()
  await answerTurn($, 'turn-1', 'commit the staged changes', 'Committed.')
  expect(await isCommitsViewShown(pane)).toBe(true)
  await pane.unmount()
})

test('a commit skill that asks before committing leaves the pane waiting for the reply that commits', async ($, on) => {
  const { world, commit } = stubCommitWorld(on, 'src/Total.php\n')
  const pane = await openPane($)
  await pane.press({ key: 'commit' })

  await answerTurn($, 'turn-1', 'commit the staged changes', 'Proposed message: fix the total. Commit?')
  expect(await isCommitsViewShown(pane)).toBe(false)
  expect(await pane.find({ text: '  Claude awaits your reply' })).toBeDefined()
  expect((await pane.find({ key: 'commit' }))?.text).toBe('✓ commit 1 staged file')

  commit()
  await answerTurn($, 'turn-2', 'yes', 'Committed.')
  expect(await isCommitsViewShown(pane)).toBe(true)
  expect(world.submittedPrompts).toHaveLength(1)
  await pane.unmount()
})
