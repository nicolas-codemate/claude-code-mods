import type { SymbolEntry } from '../types'
import type { Analysis, NavigatedLanguageSupport } from './language-support'
import { genericSymbolsOfFile } from './outline/generic-outline'
import { PHP_LANGUAGE } from './php/language'
import { SCRIPT_LANGUAGE } from './script/language'
import { findTextImplementations, findTextParents, findTextUsages, resolveTextDefinition } from './text-analysis'

// The languages navigated by their meaning. Any other file is navigated by its words: its structure read from the
// shapes its format declares names with, a name looked up as a whole word across the project.
export type NavigatedLanguage = 'php' | 'script'

export const NAVIGATED_LANGUAGES: Readonly<Record<NavigatedLanguage, NavigatedLanguageSupport>> = {
  php: PHP_LANGUAGE,
  script: SCRIPT_LANGUAGE,
}

const TEXT_ANALYSIS: Analysis = {
  definition: resolveTextDefinition,
  usages: findTextUsages,
  implementations: findTextImplementations,
  parents: findTextParents,
}

const NAVIGATED_LANGUAGE_BY_EXTENSION = new Map<string, NavigatedLanguage>(
  (Object.entries(NAVIGATED_LANGUAGES) as [NavigatedLanguage, NavigatedLanguageSupport][]).flatMap(([language, support]) =>
    support.extensions.map(extension => [extension, language] as const),
  ),
)

export function navigatedLanguageOfPath(path: string): NavigatedLanguage | null {
  const fileName = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const dotOffset = fileName.lastIndexOf('.')

  return dotOffset === -1 ? null : (NAVIGATED_LANGUAGE_BY_EXTENSION.get(fileName.slice(dotOffset + 1)) ?? null)
}

export function analysisOfPath(path: string): Analysis {
  const language = navigatedLanguageOfPath(path)

  return language === null ? TEXT_ANALYSIS : NAVIGATED_LANGUAGES[language].analysis
}

export function symbolsOfFileInAnyLanguage(path: string, text: string): SymbolEntry[] {
  const language = navigatedLanguageOfPath(path)

  return language === null ? genericSymbolsOfFile(path, text) : NAVIGATED_LANGUAGES[language].symbolsOfFile(path, text)
}

