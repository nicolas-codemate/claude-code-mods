export type ReviewView = 'uncommitted' | 'pr' | 'commits'

export type ChangedFile = {
  path: string
  addedLines: number | null
  removedLines: number | null
  isUntracked: boolean
  // Created or deleted by the change; absent, the file was modified.
  creation?: 'created' | 'deleted'
}

export type DiffRowKind = 'hunk' | 'context' | 'added' | 'removed'

export type DiffRow = { kind: DiffRowKind; oldNumber: number | null; newNumber: number | null; text: string }

export type CommitSummary = {
  sha: string
  shortSha: string
  subject: string
  author: string
  relativeDate: string
  // The branches and tags pointing at the commit, as git log --decorate names them.
  refs: string[]
}

// One line of git log --graph: a commit with the lanes drawn left of it, or only lanes joining or splitting.
export type CommitGraphLine = { graph: string; commit: CommitSummary | null; isBoundary: boolean }

export type KeyboardLayout = 'azerty' | 'qwerty' | 'unknown'

export type ViewedState = 'VIEWED' | 'UNVIEWED' | 'DISMISSED'

export type GitHubComment = { author: string; body: string; createdAt: string; url: string }

// An inline review conversation of the pull request on GitHub. An outdated one has lost its line in the current diff.
export type GitHubReviewThread = {
  id: string
  path: string
  side: 'LEFT' | 'RIGHT'
  line: number | null
  originalLine: number | null
  isResolved: boolean
  isOutdated: boolean
  comments: GitHubComment[]
}

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
      commitGraph: CommitGraphLine[]
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
      repositoryWebUrl: string | null
      branch: string | null
      markedPaths: string[]
      fileFilter: string
      contextLinesByPath: Record<string, number>
      currentThreadId: string | null
      isNoiseShown: boolean
      isSplitViewPreferred: boolean
      cursorRowIndex: number | null
      isHelpShown: boolean
      claudeCodeTheme: string | null
      questionFieldNumber: number
      requestedPaneColumns: number
      fileListWidth: number
      armedQuestion: { anchorKey: string; anchorDescription: string; context: string; threadId?: string } | null
      pullRequest: PullRequestSummary | null
      gitHubReviewThreads: GitHubReviewThread[]
      expandedGitHubThreadIds: string[]
      viewedStateByPath: Record<string, ViewedState>
    }
  }
}
