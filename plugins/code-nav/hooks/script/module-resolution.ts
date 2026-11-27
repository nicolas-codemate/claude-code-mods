import { pathsOfAliasedSpecifier, readAliasConfiguration } from './path-aliases'
import type { AliasConfiguration, PathAlias } from './path-aliases'
import { ancestorDirectoriesOf, baseNameOf, directoryOf, joinPath, pathInDirectory } from './paths'
import { answeredOnce, readDependencyText, readText } from './session'
import type { AnalysisSession } from './session'

// project: a file of the project. dependency: a module of a package under node_modules, its file null when the
// package or its entry file could not be read. unresolved: a relative or aliased path that leads to no file.
export type ResolvedModule =
  | { kind: 'project'; path: string }
  | { kind: 'dependency'; packageName: string; path: string | null }
  | { kind: 'unresolved' }

const EXTENSIONS_TRIED = [
  '.ts', '.tsx', '.d.ts', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.mts', '.cts', '.d.mts', '.d.cts', '.json',
]
const SOURCE_EXTENSIONS_OF_COMPILED: Record<string, string[]> = {
  '.js': ['.ts', '.tsx', '.d.ts'],
  '.jsx': ['.tsx'],
  '.mjs': ['.mts', '.d.mts'],
  '.cjs': ['.cts', '.d.cts'],
}
const SUFFIXES_READ_FIRST = [
  '.ts', '/index.ts', '.d.ts', '.js', '/index.js', '.tsx', '.vue', '/index.d.ts', '.mjs', '.d.mts',
]
const CONFIGURATION_FILE_NAMES = ['tsconfig.json', 'jsconfig.json']
const MAXIMUM_EXTENDED_CONFIGURATIONS = 5
const DEPENDENCY_DIRECTORY = 'node_modules'

function isInDependency(path: string): boolean {
  return path.startsWith(`${DEPENDENCY_DIRECTORY}/`) || path.includes(`/${DEPENDENCY_DIRECTORY}/`)
}

// The files a path without its extension may stand for, in the order a bundler tries them.
export function candidatePathsOf(basePath: string): string[] {
  const candidates = [basePath]
  for (const [compiledExtension, sourceExtensions] of Object.entries(SOURCE_EXTENSIONS_OF_COMPILED)) {
    if (basePath.endsWith(compiledExtension)) {
      const pathWithoutExtension = basePath.slice(0, -compiledExtension.length)
      candidates.push(...sourceExtensions.map(extension => pathWithoutExtension + extension))
    }
  }
  candidates.push(...EXTENSIONS_TRIED.map(extension => basePath + extension))
  candidates.push(...EXTENSIONS_TRIED.map(extension => `${basePath}/index${extension}`))

  return candidates
}

function projectFileAt(session: AnalysisSession, basePath: string): string | null {
  return candidatePathsOf(basePath).find(candidate => session.projectPaths.has(candidate)) ?? null
}

// A file the project's list does not hold (a dependency, a generated file git ignores) exists when it can be read:
// each try is a read, so the likeliest spellings come first.
async function readableFileAt(session: AnalysisSession, basePath: string, maximumAttempts: number): Promise<string | null> {
  const lastSegment = basePath.slice(basePath.lastIndexOf('/') + 1)
  const hasExtension = lastSegment.includes('.')
  const candidates = candidatePathsOf(basePath)
  const likeliestCandidates = SUFFIXES_READ_FIRST.map(suffix => basePath + suffix)
  const orderedCandidates = hasExtension
    ? candidates
    : [...new Set([...likeliestCandidates, ...candidates.slice(1), basePath])]
  for (const candidate of orderedCandidates.slice(0, maximumAttempts)) {
    if ((await readDependencyText(session, candidate)) !== null) {
      return candidate
    }
  }

  return null
}

function aliasConfigurationAt(session: AnalysisSession, configurationPath: string): Promise<AliasConfiguration | null> {
  let configuration = session.aliasConfigurations.get(configurationPath)
  if (configuration === undefined) {
    configuration = readText(session, configurationPath).then(text =>
      text === null ? null : readAliasConfiguration(text, configurationPath),
    )
    session.aliasConfigurations.set(configurationPath, configuration)
  }

  return configuration
}

type EffectiveAliases = { aliases: PathAlias[]; baseDirectory: string | null }

// The aliases a configuration file gives: its own, else those of the file it extends, else those of the
// configurations it references (the layout of a Vite project, whose root file only lists the others).
async function effectiveAliasesOf(session: AnalysisSession, configurationPath: string): Promise<EffectiveAliases> {
  let currentPath: string | null = configurationPath
  let baseDirectory: string | null = null
  const referencedPaths: string[] = []
  for (let depth = 0; depth < MAXIMUM_EXTENDED_CONFIGURATIONS && currentPath !== null; depth += 1) {
    const configuration: AliasConfiguration | null = await aliasConfigurationAt(session, currentPath)
    if (configuration === null) {
      break
    }
    baseDirectory = baseDirectory ?? configuration.baseDirectory
    referencedPaths.push(...configuration.referencedPaths)
    if (configuration.aliases.length > 0) {
      return { aliases: configuration.aliases, baseDirectory }
    }
    currentPath = configuration.extendedPath
  }
  for (const referencedPath of referencedPaths) {
    const referenced = session.projectPaths.has(referencedPath) ? await aliasConfigurationAt(session, referencedPath) : null
    if (referenced !== null && referenced.aliases.length > 0) {
      return { aliases: referenced.aliases, baseDirectory: baseDirectory ?? referenced.baseDirectory }
    }
  }

  return { aliases: [], baseDirectory }
}

// matchesAnAlias tells a specifier an alias covers, whose path leads to no file, from the name of a package.
async function resolveThroughAliases(
  session: AnalysisSession,
  fromPath: string,
  specifier: string,
): Promise<{ path: string | null; matchesAnAlias: boolean }> {
  let matchesAnAlias = specifier.startsWith('@/') || specifier.startsWith('~/')
  for (const directory of ancestorDirectoriesOf(fromPath)) {
    const configurationPath = CONFIGURATION_FILE_NAMES.map(fileName => pathInDirectory(directory, fileName)).find(path =>
      session.projectPaths.has(path),
    )
    if (configurationPath === undefined) {
      continue
    }
    const { aliases, baseDirectory } = await effectiveAliasesOf(session, configurationPath)
    const aliasedBasePaths = pathsOfAliasedSpecifier(specifier, aliases)
    const basePaths =
      baseDirectory === null ? aliasedBasePaths : [...aliasedBasePaths, pathInDirectory(baseDirectory, specifier)]
    matchesAnAlias = matchesAnAlias || aliasedBasePaths.length > 0
    for (const basePath of basePaths) {
      const path = projectFileAt(session, basePath)
      if (path !== null) {
        return { path, matchesAnAlias }
      }
    }
    for (const basePath of aliasedBasePaths) {
      const path = await readableFileAt(session, basePath, 6)
      if (path !== null) {
        return { path, matchesAnAlias }
      }
    }
  }

  return { path: null, matchesAnAlias }
}

// "@/..." and "~/..." name the sources folder by a convention many bundler configurations set without a tsconfig.
function resolveThroughSourcesConvention(session: AnalysisSession, fromPath: string, specifier: string): string | null {
  if (!specifier.startsWith('@/') && !specifier.startsWith('~/')) {
    return null
  }
  const pathUnderSources = specifier.slice(2)
  for (const directory of ancestorDirectoriesOf(fromPath)) {
    const path =
      projectFileAt(session, pathInDirectory(directory, `src/${pathUnderSources}`)) ??
      (directory.endsWith('/src') || directory === 'src'
        ? projectFileAt(session, pathInDirectory(directory, pathUnderSources))
        : null)
    if (path !== null) {
      return path
    }
  }

  return null
}

export function packageNameOfSpecifier(specifier: string): string {
  const segments = specifier.split('/')

  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : (segments[0] ?? specifier)
}

export function packageNameOfDependencyPath(path: string): string {
  const pathInsideDependencies = path.slice(path.lastIndexOf(`${DEPENDENCY_DIRECTORY}/`) + DEPENDENCY_DIRECTORY.length + 1)

  return packageNameOfSpecifier(pathInsideDependencies)
}

// The node_modules folders a file sees, the nearest first: for a project file those beside a package.json above
// it, for a file of a dependency its own package's then the ones its path goes through.
function dependencyDirectoriesSeenFrom(session: AnalysisSession, fromPath: string): string[] {
  const directories: string[] = []
  for (const directory of ancestorDirectoriesOf(fromPath)) {
    const directoryName = baseNameOf(directory)
    const parentDirectory = directoryOf(directory)
    const parentName = baseNameOf(parentDirectory)
    const isRootOfDependencyPackage =
      !directoryName.startsWith('@') &&
      (parentName === DEPENDENCY_DIRECTORY ||
        (parentName.startsWith('@') && baseNameOf(directoryOf(parentDirectory)) === DEPENDENCY_DIRECTORY))
    const isRootOfProjectPackage =
      !isInDependency(`${directory}/`) &&
      (directory === '' || session.projectPaths.has(pathInDirectory(directory, 'package.json')))
    if (directoryName === DEPENDENCY_DIRECTORY) {
      directories.push(directory)
    } else if (isRootOfDependencyPackage || isRootOfProjectPackage) {
      directories.push(pathInDirectory(directory, DEPENDENCY_DIRECTORY))
    }
  }

  return directories
}

function stringField(record: unknown, fieldName: string): string | null {
  if (typeof record !== 'object' || record === null) {
    return null
  }
  const value = (record as Record<string, unknown>)[fieldName]

  return typeof value === 'string' ? value : null
}

function parsePackageManifest(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function entryFileOfPackage(
  session: AnalysisSession,
  packageDirectory: string,
  manifest: unknown,
): Promise<string | null> {
  const entryFields = ['types', 'typings', 'module', 'main']
  for (const fieldName of entryFields) {
    const entry = stringField(manifest, fieldName)
    const basePath = entry === null ? null : joinPath(packageDirectory, entry)
    const path = basePath === null ? null : await readableFileAt(session, basePath, 3)
    if (path !== null) {
      return path
    }
  }

  return readableFileAt(session, `${packageDirectory}/index`, 3)
}

async function locateInDependencies(session: AnalysisSession, fromPath: string, specifier: string): Promise<ResolvedModule> {
  const packageName = packageNameOfSpecifier(specifier)
  const pathInsidePackage = specifier.slice(packageName.length + 1)
  if (specifier.includes(':')) {
    return { kind: 'dependency', packageName: specifier, path: null }
  }
  for (const dependencyDirectory of dependencyDirectoriesSeenFrom(session, fromPath)) {
    const packageDirectory = `${dependencyDirectory}/${packageName}`
    const manifestText = await readDependencyText(session, `${packageDirectory}/package.json`)
    if (manifestText === null) {
      continue
    }
    if (pathInsidePackage !== '') {
      return {
        kind: 'dependency',
        packageName,
        path: await readableFileAt(session, `${packageDirectory}/${pathInsidePackage}`, 8),
      }
    }
    const manifest = parsePackageManifest(manifestText)
    const declaresItsTypes = stringField(manifest, 'types') !== null || stringField(manifest, 'typings') !== null
    if (!declaresItsTypes) {
      const typesPackageDirectory = `${dependencyDirectory}/@types/${packageName.replace('@', '').replace('/', '__')}`
      const typesManifestText = await readDependencyText(session, `${typesPackageDirectory}/package.json`)
      const typesEntry =
        typesManifestText === null
          ? null
          : await entryFileOfPackage(session, typesPackageDirectory, parsePackageManifest(typesManifestText))
      if (typesEntry !== null) {
        return { kind: 'dependency', packageName, path: typesEntry }
      }
    }

    return { kind: 'dependency', packageName, path: await entryFileOfPackage(session, packageDirectory, manifest) }
  }

  return { kind: 'dependency', packageName, path: null }
}

function isRelativeSpecifier(specifier: string): boolean {
  return specifier === '.' || specifier === '..' || specifier.startsWith('./') || specifier.startsWith('../')
}

// The project file a specifier names, without ever reading a dependency: what ranking candidates needs to know.
export async function resolveProjectModule(
  session: AnalysisSession,
  fromPath: string,
  specifier: string,
): Promise<string | null> {
  const specifierWithoutQuery = specifier.split('?')[0] ?? specifier
  if (isRelativeSpecifier(specifierWithoutQuery)) {
    const basePath = joinPath(directoryOf(fromPath), specifierWithoutQuery)

    return basePath === null ? null : projectFileAt(session, basePath)
  }

  return (
    (await resolveThroughAliases(session, fromPath, specifierWithoutQuery)).path ??
    resolveThroughSourcesConvention(session, fromPath, specifierWithoutQuery)
  )
}

// The file a module specifier names, as seen from the file that writes it.
export function resolveModuleSpecifier(
  session: AnalysisSession,
  fromPath: string,
  specifier: string,
): Promise<ResolvedModule> {
  return answeredOnce(session, `module\n${directoryOf(fromPath)}\n${specifier}`, () =>
    resolveModuleSpecifierOnce(session, fromPath, specifier),
  )
}

async function resolveModuleSpecifierOnce(
  session: AnalysisSession,
  fromPath: string,
  specifier: string,
): Promise<ResolvedModule> {
  const specifierWithoutQuery = specifier.split('?')[0] ?? specifier
  if (isRelativeSpecifier(specifierWithoutQuery)) {
    const basePath = joinPath(directoryOf(fromPath), specifierWithoutQuery)
    if (basePath === null) {
      return { kind: 'unresolved' }
    }
    const projectPath = projectFileAt(session, basePath)
    if (projectPath !== null) {
      return { kind: 'project', path: projectPath }
    }
    const readablePath = await readableFileAt(session, basePath, 8)
    if (readablePath === null) {
      return { kind: 'unresolved' }
    }

    return isInDependency(readablePath)
      ? { kind: 'dependency', packageName: packageNameOfDependencyPath(readablePath), path: readablePath }
      : { kind: 'project', path: readablePath }
  }
  if (!isInDependency(fromPath)) {
    const aliased = await resolveThroughAliases(session, fromPath, specifierWithoutQuery)
    const aliasedPath = aliased.path ?? resolveThroughSourcesConvention(session, fromPath, specifierWithoutQuery)
    if (aliasedPath !== null) {
      return { kind: 'project', path: aliasedPath }
    }
    if (aliased.matchesAnAlias) {
      return { kind: 'unresolved' }
    }
  }
  if (
    specifierWithoutQuery.startsWith('/') ||
    specifierWithoutQuery.startsWith('#') ||
    specifierWithoutQuery.startsWith('~')
  ) {
    return { kind: 'unresolved' }
  }

  return locateInDependencies(session, fromPath, specifierWithoutQuery)
}
