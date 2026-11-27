export const PLUGIN_NAME = 'code-nav'
export const PANE_ID = 'code-nav'
export const PANE_TITLE = 'Code'
export const COMMAND_NAME = 'code-nav'
export const SHOW_TOOL_NAME = 'show'
export const SHOW_TOOL_FULL_NAME = `mcp__${PLUGIN_NAME}__${SHOW_TOOL_NAME}`

export const PANE_SHARE_OF_TERMINAL = 0.55
export const MIN_PANE_COLUMNS = 50
export const SIDEBAR_DEFAULT_WIDTH = 44
export const EXPLORER_DEFAULT_WIDTH = 40
// The steps of the drawer sliding open or folding, one frame apart.
export const DRAWER_ANIMATION_STEPS = [0.3, 0.6, 0.85, 1]
export const DRAWER_FRAME_MS = 30
export const SIDEBAR_MIN_WIDTH = 18
export const CODE_MIN_COLUMNS_BESIDE_SIDEBAR = 60
// The share of the side column's rows the tabs may take before they scroll; the files have the rest.
export const SIDEBAR_TABS_SHARE = 0.4

export const TAB_WIDTH = 4
export const WHEEL_TICK_LINES = 3
export const KEY_SCROLL_LINES = 3
// A jump lands its line a third of the way down, with the lines above it left to read.
export const JUMP_LINE_SHARE_FROM_TOP = 1 / 3

export const PALETTE_ITEM_LIMIT = 40
export const OUTLINE_ITEM_LIMIT = 400
export const PALETTE_MAX_SHOWN_ITEMS = 18
export const PALETTE_MAX_WIDTH = 110
export const STRUCTURE_MAX_WIDTH = 100
export const STRUCTURE_MAX_SHOWN_ITEMS = 40
export const RECENT_PATH_LIMIT = 30
export const HISTORY_LIMIT = 100
export const MAX_OPEN_TABS = 30

export const RESULTS_PANEL_SHARE_OF_BODY = 0.3
export const RESULTS_PANEL_MIN_ROWS = 4
// The lines of a preview of a place in the list, and how many of them come before the place itself.
export const PEEK_MAX_CODE_ROWS = 30
export const PEEK_SHARE_OF_ROWS = 0.5
export const PEEK_FILE_CACHE_SIZE = 8
export const PEEK_OPEN_KEY = 'peek-open'
export const TEXT_SEARCH_MATCH_LIMIT = 300

// The project's declarations are listed again when the palette opens on an index older than this.
export const INDEX_MAX_AGE_MS = 15_000
export const FILE_TEXT_MAX_AGE_MS = 3_000
export const INDEX_REFRESH_DELAY_MS = 400
export const LARGEST_COLORED_FILE_CHARACTERS = 1_500_000
export const CURRENT_FILE_POLL_MS = 2_000
export const SELECTION_POLL_MS = 700
export const NOTICE_DURATION_MS = 6_000
export const INLINE_NOTE_DURATION_MS = 3_000

export const PALETTE_FIELD_KEY_PREFIX = 'palette-field-'
export const PALETTE_PREVIOUS_KEY = 'palette-previous'
export const PALETTE_NEXT_KEY = 'palette-next'
export const PALETTE_CLOSE_KEY = 'palette-close'
export const TEXT_SCOPE_KEY_PREFIX = 'text-scope-'
export const PALETTE_ITEM_KEY_PREFIX = 'palette-item-'
export const RESULT_ROW_KEY_PREFIX = 'result-row-'
export const TOKEN_KEY_PREFIX = 'token-'
export const TOKEN_HINT_KEY_PREFIX = 'token-hint-'
export const SHORTCUT_KEY_PREFIX = 'shortcut-'

export const RECENT_PATHS_STORE_KEY_PREFIX = 'recentPaths|'
export const OPEN_TABS_STORE_KEY_PREFIX = 'openTabs|'
export const BOOKMARKS_STORE_KEY_PREFIX = 'bookmarks|'
export const TABS_MODE_STORE_KEY = 'tabsMode'
export const EXPLORER_MODE_STORE_KEY = 'explorerMode'
export const EXPLORER_WIDTH_STORE_KEY = 'explorerWidth'
export const SIDEBAR_WIDTH_STORE_KEY = 'sidebarWidth'
export const SIDEBAR_DIVIDER_KEY = 'sidebar-divider'
export const EXPLORER_DIVIDER_KEY = 'explorer-divider'
export const TREE_ROW_KEY_PREFIX = 'tree-row-'
export const FILES_FILTER_FIELD_KEY_PREFIX = 'files-filter-'
export const FILES_FILTER_PREVIOUS_KEY = 'files-filter-previous'
export const FILES_FILTER_NEXT_KEY = 'files-filter-next'
export const FILES_FILTER_ITEM_KEY_PREFIX = 'files-filter-item-'
export const FILES_FILTER_ITEM_LIMIT = 200
export const TAB_BUTTON_KEY_PREFIX = 'tab-'
export const CLOSE_TAB_BUTTON_KEY_PREFIX = 'close-tab-'
export const CONFIGURED_THEME_KEY = 'code-nav.theme'

export const KEYBOARD_LAYOUT_TIMEOUT_MS = 3_000
