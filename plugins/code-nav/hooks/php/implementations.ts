import type { CodePosition, ImplementationsAnswer, NavigationTarget } from '../../types'
import type { Workspace } from '../workspace'
import { shortNameOf } from './outline'
import { createPhpProject } from './project'
import type { PhpLocatedClass, PhpMemberKind, PhpProject } from './project'
import { memberLabelOf, resolvePhpClick, targetAtOffset, targetOfClass } from './resolution'

const MAXIMUM_INHERITANCE_LEVELS = 6
const MAXIMUM_CANDIDATE_FILES = 400
const MAXIMUM_CANDIDATE_MATCHES = 2000

// A class header naming one of the classes ("extends Order", "implements A, Order"), a trait use inside a class body,
// a line holding only that name, as a list of interfaces written one per line does, or a use statement importing it
// under another name ("use Shop\Order as BaseOrder;"), the header of such a file naming only that other name.
function inheritancePattern(shortNames: readonly string[]): string {
  const names = `\\b(${shortNames.join('|')})`
  const headerNamingTheClass = `(extends|implements|^\\s+use)\\s[^;{(]*${names}\\b`
  const lineHoldingOnlyTheClass = `^\\s+[A-Za-z0-9_\\\\]*${names}\\s*,?\\s*\\{?\\s*$`
  const importUnderAnotherName = `^\\s*use\\s[^;]*${names}\\s+as\\s`

  return `(${headerNamingTheClass})|(${lineHoldingOnlyTheClass})|(${importUnderAnotherName})`
}

// The classes of the project that extend, implement or use a class, directly or through others, nearest first.
// Each search finds the files naming the classes of one level; a file counts once its own header resolves to them.
export async function descendantsOfClass(project: PhpProject, fullyQualifiedName: string): Promise<PhpLocatedClass[]> {
  const descendants: PhpLocatedClass[] = []
  const knownClassNames = new Set([fullyQualifiedName])
  let levelClassNames = [fullyQualifiedName]
  for (let level = 0; level < MAXIMUM_INHERITANCE_LEVELS && levelClassNames.length > 0; level += 1) {
    const shortNames = [...new Set(levelClassNames.map(shortNameOf))]
    const matches = await project.workspace.search(inheritancePattern(shortNames), { globs: ['*.php'], maxMatches: MAXIMUM_CANDIDATE_MATCHES })
    const candidatePaths = [...new Set(matches.map(match => match.path))].slice(0, MAXIMUM_CANDIDATE_FILES)
    const parentClassNames = new Set(levelClassNames)
    const nextLevelClassNames: string[] = []
    for (const candidatePath of candidatePaths) {
      const outline = await project.outlineOfFile(candidatePath)
      for (const classDeclaration of outline?.classes ?? []) {
        const parentNames = [...classDeclaration.extendsNames, ...classDeclaration.implementsNames, ...classDeclaration.traitNames]
        const isBelowTheLevel = parentNames.some(parentName => parentClassNames.has(parentName))
        if (outline && isBelowTheLevel && !knownClassNames.has(classDeclaration.fullyQualifiedName)) {
          knownClassNames.add(classDeclaration.fullyQualifiedName)
          nextLevelClassNames.push(classDeclaration.fullyQualifiedName)
          descendants.push({ outline, classDeclaration })
        }
      }
    }
    levelClassNames = nextLevelClassNames
  }

  return descendants
}

export function memberTargetIn(project: PhpProject, located: PhpLocatedClass, memberKind: PhpMemberKind, name: string): NavigationTarget | null {
  const { classDeclaration, outline } = located
  const tokenIndexByKind: Record<PhpMemberKind, number | null | undefined> = {
    method: classDeclaration.methods.find(method => method.name === name)?.nameTokenIndex,
    property: classDeclaration.properties.find(property => property.name === name)?.tokenIndex,
    constant: classDeclaration.constants.find(constant => constant.name === name)?.tokenIndex,
  }
  const offset = outline.source.tokens[tokenIndexByKind[memberKind] ?? -1]?.start

  return offset === undefined ? null : targetAtOffset(project, outline, offset, memberLabelOf(classDeclaration.name, memberKind, name), 'exact')
}

// On a class or an interface, the classes below it; on a method, its declarations in those classes.
export async function findPhpImplementations(workspace: Workspace, position: CodePosition): Promise<ImplementationsAnswer> {
  const project = createPhpProject(workspace)
  const { symbol, subject, note } = await resolvePhpClick(project, position)
  if (subject === null) {
    return { symbol, title: symbol?.name ?? '', targets: [], note }
  }
  switch (subject.kind) {
    case 'class': {
      const descendants = await descendantsOfClass(project, subject.fullyQualifiedName)
      const shortName = shortNameOf(subject.fullyQualifiedName)
      const targets = descendants.map(located => targetOfClass(project, located.outline, located.classDeclaration))

      return { symbol, title: shortName, targets, note: targets.length === 0 ? `No class of the project extends or implements ${shortName}` : null }
    }
    case 'member': {
      const { memberKind, name, declaringClassNames } = subject
      const firstDeclaringClassName = declaringClassNames[0]
      if (firstDeclaringClassName === undefined) {
        return { symbol, title: name, targets: [], note: `The class holding ${name} could not be read` }
      }
      const targets: NavigationTarget[] = []
      for (const declaringClassName of declaringClassNames) {
        for (const located of await descendantsOfClass(project, declaringClassName)) {
          const target = memberTargetIn(project, located, memberKind, name)
          if (target !== null && !targets.some(known => known.path === target.path && known.line === target.line)) {
            targets.push(target)
          }
        }
      }
      const title = memberLabelOf(shortNameOf(firstDeclaringClassName), memberKind, name)

      return { symbol, title, targets, note: targets.length === 0 ? `No class of the project declares ${title} again` : null }
    }
    case 'function':
    case 'variable':
    case 'constant':
      return { symbol, title: subject.name, targets: [], note: 'Implementations are listed for a class, an interface or a method' }
    default: {
      const unhandledSubject: never = subject

      return unhandledSubject
    }
  }
}
