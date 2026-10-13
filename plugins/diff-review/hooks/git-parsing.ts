import type { ChangedFile, CommitGraphLine, CommitSummary, DiffRow, ReviewView, StageState } from '../types'

const LOG_FIELD_SEPARATOR = '\u001f'
export const LOG_FORMAT = ['%H', '%h', '%s', '%an', '%ar', '%D'].join('%x1f')

// git diff --numstat --summary: one tab-separated count line per file, then a " create mode" or " delete mode" line
// for each file the change creates or deletes.
export function parseNumstat(numstatOutput: string): ChangedFile[] {
  const lines = numstatOutput.split('\n')
  const creationByPath = new Map<string, 'created' | 'deleted'>()
  for (const line of lines) {
    const summary = line.match(/^ (create|delete) mode \d+ (.+)$/)
    if (summary?.[2]) {
      creationByPath.set(summary[2], summary[1] === 'create' ? 'created' : 'deleted')
    }
  }

  return lines
    .filter(line => line.includes('\t'))
    .map(line => {
      const [added = '-', removed = '-', ...pathParts] = line.split('\t')
      const path = pathParts.join('\t')
      const creation = creationByPath.get(path)
      return {
        path,
        addedLines: added === '-' ? null : Number(added),
        removedLines: removed === '-' ? null : Number(removed),
        isUntracked: false,
        ...(creation ? { creation } : {}),
      }
    })
}

// git status --porcelain: X is the index column, Y the working tree one; ?? marks a file git does not track yet.
export function stageStatesOf(statusOutput: string): Record<string, StageState> {
  const stageStateByPath: Record<string, StageState> = {}
  for (const line of statusOutput.split('\n')) {
    if (line.length < 4) {
      continue
    }
    const [indexColumn, workingTreeColumn] = [line[0], line[1]]
    const path = line.slice(3).split(' -> ').at(-1)?.replace(/^"(.*)"$/, '$1') ?? ''
    stageStateByPath[path] =
      indexColumn === ' ' || indexColumn === '?' ? 'unstaged' : workingTreeColumn === ' ' ? 'staged' : 'partlyStaged'
  }

  return stageStateByPath
}

export function parseUntrackedFiles(lsFilesOutput: string): ChangedFile[] {
  return lsFilesOutput
    .split('\n')
    .filter(path => path.trim() !== '')
    .map(path => ({ path, addedLines: null, removedLines: null, isUntracked: true }))
}

// git log --graph draws the lanes before the first field; --boundary adds the base commit, its lane marked with an o.
export function parseCommitGraph(logOutput: string): CommitGraphLine[] {
  return logOutput
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => {
      if (!line.includes(LOG_FIELD_SEPARATOR)) {
        return { graph: line.trimEnd(), commit: null, isBoundary: false }
      }
      const [graphAndSha = '', shortSha = '', subject = '', author = '', relativeDate = '', decoration = ''] =
        line.split(LOG_FIELD_SEPARATOR)
      const shaMatch = graphAndSha.match(/^(.*\s)?(\S+)$/)
      const graph = shaMatch?.[1] ?? ''
      const refs = decoration
        .split(',')
        .map(ref => ref.trim().replace(/^HEAD -> /, ''))
        .filter(ref => ref !== '' && ref !== 'HEAD')

      return {
        graph: graph.trimEnd(),
        commit: { sha: shaMatch?.[2] ?? graphAndSha, shortSha, subject, author, relativeDate, refs },
        isBoundary: graph.trimEnd().endsWith('o'),
      }
    })
}

export function commitsOfGraph(graph: CommitGraphLine[]): CommitSummary[] {
  return graph.flatMap(line => (line.commit && !line.isBoundary ? [line.commit] : []))
}

// The web page of the repository behind a remote, from its SSH (git@host:owner/name.git) or HTTPS spelling.
export function repositoryWebUrlOf(remoteUrl: string): string | null {
  const match = remoteUrl.trim().match(/^(?:https:\/\/(?:[^@/]+@)?|ssh:\/\/git@|git@)([^/:]+)[/:](.+?)(?:\.git)?\/?$/)

  return match ? `https://${match[1]}/${match[2]}` : null
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

// Without context lines each hunk header says where its change sits in the new file; a hunk that only removes lines
// gives the line just above the removal.
export function changedNewLinesOf(zeroContextDiffOutput: string): number[] {
  return zeroContextDiffOutput.split('\n').flatMap(line => {
    const hunkHeader = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/)
    if (!hunkHeader) {
      return []
    }
    const start = Number(hunkHeader[1])
    const lineCount = hunkHeader[2] === undefined ? 1 : Number(hunkHeader[2])

    return lineCount === 0 ? [Math.max(1, start)] : Array.from({ length: lineCount }, (_, offset) => start + offset)
  })
}

// Opening on what is still to be done: the uncommitted changes, else the branch's pull request; on a branch with
// neither, the uncommitted view says there is nothing.
export function openingViewOf(uncommittedFileCount: number, branchCommitCount: number): ReviewView {
  if (uncommittedFileCount === 0 && branchCommitCount > 0) {
    return 'pr'
  }

  return 'uncommitted'
}

export function diffRangeArguments(view: ReviewView, baseRef: string | null, commitSha: string | null): string[] | null {
  if (view === 'uncommitted') {
    return ['HEAD']
  }
  if (view === 'pr') {
    return baseRef ? [baseRef, 'HEAD'] : null
  }

  return commitSha ? [`${commitSha}~1`, commitSha] : null
}


export type FileGroup = { directory: string; files: ChangedFile[] }

export function directoryOf(path: string): string {
  const slashIndex = path.lastIndexOf('/')
  return slashIndex === -1 ? '' : path.slice(0, slashIndex)
}

export function groupFilesByDirectory(files: ChangedFile[]): FileGroup[] {
  const groups = new Map<string, ChangedFile[]>()
  for (const file of files) {
    const directory = directoryOf(file.path)
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
