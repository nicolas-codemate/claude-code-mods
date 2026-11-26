export type ComposerNamespacePrefix = { prefix: string; directories: string[] }

const SINGLE_QUOTED = "'((?:[^'\\\\]|\\\\.)*)'"
const DIRECTORY_EXPRESSION = `\\$(vendorDir|baseDir)(?:\\s*\\.\\s*${SINGLE_QUOTED})?`

const composerRootsByFileList = new WeakMap<readonly string[], string[]>()

function unescapeSingleQuoted(text: string): string {
  return text.replace(/\\([\\'])/g, '$1')
}

function joinPath(directory: string, relativePath: string): string {
  const trimmedRelativePath = relativePath.replace(/^\/+/, '')
  if (directory === '') {
    return trimmedRelativePath
  }

  return trimmedRelativePath === '' ? directory : `${directory}/${trimmedRelativePath}`
}

function directoryOfExpression(variableName: string | undefined, suffix: string | undefined, rootDirectory: string): string {
  const baseDirectory = variableName === 'vendorDir' ? joinPath(rootDirectory, 'vendor') : rootDirectory

  return joinPath(baseDirectory, unescapeSingleQuoted(suffix ?? ''))
}

// The directory of the nearest composer.json above a file: '' for the project root, null when there is none.
export function composerRootOf(path: string, projectFiles: readonly string[]): string | null {
  let composerRoots = composerRootsByFileList.get(projectFiles)
  if (composerRoots === undefined) {
    composerRoots = projectFiles
      .filter(filePath => filePath === 'composer.json' || filePath.endsWith('/composer.json'))
      .map(filePath => filePath.slice(0, Math.max(0, filePath.length - '/composer.json'.length)))
      .sort((first, second) => second.length - first.length)
    composerRootsByFileList.set(projectFiles, composerRoots)
  }

  return composerRoots.find(root => root === '' || path.startsWith(`${root}/`)) ?? null
}

export function composerAutoloadPath(rootDirectory: string, tableFileName: 'autoload_psr4.php' | 'autoload_classmap.php'): string {
  return joinPath(rootDirectory, `vendor/composer/${tableFileName}`)
}

// vendor/composer/autoload_psr4.php: 'App\\' => array($baseDir . '/src'), one entry per namespace prefix.
// The longest prefixes come first, as Composer tries them.
export function parseComposerNamespacePrefixes(autoloadText: string, rootDirectory: string): ComposerNamespacePrefix[] {
  const namespacePrefixes: ComposerNamespacePrefix[] = []
  for (const entry of autoloadText.matchAll(new RegExp(`${SINGLE_QUOTED}\\s*=>\\s*array\\(([^)]*)\\)`, 'g'))) {
    const directories = [...(entry[2] ?? '').matchAll(new RegExp(DIRECTORY_EXPRESSION, 'g'))].map(directory =>
      directoryOfExpression(directory[1], directory[2], rootDirectory),
    )
    namespacePrefixes.push({ prefix: unescapeSingleQuoted(entry[1] ?? ''), directories })
  }

  return namespacePrefixes.sort((first, second) => second.prefix.length - first.prefix.length)
}

// vendor/composer/autoload_classmap.php: 'Composer\\InstalledVersions' => $vendorDir . '/composer/InstalledVersions.php'.
export function parseComposerClassMap(autoloadText: string, rootDirectory: string): Map<string, string> {
  const pathByClassName = new Map<string, string>()
  for (const entry of autoloadText.matchAll(new RegExp(`${SINGLE_QUOTED}\\s*=>\\s*${DIRECTORY_EXPRESSION}`, 'g'))) {
    pathByClassName.set(unescapeSingleQuoted(entry[1] ?? ''), directoryOfExpression(entry[2], entry[3], rootDirectory))
  }

  return pathByClassName
}

// Where the class file may be, the most specific namespace prefix first; several directories may share a prefix.
export function candidatePathsOfClass(namespacePrefixes: readonly ComposerNamespacePrefix[], fullyQualifiedName: string): string[] {
  const candidatePaths: string[] = []
  for (const namespacePrefix of namespacePrefixes) {
    if (namespacePrefix.prefix !== '' && !fullyQualifiedName.startsWith(namespacePrefix.prefix)) {
      continue
    }
    const relativePath = `${fullyQualifiedName.slice(namespacePrefix.prefix.length).replaceAll('\\', '/')}.php`
    for (const directory of namespacePrefix.directories) {
      candidatePaths.push(joinPath(directory, relativePath))
    }
  }

  return candidatePaths
}
