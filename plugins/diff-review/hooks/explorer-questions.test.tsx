import { expect, test } from 'claude-code/testing'

import {
  answerTurn,
  focusElement,
  hasQuestionField,
  keyStartingWith,
  mountPane,
  openExplorer,
  questionFieldKey,
  stubWorld,
  wheel,
} from './test-support'

test('a question opened on a line reaches the conversation and its thread can be closed', async ($, on) => {
  const world = stubWorld(on)
  await openExplorer($)
  const pane = await mountPane($)
  await pane.press({ key: 'file-src/Total.php' })

  await pane.press({ key: 'line-3' })
  expect(await hasQuestionField(pane)).toBe(true)
  await pane.press({ key: 'cancel-question' })
  expect(await hasQuestionField(pane)).toBe(false)

  await pane.press({ key: 'ask-3' })
  expect(await pane.find({ type: 'Button', text: '× cancel' })).toBeDefined()
  await pane.input({ key: await questionFieldKey(pane), text: 'Why 2?' })
  expect(world.submittedPrompts.map(prompt => prompt.text)).toEqual(['Why 2?'])
  expect(await pane.find({ type: 'Text', text: /› Why 2\?/ })).toBeDefined()

  await pane.press({ key: await keyStartingWith(pane, 'Button', 'dismiss-') })
  expect(await pane.find({ type: 'Text', text: /› Why 2\?/ })).toBeUndefined()
  await pane.unmount()
})

test('an empty question closes when the pane loses the keyboard or the focus moves on, a started one stays', async ($, on) => {
  stubWorld(on, { withFocus: true })
  await openExplorer($)

  const paneWithoutKeyboard = await mountPane($, { isFocused: false })
  await paneWithoutKeyboard.press({ key: 'file-src/Total.php' })
  await focusElement($, 'ask-3')
  await paneWithoutKeyboard.press({ key: 'ask-3' })
  expect(await hasQuestionField(paneWithoutKeyboard)).toBe(true)
  await paneWithoutKeyboard.unmount()

  const focusedPane = await mountPane($)
  await focusElement($, 'question-1')
  expect(await hasQuestionField(focusedPane)).toBe(true)
  await focusedPane.unmount()

  const unfocusedPane = await mountPane($, { isFocused: false })
  expect(await hasQuestionField(unfocusedPane)).toBe(false)
  await unfocusedPane.unmount()

  await focusElement($, 'view-pr')
  const refocusedPane = await mountPane($)
  expect(await hasQuestionField(refocusedPane)).toBe(false)
  await refocusedPane.press({ key: 'ask-3' })
  await refocusedPane.input({ key: await questionFieldKey(refocusedPane), text: 'Why', kind: 'change' })
  await refocusedPane.unmount()

  const paneWithDraft = await mountPane($, { isFocused: false })
  expect(await hasQuestionField(paneWithDraft)).toBe(true)
  await paneWithDraft.unmount()
})

test('a thread takes replies, each answered in place, and flags a cleared conversation', async ($, on) => {
  const world = stubWorld(on)
  await openExplorer($)
  let pane = await mountPane($)
  await pane.press({ key: 'file-src/Total.php' })
  await pane.press({ key: 'ask-3' })
  await pane.input({ key: await questionFieldKey(pane), text: 'Why 2?' })
  await answerTurn($, 'turn-1', 'Why 2?', 'Because the total doubled.')
  await pane.unmount()

  pane = await mountPane($)
  expect(await pane.find({ type: 'Markdown', text: 'Because the total doubled.' })).toBeDefined()
  await pane.input({ key: await keyStartingWith(pane, 'Input', 'reply-'), text: 'And the tax?' })
  expect(world.submittedPrompts.map(prompt => prompt.text)).toEqual(['Why 2?', 'And the tax?'])
  expect(await pane.find({ type: 'Text', text: /› And the tax\?/ })).toBeDefined()
  await answerTurn($, 'turn-2', 'And the tax?', 'Added after.')
  await pane.unmount()

  await $.session.end({ reason: 'clear', sessionId: 's1' } as never)
  pane = await mountPane($)
  expect(await pane.find({ type: 'Markdown', text: 'Added after.' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Conversation cleared since/ })).toBeDefined()

  await pane.press({ key: await keyStartingWith(pane, 'Button', 'dictate-reply-') })
  expect(await pane.find({ type: 'Text', text: /Ask from the prompt below/ })).toBeDefined()
  await $.prompt.submit({ text: 'Dictated follow-up', origin: { kind: 'composer' } } as never)
  const followUpContext = world.submittedPrompts[world.submittedPrompts.length - 1]?.context?.[0]
  expect(followUpContext).toContain('follows up in the review thread')
  expect(followUpContext).toContain('Because the total doubled.')
  expect(await pane.find({ type: 'Text', text: /› Dictated follow-up/ })).toBeDefined()
  await pane.unmount()
})

test('a question armed on a line is asked from the main prompt, with the line as its context', async ($, on) => {
  const world = stubWorld(on)
  await openExplorer($)
  const pane = await mountPane($)
  await pane.press({ key: 'file-src/Total.php' })
  await pane.press({ key: 'ask-3' })
  await pane.press({ key: 'dictate-question' })
  expect(await hasQuestionField(pane)).toBe(false)
  expect(await pane.find({ type: 'Text', text: /Ask from the prompt below/ })).toBeDefined()

  await $.prompt.submit({ text: 'Why 2 here?', origin: { kind: 'composer' } } as never)
  expect(world.submittedPrompts[0]?.text).toBe('Why 2 here?')
  expect(world.submittedPrompts[0]?.context?.[0]).toContain('src/Total.php, line 2 (added)')
  expect(await pane.find({ type: 'Text', text: /Ask from the prompt below/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /› Why 2 here\?/ })).toBeDefined()

  await $.prompt.submit({ text: 'Unrelated question', origin: { kind: 'composer' } } as never)
  expect(world.submittedPrompts[1]?.context).toBeUndefined()

  await pane.press({ key: 'ask-2' })
  await pane.press({ key: 'dictate-question' })
  await $.prompt.submit({ text: 'From the attached terminal', origin: { kind: 'unclassified' } } as never)
  expect(world.submittedPrompts[2]?.context?.[0]).toContain('src/Total.php')

  await pane.press({ key: 'ask-2' })
  await pane.press({ key: 'dictate-question' })
  await pane.press({ key: 'ask-3' })
  expect(await pane.find({ type: 'Text', text: /Ask from the prompt below/ })).toBeUndefined()
  await $.prompt.submit({ text: 'Plain message', origin: { kind: 'composer' } } as never)
  expect(world.submittedPrompts[3]?.context).toBeUndefined()
  await pane.unmount()
})

test('the down arrow from a question field arms it for the main prompt, the cancel button comes after', async ($, on) => {
  stubWorld(on, { withFocus: true })
  await openExplorer($)
  const pane = await mountPane($)
  await pane.press({ key: 'file-src/Total.php' })
  await pane.press({ key: 'ask-3' })
  const fieldKey = await questionFieldKey(pane)
  const focusOrder = (await pane.findAll({}))
    .filter(element => element.type === 'Input' || element.type === 'Button')
    .map(element => element.key)
  expect(focusOrder.indexOf('dictate-question')).toBe(focusOrder.indexOf(fieldKey) + 1)
  expect(focusOrder.indexOf('cancel-question')).toBe(focusOrder.indexOf(fieldKey) + 2)

  await focusElement($, fieldKey)
  await focusElement($, 'dictate-question')
  expect(await hasQuestionField(pane)).toBe(false)
  expect(await pane.find({ type: 'Text', text: /Ask from the prompt below/ })).toBeDefined()
  await pane.unmount()
})

test('with a thread under its last lines, the diff scrolls past its end to show it', async ($, on) => {
  const longDiff = ['@@ -1,0 +1,60 @@', ...Array.from({ length: 60 }, (_, index) => `+line ${index + 1}`)].join('\n')
  stubWorld(on, {
    git: gitCommand => {
      if (gitCommand.startsWith('diff --no-color')) return { exitCode: 0, stdout: longDiff }
      if (gitCommand.startsWith('ls-files')) return { exitCode: 0, stdout: '' }
      return undefined
    },
  })
  await openExplorer($)
  const scrollToEnd = async () => {
    for (let tick = 0; tick < 3; tick += 1) await wheel($, 120, 10)
  }

  let pane = await mountPane($, { bodyRows: 30 })
  await pane.unmount()
  await scrollToEnd()
  pane = await mountPane($, { bodyRows: 30 })
  await pane.press({ key: 'ask-60' })
  await pane.input({ key: await questionFieldKey(pane), text: 'Why the last line?' })
  await pane.unmount()

  await scrollToEnd()
  pane = await mountPane($, { bodyRows: 30 })
  expect(await pane.find({ type: 'Code', text: /^line 60$/ })).toBeDefined()
  expect(await pane.find({ type: 'Code', text: /^line 30$/ })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /› Why the last line\?/ })).toBeDefined()
  await pane.unmount()
})

test('a long answer under the last line scrolls a few lines at a time until its end is on top', async ($, on) => {
  const longDiff = ['@@ -1,0 +1,60 @@', ...Array.from({ length: 60 }, (_, index) => `+line ${index + 1}`)].join('\n')
  stubWorld(on, {
    git: gitCommand => {
      if (gitCommand.startsWith('diff --no-color')) return { exitCode: 0, stdout: longDiff }
      if (gitCommand.startsWith('ls-files')) return { exitCode: 0, stdout: '' }
      return undefined
    },
  })
  await openExplorer($)
  const longAnswer = Array.from({ length: 40 }, (_, index) => `answer line ${index + 1}`).join('\n\n')
  const skippedLinesOf = async (pane: Awaited<ReturnType<typeof mountPane>>) =>
    Math.max(0, ...(await pane.findAll({ type: 'Box' })).map(box => -Number((box.props as { marginTop?: number }).marginTop ?? 0)))

  let pane = await mountPane($, { bodyRows: 30 })
  await pane.unmount()
  for (let tick = 0; tick < 3; tick += 1) await wheel($, 120, 10)
  pane = await mountPane($, { bodyRows: 30 })
  await pane.press({ key: 'ask-60' })
  await pane.input({ key: await questionFieldKey(pane), text: 'Why the last line?' })
  await answerTurn($, 'turn-1', 'Why the last line?', longAnswer)
  await pane.unmount()

  const scrollOneTick = async () => {
    await wheel($, 120, 1)
    const scrolledPane = await mountPane($, { bodyRows: 30 })
    const skippedLines = await skippedLinesOf(scrolledPane)
    const isLastLineShown = (await scrolledPane.find({ type: 'Code', text: /^line 60$/ })) !== undefined
    await scrolledPane.unmount()
    return { skippedLines, isLastLineShown }
  }
  let scrolled = await scrollOneTick()
  for (let tick = 0; tick < 20 && scrolled.skippedLines === 0; tick += 1) scrolled = await scrollOneTick()
  expect(scrolled.isLastLineShown).toBe(true)
  const nextScrolled = await scrollOneTick()
  expect(nextScrolled).toEqual({ skippedLines: scrolled.skippedLines + 3, isLastLineShown: true })

  for (let tick = 0; tick < 60; tick += 1) await wheel($, 120, 1)
  pane = await mountPane($, { bodyRows: 30 })
  expect(await pane.find({ type: 'Markdown', text: /answer line 40/ })).toBeDefined()
  expect(await skippedLinesOf(pane)).toBeGreaterThan(80)
  await pane.unmount()

  await wheel($, 120, -1)
  pane = await mountPane($, { bodyRows: 30 })
  expect(await skippedLinesOf(pane)).toBeGreaterThan(77)
  await pane.unmount()
})

test('a thread whose line left the diff shows on top of its file, marked for Claude, and can still be closed', async ($, on) => {
  let changedDiff: string | undefined
  stubWorld(on, {
    git: gitCommand => (gitCommand.startsWith('diff --no-color') && changedDiff ? { exitCode: 0, stdout: changedDiff } : undefined),
  })
  await openExplorer($)
  const pane = await mountPane($)
  await pane.press({ key: 'file-src/Total.php' })
  await pane.press({ key: 'ask-3' })
  await pane.input({ key: await questionFieldKey(pane), text: 'Why 2?' })
  expect((await pane.find({ key: 'threads-src/Total.php' }))?.text).toBe('◆ 1')

  changedDiff = ['@@ -100,1 +100,1 @@', ' unrelated'].join('\n')
  await pane.press({ key: 'refresh' })
  expect(await pane.find({ type: 'Text', text: /no longer in the diff/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /› Why 2\?/ })).toBeDefined()

  await pane.press({ key: await keyStartingWith(pane, 'Button', 'dismiss-') })
  expect(await pane.find({ type: 'Text', text: /no longer in the diff/ })).toBeUndefined()
  expect(await pane.find({ key: 'threads-src/Total.php' })).toBeUndefined()
  await pane.unmount()
})

test('j and k walk the threads of the view in reading order, opening their file', async ($, on) => {
  stubWorld(on, { newFileContent: 'hello\n' })
  await openExplorer($)
  const pane = await mountPane($)
  await pane.press({ key: 'file-src/Total.php' })
  await pane.press({ key: 'ask-3' })
  await pane.input({ key: await questionFieldKey(pane), text: 'On Total' })
  await pane.press({ key: 'file-notes.md' })
  await pane.press({ key: 'ask-1' })
  await pane.input({ key: await questionFieldKey(pane), text: 'On notes' })
  expect(await pane.find({ type: 'Text', text: /thread –\/2/ })).toBeDefined()

  await pane.press({ key: 'thread-next' })
  expect(await pane.find({ type: 'Text', text: /^notes\.md$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /thread 1\/2/ })).toBeDefined()
  await pane.press({ key: 'thread-next' })
  expect(await pane.find({ type: 'Text', text: /^src\/Total\.php$/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /thread 2\/2/ })).toBeDefined()
  await pane.press({ key: 'thread-next' })
  expect(await pane.find({ type: 'Text', text: /^notes\.md$/ })).toBeDefined()
  await pane.press({ key: 'thread-previous' })
  expect(await pane.find({ type: 'Text', text: /^src\/Total\.php$/ })).toBeDefined()
  await pane.unmount()
})

test('threads saved by an earlier session on this branch come back under their lines, flagged as cleared', async ($, on) => {
  const savedThread = {
    id: 'from-yesterday',
    anchorKey: 'uncommitted||src/Total.php|added||2',
    anchorDescription: 'src/Total.php, line 2 (added) in the uncommitted changes',
    exchanges: [{ question: 'Why 2?', answer: 'Because the total doubled.', status: 'done' }],
    isContextCleared: false,
  }
  const world = stubWorld(on, { storeEntries: { 'threads|/work/shop|feat/tax': [savedThread] } })
  await openExplorer($)
  const pane = await mountPane($)
  await pane.press({ key: 'file-src/Total.php' })
  expect(await pane.find({ type: 'Text', text: /› Why 2\?/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /Conversation cleared since/ })).toBeDefined()

  await pane.press({ key: 'ask-3' })
  await pane.input({ key: await questionFieldKey(pane), text: 'A new one' })
  await pane.unmount()
  expect(JSON.stringify(world.store.get('threads|/work/shop|feat/tax'))).toContain('A new one')
})

test('the mark of a thread blinks while Claude answers it and goes once the answer is in', async ($, on) => {
  const world = stubWorld(on)
  await openExplorer($)
  const pane = await mountPane($)
  await pane.press({ key: 'file-src/Total.php' })
  await pane.press({ key: 'ask-3' })
  await pane.input({ key: await questionFieldKey(pane), text: 'Why 2?' })

  const mark = async () => (await pane.find({ type: 'Text', text: /^ {2}[●○]$/ }))?.text
  expect(await mark()).toBe('  ●')
  await world.clock.advance(600)
  expect(await mark()).toBe('  ○')
  await world.clock.advance(600)
  expect(await mark()).toBe('  ●')

  await answerTurn($, 'turn-1', 'Why 2?', 'Because the total doubled.')
  await world.clock.advance(600)
  expect(await mark()).toBeUndefined()
  await pane.unmount()
})

test('a thread asked in the PR view stays under its line after a visit to the Commits view', async ($, on) => {
  stubWorld(on)
  await openExplorer($)
  const pane = await mountPane($)
  await pane.press({ key: 'view-pr' })
  await pane.press({ key: 'file-src/Total.php' })
  await pane.press({ key: 'ask-3' })
  await pane.input({ key: await questionFieldKey(pane), text: 'Why 2?' })

  await pane.press({ key: 'view-commits' })
  await pane.press({ key: 'view-pr' })
  await pane.press({ key: 'file-src/Total.php' })
  expect(await pane.find({ type: 'Text', text: /› Why 2\?/ })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /no longer in the diff/ })).toBeUndefined()
  await pane.unmount()
})
