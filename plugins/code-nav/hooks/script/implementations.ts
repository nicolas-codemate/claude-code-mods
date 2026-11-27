import { wholeNamePattern } from '../symbol-names'
import type { CodePosition, ImplementationsAnswer, NavigationTarget, TargetCertainty } from '../../types'
import type { Workspace } from '../workspace'
import { membersNamed, valueScopeOf } from './declarations'
import type { ScriptDeclaration } from './declarations'
import { resolveClick } from './definition'
import { isSamePlace, keyOfLocated, locatedDeclaration } from './located'
import type { Located } from './located'
import { defaultImportPattern, isDefaultExportOfItsFile, namesGivenByReexportsIn, namesOfDefaultImportsIn } from './other-names'
import { resolveNameAt } from './reference-resolution'
import { SCRIPT_FILE_GLOBS } from './script-model'
import type { ScriptModel } from './script-model'
import { createAnalysisSession, modelOf } from './session'
import type { AnalysisSession } from './session'
import { labelOfDeclaration } from './symbols'
import { targetOfLocated, withoutDuplicateTargets } from './targets'

const MAXIMUM_INHERITANCE_DEPTH = 4
const MAXIMUM_MATCHES_PER_SEARCH = 500
const MAXIMUM_INHERITORS = 100
const MAXIMUM_REEXPORT_HOPS = 3
const NO_SYMBOL: ImplementationsAnswer = { symbol: null, title: '', targets: [], note: null }

type Inheritor = { located: Located; certainty: TargetCertainty }

function isClassOrInterface(declaration: ScriptDeclaration): boolean {
  return declaration.kind === 'class' || declaration.kind === 'interface'
}

// The names the parents go by across the project: their own, those index files give them, and the paths of the
// files that may write one of these names, or a name of their own for them, after "extends" or "implements".
async function filesNamingParents(
  session: AnalysisSession,
  parents: readonly Located[],
): Promise<{ paths: string[]; names: Set<string> }> {
  const names = new Set(parents.flatMap(parent => (parent.declaration === null ? [] : [parent.declaration.name])))
  const paths = new Set(parents.map(parent => parent.path))
  let namesToSearch = [...names]
  for (let hop = 0; hop < MAXIMUM_REEXPORT_HOPS && namesToSearch.length > 0; hop += 1) {
    const writtenNames = `(?:${namesToSearch.map(wholeNamePattern).join('|')})`
    // A heritage clause, an import or export line naming the parent, or a line of a list written one name per line:
    // the heritage clause continued on the next line, the import clause written over several lines.
    const pattern = [
      `\\b(?:extends|implements|import|export)\\b.*${writtenNames}`,
      `^\\s*${writtenNames}(?:\\s+as\\s+[\\w$]+)?\\s*[,{]?\\s*$`,
    ].join('|')
    const matches = await session.workspace.search(pattern, { globs: SCRIPT_FILE_GLOBS, maxMatches: MAXIMUM_MATCHES_PER_SEARCH })
    const matchedPaths = [...new Set(matches.map(match => match.path))]
    matchedPaths.forEach(path => paths.add(path))
    const otherNames = await namesGivenByReexportsIn(session, matchedPaths, [...names])
    namesToSearch = otherNames.filter(name => !names.has(name))
    namesToSearch.forEach(name => names.add(name))
  }
  for (const parent of parents.filter(isDefaultExportOfItsFile)) {
    const matches = await session.workspace.search(defaultImportPattern(parent.path), {
      globs: SCRIPT_FILE_GLOBS,
      maxMatches: MAXIMUM_MATCHES_PER_SEARCH,
    })
    matches.forEach(match => paths.add(match.path))
  }

  return { paths: [...paths], names }
}

// The names a file gives the parents through its imports: "{ BaseService as Base }", "import Core from './base'".
async function importedNamesOfParentsIn(
  session: AnalysisSession,
  model: ScriptModel,
  parents: readonly Located[],
  parentNames: ReadonlySet<string>,
): Promise<Set<string>> {
  const importedNames = new Set<string>()
  for (const declaration of model.structure.fileScope.declarations) {
    if (declaration.importBinding !== null && parentNames.has(declaration.importBinding.importedName)) {
      importedNames.add(declaration.name)
    }
  }
  for (const parent of parents.filter(isDefaultExportOfItsFile)) {
    for (const name of await namesOfDefaultImportsIn(session, model, parent.path)) {
      importedNames.add(name)
    }
  }

  return importedNames
}

// The classes and interfaces of one file that name one of these parents after "extends" or "implements": exact when
// the name is followed to the parent through the file's imports, candidate when nothing tells what the parent's own
// name stands for.
async function inheritorsInFile(
  session: AnalysisSession,
  path: string,
  parents: readonly Located[],
  parentNames: ReadonlySet<string>,
): Promise<Inheritor[]> {
  const model = await modelOf(session, path)
  if (model === null) {
    return []
  }
  const { structure } = model
  const context = { model, structure, templateLocalNames: null }
  const importedNames = await importedNamesOfParentsIn(session, model, parents, parentNames)
  const inheritors: Inheritor[] = []
  for (const declaration of structure.declarationAtToken.values()) {
    if (!isClassOrInterface(declaration)) {
      continue
    }
    for (const parentNameIndex of [...declaration.extendedNameIndexes, ...declaration.implementedNameIndexes]) {
      const writtenName = structure.tokens[parentNameIndex]?.text ?? ''
      const isParentName = parentNames.has(writtenName)
      if (!isParentName && !importedNames.has(writtenName)) {
        continue
      }
      const resolution = await resolveNameAt(session, context, parentNameIndex)
      const isTheParent =
        resolution.kind === 'located' &&
        resolution.locations.some(located => parents.some(parent => isSamePlace(located, parent)))
      if (isTheParent || (isParentName && resolution.kind === 'unknown')) {
        inheritors.push({
          located: locatedDeclaration(model, structure, declaration),
          certainty: isTheParent ? 'exact' : 'candidate',
        })
        break
      }
    }
  }

  return inheritors
}

// Every class or interface that extends or implements the given one, directly or through another inheritor.
async function inheritorsOf(session: AnalysisSession, root: Located): Promise<Inheritor[]> {
  const inheritors: Inheritor[] = []
  const seenKeys = new Set([keyOfLocated(root)])
  let parents = [root]
  for (
    let depth = 0;
    depth < MAXIMUM_INHERITANCE_DEPTH && parents.length > 0 && inheritors.length < MAXIMUM_INHERITORS;
    depth += 1
  ) {
    if (parents.every(parent => parent.declaration === null)) {
      break
    }
    const { paths, names: parentNames } = await filesNamingParents(session, parents)
    const foundByFile = await Promise.all(paths.map(path => inheritorsInFile(session, path, parents, parentNames)))
    const newInheritors = foundByFile.flat().filter(inheritor => {
      const key = keyOfLocated(inheritor.located)
      if (seenKeys.has(key)) {
        return false
      }
      seenKeys.add(key)

      return true
    })
    inheritors.push(...newInheritors)
    parents = newInheritors.filter(inheritor => inheritor.certainty === 'exact').map(inheritor => inheritor.located)
  }

  return inheritors
}

function membersOfInheritor(inheritor: Inheritor, memberName: string): Inheritor[] {
  const { model, structure, declaration } = inheritor.located
  const scope = model === null || structure === null || declaration === null ? null : valueScopeOf(structure, declaration)
  if (model === null || structure === null || scope === null) {
    return []
  }

  return membersNamed(scope, memberName).map(member => ({
    located: locatedDeclaration(model, structure, member),
    certainty: inheritor.certainty,
  }))
}

export async function findScriptImplementations(
  workspace: Workspace,
  position: CodePosition,
): Promise<ImplementationsAnswer> {
  const session = createAnalysisSession(workspace)
  const clickResolution = await resolveClick(session, position)
  if (clickResolution === null || clickResolution.symbol === null) {
    return NO_SYMBOL
  }
  const { symbol, resolution } = clickResolution
  const subject = resolution.kind === 'located' ? resolution.locations[0] : undefined
  const declaration = subject?.declaration ?? null
  const structure = subject?.structure ?? null
  if (subject === undefined || declaration === null || structure === null || subject.model === null) {
    return {
      symbol,
      title: symbol.name,
      targets: [],
      note: `${symbol.name} is neither a class nor an interface of the project`,
    }
  }
  const title = labelOfDeclaration(structure, declaration)
  const holderDeclaration = declaration.scope.owner
  let found: Inheritor[]
  if (isClassOrInterface(declaration)) {
    found = await inheritorsOf(session, subject)
  } else if (declaration.role === 'member' && holderDeclaration !== null && isClassOrInterface(holderDeclaration)) {
    const holder = locatedDeclaration(subject.model, structure, holderDeclaration)
    found = (await inheritorsOf(session, holder)).flatMap(inheritor => membersOfInheritor(inheritor, declaration.name))
  } else {
    return { symbol, title, targets: [], note: `${symbol.name} is neither a class nor an interface, nor a member of one` }
  }
  const exactFirst = [
    ...found.filter(inheritor => inheritor.certainty === 'exact'),
    ...found.filter(inheritor => inheritor.certainty === 'candidate'),
  ]
  const targets: NavigationTarget[] = await Promise.all(
    exactFirst.map(inheritor => targetOfLocated(session, inheritor.located, inheritor.certainty)),
  )

  return {
    symbol,
    title,
    targets: withoutDuplicateTargets(targets),
    note: targets.length === 0 ? `Nothing extends or implements ${title}` : null,
  }
}
