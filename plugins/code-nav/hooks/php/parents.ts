import type { CodePosition, ImplementationsAnswer, NavigationTarget } from '../../types'
import type { Workspace } from '../workspace'
import { memberTargetIn } from './implementations'
import { shortNameOf } from './outline'
import { createPhpProject } from './project'
import type { PhpLocatedClass, PhpProject } from './project'
import { memberLabelOf, resolvePhpClick, targetOfClass } from './resolution'

const MAXIMUM_ANCESTOR_CLASSES = 80

// traits: a class's own methods take over those of the traits it uses, so a method looks into them; a class is not
// said to descend from a trait, so the classes above a class leave them out.
export type PhpAncestorReach = 'parentsAndInterfaces' | 'parentsInterfacesAndTraits'

export type PhpAncestors = { ancestors: PhpLocatedClass[]; unlocatedClassNames: string[] }

function parentNamesOf(located: PhpLocatedClass, reach: PhpAncestorReach): string[] {
  const { extendsNames, implementsNames, traitNames } = located.classDeclaration
  switch (reach) {
    case 'parentsAndInterfaces':
      return [...extendsNames, ...implementsNames]
    case 'parentsInterfacesAndTraits':
      return [...traitNames, ...extendsNames, ...implementsNames]
    default: {
      const unhandledReach: never = reach

      return unhandledReach
    }
  }
}

// The classes above a class, level by level so that the nearest come first, each once. A parent no file declares
// (a PHP built-in class, a dependency not installed) is kept aside by name.
export async function ancestorsOfClass(
  project: PhpProject,
  located: PhpLocatedClass,
  reach: PhpAncestorReach,
): Promise<PhpAncestors> {
  const ancestors: PhpLocatedClass[] = []
  const unlocatedClassNames: string[] = []
  const knownClassNames = new Set([located.classDeclaration.fullyQualifiedName])
  let levelClasses = [located]
  while (levelClasses.length > 0 && knownClassNames.size < MAXIMUM_ANCESTOR_CLASSES) {
    const nextLevelClasses: PhpLocatedClass[] = []
    for (const child of levelClasses) {
      for (const parentName of parentNamesOf(child, reach)) {
        if (knownClassNames.has(parentName)) {
          continue
        }
        knownClassNames.add(parentName)
        const parent = await project.locateClass(parentName, child.outline.path)
        if (parent === null) {
          unlocatedClassNames.push(parentName)
        } else {
          ancestors.push(parent)
          nextLevelClasses.push(parent)
        }
      }
    }
    levelClasses = nextLevelClasses
  }

  return { ancestors, unlocatedClassNames }
}

function unreadParentsSentence(unlocatedClassNames: readonly string[]): string {
  if (unlocatedClassNames.length === 0) {
    return ''
  }

  return ` Not found in the project or its dependencies: ${unlocatedClassNames.map(shortNameOf).join(', ')}.`
}

// On a class or an interface, the classes and interfaces above it; on a method, its declarations in those classes
// and in the traits they use: what the method overrides or implements.
export async function findPhpParents(workspace: Workspace, position: CodePosition): Promise<ImplementationsAnswer> {
  const project = createPhpProject(workspace)
  const { symbol, subject, note } = await resolvePhpClick(project, position)
  if (subject === null) {
    return { symbol, title: symbol?.name ?? '', targets: [], note }
  }
  switch (subject.kind) {
    case 'class': {
      const shortName = shortNameOf(subject.fullyQualifiedName)
      const title = shortName
      const located = await project.locateClass(subject.fullyQualifiedName, position.path)
      if (located === null) {
        return { symbol, title, targets: [], note: note ?? `No file declares ${subject.fullyQualifiedName}` }
      }
      const { ancestors, unlocatedClassNames } = await ancestorsOfClass(project, located, 'parentsAndInterfaces')
      const targets = ancestors.map(ancestor => targetOfClass(project, ancestor.outline, ancestor.classDeclaration))
      const emptyNote = `${shortName} has no parent class or interface.${unreadParentsSentence(unlocatedClassNames)}`

      return { symbol, title, targets, note: targets.length === 0 ? emptyNote : null }
    }
    case 'member': {
      const { memberKind, name, declaringClassNames } = subject
      const firstDeclaringClassName = declaringClassNames[0]
      if (firstDeclaringClassName === undefined) {
        return { symbol, title: name, targets: [], note: `The class holding ${name} could not be read` }
      }
      const targets: NavigationTarget[] = []
      const unlocatedClassNames: string[] = []
      for (const declaringClassName of declaringClassNames) {
        const declaringClass = await project.locateClass(declaringClassName, position.path)
        const lineage =
          declaringClass === null ? null : await ancestorsOfClass(project, declaringClass, 'parentsInterfacesAndTraits')
        unlocatedClassNames.push(...(lineage?.unlocatedClassNames ?? []))
        for (const ancestor of lineage?.ancestors ?? []) {
          const target = memberTargetIn(project, ancestor, memberKind, name)
          if (target !== null && !targets.some(known => known.path === target.path && known.line === target.line)) {
            targets.push(target)
          }
        }
      }
      const declaringShortName = shortNameOf(firstDeclaringClassName)
      const title = memberLabelOf(declaringShortName, memberKind, name)
      const emptyNote =
        `${name} overrides nothing: ${declaringShortName} has no parent declaring it.` +
        unreadParentsSentence([...new Set(unlocatedClassNames)])

      return { symbol, title, targets, note: targets.length === 0 ? emptyNote : null }
    }
    case 'function':
    case 'variable':
    case 'constant':
      return { symbol, title: subject.name, targets: [], note: 'Parents are listed for a class, an interface or a method' }
    default: {
      const unhandledSubject: never = subject

      return unhandledSubject
    }
  }
}
