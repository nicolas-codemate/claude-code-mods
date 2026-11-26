import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

import { PANE_ID, PANE_TITLE, SHOW_TOOL_FULL_NAME, TAB_BUTTON_KEY_PREFIX } from './constants'
import { tokenButtonKey, tokenHintKey } from './view/pane'

export const ROOT = '/work/shop'

const IGNORED_DIRECTORIES = ['vendor/', 'node_modules/']

function argumentAfter(argv: readonly string[], flag: string): string {
  return argv[argv.indexOf(flag) + 1] ?? ''
}

function argumentsAfterEvery(argv: readonly string[], flag: string): string[] {
  return argv.flatMap((argument, index) => (argument === flag ? [argv[index + 1] ?? ''] : []))
}

function isPathOfGlobs(path: string, globs: readonly string[]): boolean {
  return globs.length === 0 || globs.some(glob => path.endsWith(glob.replace('*', '')))
}

// What ripgrep would print over the files held in memory, for the three ways the mod runs it: the file list, the
// declarations (a heading per file, "line:replacement" per match), a search (one "path:line:column:text" per match).
// The patterns are run as JavaScript.
export function ripgrepOutputOf(argv: readonly string[], textByPath: Record<string, string>): string {
  const searchedDirectory = argv.at(-1) ?? './'
  const searchedPaths = Object.keys(textByPath)
    .filter(path => argv.includes('--no-ignore') || !IGNORED_DIRECTORIES.some(directory => path.startsWith(directory)))
    .filter(path => searchedDirectory === './' || path.startsWith(searchedDirectory))
    .sort()
  if (argv.includes('--files')) {
    return searchedPaths.map(path => `./${path}\n`).join('')
  }
  const pattern = argumentAfter(argv, '--regexp')
  const paths = searchedPaths.filter(path => isPathOfGlobs(path, argumentsAfterEvery(argv, '--glob')))
  if (argv.includes('--vimgrep')) {
    return paths
      .flatMap(path =>
        (textByPath[path] ?? '').split('\n').flatMap((lineText, lineIndex) =>
          [...lineText.matchAll(new RegExp(pattern, 'g'))].map(match => `./${path}:${lineIndex + 1}:${match.index + 1}:${lineText}\n`),
        ),
      )
      .join('')
  }
  const replacement = argumentAfter(argv, '--replace')

  return paths
    .flatMap(path => {
      const printedLines = (textByPath[path] ?? '').split('\n').flatMap((lineText, lineIndex) => {
        const match = lineText.match(new RegExp(pattern))

        return match ? [`${lineIndex + 1}:${replacement.replace(/\$(\d+)/g, (_group, groupNumber) => match[Number(groupNumber)] ?? '')}`] : []
      })

      return printedLines.length === 0 ? [] : [[`./${path}`, ...printedLines, ''].join('\n')]
    })
    .join('\n')
}

export type World = {
  textByPath: Record<string, string>
  modifiedAtByPath: Record<string, number>
  copiedTexts: string[]
  openedPanes: Array<{ focus: boolean; columns: number | undefined }>
  focusedKeys: string[]
  registeredToolNames: string[]
  store: Map<string, unknown>
  // What the mouse last selected on screen, as the terminal would copy it.
  selectionText: string | null
  // The prompt box's draft, and the dim texts the mod painted after it.
  promptText: string
  promptVirtualTexts: string[][]
  clock: ReturnType<typeof mock.clock>
}

// The engine beneath the mod, over a project held in memory at ROOT: git names the root, ripgrep and the file reads
// answer from the texts given, and what the mod asks of the interface is recorded.
export function stubWorld(on: On, textByPath: Record<string, string>): World {
  const world: World = {
    textByPath: { ...textByPath },
    modifiedAtByPath: {},
    copiedTexts: [],
    openedPanes: [],
    focusedKeys: [],
    registeredToolNames: [],
    store: new Map(),
    selectionText: null,
    promptText: '',
    promptVirtualTexts: [],
    clock: mock.clock(on, { now: 1000 }),
  }
  const pathFromRoot = (path: string) => (path.startsWith(`${ROOT}/`) ? path.slice(ROOT.length + 1) : path)
  on('process.run', async (_, e) => {
    const isGitRootQuestion = e.argv[0] === 'git' && e.argv.includes('--show-toplevel')

    return { value: { exitCode: isGitRootQuestion ? 0 : 1, stdout: isGitRootQuestion ? `${ROOT}\n` : '', stderr: '' } } as never
  })
  on('process.spawn', async function* (_, e) {
    const output = ripgrepOutputOf(e.argv.slice(1), world.textByPath)
    if (output !== '') {
      yield { stream: 'stdout', text: output } as never
    }

    return { value: { code: 0, signal: null } } as never
  })
  on('fs.read', async (_, e) => {
    const text = world.textByPath[pathFromRoot(e.path)]
    if (text === undefined) {
      throw new Error(`no such file: ${e.path}`)
    }

    return { value: text } as never
  })
  on('fs.list', async (_, e) => {
    const directory = pathFromRoot(e.path ?? ROOT).replace(/^\/work\/shop$/, '')
    const prefix = directory === '' ? '' : `${directory}/`
    const names = new Map<string, 'file' | 'dir'>()
    for (const path of Object.keys(world.textByPath).filter(path => path.startsWith(prefix))) {
      const [name = '', ...rest] = path.slice(prefix.length).split('/')
      names.set(name, rest.length > 0 ? 'dir' : 'file')
    }

    return { value: [...names].map(([name, kind]) => ({ name, kind, size: 1, mtimeMs: 1, isLink: false })) } as never
  })
  on('fs.stat', async (_, e) => ({ value: { kind: 'file', size: 1, mtimeMs: world.modifiedAtByPath[pathFromRoot(e.path)] ?? 1, isLink: false } }) as never)
  on('session.cwd', async () => ({ value: ROOT }) as never)
  on('session.start', async () => ({ cwd: ROOT }) as never)
  on('config.list', async () => ({ value: [] }) as never)
  on('command.register', async (_, e) => ({ value: { command: e.name } }) as never)
  on('tool.register', async (_, e) => {
    world.registeredToolNames.push(e.name)
    return { value: { tool: e.name } } as never
  })
  on('store.get', async (_, e) => ({ value: world.store.get(e.key) }) as never)
  on('store.set', async (_, e) => {
    world.store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined } as never
  })
  on('ui.open', async (_, e) => {
    world.openedPanes.push({ focus: e.focus === true, columns: e.columns })
    return { value: { isPlaced: true } } as never
  })
  on('ui.panes', async () => ({ value: [{ id: PANE_ID }] }) as never)
  on('ui.selection', async () => ({ value: world.selectionText === null ? undefined : { text: world.selectionText } }) as never)
  on('prompt.submit', async (_, e) => ({ text: e.text, context: e.context }) as never)
  on('prompt.read', async () => ({ value: { text: world.promptText, cursor: world.promptText.length } }) as never)
  on('prompt.paint', async (_, e) => {
    world.promptVirtualTexts.push(e.decorations.flatMap(decoration => (decoration.virtualText === undefined ? [] : [decoration.virtualText])))
    return { value: { isPainted: true, text: world.promptText, cursor: world.promptText.length } } as never
  })
  on('ui.close', async () => ({ value: undefined }) as never)
  on('ui.focus', async (_, e) => {
    world.focusedKeys.push(e.element ?? '')
    return { value: undefined } as never
  })
  on('ui.copy', async (_, e) => {
    world.copiedTexts.push(e.text)
    return { value: { isCopied: true } } as never
  })

  return world
}

export async function runCodeNav($: Engine, commandArguments = ''): Promise<string> {
  const answer = await $.command.run({ command: 'code-nav', args: commandArguments, presentation: { isFullscreen: true, columns: 240 } } as never)

  return (answer as { text?: string }).text ?? ''
}

export async function startSession($: Engine): Promise<void> {
  await $.session.start({ source: 'startup', cwd: ROOT } as never)
}

export type PaneOptions = { isFocused?: boolean; bodyColumns?: number; bodyRows?: number }

export async function mountPane($: Engine, options: PaneOptions = {}): Promise<Mounted<'terminal', 'Pane'>> {
  return $.ui.mount({
    plugin: 'code-nav',
    surface: 'terminal',
    component: 'Pane',
    requestId: PANE_ID,
    props: {
      title: PANE_TITLE,
      isFocused: options.isFocused ?? true,
      bodyColumns: options.bodyColumns ?? 160,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: options.bodyRows ?? 40 },
    } as never,
  } as const)
}

export async function askClaudeToShow($: Engine, input: { path?: string; line?: number; symbol?: string }): Promise<string> {
  const answer = await $.tool.call({ tool: SHOW_TOOL_FULL_NAME, tool_use_id: 'show-1', ...input } as never)

  return String((answer as { result?: unknown; deny?: unknown }).result ?? (answer as { deny?: unknown }).deny ?? '')
}

export async function wheel($: Engine, by: number, row = 10, column = 100): Promise<void> {
  await $.ui.scroll({
    component: 'Pane',
    requestId: PANE_ID,
    offset: 0,
    by,
    bodyRows: 40,
    contentRows: 40,
    origin: { kind: 'person' },
    pointer: { column, row },
  } as never)
}

export async function pressPageKey($: Engine, by: number): Promise<void> {
  await $.ui.scroll({ component: 'Pane', requestId: PANE_ID, offset: 0, by, bodyRows: 40, contentRows: 40, origin: { kind: 'person' } } as never)
}

export async function moveFocusTo($: Engine, element: string): Promise<void> {
  await $.ui.focus({ component: 'Pane', requestId: PANE_ID, element, origin: { kind: 'person' } } as never)
}

// The number of the first line of the file that writes the snippet.
export function lineNumberOf(textByPath: Record<string, string>, path: string, snippet: string): number {
  return (textByPath[path] ?? '').split('\n').findIndex(lineText => lineText.includes(snippet)) + 1
}

// The key of the button drawn for a name: the first place the snippet is written in the file, and the name within it.
function columnOfName(textByPath: Record<string, string>, path: string, snippet: string, name: string): { lineNumber: number; column: number } {
  const lines = (textByPath[path] ?? '').split('\n')
  const lineIndex = lines.findIndex(lineText => lineText.includes(snippet))
  const lineText = lines[lineIndex] ?? ''

  return { lineNumber: lineIndex + 1, column: lineText.indexOf(snippet) + snippet.indexOf(name) }
}

// The name itself, whose click points at it.
export function tokenKeyOf(textByPath: Record<string, string>, path: string, snippet: string, name: string): string {
  const { lineNumber, column } = columnOfName(textByPath, path, snippet, name)

  return tokenButtonKey(lineNumber, column)
}

// The tag shown over the name as the pointer rests on it, whose click goes to the declaration or lists the usages.
export function clickHintKeyOf(textByPath: Record<string, string>, path: string, snippet: string, name: string): string {
  const { lineNumber, column } = columnOfName(textByPath, path, snippet, name)

  return tokenHintKey(lineNumber, column)
}

export async function shownPath(pane: Mounted<'terminal', 'Pane'>, textByPath: Record<string, string>): Promise<string | undefined> {
  // The header writes the path of the file shown, cut at its end when it is long.
  const headerTexts = (await pane.findAll({ type: 'Text' })).filter(element => element.props.wrap === 'truncate-end').map(element => element.text ?? '')

  return Object.keys(textByPath).find(path => headerTexts.includes(path))
}

// The gutter of each row drawn, its line number and the mark before it ('▸' pointed at, '◆' a bookmark): a button
// while the pane takes clicks, plain text under the search.
async function gutterRows(pane: Mounted<'terminal', 'Pane'>): Promise<Array<{ lineNumber: number; text: string }>> {
  const gutterButtons = (await pane.findAll({ type: 'Button' })).filter(element => /^gutter-\d+$/.test(element.key ?? ''))
  if (gutterButtons.length > 0) {
    return gutterButtons.map(element => ({ lineNumber: Number((element.key ?? '').slice('gutter-'.length)), text: element.text ?? '' }))
  }

  return (await pane.findAll({ type: 'Text', text: /^[ ▸◆]\s*\d+ $/ })).map(element => ({ lineNumber: Number((element.text ?? '').replace(/[^\d]/g, '')), text: element.text ?? '' }))
}

export async function firstShownLineNumber(pane: Mounted<'terminal', 'Pane'>): Promise<number> {
  return (await gutterRows(pane))[0]?.lineNumber ?? 0
}

export async function markedLineNumber(pane: Mounted<'terminal', 'Pane'>): Promise<number | null> {
  return (await gutterRows(pane)).find(row => row.text.startsWith('▸'))?.lineNumber ?? null
}

export async function resultRowTexts(pane: Mounted<'terminal', 'Pane'>): Promise<string[]> {
  return (await pane.findAll({ type: 'Button' })).filter(element => (element.key ?? '').startsWith('result-row-')).map(element => element.text ?? '')
}

export async function paletteItemTexts(pane: Mounted<'terminal', 'Pane'>): Promise<string[]> {
  return (await pane.findAll({ type: 'Button' })).filter(element => (element.key ?? '').startsWith('palette-item-')).map(element => element.text ?? '')
}

export async function paletteFieldKeyOf(pane: Mounted<'terminal', 'Pane'>): Promise<string> {
  return (await pane.findAll({ type: 'Input' })).map(element => element.key ?? '').find(key => key.startsWith('palette-field-')) ?? ''
}

// The tabs as the strip or the column draws them, the active one marked "*".
export async function tabTexts(pane: Mounted<'terminal', 'Pane'>): Promise<string[]> {
  const tabButtons = (await pane.findAll({ type: 'Button' })).filter(element => new RegExp(`^(strip-)?${TAB_BUTTON_KEY_PREFIX}\\d+$`).test(element.key ?? ''))

  return tabButtons.map(element => String(element.props.label ?? '').replace(/ \(shown\)$/, ' *'))
}

// The explorer's rows as drawn, each with its indent and its folding mark.
export async function treeRowTexts(pane: Mounted<'terminal', 'Pane'>): Promise<string[]> {
  return (await pane.findAll({ type: 'Button' })).filter(element => (element.key ?? '').startsWith('tree-row-')).map(element => element.text ?? '')
}

// Opens the drawer of files from the header's button and waits for it to slide open.
export async function openFilesDrawer(pane: Mounted<'terminal', 'Pane'>, world: World): Promise<void> {
  await pane.press({ key: 'files-toggle' })
  await world.clock.advance(500)
}
