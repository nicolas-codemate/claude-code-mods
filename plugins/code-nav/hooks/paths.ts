// Paths are relative to the project root with forward slashes.

export function baseNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

