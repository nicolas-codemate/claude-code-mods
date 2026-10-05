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

export type ShortcutGroup = 'Views' | 'Files' | 'Lines' | 'Threads' | 'git add' | 'Other'

type ShortcutDefinition = {
  action: ShortcutAction
  // The userConfig field of plugin.json that remaps it.
  configField: string
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
  { action: 'uncommittedView', configField: 'key_uncommitted_view', group: 'Views', description: 'Uncommitted changes', defaultKeys: fixed('1') },
  { action: 'pullRequestView', configField: 'key_pr_view', group: 'Views', description: 'Pull request', defaultKeys: fixed('2') },
  { action: 'commitsView', configField: 'key_commits_view', group: 'Views', description: 'Commits', defaultKeys: fixed('3') },
  { action: 'previousView', configField: 'key_previous_view', group: 'Views', description: 'Previous view', defaultKeys: leftKeys },
  { action: 'nextView', configField: 'key_next_view', group: 'Views', description: 'Next view', defaultKeys: fixed('d') },
  { action: 'previousFile', configField: 'key_previous_file', group: 'Files', description: 'Previous file', defaultKeys: upKeys },
  { action: 'nextFile', configField: 'key_next_file', group: 'Files', description: 'Next file', defaultKeys: fixed('s') },
  { action: 'markViewedAndNext', configField: 'key_mark_viewed', group: 'Files', description: 'Mark viewed on GitHub, go to the next unviewed', defaultKeys: fixed('y') },
  { action: 'focusFileFilter', configField: 'key_filter_files', group: 'Files', description: 'Filter the files (Enter goes back to the diff)', defaultKeys: fixed('i') },
  { action: 'toggleDirectoryFold', configField: 'key_fold_directory', group: 'Files', description: "Fold or unfold the file's directory", defaultKeys: fixed('0') },
  { action: 'toggleFileListCollapse', configField: 'key_collapse_file_list', group: 'Files', description: 'Collapse the file list behind a bar, or pin it beside the code', defaultKeys: fixed('9') },
  { action: 'previousLine', configField: 'key_previous_line', group: 'Lines', description: 'Line above', defaultKeys: fixed('k') },
  { action: 'nextLine', configField: 'key_next_line', group: 'Lines', description: 'Line below', defaultKeys: fixed('j') },
  { action: 'previousHunk', configField: 'key_previous_hunk', group: 'Lines', description: 'Previous hunk (@@ block)', defaultKeys: fixed('b') },
  { action: 'nextHunk', configField: 'key_next_hunk', group: 'Lines', description: 'Next hunk (@@ block)', defaultKeys: fixed('f') },
  { action: 'moreContext', configField: 'key_more_context', group: 'Lines', description: 'More context around the changes', defaultKeys: fixed('u') },
  { action: 'wholeFile', configField: 'key_whole_file', group: 'Lines', description: 'The whole file, changes in place', defaultKeys: fixed('l') },
  { action: 'toggleSplitView', configField: 'key_split_view', group: 'Lines', description: 'Side by side or unified (wide diff)', defaultKeys: fixed('t') },
  { action: 'askOnLine', configField: 'key_ask_on_line', group: 'Lines', description: 'Ask about the line (Enter too), address a GitHub thread', defaultKeys: fixed('c') },
  { action: 'replyOnLine', configField: 'key_reply_on_line', group: 'Lines', description: 'Reply in the thread of the line', defaultKeys: fixed('r') },
  { action: 'previousThread', configField: 'key_previous_thread', group: 'Threads', description: 'Previous thread', defaultKeys: fixed('p') },
  { action: 'nextThread', configField: 'key_next_thread', group: 'Threads', description: 'Next thread', defaultKeys: fixed('n') },
  { action: 'toggleThreadResolved', configField: 'key_resolve_thread', group: 'Threads', description: 'Resolve or unresolve the GitHub thread', defaultKeys: fixed('x') },
  { action: 'openOnGitHub', configField: 'key_open_on_github', group: 'Other', description: 'Open the comment, commit or PR on GitHub', defaultKeys: fixed('o') },
  { action: 'markCurrentFile', configField: 'key_mark_file', group: 'git add', description: 'Mark the new file', defaultKeys: fixed('v') },
  { action: 'markAllNewFiles', configField: 'key_mark_all_new', group: 'git add', description: 'Mark every new file', defaultKeys: fixed('m') },
  { action: 'stageMarkedFiles', configField: 'key_stage_marked', group: 'git add', description: 'git add the marked files', defaultKeys: fixed('g') },
  { action: 'stageAllChanges', configField: 'key_stage_all', group: 'git add', description: 'git add everything', defaultKeys: fixed('e') },
  { action: 'toggleHelp', configField: 'key_help', group: 'Other', description: 'This help', defaultKeys: fixed('h') },
]

export type Keymap = Record<ShortcutAction, readonly string[]>

export type ResolvedKeymap = { keymap: Keymap; problems: string[] }

// The engine takes one digit or one lowercase letter as a hotkey. A field left empty keeps the default; a value it
// refuses keeps the default too, and the help says why. Several keys go comma or space separated.
export function resolveKeymap(options: Readonly<Record<string, unknown>>, layout: KeyboardLayout): ResolvedKeymap {
  const problems: string[] = []
  const keymap = {} as Record<ShortcutAction, readonly string[]>
  for (const shortcut of SHORTCUTS) {
    const configured = options[shortcut.configField]
    const keys =
      typeof configured === 'string'
        ? configured
            .toLowerCase()
            .split(/[\s,]+/)
            .filter(key => key !== '')
        : []
    const invalidKeys = keys.filter(key => !/^[a-z0-9]$/.test(key))
    if (invalidKeys.length > 0) {
      problems.push(`${shortcut.configField}: "${invalidKeys.join(' ')}" is not one letter or digit, the default stays.`)
    }
    keymap[shortcut.action] = keys.length > 0 && invalidKeys.length === 0 ? keys : shortcut.defaultKeys(layout)
  }
  const actionsByKey = new Map<string, ShortcutAction[]>()
  for (const shortcut of SHORTCUTS) {
    for (const key of keymap[shortcut.action]) {
      actionsByKey.set(key, [...(actionsByKey.get(key) ?? []), shortcut.action])
    }
  }
  for (const [key, actions] of actionsByKey) {
    if (actions.length > 1) {
      problems.push(`"${key}" is bound to ${actions.join(', ')}: only the last one answers.`)
    }
  }

  return { keymap, problems }
}

export function shortcutsOfGroup(group: ShortcutGroup): readonly ShortcutDefinition[] {
  return SHORTCUTS.filter(shortcut => shortcut.group === group)
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ['Views', 'Files', 'Lines', 'Threads', 'git add', 'Other']
