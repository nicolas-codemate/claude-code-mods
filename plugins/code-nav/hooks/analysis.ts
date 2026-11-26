import type { CodePosition, DefinitionAnswer, ImplementationsAnswer, UsagesAnswer } from '../types'
import { findPhpImplementations, findPhpParents, findPhpUsages, resolvePhpDefinition } from './php/analysis'
import { findScriptImplementations, findScriptParents, findScriptUsages, resolveScriptDefinition } from './script/analysis'
import { findTextImplementations, findTextParents, findTextUsages, resolveTextDefinition } from './text-analysis'
import type { Workspace } from './workspace'

// text: a language whose code the mod does not analyse, where a name is looked up as a word.
export type AnalysedLanguage = 'php' | 'script' | 'text'

const SCRIPT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue']

export function analysedLanguageOfPath(path: string): AnalysedLanguage {
  const lowerCasePath = path.toLowerCase()
  if (lowerCasePath.endsWith('.php')) {
    return 'php'
  }

  return SCRIPT_EXTENSIONS.some(extension => lowerCasePath.endsWith(extension)) ? 'script' : 'text'
}

type Analysis = {
  definition: (workspace: Workspace, position: CodePosition) => Promise<DefinitionAnswer>
  usages: (workspace: Workspace, position: CodePosition) => Promise<UsagesAnswer>
  implementations: (workspace: Workspace, position: CodePosition) => Promise<ImplementationsAnswer>
  parents: (workspace: Workspace, position: CodePosition) => Promise<ImplementationsAnswer>
}

const ANALYSES: Record<AnalysedLanguage, Analysis> = {
  php: { definition: resolvePhpDefinition, usages: findPhpUsages, implementations: findPhpImplementations, parents: findPhpParents },
  script: {
    definition: resolveScriptDefinition,
    usages: findScriptUsages,
    implementations: findScriptImplementations,
    parents: findScriptParents,
  },
  text: { definition: resolveTextDefinition, usages: findTextUsages, implementations: findTextImplementations, parents: findTextParents },
}

export function resolveDefinition(workspace: Workspace, position: CodePosition): Promise<DefinitionAnswer> {
  return ANALYSES[analysedLanguageOfPath(position.path)].definition(workspace, position)
}

export function findUsages(workspace: Workspace, position: CodePosition): Promise<UsagesAnswer> {
  return ANALYSES[analysedLanguageOfPath(position.path)].usages(workspace, position)
}

export function findImplementations(workspace: Workspace, position: CodePosition): Promise<ImplementationsAnswer> {
  return ANALYSES[analysedLanguageOfPath(position.path)].implementations(workspace, position)
}

// The inverse of implementations: on a method, the declarations it overrides or implements; on a class, the classes
// and interfaces above it.
export function findParents(workspace: Workspace, position: CodePosition): Promise<ImplementationsAnswer> {
  return ANALYSES[analysedLanguageOfPath(position.path)].parents(workspace, position)
}
