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

export type DiffRow = { kind: DiffRowKind; oldNumber: number | null; newNumber: number | null; text: string; language?: string }

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

// Each push and each force push waits for a second press; a push the remote refused offers the force push.
export type PushState = 'idle' | 'armed' | 'pushing' | 'pushed' | 'rejected' | 'forceArmed'

// A failure the notice itself can act on: a refused push offers the force push right where it is reported.
export type ErrorNotice = { id: string; text: string; action: 'forcePush' | null }

// Where a file of the Uncommitted view stands against the index: all of it staged, part of it, or none of it.
export type StageState = 'staged' | 'partlyStaged' | 'unstaged'

export type CommitRequest =
  | { state: 'idle' }
  | { state: 'requested'; headBeforeRequest: string | null; turnId: string | null }
  | { state: 'awaitingReply'; headBeforeRequest: string | null }

declare module 'claude-code' {
  interface PluginState {
    'diff-review': {
      view: ReviewView
      baseRef: string | null
      baseBranchName: string | null
      uncommittedFileCount: number
      stagedFileCount: number
      stageStateByPath: Record<string, StageState>
      // The last git status read, to reload the view only when the working tree changed between two polls.
      workingTreeStatus: string
      commitRequest: CommitRequest
      commitThread: ReviewThread | null
      // The branch's commits since its base, the pull request's one when there is a pull request.
      branchCommitCount: number
      // The branch's commits its remote does not have yet, all of them while the branch was never pushed.
      unpushedCommitShas: string[]
      pushState: PushState
      commitListOffset: number | null
      errorNotices: ErrorNotice[]
      helpScrolledLines: number
      // The thread whose answer the diff follows as it grows, until the person scrolls, moves or changes file.
      followedThreadId: string | null
      commits: CommitSummary[]
      commitGraph: CommitGraphLine[]
      selectedCommitSha: string | null
      // The whole message of the selected commit, its body included.
      selectedCommitMessage: string | null
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
      // Lines of the first shown row scrolled above the top, kept for the file and the row they were scrolled on.
      diffSkippedLines: { path: string; rowIndex: number; lines: number } | null
      isOverviewShown: boolean
      isLoading: boolean
      repositoryRoot: string | null
      repositoryWebUrl: string | null
      branch: string | null
      fileFilter: string
      watchedTerm: string
      isWatchFieldOpen: boolean
      // The rows of every file of the view, read once a term is watched, so typing it searches them without git.
      watchedSourceRowsByPath: Record<string, DiffRow[]>
      watchedMatchCountByPath: Record<string, number>
      contextLinesByPath: Record<string, number>
      currentThreadId: string | null
      isNoiseShown: boolean
      isViewedHidden: boolean
      recentlyViewedPaths: string[]
      foldedDirectories: string[]
      isFileDrawerOpen: boolean
      isFileListCollapsed: boolean
      isSplitViewPreferred: boolean
      cursorRowIndex: number | null
      isHelpShown: boolean
      answerPulseFrame: number
      claudeCodeTheme: string | null
      questionFieldNumber: number
      requestedPaneColumns: number
      fileListWidth: number
      armedQuestion: { anchorKey: string; anchorDescription: string; context: string; threadId?: string } | null
      pullRequest: PullRequestSummary | null
      gitHubReviewThreads: GitHubReviewThread[]
      expandedGitHubThreadIds: string[]
      viewedStateByPath: Record<string, ViewedState>
      pushDismissedPaths: string[]
      renamedPathByPreviousPath: Record<string, string>
    }
  }
}
