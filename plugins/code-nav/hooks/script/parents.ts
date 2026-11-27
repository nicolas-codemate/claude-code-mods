import type { CodePosition, ImplementationsAnswer, NavigationTarget } from '../../types'
import type { Workspace } from '../workspace'
import { membersNamed, valueScopeOf } from './declarations'
import type { ScriptDeclaration } from './declarations'
import { resolveClick } from './definition'
import { keyOfLocated, locatedDeclaration } from './located'
import type { Located } from './located'
import { resolveNameAt } from './reference-resolution'
import { createAnalysisSession } from './session'
import type { AnalysisSession } from './session'
import { labelOfDeclaration } from './symbols'
import { targetOfLocated, withoutDuplicateTargets } from './targets'

const MAXIMUM_ANCESTORS = 40
const NO_SYMBOL: ImplementationsAnswer = { symbol: null, title: '', targets: [], note: null }

type ScriptAncestors = { ancestors: Located[]; unfollowedNames: string[] }

function isClassOrInterface(declaration: ScriptDeclaration | null): boolean {
  return declaration !== null && (declaration.kind === 'class' || declaration.kind === 'interface')
}

// The classes and interfaces a declaration names after "extends" and "implements", followed through its imports.
// A name that leads nowhere readable (a package not installed, a global) is kept aside, as written.
async function parentsOf(session: AnalysisSession, child: Located): Promise<ScriptAncestors> {
  const { model, structure, declaration } = child
  if (model === null || structure === null || declaration === null) {
    return { ancestors: [], unfollowedNames: [] }
  }
  const context = { model, structure, templateLocalNames: null }
  const parents: Located[] = []
  const unfollowedNames: string[] = []
  for (const parentNameIndex of [...declaration.extendedNameIndexes, ...declaration.implementedNameIndexes]) {
    const writtenName = structure.tokens[parentNameIndex]?.text ?? ''
    const resolution = await resolveNameAt(session, context, parentNameIndex)
    switch (resolution.kind) {
      case 'located': {
        const located = resolution.locations.filter(location => isClassOrInterface(location.declaration))
        parents.push(...located)
        if (located.length === 0) {
          unfollowedNames.push(writtenName)
        }
        break
      }
      case 'package':
      case 'explained':
      case 'unknown':
        unfollowedNames.push(writtenName)
        break
      default: {
        const unhandledResolution: never = resolution

        return unhandledResolution
      }
    }
  }

  return { ancestors: parents, unfollowedNames }
}

// The classes and interfaces above a class or an interface, level by level so that the nearest come first, each once.
async function ancestorsOf(session: AnalysisSession, root: Located): Promise<ScriptAncestors> {
  const ancestors: Located[] = []
  const unfollowedNames: string[] = []
  const seenKeys = new Set([keyOfLocated(root)])
  let levelClasses = [root]
  while (levelClasses.length > 0 && ancestors.length < MAXIMUM_ANCESTORS) {
    const nextLevelClasses: Located[] = []
    for (const child of levelClasses) {
      const parents = await parentsOf(session, child)
      unfollowedNames.push(...parents.unfollowedNames)
      for (const parent of parents.ancestors) {
        const key = keyOfLocated(parent)
        if (!seenKeys.has(key)) {
          seenKeys.add(key)
          ancestors.push(parent)
          nextLevelClasses.push(parent)
        }
      }
    }
    levelClasses = nextLevelClasses
  }

  return { ancestors, unfollowedNames: [...new Set(unfollowedNames)] }
}

function membersOfAncestor(ancestor: Located, memberName: string): Located[] {
  const { model, structure, declaration } = ancestor
  const scope = structure === null || declaration === null ? null : valueScopeOf(structure, declaration)
  if (model === null || structure === null || scope === null) {
    return []
  }

  return membersNamed(scope, memberName).map(member => locatedDeclaration(model, structure, member))
}

function unfollowedParentsSentence(unfollowedNames: readonly string[]): string {
  return unfollowedNames.length === 0 ? '' : ` Could not be followed: ${unfollowedNames.join(', ')}.`
}

// On a class or an interface, the classes and interfaces above it; on a member of one, its declarations in those:
// what the member overrides or implements.
export async function findScriptParents(workspace: Workspace, position: CodePosition): Promise<ImplementationsAnswer> {
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
  const subjectLabel = labelOfDeclaration(structure, declaration)
  const title = subjectLabel
  const holderDeclaration = declaration.scope.owner
  if (isClassOrInterface(declaration)) {
    const { ancestors, unfollowedNames } = await ancestorsOf(session, subject)
    const targets = await Promise.all(ancestors.map(ancestor => targetOfLocated(session, ancestor, 'exact')))
    const emptyNote = `${subjectLabel} has no parent class or interface.${unfollowedParentsSentence(unfollowedNames)}`

    return { symbol, title, targets: withoutDuplicateTargets(targets), note: targets.length === 0 ? emptyNote : null }
  }
  if (declaration.role !== 'member' || holderDeclaration === null || !isClassOrInterface(holderDeclaration)) {
    return {
      symbol,
      title: subjectLabel,
      targets: [],
      note: `${symbol.name} is neither a class nor an interface, nor a member of one`,
    }
  }
  const holder = locatedDeclaration(subject.model, structure, holderDeclaration)
  const { ancestors, unfollowedNames } = await ancestorsOf(session, holder)
  const parentMembers = ancestors.flatMap(ancestor => membersOfAncestor(ancestor, declaration.name))
  const targets: NavigationTarget[] = await Promise.all(
    parentMembers.map(member => targetOfLocated(session, member, 'exact')),
  )
  const emptyNote =
    `${declaration.name} overrides nothing: ${holderDeclaration.name} has no parent declaring it.` +
    unfollowedParentsSentence(unfollowedNames)

  return { symbol, title, targets: withoutDuplicateTargets(targets), note: targets.length === 0 ? emptyNote : null }
}
