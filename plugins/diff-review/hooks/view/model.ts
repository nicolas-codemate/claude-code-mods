import type {
  ChangedFile,
  CommitGraphLine,
  CommitRequest,
  ErrorNotice,
  CommitSummary,
  GitHubReviewThread,
  DiffRow,
  PullRequestSummary,
  PushState,
  ReviewThread,
  ReviewView,
  StageState,
  ViewedState,
} from '../../types'
import {
  COMMIT_THREAD_ANCHOR_KEY,
  FILE_FILTER_KEY,
  QUESTION_INPUT_KEY_PREFIX,
  REPLY_INPUT_KEY_PREFIX,
  SPLIT_VIEW_MIN_DIFF_WIDTH,
  TWO_COLUMNS_MIN_WIDTH,
  WATCH_FIELD_KEY,
} from '../constants'
import { viewedPathsToHide, visibleFilesOf } from '../file-filter'
import { cursorStopsOf, firstChangeStop } from '../cursor'
import { countLinesToView, countViewedFiles, gitHubThreadNavigationEntries } from '../github-review'
import type { Keymap, ShortcutAction } from '../keymap'
import { buildFileLines, clampFileListWidth, computePaneGeometry, scrolledByLines, topLineFollowingRow } from '../layout'
import type { DiffScrollPosition } from '../layout'
import type { PaneGeometry } from '../layout'
import { splitMarkdownBlocks } from '../markdown'
import { anchorKeyOf, fileAnchorPrefixOf, openThreadsByPath, threadsInReadingOrder } from '../questions'
import { groupFilesByDirectory } from '../git-parsing'
import { pairRowsSideBySide, splitIndexOfRow } from '../split-rows'
import { commitBarRows } from './commit-bar'
import { commitMessageRows } from './commit-message'
import type { CommitMessageInput } from './commit-message'
import type { CommitBarInput } from './commit-bar'
import { LINES_TO_VIEW_TILE_LABEL } from './drawings'
import type { HeaderTile } from './drawings'
import { estimatedRowHeights } from './row-height'
import type { PaneInput } from './pane'
import type { ExplorerActions, GitHubPage, QuestionState, ThreadNavigation } from './types'

export type ExplorerSnapshot = {
  view: ReviewView
  repositoryRoot: string | null
  repositoryWebUrl: string | null
  branch: string | null
  baseRef: string | null
  baseBranchName: string | null
  uncommittedFileCount: number
  stagedFileCount: number
  commitRequest: CommitRequest
  commitThread: ReviewThread | null
  branchCommitCount: number
  unpushedCommitShas: string[]
  pushState: PushState
  commitListOffset: number | null
  errorNotices: ErrorNotice[]
  helpScrolledLines: number
  followedThreadId: string | null
  isLoading: boolean
  loadError: string | null
  commits: CommitSummary[]
  commitGraph: CommitGraphLine[]
  gitHubReviewThreads: GitHubReviewThread[]
  expandedGitHubThreadIds: string[]
  selectedCommitSha: string | null
  selectedCommitMessage: string | null
  files: ChangedFile[]
  selectedFilePath: string | null
  isOverviewShown: boolean
  diffRows: DiffRow[]
  pullRequest: PullRequestSummary | null
  viewedStateByPath: Record<string, ViewedState>
  stageStateByPath: Record<string, StageState>
  fileFilter: string
  watchedTerm: string
  isWatchFieldOpen: boolean
  watchedMatchCountByPath: Record<string, number>
  isWholeFileByPath: Record<string, boolean>
  isNoiseShown: boolean
  isViewedHidden: boolean
  recentlyViewedPaths: string[]
  foldedDirectories: string[]
  isFileDrawerOpen: boolean
  isFileListCollapsed: boolean
  isSplitViewPreferred: boolean
  keymap: Keymap
  isHelpShown: boolean
  cursorRowIndex: number | null
  focusedElementKey: string | null
  fileListWidth: number
  fileListOffset: number
  diffOffset: number
  diffSkippedLines: { path: string; rowIndex: number; lines: number } | null
  threads: ReviewThread[]
  anchorWithOpenInput: string | null
  questionFieldNumber: number
  questionDraft: string
  hasQuestionHadKeyboard: boolean
  armedAnchorKey: string | null
  currentThreadId: string | null
  answerPulseFrame: number
}

export type PaneSurface = { bodyRows: number; bodyColumns: number; isPaneFocused: boolean }

export type PaneModel = {
  paneInput: PaneInput
  geometry: PaneGeometry
  fileLineIndexByPath: Record<string, number>
  fileLineCount: number
  commitLineCount: number
  scrolledRowCount: number
  isOverviewShown: boolean
  isSplitView: boolean
  cursorRowIndex: number | null
  isScrollingPastEnd: boolean
  // Filled while a file's diff is shown, empty on the overview.
  diffRowHeights: number[]
  // Where the diff should stand to keep the followed answer's end in sight, when it does not stand there yet.
  followPosition: DiffScrollPosition | null
}

export function buildPaneModel(snapshot: ExplorerSnapshot, surface: PaneSurface, actions: ExplorerActions): PaneModel {
  const { view, files, selectedFilePath, selectedCommitSha, threads } = snapshot
  const pullRequest = view === 'pr' ? snapshot.pullRequest : null
  const viewedStateByPath = pullRequest ? snapshot.viewedStateByPath : {}
  const isOverviewShown = pullRequest !== null && snapshot.isOverviewShown
  const overviewBlocks = pullRequest && isOverviewShown ? splitMarkdownBlocks(pullRequest.overviewMarkdown) : []
  const hasStageActions = view === 'uncommitted' && files.length > 0

  // A one-letter shortcut would fire on the letters typed into a question or a reply: none is bound meanwhile.
  const focusedElementKey = snapshot.focusedElementKey ?? ''
  const isTyping =
    focusedElementKey.startsWith(QUESTION_INPUT_KEY_PREFIX) ||
    focusedElementKey.startsWith(REPLY_INPUT_KEY_PREFIX) ||
    focusedElementKey === FILE_FILTER_KEY ||
    focusedElementKey === WATCH_FIELD_KEY
  const isWatchBarShown = snapshot.watchedTerm !== '' || snapshot.isWatchFieldOpen
  // Each shortcut a drawn button carries is noted, so the ones left over get a stand-in (see renderIdleShortcuts).
  const claimedActions = new Set<ShortcutAction>(['previousFile', 'nextFile', 'previousView', 'nextView'])
  const hotkeyOf = (action: ShortcutAction) => {
    if (isTyping) {
      return undefined
    }
    claimedActions.add(action)
    return snapshot.keymap[action][0]
  }

  const questionState: QuestionState = {
    anchorWithOpenInput: snapshot.anchorWithOpenInput,
    // Escape or a click outside gives the keyboard back to the prompt: an empty question that had the keyboard then
    // stops being drawn. One just opened by a click while the prompt still held the keyboard stays.
    isQuestionFieldShown: surface.isPaneFocused || !snapshot.hasQuestionHadKeyboard || snapshot.questionDraft.trim() !== '',
    questionFieldKey: `${QUESTION_INPUT_KEY_PREFIX}${snapshot.questionFieldNumber}`,
    armedAnchorKey: snapshot.armedAnchorKey,
    isAnswerPulseLit: snapshot.answerPulseFrame % 2 === 0,
  }
  const isCommitBarShown =
    view === 'uncommitted' &&
    (snapshot.stagedFileCount > 0 || snapshot.commitRequest.state !== 'idle' || snapshot.commitThread !== null)
  const commitBar: CommitBarInput | null = isCommitBarShown
    ? {
        stagedFileCount: snapshot.stagedFileCount,
        commitRequest: snapshot.commitRequest,
        thread: snapshot.commitThread,
        isReplyArmed: snapshot.armedAnchorKey === COMMIT_THREAD_ANCHOR_KEY,
        isAnswerPulseLit: questionState.isAnswerPulseLit,
      }
    : null
  const selectedCommit = snapshot.commits.find(commit => commit.sha === selectedCommitSha)
  const commitMessage: CommitMessageInput | null =
    view === 'commits' && selectedCommit && snapshot.selectedCommitMessage !== null
      ? { commit: selectedCommit, message: snapshot.selectedCommitMessage }
      : null
  const fileAnchorPrefix = selectedFilePath ? fileAnchorPrefixOf(view, selectedCommitSha, selectedFilePath) : null
  const gitHubThreads = pullRequest ? snapshot.gitHubReviewThreads : []
  const gitHubThreadsOfFile = gitHubThreads.filter(thread => thread.path === selectedFilePath)
  const hasInlineContentInFile =
    gitHubThreadsOfFile.length > 0 ||
    (fileAnchorPrefix !== null &&
      [...threads.map(thread => thread.anchorKey), snapshot.anchorWithOpenInput, snapshot.armedAnchorKey].some(anchorKey =>
        (anchorKey ?? '').startsWith(fileAnchorPrefix),
      ))

  const isViewedHidden = pullRequest !== null && snapshot.isViewedHidden
  const shown = visibleFilesOf(files, {
    filter: snapshot.fileFilter,
    isNoiseShown: snapshot.isNoiseShown,
    hiddenPaths: isViewedHidden ? viewedPathsToHide(viewedStateByPath, snapshot.recentlyViewedPaths) : undefined,
  })
  const fileLines = buildFileLines(shown.files, pullRequest !== null, snapshot.foldedDirectories)
  const threadsOfScreen = threadsInReadingOrder([...threads, ...gitHubThreadNavigationEntries(gitHubThreads)], {
    view,
    commitSha: view === 'commits' ? selectedCommitSha : null,
    orderedPaths: groupFilesByDirectory(shown.files).flatMap(group => group.files.map(file => file.path)),
    hasOverview: pullRequest !== null,
  })
  const resolvedGitHubThreadIds = new Set(gitHubThreads.filter(thread => thread.isResolved).map(thread => thread.id))
  const gitHubThreadIds = new Set(gitHubThreads.map(thread => thread.id))
  const openThreadCountByPath = Object.fromEntries(
    Object.entries(openThreadsByPath(threadsOfScreen, resolvedGitHubThreadIds)).map(([path, threadsOfFile]) => {
      const gitHubCount = threadsOfFile.filter(thread => gitHubThreadIds.has(thread.id)).length
      return [path, { claudeCount: threadsOfFile.length - gitHubCount, gitHubCount }]
    }),
  )
  const currentThreadIndex = threadsOfScreen.findIndex(thread => thread.id === snapshot.currentThreadId)
  const threadNavigation: ThreadNavigation = {
    position: currentThreadIndex === -1 ? null : currentThreadIndex,
    count: threadsOfScreen.length,
    currentGitHubThread: gitHubThreads.find(thread => thread.id === snapshot.currentThreadId) ?? null,
  }
  const diffWidth =
    !snapshot.isFileListCollapsed && surface.bodyColumns >= TWO_COLUMNS_MIN_WIDTH
      ? surface.bodyColumns - clampFileListWidth(snapshot.fileListWidth, surface.bodyColumns)
      : surface.bodyColumns
  const canSplitView = diffWidth >= SPLIT_VIEW_MIN_DIFF_WIDTH
  const splitRows = canSplitView && snapshot.isSplitViewPreferred ? pairRowsSideBySide(snapshot.diffRows) : null
  const cursorStops = cursorStopsOf(snapshot.diffRows, splitRows)
  const cursorRowIndex =
    snapshot.cursorRowIndex !== null && cursorStops.includes(snapshot.cursorRowIndex)
      ? snapshot.cursorRowIndex
      : firstChangeStop(snapshot.diffRows, cursorStops)
  const hasLineShortcuts = !isOverviewShown && selectedFilePath !== null
  const scrolledRowCount = isOverviewShown ? overviewBlocks.length : (splitRows ?? snapshot.diffRows).length
  const isScrollingPastEnd = isOverviewShown || hasInlineContentInFile
  const isScrollingByLines = !isOverviewShown && selectedFilePath !== null
  const geometry = computePaneGeometry({
    bodyRows: surface.bodyRows,
    bodyColumns: surface.bodyColumns,
    view,
    hasLoadError: snapshot.loadError !== null,
    errorNoticeCount: snapshot.errorNotices.length,
    hasPullRequestLine: pullRequest !== null,
    commitLineCount: snapshot.commitGraph.length,
    requestedCommitListOffset: snapshot.commitListOffset,
    selectedCommitLineIndex: Math.max(
      0,
      snapshot.commitGraph.findIndex(line => !line.isBoundary && line.commit?.sha === selectedCommitSha),
    ),
    fileLineCount: fileLines.length,
    hasStageActions,
    commitBarRows: commitBar ? commitBarRows(commitBar, surface.bodyColumns) : 0,
    commitMessageRows: commitMessage ? commitMessageRows(commitMessage, surface.bodyColumns) : 0,
    hasNoiseNotice: shown.hiddenNoiseCount > 0 || snapshot.isNoiseShown,
    hasWatchBar: isWatchBarShown,
    requestedFileListWidth: snapshot.fileListWidth,
    requestedFileListOffset: snapshot.fileListOffset,
    scrolledRowCount,
    isScrollingPastEnd,
    isScrollingByLines,
    requestedDiffOffset: snapshot.diffOffset,
    hasLineShortcuts,
    isFileDrawerOpen: snapshot.isFileDrawerOpen,
    isFileListCollapsed: snapshot.isFileListCollapsed,
  })
  // The divider beside the file list is left out of the width too: a narrower guess only counts more lines.
  const diffContentWidth = diffWidth - 3
  const diffRowHeights =
    isScrollingByLines && selectedFilePath !== null
      ? estimatedRowHeights(snapshot.diffRows, splitRows, {
          view,
          selectedCommitSha,
          path: selectedFilePath,
          diffContentWidth,
          threads,
          gitHubThreads: gitHubThreadsOfFile,
          expandedGitHubThreadIds: snapshot.expandedGitHubThreadIds,
          currentThreadId: snapshot.currentThreadId,
          questionState,
        })
      : []
  const savedSkippedLines = snapshot.diffSkippedLines
  const firstShownRowHeight = diffRowHeights[geometry.diffOffset]
  const diffSkippedLines =
    savedSkippedLines !== null &&
    savedSkippedLines.path === selectedFilePath &&
    savedSkippedLines.rowIndex === geometry.diffOffset &&
    firstShownRowHeight !== undefined
      ? Math.min(savedSkippedLines.lines, firstShownRowHeight - 1)
      : 0
  const followedThread = threads.find(thread => thread.id === snapshot.followedThreadId)
  const followedRowIndex =
    followedThread && selectedFilePath !== null
      ? snapshot.diffRows.findIndex(row => anchorKeyOf(view, selectedCommitSha, selectedFilePath, row) === followedThread.anchorKey)
      : -1
  let followPosition: DiffScrollPosition | null = null
  if (followedRowIndex !== -1 && diffRowHeights.length > 0) {
    const followedScrolledIndex = splitRows ? splitIndexOfRow(splitRows, followedRowIndex) : followedRowIndex
    const currentTopLine = diffRowHeights.slice(0, geometry.diffOffset).reduce((total, height) => total + height, 0) + diffSkippedLines
    const followingTopLine = topLineFollowingRow(diffRowHeights, followedScrolledIndex, currentTopLine, geometry.visibleDiffRows)
    if (followingTopLine !== currentTopLine) {
      const totalLines = diffRowHeights.reduce((total, height) => total + height, 0)
      followPosition = scrolledByLines({ rowIndex: 0, skippedLines: 0 }, followingTopLine, diffRowHeights, totalLines - 1)
    }
  }
  const repositoryName = snapshot.repositoryRoot?.split('/').filter(Boolean).at(-1)
  const location = [
    snapshot.isLoading ? 'loading…' : null,
    repositoryName ? `\u{1F4C1} ${repositoryName}` : null,
    snapshot.branch ? `\u{1F33F} ${snapshot.branch}` : null,
    view !== 'uncommitted' && snapshot.baseRef ? `from ${snapshot.baseBranchName ?? 'base'} ${snapshot.baseRef.slice(0, 10)}` : null,
  ]
    .filter(part => part !== null && part !== '')
    .join('  │  ')

  const viewedCount = countViewedFiles(files.map(file => file.path), viewedStateByPath)
  const linesToView = countLinesToView(files, viewedStateByPath)
  const paneInput: PaneInput = {
    bodyRows: surface.bodyRows,
    bodyColumns: surface.bodyColumns,
    geometry,
    view,
    location,
    uncommittedFileCount: snapshot.uncommittedFileCount,
    branchCommitCount: snapshot.branchCommitCount,
    unpushedCommitShas: snapshot.unpushedCommitShas,
    pushState: snapshot.pushState,
    help: snapshot.isHelpShown ? { keymap: snapshot.keymap, scrolledLines: snapshot.helpScrolledLines } : null,
    loadError: snapshot.loadError,
    errorNotices: snapshot.errorNotices,
    pullRequest,
    viewedCount,
    linesToView,
    watchBar: isWatchBarShown ? { term: snapshot.watchedTerm, matchCountByPath: snapshot.watchedMatchCountByPath } : null,
    commitBar,
    commitMessage,
    headerTiles: headerTilesOf(files, pullRequest, viewedCount, linesToView, gitHubThreads),
    commitGraph: snapshot.commitGraph,
    commitCount: snapshot.commits.length,
    repositoryWebUrl: snapshot.repositoryWebUrl,
    gitHubPage: gitHubPageOf(
      snapshot,
      pullRequest,
      gitHubThreads.find(thread => thread.id === snapshot.currentThreadId),
    ),
    selectedCommitSha,
    hotkeyOf,
    idleShortcuts: isTyping ? null : { keymap: snapshot.keymap, claimedActions },
    fileList: {
      files,
      shownFileCount: shown.files.length,
      hiddenNoiseCount: shown.hiddenNoiseCount,
      fileFilter: snapshot.fileFilter,
      watchedMatchCountByPath: snapshot.watchedMatchCountByPath,
      isNoiseShown: snapshot.isNoiseShown,
      isViewedHidden,
      hasUnpushedCommits: snapshot.unpushedCommitShas.length > 0,
      fileLines,
      shownFileLines: fileLines.slice(geometry.fileListOffset, geometry.fileListOffset + geometry.visibleFileLines),
      fileListOffset: geometry.fileListOffset,
      visibleFileLines: geometry.visibleFileLines,
      selectedFilePath,
      isOverviewShown,
      pullRequest,
      viewedStateByPath,
      openThreadCountByPath,
      hasStageActions,
      stageStateByPath: view === 'uncommitted' ? snapshot.stageStateByPath : null,
      keymap: snapshot.keymap,
      isTyping,
      hotkeyOf,
      actions,
    },
    overview:
      pullRequest && isOverviewShown
        ? {
            pullRequest,
            blocks: overviewBlocks,
            blockOffset: geometry.diffOffset,
            visibleBlocks: geometry.visibleDiffRows,
            threads,
            questionState,
            threadNavigation,
            hotkeyOf,
            actions,
          }
        : null,
    diff: {
      view,
      selectedCommitSha,
      selectedFile: files.find(file => file.path === selectedFilePath),
      diffRows: snapshot.diffRows,
      splitRows,
      canSplitView,
      cursorRowIndex,
      hasLineShortcuts,
      isOnGitHubThread: threadNavigation.currentGitHubThread !== null,
      watchedTerm: snapshot.watchedTerm,
      canMarkViewed: selectedFilePath !== null && viewedStateByPath[selectedFilePath] !== undefined,
      keymap: snapshot.keymap,
      isWholeFile: selectedFilePath !== null && snapshot.isWholeFileByPath[selectedFilePath] === true,
      diffOffset: geometry.diffOffset,
      diffSkippedLines,
      visibleDiffRows: geometry.visibleDiffRows,
      threads,
      gitHubThreads: gitHubThreadsOfFile,
      expandedGitHubThreadIds: snapshot.expandedGitHubThreadIds,
      currentThreadId: snapshot.currentThreadId,
      questionState,
      threadNavigation,
      hotkeyOf,
      actions,
    },
    actions,
  }

  return {
    paneInput,
    geometry,
    fileLineIndexByPath: Object.fromEntries(
      fileLines.flatMap((fileLine, index) => (fileLine.kind === 'file' ? [[fileLine.file.path, index]] : [])),
    ),
    fileLineCount: fileLines.length,
    commitLineCount: snapshot.commitGraph.length,
    scrolledRowCount,
    isOverviewShown,
    isSplitView: splitRows !== null,
    cursorRowIndex,
    isScrollingPastEnd,
    diffRowHeights,
    followPosition,
  }
}

function headerTilesOf(
  files: ChangedFile[],
  pullRequest: PullRequestSummary | null,
  viewedCount: { viewed: number; total: number },
  linesToView: { addedLines: number; removedLines: number },
  gitHubThreads: GitHubReviewThread[],
): HeaderTile[] {
  const lineTotals = pullRequest
    ? { addedLines: pullRequest.additions, removedLines: pullRequest.deletions }
    : files.reduce(
        (totals, file) => ({ addedLines: totals.addedLines + (file.addedLines ?? 0), removedLines: totals.removedLines + (file.removedLines ?? 0) }),
        { addedLines: 0, removedLines: 0 },
      )
  const tiles: HeaderTile[] = [
    { kind: 'count', label: 'Files', value: String(files.length) },
    { kind: 'lines', label: 'Lines', ...lineTotals },
  ]
  if (pullRequest) {
    tiles.push(
      { kind: 'progress', label: 'Viewed', done: viewedCount.viewed, total: viewedCount.total },
      { kind: 'lines', label: LINES_TO_VIEW_TILE_LABEL, ...linesToView },
      { kind: 'count', label: 'Open threads', value: String(gitHubThreads.filter(thread => !thread.isResolved).length) },
    )
  }

  return tiles
}

// The page the GitHub shortcut opens: the review comment the keyboard went to, else the selected commit in the commits
// view or the pull request in its view.
function gitHubPageOf(
  snapshot: ExplorerSnapshot,
  pullRequest: PullRequestSummary | null,
  currentGitHubThread: GitHubReviewThread | undefined,
): GitHubPage | null {
  const firstCommentUrl = currentGitHubThread?.comments[0]?.url
  if (firstCommentUrl) {
    return { url: firstCommentUrl, description: 'comment' }
  }
  const selectedCommit = snapshot.commits.find(commit => commit.sha === snapshot.selectedCommitSha)
  if (snapshot.view === 'commits' && selectedCommit && snapshot.repositoryWebUrl) {
    return {
      url: `${snapshot.repositoryWebUrl}/commit/${selectedCommit.sha}`,
      description: `commit ${selectedCommit.shortSha}`,
    }
  }
  if (snapshot.view === 'pr' && pullRequest) {
    return { url: pullRequest.url, description: `PR #${pullRequest.number}` }
  }

  return null
}
