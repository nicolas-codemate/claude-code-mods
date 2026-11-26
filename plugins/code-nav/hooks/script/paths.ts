// Paths are relative to the project root with forward slashes; the root itself is the empty string.

import { baseNameOf } from '../paths'

export function directoryOf(path: string): string {
  const lastSlashIndex = path.lastIndexOf('/')

  return lastSlashIndex === -1 ? '' : path.slice(0, lastSlashIndex)
}

export { baseNameOf } from '../paths'

export function baseNameWithoutExtension(path: string): string {
  const baseName = baseNameOf(path)
  const firstDotIndex = baseName.indexOf('.', 1)

  return firstDotIndex === -1 ? baseName : baseName.slice(0, firstDotIndex)
}

// Null when the relative path climbs above the project root.
export function joinPath(directory: string, relativePath: string): string | null {
  const segments = directory === '' ? [] : directory.split('/')
  for (const segment of relativePath.split('/')) {
    if (segment === '' || segment === '.') {
      continue
    }
    if (segment === '..') {
      if (segments.length === 0) {
        return null
      }
      segments.pop()
      continue
    }
    segments.push(segment)
  }

  return segments.join('/')
}

// The directories holding a path, the nearest first, the project root ("") last.
export function ancestorDirectoriesOf(path: string): string[] {
  const directories: string[] = []
  let directory = directoryOf(path)
  while (directory !== '') {
    directories.push(directory)
    directory = directoryOf(directory)
  }
  directories.push('')

  return directories
}

export function pathInDirectory(directory: string, relativePath: string): string {
  return directory === '' ? relativePath : `${directory}/${relativePath}`
}
