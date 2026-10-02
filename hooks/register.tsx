import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register } from 'claude-code'

import type { ChangedFile, DiffRow, KeyboardLayout, ReviewThread, ReviewView, ThreadExchange, ViewedState } from '../types'
import {
  countViewedFiles,
  MARK_FILE_AS_VIEWED_MUTATION,
  parseEmojiCharacters,
  parsePullRequest,
  PULL_REQUEST_VIEW_FIELDS,
  splitMarkdownBlocks,
  parseViewedStatesPage,
  UNMARK_FILE_AS_VIEWED_MUTATION,
  VIEWED_MARKS,
  VIEWED_STATES_QUERY,
} from './github-review'
import {
  anchorKeyOf,
  describeLineForPrompt,
  diffRangeArguments,
  fileNameOf,
  fileTypeBadgeOf,
  formatRowsAsDiff,
  groupFilesByDirectory,
  LOG_FORMAT,
  parseCommitLog,
  parseNumstat,
  parseUnifiedDiff,
  parseUntrackedFiles,
  surroundingRows,
} from './git-parsing'

const viewAtom = atom({ plugin: 'diff-review', key: 'view' } as const, 'uncommitted')
const baseRefAtom = atom({ plugin: 'diff-review', key: 'baseRef' } as const, null)
const commitsAtom = atom({ plugin: 'diff-review', key: 'commits' } as const, [])
const selectedCommitShaAtom = atom({ plugin: 'diff-review', key: 'selectedCommitSha' } as const, null)
const filesAtom = atom({ plugin: 'diff-review', key: 'files' } as const, [])
const selectedFilePathAtom = atom({ plugin: 'diff-review', key: 'selectedFilePath' } as const, null)
const diffRowsAtom = atom({ plugin: 'diff-review', key: 'diffRows' } as const, [])
const loadErrorAtom = atom({ plugin: 'diff-review', key: 'loadError' } as const, null)
const threadsAtom = atom({ plugin: 'diff-review', key: 'threads' } as const, [])
const anchorWithOpenInputAtom = atom({ plugin: 'diff-review', key: 'anchorWithOpenInput' } as const, null)
const threadIdByTurnIdAtom = atom({ plugin: 'diff-review', key: 'threadIdByTurnId' } as const, {})
const threadIdAwaitingTurnAtom = atom({ plugin: 'diff-review', key: 'threadIdAwaitingTurn' } as const, null)
const questionDraftAtom = atom({ plugin: 'diff-review', key: 'questionDraft' } as const, '')
const hasQuestionHadKeyboardAtom = atom({ plugin: 'diff-review', key: 'hasQuestionHadKeyboard' } as const, false)
const focusedElementKeyAtom = atom({ plugin: 'diff-review', key: 'focusedElementKey' } as const, null)
const fileListOffsetAtom = atom({ plugin: 'diff-review', key: 'fileListOffset' } as const, 0)
const diffOffsetAtom = atom({ plugin: 'diff-review', key: 'diffOffset' } as const, 0)
const isOverviewShownAtom = atom({ plugin: 'diff-review', key: 'isOverviewShown' } as const, true)
const isLoadingAtom = atom({ plugin: 'diff-review', key: 'isLoading' } as const, false)
const repositoryRootAtom = atom({ plugin: 'diff-review', key: 'repositoryRoot' } as const, null)
const markedPathsAtom = atom({ plugin: 'diff-review', key: 'markedPaths' } as const, [])
const questionFieldNumberAtom = atom({ plugin: 'diff-review', key: 'questionFieldNumber' } as const, 0)
const keyboardLayoutAtom = atom({ plugin: 'diff-review', key: 'keyboardLayout' } as const, 'unknown')
const pullRequestAtom = atom({ plugin: 'diff-review', key: 'pullRequest' } as const, null)
const viewedStateByPathAtom = atom({ plugin: 'diff-review', key: 'viewedStateByPath' } as const, {})

const PANE_ID = 'diff-review'
// Each opened question gets a field of its own key: reusing one key would hand the keyboard to the field still on
// screen for the previous line, which disappears right after.
const QUESTION_INPUT_KEY_PREFIX = 'question-'
const QUESTION_FOCUS_RETRY_MS = 120
const CANCEL_QUESTION_KEY = 'cancel-question'
const ASK_BUTTON_KEY_PREFIX = 'ask-'
const DISMISS_THREAD_KEY_PREFIX = 'dismiss-'
// The line numbers open a question too: a target as wide as the gutter instead of the small [+].
const LINE_NUMBER_BUTTON_KEY_PREFIX = 'line-'
const END_OF_LINE_ASK_BUTTON_KEY_PREFIX = 'ask-end-'
const REPLY_INPUT_KEY_PREFIX = 'reply-'
// The transcript and the prompt keep the left third, the review takes the rest.
const PANE_SHARE_OF_TERMINAL = 2 / 3
const TWO_COLUMNS_MIN_WIDTH = 120
const FILE_LIST_WIDTH = 50
const MAX_DRAWN_DIFF_ROWS = 1500
const CONTEXT_RADIUS_ROWS = 6
const BASE_REF_CANDIDATES = ['origin/main', 'origin/master', 'origin/develop', 'main', 'master']

const VIEW_LABELS: Record<ReviewView, string> = { uncommitted: 'Uncommitted', pr: 'PR', commits: 'Commits' }
const VIEW_HOTKEYS: Record<ReviewView, string> = { uncommitted: '1', pr: '2', commits: '3' }
const THEME = {
  paneBackground: '#16181d',
  border: '#3b4048',
  accent: '#61afef',
  activeTabBackground: '#1f2a38',
  selectedBackground: '#243042',
  fileHeaderBackground: '#21252b',
  hunkBackground: '#1b2533',
  hunk: '#56b6c2',
  heading: '#e6e6e6',
  text: '#c8ccd4',
  muted: '#7f848e',
  directory: '#d19a66',
  commitSha: '#e5c07b',
  lineNumber: '#5c6370',
  added: '#98c379',
  removed: '#e06c75',
} as const
const ROW_MARKS = { hunk: '@@', context: ' ', added: '+', removed: '-' } as const
const ROW_COLORS = { hunk: THEME.hunk, context: THEME.muted, added: THEME.added, removed: THEME.removed } as const
const ROW_BACKGROUNDS = { hunk: undefined, context: undefined, added: '#1a2e1f', removed: '#3a1d21' } as const


// The geometry of the last drawing, kept so a wheel tick can tell the file list from the diff and clamp its scrolling.
const paneLayout = {
  isTwoColumns: true,
  panelsTop: 0,
  fileListBoxHeight: 0,
  visibleFileLines: 1,
  fileLineCount: 0,
  fileLineIndexByPath: {} as Record<string, number>,
  visibleDiffRows: 1,
  diffRowCount: 0,
  isOverviewShown: false,
}
const WHEEL_TICK_ROWS = 3
const COMMIT_PANEL_MAX_COMMITS = 6

function clampOffset(offset: number, itemCount: number, visibleCount: number): number {
  return Math.max(0, Math.min(offset, itemCount - visibleCount))
}

async function runGit($: EngineInterface, gitArguments: string[]): Promise<{ isSuccess: boolean; output: string }> {
  const repositoryRoot = await read($, repositoryRootAtom)
  try {
    const { exitCode, stdout, stderr } = await $.process.run(
      ['git', ...(repositoryRoot ? ['-C', repositoryRoot] : []), ...gitArguments],
      { timeoutMs: 15000 },
    )

    return { isSuccess: exitCode === 0, output: exitCode === 0 ? stdout : stderr }
  } catch (error) {
    return { isSuccess: false, output: String(error) }
  }
}

async function runGh($: EngineInterface, ghArguments: string[]): Promise<{ isSuccess: boolean; output: string }> {
  const repositoryRoot = await read($, repositoryRootAtom)
  try {
    const { exitCode, stdout, stderr } = await $.process.run(['gh', ...ghArguments], {
      ...(repositoryRoot ? { cwd: repositoryRoot } : {}),
      timeoutMs: 20000,
    })

    return { isSuccess: exitCode === 0, output: exitCode === 0 ? stdout : stderr }
  } catch (error) {
    return { isSuccess: false, output: String(error) }
  }
}

const EMOJI_STORE_KEY = 'githubEmojiCharacters'
const EMOJI_CACHE_DURATION_MS = 7 * 24 * 3600 * 1000

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
async function loadPullRequestReview($: EngineInterface): Promise<void> {
  const pullRequestView = await runGh($, ['pr', 'view', '--json', PULL_REQUEST_VIEW_FIELDS])
  const pullRequest = pullRequestView.isSuccess
    ? parsePullRequest(pullRequestView.output, await loadEmojiCharacters($))
    : null
  await update($, pullRequestAtom, () => pullRequest)
  if (pullRequest === null) {
    await update($, viewedStateByPathAtom, () => ({}))
    return
  }
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
      $.ui.toast(`diff-review: could not read the viewed state from GitHub (${page.output.trim().slice(0, 120)})`)
      break
    }
    const parsedPage = parseViewedStatesPage(page.output)
    Object.assign(viewedStateByPath, parsedPage.viewedStateByPath)
    cursor = parsedPage.nextCursor
  } while (cursor !== null)
  await update($, viewedStateByPathAtom, () => viewedStateByPath)
}

async function toggleViewed($: EngineInterface, path: string): Promise<void> {
  const pullRequest = await read($, pullRequestAtom)
  const previousState = (await read($, viewedStateByPathAtom))[path]
  if (pullRequest === null || previousState === undefined) {
    return
  }
  const isMarkingViewed = previousState !== 'VIEWED'
  const nextState: ViewedState = isMarkingViewed ? 'VIEWED' : 'UNVIEWED'
  await update($, viewedStateByPathAtom, states => ({ ...states, [path]: nextState }))
  const mutation = await runGh($, [
    'api',
    'graphql',
    '-f',
    `query=${isMarkingViewed ? MARK_FILE_AS_VIEWED_MUTATION : UNMARK_FILE_AS_VIEWED_MUTATION}`,
    '-F',
    `pullRequestId=${pullRequest.id}`,
    '-f',
    `path=${path}`,
  ])
  if (!mutation.isSuccess) {
    await update($, viewedStateByPathAtom, states => ({ ...states, [path]: previousState }))
    $.ui.toast(`diff-review: GitHub refused to change the viewed state of ${path}`)
  }
}

// A PR may target another branch than the repository's default one (a release branch such as 2026-09): its own
// target comes first, or the PR view would list the commits of that branch too.
async function findBaseRef($: EngineInterface): Promise<string | null> {
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
      return mergeBase.output.trim()
    }
  }

  return null
}

async function loadSelectedFileDiff($: EngineInterface): Promise<void> {
  const path = await read($, selectedFilePathAtom)
  const file = (await read($, filesAtom)).find(changedFile => changedFile.path === path)
  if (!path || !file) {
    await update($, diffRowsAtom, () => [])
    return
  }
  if (file.isUntracked) {
    let content = ''
    try {
      const repositoryRoot = await read($, repositoryRootAtom)
      content = await $.fs.read(repositoryRoot ? `${repositoryRoot}/${path}` : path)
    } catch (error) {
      await update($, loadErrorAtom, () => `Cannot read ${path}: ${String(error)}`)
    }
    const lines = content.replace(/\n$/, '').split('\n')
    const rows: DiffRow[] = [
      { kind: 'hunk', oldNumber: null, newNumber: null, text: 'new file, untracked' },
      ...lines.map((text, index) => ({ kind: 'added' as const, oldNumber: null, newNumber: index + 1, text })),
    ]
    await update($, diffRowsAtom, () => rows)
    return
  }
  const range = diffRangeArguments(await read($, viewAtom), await read($, baseRefAtom), await read($, selectedCommitShaAtom))
  if (!range) {
    await update($, diffRowsAtom, () => [])
    return
  }
  const diff = await runGit($, ['diff', '--no-color', '--no-renames', '-U3', ...range, '--', path])
  await update($, diffRowsAtom, () => (diff.isSuccess ? parseUnifiedDiff(diff.output) : []))
  if (!diff.isSuccess) {
    await update($, loadErrorAtom, () => diff.output.trim())
  }
}

async function loadView($: EngineInterface): Promise<void> {
  await update($, loadErrorAtom, () => null)
  const topLevel = await runGit($, ['rev-parse', '--show-toplevel'])
  if (!topLevel.isSuccess) {
    await update($, loadErrorAtom, () => 'Not a git repository.')
    return
  }
  await update($, repositoryRootAtom, () => topLevel.output.trim())
  const view = await read($, viewAtom)
  const baseRef = await findBaseRef($)
  await update($, baseRefAtom, () => baseRef)

  if (view === 'commits') {
    const log = baseRef ? await runGit($, ['log', `--format=${LOG_FORMAT}`, `${baseRef}..HEAD`]) : null
    const commits = log?.isSuccess ? parseCommitLog(log.output) : []
    await update($, commitsAtom, () => commits)
    const selectedCommitSha = await read($, selectedCommitShaAtom)
    if (!commits.some(commit => commit.sha === selectedCommitSha)) {
      await update($, selectedCommitShaAtom, () => commits[0]?.sha ?? null)
    }
  }

  const range = diffRangeArguments(view, baseRef, await read($, selectedCommitShaAtom))
  let files: ChangedFile[] = []
  if (range) {
    const numstat = await runGit($, ['diff', '--numstat', '--no-renames', ...range])
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
  await update($, filesAtom, () => files)
  const selectedFilePath = await read($, selectedFilePathAtom)
  if (!files.some(file => file.path === selectedFilePath)) {
    await update($, selectedFilePathAtom, () => groupFilesByDirectory(files)[0]?.files[0]?.path ?? null)
  }
  await loadSelectedFileDiff($)
}

// The field's autoFocus only counts when the pane takes the keyboard; a field opened later, by a click on a line, is
// handed the keyboard explicitly, once the next drawing has it on screen.
async function openQuestion($: EngineInterface, anchorKey: string): Promise<void> {
  await update($, questionDraftAtom, () => '')
  await update($, hasQuestionHadKeyboardAtom, () => false)
  const questionFieldNumber = await update($, questionFieldNumberAtom, fieldNumber => fieldNumber + 1)
  await update($, anchorWithOpenInputAtom, () => anchorKey)
  await focusQuestionField($, questionFieldNumber, true)
  // A click while another field held the keyboard moves the focus onto the clicked button once this press is handled,
  // taking it back from the new field: the keyboard is asked for again just after.
  await $.clock.after(QUESTION_FOCUS_RETRY_MS, () => focusQuestionField($, questionFieldNumber, false))
}

async function focusQuestionField($: EngineInterface, questionFieldNumber: number, isReportingRefusal: boolean): Promise<void> {
  const isStillWaitingForKeyboard =
    (await read($, questionFieldNumberAtom)) === questionFieldNumber &&
    (await read($, anchorWithOpenInputAtom)) !== null &&
    !(await read($, hasQuestionHadKeyboardAtom))
  if (!isStillWaitingForKeyboard) {
    return
  }
  const focusResult = await $.ui
    .focus({ requestId: PANE_ID, key: `${QUESTION_INPUT_KEY_PREFIX}${questionFieldNumber}` })
    .catch((error: unknown) => ({ deny: String(error) }))
  if (focusResult.deny && isReportingRefusal) {
    $.ui.toast(`diff-review: the question field did not get the keyboard (${focusResult.deny})`)
  }
}

async function closeQuestion($: EngineInterface): Promise<void> {
  await update($, focusedElementKeyAtom, focusedElementKey => (focusedElementKey?.startsWith(QUESTION_INPUT_KEY_PREFIX) ? null : focusedElementKey))
  await update($, questionDraftAtom, () => '')
  await update($, hasQuestionHadKeyboardAtom, () => false)
  await update($, anchorWithOpenInputAtom, () => null)
}

async function switchView($: EngineInterface, view: ReviewView): Promise<void> {
  await update($, viewAtom, () => view)
  await update($, markedPathsAtom, () => [])
  await update($, fileListOffsetAtom, () => 0)
  await update($, diffOffsetAtom, () => 0)
  await update($, isOverviewShownAtom, () => true)
  await closeQuestion($)
  await loadView($)
  if (view === 'pr') {
    await loadPullRequestReview($)
  }
}

// Up, left, down and right sit on z q s d on an AZERTY keyboard and on w a s d on a QWERTY one. A layout that could
// not be read keeps both bound.
const NAVIGATION_HOTKEYS: Record<KeyboardLayout, Record<'previousFile' | 'nextFile' | 'previousView' | 'nextView', string[]>> = {
  azerty: { previousFile: ['z'], nextFile: ['s'], previousView: ['q'], nextView: ['d'] },
  qwerty: { previousFile: ['w'], nextFile: ['s'], previousView: ['a'], nextView: ['d'] },
  unknown: { previousFile: ['z', 'w'], nextFile: ['s'], previousView: ['q', 'a'], nextView: ['d'] },
}
const AZERTY_LAYOUT_CODES = ['fr', 'be']

async function detectKeyboardLayout($: EngineInterface): Promise<KeyboardLayout> {
  const layoutSources: Array<{ argv: string[]; layoutPattern: RegExp }> = [
    { argv: ['gsettings', 'get', 'org.gnome.desktop.input-sources', 'sources'], layoutPattern: /\('xkb', '([a-z]+)/ },
    { argv: ['setxkbmap', '-query'], layoutPattern: /layout:\s*([a-z]+)/ },
  ]
  for (const layoutSource of layoutSources) {
    try {
      const { exitCode, stdout } = await $.process.run(layoutSource.argv, { timeoutMs: 3000 })
      const layoutCode = exitCode === 0 ? stdout.match(layoutSource.layoutPattern)?.[1] : undefined
      if (layoutCode) {
        return AZERTY_LAYOUT_CODES.includes(layoutCode) ? 'azerty' : 'qwerty'
      }
    } catch {
      continue
    }
  }

  return 'unknown'
}
const OVERVIEW_ENTRY = '\u0000overview'
const VIEW_ORDER: readonly ReviewView[] = ['uncommitted', 'pr', 'commits']

// In the PR view the overview stands first, before the files.
async function selectAdjacentFile($: EngineInterface, offset: number): Promise<void> {
  const hasOverview = (await read($, viewAtom)) === 'pr' && (await read($, pullRequestAtom)) !== null
  const filePaths = groupFilesByDirectory(await read($, filesAtom)).flatMap(group => group.files.map(file => file.path))
  const orderedEntries = hasOverview ? [OVERVIEW_ENTRY, ...filePaths] : filePaths
  const currentEntry =
    hasOverview && (await read($, isOverviewShownAtom)) ? OVERVIEW_ENTRY : ((await read($, selectedFilePathAtom)) ?? '')
  const targetEntry =
    orderedEntries[Math.min(orderedEntries.length - 1, Math.max(0, orderedEntries.indexOf(currentEntry) + offset))]
  if (targetEntry === OVERVIEW_ENTRY) {
    await showOverview($)
  } else if (targetEntry !== undefined) {
    await selectFile($, targetEntry)
  }
}

async function switchAdjacentView($: EngineInterface, offset: number): Promise<void> {
  const currentIndex = VIEW_ORDER.indexOf(await read($, viewAtom))
  const targetView = VIEW_ORDER[Math.min(VIEW_ORDER.length - 1, Math.max(0, currentIndex + offset))]
  if (targetView !== undefined && targetView !== (await read($, viewAtom))) {
    await switchView($, targetView)
  }
}

async function untrackedPathsOf($: EngineInterface): Promise<string[]> {
  return (await read($, filesAtom)).filter(file => file.isUntracked).map(file => file.path)
}

async function toggleMarkedPath($: EngineInterface, path: string): Promise<void> {
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
    await toggleMarkedPath($, selectedFilePath)
  }
}

async function markAllUntrackedFiles($: EngineInterface): Promise<void> {
  const untrackedPaths = await untrackedPathsOf($)
  await update($, markedPathsAtom, markedPaths => (markedPaths.length === untrackedPaths.length ? [] : untrackedPaths))
}

// Stages the marked new files, or the current one when it is new and nothing is marked.
async function stageMarkedFiles($: EngineInterface): Promise<void> {
  const untrackedPaths = await untrackedPathsOf($)
  const markedPaths = (await read($, markedPathsAtom)).filter(path => untrackedPaths.includes(path))
  const selectedFilePath = await read($, selectedFilePathAtom)
  const pathsToStage =
    markedPaths.length > 0 ? markedPaths : selectedFilePath && untrackedPaths.includes(selectedFilePath) ? [selectedFilePath] : []
  if (pathsToStage.length === 0) {
    $.ui.toast('diff-review: no new file marked or selected to add')
    return
  }
  const gitAdd = await runGit($, ['add', '--', ...pathsToStage])
  if (!gitAdd.isSuccess) {
    $.ui.toast(`diff-review: git add failed (${gitAdd.output.trim().slice(0, 120)})`)
    return
  }
  await update($, markedPathsAtom, () => [])
  $.ui.toast(`diff-review: ${pathsToStage.length} file${pathsToStage.length > 1 ? 's' : ''} added to the index`)
  await loadView($)
}

// Everything the Uncommitted view lists goes to the index: modified, deleted and new files alike.
async function stageAllChanges($: EngineInterface): Promise<void> {
  const gitAdd = await runGit($, ['add', '--all'])
  if (!gitAdd.isSuccess) {
    $.ui.toast(`diff-review: git add --all failed (${gitAdd.output.trim().slice(0, 120)})`)
    return
  }
  await update($, markedPathsAtom, () => [])
  $.ui.toast('diff-review: every change added to the index')
  await loadView($)
}

async function refreshExplorer($: EngineInterface): Promise<void> {
  await update($, isLoadingAtom, () => true)
  await loadPullRequestReview($)
  await loadView($)
  await update($, isLoadingAtom, () => false)
}

async function selectCommit($: EngineInterface, commitSha: string): Promise<void> {
  await update($, selectedCommitShaAtom, () => commitSha)
  await loadView($)
}

async function showOverview($: EngineInterface): Promise<void> {
  await update($, isOverviewShownAtom, () => true)
  await update($, diffOffsetAtom, () => 0)
  await update($, fileListOffsetAtom, () => 0)
  await closeQuestion($)
}

async function selectFile($: EngineInterface, path: string): Promise<void> {
  await update($, isOverviewShownAtom, () => false)
  await update($, selectedFilePathAtom, () => path)
  await update($, diffOffsetAtom, () => 0)
  const fileLineIndex = paneLayout.fileLineIndexByPath[path]
  if (fileLineIndex !== undefined) {
    await update($, fileListOffsetAtom, offset => {
      if (fileLineIndex < offset) {
        return fileLineIndex
      }
      return fileLineIndex >= offset + paneLayout.visibleFileLines ? fileLineIndex - paneLayout.visibleFileLines + 1 : offset
    })
  }
  await closeQuestion($)
  await loadSelectedFileDiff($)
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

async function sendToConversation($: EngineInterface, threadId: string, question: string, context: string): Promise<void> {
  await update($, threadIdAwaitingTurnAtom, () => threadId)
  // The location and its surroundings go in as a row only the model reads, so the transcript shows the question alone.
  try {
    await $.session.append({ message: { type: 'user', content: [{ type: 'text', text: context }] } })
  } catch (error) {
    $.ui.toast(`diff-review: the context of the question was not sent (${String(error)})`)
  }
  await $.prompt.submit({ text: question })
}

async function submitQuestion(
  $: EngineInterface,
  anchorKey: string,
  anchorDescription: string,
  question: string,
  context: string,
): Promise<void> {
  const thread: ReviewThread = {
    id: `${anchorKey}-${await $.clock.now()}`,
    anchorKey,
    anchorDescription,
    exchanges: [{ question, answer: '', status: 'queued' }],
    isContextCleared: false,
  }
  await update($, threadsAtom, threads => [...threads, thread])
  await closeQuestion($)
  await sendToConversation($, thread.id, question, context)
}

// A reply stays in the conversation the thread already lives in, so only the thread's anchor is restated. After a
// /clear the conversation no longer holds the thread: its earlier exchanges are sent again.
async function replyInThread($: EngineInterface, threadId: string, reply: string): Promise<void> {
  const trimmedReply = reply.trim()
  const thread = (await read($, threadsAtom)).map(normalizeThread).find(candidate => candidate.id === threadId)
  if (trimmedReply === '' || thread === undefined) {
    return
  }
  const earlierExchanges = thread.isContextCleared
    ? [
        'The conversation was cleared since; the thread so far:',
        ...thread.exchanges.flatMap(exchange => [`Question: ${exchange.question}`, `Your answer: ${exchange.answer}`]),
      ]
    : [`It started with the question: "${thread.exchanges[0]?.question ?? ''}".`]
  const replyContext = [
    `The person follows up in the review thread about ${thread.anchorDescription}.`,
    ...earlierExchanges,
    'Their follow-up follows. The answer is drawn in that thread in the pane: keep it focused on it.',
  ].join('\n')
  const exchange: ThreadExchange = { question: trimmedReply, answer: '', status: 'queued' }
  await update($, threadsAtom, threads =>
    threads.map(candidate =>
      candidate.id === threadId
        ? { ...candidate, exchanges: [...candidate.exchanges, exchange], isContextCleared: false }
        : candidate,
    ),
  )
  await sendToConversation($, threadId, trimmedReply, replyContext)
}

async function askAboutRow($: EngineInterface, anchorKey: string, rowIndex: number, question: string): Promise<void> {
  const trimmedQuestion = question.trim()
  const path = await read($, selectedFilePathAtom)
  const rows = await read($, diffRowsAtom)
  const row = rows[rowIndex]
  if (trimmedQuestion === '' || !path || !row) {
    return
  }
  const lineContext = [
    `The person is reviewing ${await describeViewForPrompt($)} in a review pane and asks about one line: ${describeLineForPrompt(path, row)}.`,
    `Repository: ${await read($, repositoryRootAtom)}. The line and the diff around it:`,
    '```diff',
    formatRowsAsDiff(surroundingRows(rows, rowIndex, CONTEXT_RADIUS_ROWS)),
    '```',
    'Their question follows. The answer is drawn under that line in the pane: keep it focused on it.',
  ].join('\n')
  await submitQuestion($, anchorKey, `${describeLineForPrompt(path, row)} in ${await describeViewForPrompt($)}`, trimmedQuestion, lineContext)
}

async function askAboutOverviewBlock($: EngineInterface, anchorKey: string, blockIndex: number, question: string): Promise<void> {
  const trimmedQuestion = question.trim()
  const pullRequest = await read($, pullRequestAtom)
  const block = pullRequest ? splitMarkdownBlocks(pullRequest.overviewMarkdown)[blockIndex] : undefined
  if (trimmedQuestion === '' || !pullRequest || block === undefined) {
    return
  }
  const blockContext = [
    `The person is reviewing pull request ${pullRequest.overviewHeadline} (${pullRequest.url}) in a review pane, and asks about this part of its description or conversation:`,
    '````markdown',
    block,
    '````',
    `Repository: ${await read($, repositoryRootAtom)}. Their question follows. The answer is drawn under that part in the pane: keep it focused on it.`,
  ].join('\n')
  const anchorDescription = `this part of pull request ${pullRequest.overviewHeadline}: "${block.slice(0, 120)}"`
  await submitQuestion($, anchorKey, anchorDescription, trimmedQuestion, blockContext)
}

// The answer keeps arriving into a thread dismissed mid-turn: it is simply no longer drawn, and the transcript still holds it.
async function dismissThread($: EngineInterface, threadId: string): Promise<void> {
  await update($, threadsAtom, threads => threads.filter(thread => thread.id !== threadId))
}

// Threads made before they held several exchanges carry a single question and answer: the session keeps them across
// reloads, so they are brought to the current shape when read.
function normalizeThread(thread: ReviewThread): ReviewThread {
  if (Array.isArray(thread.exchanges)) {
    return thread
  }
  const legacyThread = thread as unknown as { question?: string; answer?: string; status?: ThreadExchange['status'] }

  return {
    ...thread,
    anchorDescription: thread.anchorDescription ?? 'an earlier question in the review pane',
    exchanges: [{ question: legacyThread.question ?? '', answer: legacyThread.answer ?? '', status: legacyThread.status ?? 'done' }],
    isContextCleared: thread.isContextCleared ?? false,
  }
}

function withLastExchange(thread: ReviewThread, change: (exchange: ThreadExchange) => ThreadExchange): ReviewThread {
  const normalizedThread = normalizeThread(thread)
  const lastIndex = normalizedThread.exchanges.length - 1

  return { ...normalizedThread, exchanges: normalizedThread.exchanges.map((exchange, index) => (index === lastIndex ? change(exchange) : exchange)) }
}

async function appendToThreadOfTurn($: EngineInterface, turnId: string, text: string): Promise<void> {
  const threadId = (await read($, threadIdByTurnIdAtom))[turnId]
  if (threadId === undefined) {
    return
  }
  await update($, threadsAtom, threads =>
    threads.map(thread =>
      thread.id === threadId ? withLastExchange(thread, exchange => ({ ...exchange, answer: exchange.answer + text, status: 'answering' })) : thread,
    ),
  )
}

function renderNavigationHint(
  elements: Pick<Elements['terminal'], 'Box' | 'Button'>,
  arrow: string,
  hotkeys: readonly string[],
  move: () => Promise<void>,
  isTyping: boolean,
) {
  const { Box, Button } = elements

  return (
    <Box flexDirection="row" marginRight={2}>
      {hotkeys.map(hotkey => (
        <Box marginRight={1}>
          <Button key={`navigate-${hotkey}`} plain hotkey={isTyping ? undefined : hotkey} label={isTyping ? `${hotkey}: ${arrow}` : arrow} onPress={move} />
        </Box>
      ))}
    </Box>
  )
}

function renderFileStats(Text: Elements['terminal']['Text'], file: ChangedFile) {
  if (file.isUntracked) {
    return <Text color={THEME.added}>new</Text>
  }
  if (file.addedLines === null) {
    return <Text color={THEME.muted}>binary</Text>
  }

  return (
    <Text>
      <Text color={THEME.added}>+{file.addedLines}</Text> <Text color={THEME.removed}>-{file.removedLines ?? 0}</Text>
    </Text>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await update($, threadsAtom, threads => threads.map(normalizeThread))
    const keyboardLayout = await detectKeyboardLayout($)
    await update($, keyboardLayoutAtom, () => keyboardLayout)
    await $.command.register({ name: 'diff-review', description: 'Open the review explorer: uncommitted changes, the PR, or commit by commit' })

    return next(e)
  })

  on('command.run', { command: 'diff-review' }, async ($, e) => {
    await closeQuestion($)
    await update($, selectedFilePathAtom, () => null)
    await update($, isOverviewShownAtom, () => true)
    await update($, isLoadingAtom, () => true)
    const opened = await $.ui.open({
      id: PANE_ID,
      title: 'Review',
      focus: true,
      closeOnEscape: true,
      columns: Math.round(e.presentation.columns * PANE_SHARE_OF_TERMINAL),
    })
    await refreshExplorer($)

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

  // The pane is drawn to its exact height so the engine never scrolls it: the wheel moves the file list when the pointer
  // is over it and the diff everywhere else, page keys move the diff, and the tabs stay put.
  on('ui.scroll', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const pointer = e.pointer
    const isOverFileList =
      pointer !== undefined &&
      pointer.row >= paneLayout.panelsTop &&
      (paneLayout.isTwoColumns
        ? pointer.column < FILE_LIST_WIDTH
        : pointer.row < paneLayout.panelsTop + paneLayout.fileListBoxHeight)
    const isWheelTick = pointer !== undefined
    if (isOverFileList) {
      await update($, fileListOffsetAtom, offset =>
        clampOffset(offset + e.by * WHEEL_TICK_ROWS, paneLayout.fileLineCount, paneLayout.visibleFileLines),
      )
    } else {
      const rowsPerTick = paneLayout.isOverviewShown ? 1 : WHEEL_TICK_ROWS
      const pageRows = paneLayout.isOverviewShown ? 3 : paneLayout.visibleDiffRows
      const rowsToMove = isWheelTick ? e.by * rowsPerTick : Math.sign(e.by) * Math.min(Math.abs(e.by), pageRows)
      const visibleForClamp = paneLayout.isOverviewShown ? 1 : paneLayout.visibleDiffRows
      await update($, diffOffsetAtom, offset => clampOffset(offset + rowsToMove, paneLayout.diffRowCount, visibleForClamp))
    }

    return {}
  })

  // Moving to another element of the pane, by Tab or a click, closes a question left empty. Landing on a [+],
  // the question itself or its close button is part of opening or closing it, and closes nothing.
  on('ui.focus', { component: 'Pane', requestId: PANE_ID }, async ($, e, next) => {
    const element = e.element ?? ''
    const isMovingOntoLineButton = element.startsWith(ASK_BUTTON_KEY_PREFIX) || element.startsWith(LINE_NUMBER_BUTTON_KEY_PREFIX)
    if (
      isMovingOntoLineButton &&
      (await read($, anchorWithOpenInputAtom)) !== null &&
      !(await read($, hasQuestionHadKeyboardAtom))
    ) {
      // The question just opened from that button waits for the keyboard: the focus goes to its field instead.
      const questionFieldKey = `${QUESTION_INPUT_KEY_PREFIX}${await read($, questionFieldNumberAtom)}`
      const redirected = await next({ ...e, element: questionFieldKey })
      if (!('deny' in redirected) || redirected.deny === undefined) {
        await update($, focusedElementKeyAtom, () => questionFieldKey)
        await update($, hasQuestionHadKeyboardAtom, () => true)
      }

      return redirected
    }
    await update($, focusedElementKeyAtom, () => e.element ?? null)
    if (element.startsWith(QUESTION_INPUT_KEY_PREFIX)) {
      await update($, hasQuestionHadKeyboardAtom, () => true)
    } else if (
      !element.startsWith(ASK_BUTTON_KEY_PREFIX) &&
      !element.startsWith(LINE_NUMBER_BUTTON_KEY_PREFIX) &&
      element !== CANCEL_QUESTION_KEY &&
      !element.startsWith(DISMISS_THREAD_KEY_PREFIX) &&
      (await read($, anchorWithOpenInputAtom)) !== null &&
      (await read($, questionDraftAtom)).trim() === ''
    ) {
      await closeQuestion($)
    }

    return next(e)
  })

  // Escape first closes what is open on a line: the question being written, or the thread whose close button has
  // the focus. Only with nothing of that kind left does it close the pane.
  on('ui.close', async ($, e, next) => {
    if (e.id !== PANE_ID || e.origin.kind !== 'person') {
      return next(e)
    }
    if ((await read($, anchorWithOpenInputAtom)) !== null) {
      await closeQuestion($)
      return { value: undefined }
    }
    const focusedElementKey = (await read($, focusedElementKeyAtom)) ?? ''
    if (focusedElementKey.startsWith(REPLY_INPUT_KEY_PREFIX)) {
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

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, threadsAtom, threads => threads.map(thread => ({ ...thread, isContextCleared: true })))
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
    for await (const chunk of next(e)) {
      if (chunk.kind === 'text' && e.agentId === undefined) {
        await appendToThreadOfTurn($, e.turnId, chunk.text)
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
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>The review explorer needs the terminal or Desktop.</Text>
    }
    const { Box, Button, Code, Input, Markdown, Text } = $.ui.resolve(e)
    const view = await read($, viewAtom)
    const baseRef = await read($, baseRefAtom)
    const commits = await read($, commitsAtom)
    const selectedCommitSha = await read($, selectedCommitShaAtom)
    const files = await read($, filesAtom)
    const selectedFilePath = await read($, selectedFilePathAtom)
    const diffRows = await read($, diffRowsAtom)
    const loadError = await read($, loadErrorAtom)
    const threads = (await read($, threadsAtom)).map(normalizeThread)
    const anchorWithOpenInput = await read($, anchorWithOpenInputAtom)
    const questionFieldNumber = await read($, questionFieldNumberAtom)
    // Escape or a click outside gives the keyboard back to the prompt: an empty question that had the keyboard then
    // stops being drawn. One just opened by a click while the prompt still held the keyboard stays.
    const isQuestionShown =
      e.props.isFocused ||
      !(await read($, hasQuestionHadKeyboardAtom)) ||
      (await read($, questionDraftAtom)).trim() !== ''
    const isTwoColumns = e.props.bodyColumns >= TWO_COLUMNS_MIN_WIDTH
    const drawnRows = diffRows.slice(0, MAX_DRAWN_DIFF_ROWS)
    const selectedFile = files.find(file => file.path === selectedFilePath)
    const pullRequest = view === 'pr' ? await read($, pullRequestAtom) : null
    const viewedStateByPath = pullRequest ? await read($, viewedStateByPathAtom) : {}
    const navigationHotkeys = NAVIGATION_HOTKEYS[await read($, keyboardLayoutAtom)]
    // A one-letter shortcut would fire on the letters typed into a question or a reply: none is bound meanwhile.
    const focusedElementKey = (await read($, focusedElementKeyAtom)) ?? ''
    const isTyping =
      focusedElementKey.startsWith(QUESTION_INPUT_KEY_PREFIX) || focusedElementKey.startsWith(REPLY_INPUT_KEY_PREFIX)
    const hotkeyUnlessTyping = (hotkey: string) => (isTyping ? undefined : hotkey)
    const viewedCount = countViewedFiles(files.map(file => file.path), viewedStateByPath)
    const isOverviewShown = pullRequest !== null && (await read($, isOverviewShownAtom))
    const overviewBlocks = isOverviewShown ? splitMarkdownBlocks(pullRequest?.overviewMarkdown ?? '') : []

    const bodyRows = e.props.scroll?.bodyRows ?? e.viewport?.rows ?? 40
    const selectedCommitIndex = Math.max(0, commits.findIndex(commit => commit.sha === selectedCommitSha))
    const firstShownCommitIndex = clampOffset(selectedCommitIndex - 2, commits.length, COMMIT_PANEL_MAX_COMMITS)
    const shownCommits = commits.slice(firstShownCommitIndex, firstShownCommitIndex + COMMIT_PANEL_MAX_COMMITS)
    const commitPanelRows = view === 'commits' ? 2 + 1 + Math.max(1, shownCommits.length) + 1 : 0
    const tabsRows = 3
    const panelsTop = tabsRows + (loadError ? 1 : 0) + commitPanelRows
    const panelsHeight = Math.max(8, bodyRows - panelsTop)

    type FileLine =
      | { kind: 'overview' }
      | { kind: 'spacer' }
      | { kind: 'directory'; directory: string }
      | { kind: 'file'; file: ChangedFile }
    const fileLines: FileLine[] = [
      ...(pullRequest ? [{ kind: 'overview' as const }] : []),
      ...groupFilesByDirectory(files).flatMap(group => [
      { kind: 'spacer' as const },
      { kind: 'directory' as const, directory: group.directory },
        ...group.files.map(file => ({ kind: 'file' as const, file })),
      ]),
    ]
    const markedPaths = view === 'uncommitted' ? await read($, markedPathsAtom) : []
    const hasUntrackedFiles = view === 'uncommitted' && files.some(file => file.isUntracked)
    const hasStageActions = view === 'uncommitted' && files.length > 0
    const fileListChromeRows = 2 + 1 + 2 + (hasStageActions ? 1 : 0)
    const fileListBoxHeight = isTwoColumns
      ? panelsHeight
      : Math.min(fileLines.length + fileListChromeRows, Math.max(fileListChromeRows + 3, Math.floor(panelsHeight / 3)))
    const visibleFileLines = Math.max(1, fileListBoxHeight - fileListChromeRows)
    const fileListOffset = clampOffset(await read($, fileListOffsetAtom), fileLines.length, visibleFileLines)
    const shownFileLines = fileLines.slice(fileListOffset, fileListOffset + visibleFileLines)

    const diffBoxHeight = isTwoColumns ? panelsHeight : Math.max(4, panelsHeight - fileListBoxHeight)
    const visibleDiffRows = Math.max(1, diffBoxHeight - 2 - 1)
    // The overview scrolls by block, each one or several rows tall; the diff by row.
    const scrolledRowCount = isOverviewShown ? overviewBlocks.length : drawnRows.length
    const diffOffset = clampOffset(await read($, diffOffsetAtom), scrolledRowCount, isOverviewShown ? 1 : visibleDiffRows)
    const shownDiffRows = drawnRows.slice(diffOffset, diffOffset + visibleDiffRows)

    Object.assign(paneLayout, {
      isTwoColumns,
      panelsTop,
      fileListBoxHeight,
      visibleFileLines,
      fileLineCount: fileLines.length,
      fileLineIndexByPath: Object.fromEntries(
        fileLines.flatMap((fileLine, index) => (fileLine.kind === 'file' ? [[fileLine.file.path, index]] : [])),
      ),
      visibleDiffRows,
      diffRowCount: scrolledRowCount,
      isOverviewShown,
    })

    const tabs = (
      <Box flexDirection="row" alignItems="center">
        {(['uncommitted', 'pr', 'commits'] as const).map(candidateView => {
          const isActive = candidateView === view
          return (
            <Box
              key={`tab-${candidateView}`}
              borderStyle="round"
              borderColor={isActive ? THEME.accent : THEME.border}
              backgroundColor={isActive ? THEME.activeTabBackground : undefined}
              paddingX={1}
              marginRight={1}
            >
              <Button
                key={`view-${candidateView}`}
                plain
                hotkey={hotkeyUnlessTyping(VIEW_HOTKEYS[candidateView])}
                label={VIEW_LABELS[candidateView]}
                onPress={() => switchView($, candidateView)}
              />
            </Box>
          )
        })}
        <Box flexGrow={1} marginLeft={1}>
          <Text color={THEME.muted} wrap="truncate-start">
            {(await read($, isLoadingAtom)) ? 'loading…  ' : ''}
            {(await read($, repositoryRootAtom)) ?? ''}
            {view !== 'uncommitted' && baseRef ? `  ·  base ${baseRef.slice(0, 10)}` : ''}
          </Text>
        </Box>
        {pullRequest && (
          <Box marginLeft={1}>
            <Text color={THEME.accent} bold>
              PR #{pullRequest.number}
            </Text>
            <Text color={viewedCount.viewed === viewedCount.total ? THEME.added : THEME.muted}>
              {'  '}viewed {viewedCount.viewed}/{viewedCount.total}
            </Text>
          </Box>
        )}
        <Box borderStyle="round" borderColor={THEME.border} paddingX={1} marginLeft={1}>
          <Button key="refresh" plain label="refresh" onPress={() => refreshExplorer($)} />
        </Box>
        <Box borderStyle="round" borderColor={THEME.border} paddingX={1} marginLeft={1}>
          <Button key="close" plain label="close" onPress={() => $.ui.close({ id: PANE_ID })} />
        </Box>
      </Box>
    )

    const commitPanel =
      view === 'commits' ? (
        <Box flexDirection="column" borderStyle="round" borderColor={THEME.border} paddingX={1} marginBottom={1}>
          <Text bold color={THEME.heading}>
            Branch commits <Text color={THEME.muted}>{commits.length}</Text>
          </Text>
          {commits.length === 0 && <Text color={THEME.muted}>No commit since the base.</Text>}
          {shownCommits.map(commit => {
            const isSelected = commit.sha === selectedCommitSha
            return (
              <Box flexDirection="row" backgroundColor={isSelected ? THEME.selectedBackground : undefined}>
                <Text color={isSelected ? THEME.accent : THEME.muted}>{isSelected ? '▌' : ' '}</Text>
                <Text color={THEME.commitSha}>{commit.shortSha} </Text>
                <Button key={`commit-${commit.sha}`} plain label={commit.subject} onPress={() => selectCommit($, commit.sha)} />
                <Text color={THEME.muted}>
                  {'  '}
                  {commit.author}, {commit.relativeDate}
                </Text>
              </Box>
            )
          })}
        </Box>
      ) : null

    const renderThreadsAndQuestion = (anchorKey: string, submit: (question: string) => Promise<void>) => (
      <Box flexDirection="column" flexShrink={0}>
        {threads.filter(thread => thread.anchorKey === anchorKey).map(thread => (
          <Box flexDirection="column" flexShrink={0} marginLeft={16} marginY={1} borderStyle="round" borderColor={THEME.accent} paddingX={1}>
            <Box flexDirection="row" justifyContent="flex-end">
              <Button
                key={`${DISMISS_THREAD_KEY_PREFIX}${thread.id}`}
                label="× close"
                onPress={() => dismissThread($, thread.id)}
              />
            </Box>
            {thread.exchanges.map((exchange, exchangeIndex) => (
              <Box flexDirection="column" flexShrink={0} marginTop={exchangeIndex === 0 ? 0 : 1}>
                <Text color={THEME.accent} bold>
                  {'> '}
                  {exchange.question}
                </Text>
                {exchange.answer === '' ? (
                  <Text color={THEME.muted}>{exchange.status === 'queued' ? 'queued…' : 'Claude is thinking…'}</Text>
                ) : (
                  <Markdown text={exchange.answer} />
                )}
              </Box>
            ))}
            {thread.isContextCleared && (
              <Text color={THEME.muted}>Conversation cleared since: a reply sends this thread again.</Text>
            )}
            {thread.exchanges[thread.exchanges.length - 1]?.status === 'done' && (
              <Box flexDirection="row" flexShrink={0} marginTop={1}>
                <Text color={THEME.muted}>↳ </Text>
                <Box flexGrow={1}>
                  <Input
                    key={`${REPLY_INPUT_KEY_PREFIX}${thread.id}`}
                    placeholder="reply…"
                    onSubmit={value => replyInThread($, thread.id, value)}
                  />
                </Box>
              </Box>
            )}
          </Box>
        ))}
        {anchorWithOpenInput === anchorKey && isQuestionShown && (
          <Box flexDirection="row" flexShrink={0} marginLeft={16} marginY={1} borderStyle="round" borderColor={THEME.accent} paddingX={1}>
            <Box flexGrow={1}>
              <Input
                key={`${QUESTION_INPUT_KEY_PREFIX}${questionFieldNumber}`}
                autoFocus
                onInput={value => update($, questionDraftAtom, () => value)}
                placeholder="Your question about this, Enter to send"
                onSubmit={value => submit(value)}
              />
            </Box>
            <Button key={CANCEL_QUESTION_KEY} label="× cancel" onPress={() => closeQuestion($)} />
          </Box>
        )}
      </Box>
    )

    const filePanel = (
      <Box
        flexDirection="column"
        width={isTwoColumns ? FILE_LIST_WIDTH : undefined}
        height={fileListBoxHeight}
        overflow="hidden"
        borderStyle="round"
        borderColor={THEME.border}
        paddingX={1}
        marginRight={isTwoColumns ? 1 : 0}
      >
        <Box flexDirection="row">
          <Box flexGrow={1}>
            <Text bold color={THEME.heading}>
              Files <Text color={THEME.muted}>{files.length}</Text>
            </Text>
          </Box>
          <Text color={THEME.muted}>
            {fileListOffset > 0 ? '▲' : ' '}
            {fileListOffset + visibleFileLines < fileLines.length ? '▼' : ' '}
          </Text>
        </Box>
        <Box flexDirection="column" height={visibleFileLines} overflow="hidden">
          {files.length === 0 && <Text color={THEME.muted}>Nothing to review in this view.</Text>}
          {shownFileLines.map(fileLine => {
            if (fileLine.kind === 'overview') {
              return (
                <Box flexDirection="row" height={1} backgroundColor={isOverviewShown ? THEME.selectedBackground : undefined}>
                  <Box width={2} flexShrink={0}>
                    <Text color={isOverviewShown ? THEME.accent : THEME.muted}>{isOverviewShown ? '▌' : ' '}</Text>
                  </Box>
                  <Box width={4} flexShrink={0}>
                    <Text color={THEME.accent} bold>
                      ☰
                    </Text>
                  </Box>
                  <Box flexGrow={1} flexShrink={1} height={1} overflow="hidden">
                    <Button key="pr-overview" plain label="Overview" onPress={() => showOverview($)} />
                  </Box>
                  <Box flexShrink={0} marginLeft={1}>
                    <Text>
                      <Text color={THEME.added}>+{pullRequest?.additions ?? 0}</Text>{' '}
                      <Text color={THEME.removed}>-{pullRequest?.deletions ?? 0}</Text>
                    </Text>
                  </Box>
                </Box>
              )
            }
            if (fileLine.kind === 'spacer') {
              return <Text> </Text>
            }
            if (fileLine.kind === 'directory') {
              return (
                <Text color={THEME.directory} wrap="truncate-start">
                  ▾ {fileLine.directory === '' ? './' : `${fileLine.directory}/`}
                </Text>
              )
            }
            const file = fileLine.file
            const isSelected = !isOverviewShown && file.path === selectedFilePath
            const typeBadge = fileTypeBadgeOf(file.path)
            return (
              <Box flexDirection="row" height={1} backgroundColor={isSelected ? THEME.selectedBackground : undefined}>
                <Box width={2} flexShrink={0}>
                  <Text color={isSelected ? THEME.accent : THEME.muted}>{isSelected ? '▌' : ' '}</Text>
                </Box>
                {hasUntrackedFiles && (
                  <Box width={6} flexShrink={0}>
                    {file.isUntracked ? (
                      <Button
                        key={`mark-${file.path}`}
                        label={markedPaths.includes(file.path) ? 'x' : ' '}
                        onPress={() => toggleMarkedPath($, file.path)}
                      />
                    ) : (
                      <Text color={THEME.muted}>  ·</Text>
                    )}
                  </Box>
                )}
                {pullRequest && (
                  <Box width={6} flexShrink={0}>
                    {viewedStateByPath[file.path] ? (
                      <Button
                        key={`viewed-${file.path}`}
                        label={VIEWED_MARKS[viewedStateByPath[file.path] ?? 'UNVIEWED']}
                        onPress={() => toggleViewed($, file.path)}
                      />
                    ) : (
                      <Text color={THEME.muted}>  ·</Text>
                    )}
                  </Box>
                )}
                <Box width={4} flexShrink={0}>
                  <Text color={typeBadge.color} bold>
                    {typeBadge.badge}
                  </Text>
                </Box>
                <Box flexGrow={1} flexShrink={1} height={1} overflow="hidden">
                  <Button key={`file-${file.path}`} plain label={fileNameOf(file.path)} onPress={() => selectFile($, file.path)} />
                </Box>
                <Box flexShrink={0} marginLeft={1}>
                  {renderFileStats(Text, file)}
                </Box>
              </Box>
            )
          })}
        </Box>
        <Box flexDirection="row" marginTop={1} height={1} overflow="hidden">
          {renderNavigationHint({ Box, Button }, '↑', navigationHotkeys.previousFile, () => selectAdjacentFile($, -1), isTyping)}
          {renderNavigationHint({ Box, Button }, '↓', navigationHotkeys.nextFile, () => selectAdjacentFile($, 1), isTyping)}
          {renderNavigationHint({ Box, Button }, '←', navigationHotkeys.previousView, () => switchAdjacentView($, -1), isTyping)}
          {renderNavigationHint({ Box, Button }, '→', navigationHotkeys.nextView, () => switchAdjacentView($, 1), isTyping)}
        </Box>
        {hasStageActions && (
          <Box flexDirection="row" height={1} overflow="hidden">
            {hasUntrackedFiles && (
              <Box flexDirection="row">
                <Box marginRight={2}>
                  <Button key="mark-current" plain hotkey={hotkeyUnlessTyping('v')} label="mark" onPress={() => toggleCurrentFileMark($)} />
                </Box>
                <Box marginRight={2}>
                  <Button key="mark-all" plain hotkey={hotkeyUnlessTyping('n')} label="all new" onPress={() => markAllUntrackedFiles($)} />
                </Box>
                <Box marginRight={2}>
                  <Button
                    key="stage"
                    plain
                    hotkey={hotkeyUnlessTyping('g')}
                    label={`git add${markedPaths.length > 0 ? ` (${markedPaths.length})` : ''}`}
                    onPress={() => stageMarkedFiles($)}
                  />
                </Box>
              </Box>
            )}
            <Button key="stage-all" plain hotkey={hotkeyUnlessTyping('e')} label="add all" onPress={() => stageAllChanges($)} />
          </Box>
        )}
      </Box>
    )

    const diffPanel = (
      <Box flexDirection="column" flexGrow={1} height={diffBoxHeight} overflow="hidden" borderStyle="round" borderColor={THEME.border}>
        {isOverviewShown && pullRequest ? (
          <Box flexDirection="column">
            <Box flexDirection="row" flexShrink={0} backgroundColor={THEME.fileHeaderBackground} paddingX={1}>
              <Box flexGrow={1}>
                <Text bold color={THEME.heading} wrap="truncate-end">
                  {pullRequest.overviewHeadline}
                </Text>
              </Box>
              {overviewBlocks.length > 1 && (
                <Text color={THEME.muted}>
                  {diffOffset + 1}–{overviewBlocks.length}
                  {'   '}
                </Text>
              )}
              <Text>
                <Text color={THEME.added}>+{pullRequest.additions}</Text>{' '}
                <Text color={THEME.removed}>-{pullRequest.deletions}</Text>
                <Text color={THEME.muted}>
                  {'  ·  '}
                  {pullRequest.changedFiles} file{pullRequest.changedFiles > 1 ? 's' : ''}
                </Text>
              </Text>
            </Box>
            <Box flexDirection="column">
              {overviewBlocks.slice(diffOffset, diffOffset + visibleDiffRows).map((block, shownBlockIndex) => {
                const blockIndex = diffOffset + shownBlockIndex
                const anchorKey = `overview|${pullRequest.number}|${blockIndex}|${block.slice(0, 40)}`
                return (
                  <Box key={`block-${blockIndex}`} flexDirection="column" flexShrink={0} marginBottom={1}>
                    <Box flexDirection="row">
                      <Box width={4} flexShrink={0}>
                        <Box display="none" hover={{ display: 'flex' }}>
                          <Button
                            key={`${ASK_BUTTON_KEY_PREFIX}overview-${blockIndex}`}
                            plain
                            label="[+]"
                            onPress={() => openQuestion($, anchorKey)}
                          />
                        </Box>
                      </Box>
                      <Box flexGrow={1} flexShrink={1} flexDirection="column">
                        <Markdown text={block} />
                      </Box>
                    </Box>
                    {renderThreadsAndQuestion(anchorKey, question => askAboutOverviewBlock($, anchorKey, blockIndex, question))}
                  </Box>
                )
              })}
            </Box>
          </Box>
        ) : selectedFile ? (
          <Box flexDirection="row" flexShrink={0} backgroundColor={THEME.fileHeaderBackground} paddingX={1}>
            <Box width={4} flexShrink={0}>
              <Text color={fileTypeBadgeOf(selectedFile.path).color} bold>
                {fileTypeBadgeOf(selectedFile.path).badge}
              </Text>
            </Box>
            <Box flexGrow={1}>
              <Text bold color={THEME.heading} wrap="truncate-start">
                {selectedFile.path}
              </Text>
            </Box>
            {drawnRows.length > visibleDiffRows && (
              <Text color={THEME.muted}>
                {diffOffset + 1}–{Math.min(diffOffset + visibleDiffRows, drawnRows.length)} / {drawnRows.length}
                {'   '}
              </Text>
            )}
            {renderFileStats(Text, selectedFile)}
          </Box>
        ) : (
          <Box paddingX={1}>
            <Text color={THEME.muted}>Pick a file on the left.</Text>
          </Box>
        )}
        {!isOverviewShown && selectedFile && diffRows.length === 0 && (
          <Box paddingX={1}>
            <Text color={THEME.muted}>No textual change in this file.</Text>
          </Box>
        )}
        {(isOverviewShown ? [] : shownDiffRows).map((row, shownRowIndex) => {
          const rowIndex = diffOffset + shownRowIndex
          const anchorKey = selectedFilePath ? anchorKeyOf(view, selectedCommitSha, selectedFilePath, row) : ''
          if (row.kind === 'hunk') {
            return (
              <Box backgroundColor={THEME.hunkBackground} paddingX={1} flexShrink={0}>
                <Text color={THEME.hunk}>
                  {'@@ '}
                  {row.text}
                </Text>
              </Box>
            )
          }
          return (
            <Box key={`row-${rowIndex}`} flexDirection="column" flexShrink={0}>
              <Box flexDirection="row" height={1} overflow="hidden" backgroundColor={ROW_BACKGROUNDS[row.kind]}>
                <Box width={4}>
                  <Box display="none" hover={{ display: 'flex' }}>
                    <Button
                      key={`${ASK_BUTTON_KEY_PREFIX}${rowIndex}`}
                      plain
                      label="[+]"
                      onPress={() => openQuestion($, anchorKey)}
                    />
                  </Box>
                </Box>
                <Box flexShrink={0}>
                  <Button
                    key={`${LINE_NUMBER_BUTTON_KEY_PREFIX}${rowIndex}`}
                    plain
                    dimColor
                    hover={{ color: THEME.accent, bold: true }}
                    label={`${String(row.oldNumber ?? '').padStart(5)}${String(row.newNumber ?? '').padStart(5)}`}
                    onPress={() => openQuestion($, anchorKey)}
                  />
                </Box>
                <Text color={ROW_COLORS[row.kind]}> {ROW_MARKS[row.kind]} </Text>
                <Box flexShrink={1} height={1} overflow="hidden">
                  {row.text.trim() === '' ? (
                    <Text> </Text>
                  ) : (
                    <Code source={row.text} path={selectedFilePath ?? undefined} wrap="truncate-end" />
                  )}
                </Box>
                <Box flexShrink={0} marginLeft={2} display="none" hover={{ display: 'flex' }}>
                  <Button
                    key={`${END_OF_LINE_ASK_BUTTON_KEY_PREFIX}${rowIndex}`}
                    plain
                    label="[+]"
                    onPress={() => openQuestion($, anchorKey)}
                  />
                </Box>
                <Box flexGrow={1} />
              </Box>
              {renderThreadsAndQuestion(anchorKey, question => askAboutRow($, anchorKey, rowIndex, question))}
            </Box>
          )
        })}
        {diffRows.length > MAX_DRAWN_DIFF_ROWS && (
          <Box paddingX={1}>
            <Text color={THEME.muted}>… {diffRows.length - MAX_DRAWN_DIFF_ROWS} more lines not shown</Text>
          </Box>
        )}
      </Box>
    )

    return (
      <Box flexDirection="column" backgroundColor={THEME.paneBackground} height={bodyRows} overflow="hidden">
        {tabs}
        {loadError && <Text color={THEME.removed}>{loadError}</Text>}
        {commitPanel}
        <Box flexDirection={isTwoColumns ? 'row' : 'column'} height={panelsHeight}>
          {filePanel}
          {diffPanel}
        </Box>
      </Box>
    )
  })
}
