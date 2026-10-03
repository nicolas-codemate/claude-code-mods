import type { On } from 'claude-code'
import { mock } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'

// A repository with one modified file, one new file, a PR base two files away and two commits on the branch.
export const ROOT = '/work/shop'
export const FILE_DIFF = ['@@ -1,2 +1,3 @@', ' <?php', '-$total = 1;', '+$total = 2;', '+$tax = 0.2;'].join('\n')

type CommandAnswer = { exitCode: number; stdout: string; stderr?: string }

const GIT_ANSWERS: Record<string, string> = {
  'rev-parse --show-toplevel': `${ROOT}\n`,
  'rev-parse --abbrev-ref origin/HEAD': 'origin/main\n',
  'rev-parse --abbrev-ref HEAD': 'feat/tax\n',
  'remote get-url origin': 'git@github.com:acme/shop.git\n',
  'merge-base HEAD origin/main': 'base000\n',
  'diff --numstat --summary --no-renames HEAD': '2\t1\tsrc/Total.php\n',
  'ls-files --others --exclude-standard': 'notes.md\n',
  'diff --numstat --summary --no-renames base000 HEAD': '5\t0\tsrc/Tax.php\n2\t1\tsrc/Total.php\n create mode 100644 src/Tax.php\n',
  'diff --numstat --summary --no-renames c2~1 c2': '5\t0\tsrc/Tax.php\n',
  'diff --numstat --summary --no-renames c1~1 c1': '2\t1\tsrc/Total.php\n',
}
const COMMIT_LOG = [
  '* c2\u001fc2s\u001fAdd tax\u001fSomeone\u001f1 hour ago\u001fHEAD -> feat/tax',
  '* c1\u001fc1s\u001fFix total\u001fSomeone\u001f2 hours ago\u001f',
  'o base000\u001fbase\u001fRelease\u001fSomeone\u001f1 day ago\u001forigin/main',
  '',
].join('\n')

export function defaultGitAnswer(gitCommand: string): CommandAnswer {
  const stdout = GIT_ANSWERS[gitCommand]
  if (stdout !== undefined) {
    return { exitCode: 0, stdout }
  }
  if (gitCommand.startsWith('log ')) {
    return { exitCode: 0, stdout: COMMIT_LOG }
  }
  if (gitCommand.startsWith('diff --no-color')) {
    return { exitCode: 0, stdout: FILE_DIFF }
  }

  return { exitCode: 1, stdout: '' }
}

export type WorldOptions = {
  // An answer for a git command (its arguments joined, without -C), or undefined to keep the default one.
  git?: (gitCommand: string) => CommandAnswer | undefined
  // An answer for a gh command (its arguments joined); gh fails when this is absent or answers undefined.
  gh?: (ghCommand: string) => CommandAnswer | undefined
  keyboardLayoutSource?: string
  newFileContent?: string
  withStore?: boolean
  storeEntries?: Record<string, unknown>
  withFocus?: boolean
}

export type World = {
  submittedPrompts: Array<{ text: string; context?: readonly string[] }>
  requestedPaneColumns: Array<number | undefined>
  closedPaneIds: string[]
  openedUrls: string[]
  store: Map<string, unknown>
  clock: ReturnType<typeof mock.clock>
}

export function stubWorld(on: On, options: WorldOptions = {}): World {
  const world: World = {
    submittedPrompts: [],
    requestedPaneColumns: [],
    closedPaneIds: [],
    openedUrls: [],
    store: new Map(Object.entries(options.storeEntries ?? {})),
    clock: mock.clock(on, { now: 1000 }),
  }
  if (options.withStore || options.storeEntries) {
    on('store.get', async (_, e) => ({ value: world.store.get(e.key) }) as never)
    on('store.set', async (_, e) => {
      world.store.set(e.key, JSON.parse(JSON.stringify(e.value)))
      return { value: undefined } as never
    })
  }
  on('process.run', async (_, e) => {
    const [program = '', ...programArguments] = e.argv
    let answer: CommandAnswer | undefined
    if (program === 'git') {
      const gitCommand = programArguments.filter(argument => argument !== '-C' && argument !== ROOT).join(' ')
      answer = options.git?.(gitCommand) ?? defaultGitAnswer(gitCommand)
    } else if (program === 'gh') {
      answer = options.gh?.(programArguments.join(' '))
    } else if (program === 'xdg-open') {
      world.openedUrls.push(programArguments[0] ?? '')
      answer = { exitCode: 0, stdout: '' }
    } else if (program === 'gsettings' && options.keyboardLayoutSource) {
      answer = { exitCode: 0, stdout: options.keyboardLayoutSource }
    }
    const { exitCode, stdout, stderr } = answer ?? { exitCode: 1, stdout: '', stderr: 'not stubbed' }

    return { value: { exitCode, stdout, stderr: stderr ?? '' } } as never
  })
  on('fs.read', async () => ({ value: options.newFileContent ?? '' }) as never)
  on('command.register', async (_, e) => ({ value: { command: e.name } }) as never)
  on('session.start', async () => ({ cwd: ROOT }) as never)
  on('session.end', async (_, e) => ({ sessionId: e.sessionId }) as never)
  on('session.append', async (_, e) => ({ value: { message: e.message, uuid: 'row' } }) as never)
  on('ui.open', async (_, e) => {
    world.requestedPaneColumns.push(e.columns)
    return { value: { isPlaced: true } } as never
  })
  on('ui.close', async (_, e) => {
    world.closedPaneIds.push(e.id)
    return { value: undefined } as never
  })
  on('ui.toast', async () => ({ value: undefined }) as never)
  if (options.withFocus) {
    on('ui.focus', async () => ({ value: undefined }) as never)
  }
  on('prompt.submit', async (_, e) => {
    world.submittedPrompts.push({ text: e.text, context: e.context })
    return { text: e.text, context: e.context } as never
  })
  on('turn.start', async (_, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)

  return world
}

export async function openExplorer($: Engine, terminalColumns = 300): Promise<void> {
  await $.session.start({ source: 'startup', cwd: ROOT } as never)
  await reopenExplorer($, terminalColumns)
}

export async function reopenExplorer($: Engine, terminalColumns = 300): Promise<void> {
  await $.command.run({ command: 'diff-review', args: '', presentation: { isFullscreen: true, columns: terminalColumns } } as never)
}

export type PaneOptions = { isFocused?: boolean; bodyColumns?: number; bodyRows?: number; placement?: 'dock' | 'inline' }

export function paneTarget(options: PaneOptions = {}) {
  return {
    plugin: 'diff-review',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'diff-review',
    props: {
      title: 'Review',
      isFocused: options.isFocused ?? true,
      bodyColumns: options.bodyColumns ?? 200,
      placement: options.placement ?? 'dock',
      ...(options.bodyRows ? { scroll: { offset: 0, bodyRows: options.bodyRows } } : {}),
    } as never,
  } as const
}

export async function mountPane($: Engine, options: PaneOptions = {}): Promise<Mounted<'terminal', 'Pane'>> {
  return $.ui.mount(paneTarget(options))
}

export async function keyStartingWith(pane: Mounted<'terminal', 'Pane'>, type: 'Input' | 'Button', prefix: string): Promise<string> {
  return (await pane.findAll({ type })).map(element => element.key ?? '').find(key => key.startsWith(prefix)) ?? ''
}

export async function hasQuestionField(pane: Mounted<'terminal', 'Pane'>): Promise<boolean> {
  return (await questionFieldKey(pane)) !== ''
}

export async function questionFieldKey(pane: Mounted<'terminal', 'Pane'>): Promise<string> {
  return keyStartingWith(pane, 'Input', 'question-')
}

export async function wheel($: Engine, column: number, by: number, bodyRows = 30): Promise<void> {
  await $.ui.scroll({
    component: 'Pane',
    requestId: 'diff-review',
    offset: 0,
    by,
    bodyRows,
    contentRows: bodyRows,
    origin: { kind: 'person' },
    pointer: { column, row: 10 },
  } as never)
}

export async function focusElement($: Engine, element: string): Promise<void> {
  await $.ui.focus({ component: 'Pane', requestId: 'diff-review', element, origin: { kind: 'person' } } as never)
}

export async function answerTurn($: Engine, turnId: string, question: string, answer: string): Promise<void> {
  await $.turn.start({ text: question, turnId } as never)
  await $.turn.complete({ turnId, answer, durationMs: 1, isAborted: false, reason: 'answer' } as never)
}
