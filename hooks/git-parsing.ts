import type { ChangedFile, CommitSummary, DiffRow, ReviewView } from '../types'

const LOG_FIELD_SEPARATOR = '\u001f'
export const LOG_FORMAT = ['%H', '%h', '%s', '%an', '%ar'].join('%x1f')

export function parseNumstat(numstatOutput: string): ChangedFile[] {
  return numstatOutput
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => {
      const [added = '-', removed = '-', ...pathParts] = line.split('\t')
      return {
        path: pathParts.join('\t'),
        addedLines: added === '-' ? null : Number(added),
        removedLines: removed === '-' ? null : Number(removed),
        isUntracked: false,
      }
    })
}

export function parseUntrackedFiles(lsFilesOutput: string): ChangedFile[] {
  return lsFilesOutput
    .split('\n')
    .filter(path => path.trim() !== '')
    .map(path => ({ path, addedLines: null, removedLines: null, isUntracked: true }))
}

export function parseCommitLog(logOutput: string): CommitSummary[] {
  return logOutput
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => {
      const [sha = '', shortSha = '', subject = '', author = '', relativeDate = ''] = line.split(LOG_FIELD_SEPARATOR)
      return { sha, shortSha, subject, author, relativeDate }
    })
}

// Only the hunks are kept: the header lines git prints before the first @@ (diff --git, index, ---, +++) carry nothing to review.
export function parseUnifiedDiff(diffOutput: string): DiffRow[] {
  const rows: DiffRow[] = []
  let oldNumber = 0
  let newNumber = 0
  let isInsideHunk = false

  for (const line of diffOutput.split('\n')) {
    const hunkHeader = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/)
    if (hunkHeader) {
      oldNumber = Number(hunkHeader[1])
      newNumber = Number(hunkHeader[2])
      isInsideHunk = true
      rows.push({ kind: 'hunk', oldNumber: null, newNumber: null, text: (hunkHeader[3] ?? '').trim() })
      continue
    }
    if (!isInsideHunk || line.startsWith('\\')) {
      continue
    }
    if (line.startsWith('+')) {
      rows.push({ kind: 'added', oldNumber: null, newNumber, text: line.slice(1) })
      newNumber += 1
    } else if (line.startsWith('-')) {
      rows.push({ kind: 'removed', oldNumber, newNumber: null, text: line.slice(1) })
      oldNumber += 1
    } else if (line.startsWith(' ')) {
      rows.push({ kind: 'context', oldNumber, newNumber, text: line.slice(1) })
      oldNumber += 1
      newNumber += 1
    }
  }

  return rows
}

// git diff arguments comparing what each view shows: the working tree against HEAD, the branch against its base, one commit against its parent.
export function diffRangeArguments(view: ReviewView, baseRef: string | null, commitSha: string | null): string[] | null {
  if (view === 'uncommitted') {
    return ['HEAD']
  }
  if (view === 'pr') {
    return baseRef ? [baseRef, 'HEAD'] : null
  }

  return commitSha ? [`${commitSha}~1`, commitSha] : null
}

export function anchorKeyOf(view: ReviewView, commitSha: string | null, path: string, row: DiffRow): string {
  return [view, commitSha ?? '', path, row.kind, row.oldNumber ?? '', row.newNumber ?? ''].join('|')
}

export function describeLineForPrompt(path: string, row: DiffRow): string {
  if (row.kind === 'removed') {
    return `${path}, removed line (was line ${row.oldNumber})`
  }

  return `${path}, line ${row.newNumber} (${row.kind === 'added' ? 'added' : 'unchanged context'})`
}

export function surroundingRows(rows: DiffRow[], rowIndex: number, radius: number): DiffRow[] {
  return rows.slice(Math.max(0, rowIndex - radius), rowIndex + radius + 1)
}

export function formatRowsAsDiff(rows: DiffRow[]): string {
  const marks = { hunk: '@@', context: ' ', added: '+', removed: '-' } as const

  return rows.map(row => (row.kind === 'hunk' ? `@@ ${row.text}` : `${marks[row.kind]} ${row.text}`)).join('\n')
}

export type FileGroup = { directory: string; files: ChangedFile[] }

export function groupFilesByDirectory(files: ChangedFile[]): FileGroup[] {
  const groups = new Map<string, ChangedFile[]>()
  for (const file of files) {
    const slashIndex = file.path.lastIndexOf('/')
    const directory = slashIndex === -1 ? '' : file.path.slice(0, slashIndex)
    groups.set(directory, [...(groups.get(directory) ?? []), file])
  }

  return [...groups.entries()]
    .sort(([firstDirectory], [secondDirectory]) => firstDirectory.localeCompare(secondDirectory))
    .map(([directory, groupFiles]) => ({
      directory,
      files: [...groupFiles].sort((first, second) => first.path.localeCompare(second.path)),
    }))
}

export function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

const FILE_TYPE_BADGES: ReadonlyArray<{ extensions: string[]; badge: string; color: string }> = [
  { extensions: ['php'], badge: 'php', color: '#8892bf' },
  { extensions: ['ts', 'tsx', 'mts', 'cts'], badge: 'ts', color: '#3d8fd6' },
  { extensions: ['js', 'jsx', 'mjs', 'cjs'], badge: 'js', color: '#e8d44d' },
  { extensions: ['json'], badge: '{}', color: '#cbcb41' },
  { extensions: ['md', 'mdx'], badge: 'md', color: '#5fa8d3' },
  { extensions: ['sh', 'bash', 'zsh'], badge: '$_', color: '#89e051' },
  { extensions: ['yml', 'yaml'], badge: 'yml', color: '#e06c75' },
  { extensions: ['css', 'scss', 'sass'], badge: '#', color: '#c678dd' },
  { extensions: ['html', 'twig', 'vue', 'svelte'], badge: '<>', color: '#e5804f' },
  { extensions: ['py'], badge: 'py', color: '#4b8bbe' },
  { extensions: ['go'], badge: 'go', color: '#00add8' },
  { extensions: ['xml', 'xlf', 'xliff'], badge: '<>', color: '#c0965c' },
  { extensions: ['sql'], badge: 'sql', color: '#d7a65f' },
  { extensions: ['lock'], badge: 'lck', color: '#7f848e' },
]

export function fileTypeBadgeOf(path: string): { badge: string; color: string } {
  const fileName = fileNameOf(path)
  const extension = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase() : ''
  const known = FILE_TYPE_BADGES.find(entry => entry.extensions.includes(extension))

  return known ? { badge: known.badge, color: known.color } : { badge: '··', color: '#7f848e' }
}
