import type { ChangedFile } from '../types'

// Files a reviewer rarely reads line by line: lockfiles, minified or generated output, snapshots, vendored code.
const NOISE_PATTERNS: readonly RegExp[] = [
  /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|Gemfile\.lock|Cargo\.lock|poetry\.lock|Pipfile\.lock|go\.sum)$/,
  /\.lock$/,
  /\.min\.(js|css)$/,
  /\.(js|css)\.map$/,
  /\.snap$/,
  /(^|\/)(dist|build|vendor|node_modules|__generated__)\//,
]

export function isNoiseFile(path: string): boolean {
  return NOISE_PATTERNS.some(pattern => pattern.test(path))
}

// Every word of the filter must appear in the path, in any order and case: "ctrl user" finds src/Controller/UserController.php.
export function matchesFileFilter(path: string, filter: string): boolean {
  const lowerCasePath = path.toLowerCase()

  return filter
    .toLowerCase()
    .split(/\s+/)
    .filter(word => word !== '')
    .every(word => lowerCasePath.includes(word))
}

export function visibleFilesOf(
  files: ChangedFile[],
  options: { filter: string; isNoiseShown: boolean },
): { files: ChangedFile[]; hiddenNoiseCount: number } {
  const matchingFiles = files.filter(file => matchesFileFilter(file.path, options.filter))
  if (options.isNoiseShown) {
    return { files: matchingFiles, hiddenNoiseCount: 0 }
  }
  const shownFiles = matchingFiles.filter(file => !isNoiseFile(file.path))

  return { files: shownFiles, hiddenNoiseCount: matchingFiles.length - shownFiles.length }
}
