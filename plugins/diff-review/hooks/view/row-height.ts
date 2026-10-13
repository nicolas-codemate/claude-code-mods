import type { DiffRow, GitHubReviewThread, ReviewThread, ReviewView } from '../../types'
import { isGitHubThreadOnRow } from '../github-review'
import { anchorKeyOf, isLastExchangeDone } from '../questions'
import type { SplitRow } from '../split-rows'
import { isGitHubThreadFolded } from './github-threads'
import type { QuestionState } from './types'

// The columns a diff row spends before its code: the ask gutter, the line numbers and the change mark.
const UNIFIED_CODE_GUTTER = 4 + 10 + 3
const SPLIT_CODE_GUTTER = 4 + 5 + 3
// A thread's right margin, its border and its padding; under a line it is also indented.
export const THREAD_HORIZONTAL_CHROME_WITHOUT_INDENT = 2 + 2 + 2
const THREAD_HORIZONTAL_CHROME = 16 + THREAD_HORIZONTAL_CHROME_WITHOUT_INDENT
// Its top and bottom margins and its border.
const THREAD_VERTICAL_CHROME = 2 + 2
// The banner that hands a question to the prompt: a thread's margins and border around two lines.
export const ARMED_BANNER_ROWS = THREAD_VERTICAL_CHROME + 2
const TAB_WIDTH = 4
// Code wraps between words, leaving the end of each line short: a tenth of the width is counted as lost.
const WORD_WRAP_LOSS = 0.9

export type RowHeightInput = {
  view: ReviewView
  selectedCommitSha: string | null
  path: string
  // The columns inside the diff box's border.
  diffContentWidth: number
  threads: ReviewThread[]
  gitHubThreads: GitHubReviewThread[]
  expandedGitHubThreadIds: string[]
  currentThreadId: string | null
  questionState: QuestionState
}

// The engine measures nothing drawn inside a pane, so each row's height is counted from its text: a guess that errs
// long rather than short, so the end of an answer can always be scrolled to.
export function estimatedRowHeights(rows: DiffRow[], splitRows: SplitRow[] | null, input: RowHeightInput): number[] {
  if (splitRows === null) {
    return rows.map(row =>
      row.kind === 'hunk' ? 1 : wrappedLineCount(row.text, Math.floor((input.diffContentWidth - UNIFIED_CODE_GUTTER) * WORD_WRAP_LOSS)) + inlineContentHeight(row, input),
    )
  }
  const sideCodeWidth = Math.floor((Math.floor((input.diffContentWidth - 1) / 2) - SPLIT_CODE_GUTTER) * WORD_WRAP_LOSS)

  return splitRows.map(splitRow => {
    if (splitRow.kind === 'hunk') {
      return 1
    }
    const { left, right } = splitRow
    const isSameRowOnBothSides = left !== null && left.rowIndex === right?.rowIndex
    const codeHeight = Math.max(
      left ? wrappedLineCount(left.row.text, sideCodeWidth) : 1,
      right ? wrappedLineCount(right.row.text, sideCodeWidth) : 1,
    )
    const sidesWithThreads = [isSameRowOnBothSides ? null : left, right].flatMap(side => (side ? [side] : []))

    return codeHeight + sidesWithThreads.reduce((height, side) => height + inlineContentHeight(side.row, input), 0)
  })
}

function inlineContentHeight(row: DiffRow, input: RowHeightInput): number {
  const anchorKey = anchorKeyOf(input.view, input.selectedCommitSha, input.path, row)
  const threadTextWidth = input.diffContentWidth - THREAD_HORIZONTAL_CHROME
  const gitHubThreadsHeight = input.gitHubThreads
    .filter(thread => isGitHubThreadOnRow(thread, input.path, row))
    .reduce((height, thread) => height + gitHubThreadHeight(thread, threadTextWidth, input), 0)
  const threadsHeight = input.threads
    .filter(thread => thread.anchorKey === anchorKey)
    .reduce((height, thread) => height + threadHeight(thread, threadTextWidth), 0)
  const { questionState } = input
  const questionFieldHeight =
    questionState.anchorWithOpenInput === anchorKey && questionState.isQuestionFieldShown ? THREAD_VERTICAL_CHROME + 2 : 0
  const armedBannerHeight = questionState.armedAnchorKey === anchorKey ? ARMED_BANNER_ROWS : 0

  return gitHubThreadsHeight + threadsHeight + questionFieldHeight + armedBannerHeight
}

export function threadHeight(thread: ReviewThread, textWidth: number): number {
  const exchangesHeight = thread.exchanges.reduce(
    (height, exchange, exchangeIndex) =>
      height +
      (exchangeIndex === 0 ? 0 : 1) +
      wrappedLineCount(`› ${exchange.question}`, textWidth) +
      (exchange.answer === '' ? 1 : markdownLineCount(exchange.answer, textWidth)),
    0,
  )
  const headerHeight = 1
  const contextClearedHeight = thread.isContextCleared ? 2 : 0
  const replyHeight = isLastExchangeDone(thread) ? 2 : 0

  return THREAD_VERTICAL_CHROME + headerHeight + exchangesHeight + contextClearedHeight + replyHeight
}

function gitHubThreadHeight(thread: GitHubReviewThread, textWidth: number, input: RowHeightInput): number {
  if (isGitHubThreadFolded(thread, input)) {
    return 1
  }
  const commentsHeight = thread.comments.reduce(
    (height, comment, commentIndex) => height + (commentIndex === 0 ? 0 : 1) + 1 + markdownLineCount(comment.body, textWidth),
    0,
  )
  const headerHeight = 1

  return THREAD_VERTICAL_CHROME + headerHeight + commentsHeight
}

export function wrappedLineCount(text: string, width: number): number {
  return Math.max(1, Math.ceil(text.replaceAll('\t', ' '.repeat(TAB_WIDTH)).length / Math.max(1, width)))
}

// Every source line counts with the room a list marker or a quote bar takes, a heading with the blank line drawn
// under it, and the whole with one spare line for the spacing the renderer adds between blocks.
export function markdownLineCount(markdown: string, width: number): number {
  const spareLines = 1

  return (
    markdown
      .trimEnd()
      .split('\n')
      .reduce((height, line) => height + wrappedLineCount(`  ${line}`, width) + (/^#{1,6}\s/.test(line) ? 1 : 0), 0) +
    spareLines
  )
}
