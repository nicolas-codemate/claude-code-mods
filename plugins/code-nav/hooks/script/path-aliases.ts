import { directoryOf, joinPath } from './paths'

// One entry of compilerOptions.paths: "@/*" is the prefix "@/" with a wildcard, its targets paths from the project
// root where "*" stands for what the wildcard matched.
export type PathAlias = { prefix: string; suffix: string; hasWildcard: boolean; targets: string[] }

export type AliasConfiguration = {
  aliases: PathAlias[]
  // compilerOptions.baseUrl as a path from the project root: a bare specifier may be a path under it.
  baseDirectory: string | null
  // The configuration it extends, when that is a relative path, and the ones it references.
  extendedPath: string | null
  referencedPaths: string[]
}

// tsconfig.json and jsconfig.json allow comments and trailing commas. Null when the text is still no JSON.
export function parseJsonWithComments(text: string): unknown {
  let json = ''
  let index = 0
  while (index < text.length) {
    const character = text[index] ?? ''
    if (character === '"') {
      let stringEnd = index + 1
      while (stringEnd < text.length && text[stringEnd] !== '"') {
        stringEnd += text[stringEnd] === '\\' ? 2 : 1
      }
      json += text.slice(index, stringEnd + 1)
      index = stringEnd + 1
    } else if (character === '/' && text[index + 1] === '/') {
      const lineEnd = text.indexOf('\n', index)
      index = lineEnd === -1 ? text.length : lineEnd
    } else if (character === '/' && text[index + 1] === '*') {
      const commentEnd = text.indexOf('*/', index + 2)
      index = commentEnd === -1 ? text.length : commentEnd + 2
    } else {
      json += character
      index += 1
    }
  }
  try {
    return JSON.parse(json.replace(/,(\s*[}\]])/g, '$1'))
  } catch {
    return null
  }
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function configurationPathOf(reference: string, configurationDirectory: string): string | null {
  if (!reference.startsWith('.')) {
    return null
  }
  const path = joinPath(configurationDirectory, reference)
  if (path === null) {
    return null
  }

  return path.endsWith('.json') ? path : `${path}.json`
}

export function readAliasConfiguration(configurationText: string, configurationPath: string): AliasConfiguration {
  const configuration = recordOf(parseJsonWithComments(configurationText))
  const compilerOptions = recordOf(configuration['compilerOptions'])
  const configurationDirectory = directoryOf(configurationPath)
  const baseUrl = compilerOptions['baseUrl']
  const baseDirectory = typeof baseUrl === 'string' ? joinPath(configurationDirectory, baseUrl) : null
  const pathsDirectory = baseDirectory ?? configurationDirectory
  const aliases: PathAlias[] = []
  for (const [pattern, targetPatterns] of Object.entries(recordOf(compilerOptions['paths']))) {
    const wildcardIndex = pattern.indexOf('*')
    const targets = (Array.isArray(targetPatterns) ? targetPatterns : [])
      .filter((targetPattern): targetPattern is string => typeof targetPattern === 'string')
      .flatMap(targetPattern => {
        const wildcardIndexOfTarget = targetPattern.indexOf('*')
        const directoryPart = wildcardIndexOfTarget === -1 ? targetPattern : targetPattern.slice(0, wildcardIndexOfTarget)
        const target = joinPath(pathsDirectory, directoryPart)
        if (target === null) {
          return []
        }
        const endsWithSlash = directoryPart.endsWith('/') && target !== ''
        const targetPrefix = endsWithSlash ? `${target}/` : target

        return [
          wildcardIndexOfTarget === -1 ? targetPrefix : `${targetPrefix}*${targetPattern.slice(wildcardIndexOfTarget + 1)}`,
        ]
      })
    aliases.push({
      prefix: wildcardIndex === -1 ? pattern : pattern.slice(0, wildcardIndex),
      suffix: wildcardIndex === -1 ? '' : pattern.slice(wildcardIndex + 1),
      hasWildcard: wildcardIndex !== -1,
      targets,
    })
  }
  aliases.sort((first, second) => second.prefix.length - first.prefix.length)
  const extended = configuration['extends']
  const extendedReference =
    typeof extended === 'string' ? extended : Array.isArray(extended) && typeof extended[0] === 'string' ? extended[0] : null
  const references = Array.isArray(configuration['references']) ? configuration['references'] : []

  return {
    aliases,
    baseDirectory,
    extendedPath: extendedReference === null ? null : configurationPathOf(extendedReference, configurationDirectory),
    referencedPaths: references.flatMap(reference => {
      const referencePath = recordOf(reference)['path']
      const path = typeof referencePath === 'string' ? joinPath(configurationDirectory, referencePath) : null
      if (path === null) {
        return []
      }

      return [path.endsWith('.json') ? path : `${path}/tsconfig.json`]
    }),
  }
}

// The paths a specifier may stand for under these aliases, the most specific alias first.
export function pathsOfAliasedSpecifier(specifier: string, aliases: readonly PathAlias[]): string[] {
  const paths: string[] = []
  for (const alias of aliases) {
    if (!alias.hasWildcard) {
      if (specifier === alias.prefix) {
        paths.push(...alias.targets)
      }
      continue
    }
    const isMatch =
      specifier.startsWith(alias.prefix) &&
      specifier.endsWith(alias.suffix) &&
      specifier.length >= alias.prefix.length + alias.suffix.length
    if (isMatch) {
      const matchedPart = specifier.slice(alias.prefix.length, specifier.length - alias.suffix.length)
      paths.push(...alias.targets.map(target => target.replace('*', matchedPart)))
    }
  }

  return paths
}
