import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ChangedFile, DiffRow, GitHubReviewThread, KeyboardLayout, ReviewView, ViewedState } from '../types'
import {
  ANSWER_PULSE_MS,
  ASK_BUTTON_KEY_PREFIX,
  ASK_ON_LINE_KEY,
  CURSOR_LINE_FOCUS_KEY,
  BASE_REF_CANDIDATES,
  CANCEL_QUESTION_KEY,
  DICTATE_QUESTION_KEY,
  CONTEXT_RADIUS_ROWS,
  DEFAULT_DIFF_CONTEXT_LINES,
  DIFF_CONTEXT_STEP_LINES,
  DEFAULT_FILE_LIST_WIDTH,
  DISMISS_THREAD_KEY_PREFIX,
  DIVIDER_KEY,
  FILE_FILTER_KEY,
  WATCH_FIELD_KEY,
  EMOJI_CACHE_DURATION_MS,
  EMOJI_STORE_KEY,
  BROWSER_OPENERS,
  FILE_BUTTON_KEY_PREFIX,
  FILE_LIST_COLLAPSED_STORE_KEY,
  FILE_LIST_WIDTH_STORE_KEY,
  SPLIT_VIEW_STORE_KEY,
  COMMIT_PANEL_MAX_LINES,
  GH_TIMEOUT_MS,
  GIT_PUSH_TIMEOUT_MS,
  GIT_TIMEOUT_MS,
  PUSH_CONFIRM_DELAY_MS,
  PUSHED_NOTICE_MS,
  LINE_NUMBER_BUTTON_KEY_PREFIX,
  MAX_SAVED_THREADS_PER_BRANCH,
  MIN_PANE_COLUMNS,
  PANE_ID,
  PANE_SHARE_OF_TERMINAL,
  PANE_TITLE,
  PERSON_PROMPT_ORIGINS,
  PULL_REQUEST_OVERVIEW_KEY,
  QUESTION_FOCUS_RETRY_MS,
  VIEWED_FILE_HIDE_DELAY_MS,
  QUESTION_INPUT_KEY_PREFIX,
  REPLY_INPUT_KEY_PREFIX,
  THREADS_STORE_KEY_PREFIX,
  VIEWED_COMMITS_STORE_KEY_PREFIX,
  VIEW_ORDER,
  WHOLE_FILE_CONTEXT_LINES,
  WHEEL_TICK_ROWS,
} from './constants'
import {
  changedNewLinesOf,
  diffRangeArguments,
  directoryOf,
  openingViewOf,
  groupFilesByDirectory,
  LOG_FORMAT,
  commitsOfGraph,
  parseCommitGraph,
  repositoryWebUrlOf,
  parseNumstat,
  parseUnifiedDiff,
  parseUntrackedFiles,
} from './git-parsing'
import {
  addressRequestOf,
  dismissChangedFiles,
  gitHubThreadNavigationEntries,
  isGitHubThreadOnRow,
  MARK_FILE_AS_VIEWED_MUTATION,
  parsePullRequest,
  parseReviewThreadsPage,
  parseRenamedPaths,
  parseViewedStatesPage,
  pullRequestRenamesArguments,
  PULL_REQUEST_VIEW_FIELDS,
  RESOLVE_REVIEW_THREAD_MUTATION,
  REVIEW_THREADS_QUERY,
  UNRESOLVE_REVIEW_THREAD_MUTATION,
  UNMARK_FILE_AS_VIEWED_MUTATION,
  VIEWED_STATES_QUERY,
  withPreviousPathsOfRenames,
} from './github-review'
import { cursorAtHunk, cursorStopsOf, firstChangeStop, movedCursor, offsetShowingCursor, stopOnNewLines } from './cursor'
import { fileWithMatchesFrom, matchCountByPathOf, matchStopFrom, rowsByPathOfViewDiff, watchedTermOf } from './watch'
import { viewedPathsToHide, visibleFilesOf } from './file-filter'
import { KEYBOARD_LAYOUT_SOURCES, keyboardLayoutOf } from './keyboard'
import { keymapOf } from './keymap'
import { buildFileLines, clampFileListWidth, clampOffset, scrolledByLines } from './layout'
import { helpContentLineCount, helpVisibleLineCount } from './view/help'
import { parseEmojiCharacters, splitMarkdownBlocks } from './markdown'
import {
  answerWithText,
  isLastExchangeDone,
  newThread,
  overviewAnchorKeyOf,
  overviewQuestionTarget,
  openThreadsByPath,
  parseAnchorKey,
  queuedExchange,
  replyContextOf,
  restoredThreads,
  rowQuestionTarget,
  threadsInReadingOrder,
  withLastExchange,
} from './questions'
import { anchorKeyOf } from './questions'
import type { QuestionTarget } from './questions'
import { pairRowsSideBySide, splitIndexOfRow } from './split-rows'
import { isVueFile, withVueLanguages } from './syntax-language'
import { buildPaneModel } from './view/model'
import type { ExplorerSnapshot } from './view/model'
import { renderNarrowPane, renderPane } from './view/pane'
import { themeOf } from './view/theme'
import type { ExplorerActions, ViewElements } from './view/types'

// --- Session state ----------------------------------------------------------------------------------------------
// The scan that validates a hooks module reads an atom only in the file that declares it: they all live here.

// What the explorer shows.
const viewAtom = atom({ plugin: 'diff-review', key: 'view' } as const, 'uncommitted')
const repositoryRootAtom = atom({ plugin: 'diff-review', key: 'repositoryRoot' } as const, null)
const repositoryWebUrlAtom = atom({ plugin: 'diff-review', key: 'repositoryWebUrl' } as const, null)
const branchAtom = atom({ plugin: 'diff-review', key: 'branch' } as const, null)
const baseRefAtom = atom({ plugin: 'diff-review', key: 'baseRef' } as const, null)
const baseBranchNameAtom = atom({ plugin: 'diff-review', key: 'baseBranchName' } as const, null)
const uncommittedFileCountAtom = atom({ plugin: 'diff-review', key: 'uncommittedFileCount' } as const, 0)
const branchCommitCountAtom = atom({ plugin: 'diff-review', key: 'branchCommitCount' } as const, 0)
const unpushedCommitShasAtom = atom({ plugin: 'diff-review', key: 'unpushedCommitShas' } as const, [])
const pushStateAtom = atom({ plugin: 'diff-review', key: 'pushState' } as const, 'idle')
const commitListOffsetAtom = atom({ plugin: 'diff-review', key: 'commitListOffset' } as const, null)
const errorNoticesAtom = atom({ plugin: 'diff-review', key: 'errorNotices' } as const, [])
const helpScrolledLinesAtom = atom({ plugin: 'diff-review', key: 'helpScrolledLines' } as const, 0)
const followedThreadIdAtom = atom({ plugin: 'diff-review', key: 'followedThreadId' } as const, null)
const commitsAtom = atom({ plugin: 'diff-review', key: 'commits' } as const, [])
const commitGraphAtom = atom({ plugin: 'diff-review', key: 'commitGraph' } as const, [])
const gitHubReviewThreadsAtom = atom({ plugin: 'diff-review', key: 'gitHubReviewThreads' } as const, [])
const expandedGitHubThreadIdsAtom = atom({ plugin: 'diff-review', key: 'expandedGitHubThreadIds' } as const, [])
const selectedCommitShaAtom = atom({ plugin: 'diff-review', key: 'selectedCommitSha' } as const, null)
const filesAtom = atom({ plugin: 'diff-review', key: 'files' } as const, [])
const selectedFilePathAtom = atom({ plugin: 'diff-review', key: 'selectedFilePath' } as const, null)
const isOverviewShownAtom = atom({ plugin: 'diff-review', key: 'isOverviewShown' } as const, true)
const diffRowsAtom = atom({ plugin: 'diff-review', key: 'diffRows' } as const, [])
const loadErrorAtom = atom({ plugin: 'diff-review', key: 'loadError' } as const, null)
const isLoadingAtom = atom({ plugin: 'diff-review', key: 'isLoading' } as const, false)

// The pull request of the branch, and GitHub's viewed box per file.
const pullRequestAtom = atom({ plugin: 'diff-review', key: 'pullRequest' } as const, null)
const viewedStateByPathAtom = atom({ plugin: 'diff-review', key: 'viewedStateByPath' } as const, {})
const pushDismissedPathsAtom = atom({ plugin: 'diff-review', key: 'pushDismissedPaths' } as const, [])
const renamedPathByPreviousPathAtom = atom({ plugin: 'diff-review', key: 'renamedPathByPreviousPath' } as const, {})

// Layout and scrolling.
const requestedPaneColumnsAtom = atom({ plugin: 'diff-review', key: 'requestedPaneColumns' } as const, 0)
const fileListWidthAtom = atom({ plugin: 'diff-review', key: 'fileListWidth' } as const, DEFAULT_FILE_LIST_WIDTH)
const fileListOffsetAtom = atom({ plugin: 'diff-review', key: 'fileListOffset' } as const, 0)
const diffOffsetAtom = atom({ plugin: 'diff-review', key: 'diffOffset' } as const, 0)
const diffSkippedLinesAtom = atom({ plugin: 'diff-review', key: 'diffSkippedLines' } as const, null)

// Keyboard.
const keyboardLayoutAtom = atom({ plugin: 'diff-review', key: 'keyboardLayout' } as const, 'unknown')
const focusedElementKeyAtom = atom({ plugin: 'diff-review', key: 'focusedElementKey' } as const, null)

// The file list's filter, and whether lockfiles and generated files are listed.
const fileFilterAtom = atom({ plugin: 'diff-review', key: 'fileFilter' } as const, '')
const watchedTermAtom = atom({ plugin: 'diff-review', key: 'watchedTerm' } as const, '')
const isWatchFieldOpenAtom = atom({ plugin: 'diff-review', key: 'isWatchFieldOpen' } as const, false)
const watchedSourceRowsByPathAtom = atom({ plugin: 'diff-review', key: 'watchedSourceRowsByPath' } as const, {})
const watchedMatchCountByPathAtom = atom({ plugin: 'diff-review', key: 'watchedMatchCountByPath' } as const, {})
const contextLinesByPathAtom = atom({ plugin: 'diff-review', key: 'contextLinesByPath' } as const, {})
const isNoiseShownAtom = atom({ plugin: 'diff-review', key: 'isNoiseShown' } as const, false)
const isViewedHiddenAtom = atom({ plugin: 'diff-review', key: 'isViewedHidden' } as const, false)
const recentlyViewedPathsAtom = atom({ plugin: 'diff-review', key: 'recentlyViewedPaths' } as const, [])
const foldedDirectoriesAtom = atom({ plugin: 'diff-review', key: 'foldedDirectories' } as const, [])
const isFileDrawerOpenAtom = atom({ plugin: 'diff-review', key: 'isFileDrawerOpen' } as const, false)
const isFileListCollapsedAtom = atom({ plugin: 'diff-review', key: 'isFileListCollapsed' } as const, false)
const cursorRowIndexAtom = atom({ plugin: 'diff-review', key: 'cursorRowIndex' } as const, null)
const claudeCodeThemeAtom = atom({ plugin: 'diff-review', key: 'claudeCodeTheme' } as const, null)
const isHelpShownAtom = atom({ plugin: 'diff-review', key: 'isHelpShown' } as const, false)
const answerPulseFrameAtom = atom({ plugin: 'diff-review', key: 'answerPulseFrame' } as const, 0)
const isSplitViewPreferredAtom = atom({ plugin: 'diff-review', key: 'isSplitViewPreferred' } as const, false)

// New files marked for git add.
const markedPathsAtom = atom({ plugin: 'diff-review', key: 'markedPaths' } as const, [])

// Questions and their threads.
const threadsAtom = atom({ plugin: 'diff-review', key: 'threads' } as const, [])
const anchorWithOpenInputAtom = atom({ plugin: 'diff-review', key: 'anchorWithOpenInput' } as const, null)
const questionFieldNumberAtom = atom({ plugin: 'diff-review', key: 'questionFieldNumber' } as const, 0)
const questionDraftAtom = atom({ plugin: 'diff-review', key: 'questionDraft' } as const, '')
const hasQuestionHadKeyboardAtom = atom({ plugin: 'diff-review', key: 'hasQuestionHadKeyboard' } as const, false)
const armedQuestionAtom = atom({ plugin: 'diff-review', key: 'armedQuestion' } as const, null)
const threadIdAwaitingTurnAtom = atom({ plugin: 'diff-review', key: 'threadIdAwaitingTurn' } as const, null)
const currentThreadIdAtom = atom({ plugin: 'diff-review', key: 'currentThreadId' } as const, null)
const threadIdByTurnIdAtom = atom({ plugin: 'diff-review', key: 'threadIdByTurnId' } as const, {})

type CommandResult = { isSuccess: boolean; output: string }

// The geometry of the last drawing, kept so a wheel tick can tell the file list from the diff, clamp the scrolling and
// resize the file list from where a drag of the divider started.
const lastDrawnLayout = {
  isTwoColumns: true,
  isFileDrawerOpen: false,
  panelsTop: 0,
  bodyColumns: 0,
  fileListWidth: 0,
  fileListBoxHeight: 0,
  visibleFileLines: 1,
  fileLineCount: 0,
  fileLineIndexByPath: {} as Record<string, number>,
  visibleDiffRows: 1,
  scrolledRowCount: 0,
  isOverviewShown: false,
  isSplitView: false,
  cursorRowIndex: null as number | null,
  isScrollingPastEnd: false,
  commitPanelRows: 0,
  panelsHeight: 0,
  firstShownCommitLineIndex: 0,
  commitLineCount: 0,
  diffRowHeights: [] as number[],
  fileListWidthAtDragStart: 0,
}

// Stays on top of the pane until dismissed: a failure must not slip by while the eyes are on the code.
async function reportError($: EngineInterface, text: string): Promise<void> {
  const noticeId = `${await $.clock.now()}-${text.length}`
  await update($, errorNoticesAtom, notices => [...notices.filter(notice => notice.text !== text), { id: noticeId, text }])
}

// --- Commands on the host -------------------------------------------------------------------------------------------

async function runGit($: EngineInterface, gitArguments: string[], timeoutMs = GIT_TIMEOUT_MS): Promise<CommandResult> {
  const repositoryRoot = await read($, repositoryRootAtom)
  try {
    const { exitCode, stdout, stderr } = await $.process.run(
      ['git', ...(repositoryRoot ? ['-C', repositoryRoot] : []), ...gitArguments],
      { timeoutMs },
    )

    return { isSuccess: exitCode === 0, output: exitCode === 0 ? stdout : stderr }
  } catch (error) {
    return { isSuccess: false, output: String(error) }
  }
}

// xdg-open on Linux, open on macOS: whichever the host has.
async function openInBrowser($: EngineInterface, url: string): Promise<CommandResult> {
  let lastResult: CommandResult = { isSuccess: false, output: 'no browser opener found' }
  for (const opener of BROWSER_OPENERS) {
    try {
      const { exitCode, stdout, stderr } = await $.process.run([opener, url], { timeoutMs: GIT_TIMEOUT_MS })
      lastResult = { isSuccess: exitCode === 0, output: exitCode === 0 ? stdout : stderr }
    } catch (error) {
      lastResult = { isSuccess: false, output: String(error) }
    }
    if (lastResult.isSuccess) {
      break
    }
  }

  return lastResult
}

async function runGh($: EngineInterface, ghArguments: string[]): Promise<CommandResult> {
  const repositoryRoot = await read($, repositoryRootAtom)
  try {
    const { exitCode, stdout, stderr } = await $.process.run(['gh', ...ghArguments], {
      ...(repositoryRoot ? { cwd: repositoryRoot } : {}),
      timeoutMs: GH_TIMEOUT_MS,
    })

    return { isSuccess: exitCode === 0, output: exitCode === 0 ? stdout : stderr }
  } catch (error) {
    return { isSuccess: false, output: String(error) }
  }
}

function shortOutput(result: CommandResult): string {
  return result.output.trim().slice(0, 120)
}

async function detectKeyboardLayout($: EngineInterface): Promise<KeyboardLayout> {
  for (const layoutSource of KEYBOARD_LAYOUT_SOURCES) {
    try {
      const { exitCode, stdout } = await $.process.run(layoutSource.argv, { timeoutMs: 3000 })
      const keyboardLayout = exitCode === 0 ? keyboardLayoutOf(stdout, layoutSource.layoutPattern) : null
      if (keyboardLayout) {
        return keyboardLayout
      }
    } catch {
      continue
    }
  }

  return 'unknown'
}

// --- GitHub ---------------------------------------------------------------------------------------------------------

async function loadEmojiCharacters($: EngineInterface): Promise<Record<string, string>> {
  const cached = (await $.store.get(EMOJI_STORE_KEY).catch(() => undefined)) as
    | { fetchedAt: number; characters: Record<string, string> }
    | undefined
  const nowMs = await $.clock.now()
  if (cached && nowMs - cached.fetchedAt < EMOJI_CACHE_DURATION_MS) {
    return cached.characters
  }
  const emojis = await runGh($, ['api', 'emojis'])
  if (!emojis.isSuccess) {
    return cached?.characters ?? {}
  }
  const characters = parseEmojiCharacters(emojis.output)
  await $.store.set(EMOJI_STORE_KEY, { fetchedAt: nowMs, characters }).catch(() => undefined)

  return characters
}

// GitHub is asked only when the person opens the explorer, refreshes it or switches to the PR view, never on every edit.
async function loadPullRequest($: EngineInterface): Promise<void> {
  const pullRequestView = await runGh($, ['pr', 'view', '--json', PULL_REQUEST_VIEW_FIELDS])
  const pullRequest = pullRequestView.isSuccess ? parsePullRequest(pullRequestView.output, await loadEmojiCharacters($)) : null
  await update($, pullRequestAtom, () => pullRequest)
  if (pullRequest === null) {
    await update($, viewedStateByPathAtom, () => ({}))
    await update($, renamedPathByPreviousPathAtom, () => ({}))
    await update($, gitHubReviewThreadsAtom, () => [])
    return
  }
  await loadGitHubReviewThreads($, pullRequest.id)
  const viewedStateByPath: Record<string, ViewedState> = {}
  let cursor: string | null = null
  do {
    const page = await runGh($, [
      'api',
      'graphql',
      '-f',
      `query=${VIEWED_STATES_QUERY}`,
      '-F',
      `pullRequestId=${pullRequest.id}`,
      ...(cursor ? ['-f', `cursor=${cursor}`] : []),
    ])
    if (!page.isSuccess) {
      await reportError($, `Could not read the viewed state from GitHub (${shortOutput(page)})`)
      break
    }
    const parsedPage = parseViewedStatesPage(page.output)
    Object.assign(viewedStateByPath, parsedPage.viewedStateByPath)
    cursor = parsedPage.nextCursor
  } while (cursor !== null)
  const renames = await runGh($, pullRequestRenamesArguments(pullRequest.number))
  const renamedPathByPreviousPath = renames.isSuccess ? parseRenamedPaths(renames.output) : {}
  await update($, renamedPathByPreviousPathAtom, () => renamedPathByPreviousPath)
  const gitHubViewedStateByPath = withPreviousPathsOfRenames(viewedStateByPath, renamedPathByPreviousPath)
  await update($, pushDismissedPathsAtom, paths => paths.filter(path => gitHubViewedStateByPath[path] === 'VIEWED'))
  const pushDismissedPaths = await read($, pushDismissedPathsAtom)
  await update($, viewedStateByPathAtom, () => dismissChangedFiles(gitHubViewedStateByPath, pushDismissedPaths))
}

async function loadGitHubReviewThreads($: EngineInterface, pullRequestId: string): Promise<void> {
  const emojiCharacterByShortcode = await loadEmojiCharacters($)
  const threads: GitHubReviewThread[] = []
  let cursor: string | null = null
  do {
    const page = await runGh($, [
      'api',
      'graphql',
      '-f',
      `query=${REVIEW_THREADS_QUERY}`,
      '-F',
      `pullRequestId=${pullRequestId}`,
      ...(cursor ? ['-f', `cursor=${cursor}`] : []),
    ])
    if (!page.isSuccess) {
      await reportError($, `Could not read the review comments from GitHub (${shortOutput(page)})`)
      break
    }
    const parsedPage = parseReviewThreadsPage(page.output, emojiCharacterByShortcode)
    threads.push(...parsedPage.threads)
    cursor = parsedPage.nextCursor
  } while (cursor !== null)
  await update($, gitHubReviewThreadsAtom, () => threads)
}

// The thread folds or unfolds at once, as GitHub draws it; GitHub refusing puts it back as it was.
async function toggleGitHubThreadResolved($: EngineInterface, threadId: string): Promise<void> {
  const thread = (await read($, gitHubReviewThreadsAtom)).find(candidate => candidate.id === threadId)
  if (!thread) {
    return
  }
  const setResolved = async (isResolved: boolean) => {
    await update($, gitHubReviewThreadsAtom, threads =>
      threads.map(candidate => (candidate.id === threadId ? { ...candidate, isResolved } : candidate)),
    )
  }
  await setResolved(!thread.isResolved)
  await update($, expandedGitHubThreadIdsAtom, threadIds => threadIds.filter(id => id !== threadId))
  const mutation = await runGh($, [
    'api',
    'graphql',
    '-f',
    `query=${thread.isResolved ? UNRESOLVE_REVIEW_THREAD_MUTATION : RESOLVE_REVIEW_THREAD_MUTATION}`,
    '-F',
    `threadId=${threadId}`,
  ])
  if (!mutation.isSuccess) {
    await setResolved(thread.isResolved)
    await reportError($, `GitHub refused to ${thread.isResolved ? 'unresolve' : 'resolve'} the thread (${shortOutput(mutation)})`)
  }
}

async function toggleViewed($: EngineInterface, path: string): Promise<void> {
  const pullRequest = await read($, pullRequestAtom)
  const previousState = (await read($, viewedStateByPathAtom))[path]
  if (pullRequest === null || previousState === undefined) {
    return
  }
  const renamedPathByPreviousPath = await read($, renamedPathByPreviousPathAtom)
  const gitHubPath = renamedPathByPreviousPath[path] ?? path
  const pathsSharingTheBox = [
    gitHubPath,
    ...Object.keys(renamedPathByPreviousPath).filter(previousPath => renamedPathByPreviousPath[previousPath] === gitHubPath),
  ]
  const setStateOfPathsSharingTheBox = async (viewedState: ViewedState) => {
    await update($, viewedStateByPathAtom, states => ({
      ...states,
      ...Object.fromEntries(pathsSharingTheBox.map(sharingPath => [sharingPath, viewedState])),
    }))
  }
  const isMarkingViewed = previousState !== 'VIEWED'
  await update($, pushDismissedPathsAtom, paths => paths.filter(dismissedPath => !pathsSharingTheBox.includes(dismissedPath)))
  if (isMarkingViewed && (await read($, isViewedHiddenAtom))) {
    await update($, recentlyViewedPathsAtom, paths => [...paths, ...pathsSharingTheBox])
    await $.clock.after(VIEWED_FILE_HIDE_DELAY_MS, () =>
      update($, recentlyViewedPathsAtom, paths => paths.filter(recentPath => !pathsSharingTheBox.includes(recentPath))),
    )
  }
  await setStateOfPathsSharingTheBox(isMarkingViewed ? 'VIEWED' : 'UNVIEWED')
  const mutation = await runGh($, [
    'api',
    'graphql',
    '-f',
    `query=${isMarkingViewed ? MARK_FILE_AS_VIEWED_MUTATION : UNMARK_FILE_AS_VIEWED_MUTATION}`,
    '-F',
    `pullRequestId=${pullRequest.id}`,
    '-f',
    `path=${gitHubPath}`,
  ])
  if (!mutation.isSuccess) {
    await setStateOfPathsSharingTheBox(previousState)
    await reportError($, `GitHub refused to change the viewed state of ${path}`)
    return
  }
  await rememberViewedCommit($, pathsSharingTheBox, isMarkingViewed)
}

async function viewedCommitsKey($: EngineInterface): Promise<string | null> {
  const repositoryRoot = await read($, repositoryRootAtom)
  const branch = await read($, branchAtom)

  return repositoryRoot && branch ? `${VIEWED_COMMITS_STORE_KEY_PREFIX}|${repositoryRoot}|${branch}` : null
}

async function savedViewedCommitByPath($: EngineInterface, key: string): Promise<Record<string, string>> {
  const saved = await $.store.get(key).catch(() => undefined)

  return saved !== null && typeof saved === 'object' ? { ...(saved as Record<string, string>) } : {}
}

async function rememberViewedCommit($: EngineInterface, paths: string[], isViewed: boolean): Promise<void> {
  const key = await viewedCommitsKey($)
  const head = isViewed ? await runGit($, ['rev-parse', 'HEAD']) : null
  if (key === null || (head !== null && !head.isSuccess)) {
    return
  }
  const viewedCommitByPath = await savedViewedCommitByPath($, key)
  for (const path of paths) {
    if (head === null) {
      delete viewedCommitByPath[path]
    } else {
      viewedCommitByPath[path] = head.output.trim()
    }
  }
  await $.store.set(key, viewedCommitByPath).catch(() => undefined)
}

// A file changed since it was ticked in the pane opens on what changed since; ticked on GitHub, the pane cannot tell.
async function placeCursorOnChangesSinceViewed($: EngineInterface, path: string): Promise<boolean> {
  const key = await viewedCommitsKey($)
  const isChangedSinceViewed = (await read($, viewAtom)) === 'pr' && (await read($, viewedStateByPathAtom))[path] === 'DISMISSED'
  const viewedCommit = isChangedSinceViewed && key !== null ? (await savedViewedCommitByPath($, key))[path] : undefined
  if (viewedCommit === undefined) {
    return false
  }
  const changesSinceViewed = await runGit($, ['diff', '--no-color', '--no-renames', '-U0', viewedCommit, 'HEAD', '--', path])
  if (!changesSinceViewed.isSuccess) {
    return false
  }
  const diffRows = await read($, diffRowsAtom)
  const splitRows = lastDrawnLayout.isSplitView ? pairRowsSideBySide(diffRows) : null
  const target = stopOnNewLines(diffRows, cursorStopsOf(diffRows, splitRows), changedNewLinesOf(changesSinceViewed.output))
  if (target === null) {
    return false
  }
  await placeCursorOnRow($, target)

  return true
}

// Reviewing a PR file by file: once one is viewed, the next one still to view comes up, in the order of the list.
async function markViewedAndNext($: EngineInterface): Promise<void> {
  const path = await read($, selectedFilePathAtom)
  const viewedStateByPath = await read($, viewedStateByPathAtom)
  if (path === null || viewedStateByPath[path] === undefined) {
    return
  }
  const wasViewed = viewedStateByPath[path] === 'VIEWED'
  await toggleViewed($, path)
  if (wasViewed) {
    return
  }
  const orderedPaths = groupFilesByDirectory(await shownFilesOf($, await read($, filesAtom))).flatMap(group =>
    group.files.map(file => file.path),
  )
  const currentIndex = orderedPaths.indexOf(path)
  const nextPath = [...orderedPaths.slice(currentIndex + 1), ...orderedPaths.slice(0, currentIndex)].find(
    candidate => viewedStateByPath[candidate] !== undefined && viewedStateByPath[candidate] !== 'VIEWED',
  )
  if (nextPath) {
    await selectFile($, nextPath)
  }
}

// --- Loading what a view shows --------------------------------------------------------------------------------------

// A PR may target another branch than the repository's default one (a release branch such as 2026-09): its own
// target comes first, or the PR view would list the commits of that branch too.
async function findBaseRef($: EngineInterface): Promise<{ sha: string; branchName: string } | null> {
  const pullRequestBase = (await read($, pullRequestAtom))?.baseRefName
  const originHead = await runGit($, ['rev-parse', '--abbrev-ref', 'origin/HEAD'])
  const candidates = [
    ...(pullRequestBase ? [`origin/${pullRequestBase}`, pullRequestBase] : []),
    ...(originHead.isSuccess ? [originHead.output.trim()] : []),
    ...BASE_REF_CANDIDATES,
  ]
  for (const candidate of candidates) {
    const mergeBase = await runGit($, ['merge-base', 'HEAD', candidate])
    if (mergeBase.isSuccess) {
      return { sha: mergeBase.output.trim(), branchName: candidate.replace(/^origin\//, '') }
    }
  }

  return null
}

async function readWorkingTreeFile($: EngineInterface, path: string): Promise<string> {
  const repositoryRoot = await read($, repositoryRootAtom)

  return $.fs.read(repositoryRoot ? `${repositoryRoot}/${path}` : path)
}

// A file missing at that revision, created or deleted by the change, reads as empty.
async function fileContentAt($: EngineInterface, revision: string | null, path: string): Promise<string> {
  if (revision === null) {
    try {
      return await readWorkingTreeFile($, path)
    } catch {
      return ''
    }
  }
  const show = await runGit($, ['show', `${revision}:${path}`])

  return show.isSuccess ? show.output : ''
}

async function readUntrackedFileRows($: EngineInterface, path: string): Promise<DiffRow[]> {
  let content = ''
  try {
    content = await readWorkingTreeFile($, path)
  } catch (error) {
    await update($, loadErrorAtom, () => `Cannot read ${path}: ${String(error)}`)
  }

  return [
    { kind: 'hunk', oldNumber: null, newNumber: null, text: 'new file, untracked' },
    ...content
      .replace(/\n$/, '')
      .split('\n')
      .map((text, index) => ({ kind: 'added' as const, oldNumber: null, newNumber: index + 1, text })),
  ]
}

async function loadSelectedFileDiff($: EngineInterface): Promise<void> {
  const path = await read($, selectedFilePathAtom)
  const file = (await read($, filesAtom)).find(changedFile => changedFile.path === path)
  if (!path || !file) {
    await update($, diffRowsAtom, () => [])
    return
  }
  if (file.isUntracked) {
    const rows = await readUntrackedFileRows($, path)
    const content = rows.flatMap(row => (row.kind === 'added' ? [row.text] : [])).join('\n')
    await update($, diffRowsAtom, () => (isVueFile(path) ? withVueLanguages(rows, '', content) : rows))
    return
  }
  const range = diffRangeArguments(await read($, viewAtom), await read($, baseRefAtom), await read($, selectedCommitShaAtom))
  if (!range) {
    await update($, diffRowsAtom, () => [])
    return
  }
  const contextLines = (await read($, contextLinesByPathAtom))[path] ?? DEFAULT_DIFF_CONTEXT_LINES
  const diff = await runGit($, ['diff', '--no-color', '--no-renames', `-U${contextLines}`, ...range, '--', path])
  const rows = diff.isSuccess ? parseUnifiedDiff(diff.output) : []
  if (isVueFile(path) && rows.length > 0) {
    const [oldRevision = null, newRevision = null] = range
    const oldContent = await fileContentAt($, oldRevision, path)
    const newContent = await fileContentAt($, newRevision, path)
    await update($, diffRowsAtom, () => withVueLanguages(rows, oldContent, newContent))
  } else {
    await update($, diffRowsAtom, () => rows)
  }
  if (!diff.isSuccess) {
    await update($, loadErrorAtom, () => diff.output.trim())
  }
}

async function loadBranchCommits($: EngineInterface, baseRef: string | null): Promise<void> {
  const log = baseRef ? await runGit($, ['log', '--graph', '--boundary', `--format=${LOG_FORMAT}`, `${baseRef}..HEAD`]) : null
  const commitGraph = log?.isSuccess ? parseCommitGraph(log.output) : []
  const commits = commitsOfGraph(commitGraph)
  await update($, commitGraphAtom, () => commitGraph)
  await update($, commitsAtom, () => commits)
  const selectedCommitSha = await read($, selectedCommitShaAtom)
  if (!commits.some(commit => commit.sha === selectedCommitSha)) {
    await update($, selectedCommitShaAtom, () => commits[0]?.sha ?? null)
  }
}

async function loadBranchState($: EngineInterface, branch: string | null, baseRef: string | null): Promise<void> {
  const status = await runGit($, ['status', '--porcelain', '--untracked-files=all'])
  await update($, uncommittedFileCountAtom, () => (status.isSuccess ? status.output.split('\n').filter(line => line !== '').length : 0))
  const branchCommits = baseRef ? await runGit($, ['rev-list', '--count', `${baseRef}..HEAD`]) : null
  await update($, branchCommitCountAtom, () => (branchCommits?.isSuccess ? Number(branchCommits.output.trim()) : 0))
  const remoteCandidates = ['@{upstream}', ...(branch ? [`origin/${branch}`] : [])]
  let unpushedCommitShas: string[] = []
  for (const remoteRef of [...remoteCandidates, baseRef]) {
    if (remoteRef === null) {
      continue
    }
    const revList = await runGit($, ['rev-list', `${remoteRef}..HEAD`])
    if (revList.isSuccess) {
      unpushedCommitShas = revList.output.split('\n').filter(sha => sha !== '')
      break
    }
  }
  await update($, unpushedCommitShasAtom, () => unpushedCommitShas)
}

async function loadChangedFiles($: EngineInterface, view: ReviewView, baseRef: string | null): Promise<ChangedFile[]> {
  const range = diffRangeArguments(view, baseRef, await read($, selectedCommitShaAtom))
  let files: ChangedFile[] = []
  if (range) {
    const numstat = await runGit($, ['diff', '--numstat', '--summary', '--no-renames', ...range])
    files = numstat.isSuccess ? parseNumstat(numstat.output) : []
    if (!numstat.isSuccess) {
      await update($, loadErrorAtom, () => numstat.output.trim())
    }
  } else if (view === 'pr') {
    await update($, loadErrorAtom, () => 'Base branch not found (origin/HEAD, main, master).')
  }
  if (view === 'uncommitted') {
    const untracked = await runGit($, ['ls-files', '--others', '--exclude-standard'])
    files = [...files, ...(untracked.isSuccess ? parseUntrackedFiles(untracked.output) : [])]
  }

  return files
}

async function shownFilesOf($: EngineInterface, files: ChangedFile[]): Promise<ChangedFile[]> {
  const isViewedHidden = (await read($, viewAtom)) === 'pr' && (await read($, isViewedHiddenAtom))
  const hiddenPaths = isViewedHidden
    ? viewedPathsToHide(await read($, viewedStateByPathAtom), await read($, recentlyViewedPathsAtom))
    : undefined

  return visibleFilesOf(files, { filter: await read($, fileFilterAtom), isNoiseShown: await read($, isNoiseShownAtom), hiddenPaths }).files
}

async function widenContext($: EngineInterface, path: string, contextLines: (current: number) => number): Promise<void> {
  await update($, contextLinesByPathAtom, contextLinesByPath => ({
    ...contextLinesByPath,
    [path]: contextLines(contextLinesByPath[path] ?? DEFAULT_DIFF_CONTEXT_LINES),
  }))
  const cursorRow = (await read($, diffRowsAtom))[(await read($, cursorRowIndexAtom)) ?? -1]
  await loadSelectedFileDiff($)
  // More context shifts every row: the cursor follows its line.
  const diffRows = await read($, diffRowsAtom)
  const cursorRowIndex = cursorRow
    ? diffRows.findIndex(row => row.kind === cursorRow.kind && row.oldNumber === cursorRow.oldNumber && row.newNumber === cursorRow.newNumber)
    : -1
  await update($, cursorRowIndexAtom, () => (cursorRowIndex === -1 ? null : cursorRowIndex))
  await focusFirstChange($)
}

async function loadView($: EngineInterface): Promise<void> {
  await update($, loadErrorAtom, () => null)
  const topLevel = await runGit($, ['rev-parse', '--show-toplevel'])
  if (!topLevel.isSuccess) {
    await update($, loadErrorAtom, () => 'Not a git repository.')
    return
  }
  await update($, repositoryRootAtom, () => topLevel.output.trim())
  const remote = await runGit($, ['remote', 'get-url', 'origin'])
  await update($, repositoryWebUrlAtom, () => (remote.isSuccess ? repositoryWebUrlOf(remote.output) : null))
  const branch = await runGit($, ['rev-parse', '--abbrev-ref', 'HEAD'])
  await update($, branchAtom, () => (branch.isSuccess ? branch.output.trim() : null))
  const view = await read($, viewAtom)
  const base = await findBaseRef($)
  const baseRef = base?.sha ?? null
  await update($, baseRefAtom, () => baseRef)
  await update($, baseBranchNameAtom, () => base?.branchName ?? null)
  if (view === 'commits') {
    await loadBranchCommits($, baseRef)
  }
  await loadBranchState($, branch.isSuccess ? branch.output.trim() : null, baseRef)
  const files = await loadChangedFiles($, view, baseRef)
  await update($, filesAtom, () => files)
  const selectedFilePath = await read($, selectedFilePathAtom)
  const shownFiles = await shownFilesOf($, files)
  if (!shownFiles.some(file => file.path === selectedFilePath)) {
    await update($, selectedFilePathAtom, () => groupFilesByDirectory(shownFiles)[0]?.files[0]?.path ?? null)
  }
  await loadSelectedFileDiff($)
  await loadWatchedSource($)
}

// The first press arms, the second pushes; the push runs on its own so the pane shows it under way and ignores presses.
async function pushBranch($: EngineInterface): Promise<void> {
  const pushState = await read($, pushStateAtom)
  switch (pushState) {
    case 'pushing':
    case 'pushed':
      return
    case 'idle':
    case 'rejected':
      await armPush($, pushState === 'idle' ? 'armed' : 'forceArmed', pushState)
      return
    case 'armed':
    case 'forceArmed':
      break
  }
  const branch = await read($, branchAtom)
  if (branch === null || branch === 'HEAD' || ['main', 'master'].includes(branch)) {
    await update($, pushStateAtom, () => 'idle')
    await reportError($, `No push from ${branch ?? 'a detached HEAD'}`)
    return
  }
  await update($, pushStateAtom, () => 'pushing')
  void runPush($, branch, pushState === 'forceArmed').catch(async error => {
    await update($, pushStateAtom, () => 'idle')
    await reportError($, `Push failed: ${String(error)}`)
  })
}

async function armPush($: EngineInterface, armedState: 'armed' | 'forceArmed', stateToComeBackTo: 'idle' | 'rejected'): Promise<void> {
  await update($, pushStateAtom, () => armedState)
  await $.clock.after(PUSH_CONFIRM_DELAY_MS, () => update($, pushStateAtom, state => (state === armedState ? stateToComeBackTo : state)))
}

// A plain push never overwrites the remote. A force push only replaces what this clone last fetched of it
// (--force-with-lease) and only once that is part of the local history (--force-if-includes): commits pushed
// meanwhile from elsewhere make it fail instead of vanishing.
async function runPush($: EngineInterface, branch: string, isForced: boolean): Promise<void> {
  const hasUpstream = (await runGit($, ['rev-parse', '--abbrev-ref', '@{upstream}'])).isSuccess
  const pushArguments = isForced
    ? ['push', '--force-with-lease', '--force-if-includes']
    : hasUpstream
      ? ['push']
      : ['push', '--set-upstream', 'origin', branch]
  const pushedChanges = hasUpstream ? await runGit($, ['diff', '--name-only', '--no-renames', '@{upstream}', 'HEAD']) : null
  const pushedPaths = pushedChanges?.isSuccess ? pushedChanges.output.split('\n').filter(path => path !== '') : []
  const push = await runGit($, pushArguments, GIT_PUSH_TIMEOUT_MS)
  if (push.isSuccess) {
    await update($, pushDismissedPathsAtom, paths => [...new Set([...paths, ...pushedPaths])])
    await update($, pushStateAtom, () => 'pushed')
    await $.clock.after(PUSHED_NOTICE_MS, () => update($, pushStateAtom, state => (state === 'pushed' ? 'idle' : state)))
  } else if (!isForced && /\[rejected\]|\[remote rejected\]|non-fast-forward|fetch first/.test(push.output)) {
    await update($, pushStateAtom, () => 'rejected')
    await reportError($, 'Push rejected: the remote branch has commits the local one lacks, after a rebase for instance.')
  } else {
    await update($, pushStateAtom, () => 'idle')
    await reportError($, `${isForced ? 'Force push' : 'Push'} failed: ${push.output.trim().split('\n').at(-1) ?? ''}`)
  }
  await refreshExplorer($)
}

async function refreshExplorer($: EngineInterface): Promise<void> {
  await update($, isLoadingAtom, () => true)
  await loadPullRequest($)
  await loadView($)
  await restoreSavedThreads($)
  await update($, isLoadingAtom, () => false)
}

// --- Navigation -----------------------------------------------------------------------------------------------------

async function switchView($: EngineInterface, view: ReviewView): Promise<void> {
  await update($, followedThreadIdAtom, () => null)
  await update($, viewAtom, () => view)
  await update($, markedPathsAtom, () => [])
  await update($, fileListOffsetAtom, () => 0)
  await update($, diffOffsetAtom, () => 0)
  await update($, isOverviewShownAtom, () => true)
  await closeQuestion($)
  await loadView($)
  if (view === 'pr') {
    await loadPullRequest($)
  }
}

async function moveView($: EngineInterface, offset: number): Promise<void> {
  const currentView = await read($, viewAtom)
  const currentIndex = VIEW_ORDER.indexOf(currentView)
  const targetView = VIEW_ORDER[Math.min(VIEW_ORDER.length - 1, Math.max(0, currentIndex + offset))]
  if (targetView !== undefined && targetView !== currentView) {
    await switchView($, targetView)
  }
}

async function selectCommit($: EngineInterface, commitSha: string): Promise<void> {
  await update($, selectedCommitShaAtom, () => commitSha)
  // A commit picked among the lines the wheel brought keeps them in place; one out of sight brings the list back to it.
  const lineIndex = (await read($, commitGraphAtom)).findIndex(line => !line.isBoundary && line.commit?.sha === commitSha)
  const firstShownLineIndex = lastDrawnLayout.firstShownCommitLineIndex
  if (lineIndex < firstShownLineIndex || lineIndex >= firstShownLineIndex + COMMIT_PANEL_MAX_LINES) {
    await update($, commitListOffsetAtom, () => null)
  }
  await loadView($)
}

async function showOverview($: EngineInterface): Promise<void> {
  await update($, isOverviewShownAtom, () => true)
  await update($, diffOffsetAtom, () => 0)
  await update($, fileListOffsetAtom, () => 0)
  await closeQuestion($)
}

// The keyboard goes to the new file's first change, unless the caller puts it somewhere else on the same drawing: two
// requests for one drawing leave the later one unanswered.
async function selectFile($: EngineInterface, path: string, focus: 'first-change' | 'caller' = 'first-change'): Promise<void> {
  await update($, followedThreadIdAtom, () => null)
  await update($, isOverviewShownAtom, () => false)
  await update($, selectedFilePathAtom, () => path)
  // A file reached from a thread or from the next one to view opens its folded directory.
  await update($, foldedDirectoriesAtom, folded => folded.filter(directory => directory !== directoryOf(path)))
  await update($, diffOffsetAtom, () => 0)
  await update($, cursorRowIndexAtom, () => null)
  await scrollFileListTo($, path)
  await closeQuestion($)
  await loadSelectedFileDiff($)
  if (focus === 'first-change' && !(await placeCursorOnChangesSinceViewed($, path))) {
    await focusFirstChange($)
  }
}

// With the keyboard on the cursor's hidden button, Enter asks about the cursor's line: a new file puts the cursor on
// its first change.
// The PR overview has no line: the keyboard then goes to the entry selected in the file list.
async function focusFirstChange($: EngineInterface): Promise<void> {
  const diffRows = await read($, diffRowsAtom)
  const splitRows = lastDrawnLayout.isSplitView ? pairRowsSideBySide(diffRows) : null
  // The overview only draws in the PR view of a branch that has a PR, whatever the flag says elsewhere.
  const isOverviewDrawn =
    (await read($, isOverviewShownAtom)) && (await read($, viewAtom)) === 'pr' && (await read($, pullRequestAtom)) !== null
  const rowIndex = isOverviewDrawn ? null : firstChangeStop(diffRows, cursorStopsOf(diffRows, splitRows))
  const selectedFilePath = await read($, selectedFilePathAtom)
  const key =
    rowIndex !== null
      ? CURSOR_LINE_FOCUS_KEY
      : isOverviewDrawn || selectedFilePath === null
        ? PULL_REQUEST_OVERVIEW_KEY
        : `${FILE_BUTTON_KEY_PREFIX}${selectedFilePath}`
  focusAfterNextDrawing($, key)
}

async function scrollDiffByLines(
  $: EngineInterface,
  path: string,
  linesToMove: number,
  rowHeights: readonly number[],
  lastTopLine: number,
): Promise<void> {
  const rowIndex = await read($, diffOffsetAtom)
  const saved = await read($, diffSkippedLinesAtom)
  const skippedLines = saved !== null && saved.path === path && saved.rowIndex === rowIndex ? saved.lines : 0
  const position = scrolledByLines({ rowIndex, skippedLines }, linesToMove, rowHeights, lastTopLine)
  await update($, diffOffsetAtom, () => position.rowIndex)
  await update($, diffSkippedLinesAtom, () => ({ path, rowIndex: position.rowIndex, lines: position.skippedLines }))
}

async function scrollFileListTo($: EngineInterface, path: string): Promise<void> {
  // The list as it is about to be drawn, the directory of the file maybe just unfolded.
  const hasOverview = (await read($, viewAtom)) === 'pr' && (await read($, pullRequestAtom)) !== null
  const fileLines = buildFileLines(await shownFilesOf($, await read($, filesAtom)), hasOverview, await read($, foldedDirectoriesAtom))
  const fileLineIndex = fileLines.findIndex(fileLine => fileLine.kind === 'file' && fileLine.file.path === path)
  if (fileLineIndex === -1) {
    return
  }
  const visibleFileLines = lastDrawnLayout.visibleFileLines
  await update($, fileListOffsetAtom, offset => {
    if (fileLineIndex < offset) {
      return fileLineIndex
    }
    return fileLineIndex >= offset + visibleFileLines ? fileLineIndex - visibleFileLines + 1 : offset
  })
}

async function toggleDirectoryFold($: EngineInterface, directory: string): Promise<void> {
  await update($, foldedDirectoriesAtom, folded =>
    folded.includes(directory) ? folded.filter(candidate => candidate !== directory) : [...folded, directory],
  )
}

// In the PR view the overview stands first, before the files.
async function moveFileSelection($: EngineInterface, offset: number): Promise<void> {
  const overviewEntry = '\u0000overview'
  const hasOverview = (await read($, viewAtom)) === 'pr' && (await read($, pullRequestAtom)) !== null
  const shownFiles = await shownFilesOf($, await read($, filesAtom))
  const filePaths = groupFilesByDirectory(shownFiles).flatMap(group => group.files.map(file => file.path))
  const orderedEntries = hasOverview ? [overviewEntry, ...filePaths] : filePaths
  const currentEntry =
    hasOverview && (await read($, isOverviewShownAtom)) ? overviewEntry : ((await read($, selectedFilePathAtom)) ?? '')
  // The files of folded directories are stepped over; the selected one may sit in a directory folded since.
  const foldedDirectories = await read($, foldedDirectoriesAtom)
  const isListed = (entry: string) => entry === overviewEntry || !foldedDirectories.includes(directoryOf(entry))
  const currentIndex = orderedEntries.indexOf(currentEntry)
  const candidates = offset > 0 ? orderedEntries.slice(currentIndex + 1) : orderedEntries.slice(0, Math.max(0, currentIndex)).reverse()
  const listedCandidates = candidates.filter(isListed)
  const targetEntry = currentIndex === -1 ? orderedEntries.find(isListed) : (listedCandidates[Math.abs(offset) - 1] ?? listedCandidates.at(-1))
  if (targetEntry === overviewEntry) {
    await showOverview($)
  } else if (targetEntry !== undefined) {
    await selectFile($, targetEntry)
  }
}

// --- Staging new files ----------------------------------------------------------------------------------------------

async function untrackedPathsOf($: EngineInterface): Promise<string[]> {
  return (await read($, filesAtom)).filter(file => file.isUntracked).map(file => file.path)
}

async function toggleMarked($: EngineInterface, path: string): Promise<void> {
  if (!(await untrackedPathsOf($)).includes(path)) {
    return
  }
  await update($, markedPathsAtom, markedPaths =>
    markedPaths.includes(path) ? markedPaths.filter(markedPath => markedPath !== path) : [...markedPaths, path],
  )
}

async function toggleCurrentFileMark($: EngineInterface): Promise<void> {
  const selectedFilePath = await read($, selectedFilePathAtom)
  if (selectedFilePath && !(await read($, isOverviewShownAtom))) {
    await toggleMarked($, selectedFilePath)
  }
}

async function markAllNewFiles($: EngineInterface): Promise<void> {
  const untrackedPaths = await untrackedPathsOf($)
  await update($, markedPathsAtom, markedPaths => (markedPaths.length === untrackedPaths.length ? [] : untrackedPaths))
}

// Stages the marked new files, or the current one when it is new and nothing is marked.
async function stageMarkedFiles($: EngineInterface): Promise<void> {
  const untrackedPaths = await untrackedPathsOf($)
  const markedPaths = (await read($, markedPathsAtom)).filter(path => untrackedPaths.includes(path))
  const selectedFilePath = await read($, selectedFilePathAtom)
  const isSelectedFileNew = selectedFilePath !== null && untrackedPaths.includes(selectedFilePath)
  const pathsToStage = markedPaths.length > 0 ? markedPaths : isSelectedFileNew ? [selectedFilePath] : []
  if (pathsToStage.length === 0) {
    return
  }
  const gitAdd = await runGit($, ['add', '--', ...pathsToStage])
  if (!gitAdd.isSuccess) {
    await reportError($, `Git add failed (${shortOutput(gitAdd)})`)
    return
  }
  await update($, markedPathsAtom, () => [])
  await loadView($)
}

// Everything the Uncommitted view lists goes to the index: modified, deleted and new files alike.
async function stageAllChanges($: EngineInterface): Promise<void> {
  const gitAdd = await runGit($, ['add', '--all'])
  if (!gitAdd.isSuccess) {
    await reportError($, `Git add --all failed (${shortOutput(gitAdd)})`)
    return
  }
  await update($, markedPathsAtom, () => [])
  await loadView($)
}

// --- The pane and its keyboard --------------------------------------------------------------------------------------

async function paneOpenArguments($: EngineInterface) {
  const requestedPaneColumns = await read($, requestedPaneColumnsAtom)

  return {
    id: PANE_ID,
    title: PANE_TITLE,
    focus: true as const,
    closeOnEscape: true as const,
    ...(requestedPaneColumns > 0 ? { columns: requestedPaneColumns } : {}),
  }
}

// A key press is handled before the pane is drawn again, and the engine waits for an element still to be drawn: awaiting
// the focus there would hold the press until the wait gives up. It settles once the next drawing is done.
function focusAfterNextDrawing($: EngineInterface, key: string): void {
  void $.ui.focus({ requestId: PANE_ID, key }).catch(() => undefined)
}

// Refused while the prompt below holds the keyboard: the field then waits for the person's own click.
async function focusQuestionField($: EngineInterface, questionFieldNumber: number): Promise<void> {
  const isStillWaitingForKeyboard =
    (await read($, questionFieldNumberAtom)) === questionFieldNumber &&
    (await read($, anchorWithOpenInputAtom)) !== null &&
    !(await read($, hasQuestionHadKeyboardAtom))
  if (isStillWaitingForKeyboard) {
    await $.ui.focus({ requestId: PANE_ID, key: `${QUESTION_INPUT_KEY_PREFIX}${questionFieldNumber}` }).catch(() => undefined)
  }
}

// --- Questions ------------------------------------------------------------------------------------------------------

// Each opened question gets a field of its own key: reusing one would hand the keyboard to the field of the previous
// line, still on screen for a moment and gone right after.
async function openQuestion($: EngineInterface, anchorKey: string): Promise<void> {
  await update($, armedQuestionAtom, () => null)
  await update($, questionDraftAtom, () => '')
  await update($, hasQuestionHadKeyboardAtom, () => false)
  const questionFieldNumber = await update($, questionFieldNumberAtom, fieldNumber => fieldNumber + 1)
  await update($, anchorWithOpenInputAtom, () => anchorKey)
  // A click on a line does not hand the keyboard to the pane, and a field can only be focused inside a pane that holds
  // it: opening the pane again with focus gives it the keyboard first. Without the width this explorer asked for,
  // opening again would bring the pane back to the default share, so it is only done once that width is known.
  if ((await read($, requestedPaneColumnsAtom)) > 0) {
    await $.ui.open(await paneOpenArguments($)).catch(() => undefined)
  }
  await focusQuestionField($, questionFieldNumber)
  // A click while another field held the keyboard moves the focus onto the clicked button once this press is handled,
  // taking it back from the new field: the keyboard is asked for again just after.
  await $.clock.after(QUESTION_FOCUS_RETRY_MS, () => focusQuestionField($, questionFieldNumber))
}

async function closeQuestion($: EngineInterface): Promise<void> {
  await update($, focusedElementKeyAtom, key => (key?.startsWith(QUESTION_INPUT_KEY_PREFIX) ? null : key))
  await update($, questionDraftAtom, () => '')
  await update($, hasQuestionHadKeyboardAtom, () => false)
  await update($, anchorWithOpenInputAtom, () => null)
}

async function describeViewForPrompt($: EngineInterface): Promise<string> {
  const view = await read($, viewAtom)
  if (view === 'uncommitted') {
    return 'the uncommitted changes (working tree against HEAD)'
  }
  if (view === 'pr') {
    return `the whole branch against its base (${(await read($, baseRefAtom))?.slice(0, 10) ?? '?'}..HEAD)`
  }
  const commitSha = await read($, selectedCommitShaAtom)
  const commit = (await read($, commitsAtom)).find(summary => summary.sha === commitSha)

  return `commit ${commit?.shortSha ?? '?'} "${commit?.subject ?? ''}"`
}

async function findRowQuestionTarget($: EngineInterface, rowIndex: number): Promise<QuestionTarget | null> {
  const path = await read($, selectedFilePathAtom)
  if (!path) {
    return null
  }

  return rowQuestionTarget({
    viewDescription: await describeViewForPrompt($),
    repositoryRoot: await read($, repositoryRootAtom),
    path,
    rows: await read($, diffRowsAtom),
    rowIndex,
    contextRadius: CONTEXT_RADIUS_ROWS,
  })
}

async function findOverviewQuestionTarget($: EngineInterface, blockIndex: number): Promise<QuestionTarget | null> {
  const pullRequest = await read($, pullRequestAtom)
  const block = pullRequest ? splitMarkdownBlocks(pullRequest.overviewMarkdown)[blockIndex] : undefined
  if (!pullRequest || block === undefined) {
    return null
  }

  return overviewQuestionTarget({
    pullRequestHeadline: pullRequest.overviewHeadline,
    pullRequestUrl: pullRequest.url,
    repositoryRoot: await read($, repositoryRootAtom),
    block,
  })
}

async function sendToConversation($: EngineInterface, threadId: string, question: string, context: string): Promise<void> {
  await update($, threadIdAwaitingTurnAtom, () => threadId)
  await update($, followedThreadIdAtom, () => threadId)
  // The location and its surroundings go in as a row only the model reads, so the transcript shows the question alone.
  try {
    await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: context }] } })
  } catch (error) {
    await reportError($, `The context of the question was not sent (${String(error)})`)
  }
  await $.prompt.submit({ text: question })
  // The field that held the keyboard is gone once the question leaves: the keyboard would fall back to the prompt, so
  // the pane takes it again, on the line the cursor is on, for the shortcuts to keep working.
  await $.clock.after(QUESTION_FOCUS_RETRY_MS, () => takeKeyboardBackToCursor($))
}

async function takeKeyboardBackToCursor($: EngineInterface): Promise<void> {
  if ((await read($, requestedPaneColumnsAtom)) > 0) {
    await $.ui.open(await paneOpenArguments($)).catch(() => undefined)
  }
  if (lastDrawnLayout.cursorRowIndex !== null) {
    focusAfterNextDrawing($, CURSOR_LINE_FOCUS_KEY)
  }
}

async function askFromPane($: EngineInterface, anchorKey: string, target: QuestionTarget | null, question: string): Promise<void> {
  const trimmedQuestion = question.trim()
  if (trimmedQuestion === '' || target === null) {
    return
  }
  const thread = newThread(`${anchorKey}-${await $.clock.now()}`, anchorKey, target.anchorDescription, trimmedQuestion)
  await update($, threadsAtom, threads => [...threads, thread])
  await saveThreads($)
  await closeQuestion($)
  await sendToConversation($, thread.id, trimmedQuestion, target.context)
}

// The prompt below has what a pane field lacks, voice dictation (Space held) first: the question is armed on its
// spot, and the next prompt the person sends carries its context and gets its answer drawn there.
async function armQuestionForPrompt($: EngineInterface, anchorKey: string, target: QuestionTarget | null): Promise<void> {
  if (target === null) {
    return
  }
  await closeQuestion($)
  await update($, armedQuestionAtom, () => ({ anchorKey, ...target }))
}

async function armOpenQuestionForPrompt($: EngineInterface): Promise<void> {
  const anchorKey = await read($, anchorWithOpenInputAtom)
  const anchor = anchorKey === null ? null : parseAnchorKey(anchorKey)
  if (anchorKey === null || anchor === null) {
    return
  }
  if (anchor.kind === 'overview') {
    await armQuestionForPrompt($, anchorKey, await findOverviewQuestionTarget($, anchor.blockIndex))
    return
  }
  const view = await read($, viewAtom)
  const commitSha = await read($, selectedCommitShaAtom)
  const rowIndex = (await read($, diffRowsAtom)).findIndex(row => anchorKeyOf(view, commitSha, anchor.path, row) === anchorKey)
  if (rowIndex !== -1) {
    await armQuestionForPrompt($, anchorKey, await findRowQuestionTarget($, rowIndex))
  }
}

async function appendExchange($: EngineInterface, threadId: string, question: string): Promise<void> {
  await update($, threadsAtom, threads =>
    threads.map(thread =>
      thread.id === threadId ? { ...thread, exchanges: [...thread.exchanges, queuedExchange(question)], isContextCleared: false } : thread,
    ),
  )
  await saveThreads($)
}

async function replyInThread($: EngineInterface, threadId: string, reply: string): Promise<void> {
  const trimmedReply = reply.trim()
  const thread = (await read($, threadsAtom)).find(candidate => candidate.id === threadId)
  if (trimmedReply === '' || thread === undefined) {
    return
  }
  const replyContext = replyContextOf(thread)
  await appendExchange($, threadId, trimmedReply)
  await sendToConversation($, threadId, trimmedReply, replyContext)
}

async function armReplyForPrompt($: EngineInterface, threadId: string): Promise<void> {
  const thread = (await read($, threadsAtom)).find(candidate => candidate.id === threadId)
  if (thread === undefined) {
    return
  }
  await closeQuestion($)
  await update($, armedQuestionAtom, () => ({
    anchorKey: thread.anchorKey,
    anchorDescription: thread.anchorDescription,
    context: replyContextOf(thread),
    threadId,
  }))
}

async function threadsOfScreen($: EngineInterface) {
  const view = await read($, viewAtom)

  const gitHubThreads = view === 'pr' ? gitHubThreadNavigationEntries(await read($, gitHubReviewThreadsAtom)) : []

  return threadsInReadingOrder([...(await read($, threadsAtom)), ...gitHubThreads], {
    view,
    commitSha: view === 'commits' ? await read($, selectedCommitShaAtom) : null,
    orderedPaths: groupFilesByDirectory(await shownFilesOf($, await read($, filesAtom))).flatMap(group =>
      group.files.map(file => file.path),
    ),
    hasOverview: view === 'pr' && (await read($, pullRequestAtom)) !== null,
  })
}

// The keyboard walks the threads of what is on screen in reading order, wrapping around at both ends.
async function moveThread($: EngineInterface, offset: number): Promise<void> {
  const orderedThreads = await threadsOfScreen($)
  if (orderedThreads.length === 0) {
    return
  }
  const currentThreadId = await read($, currentThreadIdAtom)
  const currentIndex = orderedThreads.findIndex(thread => thread.id === currentThreadId)
  const targetIndex =
    currentIndex === -1 ? (offset > 0 ? 0 : orderedThreads.length - 1) : (currentIndex + offset + orderedThreads.length) % orderedThreads.length
  const target = orderedThreads[targetIndex]
  if (target) {
    await goToThread($, target)
  }
}

// The file list's comment mark leads to the first thread still open in its file.
async function goToFirstOpenThreadOfFile($: EngineInterface, path: string): Promise<void> {
  const gitHubReviewThreads = await read($, gitHubReviewThreadsAtom)
  const resolvedThreadIds = new Set(gitHubReviewThreads.filter(thread => thread.isResolved).map(thread => thread.id))
  const firstOpenThread = openThreadsByPath(await threadsOfScreen($), resolvedThreadIds)[path]?.[0]
  if (firstOpenThread) {
    await goToThread($, firstOpenThread)
  }
}

async function goToThread($: EngineInterface, target: { id: string; anchorKey: string }): Promise<void> {
  const anchor = parseAnchorKey(target.anchorKey)
  if (!anchor) {
    return
  }
  await update($, currentThreadIdAtom, () => target.id)
  if (anchor.kind === 'overview') {
    await showOverview($)
    const pullRequest = await read($, pullRequestAtom)
    const block = pullRequest ? splitMarkdownBlocks(pullRequest.overviewMarkdown)[anchor.blockIndex] : undefined
    const isBlockStillThere =
      pullRequest !== null && block !== undefined && overviewAnchorKeyOf(pullRequest.number, anchor.blockIndex, block) === target.anchorKey
    await update($, diffOffsetAtom, () => (isBlockStillThere ? anchor.blockIndex : 0))
    return
  }
  if ((await read($, selectedFilePathAtom)) !== anchor.path || (await read($, isOverviewShownAtom))) {
    await selectFile($, anchor.path, 'caller')
  }
  const view = await read($, viewAtom)
  const commitSha = await read($, selectedCommitShaAtom)
  const diffRows = await read($, diffRowsAtom)
  const gitHubThread = (await read($, gitHubReviewThreadsAtom)).find(thread => thread.id === target.id)
  const rowIndex = diffRows.findIndex(row =>
    gitHubThread
      ? isGitHubThreadOnRow(gitHubThread, anchor.path, row)
      : anchorKeyOf(view, commitSha, anchor.path, row) === target.anchorKey,
  )
  const scrolledIndex = lastDrawnLayout.isSplitView ? splitIndexOfRow(pairRowsSideBySide(diffRows), rowIndex) : rowIndex
  await update($, diffOffsetAtom, () => Math.max(0, scrolledIndex - 2))
  if (rowIndex !== -1) {
    await update($, cursorRowIndexAtom, () => rowIndex)
  }
  if (rowIndex !== -1) {
    focusAfterNextDrawing($, CURSOR_LINE_FOCUS_KEY)
  }
}

// Claude gets the conversation of a review thread and changes the code to settle it; its answer is drawn under the
// thread's line. An outdated thread has no line left: Claude answers in the conversation only.
async function addressGitHubThread($: EngineInterface, threadId: string): Promise<void> {
  const gitHubThread = (await read($, gitHubReviewThreadsAtom)).find(thread => thread.id === threadId)
  const pullRequest = await read($, pullRequestAtom)
  if (!gitHubThread || !pullRequest) {
    return
  }
  const request = addressRequestOf(gitHubThread, pullRequest)
  if ((await read($, selectedFilePathAtom)) !== gitHubThread.path || (await read($, isOverviewShownAtom))) {
    await selectFile($, gitHubThread.path, 'caller')
  }
  const rowIndex = (await read($, diffRowsAtom)).findIndex(row => isGitHubThreadOnRow(gitHubThread, gitHubThread.path, row))
  const target = rowIndex === -1 ? null : await findRowQuestionTarget($, rowIndex)
  if (target === null) {
    await $.prompt.submit({ text: `${request.question}\n\n${request.context}` })
    return
  }
  const anchorKey = anchorKeyOf(await read($, viewAtom), await read($, selectedCommitShaAtom), gitHubThread.path, (await read($, diffRowsAtom))[rowIndex] as DiffRow)
  await askFromPane($, anchorKey, { ...target, context: `${target.context}\n\n${request.context}` }, request.question)
}

async function readClaudeCodeTheme($: EngineInterface): Promise<void> {
  const rows = await $.config.list().catch(() => [])
  const themeRow = rows.find(row => row.key === 'theme')
  await update($, claudeCodeThemeAtom, () => (typeof themeRow?.value === 'string' ? themeRow.value : null))
}

// --- Watched term ---------------------------------------------------------------------------------------------------

async function loadWatchedSource($: EngineInterface): Promise<void> {
  if ((await read($, watchedTermAtom)) === '') {
    await update($, watchedSourceRowsByPathAtom, () => ({}))
    await update($, watchedMatchCountByPathAtom, () => ({}))
    return
  }
  const range = diffRangeArguments(await read($, viewAtom), await read($, baseRefAtom), await read($, selectedCommitShaAtom))
  const diff = range ? await runGit($, ['diff', '--no-color', '--no-renames', `-U${DEFAULT_DIFF_CONTEXT_LINES}`, ...range]) : null
  const rowsByPath = diff?.isSuccess ? rowsByPathOfViewDiff(diff.output) : {}
  for (const file of await read($, filesAtom)) {
    if (file.isUntracked) {
      rowsByPath[file.path] = await readUntrackedFileRows($, file.path)
    }
  }
  await update($, watchedSourceRowsByPathAtom, () => rowsByPath)
  await recountWatchedMatches($)
}

async function recountWatchedMatches($: EngineInterface): Promise<void> {
  const term = await read($, watchedTermAtom)
  const rowsByPath = await read($, watchedSourceRowsByPathAtom)
  await update($, watchedMatchCountByPathAtom, () => matchCountByPathOf(rowsByPath, term))
}

async function watchTerm($: EngineInterface, term: string): Promise<void> {
  const wasWatching = (await read($, watchedTermAtom)) !== ''
  await update($, watchedTermAtom, () => term)
  if (wasWatching && term !== '') {
    await recountWatchedMatches($)
  } else {
    await loadWatchedSource($)
  }
}

// The terminal hands over what the mouse selected; with nothing selected, or on a surface that does not tell, the term
// is typed instead.
async function watchSelection($: EngineInterface): Promise<void> {
  const selection = await $.ui.selection().catch(() => undefined)
  const term = watchedTermOf(selection?.text ?? '')
  if (term === '') {
    await update($, isWatchFieldOpenAtom, () => true)
    focusAfterNextDrawing($, WATCH_FIELD_KEY)
    return
  }
  await update($, isWatchFieldOpenAtom, () => false)
  await watchTerm($, term)
}

async function moveToWatchedMatch($: EngineInterface, direction: 1 | -1): Promise<void> {
  const term = await read($, watchedTermAtom)
  if (term === '') {
    return
  }
  await update($, followedThreadIdAtom, () => null)
  const selectedFilePath = await read($, selectedFilePathAtom)
  const isOnFile = selectedFilePath !== null && !(await read($, isOverviewShownAtom))
  const matchStopOfShownFile = async (cursorRowIndex: number | null) => {
    const diffRows = await read($, diffRowsAtom)
    const splitRows = lastDrawnLayout.isSplitView ? pairRowsSideBySide(diffRows) : null
    return matchStopFrom(diffRows, cursorStopsOf(diffRows, splitRows), cursorRowIndex, term, direction)
  }
  const matchInFile = isOnFile ? await matchStopOfShownFile(lastDrawnLayout.cursorRowIndex) : null
  if (matchInFile !== null) {
    await placeCursorOnRow($, matchInFile)
    return
  }
  const shownFiles = await shownFilesOf($, await read($, filesAtom))
  const orderedPaths = groupFilesByDirectory(shownFiles).flatMap(group => group.files.map(file => file.path))
  const nextPath = fileWithMatchesFrom(orderedPaths, isOnFile ? selectedFilePath : null, await read($, watchedMatchCountByPathAtom), direction)
  if (nextPath === null) {
    return
  }
  await selectFile($, nextPath, 'caller')
  const firstMatch = await matchStopOfShownFile(null)
  if (firstMatch === null) {
    await focusFirstChange($)
    return
  }
  await placeCursorOnRow($, firstMatch)
}

// --- Line cursor ----------------------------------------------------------------------------------------------------

async function placeCursorOnRow($: EngineInterface, rowIndex: number): Promise<void> {
  const splitRows = lastDrawnLayout.isSplitView ? pairRowsSideBySide(await read($, diffRowsAtom)) : null
  const drawnIndex = splitRows ? splitIndexOfRow(splitRows, rowIndex) : rowIndex
  await update($, cursorRowIndexAtom, () => rowIndex)
  await update($, diffOffsetAtom, offset => offsetShowingCursor(drawnIndex, offset, lastDrawnLayout.visibleDiffRows))
  focusAfterNextDrawing($, CURSOR_LINE_FOCUS_KEY)
}

type CursorMove = (stops: number[], diffRows: DiffRow[]) => (cursorRowIndex: number, isInView: (rowIndex: number) => boolean) => number

// The cursor starts where the last drawing showed it; a cursor scrolled out of sight by the wheel comes back to the
// first line in view instead of dragging the diff back to where it was.
async function moveCursor($: EngineInterface, move: CursorMove): Promise<void> {
  await update($, followedThreadIdAtom, () => null)
  const cursorRowIndex = lastDrawnLayout.cursorRowIndex
  if ((await read($, isOverviewShownAtom)) || cursorRowIndex === null) {
    return
  }
  const diffRows = await read($, diffRowsAtom)
  const splitRows = lastDrawnLayout.isSplitView ? pairRowsSideBySide(diffRows) : null
  const drawnIndexOf = (rowIndex: number) => (splitRows ? splitIndexOfRow(splitRows, rowIndex) : rowIndex)
  const diffOffset = await read($, diffOffsetAtom)
  const isInView = (rowIndex: number) => {
    const drawnIndex = drawnIndexOf(rowIndex)
    return drawnIndex >= diffOffset && drawnIndex < diffOffset + lastDrawnLayout.visibleDiffRows
  }
  const stops = cursorStopsOf(diffRows, splitRows)
  const target = move(stops, diffRows)(cursorRowIndex, isInView)
  await update($, cursorRowIndexAtom, () => target)
  await update($, diffOffsetAtom, offset => offsetShowingCursor(drawnIndexOf(target), offset, lastDrawnLayout.visibleDiffRows))
  focusAfterNextDrawing($, CURSOR_LINE_FOCUS_KEY)
}

async function cursorAnchorKey($: EngineInterface): Promise<string | null> {
  const cursorRowIndex = lastDrawnLayout.cursorRowIndex
  const path = await read($, selectedFilePathAtom)
  const row = cursorRowIndex === null ? undefined : (await read($, diffRowsAtom))[cursorRowIndex]
  if (!row || !path || (await read($, isOverviewShownAtom))) {
    return null
  }

  return anchorKeyOf(await read($, viewAtom), await read($, selectedCommitShaAtom), path, row)
}

// On a GitHub thread reached with the keyboard, the question is to settle that thread.
async function askOnCursorLine($: EngineInterface): Promise<void> {
  const currentThreadId = await read($, currentThreadIdAtom)
  const currentGitHubThread = (await read($, gitHubReviewThreadsAtom)).find(thread => thread.id === currentThreadId)
  if (currentGitHubThread && (await read($, viewAtom)) === 'pr') {
    await addressGitHubThread($, currentGitHubThread.id)
    return
  }
  const anchorKey = await cursorAnchorKey($)
  if (anchorKey) {
    await openQuestion($, anchorKey)
  }
}

// A line that already has a finished thread gets the reply field of its latest one; any other gets a new question.
async function replyOnCursorLine($: EngineInterface): Promise<void> {
  const anchorKey = await cursorAnchorKey($)
  if (!anchorKey) {
    return
  }
  const thread = (await read($, threadsAtom)).filter(candidate => candidate.anchorKey === anchorKey && isLastExchangeDone(candidate)).at(-1)
  if (!thread) {
    await openQuestion($, anchorKey)
    return
  }
  focusAfterNextDrawing($, `${REPLY_INPUT_KEY_PREFIX}${thread.id}`)
}

// --- Threads kept across sessions, per repository and branch ------------------------------------------------------

async function savedThreadsKey($: EngineInterface): Promise<string | null> {
  const repositoryRoot = await read($, repositoryRootAtom)
  const branch = await read($, branchAtom)

  return repositoryRoot && branch ? `${THREADS_STORE_KEY_PREFIX}|${repositoryRoot}|${branch}` : null
}

async function saveThreads($: EngineInterface): Promise<void> {
  const key = await savedThreadsKey($)
  if (key === null) {
    return
  }
  const threads = await read($, threadsAtom)
  await $.store.set(key, threads.slice(-MAX_SAVED_THREADS_PER_BRANCH)).catch(() => undefined)
}

async function restoreSavedThreads($: EngineInterface): Promise<void> {
  const key = await savedThreadsKey($)
  if (key === null) {
    return
  }
  const saved = await $.store.get(key).catch(() => undefined)
  const shownThreadIds = new Set((await read($, threadsAtom)).map(thread => thread.id))
  const restored = restoredThreads(saved, shownThreadIds)
  if (restored.length > 0) {
    await update($, threadsAtom, threads => [...restored, ...threads])
  }
}

// The answer keeps arriving into a thread dismissed mid-turn: it is simply no longer drawn, and the transcript still holds it.
async function dismissThread($: EngineInterface, threadId: string): Promise<void> {
  await update($, threadsAtom, threads => threads.filter(thread => thread.id !== threadId))
  await saveThreads($)
}

async function appendToThreadOfTurn($: EngineInterface, turnId: string, text: string, isFirstTextOfItsMessage: boolean): Promise<void> {
  const threadId = (await read($, threadIdByTurnIdAtom))[turnId]
  if (threadId === undefined) {
    return
  }
  await update($, threadsAtom, threads =>
    threads.map(thread =>
      thread.id === threadId
        ? withLastExchange(thread, exchange => ({ ...exchange, answer: answerWithText(exchange.answer, text, isFirstTextOfItsMessage), status: 'answering' }))
        : thread,
    ),
  )
}

// --- What the drawing reads and can ask for -------------------------------------------------------------------------

async function readExplorerSnapshot($: EngineInterface): Promise<ExplorerSnapshot> {
  const keymap = keymapOf(await read($, keyboardLayoutAtom))

  return {
    view: await read($, viewAtom),
    repositoryRoot: await read($, repositoryRootAtom),
    repositoryWebUrl: await read($, repositoryWebUrlAtom),
    branch: await read($, branchAtom),
    baseRef: await read($, baseRefAtom),
    baseBranchName: await read($, baseBranchNameAtom),
    uncommittedFileCount: await read($, uncommittedFileCountAtom),
    branchCommitCount: await read($, branchCommitCountAtom),
    unpushedCommitShas: await read($, unpushedCommitShasAtom),
    pushState: await read($, pushStateAtom),
    commitListOffset: await read($, commitListOffsetAtom),
    errorNotices: await read($, errorNoticesAtom),
    helpScrolledLines: await read($, helpScrolledLinesAtom),
    followedThreadId: await read($, followedThreadIdAtom),
    isLoading: await read($, isLoadingAtom),
    loadError: await read($, loadErrorAtom),
    commits: await read($, commitsAtom),
    commitGraph: await read($, commitGraphAtom),
    gitHubReviewThreads: await read($, gitHubReviewThreadsAtom),
    expandedGitHubThreadIds: await read($, expandedGitHubThreadIdsAtom),
    selectedCommitSha: await read($, selectedCommitShaAtom),
    files: await read($, filesAtom),
    selectedFilePath: await read($, selectedFilePathAtom),
    isOverviewShown: await read($, isOverviewShownAtom),
    diffRows: await read($, diffRowsAtom),
    pullRequest: await read($, pullRequestAtom),
    viewedStateByPath: await read($, viewedStateByPathAtom),
    markedPaths: await read($, markedPathsAtom),
    fileFilter: await read($, fileFilterAtom),
    watchedTerm: await read($, watchedTermAtom),
    isWatchFieldOpen: await read($, isWatchFieldOpenAtom),
    watchedMatchCountByPath: await read($, watchedMatchCountByPathAtom),
    isWholeFileByPath: Object.fromEntries(
      Object.entries(await read($, contextLinesByPathAtom)).map(([path, lines]) => [path, lines >= WHOLE_FILE_CONTEXT_LINES]),
    ),
    isNoiseShown: await read($, isNoiseShownAtom),
    isViewedHidden: await read($, isViewedHiddenAtom),
    recentlyViewedPaths: await read($, recentlyViewedPathsAtom),
    foldedDirectories: await read($, foldedDirectoriesAtom),
    isFileDrawerOpen: await read($, isFileDrawerOpenAtom),
    isFileListCollapsed: await read($, isFileListCollapsedAtom),
    isSplitViewPreferred: await read($, isSplitViewPreferredAtom),
    keymap,
    isHelpShown: await read($, isHelpShownAtom),
    cursorRowIndex: await read($, cursorRowIndexAtom),
    focusedElementKey: await read($, focusedElementKeyAtom),
    fileListWidth: await read($, fileListWidthAtom),
    fileListOffset: await read($, fileListOffsetAtom),
    diffOffset: await read($, diffOffsetAtom),
    diffSkippedLines: await read($, diffSkippedLinesAtom),
    threads: await read($, threadsAtom),
    anchorWithOpenInput: await read($, anchorWithOpenInputAtom),
    questionFieldNumber: await read($, questionFieldNumberAtom),
    questionDraft: await read($, questionDraftAtom),
    hasQuestionHadKeyboard: await read($, hasQuestionHadKeyboardAtom),
    armedAnchorKey: (await read($, armedQuestionAtom))?.anchorKey ?? null,
    currentThreadId: await read($, currentThreadIdAtom),
    answerPulseFrame: await read($, answerPulseFrameAtom),
  }
}

function explorerActions($: EngineInterface): ExplorerActions {
  return {
    switchView: view => switchView($, view),
    moveView: offset => moveView($, offset),
    refresh: () => refreshExplorer($),
    pushBranch: () => pushBranch($),
    dismissErrorNotice: async noticeId => {
      await update($, errorNoticesAtom, notices => notices.filter(notice => notice.id !== noticeId))
    },
    close: () => $.ui.close({ id: PANE_ID }),
    selectCommit: commitSha => selectCommit($, commitSha),
    showOverview: async () => {
      await update($, isFileDrawerOpenAtom, () => false)
      await showOverview($)
    },
    selectFile: async path => {
      await update($, isFileDrawerOpenAtom, () => false)
      await selectFile($, path)
    },
    moveFileSelection: offset => moveFileSelection($, offset),
    toggleViewed: path => toggleViewed($, path),
    toggleMarked: path => toggleMarked($, path),
    toggleCurrentFileMark: () => toggleCurrentFileMark($),
    markAllNewFiles: () => markAllNewFiles($),
    stageMarkedFiles: () => stageMarkedFiles($),
    stageAllChanges: () => stageAllChanges($),
    updateFileFilter: async filter => {
      await update($, fileFilterAtom, () => filter)
      await update($, fileListOffsetAtom, () => 0)
    },
    expandContext: path => widenContext($, path, current => current + DIFF_CONTEXT_STEP_LINES),
    showWholeFile: path => widenContext($, path, () => WHOLE_FILE_CONTEXT_LINES),
    explainIdleShortcut: async () => {},
    explainSplitViewWidth: async () => {},
    toggleSplitView: async () => {
      const isSplitViewPreferred = !(await read($, isSplitViewPreferredAtom))
      await update($, isSplitViewPreferredAtom, () => isSplitViewPreferred)
      await update($, diffOffsetAtom, () => 0)
      await $.store.set(SPLIT_VIEW_STORE_KEY, isSplitViewPreferred).catch(() => undefined)
    },
    toggleNoiseShown: async () => {
      await update($, isNoiseShownAtom, isNoiseShown => !isNoiseShown)
    },
    toggleViewedHidden: async () => {
      await update($, isViewedHiddenAtom, isViewedHidden => !isViewedHidden)
      await update($, recentlyViewedPathsAtom, () => [])
      await update($, fileListOffsetAtom, () => 0)
    },
    clearFileFilters: async () => {
      await update($, fileFilterAtom, () => '')
      await update($, isViewedHiddenAtom, () => false)
      await update($, isNoiseShownAtom, () => true)
      await update($, fileListOffsetAtom, () => 0)
    },
    toggleDirectoryFold: directory => toggleDirectoryFold($, directory),
    toggleCurrentDirectoryFold: async () => {
      const selectedFilePath = await read($, selectedFilePathAtom)
      if (selectedFilePath !== null && !(await read($, isOverviewShownAtom))) {
        await toggleDirectoryFold($, directoryOf(selectedFilePath))
      }
    },
    openQuestion: anchorKey => openQuestion($, anchorKey),
    closeQuestion: () => closeQuestion($),
    updateQuestionDraft: async text => {
      await update($, questionDraftAtom, () => text)
    },
    askAboutRow: async (anchorKey, rowIndex, question) =>
      askFromPane($, anchorKey, await findRowQuestionTarget($, rowIndex), question),
    armRowQuestion: async (anchorKey, rowIndex) => armQuestionForPrompt($, anchorKey, await findRowQuestionTarget($, rowIndex)),
    askAboutOverviewBlock: async (anchorKey, blockIndex, question) =>
      askFromPane($, anchorKey, await findOverviewQuestionTarget($, blockIndex), question),
    armOverviewQuestion: async (anchorKey, blockIndex) =>
      armQuestionForPrompt($, anchorKey, await findOverviewQuestionTarget($, blockIndex)),
    disarmQuestion: async () => {
      await update($, armedQuestionAtom, () => null)
    },
    dismissThread: threadId => dismissThread($, threadId),
    replyInThread: (threadId, reply) => replyInThread($, threadId, reply),
    armReply: threadId => armReplyForPrompt($, threadId),
    moveThread: offset => moveThread($, offset),
    moveCursor: offset => moveCursor($, stops => (cursorRowIndex, isInView) =>
      isInView(cursorRowIndex) ? movedCursor(stops, cursorRowIndex, offset) : (stops.find(isInView) ?? cursorRowIndex),
    ),
    moveCursorToHunk: direction =>
      moveCursor($, (stops, diffRows) => cursorRowIndex => cursorAtHunk(diffRows, stops, cursorRowIndex, direction)),
    askOnCursorLine: () => askOnCursorLine($),
    replyOnCursorLine: () => replyOnCursorLine($),
    markViewedAndNext: () => markViewedAndNext($),
    watchSelection: () => watchSelection($),
    updateWatchedTerm: term => watchTerm($, term),
    submitWatchedTerm: async term => {
      await update($, isWatchFieldOpenAtom, () => false)
      await watchTerm($, term)
      await moveToWatchedMatch($, 1)
    },
    clearWatchedTerm: async () => {
      await update($, isWatchFieldOpenAtom, () => false)
      await watchTerm($, '')
    },
    moveToWatchedMatch: direction => moveToWatchedMatch($, direction),
    focusFileFilter: async () => {
      await update($, isFileDrawerOpenAtom, () => !lastDrawnLayout.isTwoColumns)
      focusAfterNextDrawing($, FILE_FILTER_KEY)
    },
    submitFileFilter: async filter => {
      await update($, fileFilterAtom, () => filter)
      await update($, fileListOffsetAtom, () => 0)
      if (lastDrawnLayout.isFileDrawerOpen) {
        // The drawer gives the code its place back on the file the filter found.
        await update($, isFileDrawerOpenAtom, () => false)
        const shownFiles = await shownFilesOf($, await read($, filesAtom))
        const selectedFilePath = await read($, selectedFilePathAtom)
        const foundPath = groupFilesByDirectory(shownFiles)[0]?.files[0]?.path
        if (foundPath && !shownFiles.some(file => file.path === selectedFilePath)) {
          await selectFile($, foundPath)
          return
        }
      }
      await focusFirstChange($)
    },
    toggleFileDrawer: async () => {
      await update($, isFileDrawerOpenAtom, isFileDrawerOpen => !isFileDrawerOpen)
    },
    openFirstThreadOfFile: async path => {
      await update($, isFileDrawerOpenAtom, () => false)
      await goToFirstOpenThreadOfFile($, path)
    },
    toggleFileListCollapse: async () => {
      const isFileListCollapsed = !(await read($, isFileListCollapsedAtom))
      await update($, isFileListCollapsedAtom, () => isFileListCollapsed)
      await update($, isFileDrawerOpenAtom, () => false)
      await $.store.set(FILE_LIST_COLLAPSED_STORE_KEY, isFileListCollapsed).catch(() => undefined)
    },
    toggleHelp: async () => {
      await update($, isHelpShownAtom, isHelpShown => !isHelpShown)
      await update($, helpScrolledLinesAtom, () => 0)
    },
    toggleGitHubThreadResolved: threadId => toggleGitHubThreadResolved($, threadId),
    addressGitHubThread: threadId => addressGitHubThread($, threadId),
    toggleGitHubThread: async threadId => {
      await update($, expandedGitHubThreadIdsAtom, threadIds =>
        threadIds.includes(threadId) ? threadIds.filter(id => id !== threadId) : [...threadIds, threadId],
      )
    },
    openOnGitHub: async page => {
      const opened = await openInBrowser($, page.url)
      if (!opened.isSuccess) {
        await reportError($, `Could not open ${page.url} (${shortOutput(opened)})`)
      }
    },
  }
}

// --- Hooks ----------------------------------------------------------------------------------------------------------

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await readClaudeCodeTheme($)
    const savedFileListWidth = await $.store.get(FILE_LIST_WIDTH_STORE_KEY).catch(() => undefined)
    if (typeof savedFileListWidth === 'number') {
      await update($, fileListWidthAtom, () => savedFileListWidth)
    }
    const savedFileListCollapse = await $.store.get(FILE_LIST_COLLAPSED_STORE_KEY).catch(() => undefined)
    if (typeof savedFileListCollapse === 'boolean') {
      await update($, isFileListCollapsedAtom, () => savedFileListCollapse)
    }
    const savedSplitViewPreference = await $.store.get(SPLIT_VIEW_STORE_KEY).catch(() => undefined)
    if (typeof savedSplitViewPreference === 'boolean') {
      await update($, isSplitViewPreferredAtom, () => savedSplitViewPreference)
    }
    const keyboardLayout = await detectKeyboardLayout($)
    await update($, keyboardLayoutAtom, () => keyboardLayout)
    // The mark of a thread Claude is still answering blinks; nothing is redrawn while no answer is awaited.
    $.clock.every(ANSWER_PULSE_MS, async () => {
      if ((await read($, threadsAtom)).some(thread => !isLastExchangeDone(thread))) {
        await update($, answerPulseFrameAtom, frame => frame + 1)
      }
    })
    await $.command.register({
      name: 'diff-review',
      description: 'Open the review explorer: uncommitted changes, the PR, or commit by commit',
    })

    return next(e)
  })

  on('config.set', async ($, e, next) => {
    const result = await next(e)
    if (e.key === 'theme') {
      await readClaudeCodeTheme($)
    }

    return result
  })

  on('command.run', { command: 'diff-review' }, async ($, e) => {
    // /theme changes the theme without going through config.set: it is read again at each opening.
    await readClaudeCodeTheme($)
    await closeQuestion($)
    await update($, selectedFilePathAtom, () => null)
    await update($, isOverviewShownAtom, () => true)
    await update($, isLoadingAtom, () => true)
    const requestedPaneColumns = Math.round(e.presentation.columns * PANE_SHARE_OF_TERMINAL)
    await update($, requestedPaneColumnsAtom, () => requestedPaneColumns)
    const opened = await $.ui.open({ ...(await paneOpenArguments($)), columns: requestedPaneColumns })
    await refreshExplorer($)
    const openingView = openingViewOf(await read($, uncommittedFileCountAtom), await read($, branchCommitCountAtom))
    if (openingView !== (await read($, viewAtom))) {
      await update($, viewAtom, () => openingView)
      await loadView($)
    }
    await focusFirstChange($)

    return { text: opened.isPlaced ? 'Review explorer opened.' : `Review explorer waiting: ${opened.reason}` }
  })

  // An edit or a shell command can change what the open view shows.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    const isOpen = (await $.ui.panes()).some(pane => pane.id === PANE_ID)
    if (isOpen && ['Edit', 'Write', 'NotebookEdit', 'Bash'].includes(String(e.tool)) && e.agentId === undefined) {
      await loadView($)
    }

    return result
  })

  // The wheel moves the file list when the pointer is over it and the diff everywhere else; page keys move the diff.
  on('ui.scroll', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const layout = lastDrawnLayout
    const pointer = e.pointer
    await update($, followedThreadIdAtom, () => null)
    if (await read($, isHelpShownAtom)) {
      const helpContentLines = helpContentLineCount(layout.bodyColumns)
      const helpVisibleLines = helpVisibleLineCount(layout.panelsHeight, layout.bodyColumns)
      const linesToMove = pointer !== undefined ? e.by * WHEEL_TICK_ROWS : Math.sign(e.by) * helpVisibleLines
      await update($, helpScrolledLinesAtom, scrolledLines => clampOffset(scrolledLines + linesToMove, helpContentLines, helpVisibleLines))
      return {}
    }
    const isOverCommitList =
      pointer !== undefined && pointer.row >= layout.panelsTop - layout.commitPanelRows && pointer.row < layout.panelsTop
    if (isOverCommitList) {
      await update($, commitListOffsetAtom, () =>
        clampOffset(layout.firstShownCommitLineIndex + e.by * WHEEL_TICK_ROWS, layout.commitLineCount, COMMIT_PANEL_MAX_LINES),
      )
      return {}
    }
    const isOverFileList =
      pointer !== undefined &&
      pointer.row >= layout.panelsTop &&
      (layout.isTwoColumns || layout.isFileDrawerOpen) &&
      pointer.column < layout.fileListWidth
    if (isOverFileList) {
      await update($, fileListOffsetAtom, offset =>
        clampOffset(offset + e.by * WHEEL_TICK_ROWS, layout.fileLineCount, layout.visibleFileLines),
      )
      return {}
    }
    const rowsPerTick = layout.isOverviewShown ? 1 : WHEEL_TICK_ROWS
    const pageRows = layout.isOverviewShown ? 3 : layout.visibleDiffRows
    const rowsToMove = pointer !== undefined ? e.by * rowsPerTick : Math.sign(e.by) * Math.min(Math.abs(e.by), pageRows)
    const selectedFilePath = await read($, selectedFilePathAtom)
    if (layout.diffRowHeights.length > 0 && selectedFilePath !== null) {
      const totalLines = layout.diffRowHeights.reduce((total, height) => total + height, 0)
      const lastTopLine = layout.isScrollingPastEnd ? totalLines - 1 : Math.max(0, totalLines - layout.visibleDiffRows)
      await scrollDiffByLines($, selectedFilePath, rowsToMove, layout.diffRowHeights, lastTopLine)
      return {}
    }
    const visibleForClamp = layout.isScrollingPastEnd ? 1 : layout.visibleDiffRows
    await update($, diffOffsetAtom, offset => clampOffset(offset + rowsToMove, layout.scrolledRowCount, visibleForClamp))

    return {}
  })

  on('ui.focus', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    const element = e.element ?? ''
    const isLineButton =
      element === ASK_ON_LINE_KEY ||
      element === CURSOR_LINE_FOCUS_KEY ||
      element.startsWith(ASK_BUTTON_KEY_PREFIX) ||
      element.startsWith(LINE_NUMBER_BUTTON_KEY_PREFIX)
    const isQuestionWaitingForKeyboard =
      (await read($, anchorWithOpenInputAtom)) !== null && !(await read($, hasQuestionHadKeyboardAtom))
    if (isLineButton && isQuestionWaitingForKeyboard) {
      // The question just opened from that button waits for the keyboard: the focus goes to its field instead.
      const questionFieldKey = `${QUESTION_INPUT_KEY_PREFIX}${await read($, questionFieldNumberAtom)}`
      const redirected = await next({ ...e, element: questionFieldKey })
      if (!('deny' in redirected) || redirected.deny === undefined) {
        await update($, focusedElementKeyAtom, () => questionFieldKey)
        await update($, hasQuestionHadKeyboardAtom, () => true)
      }

      return redirected
    }
    const previouslyFocusedKey = await read($, focusedElementKeyAtom)
    await update($, focusedElementKeyAtom, () => e.element ?? null)
    // The down arrow written on that button: leaving the field for it arms the question as a press would.
    if (element === DICTATE_QUESTION_KEY && previouslyFocusedKey?.startsWith(QUESTION_INPUT_KEY_PREFIX) && e.origin.kind === 'person') {
      const moved = await next(e)
      await armOpenQuestionForPrompt($)
      return moved
    }
    if (element.startsWith(QUESTION_INPUT_KEY_PREFIX)) {
      await update($, hasQuestionHadKeyboardAtom, () => true)
      return next(e)
    }
    // Moving to another element, by Tab or a click, closes a question left empty; landing on a [+], the question's own
    // buttons or a thread's close button is part of opening or closing it.
    const isPartOfQuestion =
      isLineButton || element === CANCEL_QUESTION_KEY || element === DICTATE_QUESTION_KEY || element.startsWith(DISMISS_THREAD_KEY_PREFIX)
    const isQuestionLeftEmpty =
      (await read($, anchorWithOpenInputAtom)) !== null && (await read($, questionDraftAtom)).trim() === ''
    if (!isPartOfQuestion && isQuestionLeftEmpty) {
      await closeQuestion($)
    }

    return next(e)
  })

  // Escape first closes what is open on a line: the question being written, or the thread whose close button has the
  // focus. Only with nothing of that kind left does it close the pane.
  on('ui.close', async ($, e, next) => {
    if (e.id !== PANE_ID || e.origin.kind !== 'person') {
      return next(e)
    }
    if ((await read($, armedQuestionAtom)) !== null) {
      return { value: undefined }
    }
    if (await read($, isHelpShownAtom)) {
      await update($, isHelpShownAtom, () => false)
      return { value: undefined }
    }
    if ((await read($, anchorWithOpenInputAtom)) !== null) {
      await closeQuestion($)
      return { value: undefined }
    }
    const focusedElementKey = (await read($, focusedElementKeyAtom)) ?? ''
    if (lastDrawnLayout.isFileDrawerOpen) {
      await update($, isFileDrawerOpenAtom, () => false)
      await update($, focusedElementKeyAtom, () => null)
      return { value: undefined }
    }
    if (focusedElementKey.startsWith(REPLY_INPUT_KEY_PREFIX) || focusedElementKey === FILE_FILTER_KEY) {
      await update($, focusedElementKeyAtom, () => null)
      return { value: undefined }
    }
    if (focusedElementKey.startsWith(DISMISS_THREAD_KEY_PREFIX)) {
      await dismissThread($, focusedElementKey.slice(DISMISS_THREAD_KEY_PREFIX.length))
      await update($, focusedElementKeyAtom, () => null)
      return { value: undefined }
    }

    return next(e)
  })

  // A question armed for the prompt takes the next message the person sends there, with its context.
  on('prompt.submit', async ($, e, next) => {
    const armedQuestion = await read($, armedQuestionAtom)
    const isThePersonsMessage = PERSON_PROMPT_ORIGINS.includes(String(e.origin.kind))
    const question = e.text.trim()
    if (armedQuestion === null || !isThePersonsMessage || question === '' || question.startsWith('/')) {
      return next(e)
    }
    await update($, armedQuestionAtom, () => null)
    if (armedQuestion.threadId) {
      await appendExchange($, armedQuestion.threadId, question)
      await update($, threadIdAwaitingTurnAtom, () => armedQuestion.threadId ?? null)
    } else {
      const thread = newThread(`${armedQuestion.anchorKey}-${await $.clock.now()}`, armedQuestion.anchorKey, armedQuestion.anchorDescription, question)
      await update($, threadsAtom, threads => [...threads, thread])
      await saveThreads($)
      await update($, threadIdAwaitingTurnAtom, () => thread.id)
      await update($, followedThreadIdAtom, () => thread.id)
    }
    return next({ ...e, context: [...(e.context ?? []), armedQuestion.context] })
  })

  on('ui.message', { element: DIVIDER_KEY }, async ($, e, next) => {
    const message = e.data as { phase?: string; movedColumns?: number }
    if (message.phase === 'start') {
      lastDrawnLayout.fileListWidthAtDragStart = lastDrawnLayout.fileListWidth
    } else if (message.phase === 'end' && typeof message.movedColumns === 'number') {
      const fileListWidth = clampFileListWidth(
        lastDrawnLayout.fileListWidthAtDragStart + message.movedColumns,
        lastDrawnLayout.bodyColumns,
      )
      await update($, fileListWidthAtom, () => fileListWidth)
      await $.store.set(FILE_LIST_WIDTH_STORE_KEY, fileListWidth).catch(() => undefined)
    }

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, threadsAtom, threads => threads.map(thread => ({ ...thread, isContextCleared: true })))
      await saveThreads($)
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const threadIdAwaitingTurn = await read($, threadIdAwaitingTurnAtom)
    if (threadIdAwaitingTurn !== null) {
      await update($, threadIdByTurnIdAtom, threadIdByTurnId => ({ ...threadIdByTurnId, [e.turnId]: threadIdAwaitingTurn }))
      await update($, threadIdAwaitingTurnAtom, () => null)
    }

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    let isFirstTextOfStep = true
    for await (const chunk of next(e)) {
      if (chunk.kind === 'text' && e.agentId === undefined) {
        await appendToThreadOfTurn($, e.turnId, chunk.text, isFirstTextOfStep)
        isFirstTextOfStep = false
      }
      yield chunk
    }
  })

  on('turn.complete', async ($, e, next) => {
    const threadId = (await read($, threadIdByTurnIdAtom))[e.turnId]
    if (threadId !== undefined && e.agentId === undefined) {
      await update($, threadsAtom, threads =>
        threads.map(thread =>
          thread.id === threadId
            ? withLastExchange(thread, exchange => ({
                ...exchange,
                answer: exchange.answer.trim() === '' ? e.answer : exchange.answer,
                status: 'done',
              }))
            : thread,
        ),
      )
      await saveThreads($)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>The review explorer needs the terminal or Desktop.</Text>
    }
    const elements = $.ui.resolve(e)
    const ui: ViewElements = {
      ...elements,
      // The terminal's table may name Svg too, but only the Desktop draws it.
      Svg: e.surface === 'desktop' && 'Svg' in elements ? elements.Svg : undefined,
      theme: themeOf(options.theme, await read($, claudeCodeThemeAtom)),
    }
    if (e.props.bodyColumns < MIN_PANE_COLUMNS) {
      return renderNarrowPane(ui, e.props.bodyColumns)
    }
    const model = buildPaneModel(
      await readExplorerSnapshot($),
      {
        bodyRows: e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 40,
        bodyColumns: e.props.bodyColumns,
        isPaneFocused: e.props.isFocused,
      },
      explorerActions($),
    )
    Object.assign(lastDrawnLayout, {
      isTwoColumns: model.geometry.isTwoColumns,
      isFileDrawerOpen: model.geometry.isFileDrawerOpen,
      panelsTop: model.geometry.panelsTop,
      bodyColumns: e.props.bodyColumns,
      fileListWidth: model.geometry.fileListWidth,
      fileListBoxHeight: model.geometry.fileListBoxHeight,
      visibleFileLines: model.geometry.visibleFileLines,
      fileLineCount: model.fileLineCount,
      fileLineIndexByPath: model.fileLineIndexByPath,
      visibleDiffRows: model.geometry.visibleDiffRows,
      scrolledRowCount: model.scrolledRowCount,
      isOverviewShown: model.isOverviewShown,
      isSplitView: model.isSplitView,
      cursorRowIndex: model.cursorRowIndex,
      isScrollingPastEnd: model.isScrollingPastEnd,
      diffRowHeights: model.diffRowHeights,
      commitPanelRows: model.geometry.commitPanelRows,
      panelsHeight: model.geometry.panelsHeight,
      firstShownCommitLineIndex: model.geometry.firstShownCommitLineIndex,
      commitLineCount: model.commitLineCount,
    })

    const { followPosition } = model
    const selectedFilePath = await read($, selectedFilePathAtom)
    if (followPosition !== null && selectedFilePath !== null) {
      // A drawing may not write: the move comes right after it, and the pane is drawn again at the new place.
      await $.clock.after(0, async () => {
        await update($, diffOffsetAtom, () => followPosition.rowIndex)
        await update($, diffSkippedLinesAtom, () => ({ path: selectedFilePath, rowIndex: followPosition.rowIndex, lines: followPosition.skippedLines }))
      })
    }

    return renderPane(ui, model.paneInput)
  })
}
