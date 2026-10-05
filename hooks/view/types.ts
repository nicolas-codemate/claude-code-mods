import type { Elements } from 'claude-code'

import type { ReviewView } from '../../types'
import type { Theme } from './theme'

// A page of the repository on GitHub, and how the shortcut names it.
export type GitHubPage = { url: string; description: string }

// The elements a view draws with, and the colors of the pane's theme.
// `Svg` is the Desktop's alone: the terminal draws the same things in text.
export type ViewElements = Pick<Elements['terminal'], 'Box' | 'Button' | 'Client' | 'Code' | 'Input' | 'Link' | 'Markdown' | 'Text'> & {
  Svg?: Elements['desktop']['Svg']
  theme: Theme
}

export type ExplorerActions = {
  switchView: (view: ReviewView) => Promise<void>
  moveView: (offset: number) => Promise<void>
  refresh: () => Promise<void>
  close: () => Promise<void>
  selectCommit: (commitSha: string) => Promise<void>
  showOverview: () => Promise<void>
  selectFile: (path: string) => Promise<void>
  moveFileSelection: (offset: number) => Promise<void>
  toggleViewed: (path: string) => Promise<void>
  toggleMarked: (path: string) => Promise<void>
  toggleCurrentFileMark: () => Promise<void>
  markAllNewFiles: () => Promise<void>
  stageMarkedFiles: () => Promise<void>
  stageAllChanges: () => Promise<void>
  updateFileFilter: (filter: string) => Promise<void>
  toggleNoiseShown: () => Promise<void>
  toggleDirectoryFold: (directory: string) => Promise<void>
  toggleCurrentDirectoryFold: () => Promise<void>
  toggleFileDrawer: () => Promise<void>
  toggleFileListCollapse: () => Promise<void>
  openFirstThreadOfFile: (path: string) => Promise<void>
  expandContext: (path: string) => Promise<void>
  showWholeFile: (path: string) => Promise<void>
  toggleSplitView: () => Promise<void>
  explainSplitViewWidth: () => Promise<void>
  explainIdleShortcut: (description: string) => Promise<void>
  openQuestion: (anchorKey: string) => Promise<void>
  closeQuestion: () => Promise<void>
  updateQuestionDraft: (text: string) => Promise<void>
  askAboutRow: (anchorKey: string, rowIndex: number, question: string) => Promise<void>
  armRowQuestion: (anchorKey: string, rowIndex: number) => Promise<void>
  askAboutOverviewBlock: (anchorKey: string, blockIndex: number, question: string) => Promise<void>
  armOverviewQuestion: (anchorKey: string, blockIndex: number) => Promise<void>
  disarmQuestion: () => Promise<void>
  dismissThread: (threadId: string) => Promise<void>
  replyInThread: (threadId: string, reply: string) => Promise<void>
  armReply: (threadId: string) => Promise<void>
  moveThread: (offset: number) => Promise<void>
  openOnGitHub: (page: GitHubPage) => Promise<void>
  toggleGitHubThread: (threadId: string) => Promise<void>
  toggleGitHubThreadResolved: (threadId: string) => Promise<void>
  addressGitHubThread: (threadId: string) => Promise<void>
  moveCursor: (offset: number) => Promise<void>
  moveCursorToHunk: (direction: 1 | -1) => Promise<void>
  askOnCursorLine: () => Promise<void>
  replyOnCursorLine: () => Promise<void>
  toggleHelp: () => Promise<void>
  markViewedAndNext: () => Promise<void>
  focusFileFilter: () => Promise<void>
  submitFileFilter: (filter: string) => Promise<void>
}

// Where the thread the keyboard last went to stands among the threads of what is on screen.
export type ThreadNavigation = {
  position: number | null
  count: number
  // The GitHub thread the keyboard went to, which its shortcut resolves or unresolves.
  currentGitHubThread: { id: string; isResolved: boolean } | null
}

export type QuestionState = {
  anchorWithOpenInput: string | null
  isQuestionFieldShown: boolean
  questionFieldKey: string
  armedAnchorKey: string | null
  // Lit and unlit by turns while Claude answers a thread.
  isAnswerPulseLit: boolean
}
