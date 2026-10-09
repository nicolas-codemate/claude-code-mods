import { expect, test } from 'claude-code/testing'

import { buildPullRequestOverview, countLinesToView, countViewedFiles, dismissChangedFiles, parsePullRequest, parseViewedStatesPage } from './github-review'
import { isListItemBlock, parseEmojiCharacters, replaceEmojiShortcodes, splitListItemIndentation, splitMarkdownBlocks } from './markdown'

test('a page of PR files gives each path its viewed state and the cursor of the next page', async () => {
  const page = parseViewedStatesPage(
    JSON.stringify({
      data: {
        node: {
          files: {
            nodes: [
              { path: 'src/a.php', viewerViewedState: 'VIEWED' },
              { path: 'src/b.php', viewerViewedState: 'DISMISSED' },
              { path: 'src/c.php', viewerViewedState: 'UNVIEWED' },
            ],
            pageInfo: { hasNextPage: true, endCursor: 'Y3Vyc29y' },
          },
        },
      },
    }),
  )
  expect(page.viewedStateByPath).toEqual({ 'src/a.php': 'VIEWED', 'src/b.php': 'DISMISSED', 'src/c.php': 'UNVIEWED' })
  expect(page.nextCursor).toBe('Y3Vyc29y')
})

test('a branch without PR gives no PR, and only files of the PR count toward viewed', async () => {
  expect(parsePullRequest('{}')).toBe(null)
  expect(parsePullRequest('{"id":"PR_1","number":42,"url":"https://github.com/o/r/pull/42"}')?.number).toBe(42)
  expect(countViewedFiles(['a', 'b', 'local-only'], { a: 'VIEWED', b: 'DISMISSED' })).toEqual({ viewed: 1, total: 2 })
})

test('the overview gives the description and the conversation in time order, leaving inline-only reviews out', async () => {
  const overview = buildPullRequestOverview({
    number: 42,
    title: 'Add tax',
    author: { login: 'someone' },
    state: 'OPEN',
    isDraft: false,
    baseRefName: 'main',
    headRefName: 'feat/tax',
    body: 'Adds the VAT.',
    comments: [{ author: { login: 'paul' }, body: 'Looks good overall', createdAt: '2026-10-02T10:00:00Z' }],
    reviews: [
      { author: { login: 'marie' }, body: '', state: 'COMMENTED', submittedAt: '2026-10-02T09:00:00Z' },
      { author: { login: 'marie' }, body: 'Rename the method', state: 'CHANGES_REQUESTED', submittedAt: '2026-10-02T11:00:00Z' },
    ],
  })
  expect(overview.headline).toBe('#42  Add tax')
  expect(overview.markdown).toContain('Adds the VAT.')
  expect(overview.markdown).toContain('## Conversation (2)')
  expect(overview.markdown.indexOf('Looks good overall')).toBeLessThan(overview.markdown.indexOf('Rename the method'))
  expect(overview.markdown).toContain('✗ changes requested')
})

test('GitHub emoji codes become their characters, an image-only one keeps its code', async () => {
  const characters = parseEmojiCharacters(JSON.stringify({
    train: 'https://github.githubassets.com/images/icons/emoji/unicode/1f68b.png?v8',
    fr: 'https://github.githubassets.com/images/icons/emoji/unicode/1f1eb-1f1f7.png?v8',
    octocat: 'https://github.githubassets.com/images/icons/emoji/octocat.png?v8',
  }))
  expect(replaceEmojiShortcodes(':train: Carte', characters)).toBe(`${String.fromCodePoint(0x1f68b)} Carte`)
  expect(replaceEmojiShortcodes(':fr:', characters)).toBe(String.fromCodePoint(0x1f1eb, 0x1f1f7))
  expect(replaceEmojiShortcodes(':octocat: at 10:30:00', characters)).toBe(':octocat: at 10:30:00')
  expect(parseEmojiCharacters('not json')).toEqual({})
})

test('markdown splits into headings, paragraphs, list items and whole code blocks', async () => {
  const blocks = splitMarkdownBlocks(['## Notes', '', '- first', '- second', '', '```php', '$a = 1;', '', '$b = 2;', '```', 'After.'].join('\n'))
  expect(blocks).toEqual(['## Notes', '- first', '- second', '```php\n$a = 1;\n\n$b = 2;\n```', 'After.'])
})

test('each list item, nested or wrapped, makes a block of its own', async () => {
  const blocks = splitMarkdownBlocks(['- **Limits:**', '  - the portfolio keeps', '    the old split', '  - the extractor', '1. numbered'].join('\n'))
  expect(blocks).toEqual(['- **Limits:**', '  - the portfolio keeps\n    the old split', '  - the extractor', '1. numbered'])
  expect(splitListItemIndentation(blocks[1] ?? '')).toEqual({ indentation: 2, text: '- the portfolio keeps\n  the old split' })
  expect(isListItemBlock('After.')).toBe(false)
})

test('the lines to view add up the PR files not viewed, a file changed since it was viewed included', async () => {
  const fileOf = (path: string, addedLines: number | null, removedLines: number | null) => ({ path, addedLines, removedLines, isUntracked: false })
  const files = [fileOf('viewed', 10, 1), fileOf('unviewed', 3, 2), fileOf('dismissed', 4, 0), fileOf('binary', null, null), fileOf('local-only', 50, 50)]
  const viewedStateByPath = { viewed: 'VIEWED', unviewed: 'UNVIEWED', dismissed: 'DISMISSED', binary: 'UNVIEWED' } as const

  expect(countLinesToView(files, viewedStateByPath)).toEqual({ addedLines: 7, removedLines: 2 })
})

test('a change unticks only the viewed files it touches', async () => {
  expect(dismissChangedFiles({ a: 'VIEWED', b: 'UNVIEWED', c: 'DISMISSED', d: 'VIEWED' }, ['a', 'b', 'c', 'local-only'])).toEqual({
    a: 'DISMISSED',
    b: 'UNVIEWED',
    c: 'DISMISSED',
    d: 'VIEWED',
  })
})
