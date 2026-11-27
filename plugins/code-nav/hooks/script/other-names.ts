import { wholeNamePattern } from '../symbol-names'
import type { Located } from './located'
import { resolveProjectModule } from './module-resolution'
import { baseNameOf, baseNameWithoutExtension, directoryOf } from './paths'
import type { ScriptModel } from './script-model'
import { modelOf } from './session'
import type { AnalysisSession } from './session'

// The word a file importing a module writes in its specifier: the module's file name, or its directory's for an index
// file ("./orders" for "orders/index.ts").
export function moduleWordOf(modulePath: string): string {
  const stem = baseNameWithoutExtension(modulePath)

  return stem === 'index' ? baseNameOf(directoryOf(modulePath)) : stem
}

export function isDefaultExportOfItsFile(located: Located): boolean {
  const { model, declaration } = located
  if (model === null || declaration === null || declaration.scope.kind !== 'file') {
    return false
  }
  const { structure } = model
  const referenceToken =
    structure.defaultExport === null ? undefined : structure.tokens[structure.defaultExport.referenceTokenIndex ?? -1]

  return declaration.isDefaultExport || referenceToken?.text === declaration.name
}

// A line importing the default export of a module, under whatever name the importing file gives it:
// "import Core from './base-service'".
export function defaultImportPattern(modulePath: string): string {
  return `\\bimport\\s+[\\w$]+\\b.*['"][^'"]*${wholeNamePattern(moduleWordOf(modulePath))}[^'"]*['"]`
}

// The names a file gives the default export of a module it imports.
export async function namesOfDefaultImportsIn(session: AnalysisSession, model: ScriptModel, modulePath: string): Promise<string[]> {
  const names: string[] = []
  for (const declaration of model.structure.fileScope.declarations) {
    const binding = declaration.importBinding
    if (
      binding !== null &&
      binding.importedName === 'default' &&
      (await resolveProjectModule(session, model.path, binding.specifier)) === modulePath
    ) {
      names.push(declaration.name)
    }
  }

  return names
}

// The other names an index file gives these: "export { fetchOrder as loadOrder } from './orders'" makes loadOrder a
// name to search as well, which no file using it would otherwise match.
export async function namesGivenByReexportsIn(
  session: AnalysisSession,
  paths: readonly string[],
  names: readonly string[],
): Promise<string[]> {
  const otherNames = new Set<string>()
  for (const path of paths) {
    const model = await modelOf(session, path)
    for (const link of model?.structure.exportLinks ?? []) {
      if (
        link.kind === 'named' &&
        names.includes(link.localName) &&
        !names.includes(link.exportedName) &&
        link.exportedName !== 'default'
      ) {
        otherNames.add(link.exportedName)
      }
    }
  }

  return [...otherNames]
}
