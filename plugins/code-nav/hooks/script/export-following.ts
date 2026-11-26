import type { ScriptDeclaration } from './declarations'
import { locatedDeclaration, locatedFile, locatedOffset } from './located'
import type { Located } from './located'
import { resolveModuleSpecifier } from './module-resolution'
import { directoryOf } from './paths'
import { isScriptPath } from './script-model'
import type { ScriptModel } from './script-model'
import { answeredOnce, modelOf, windowModelOfExport } from './session'
import type { AnalysisSession } from './session'

// package: the name comes from a dependency whose files could not be opened. unresolved: the path leads to no file,
// or the module exports no such name.
export type ImportResolution =
  { kind: 'located'; located: Located } | { kind: 'package'; packageName: string } | { kind: 'unresolved' }

const MAXIMUM_REEXPORT_DEPTH = 12
const UNRESOLVED: ImportResolution = { kind: 'unresolved' }

type Following = { visitedKeys: Set<string>; depth: number }

function topLevelBinding(model: ScriptModel, name: string): ScriptDeclaration | null {
  const bindings = model.structure.fileScope.declarations.filter(
    declaration => declaration.role === 'binding' && declaration.name === name,
  )

  return bindings.find(declaration => declaration.kind !== 'import') ?? bindings[0] ?? null
}

async function locateBinding(
  session: AnalysisSession,
  model: ScriptModel,
  binding: ScriptDeclaration,
  following: Following,
): Promise<ImportResolution> {
  if (binding.importBinding === null) {
    return { kind: 'located', located: locatedDeclaration(model, model.structure, binding) }
  }

  return followImport(session, model.path, binding.importBinding.specifier, binding.importBinding.importedName, following)
}

async function locateExport(
  session: AnalysisSession,
  modulePath: string,
  exportedName: string,
  following: Following,
): Promise<ImportResolution> {
  const visitKey = `${modulePath}#${exportedName}`
  if (following.depth > MAXIMUM_REEXPORT_DEPTH || following.visitedKeys.has(visitKey)) {
    return UNRESOLVED
  }
  following.visitedKeys.add(visitKey)
  if (exportedName === '*') {
    return { kind: 'located', located: locatedFile(modulePath) }
  }
  const model = await modelOf(session, modulePath)
  if (model === null) {
    const windowModel = isScriptPath(modulePath) ? await windowModelOfExport(session, modulePath, exportedName) : null
    const declaration = windowModel?.structure.fileScope.declarations.find(candidate => candidate.name === exportedName)

    return {
      kind: 'located',
      located:
        windowModel === null || declaration === undefined
          ? locatedFile(modulePath)
          : locatedDeclaration(windowModel, windowModel.structure, declaration),
    }
  }
  if (model.isVueComponent && exportedName === 'default') {
    return { kind: 'located', located: locatedFile(modulePath) }
  }
  const { structure } = model
  const deeper: Following = { visitedKeys: following.visitedKeys, depth: following.depth + 1 }
  for (const link of structure.exportLinks) {
    if (link.kind === 'named' && link.exportedName === exportedName) {
      if (link.specifier !== null) {
        return followImport(session, modulePath, link.specifier, link.localName, deeper)
      }
      const binding = topLevelBinding(model, link.localName)
      if (binding !== null) {
        return locateBinding(session, model, binding, deeper)
      }
    }
    if (link.kind === 'star' && link.namespaceName === exportedName) {
      return followImport(session, modulePath, link.specifier, '*', deeper)
    }
  }
  if (exportedName === 'default') {
    const defaultDeclaration = structure.fileScope.declarations.find(declaration => declaration.isDefaultExport)
    if (defaultDeclaration !== undefined) {
      return { kind: 'located', located: locatedDeclaration(model, structure, defaultDeclaration) }
    }
    const referenceToken =
      structure.defaultExport === null ? undefined : structure.tokens[structure.defaultExport.referenceTokenIndex ?? -1]
    const referencedBinding = referenceToken === undefined ? null : topLevelBinding(model, referenceToken.text)
    if (referencedBinding !== null) {
      return locateBinding(session, model, referencedBinding, deeper)
    }
    const defaultKeyword =
      structure.defaultExport === null ? undefined : structure.tokens[structure.defaultExport.tokenIndex]

    return {
      kind: 'located',
      located: defaultKeyword === undefined ? locatedFile(modulePath) : locatedOffset(model, defaultKeyword.start),
    }
  }
  const declaration = topLevelBinding(model, exportedName)
  if (declaration !== null && declaration.kind !== 'import') {
    return { kind: 'located', located: locatedDeclaration(model, structure, declaration) }
  }
  for (const link of structure.exportLinks) {
    if (link.kind === 'star' && link.namespaceName === null) {
      const resolution = await followImport(session, modulePath, link.specifier, exportedName, deeper, true)
      if (resolution.kind === 'located') {
        return resolution
      }
    }
  }

  return UNRESOLVED
}

async function followImport(
  session: AnalysisSession,
  fromPath: string,
  specifier: string,
  importedName: string,
  following: Following,
  mustExportTheName = false,
): Promise<ImportResolution> {
  const resolvedModule = await resolveModuleSpecifier(session, fromPath, specifier)
  if (resolvedModule.kind === 'unresolved') {
    return UNRESOLVED
  }
  const modulePath = resolvedModule.path
  if (modulePath === null) {
    return mustExportTheName || resolvedModule.kind !== 'dependency'
      ? UNRESOLVED
      : { kind: 'package', packageName: resolvedModule.packageName }
  }
  const resolution = await locateExport(session, modulePath, importedName, following)
  if (resolution.kind !== 'unresolved' || mustExportTheName) {
    return resolution
  }

  return { kind: 'located', located: locatedFile(modulePath) }
}

// Where the name a module exports is really declared, through "export { x } from", "export * from" and index files.
// A module that exports no such name answers its own first line: the import path is known, the name is not.
export function resolveImportedName(
  session: AnalysisSession,
  fromPath: string,
  specifier: string,
  importedName: string,
): Promise<ImportResolution> {
  return answeredOnce(session, `import\n${directoryOf(fromPath)}\n${specifier}\n${importedName}`, () =>
    followImport(session, fromPath, specifier, importedName, { visitedKeys: new Set(), depth: 0 }),
  )
}

export function locateExportedName(
  session: AnalysisSession,
  modulePath: string,
  exportedName: string,
): Promise<ImportResolution> {
  return locateExport(session, modulePath, exportedName, { visitedKeys: new Set(), depth: 0 })
}
