import { expect, test } from 'claude-code/testing'

import { keyStartingWith, mountPane, openExplorer, questionFieldKey, stubWorld } from './test-support'

const PULL_REQUEST = {
  id: 'PR_1',
  number: 42,
  url: 'https://github.com/o/r/pull/42',
  title: 'Add tax',
  body: 'Adds the VAT on every invoice.',
  additions: 7,
  deletions: 1,
  changedFiles: 2,
}

test('in the PR view each file of the PR carries a viewed box that GitHub keeps', async ($, on) => {
  const githubMutations: string[] = []
  let isGithubRefusing = false
  stubWorld(on, {
    gh: ghCommand => {
      if (ghCommand.startsWith('pr view')) {
        return { exitCode: 0, stdout: JSON.stringify(PULL_REQUEST) }
      }
      if (ghCommand.includes('markFileAsViewed')) {
        githubMutations.push(ghCommand.includes('unmarkFileAsViewed') ? 'unmark' : 'mark')
        return { exitCode: isGithubRefusing ? 1 : 0, stdout: '{}', stderr: 'refused' }
      }
      const files = {
        nodes: [
          { path: 'src/Tax.php', viewerViewedState: 'VIEWED' },
          { path: 'src/Total.php', viewerViewedState: 'UNVIEWED' },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      }
      return { exitCode: 0, stdout: JSON.stringify({ data: { node: { files } } }) }
    },
  })
  await openExplorer($)
  const pane = await mountPane($)
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
  expect(await pane.find({ type: 'Text', text: /^1\/2 $/ })).toBeDefined()
  expect((await pane.find({ key: 'viewed-src/Tax.php' }))?.text).toBe(' ✓ ')
  expect((await pane.find({ key: 'viewed-src/Total.php' }))?.text).toBe(' ○ ')

  await pane.press({ key: 'viewed-src/Total.php' })
  expect(githubMutations).toEqual(['mark'])
  expect((await pane.find({ key: 'viewed-src/Total.php' }))?.text).toBe(' ✓ ')
  expect(await pane.find({ type: 'Text', text: /^2\/2 $/ })).toBeDefined()

  isGithubRefusing = true
  await pane.press({ key: 'viewed-src/Total.php' })
  expect(githubMutations).toEqual(['mark', 'unmark'])
  expect((await pane.find({ key: 'viewed-src/Total.php' }))?.text).toBe(' ✓ ')
  await pane.unmount()
})

test('a PR targeting a release branch is compared to that branch, not to the default one', async ($, on) => {
  stubWorld(on, {
    gh: ghCommand =>
      ghCommand.startsWith('pr view')
        ? { exitCode: 0, stdout: JSON.stringify({ ...PULL_REQUEST, baseRefName: '2026-09' }) }
        : { exitCode: 0, stdout: '{"data":{"node":{"files":{"nodes":[],"pageInfo":{"hasNextPage":false}}}}}' },
    git: gitCommand => {
      if (gitCommand === 'merge-base HEAD origin/2026-09') return { exitCode: 0, stdout: 'release0\n' }
      if (gitCommand === 'diff --numstat --summary --no-renames release0 HEAD') return { exitCode: 0, stdout: '5\t0\tsrc/Tax.php\n' }
      return undefined
    },
  })
  await openExplorer($)
  const pane = await mountPane($)
  await pane.press({ key: 'view-pr' })
  expect(await pane.find({ type: 'Button', text: 'Tax.php' })).toBeDefined()
  expect(await pane.find({ type: 'Button', text: 'Total.php' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /from 2026-09 release0/ })).toBeDefined()
  await pane.unmount()
})

test('a question can be asked on a block of the PR overview', async ($, on) => {
  const world = stubWorld(on, {
    gh: ghCommand => (ghCommand.startsWith('pr view') ? { exitCode: 0, stdout: JSON.stringify(PULL_REQUEST) } : undefined),
  })
  await openExplorer($)
  const pane = await mountPane($)
  await pane.press({ key: 'view-pr' })
  expect(await pane.find({ type: 'Markdown', text: 'Adds the VAT on every invoice.' })).toBeDefined()
  expect(await keyStartingWith(pane, 'Button', 'ask-overview-')).not.toBe('')

  await pane.press({ key: 'ask-overview-2' })
  await pane.input({ key: await questionFieldKey(pane), text: 'Why every invoice?' })
  expect(world.submittedPrompts.map(prompt => prompt.text)).toEqual(['Why every invoice?'])
  expect(await pane.find({ type: 'Text', text: /› Why every invoice\?/ })).toBeDefined()
  await pane.unmount()
})

test('in the PR view the GitHub shortcut opens the pull request, its number a link to it', async ($, on) => {
  const world = stubWorld(on, {
    gh: ghCommand => (ghCommand.startsWith('pr view') ? { exitCode: 0, stdout: JSON.stringify(PULL_REQUEST) } : undefined),
  })
  await openExplorer($)
  const pane = await mountPane($)
  await pane.press({ key: 'view-pr' })
  expect((await pane.findAll({ type: 'Link' })).map(link => link.props.href)).toContain(PULL_REQUEST.url)
  expect((await pane.find({ key: 'open-on-github-box' }))?.props.display).toBe('none')
  await pane.press({ key: 'open-on-github' })
  expect(world.openedUrls).toEqual([PULL_REQUEST.url])
  await pane.unmount()
})

const REVIEW_THREADS = {
  data: {
    node: {
      reviewThreads: {
        nodes: [
          {
            id: 'RT_open',
            isResolved: false,
            isOutdated: false,
            path: 'src/Total.php',
            line: 2,
            originalLine: 2,
            diffSide: 'RIGHT',
            comments: {
              nodes: [
                { author: { login: 'reviewer' }, body: 'Why 2? :thinking:', createdAt: '2026-10-01T10:00:00Z', url: 'https://github.com/o/r/pull/42#discussion_r1' },
                { author: { login: 'someone' }, body: 'Tax included.', createdAt: '2026-10-01T11:00:00Z', url: 'https://github.com/o/r/pull/42#discussion_r2' },
              ],
            },
          },
          {
            id: 'RT_resolved',
            isResolved: true,
            isOutdated: false,
            path: 'src/Total.php',
            line: 2,
            originalLine: 2,
            diffSide: 'LEFT',
            comments: { nodes: [{ author: { login: 'reviewer' }, body: 'Old total was wrong', createdAt: '2026-10-01T09:00:00Z', url: 'https://github.com/o/r/pull/42#discussion_r3' }] },
          },
          {
            id: 'RT_outdated',
            isResolved: false,
            isOutdated: true,
            path: 'src/Total.php',
            line: null,
            originalLine: 9,
            diffSide: 'RIGHT',
            comments: { nodes: [{ author: { login: 'reviewer' }, body: 'Gone line', createdAt: '2026-09-30T09:00:00Z', url: 'https://github.com/o/r/pull/42#discussion_r4' }] },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    },
  },
}

test('the PR view draws the GitHub review comments under their lines, j/k walk them and the shortcut opens one', async ($, on) => {
  const world = stubWorld(on, {
    gh: ghCommand => {
      if (ghCommand.startsWith('pr view')) {
        return { exitCode: 0, stdout: JSON.stringify(PULL_REQUEST) }
      }
      if (ghCommand.includes('reviewThreads')) {
        return { exitCode: 0, stdout: JSON.stringify(REVIEW_THREADS) }
      }
      return undefined
    },
  })
  await openExplorer($)
  const pane = await mountPane($)
  await pane.press({ key: 'view-pr' })
  await pane.press({ key: 'file-src/Total.php' })
  expect(await pane.find({ type: 'Markdown', text: 'Tax included.' })).toBeDefined()
  expect(await pane.find({ type: 'Markdown', text: 'Gone line' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /outdated, was line 9/ })).toBeDefined()
  expect(await pane.find({ type: 'Markdown', text: 'Old total was wrong' })).toBeUndefined()
  await pane.press({ key: 'github-thread-toggle-RT_resolved' })
  expect(await pane.find({ type: 'Markdown', text: 'Old total was wrong' })).toBeDefined()

  await pane.press({ key: 'thread-next' })
  await pane.press({ key: 'thread-next' })
  expect(await pane.find({ type: 'Text', text: /thread 2\/3/ })).toBeDefined()
  expect((await pane.find({ key: 'open-on-github-box' }))?.props.display).toBe('flex')
  await pane.press({ key: 'open-on-github' })
  expect(world.openedUrls).toEqual(['https://github.com/o/r/pull/42#discussion_r1'])
  await pane.unmount()
})

test('the file list marks the threads still open in a file, and its mark leads to the first of them', async ($, on) => {
  const world = stubWorld(on, {
    gh: ghCommand => {
      if (ghCommand.startsWith('pr view')) {
        return { exitCode: 0, stdout: JSON.stringify(PULL_REQUEST) }
      }
      if (ghCommand.includes('reviewThreads')) {
        return { exitCode: 0, stdout: JSON.stringify(REVIEW_THREADS) }
      }
      return undefined
    },
  })
  await openExplorer($)
  const pane = await mountPane($)
  await pane.press({ key: 'view-pr' })
  expect((await pane.find({ key: 'threads-src/Total.php' }))?.text).toBe('\u{1F4AC} 2')
  expect(await pane.find({ key: 'threads-src/Tax.php' })).toBeUndefined()

  await pane.press({ key: 'threads-src/Total.php' })
  await pane.press({ key: 'open-on-github' })
  expect(world.openedUrls).toEqual(['https://github.com/o/r/pull/42#discussion_r4'])
  await pane.unmount()
})

test('a picture in a GitHub comment shows as a link a click opens in the browser', async ($, on) => {
  const imageUrl = 'https://github.com/user-attachments/assets/b8d6'
  const threadsWithPicture = JSON.parse(JSON.stringify(REVIEW_THREADS)) as typeof REVIEW_THREADS
  threadsWithPicture.data.node.reviewThreads.nodes[0]!.comments.nodes[1]!.body = `See:\n<img width="903" height="343" alt="image" src="${imageUrl}" />`
  const world = stubWorld(on, {
    gh: ghCommand => {
      if (ghCommand.startsWith('pr view')) {
        return { exitCode: 0, stdout: JSON.stringify(PULL_REQUEST) }
      }
      if (ghCommand.includes('reviewThreads')) {
        return { exitCode: 0, stdout: JSON.stringify(threadsWithPicture) }
      }
      return undefined
    },
  })
  await openExplorer($)
  const pane = await mountPane($)
  await pane.press({ key: 'view-pr' })
  await pane.press({ key: 'file-src/Total.php' })
  expect((await pane.find({ key: 'github-comment-RT_open-1' }))?.text).toBe(`See:\n[\u{1F5BC} image 903×343 ↗](${imageUrl})`)
  await pane.press({ key: 'github-comment-RT_open-1', link: { href: imageUrl } })
  expect(world.openedUrls).toEqual([imageUrl])
  await pane.unmount()
})

test('a GitHub thread resolves from its button or the shortcut, folds at once, and comes back when GitHub refuses', async ($, on) => {
  const mutations: string[] = []
  let isGithubRefusing = false
  stubWorld(on, {
    gh: ghCommand => {
      if (ghCommand.startsWith('pr view')) {
        return { exitCode: 0, stdout: JSON.stringify(PULL_REQUEST) }
      }
      if (ghCommand.includes('reviewThreads')) {
        return { exitCode: 0, stdout: JSON.stringify(REVIEW_THREADS) }
      }
      if (ghCommand.includes('resolveReviewThread')) {
        mutations.push(`${ghCommand.includes('unresolveReviewThread') ? 'unresolve' : 'resolve'} ${ghCommand.match(/threadId=(\S+)/)?.[1]}`)
        return { exitCode: isGithubRefusing ? 1 : 0, stdout: '{}', stderr: 'refused' }
      }
      return undefined
    },
  })
  await openExplorer($)
  const pane = await mountPane($)
  await pane.press({ key: 'view-pr' })
  await pane.press({ key: 'file-src/Total.php' })
  await pane.press({ key: 'github-thread-resolve-RT_open' })
  expect(mutations).toEqual(['resolve RT_open'])
  expect(await pane.find({ type: 'Markdown', text: 'Tax included.' })).toBeUndefined()
  expect(await pane.find({ key: 'github-thread-toggle-RT_open' })).toBeDefined()

  await pane.press({ key: 'thread-next' })
  await pane.press({ key: 'thread-next' })
  expect((await pane.find({ key: 'thread-toggle-resolved' }))?.text).toBe('↺ unresolve')
  await pane.press({ key: 'thread-toggle-resolved' })
  expect(mutations).toEqual(['resolve RT_open', 'unresolve RT_open'])
  expect(await pane.find({ type: 'Markdown', text: 'Tax included.' })).toBeDefined()

  isGithubRefusing = true
  await pane.press({ key: 'thread-toggle-resolved' })
  expect(await pane.find({ type: 'Markdown', text: 'Tax included.' })).toBeDefined()
  await pane.unmount()
})

test('y marks the file viewed and brings the next one still to view', async ($, on) => {
  const githubMutations: string[] = []
  stubWorld(on, {
    gh: ghCommand => {
      if (ghCommand.startsWith('pr view')) {
        return { exitCode: 0, stdout: JSON.stringify(PULL_REQUEST) }
      }
      if (ghCommand.includes('markFileAsViewed')) {
        githubMutations.push(ghCommand.match(/path=(\S+)/)?.[1] ?? '')
        return { exitCode: 0, stdout: '{}' }
      }
      const files = {
        nodes: [
          { path: 'src/Tax.php', viewerViewedState: 'UNVIEWED' },
          { path: 'src/Total.php', viewerViewedState: 'UNVIEWED' },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      }
      return { exitCode: 0, stdout: JSON.stringify({ data: { node: { files } } }) }
    },
  })
  await openExplorer($)
  const pane = await mountPane($)
  await pane.press({ key: 'view-pr' })
  await pane.press({ key: 'file-src/Tax.php' })
  await pane.press({ key: 'mark-viewed-next' })
  expect(githubMutations).toEqual(['src/Tax.php'])
  expect(await pane.find({ type: 'Text', text: /^src\/Total\.php$/ })).toBeDefined()
  await pane.unmount()
})

test('a renamed file, listed as deleted then created, shares one viewed box with its new path', async ($, on) => {
  const markedPaths: string[] = []
  stubWorld(on, {
    git: gitCommand =>
      gitCommand === 'diff --numstat --summary --no-renames base000 HEAD'
        ? {
            exitCode: 0,
            stdout: '3\t0\tsrc/Invoice.php\n0\t3\tsrc/Bill.php\n create mode 100644 src/Invoice.php\n delete mode 100644 src/Bill.php\n',
          }
        : undefined,
    gh: ghCommand => {
      if (ghCommand.startsWith('pr view')) {
        return { exitCode: 0, stdout: JSON.stringify(PULL_REQUEST) }
      }
      if (ghCommand.includes('markFileAsViewed')) {
        markedPaths.push(ghCommand.match(/path=(\S+)/)?.[1] ?? '')
        return { exitCode: 0, stdout: '{}' }
      }
      if (ghCommand.includes('/pulls/42/files')) {
        return { exitCode: 0, stdout: 'src/Bill.php\tsrc/Invoice.php\n' }
      }
      const files = {
        nodes: [{ path: 'src/Invoice.php', viewerViewedState: 'UNVIEWED' }],
        pageInfo: { hasNextPage: false, endCursor: null },
      }
      return { exitCode: 0, stdout: JSON.stringify({ data: { node: { files } } }) }
    },
  })
  await openExplorer($)
  const pane = await mountPane($)
  await pane.press({ key: 'view-pr' })
  expect((await pane.find({ key: 'viewed-src/Bill.php' }))?.text).toBe(' ○ ')

  await pane.press({ key: 'viewed-src/Bill.php' })
  expect(markedPaths).toEqual(['src/Invoice.php'])
  expect((await pane.find({ key: 'viewed-src/Bill.php' }))?.text).toBe(' ✓ ')
  expect((await pane.find({ key: 'viewed-src/Invoice.php' }))?.text).toBe(' ✓ ')
  await pane.unmount()
})

test('a resolved GitHub thread unfolds while the keyboard is on it', async ($, on) => {
  stubWorld(on, {
    gh: ghCommand => {
      if (ghCommand.startsWith('pr view')) {
        return { exitCode: 0, stdout: JSON.stringify(PULL_REQUEST) }
      }
      if (ghCommand.includes('reviewThreads')) {
        return { exitCode: 0, stdout: JSON.stringify(REVIEW_THREADS) }
      }
      return undefined
    },
  })
  await openExplorer($)
  const pane = await mountPane($)
  await pane.press({ key: 'view-pr' })
  await pane.press({ key: 'file-src/Total.php' })
  expect(await pane.find({ type: 'Markdown', text: 'Old total was wrong' })).toBeUndefined()
  await pane.press({ key: 'thread-next' })
  await pane.press({ key: 'thread-next' })
  await pane.press({ key: 'thread-next' })
  expect(await pane.find({ type: 'Markdown', text: 'Old total was wrong' })).toBeDefined()
  await pane.unmount()
})

test('a GitHub thread goes to Claude with its comments, and the answer comes under its line', async ($, on) => {
  const world = stubWorld(on, {
    gh: ghCommand => {
      if (ghCommand.startsWith('pr view')) {
        return { exitCode: 0, stdout: JSON.stringify(PULL_REQUEST) }
      }
      if (ghCommand.includes('reviewThreads')) {
        return { exitCode: 0, stdout: JSON.stringify(REVIEW_THREADS) }
      }
      return undefined
    },
  })
  await openExplorer($)
  const pane = await mountPane($)
  await pane.press({ key: 'view-pr' })
  await pane.press({ key: 'file-src/Total.php' })
  await pane.press({ key: 'address-github-thread-RT_open' })
  expect(world.submittedPrompts.at(-1)?.text).toBe('Address the review comment of @reviewer on src/Total.php, line 2.')
  expect(await pane.find({ type: 'Text', text: /› Address the review comment of @reviewer/ })).toBeDefined()
  await pane.unmount()
})

test('c on a GitHub thread reached with n has Claude address it', async ($, on) => {
  const world = stubWorld(on, {
    gh: ghCommand => {
      if (ghCommand.startsWith('pr view')) {
        return { exitCode: 0, stdout: JSON.stringify(PULL_REQUEST) }
      }
      if (ghCommand.includes('reviewThreads')) {
        return { exitCode: 0, stdout: JSON.stringify(REVIEW_THREADS) }
      }
      return undefined
    },
  })
  await openExplorer($)
  const pane = await mountPane($)
  await pane.press({ key: 'view-pr' })
  await pane.press({ key: 'file-src/Total.php' })
  await pane.press({ key: 'thread-next' })
  await pane.press({ key: 'thread-next' })
  expect((await pane.find({ key: 'ask-on-line' }))?.text).toMatch(/address comment/)
  await pane.press({ key: 'ask-on-line' })
  expect(world.submittedPrompts.at(-1)?.text).toBe('Address the review comment of @reviewer on src/Total.php, line 2.')
  await pane.unmount()
})
