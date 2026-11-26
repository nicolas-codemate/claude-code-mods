import type { KeyboardLayout } from '../types'

export type ShortcutAction =
  | 'findEverything'
  | 'fileOutline'
  | 'searchText'
  | 'showUsages'
  | 'showImplementations'
  | 'nextTab'
  | 'previousTab'
  | 'closeTab'
  | 'closeOtherTabs'
  | 'closeTabsOnTheLeft'
  | 'closeTabsOnTheRight'
  | 'closeAllTabs'
  | 'goBack'
  | 'goForward'
  | 'previousResult'
  | 'nextResult'
  | 'closeResults'
  | 'scrollUp'
  | 'scrollDown'
  | 'goToTop'
  | 'goToEnd'
  | 'copyLocation'
  | 'toggleFiles'
  | 'toggleTabsColumn'
  | 'toggleHelp'

export type ShortcutGroup = 'Search' | 'Symbol' | 'Tabs' | 'History' | 'Results' | 'Reading' | 'Other'

type ShortcutDefinition = {
  action: ShortcutAction
  group: ShortcutGroup
  description: string
  // The few words drawn beside the key in the bar under the code.
  label: string
  defaultKeys: (layout: KeyboardLayout) => readonly string[]
}

// Up and left sit on z and q on an AZERTY keyboard, on w and a on a QWERTY one. A layout that could not be read keeps
// both bound.
const upKeys = (layout: KeyboardLayout) => ({ azerty: ['z'], qwerty: ['w'], unknown: ['z', 'w'] })[layout]
const leftKeys = (layout: KeyboardLayout) => ({ azerty: ['q'], qwerty: ['a'], unknown: ['q', 'a'] })[layout]
const fixed = (key: string) => () => [key]

export const SHORTCUTS: readonly ShortcutDefinition[] = [
  { action: 'findEverything', group: 'Search', description: 'Find a file, a class or a method by name', label: 'find', defaultKeys: fixed('f') },
  { action: 'fileOutline', group: 'Search', description: 'The structure of the file shown: its classes, functions, methods or sections, to jump to', label: 'structure', defaultKeys: fixed('r') },
  { action: 'searchText', group: 'Search', description: 'Search a text in the file shown, as you type, or in every file of the project', label: 'grep', defaultKeys: fixed('g') },
  { action: 'showUsages', group: 'Symbol', description: 'Usages of the name pointed at', label: 'usages', defaultKeys: fixed('u') },
  { action: 'showImplementations', group: 'Symbol', description: 'Implementations of the class or method pointed at', label: 'impl', defaultKeys: fixed('i') },
  { action: 'nextTab', group: 'Tabs', description: 'Next tab', label: 'next tab', defaultKeys: fixed('n') },
  { action: 'previousTab', group: 'Tabs', description: 'Previous tab', label: 'previous tab', defaultKeys: fixed('p') },
  { action: 'closeTab', group: 'Tabs', description: 'Close the tab shown', label: 'close tab', defaultKeys: fixed('c') },
  { action: 'closeOtherTabs', group: 'Tabs', description: 'Close every tab but the one shown', label: 'close others', defaultKeys: fixed('b') },
  { action: 'closeTabsOnTheLeft', group: 'Tabs', description: 'Close the tabs on the left of the one shown', label: 'close left', defaultKeys: fixed('l') },
  { action: 'closeTabsOnTheRight', group: 'Tabs', description: 'Close the tabs on the right of the one shown', label: 'close right', defaultKeys: fixed('o') },
  { action: 'toggleTabsColumn', group: 'Tabs', description: 'Open or fold the tabs, on the left', label: 'tabs', defaultKeys: fixed('0') },
  { action: 'closeAllTabs', group: 'Tabs', description: 'Close every tab', label: 'close all', defaultKeys: fixed('m') },
  { action: 'goBack', group: 'History', description: 'Back to where you were', label: 'back', defaultKeys: leftKeys },
  { action: 'goForward', group: 'History', description: 'Forward again', label: 'forward', defaultKeys: fixed('d') },
  { action: 'previousResult', group: 'Results', description: 'Previous row of the list under the code, previewed above it (Enter or a click goes in)', label: 'previous', defaultKeys: upKeys },
  { action: 'nextResult', group: 'Results', description: 'Next row of the list under the code, previewed above it (Enter or a click goes in)', label: 'next', defaultKeys: fixed('s') },
  { action: 'closeResults', group: 'Results', description: 'Close the list under the code', label: 'close list', defaultKeys: fixed('x') },
  { action: 'scrollUp', group: 'Reading', description: 'A few lines up (the wheel and Page Up too)', label: 'up', defaultKeys: fixed('k') },
  { action: 'scrollDown', group: 'Reading', description: 'A few lines down (the wheel and Page Down too)', label: 'down', defaultKeys: fixed('j') },
  { action: 'goToTop', group: 'Reading', description: 'Top of the file', label: 'top', defaultKeys: fixed('t') },
  { action: 'goToEnd', group: 'Reading', description: 'End of the file', label: 'end', defaultKeys: fixed('e') },
  { action: 'toggleFiles', group: 'Other', description: 'Open or fold the files of the project, on the right', label: 'files', defaultKeys: fixed('v') },
  { action: 'copyLocation', group: 'Other', description: 'Copy the path and line pointed at', label: 'copy path', defaultKeys: fixed('y') },
  { action: 'toggleHelp', group: 'Other', description: 'This help', label: 'help', defaultKeys: fixed('h') },
]

export type Keymap = Record<ShortcutAction, readonly string[]>

export function keymapOf(layout: KeyboardLayout): Keymap {
  return Object.fromEntries(SHORTCUTS.map(shortcut => [shortcut.action, shortcut.defaultKeys(layout)])) as Keymap
}

export function shortcutsOfGroup(group: ShortcutGroup): readonly ShortcutDefinition[] {
  return SHORTCUTS.filter(shortcut => shortcut.group === group)
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ['Search', 'Symbol', 'Tabs', 'History', 'Results', 'Reading', 'Other']
