import type { KeyboardLayout } from '../types'

export type ShortcutAction =
  | 'uncommittedView'
  | 'pullRequestView'
  | 'commitsView'
  | 'previousView'
  | 'nextView'
  | 'previousFile'
  | 'nextFile'
  | 'markViewedAndNext'
  | 'focusFileFilter'
  | 'clearFileFilters'
  | 'toggleDirectoryFold'
  | 'toggleFileListCollapse'
  | 'previousLine'
  | 'nextLine'
  | 'previousHunk'
  | 'nextHunk'
  | 'moreContext'
  | 'wholeFile'
  | 'toggleSplitView'
  | 'askOnLine'
  | 'replyOnLine'
  | 'previousThread'
  | 'nextThread'
  | 'toggleThreadResolved'
  | 'openOnGitHub'
  | 'markCurrentFile'
  | 'markAllNewFiles'
  | 'stageMarkedFiles'
  | 'stageAllChanges'
  | 'toggleHelp'
  | 'watchSelection'
  | 'nextWatchedMatch'
  | 'previousWatchedMatch'

export type ShortcutGroup = 'Views' | 'Files' | 'Lines' | 'Watch' | 'Threads' | 'git add' | 'Other'

type ShortcutDefinition = {
  action: ShortcutAction
  group: ShortcutGroup
  description: string
  defaultKeys: (layout: KeyboardLayout) => readonly string[]
}

// Up, left, down and right sit on z q s d on an AZERTY keyboard and on w a s d on a QWERTY one. A layout that could
// not be read keeps both bound.
const upKeys = (layout: KeyboardLayout) => ({ azerty: ['z'], qwerty: ['w'], unknown: ['z', 'w'] })[layout]
const leftKeys = (layout: KeyboardLayout) => ({ azerty: ['q'], qwerty: ['a'], unknown: ['q', 'a'] })[layout]
const fixed = (key: string) => () => [key]

export const SHORTCUTS: readonly ShortcutDefinition[] = [
  { action: 'uncommittedView', group: 'Views', description: 'Uncommitted changes', defaultKeys: fixed('1') },
  { action: 'pullRequestView', group: 'Views', description: 'Pull request', defaultKeys: fixed('2') },
  { action: 'commitsView', group: 'Views', description: 'Commits', defaultKeys: fixed('3') },
  { action: 'previousView', group: 'Views', description: 'Previous view', defaultKeys: leftKeys },
  { action: 'nextView', group: 'Views', description: 'Next view', defaultKeys: fixed('d') },
  { action: 'previousFile', group: 'Files', description: 'Previous file', defaultKeys: upKeys },
  { action: 'nextFile', group: 'Files', description: 'Next file', defaultKeys: fixed('s') },
  { action: 'markViewedAndNext', group: 'Files', description: 'Mark viewed on GitHub, go to the next unviewed', defaultKeys: fixed('y') },
  { action: 'focusFileFilter', group: 'Files', description: 'Filter the files (Enter goes back to the diff)', defaultKeys: fixed('i') },
  { action: 'clearFileFilters', group: 'Files', description: 'Clear the filters, every file listed again', defaultKeys: fixed('5') },
  { action: 'toggleDirectoryFold', group: 'Files', description: "Fold or unfold the file's directory", defaultKeys: fixed('0') },
  { action: 'toggleFileListCollapse', group: 'Files', description: 'Collapse the file list behind a bar, or pin it beside the code', defaultKeys: fixed('9') },
  { action: 'previousLine', group: 'Lines', description: 'Line above', defaultKeys: fixed('k') },
  { action: 'nextLine', group: 'Lines', description: 'Line below', defaultKeys: fixed('j') },
  { action: 'previousHunk', group: 'Lines', description: 'Previous hunk (@@ block)', defaultKeys: fixed('b') },
  { action: 'nextHunk', group: 'Lines', description: 'Next hunk (@@ block)', defaultKeys: fixed('f') },
  { action: 'moreContext', group: 'Lines', description: 'More context around the changes', defaultKeys: fixed('u') },
  { action: 'wholeFile', group: 'Lines', description: 'The whole file, changes in place', defaultKeys: fixed('l') },
  { action: 'toggleSplitView', group: 'Lines', description: 'Side by side or unified (wide diff)', defaultKeys: fixed('t') },
  { action: 'askOnLine', group: 'Lines', description: 'Ask about the line (Enter too), address a GitHub thread', defaultKeys: fixed('c') },
  { action: 'replyOnLine', group: 'Lines', description: 'Reply in the thread of the line', defaultKeys: fixed('r') },
  { action: 'watchSelection', group: 'Watch', description: 'Search all changes for the text selected with the mouse, or type it', defaultKeys: fixed('8') },
  { action: 'nextWatchedMatch', group: 'Watch', description: 'Next occurrence of the watched term, across files', defaultKeys: fixed('7') },
  { action: 'previousWatchedMatch', group: 'Watch', description: 'Previous occurrence of the watched term', defaultKeys: fixed('6') },
  { action: 'previousThread', group: 'Threads', description: 'Previous thread', defaultKeys: fixed('p') },
  { action: 'nextThread', group: 'Threads', description: 'Next thread', defaultKeys: fixed('n') },
  { action: 'toggleThreadResolved', group: 'Threads', description: 'Resolve or unresolve the GitHub thread', defaultKeys: fixed('x') },
  { action: 'openOnGitHub', group: 'Other', description: 'Open the comment, commit or PR on GitHub', defaultKeys: fixed('o') },
  { action: 'markCurrentFile', group: 'git add', description: 'Mark the new file', defaultKeys: fixed('v') },
  { action: 'markAllNewFiles', group: 'git add', description: 'Mark every new file', defaultKeys: fixed('m') },
  { action: 'stageMarkedFiles', group: 'git add', description: 'git add the marked files', defaultKeys: fixed('g') },
  { action: 'stageAllChanges', group: 'git add', description: 'git add everything', defaultKeys: fixed('e') },
  { action: 'toggleHelp', group: 'Other', description: 'This help', defaultKeys: fixed('h') },
]

export type Keymap = Record<ShortcutAction, readonly string[]>

export function keymapOf(layout: KeyboardLayout): Keymap {
  return Object.fromEntries(SHORTCUTS.map(shortcut => [shortcut.action, shortcut.defaultKeys(layout)])) as Keymap
}

export function shortcutsOfGroup(group: ShortcutGroup): readonly ShortcutDefinition[] {
  return SHORTCUTS.filter(shortcut => shortcut.group === group)
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ['Views', 'Files', 'Lines', 'Watch', 'Threads', 'git add', 'Other']
