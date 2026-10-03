import type { ReviewView } from '../types'
import type { ShortcutAction } from './keymap'

export const PANE_ID = 'diff-review'
export const PANE_TITLE = 'Review'

// The transcript and the prompt keep the left third, the review takes the rest.
export const PANE_SHARE_OF_TERMINAL = 2 / 3
// Under this width the gutter (ask button, line numbers, marker) leaves too little room to read code.
export const MIN_PANE_COLUMNS = 80
export const TWO_COLUMNS_MIN_WIDTH = 120
export const DEFAULT_FILE_LIST_WIDTH = 50
export const MIN_FILE_LIST_WIDTH = 24
export const MIN_DIFF_WIDTH = 40
// Each half of the side-by-side view needs about as much room as the narrowest unified diff.
export const SPLIT_VIEW_MIN_DIFF_WIDTH = 140
export const COMMIT_PANEL_MAX_LINES = 8
export const WHEEL_TICK_ROWS = 3
export const CONTEXT_RADIUS_ROWS = 6
export const DEFAULT_DIFF_CONTEXT_LINES = 3
export const DIFF_CONTEXT_STEP_LINES = 20
// A context wider than any file shows the whole file, its changes in place.
export const WHOLE_FILE_CONTEXT_LINES = 1000000
// Only the characters of a Button's label take a click: a row's label is padded with spaces past any pane width, and
// its clipped box cuts it, so the whole row answers a click and not just the name in it.
export const ROW_CLICK_TARGET_LENGTH = 400

export const VIEW_ORDER: readonly ReviewView[] = ['uncommitted', 'pr', 'commits']
export const VIEW_LABELS: Record<ReviewView, string> = { uncommitted: 'Uncommitted', pr: 'PR', commits: 'Commits' }
export const VIEW_SHORTCUTS: Record<ReviewView, ShortcutAction> = {
  uncommitted: 'uncommittedView',
  pr: 'pullRequestView',
  commits: 'commitsView',
}

// Element keys: the focus, close and redirect rules recognise elements by these prefixes.
export const QUESTION_INPUT_KEY_PREFIX = 'question-'
export const REPLY_INPUT_KEY_PREFIX = 'reply-'
export const ASK_BUTTON_KEY_PREFIX = 'ask-'
export const LINE_NUMBER_BUTTON_KEY_PREFIX = 'line-'
export const DISMISS_THREAD_KEY_PREFIX = 'dismiss-'
export const CANCEL_QUESTION_KEY = 'cancel-question'
export const FILE_FILTER_KEY = 'file-filter'
export const DIVIDER_KEY = 'file-divider'
export const FILE_BUTTON_KEY_PREFIX = 'file-'
export const ASK_ON_LINE_KEY = 'ask-on-line'
// The keyboard rests on a hidden button drawn first in the pane: the engine keeps the focus by position, so a button
// drawn after threads or files would drift as they come and go. Enter on it asks about the cursor's line.
export const CURSOR_LINE_FOCUS_KEY = 'cursor-line'
export const ADDRESS_GITHUB_THREAD_KEY_PREFIX = 'address-github-thread-'
export const PULL_REQUEST_OVERVIEW_KEY = 'pr-overview'
export const HELP_CLOSE_KEY = 'help-close'

export const QUESTION_FOCUS_RETRY_MS = 120
// A session attached from another terminal (claude attach) or reached through Remote Control sends the person's
// prompts unstamped or as the bridge's: they are the person's own all the same.
export const PERSON_PROMPT_ORIGINS: readonly string[] = ['composer', 'unclassified', 'bridge']

export const BASE_REF_CANDIDATES = ['origin/main', 'origin/master', 'origin/develop', 'main', 'master']
export const GIT_TIMEOUT_MS = 15000
export const BROWSER_OPENERS = ['xdg-open', 'open']
export const GH_TIMEOUT_MS = 20000

export const FILE_LIST_WIDTH_STORE_KEY = 'fileListWidth'
export const SPLIT_VIEW_STORE_KEY = 'isSplitViewPreferred'
export const THREADS_STORE_KEY_PREFIX = 'threads'
export const MAX_SAVED_THREADS_PER_BRANCH = 100
export const EMOJI_STORE_KEY = 'githubEmojiCharacters'
export const EMOJI_CACHE_DURATION_MS = 7 * 24 * 3600 * 1000
