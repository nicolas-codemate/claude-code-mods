import type { CodePosition, ImplementationsAnswer, NavigationTarget, TargetCertainty } from '../../types'
import type { Workspace } from '../workspace'
import { membersNamed, valueScopeOf } from './declarations'
import type { ScriptDeclaration } from './declarations'
import { resolveClick } from './definition'
import { isSamePlace, keyOfLocated, locatedDeclaration } from './located'
import type { Located } from './located'
import { resolveNameAt } from './reference-resolution'
import { SCRIPT_FILE_GLOBS } from './script-model'
import { createAnalysisSession, modelOf } from './session'
import type { AnalysisSession } from './session'
import { labelOfDeclaration } from './symbols'
import { targetOfLocated, withoutDuplicateTargets } from './targets'

const MAXIMUM_INHERITANCE_DEPTH = 4
const MAXIMUM_MATCHES_PER_SEARCH = 500
const MAXIMUM_INHERITORS = 100
const NO_SYMBOL: ImplementationsAnswer = { symbol: null, title: '', targets: [], note: null }

type Inheritor = { located: Located; certainty: TargetCertainty }

function isClassOrInterface(declaration: ScriptDeclaration): boolean {
  return declaration.kind === 'class' || declaration.kind === 'interface'
}

// The classes and interfaces of one file that name one of these parents after "extends" or "implements": exact when
// the name is followed to the parent through the file's imports, candidate when nothing tells what the name is.
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
  const inheritors: Inheritor[] = []
  for (const declaration of structure.declarationAtToken.values()) {
    if (!isClassOrInterface(declaration)) {
      continue
    }
    for (const parentNameIndex of [...declaration.extendedNameIndexes, ...declaration.implementedNameIndexes]) {
      if (!parentNames.has(structure.tokens[parentNameIndex]?.text ?? '')) {
        continue
      }
      const resolution = await resolveNameAt(session, context, parentNameIndex)
      const isTheParent =
        resolution.kind === 'located' &&
        resolution.locations.some(located => parents.some(parent => isSamePlace(located, parent)))
      if (isTheParent || resolution.kind === 'unknown') {
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
    const parentNames = new Set(parents.flatMap(parent => (parent.declaration === null ? [] : [parent.declaration.name])))
    if (parentNames.size === 0) {
      break
    }
    const pattern = `\\b(?:extends|implements)\\b.*\\b(?:${[...parentNames].map(name => name.replace(/[$]/g, '\\$')).join('|')})\\b`
    const matches = await session.workspace.search(pattern, {
      globs: SCRIPT_FILE_GLOBS,
      maxMatches: MAXIMUM_MATCHES_PER_SEARCH,
    })
    const paths = [...new Set(matches.map(match => match.path))]
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
