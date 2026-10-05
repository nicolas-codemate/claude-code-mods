import type { DiffRow, GitHubReviewThread, ReviewThread, ReviewView, ThreadExchange } from '../types'

export type QuestionTarget = { anchorDescription: string; context: string }

export function anchorKeyOf(view: ReviewView, commitSha: string | null, path: string, row: DiffRow): string {
  return [view, commitSha ?? '', path, row.kind, row.oldNumber ?? '', row.newNumber ?? ''].join('|')
}

export function fileAnchorPrefixOf(view: ReviewView, commitSha: string | null, path: string): string {
  return `${view}|${commitSha ?? ''}|${path}|`
}

export function overviewAnchorKeyOf(pullRequestNumber: number, blockIndex: number, block: string): string {
  return `overview|${pullRequestNumber}|${blockIndex}|${block.slice(0, 40)}`
}

// GitHub threads sit in the PR view; the path comes last since it may hold the separator. An outdated thread has no
// line and goes on top of its file.
export function gitHubThreadAnchorKeyOf(thread: GitHubReviewThread): string {
  return ['github', thread.side, thread.line ?? 0, thread.path].join('|')
}

export function describeLineForPrompt(path: string, row: DiffRow): string {
  if (row.kind === 'removed') {
    return `${path}, removed line (was line ${row.oldNumber})`
  }

  return `${path}, line ${row.newNumber} (${row.kind === 'added' ? 'added' : 'unchanged context'})`
}

export function surroundingRows(rows: DiffRow[], rowIndex: number, radius: number): DiffRow[] {
  return rows.slice(Math.max(0, rowIndex - radius), rowIndex + radius + 1)
}

export function formatRowsAsDiff(rows: DiffRow[]): string {
  const marks = { hunk: '@@', context: ' ', added: '+', removed: '-' } as const

  return rows.map(row => (row.kind === 'hunk' ? `@@ ${row.text}` : `${marks[row.kind]} ${row.text}`)).join('\n')
}

export function rowQuestionTarget(input: {
  viewDescription: string
  repositoryRoot: string | null
  path: string
  rows: DiffRow[]
  rowIndex: number
  contextRadius: number
}): QuestionTarget | null {
  const row = input.rows[input.rowIndex]
  if (!row) {
    return null
  }
  const lineDescription = describeLineForPrompt(input.path, row)
  const context = [
    `The person is reviewing ${input.viewDescription} in a review pane and asks about one line: ${lineDescription}.`,
    `Repository: ${input.repositoryRoot}. The line and the diff around it:`,
    '```diff',
    formatRowsAsDiff(surroundingRows(input.rows, input.rowIndex, input.contextRadius)),
    '```',
    'Their question follows. The answer is drawn under that line in the pane: keep it focused on it.',
  ].join('\n')

  return { anchorDescription: `${lineDescription} in ${input.viewDescription}`, context }
}

export function overviewQuestionTarget(input: {
  pullRequestHeadline: string
  pullRequestUrl: string
  repositoryRoot: string | null
  block: string
}): QuestionTarget {
  const context = [
    `The person is reviewing pull request ${input.pullRequestHeadline} (${input.pullRequestUrl}) in a review pane, and asks about this part of its description or conversation:`,
    '````markdown',
    input.block,
    '````',
    `Repository: ${input.repositoryRoot}. Their question follows. The answer is drawn under that part in the pane: keep it focused on it.`,
  ].join('\n')

  return { anchorDescription: `this part of pull request ${input.pullRequestHeadline}: "${input.block.slice(0, 120)}"`, context }
}

// A reply stays in the conversation the thread already lives in, so only the thread's anchor is restated. After a
// /clear the conversation no longer holds the thread: its earlier exchanges are sent again.
export function replyContextOf(thread: ReviewThread): string {
  const earlierExchanges = thread.isContextCleared
    ? [
        'The conversation was cleared since; the thread so far:',
        ...thread.exchanges.flatMap(exchange => [`Question: ${exchange.question}`, `Your answer: ${exchange.answer}`]),
      ]
    : [`It started with the question: "${thread.exchanges[0]?.question ?? ''}".`]

  return [
    `The person follows up in the review thread about ${thread.anchorDescription}.`,
    ...earlierExchanges,
    'Their follow-up follows. The answer is drawn in that thread in the pane: keep it focused on it.',
  ].join('\n')
}

export function newThread(id: string, anchorKey: string, anchorDescription: string, question: string): ReviewThread {
  return { id, anchorKey, anchorDescription, exchanges: [queuedExchange(question)], isContextCleared: false }
}

export function queuedExchange(question: string): ThreadExchange {
  return { question, answer: '', status: 'queued' }
}

export function withLastExchange(thread: ReviewThread, change: (exchange: ThreadExchange) => ThreadExchange): ReviewThread {
  const lastIndex = thread.exchanges.length - 1

  return { ...thread, exchanges: thread.exchanges.map((exchange, index) => (index === lastIndex ? change(exchange) : exchange)) }
}

export function isLastExchangeDone(thread: ReviewThread): boolean {
  return thread.exchanges[thread.exchanges.length - 1]?.status === 'done'
}

export type ParsedAnchor =
  | { kind: 'overview'; blockIndex: number }
  | { kind: 'row'; view: string; commitSha: string; path: string; lineNumber: number }

export function parseAnchorKey(anchorKey: string): ParsedAnchor | null {
  const parts = anchorKey.split('|')
  if (parts[0] === 'overview') {
    return { kind: 'overview', blockIndex: Number(parts[2]) }
  }
  if (parts[0] === 'github') {
    return { kind: 'row', view: 'pr', commitSha: '', path: parts.slice(3).join('|'), lineNumber: Number(parts[2]) || 0 }
  }
  if (parts.length < 6) {
    return null
  }
  const [view = '', commitSha = '', ...rest] = parts
  const [rowKind, oldNumber, newNumber] = rest.slice(-3)
  const path = rest.slice(0, -3).join('|')
  const lineNumber = Number(rowKind === 'removed' ? oldNumber : newNumber)

  return { kind: 'row', view, commitSha, path, lineNumber: Number.isNaN(lineNumber) ? 0 : lineNumber }
}

// The threads still waiting on each file, in the order given: a GitHub conversation already resolved is settled.
export function openThreadsByPath<Thread extends { id: string; anchorKey: string }>(
  threads: Thread[],
  resolvedThreadIds: ReadonlySet<string>,
): Record<string, Thread[]> {
  const threadsByPath: Record<string, Thread[]> = {}
  for (const thread of threads) {
    const anchor = parseAnchorKey(thread.anchorKey)
    if (anchor?.kind === 'row' && !resolvedThreadIds.has(thread.id)) {
      threadsByPath[anchor.path] = [...(threadsByPath[anchor.path] ?? []), thread]
    }
  }

  return threadsByPath
}

// The threads of what is on screen, in reading order: the PR overview first, then the files as the list shows them,
// each from its top line down.
export function threadsInReadingOrder<Thread extends { anchorKey: string }>(
  threads: Thread[],
  context: { view: ReviewView; commitSha: string | null; orderedPaths: string[]; hasOverview: boolean },
): Thread[] {
  const positionOf = (thread: Thread): [number, number] | null => {
    const anchor = parseAnchorKey(thread.anchorKey)
    if (anchor?.kind === 'overview') {
      return context.hasOverview ? [-1, anchor.blockIndex] : null
    }
    if (anchor?.kind !== 'row' || anchor.view !== context.view || anchor.commitSha !== (context.commitSha ?? '')) {
      return null
    }
    const fileIndex = context.orderedPaths.indexOf(anchor.path)

    return fileIndex === -1 ? null : [fileIndex, anchor.lineNumber]
  }

  return threads
    .flatMap(thread => {
      const position = positionOf(thread)
      return position ? [{ thread, position }] : []
    })
    .sort((first, second) => first.position[0] - second.position[0] || first.position[1] - second.position[1])
    .map(entry => entry.thread)
}

// Threads saved by an earlier session come back marked as cleared: that session's conversation is not this one, so a
// reply sends the thread again. An answer that was still arriving when it ended is kept as it stood.
export function restoredThreads(saved: unknown, threadIdsAlreadyShown: ReadonlySet<string>): ReviewThread[] {
  if (!Array.isArray(saved)) {
    return []
  }

  return saved.flatMap(candidate => {
    const thread = candidate as Partial<ReviewThread> | null
    const isThread =
      typeof thread?.id === 'string' &&
      typeof thread.anchorKey === 'string' &&
      typeof thread.anchorDescription === 'string' &&
      Array.isArray(thread.exchanges)
    if (!isThread || threadIdsAlreadyShown.has(thread.id as string)) {
      return []
    }

    return [
      {
        ...(thread as ReviewThread),
        isContextCleared: true,
        exchanges: (thread.exchanges as ThreadExchange[]).map(exchange => ({ ...exchange, status: 'done' as const })),
      },
    ]
  })
}
