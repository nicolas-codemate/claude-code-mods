import type { PullRequestSummary, ViewedState } from '../types'

export const PULL_REQUEST_FILES_PAGE_SIZE = 100

export const VIEWED_STATES_QUERY = `query($pullRequestId: ID!, $cursor: String) {
  node(id: $pullRequestId) {
    ... on PullRequest {
      files(first: ${PULL_REQUEST_FILES_PAGE_SIZE}, after: $cursor) {
        nodes { path viewerViewedState }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`

export const MARK_FILE_AS_VIEWED_MUTATION = `mutation($pullRequestId: ID!, $path: String!) {
  markFileAsViewed(input: { pullRequestId: $pullRequestId, path: $path }) { clientMutationId }
}`

export const UNMARK_FILE_AS_VIEWED_MUTATION = `mutation($pullRequestId: ID!, $path: String!) {
  unmarkFileAsViewed(input: { pullRequestId: $pullRequestId, path: $path }) { clientMutationId }
}`

export type ViewedStatesPage = {
  viewedStateByPath: Record<string, ViewedState>
  nextCursor: string | null
}

export function parseViewedStatesPage(graphqlOutput: string): ViewedStatesPage {
  const files = JSON.parse(graphqlOutput)?.data?.node?.files
  const viewedStateByPath: Record<string, ViewedState> = {}
  for (const file of files?.nodes ?? []) {
    if (typeof file?.path === 'string' && ['VIEWED', 'UNVIEWED', 'DISMISSED'].includes(file?.viewerViewedState)) {
      viewedStateByPath[file.path] = file.viewerViewedState
    }
  }

  return {
    viewedStateByPath,
    nextCursor: files?.pageInfo?.hasNextPage ? (files.pageInfo.endCursor ?? null) : null,
  }
}

export function parsePullRequest(
  prViewOutput: string,
  emojiCharacterByShortcode: Record<string, string> = {},
): PullRequestSummary | null {
  const pullRequest = JSON.parse(prViewOutput)
  if (typeof pullRequest?.id !== 'string' || typeof pullRequest?.number !== 'number') {
    return null
  }
  const overview = buildPullRequestOverview(pullRequest, emojiCharacterByShortcode)

  return {
    id: pullRequest.id,
    number: pullRequest.number,
    url: String(pullRequest.url ?? ''),
    baseRefName: typeof pullRequest.baseRefName === 'string' ? pullRequest.baseRefName : null,
    additions: Number(pullRequest.additions ?? 0),
    deletions: Number(pullRequest.deletions ?? 0),
    changedFiles: Number(pullRequest.changedFiles ?? 0),
    overviewHeadline: overview.headline,
    overviewMarkdown: overview.markdown,
  }
}

// GitHub keeps a file viewed until it changes again on the branch; it then reports it as DISMISSED, to be looked at anew.
export const VIEWED_MARKS: Record<ViewedState, string> = { VIEWED: '☑', UNVIEWED: '☐', DISMISSED: '◪' }

export function countViewedFiles(paths: string[], viewedStateByPath: Record<string, ViewedState>): { viewed: number; total: number } {
  const pathsInPullRequest = paths.filter(path => viewedStateByPath[path] !== undefined)

  return {
    viewed: pathsInPullRequest.filter(path => viewedStateByPath[path] === 'VIEWED').length,
    total: pathsInPullRequest.length,
  }
}

export const PULL_REQUEST_VIEW_FIELDS =
  'id,number,url,title,body,author,state,isDraft,baseRefName,headRefName,comments,reviews,additions,deletions,changedFiles'

type ConversationEntry = { author: string; body: string; createdAt: string; reviewState: string | null }

// A review that only carries inline comments has an empty body and the COMMENTED state: its comments belong under
// their lines, not in the conversation.
function conversationEntriesOf(pullRequest: Record<string, unknown>): ConversationEntry[] {
  const authorLogin = (entry: Record<string, unknown>) => String((entry.author as { login?: unknown } | null)?.login ?? 'ghost')
  const comments = (Array.isArray(pullRequest.comments) ? pullRequest.comments : []).map(comment => ({
    author: authorLogin(comment),
    body: String(comment?.body ?? ''),
    createdAt: String(comment?.createdAt ?? ''),
    reviewState: null,
  }))
  const reviews = (Array.isArray(pullRequest.reviews) ? pullRequest.reviews : [])
    .filter(review => String(review?.body ?? '').trim() !== '' || review?.state !== 'COMMENTED')
    .map(review => ({
      author: authorLogin(review),
      body: String(review?.body ?? ''),
      createdAt: String(review?.submittedAt ?? ''),
      reviewState: String(review?.state ?? ''),
    }))

  return [...comments, ...reviews].sort((first, second) => first.createdAt.localeCompare(second.createdAt))
}

const REVIEW_STATE_LABELS: Record<string, string> = {
  APPROVED: '✓ approved',
  CHANGES_REQUESTED: '✗ changes requested',
  COMMENTED: 'reviewed',
  DISMISSED: 'review dismissed',
}

export function buildPullRequestOverview(
  pullRequest: Record<string, unknown>,
  emojiCharacterByShortcode: Record<string, string> = {},
): { headline: string; markdown: string } {
  const withEmoji = (text: string) => replaceEmojiShortcodes(text, emojiCharacterByShortcode)
  const author = String((pullRequest.author as { login?: unknown } | null)?.login ?? 'ghost')
  const state = pullRequest.isDraft === true ? 'draft' : String(pullRequest.state ?? '').toLowerCase()
  const description = withEmoji(String(pullRequest.body ?? '').trim())
  const conversation = conversationEntriesOf(pullRequest)
  const markdown = [
    `**@${author}** · ${state} · \`${String(pullRequest.baseRefName ?? '?')}\` ← \`${String(pullRequest.headRefName ?? '?')}\``,
    '',
    '## Description',
    '',
    description === '' ? '_No description._' : description,
    '',
    `## Conversation (${conversation.length})`,
    ...(conversation.length === 0 ? ['', '_No comment outside the code._'] : []),
    ...conversation.flatMap(entry => [
      '',
      `**@${entry.author}** · ${entry.createdAt.slice(0, 16).replace('T', ' ')}${entry.reviewState ? ` · ${REVIEW_STATE_LABELS[entry.reviewState] ?? entry.reviewState}` : ''}`,
      '',
      entry.body.trim() === '' ? '_(no message)_' : withEmoji(entry.body.trim()),
      '',
      '---',
    ]),
  ].join('\n')

  return { headline: `#${String(pullRequest.number ?? '?')}  ${withEmoji(String(pullRequest.title ?? ''))}`, markdown }
}

// GitHub names each emoji image after its code points (`unicode/1f68b.png`, `unicode/1f1eb-1f1f7.png`): that file
// name gives the character. Emoji GitHub draws as an image of its own (`:octocat:`) have none and keep their code.
export function parseEmojiCharacters(emojisOutput: string): Record<string, string> {
  const emojiCharacterByShortcode: Record<string, string> = {}
  let emojis: unknown
  try {
    emojis = JSON.parse(emojisOutput)
  } catch {
    return emojiCharacterByShortcode
  }
  for (const [shortcode, imageUrl] of Object.entries(typeof emojis === 'object' && emojis !== null ? emojis : {})) {
    const codePoints = typeof imageUrl === 'string' ? imageUrl.match(/\/unicode\/([0-9a-f-]+)\.png/)?.[1] : undefined
    if (codePoints) {
      emojiCharacterByShortcode[shortcode] = String.fromCodePoint(...codePoints.split('-').map(codePoint => parseInt(codePoint, 16)))
    }
  }

  return emojiCharacterByShortcode
}

export function replaceEmojiShortcodes(text: string, emojiCharacterByShortcode: Record<string, string>): string {
  return text.replace(/:([a-z0-9_+-]+):/g, (shortcode, name: string) => emojiCharacterByShortcode[name] ?? shortcode)
}

// A paragraph, a list, a fenced code block or a heading each make one block, so a question can point at any of them.
export function splitMarkdownBlocks(markdown: string): string[] {
  const blocks: string[] = []
  let currentLines: string[] = []
  let isInsideFence = false
  const closeBlock = () => {
    if (currentLines.some(line => line.trim() !== '')) {
      blocks.push(currentLines.join('\n'))
    }
    currentLines = []
  }
  for (const line of markdown.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      isInsideFence = !isInsideFence
      currentLines.push(line)
      if (!isInsideFence) {
        closeBlock()
      }
      continue
    }
    if (isInsideFence) {
      currentLines.push(line)
    } else if (line.trim() === '') {
      closeBlock()
    } else if (/^#{1,6} /.test(line)) {
      closeBlock()
      blocks.push(line)
    } else {
      currentLines.push(line)
    }
  }
  closeBlock()

  return blocks
}
