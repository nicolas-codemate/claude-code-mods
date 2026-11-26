// A place written by a person or by Claude: "src/Order.php", "src/Order.php:42", "src/Order.php#L42",
// "src/Order.php line 42".
export type WrittenPlace = { path: string; line: number | null }

const PLACE_PATTERNS: readonly RegExp[] = [/^(.+?):(\d+)(?::\d+)?$/, /^(.+?)#L(\d+)(?:-L?\d+)?$/, /^(.+?)\s+line\s+(\d+)$/i]

export function writtenPlaceOf(text: string): WrittenPlace {
  const trimmedText = text.trim()
  for (const pattern of PLACE_PATTERNS) {
    const parts = pattern.exec(trimmedText)
    if (parts) {
      return { path: parts[1] ?? trimmedText, line: Number(parts[2]) }
    }
  }

  return { path: trimmedText, line: null }
}

// The path as the project lists it, from its root; null for a place outside the project.
export function pathFromRoot(root: string, path: string): string | null {
  const rootWithSlash = root.endsWith('/') ? root : `${root}/`
  if (path.startsWith('/')) {
    return path.startsWith(rootWithSlash) ? normalizedPath(path.slice(rootWithSlash.length)) : null
  }

  return normalizedPath(path)
}

function normalizedPath(path: string): string | null {
  const keptSegments: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') {
      continue
    }
    if (segment === '..') {
      if (keptSegments.length === 0) {
        return null
      }
      keptSegments.pop()
    } else {
      keptSegments.push(segment)
    }
  }

  return keptSegments.join('/')
}

// "OrderRepository::save", "OrderRepository.save", "OrderRepository#save" and "OrderRepository->save" name a member
// and what holds it; a plain name holds nothing.
export type WrittenSymbol = { containerName: string | null; name: string }

const MEMBER_SEPARATOR_PATTERN = /^(.*[A-Za-z0-9_])(?:::|->|#|\.)\$?([A-Za-z_][A-Za-z0-9_]*)(?:\(\))?$/

export function writtenSymbolOf(text: string): WrittenSymbol {
  const trimmedText = text.trim().replace(/\(\)$/, '')
  const parts = MEMBER_SEPARATOR_PATTERN.exec(trimmedText)
  if (parts) {
    const containerPath = parts[1] ?? ''
    const containerName = containerPath.split(/[\\/.]/).pop() ?? containerPath

    return { containerName, name: parts[2] ?? trimmedText }
  }

  return { containerName: null, name: trimmedText.split('\\').pop() ?? trimmedText }
}
