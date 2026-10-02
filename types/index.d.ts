export type ReviewView = 'uncommitted' | 'pr' | 'commits'

export type ChangedFile = { path: string; addedLines: number | null; removedLines: number | null; isUntracked: boolean }

export type DiffRowKind = 'hunk' | 'context' | 'added' | 'removed'

export type DiffRow = { kind: DiffRowKind; oldNumber: number | null; newNumber: number | null; text: string }

export type CommitSummary = { sha: string; shortSha: string; subject: string; author: string; relativeDate: string }

export type KeyboardLayout = 'azerty' | 'qwerty' | 'unknown'

export type ViewedState = 'VIEWED' | 'UNVIEWED' | 'DISMISSED'

export type PullRequestSummary = {
  id: string
  number: number
  url: string
  baseRefName: string | null
  additions: number
  deletions: number
  changedFiles: number
  overviewHeadline: string
  overviewMarkdown: string
}

export type ThreadExchange = { question: string; answer: string; status: 'queued' | 'answering' | 'done' }

export type ReviewThread = {
  id: string
  anchorKey: string
  anchorDescription: string
  exchanges: ThreadExchange[]
  isContextCleared: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'diff-review': {
      view: ReviewView
      baseRef: string | null
      commits: CommitSummary[]
      selectedCommitSha: string | null
      files: ChangedFile[]
      selectedFilePath: string | null
      diffRows: DiffRow[]
      loadError: string | null
      threads: ReviewThread[]
      anchorWithOpenInput: string | null
      threadIdByTurnId: Record<string, string>
      threadIdAwaitingTurn: string | null
      questionDraft: string
      hasQuestionHadKeyboard: boolean
      focusedElementKey: string | null
      keyboardLayout: KeyboardLayout
      fileListOffset: number
      diffOffset: number
      isOverviewShown: boolean
      isLoading: boolean
      repositoryRoot: string | null
      markedPaths: string[]
      questionFieldNumber: number
      pullRequest: PullRequestSummary | null
      viewedStateByPath: Record<string, ViewedState>
    }
  }
}
