import { expect, mock, test } from 'claude-code/testing'

const ROOT = '/work/shop'

async function questionFieldKey(pane: { findAll: (query: { type: 'Input' }) => Promise<Array<{ key?: string }>> }): Promise<string> {
  return (await pane.findAll({ type: 'Input' })).map(input => input.key ?? '').find(key => key.startsWith('question-')) ?? ''
}
const FILE_DIFF = ['@@ -1,2 +1,3 @@', ' <?php', '-$total = 1;', '+$total = 2;', '+$tax = 0.2;'].join('\n')

function answerGit(gitArguments: string[]): { exitCode: number; stdout: string } {
  const command = gitArguments.filter(argument => argument !== '-C' && argument !== ROOT).join(' ')
  if (command === 'rev-parse --show-toplevel') return { exitCode: 0, stdout: `${ROOT}\n` }
  if (command === 'rev-parse --abbrev-ref origin/HEAD') return { exitCode: 0, stdout: 'origin/main\n' }
  if (command === 'merge-base HEAD origin/main') return { exitCode: 0, stdout: 'base000\n' }
  if (command === 'diff --numstat --no-renames HEAD') return { exitCode: 0, stdout: '2\t1\tsrc/Total.php\n' }
  if (command === 'ls-files --others --exclude-standard') return { exitCode: 0, stdout: 'notes.md\n' }
  if (command === 'diff --numstat --no-renames base000 HEAD') return { exitCode: 0, stdout: '5\t0\tsrc/Tax.php\n2\t1\tsrc/Total.php\n' }
  if (command.startsWith('log ')) return { exitCode: 0, stdout: 'c2\u001fc2s\u001fAdd tax\u001fSomeone\u001f1 hour ago\nc1\u001fc1s\u001fFix total\u001fSomeone\u001f2 hours ago\n' }
  if (command === 'diff --numstat --no-renames c2~1 c2') return { exitCode: 0, stdout: '5\t0\tsrc/Tax.php\n' }
  if (command === 'diff --numstat --no-renames c1~1 c1') return { exitCode: 0, stdout: '2\t1\tsrc/Total.php\n' }
  if (command.startsWith('diff --no-color')) return { exitCode: 0, stdout: FILE_DIFF }
  return { exitCode: 1, stdout: '' }
}

test('the explorer walks the three views, picks files and commits, and asks about a line', async ($, on) => {
  const submittedPrompts: string[] = []
  mock.clock(on, { now: 1000 })
  on('process.run', async (_, e) => ({ value: { ...answerGit(e.argv.slice(1)), stderr: '' } }) as never)
  on('fs.read', async () => ({ value: '# notes\nhello\n' }) as never)
  on('command.register', async (_, e) => ({ value: { command: e.name } }) as never)
  on('session.start', async () => ({ cwd: ROOT }) as never)
  const requestedPaneColumns: Array<number | undefined> = []
  on('ui.open', async (_, e) => {
    requestedPaneColumns.push(e.columns)
    return { value: { isPlaced: true } } as never
  })
  on('session.append', async (_, e) => ({ value: { message: e.message, uuid: 'row' } }) as never)
  on('prompt.submit', async (_, e) => {
    submittedPrompts.push(e.text)
    return { text: e.text } as never
  })

  await $.session.start({ source: 'startup', cwd: ROOT } as never)
  await $.command.run({ command: 'diff-review', args: '', presentation: { isFullscreen: true, columns: 300 } } as never)
  expect(requestedPaneColumns).toEqual([200])
  const pane = await $.ui.mount({
    plugin: 'diff-review',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'diff-review',
    props: { title: 'Review', isFocused: true, bodyColumns: 200, placement: 'dock' } as never,
  })

  expect(await pane.find({ type: 'Text', text: /▾ src\// })).toBeDefined()
  expect(await pane.find({ type: 'Button', text: 'Total.php' })).toBeDefined()
  expect(await pane.find({ type: 'Button', text: 'notes.md' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^notes\.md$/ })).toBeDefined()
  expect(await pane.find({ type: 'Code', text: 'hello' })).toBeDefined()

  await pane.press({ key: 'file-src/Total.php' })
  expect(await pane.find({ type: 'Code', text: '$tax = 0.2;' })).toBeDefined()

  await pane.press({ key: 'view-pr' })
  expect(await pane.find({ type: 'Button', text: 'Tax.php' })).toBeDefined()
  expect(await pane.find({ type: 'Button', text: 'notes.md' })).toBeUndefined()

  await pane.press({ key: 'view-commits' })
  expect(await pane.find({ type: 'Button', text: 'Add tax' })).toBeDefined()
  await pane.press({ key: 'commit-c1' })
  expect(await pane.find({ type: 'Text', text: /^src\/Total\.php$/ })).toBeDefined()

  await pane.press({ key: 'line-3' })
  expect(await pane.find({ type: 'Input' })).toBeDefined()
  await pane.press({ key: 'cancel-question' })
  await pane.press({ key: 'ask-3' })
  await pane.input({ key: await questionFieldKey(pane), text: 'Why 2?' })
  expect(submittedPrompts).toEqual(['Why 2?'])
  expect(await pane.find({ type: 'Text', text: /> Why 2\?/ })).toBeDefined()
  const dismissButton = (await pane.findAll({ type: 'Button', text: '× close' }))[0]
  expect(dismissButton).toBeDefined()
  await pane.press({ key: dismissButton?.key ?? '' })
  expect(await pane.find({ type: 'Text', text: /> Why 2\?/ })).toBeUndefined()

  await pane.press({ key: 'ask-3' })
  expect(await pane.find({ type: 'Input' })).toBeDefined()
  await pane.press({ key: 'cancel-question' })
  expect(await pane.find({ type: 'Input' })).toBeUndefined()
  await pane.unmount()
})

test('an empty question closes when the pane loses the keyboard or the focus moves on, a started one stays', async ($, on) => {
  mock.clock(on, { now: 1000 })
  on('process.run', async (_, e) => ({ value: { ...answerGit(e.argv.slice(1)), stderr: '' } }) as never)
  on('fs.read', async () => ({ value: '' }) as never)
  on('command.register', async (_, e) => ({ value: { command: e.name } }) as never)
  on('session.start', async () => ({ cwd: ROOT }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.focus', async () => ({ value: undefined }) as never)

  await $.session.start({ source: 'startup', cwd: ROOT } as never)
  await $.command.run({ command: 'diff-review', args: '', presentation: { isFullscreen: true, columns: 300 } } as never)
  const paneTarget = { plugin: 'diff-review', surface: 'terminal', component: 'Pane', requestId: 'diff-review' } as const
  const focusedProps = { title: 'Review', isFocused: true, bodyColumns: 200, placement: 'dock' } as never
  const unfocusedProps = { title: 'Review', isFocused: false, bodyColumns: 200, placement: 'dock' } as never

  const paneWithoutKeyboard = await $.ui.mount({ ...paneTarget, props: unfocusedProps })
  await paneWithoutKeyboard.press({ key: 'file-src/Total.php' })
  await $.ui.focus({ component: 'Pane', requestId: 'diff-review', element: 'ask-3', origin: { kind: 'person' } } as never)
  await paneWithoutKeyboard.press({ key: 'ask-3' })
  expect(await paneWithoutKeyboard.find({ type: 'Input' })).toBeDefined()
  await paneWithoutKeyboard.unmount()

  const focusedPane = await $.ui.mount({ ...paneTarget, props: focusedProps })
  await $.ui.focus({ component: 'Pane', requestId: 'diff-review', element: 'question-1', origin: { kind: 'person' } } as never)
  expect(await focusedPane.find({ type: 'Input' })).toBeDefined()
  await focusedPane.unmount()

  const unfocusedPane = await $.ui.mount({ ...paneTarget, props: unfocusedProps })
  expect(await unfocusedPane.find({ type: 'Input' })).toBeUndefined()
  await unfocusedPane.unmount()

  await $.ui.focus({ component: 'Pane', requestId: 'diff-review', element: 'view-pr', origin: { kind: 'person' } } as never)
  const refocusedPane = await $.ui.mount({ ...paneTarget, props: focusedProps })
  expect(await refocusedPane.find({ type: 'Input' })).toBeUndefined()

  await refocusedPane.press({ key: 'ask-3' })
  await refocusedPane.input({ key: await questionFieldKey(refocusedPane), text: 'Why', kind: 'change' })
  await refocusedPane.unmount()
  const paneWithDraft = await $.ui.mount({ ...paneTarget, props: unfocusedProps })
  expect(await paneWithDraft.find({ type: 'Input' })).toBeDefined()
  await paneWithDraft.unmount()
})

test('reopening the explorer closes any question and comes back to the first file', async ($, on) => {
  mock.clock(on, { now: 1000 })
  on('process.run', async (_, e) => ({ value: { ...answerGit(e.argv.slice(1)), stderr: '' } }) as never)
  on('fs.read', async () => ({ value: 'hello\n' }) as never)
  on('command.register', async (_, e) => ({ value: { command: e.name } }) as never)
  on('session.start', async () => ({ cwd: ROOT }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)

  await $.session.start({ source: 'startup', cwd: ROOT } as never)
  const openExplorer = () =>
    $.command.run({ command: 'diff-review', args: '', presentation: { isFullscreen: true, columns: 300 } } as never)
  const paneTarget = {
    plugin: 'diff-review',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'diff-review',
    props: { title: 'Review', isFocused: true, bodyColumns: 200, placement: 'dock' } as never,
  } as const

  await openExplorer()
  const firstPane = await $.ui.mount(paneTarget)
  await firstPane.press({ key: 'file-src/Total.php' })
  await firstPane.press({ key: 'ask-1' })
  await firstPane.input({ key: await questionFieldKey(firstPane), text: 'draft', kind: 'change' })
  await firstPane.unmount()

  await openExplorer()
  const reopenedPane = await $.ui.mount(paneTarget)
  expect(await reopenedPane.find({ type: 'Input' })).toBeUndefined()
  expect(await reopenedPane.find({ type: 'Text', text: /^notes\.md$/ })).toBeDefined()
  await reopenedPane.unmount()
})

test('in the PR view each file of the PR carries a viewed box that GitHub keeps', async ($, on) => {
  const githubMutations: string[] = []
  let isGithubRefusing = false
  mock.clock(on, { now: 1000 })
  on('process.run', async (_, e) => {
    if (e.argv[0] !== 'gh') {
      return { value: { ...answerGit(e.argv.slice(1)), stderr: '' } } as never
    }
    const ghCommand = e.argv.slice(1).join(' ')
    if (ghCommand.startsWith('pr view')) {
      return { value: { exitCode: 0, stdout: '{"id":"PR_1","number":42,"url":"https://github.com/o/r/pull/42","title":"Add tax","body":"Adds the VAT.","additions":7,"deletions":1,"changedFiles":2}', stderr: '' } } as never
    }
    if (ghCommand.includes('markFileAsViewed') || ghCommand.includes('unmarkFileAsViewed')) {
      githubMutations.push(ghCommand.includes('unmarkFileAsViewed') ? 'unmark' : 'mark')
      return { value: { exitCode: isGithubRefusing ? 1 : 0, stdout: '{}', stderr: 'refused' } } as never
    }
    const page = { data: { node: { files: {
      nodes: [{ path: 'src/Tax.php', viewerViewedState: 'VIEWED' }, { path: 'src/Total.php', viewerViewedState: 'UNVIEWED' }],
      pageInfo: { hasNextPage: false, endCursor: null },
    } } } }
    return { value: { exitCode: 0, stdout: JSON.stringify(page), stderr: '' } } as never
  })
  on('fs.read', async () => ({ value: '' }) as never)
  on('command.register', async (_, e) => ({ value: { command: e.name } }) as never)
  on('session.start', async () => ({ cwd: ROOT }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', async () => ({ value: undefined }) as never)

  await $.session.start({ source: 'startup', cwd: ROOT } as never)
  await $.command.run({ command: 'diff-review', args: '', presentation: { isFullscreen: true, columns: 300 } } as never)
  const pane = await $.ui.mount({
    plugin: 'diff-review',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'diff-review',
    props: { title: 'Review', isFocused: true, bodyColumns: 200, placement: 'dock' } as never,
  })
  expect(await pane.find({ key: 'viewed-src/Total.php' })).toBeUndefined()

  await pane.press({ key: 'view-pr' })
  expect(await pane.find({ type: 'Text', text: /PR #42/ })).toBeDefined()
  expect(await pane.find({ type: 'Button', text: 'Overview' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /^#42 / })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /\+7 -1  ·  2 files/ })).toBeDefined()
  await pane.press({ key: 'navigate-s' })
  expect(await pane.find({ type: 'Text', text: /^src\/Tax\.php$/ })).toBeDefined()
  await pane.press({ key: 'navigate-z' })
  expect(await pane.find({ type: 'Text', text: /^#42 / })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /viewed 1\/2/ })).toBeDefined()
  expect((await pane.find({ key: 'viewed-src/Tax.php' }))?.text).toBe('[✓]')
  expect((await pane.find({ key: 'viewed-src/Total.php' }))?.text).toBe('[ ]')

  await pane.press({ key: 'viewed-src/Total.php' })
  expect(githubMutations).toEqual(['mark'])
  expect((await pane.find({ key: 'viewed-src/Total.php' }))?.text).toBe('[✓]')
  expect(await pane.find({ type: 'Text', text: /viewed 2\/2/ })).toBeDefined()

  isGithubRefusing = true
  await pane.press({ key: 'viewed-src/Total.php' })
  expect(githubMutations).toEqual(['mark', 'unmark'])
  expect((await pane.find({ key: 'viewed-src/Total.php' }))?.text).toBe('[✓]')
  await pane.unmount()
})

test('the inline close buttons are full buttons, and q closes the whole pane', async ($, on) => {
  const closedPaneIds: string[] = []
  mock.clock(on, { now: 1000 })
  on('process.run', async (_, e) => ({ value: { ...answerGit(e.argv.slice(1)), stderr: '' } }) as never)
  on('fs.read', async () => ({ value: '' }) as never)
  on('command.register', async (_, e) => ({ value: { command: e.name } }) as never)
  on('session.start', async () => ({ cwd: ROOT }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.close', async (_, e) => {
    closedPaneIds.push(e.id)
    return { value: undefined } as never
  })
  on('session.append', async (_, e) => ({ value: { message: e.message, uuid: 'row' } }) as never)
  on('prompt.submit', async (_, e) => ({ text: e.text }) as never)

  await $.session.start({ source: 'startup', cwd: ROOT } as never)
  await $.command.run({ command: 'diff-review', args: '', presentation: { isFullscreen: true, columns: 300 } } as never)
  const pane = await $.ui.mount({
    plugin: 'diff-review',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'diff-review',
    props: { title: 'Review', isFocused: true, bodyColumns: 200, placement: 'dock' } as never,
  })
  await pane.press({ key: 'file-src/Total.php' })
  await pane.press({ key: 'ask-3' })
  expect(await pane.find({ type: 'Button', text: '× cancel' })).toBeDefined()
  await pane.input({ key: await questionFieldKey(pane), text: 'Why 2?' })
  expect(await pane.find({ type: 'Button', text: '× close' })).toBeDefined()

  await pane.press({ key: 'close' })
  expect(closedPaneIds).toEqual(['diff-review'])
  await pane.unmount()
})

test('z/w and s walk the files, q/a and d walk the views, on AZERTY and QWERTY alike', async ($, on) => {
  mock.clock(on, { now: 1000 })
  on('process.run', async (_, e) => ({ value: { ...answerGit(e.argv.slice(1)), stderr: '' } }) as never)
  on('fs.read', async () => ({ value: 'hello\n' }) as never)
  on('command.register', async (_, e) => ({ value: { command: e.name } }) as never)
  on('session.start', async () => ({ cwd: ROOT }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)

  await $.session.start({ source: 'startup', cwd: ROOT } as never)
  await $.command.run({ command: 'diff-review', args: '', presentation: { isFullscreen: true, columns: 300 } } as never)
  const pane = await $.ui.mount({
    plugin: 'diff-review',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'diff-review',
    props: { title: 'Review', isFocused: true, bodyColumns: 200, placement: 'dock' } as never,
  })
  const selectedFileHeader = async () => (await pane.findAll({ type: 'Text', text: /^(notes\.md|src\/Total\.php|src\/Tax\.php)$/ }))[0]?.text

  expect(await selectedFileHeader()).toBe('notes.md')
  await pane.press({ key: 'navigate-s' })
  expect(await selectedFileHeader()).toBe('src/Total.php')
  await pane.press({ key: 'navigate-s' })
  expect(await selectedFileHeader()).toBe('src/Total.php')
  await pane.press({ key: 'navigate-z' })
  expect(await selectedFileHeader()).toBe('notes.md')
  await pane.press({ key: 'navigate-s' })
  await pane.press({ key: 'navigate-w' })
  expect(await selectedFileHeader()).toBe('notes.md')

  await pane.press({ key: 'navigate-d' })
  expect(await pane.find({ type: 'Button', text: 'Tax.php' })).toBeDefined()
  await pane.press({ key: 'navigate-d' })
  expect(await pane.find({ type: 'Text', text: 'Branch commits' })).toBeDefined()
  await pane.press({ key: 'navigate-q' })
  await pane.press({ key: 'navigate-a' })
  expect(await pane.find({ type: 'Button', text: 'notes.md' })).toBeDefined()
  await pane.unmount()
})

test('an AZERTY keyboard gets z q s d alone', async ($, on) => {
  mock.clock(on, { now: 1000 })
  on('process.run', async (_, e) => {
    if (e.argv[0] === 'gsettings') {
      return { value: { exitCode: 0, stdout: "[('xkb', 'fr')]\n", stderr: '' } } as never
    }
    return { value: { ...answerGit(e.argv.slice(1)), stderr: '' } } as never
  })
  on('fs.read', async () => ({ value: 'hello\n' }) as never)
  on('command.register', async (_, e) => ({ value: { command: e.name } }) as never)
  on('session.start', async () => ({ cwd: ROOT }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)

  await $.session.start({ source: 'startup', cwd: ROOT } as never)
  await $.command.run({ command: 'diff-review', args: '', presentation: { isFullscreen: true, columns: 300 } } as never)
  const pane = await $.ui.mount({
    plugin: 'diff-review',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'diff-review',
    props: { title: 'Review', isFocused: true, bodyColumns: 200, placement: 'dock' } as never,
  })
  for (const azertyKey of ['z', 'q', 's', 'd']) {
    expect(await pane.find({ key: `navigate-${azertyKey}` })).toBeDefined()
  }
  for (const qwertyOnlyKey of ['w', 'a']) {
    expect(await pane.find({ key: `navigate-${qwertyOnlyKey}` })).toBeUndefined()
  }
  await pane.unmount()
})

test('the wheel scrolls the diff or the file list under the pointer, the other one stays put', async ($, on) => {
  const longDiff = ['@@ -1,0 +1,120 @@', ...Array.from({ length: 120 }, (_, index) => `+line ${index + 1}`)].join('\n')
  mock.clock(on, { now: 1000 })
  on('process.run', async (_, e) => {
    const gitArguments = e.argv.slice(1).filter(argument => argument !== '-C' && argument !== ROOT)
    if (gitArguments[0] === 'ls-files') {
      return { value: { exitCode: 0, stdout: Array.from({ length: 40 }, (_, index) => `zz-docs/note-${String(index).padStart(2, '0')}.md`).join('\n'), stderr: '' } } as never
    }
    if (gitArguments[0] === 'diff' && gitArguments[1] === '--no-color') {
      return { value: { exitCode: 0, stdout: longDiff, stderr: '' } } as never
    }
    return { value: { ...answerGit(e.argv.slice(1)), stderr: '' } } as never
  })
  on('fs.read', async () => ({ value: 'hello\n' }) as never)
  on('command.register', async (_, e) => ({ value: { command: e.name } }) as never)
  on('session.start', async () => ({ cwd: ROOT }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)

  await $.session.start({ source: 'startup', cwd: ROOT } as never)
  await $.command.run({ command: 'diff-review', args: '', presentation: { isFullscreen: true, columns: 300 } } as never)
  const paneTarget = {
    plugin: 'diff-review',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'diff-review',
    props: { title: 'Review', isFocused: true, bodyColumns: 200, placement: 'dock', scroll: { offset: 0, bodyRows: 30 } } as never,
  } as const
  let pane = await $.ui.mount(paneTarget)
  expect(await pane.find({ type: 'Code', text: /^line 1$/ })).toBeDefined()
  expect(await pane.find({ type: 'Button', text: 'Total.php' })).toBeDefined()

  const wheel = (column: number, by: number) =>
    $.ui.scroll({ component: 'Pane', requestId: 'diff-review', offset: 0, by, bodyRows: 30, contentRows: 30, origin: { kind: 'person' }, pointer: { column, row: 10 } } as never)

  await pane.unmount()
  await wheel(120, 2)
  pane = await $.ui.mount(paneTarget)
  expect(await pane.find({ type: 'Code', text: /^line 1$/ })).toBeUndefined()
  expect(await pane.find({ type: 'Code', text: /^line 7$/ })).toBeDefined()
  expect(await pane.find({ type: 'Button', text: 'Total.php' })).toBeDefined()

  await pane.unmount()
  await wheel(10, 3)
  pane = await $.ui.mount(paneTarget)
  expect(await pane.find({ type: 'Button', text: 'Total.php' })).toBeUndefined()
  expect(await pane.find({ type: 'Code', text: /^line 7$/ })).toBeDefined()
  await pane.unmount()
})

test('a PR targeting a release branch is compared to that branch, not to the default one', async ($, on) => {
  mock.clock(on, { now: 1000 })
  on('process.run', async (_, e) => {
    if (e.argv[0] === 'gh') {
      if (e.argv[1] === 'pr') {
        return { value: { exitCode: 0, stdout: '{"id":"PR_9","number":9,"url":"https://github.com/o/r/pull/9","baseRefName":"2026-09"}', stderr: '' } } as never
      }
      return { value: { exitCode: 0, stdout: '{"data":{"node":{"files":{"nodes":[],"pageInfo":{"hasNextPage":false}}}}}', stderr: '' } } as never
    }
    const command = e.argv.slice(1).filter(argument => argument !== '-C' && argument !== ROOT).join(' ')
    if (command === 'merge-base HEAD origin/2026-09') return { value: { exitCode: 0, stdout: 'release0\n', stderr: '' } } as never
    if (command === 'diff --numstat --no-renames release0 HEAD') return { value: { exitCode: 0, stdout: '5\t0\tsrc/Tax.php\n', stderr: '' } } as never
    return { value: { ...answerGit(e.argv.slice(1)), stderr: '' } } as never
  })
  on('fs.read', async () => ({ value: '' }) as never)
  on('command.register', async (_, e) => ({ value: { command: e.name } }) as never)
  on('session.start', async () => ({ cwd: ROOT }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)

  await $.session.start({ source: 'startup', cwd: ROOT } as never)
  await $.command.run({ command: 'diff-review', args: '', presentation: { isFullscreen: true, columns: 300 } } as never)
  const pane = await $.ui.mount({
    plugin: 'diff-review',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'diff-review',
    props: { title: 'Review', isFocused: true, bodyColumns: 200, placement: 'dock' } as never,
  })
  await pane.press({ key: 'view-pr' })
  expect(await pane.find({ type: 'Button', text: 'Tax.php' })).toBeDefined()
  expect(await pane.find({ type: 'Button', text: 'Total.php' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /base release0/ })).toBeDefined()
  await pane.unmount()
})

test('a question can be asked on a block of the PR overview', async ($, on) => {
  const submittedPrompts: string[] = []
  mock.clock(on, { now: 1000 })
  on('process.run', async (_, e) => {
    if (e.argv[0] === 'gh' && e.argv[1] === 'pr') {
      return { value: { exitCode: 0, stdout: JSON.stringify({ id: 'PR_1', number: 42, url: 'https://github.com/o/r/pull/42', title: 'Add tax', body: 'Adds the VAT on every invoice.' }), stderr: '' } } as never
    }
    if (e.argv[0] === 'gh') {
      return { value: { exitCode: 1, stdout: '', stderr: 'offline' } } as never
    }
    return { value: { ...answerGit(e.argv.slice(1)), stderr: '' } } as never
  })
  on('fs.read', async () => ({ value: '' }) as never)
  on('command.register', async (_, e) => ({ value: { command: e.name } }) as never)
  on('session.start', async () => ({ cwd: ROOT }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', async () => ({ value: undefined }) as never)
  on('prompt.submit', async (_, e) => {
    submittedPrompts.push(e.text)
    return { text: e.text } as never
  })

  await $.session.start({ source: 'startup', cwd: ROOT } as never)
  await $.command.run({ command: 'diff-review', args: '', presentation: { isFullscreen: true, columns: 300 } } as never)
  const pane = await $.ui.mount({
    plugin: 'diff-review',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'diff-review',
    props: { title: 'Review', isFocused: true, bodyColumns: 200, placement: 'dock' } as never,
  })
  await pane.press({ key: 'view-pr' })
  expect(await pane.find({ type: 'Markdown', text: 'Adds the VAT on every invoice.' })).toBeDefined()
  const descriptionBlockKey = (await pane.findAll({ type: 'Button', text: '[+]' }))
    .map(button => button.key ?? '')
    .find(key => key.startsWith('ask-overview-'))
  expect(descriptionBlockKey).toBeDefined()
  await pane.press({ key: 'ask-overview-2' })
  await pane.input({ key: await questionFieldKey(pane), text: 'Why every invoice?' })
  expect(submittedPrompts).toEqual(['Why every invoice?'])
  expect(await pane.find({ type: 'Text', text: /> Why every invoice\?/ })).toBeDefined()
  await pane.unmount()
})

test('a thread takes replies, each answered in place, and flags a cleared conversation', async ($, on) => {
  const submittedPrompts: string[] = []
  const submittedContexts: Array<readonly string[] | undefined> = []
  mock.clock(on, { now: 1000 })
  on('process.run', async (_, e) => ({ value: { ...answerGit(e.argv.slice(1)), stderr: '' } }) as never)
  on('fs.read', async () => ({ value: '' }) as never)
  on('command.register', async (_, e) => ({ value: { command: e.name } }) as never)
  on('session.start', async () => ({ cwd: ROOT }) as never)
  on('session.end', async (_, e) => ({ sessionId: e.sessionId }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', async () => ({ value: undefined }) as never)
  on('prompt.submit', async (_, e) => {
    submittedPrompts.push(e.text)
    submittedContexts.push(e.context)
    return { text: e.text, context: e.context } as never
  })
  on('turn.start', async (_, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)

  await $.session.start({ source: 'startup', cwd: ROOT } as never)
  await $.command.run({ command: 'diff-review', args: '', presentation: { isFullscreen: true, columns: 300 } } as never)
  const paneTarget = {
    plugin: 'diff-review',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'diff-review',
    props: { title: 'Review', isFocused: true, bodyColumns: 200, placement: 'dock' } as never,
  } as const
  let pane = await $.ui.mount(paneTarget)
  await pane.press({ key: 'file-src/Total.php' })
  await pane.press({ key: 'ask-3' })
  await pane.input({ key: await questionFieldKey(pane), text: 'Why 2?' })
  await $.turn.start({ text: 'Why 2?', turnId: 'turn-1' } as never)
  await $.turn.complete({ turnId: 'turn-1', answer: 'Because the total doubled.', durationMs: 1, isAborted: false, reason: 'answer' } as never)
  await pane.unmount()

  pane = await $.ui.mount(paneTarget)
  expect(await pane.find({ type: 'Markdown', text: 'Because the total doubled.' })).toBeDefined()
  const replyKey = (await pane.findAll({ type: 'Input' })).map(input => input.key ?? '').find(key => key.startsWith('reply-')) ?? ''
  expect(replyKey).not.toBe('')
  await pane.input({ key: replyKey, text: 'And the tax?' })
  expect(submittedPrompts).toEqual(['Why 2?', 'And the tax?'])
  expect(await pane.find({ type: 'Text', text: /> And the tax\?/ })).toBeDefined()
  await $.turn.start({ text: 'And the tax?', turnId: 'turn-2' } as never)
  await $.turn.complete({ turnId: 'turn-2', answer: 'Added after.', durationMs: 1, isAborted: false, reason: 'answer' } as never)
  await pane.unmount()

  await $.session.end({ reason: 'clear', sessionId: 's1' } as never)
  pane = await $.ui.mount(paneTarget)
  expect(await pane.find({ type: 'Markdown', text: 'Added after.' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Conversation cleared since/ })).toBeDefined()

  const dictateReplyKey = (await pane.findAll({ type: 'Button', text: '↓ dictate in prompt' }))[0]?.key ?? ''
  await pane.press({ key: dictateReplyKey })
  expect(await pane.find({ type: 'Text', text: /Ask from the prompt below/ })).toBeDefined()
  await $.prompt.submit({ text: 'Dictated follow-up', origin: { kind: 'composer' } } as never)
  expect(submittedContexts[submittedContexts.length - 1]?.[0]).toContain('follows up in the review thread')
  expect(submittedContexts[submittedContexts.length - 1]?.[0]).toContain('Because the total doubled.')
  expect(await pane.find({ type: 'Text', text: /> Dictated follow-up/ })).toBeDefined()
  await pane.unmount()
})

test('new files can be marked one by one or all at once, then added to the index', async ($, on) => {
  const gitAddCalls: string[][] = []
  mock.clock(on, { now: 1000 })
  on('process.run', async (_, e) => {
    const gitArguments = e.argv.slice(1).filter(argument => argument !== '-C' && argument !== ROOT)
    if (gitArguments[0] === 'add') {
      gitAddCalls.push(gitArguments.slice(2))
      return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
    }
    if (gitArguments[0] === 'ls-files') {
      return { value: { exitCode: 0, stdout: 'notes.md\ntodo.md\n', stderr: '' } } as never
    }
    return { value: { ...answerGit(e.argv.slice(1)), stderr: '' } } as never
  })
  on('fs.read', async () => ({ value: 'hello\n' }) as never)
  on('command.register', async (_, e) => ({ value: { command: e.name } }) as never)
  on('session.start', async () => ({ cwd: ROOT }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', async () => ({ value: undefined }) as never)

  await $.session.start({ source: 'startup', cwd: ROOT } as never)
  await $.command.run({ command: 'diff-review', args: '', presentation: { isFullscreen: true, columns: 300 } } as never)
  const pane = await $.ui.mount({
    plugin: 'diff-review',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'diff-review',
    props: { title: 'Review', isFocused: true, bodyColumns: 200, placement: 'dock' } as never,
  })
  expect(await pane.find({ key: 'mark-src/Total.php' })).toBeUndefined()

  await pane.press({ key: 'mark-todo.md' })
  expect((await pane.find({ key: 'mark-todo.md' }))?.text).toBe('x')
  expect(await pane.find({ type: 'Button', text: 'git add (1)' })).toBeDefined()
  await pane.press({ key: 'stage' })
  expect(gitAddCalls).toEqual([['todo.md']])

  await pane.press({ key: 'mark-all' })
  await pane.press({ key: 'stage' })
  expect(gitAddCalls[1]).toEqual(['notes.md', 'todo.md'])

  await pane.press({ key: 'stage' })
  expect(gitAddCalls[2]).toEqual(['notes.md'])

  await pane.press({ key: 'stage-all' })
  expect(gitAddCalls[3]).toEqual([])
  await pane.unmount()
})

test('a question armed on a line is asked from the main prompt, with the line as its context', async ($, on) => {
  const submittedPrompts: Array<{ text: string; context?: readonly string[] }> = []
  mock.clock(on, { now: 1000 })
  on('process.run', async (_, e) => ({ value: { ...answerGit(e.argv.slice(1)), stderr: '' } }) as never)
  on('fs.read', async () => ({ value: '' }) as never)
  on('command.register', async (_, e) => ({ value: { command: e.name } }) as never)
  on('session.start', async () => ({ cwd: ROOT }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('ui.toast', async () => ({ value: undefined }) as never)
  on('prompt.submit', async (_, e) => {
    submittedPrompts.push({ text: e.text, context: e.context })
    return { text: e.text, context: e.context } as never
  })

  await $.session.start({ source: 'startup', cwd: ROOT } as never)
  await $.command.run({ command: 'diff-review', args: '', presentation: { isFullscreen: true, columns: 300 } } as never)
  const pane = await $.ui.mount({
    plugin: 'diff-review',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'diff-review',
    props: { title: 'Review', isFocused: true, bodyColumns: 200, placement: 'dock' } as never,
  })
  await pane.press({ key: 'file-src/Total.php' })
  await pane.press({ key: 'ask-3' })
  await pane.press({ key: 'ask-from-prompt' })
  expect(await pane.find({ type: 'Input' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /Ask from the prompt below/ })).toBeDefined()

  await $.prompt.submit({ text: 'Why 2 here?', origin: { kind: 'composer' } } as never)
  expect(submittedPrompts[0]?.text).toBe('Why 2 here?')
  expect(submittedPrompts[0]?.context?.[0]).toContain('src/Total.php, line 2 (added)')
  expect(await pane.find({ type: 'Text', text: /Ask from the prompt below/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /> Why 2 here\?/ })).toBeDefined()

  await $.prompt.submit({ text: 'Unrelated question', origin: { kind: 'composer' } } as never)
  expect(submittedPrompts[1]?.context).toBeUndefined()

  await pane.press({ key: 'ask-2' })
  await pane.press({ key: 'ask-from-prompt' })
  await $.prompt.submit({ text: 'From the attached terminal', origin: { kind: 'unclassified' } } as never)
  expect(submittedPrompts[2]?.context?.[0]).toContain('src/Total.php')

  await pane.press({ key: 'ask-2' })
  await pane.press({ key: 'ask-from-prompt' })
  await pane.press({ key: 'ask-3' })
  expect(await pane.find({ type: 'Text', text: /Ask from the prompt below/ })).toBeUndefined()
  await $.prompt.submit({ text: 'Plain message', origin: { kind: 'composer' } } as never)
  expect(submittedPrompts[3]?.context).toBeUndefined()
  await pane.unmount()
})

test('with a thread under its last lines, the diff scrolls past its end to show it', async ($, on) => {
  const longDiff = ['@@ -1,0 +1,60 @@', ...Array.from({ length: 60 }, (_, index) => `+line ${index + 1}`)].join('\n')
  mock.clock(on, { now: 1000 })
  on('process.run', async (_, e) => {
    const gitArguments = e.argv.slice(1).filter(argument => argument !== '-C' && argument !== ROOT)
    if (gitArguments[0] === 'diff' && gitArguments[1] === '--no-color') {
      return { value: { exitCode: 0, stdout: longDiff, stderr: '' } } as never
    }
    if (gitArguments[0] === 'ls-files') {
      return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
    }
    return { value: { ...answerGit(e.argv.slice(1)), stderr: '' } } as never
  })
  on('fs.read', async () => ({ value: '' }) as never)
  on('command.register', async (_, e) => ({ value: { command: e.name } }) as never)
  on('session.start', async () => ({ cwd: ROOT }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
  on('prompt.submit', async (_, e) => ({ text: e.text }) as never)

  await $.session.start({ source: 'startup', cwd: ROOT } as never)
  await $.command.run({ command: 'diff-review', args: '', presentation: { isFullscreen: true, columns: 300 } } as never)
  const paneTarget = {
    plugin: 'diff-review',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'diff-review',
    props: { title: 'Review', isFocused: true, bodyColumns: 200, placement: 'dock', scroll: { offset: 0, bodyRows: 30 } } as never,
  } as const
  const wheelDown = () =>
    $.ui.scroll({ component: 'Pane', requestId: 'diff-review', offset: 0, by: 10, bodyRows: 30, contentRows: 30, origin: { kind: 'person' }, pointer: { column: 120, row: 10 } } as never)

  let pane = await $.ui.mount(paneTarget)
  await pane.unmount()
  for (let tick = 0; tick < 3; tick += 1) await wheelDown()
  pane = await $.ui.mount(paneTarget)
  await pane.press({ key: 'ask-60' })
  await pane.input({ key: await questionFieldKey(pane), text: 'Why the last line?' })
  await pane.unmount()

  for (let tick = 0; tick < 3; tick += 1) await wheelDown()
  pane = await $.ui.mount(paneTarget)
  expect(await pane.find({ type: 'Code', text: /^line 60$/ })).toBeDefined()
  expect(await pane.find({ type: 'Code', text: /^line 30$/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /> Why the last line\?/ })).toBeDefined()
  await pane.unmount()
})

test('a pane narrower than the minimum asks to be widened, and long lines wrap instead of being cut', async ($, on) => {
  mock.clock(on, { now: 1000 })
  on('process.run', async (_, e) => ({ value: { ...answerGit(e.argv.slice(1)), stderr: '' } }) as never)
  on('fs.read', async () => ({ value: '' }) as never)
  on('command.register', async (_, e) => ({ value: { command: e.name } }) as never)
  on('session.start', async () => ({ cwd: ROOT }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)

  await $.session.start({ source: 'startup', cwd: ROOT } as never)
  await $.command.run({ command: 'diff-review', args: '', presentation: { isFullscreen: true, columns: 300 } } as never)
  const paneTarget = (bodyColumns: number) => ({
    plugin: 'diff-review',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'diff-review',
    props: { title: 'Review', isFocused: true, bodyColumns, placement: 'dock' } as never,
  }) as const
  const narrowPane = await $.ui.mount(paneTarget(62))
  expect(await narrowPane.find({ type: 'Text', text: /needs at least 80 columns \(now 62\)/ })).toBeDefined()
  expect(await narrowPane.find({ type: 'Button', text: 'Total.php' })).toBeUndefined()
  await narrowPane.unmount()

  const widePane = await $.ui.mount(paneTarget(200))
  await widePane.press({ key: 'file-src/Total.php' })
  const codeLine = await widePane.find({ type: 'Code', text: '$tax = 0.2;' })
  expect((codeLine?.props as { wrap?: string } | undefined)?.wrap).toBe('wrap')
  await widePane.unmount()
})

test('dragging the divider sets the width of the file list, within bounds', async ($, on) => {
  mock.clock(on, { now: 1000 })
  mock.store(on)
  on('process.run', async (_, e) => ({ value: { ...answerGit(e.argv.slice(1)), stderr: '' } }) as never)
  on('fs.read', async () => ({ value: '' }) as never)
  on('command.register', async (_, e) => ({ value: { command: e.name } }) as never)
  on('session.start', async () => ({ cwd: ROOT }) as never)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as never)

  await $.session.start({ source: 'startup', cwd: ROOT } as never)
  await $.command.run({ command: 'diff-review', args: '', presentation: { isFullscreen: true, columns: 300 } } as never)
  const paneTarget = {
    plugin: 'diff-review',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'diff-review',
    props: { title: 'Review', isFocused: true, bodyColumns: 200, placement: 'dock' } as never,
  } as const
  const fileListWidthOf = async (mounted: { findAll: (query: { type: 'Box' }) => Promise<Array<{ props: unknown; text?: string }>> }) =>
    (await mounted.findAll({ type: 'Box' }))
      .map(box => box.props as { width?: number; borderStyle?: string })
      .find(props => props.borderStyle === 'round' && typeof props.width === 'number' && props.width >= 24)?.width

  let pane = await $.ui.mount(paneTarget)
  expect(await fileListWidthOf(pane)).toBe(50)
  await pane.pointer({ type: 'down', x: 0, y: 5, button: 'left', in: 'file-divider' } as never)
  await pane.pointer({ type: 'up', x: 20, y: 5, button: 'left', in: 'file-divider' } as never)
  await pane.unmount()
  pane = await $.ui.mount(paneTarget)
  expect(await fileListWidthOf(pane)).toBe(70)

  await pane.pointer({ type: 'down', x: 0, y: 5, button: 'left', in: 'file-divider' } as never)
  await pane.pointer({ type: 'up', x: -200, y: 5, button: 'left', in: 'file-divider' } as never)
  await pane.unmount()
  pane = await $.ui.mount(paneTarget)
  expect(await fileListWidthOf(pane)).toBe(24)
  await pane.unmount()
})
