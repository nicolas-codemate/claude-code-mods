import type { ChangedFile, DiffRow, GitHubComment, GitHubReviewThread, PullRequestSummary, ViewedState } from '../types'
import { replaceEmojiShortcodes } from './markdown'
import { gitHubThreadAnchorKeyOf } from './questions'

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

export const REVIEW_THREADS_PAGE_SIZE = 100
export const COMMENTS_PER_REVIEW_THREAD = 50

export const REVIEW_THREADS_QUERY = `query($pullRequestId: ID!, $cursor: String) {
  node(id: $pullRequestId) {
    ... on PullRequest {
      reviewThreads(first: ${REVIEW_THREADS_PAGE_SIZE}, after: $cursor) {
        nodes {
          id isResolved isOutdated path line originalLine diffSide
          comments(first: ${COMMENTS_PER_REVIEW_THREAD}) { nodes { author { login } body createdAt url } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`

export const RESOLVE_REVIEW_THREAD_MUTATION = `mutation($threadId: ID!) {
  resolveReviewThread(input: { threadId: $threadId }) { thread { isResolved } }
}`

export const UNRESOLVE_REVIEW_THREAD_MUTATION = `mutation($threadId: ID!) {
  unresolveReviewThread(input: { threadId: $threadId }) { thread { isResolved } }
}`

export function addressRequestOf(thread: GitHubReviewThread, pullRequest: PullRequestSummary): { question: string; context: string } {
  const firstComment = thread.comments[0]
  const place = thread.line === null ? `${thread.path} (outdated, was line ${thread.originalLine ?? '?'})` : `${thread.path}, line ${thread.line}`

  return {
    question: `Address the review comment of @${firstComment?.author ?? 'ghost'} on ${place}.`,
    context: [
      `The review thread on pull request ${pullRequest.overviewHeadline} (${pullRequest.url}), ${place}:`,
      '````markdown',
      ...thread.comments.map(comment => `@${comment.author}: ${comment.body}`),
      '````',
      'Change the code so the thread can be resolved, or say why it should not be. Do not post anything on GitHub.',
    ].join('\n'),
  }
}

export type ReviewThreadsPage = { threads: GitHubReviewThread[]; nextCursor: string | null }

export function parseReviewThreadsPage(
  graphqlOutput: string,
  emojiCharacterByShortcode: Record<string, string> = {},
): ReviewThreadsPage {
  const reviewThreads = JSON.parse(graphqlOutput)?.data?.node?.reviewThreads
  const numberOrNull = (value: unknown) => (typeof value === 'number' ? value : null)
  const nodesOf = (connection: unknown): Array<Record<string, unknown>> => {
    const nodes = (connection as { nodes?: unknown } | null)?.nodes
    return Array.isArray(nodes) ? nodes : []
  }
  const threads: GitHubReviewThread[] = nodesOf(reviewThreads).flatMap(node => {
    if (typeof node.id !== 'string' || typeof node.path !== 'string') {
      return []
    }
    const comments: GitHubComment[] = nodesOf(node.comments).map(comment => ({
      author: String((comment.author as { login?: unknown } | null)?.login ?? 'ghost'),
      body: replaceEmojiShortcodes(String(comment.body ?? ''), emojiCharacterByShortcode),
      createdAt: String(comment.createdAt ?? ''),
      url: String(comment.url ?? ''),
    }))
    const side: GitHubReviewThread['side'] = node.diffSide === 'LEFT' ? 'LEFT' : 'RIGHT'

    return [
      {
        id: node.id,
        path: node.path,
        side,
        line: numberOrNull(node.line),
        originalLine: numberOrNull(node.originalLine),
        isResolved: node.isResolved === true,
        isOutdated: node.isOutdated === true,
        comments,
      },
    ]
  })

  return {
    threads,
    nextCursor: reviewThreads?.pageInfo?.hasNextPage ? (reviewThreads.pageInfo.endCursor ?? null) : null,
  }
}

// GitHub places a comment on the old side for a removed line and on the new side otherwise; an unchanged line has
// both numbers, so a comment on either side lands on it.
export function isGitHubThreadOnRow(thread: GitHubReviewThread, path: string, row: DiffRow): boolean {
  if (thread.path !== path || thread.line === null || row.kind === 'hunk') {
    return false
  }

  return thread.side === 'LEFT'
    ? row.kind !== 'added' && row.oldNumber === thread.line
    : row.kind !== 'removed' && row.newNumber === thread.line
}

// The threads of a file that no line of its diff carries: outdated ones, or lines outside the context shown.
export function unplacedGitHubThreadsOf(threads: GitHubReviewThread[], path: string, rows: DiffRow[]): GitHubReviewThread[] {
  return threads.filter(thread => thread.path === path && !rows.some(row => isGitHubThreadOnRow(thread, path, row)))
}

export function gitHubThreadNavigationEntries(threads: GitHubReviewThread[]): Array<{ id: string; anchorKey: string }> {
  return threads.map(thread => ({ id: thread.id, anchorKey: gitHubThreadAnchorKeyOf(thread) }))
}

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

// GitHub lists a renamed file once, under its new path, and gives the old one only through the REST API.
export function pullRequestRenamesArguments(pullRequestNumber: number): string[] {
  return [
    'api',
    '--paginate',
    `repos/{owner}/{repo}/pulls/${pullRequestNumber}/files`,
    '--jq',
    '.[] | select(.status == "renamed") | [.previous_filename, .filename] | @tsv',
  ]
}

export function parseRenamedPaths(renamesOutput: string): Record<string, string> {
  const renamedPathByPreviousPath: Record<string, string> = {}
  for (const line of renamesOutput.split('\n')) {
    const [previousPath, path] = line.split('\t')
    if (previousPath && path) {
      renamedPathByPreviousPath[previousPath] = path
    }
  }

  return renamedPathByPreviousPath
}

// The diff lists a renamed file as one path deleted and one created: the deleted one shares the box of the new one.
export function withPreviousPathsOfRenames(
  viewedStateByPath: Record<string, ViewedState>,
  renamedPathByPreviousPath: Record<string, string>,
): Record<string, ViewedState> {
  const viewedStateWithPreviousPaths = { ...viewedStateByPath }
  for (const [previousPath, path] of Object.entries(renamedPathByPreviousPath)) {
    const viewedState = viewedStateByPath[path]
    if (viewedState !== undefined) {
      viewedStateWithPreviousPaths[previousPath] = viewedState
    }
  }

  return viewedStateWithPreviousPaths
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
export const VIEWED_MARKS: Record<ViewedState, string> = { VIEWED: ' ✓ ', UNVIEWED: ' ○ ', DISMISSED: ' ! ' }

// GitHub unticks a viewed file once a pushed commit changes it, but only after it has processed the push.
export function dismissChangedFiles(viewedStateByPath: Record<string, ViewedState>, changedPaths: readonly string[]): Record<string, ViewedState> {
  return Object.fromEntries(
    Object.entries(viewedStateByPath).map(([path, viewedState]) => [path, changedPaths.includes(path) ? viewedStateAfterChange(viewedState) : viewedState]),
  )
}

function viewedStateAfterChange(viewedState: ViewedState): ViewedState {
  switch (viewedState) {
    case 'VIEWED':
      return 'DISMISSED'
    case 'UNVIEWED':
    case 'DISMISSED':
      return viewedState
  }
}

export function countViewedFiles(paths: string[], viewedStateByPath: Record<string, ViewedState>): { viewed: number; total: number } {
  const pathsInPullRequest = paths.filter(path => viewedStateByPath[path] !== undefined)

  return {
    viewed: pathsInPullRequest.filter(path => viewedStateByPath[path] === 'VIEWED').length,
    total: pathsInPullRequest.length,
  }
}

// The lines of the PR files whose box is not ticked yet; a file changed since it was viewed counts again.
export function countLinesToView(
  files: ChangedFile[],
  viewedStateByPath: Record<string, ViewedState>,
): { addedLines: number; removedLines: number } {
  return files
    .filter(file => viewedStateByPath[file.path] !== undefined && viewedStateByPath[file.path] !== 'VIEWED')
    .reduce(
      (totals, file) => ({ addedLines: totals.addedLines + (file.addedLines ?? 0), removedLines: totals.removedLines + (file.removedLines ?? 0) }),
      { addedLines: 0, removedLines: 0 },
    )
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
