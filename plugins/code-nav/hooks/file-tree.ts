// One entry of a directory as the disk lists it.
export type DirectoryEntry = { name: string; isDirectory: boolean }

// One row of the explorer. An ignored entry is one git leaves out (vendor/, node_modules/, build output): it is
// listed and opened all the same, drawn apart.
export type TreeRow = { path: string; name: string; depth: number; isDirectory: boolean; isExpanded: boolean; isIgnored: boolean }

// What tells the project's own files from the ones git ignores: the files ripgrep listed and their directories.
export type ProjectMembership = { isKnown: boolean; files: ReadonlySet<string>; directories: ReadonlySet<string> }

export const ROOT_DIRECTORY = ''

// Never worth a row: the repository's own store.
const HIDDEN_ENTRY_NAMES = new Set(['.git'])

export function parentDirectoryOf(path: string): string {
  const lastSlashIndex = path.lastIndexOf('/')

  return lastSlashIndex === -1 ? ROOT_DIRECTORY : path.slice(0, lastSlashIndex)
}

export function childPathOf(directory: string, name: string): string {
  return directory === ROOT_DIRECTORY ? name : `${directory}/${name}`
}

// The directories holding a file, from the outermost: "src/Entity/Order.php" gives "src" then "src/Entity".
export function ancestorDirectoriesOf(path: string): string[] {
  const segments = path.split('/').slice(0, -1)

  return segments.map((_, segmentIndex) => segments.slice(0, segmentIndex + 1).join('/'))
}

export function projectMembershipOf(files: readonly string[], isKnown: boolean): ProjectMembership {
  const directories = new Set<string>()
  for (const file of files) {
    for (const directory of ancestorDirectoriesOf(file)) {
      directories.add(directory)
    }
  }

  return { isKnown, files: new Set(files), directories }
}

// Directories first, then files, each in the order of their names with no regard to case, as an editor lists them.
export function sortedEntries(entries: readonly DirectoryEntry[]): DirectoryEntry[] {
  return entries
    .filter(entry => !HIDDEN_ENTRY_NAMES.has(entry.name))
    .sort((first, second) => {
      if (first.isDirectory !== second.isDirectory) {
        return first.isDirectory ? -1 : 1
      }

      return first.name.localeCompare(second.name, undefined, { sensitivity: 'base', numeric: true })
    })
}

function isIgnoredEntry(path: string, isDirectory: boolean, membership: ProjectMembership): boolean {
  if (!membership.isKnown) {
    return false
  }

  return isDirectory ? !membership.directories.has(path) : !membership.files.has(path)
}

// The rows the explorer draws: every entry of each expanded directory listed so far, under its directory. A
// directory expanded but not listed yet shows nothing under it until its listing arrives.
export function treeRowsOf(
  entriesByDirectory: ReadonlyMap<string, readonly DirectoryEntry[]>,
  expandedDirectories: ReadonlySet<string>,
  membership: ProjectMembership,
): TreeRow[] {
  const rows: TreeRow[] = []
  const addRowsOf = (directory: string, depth: number, isInsideIgnored: boolean) => {
    for (const entry of entriesByDirectory.get(directory) ?? []) {
      const path = childPathOf(directory, entry.name)
      const isIgnored = isInsideIgnored || isIgnoredEntry(path, entry.isDirectory, membership)
      const isExpanded = entry.isDirectory && expandedDirectories.has(path)
      rows.push({ path, name: entry.name, depth, isDirectory: entry.isDirectory, isExpanded, isIgnored })
      if (isExpanded) {
        addRowsOf(path, depth + 1, isIgnored)
      }
    }
  }
  addRowsOf(ROOT_DIRECTORY, 0, false)

  return rows
}

// The expanded directories whose entries are still to be listed, the outermost first.
export function directoriesToList(entriesByDirectory: ReadonlyMap<string, unknown>, expandedDirectories: ReadonlySet<string>): string[] {
  return [ROOT_DIRECTORY, ...[...expandedDirectories].sort((first, second) => first.length - second.length)].filter(
    directory => !entriesByDirectory.has(directory),
  )
}

// The first row to show so that the row asked for is in sight, a quarter of the way down when it was out of it.
export function treeOffsetShowing(rowIndex: number, currentOffset: number, visibleRows: number, rowCount: number): number {
  const lastOffset = Math.max(0, rowCount - visibleRows)
  if (rowIndex >= currentOffset && rowIndex < currentOffset + visibleRows) {
    return Math.min(currentOffset, lastOffset)
  }

  return Math.max(0, Math.min(lastOffset, rowIndex - Math.floor(visibleRows / 4)))
}
