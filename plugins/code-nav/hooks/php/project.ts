import { isClassLikeKind } from '../symbol-names'
import type { Workspace } from '../workspace'
import { candidatePathsOfClass, composerAutoloadPath, composerRootOf, parseComposerClassMap, parseComposerNamespacePrefixes } from './composer'
import type { ComposerNamespacePrefix } from './composer'
import { docblockTagsOf } from './docblock'
import type { PhpDocblockMember } from './docblock'
import { parsePhpOutline, resolveClassName, shortNameOf } from './outline'
import type { PhpClassDeclaration, PhpConstantDeclaration, PhpFileOutline, PhpFunctionScope, PhpPropertyDeclaration } from './outline'
import { isBuiltinTypeName, isReceiverTypeName, parsePhpType, substituteTypePlaceholders } from './type-expression'
import type { PhpType, PhpTypeMember, PhpTypeNameResolver } from './type-expression'

export type PhpLocatedClass = { outline: PhpFileOutline; classDeclaration: PhpClassDeclaration }

// A class reached with the types its placeholders stand for: OrderRepository's parent with T bound to Order.
export type PhpBoundClass = { located: PhpLocatedClass; bindings: Map<string, PhpType>; typeMember: PhpTypeMember }

export type PhpMemberKind = 'method' | 'property' | 'constant'

export type PhpFoundMember =
  | { kind: 'method'; boundClass: PhpBoundClass; method: PhpFunctionScope }
  | { kind: 'property'; boundClass: PhpBoundClass; property: PhpPropertyDeclaration }
  | { kind: 'constant'; boundClass: PhpBoundClass; constant: PhpConstantDeclaration }
  | { kind: 'docblockMethod'; boundClass: PhpBoundClass; docblockMember: PhpDocblockMember }
  | { kind: 'docblockProperty'; boundClass: PhpBoundClass; docblockMember: PhpDocblockMember }

// What one answer reads of the project: each file and each class is fetched once, however many hops ask for it.
export type PhpProject = {
  workspace: Workspace
  textOfFile: (path: string) => Promise<string | null>
  outlineOfFile: (path: string) => Promise<PhpFileOutline | null>
  locateClass: (fullyQualifiedName: string, fromPath: string) => Promise<PhpLocatedClass | null>
  isDependencyPath: (path: string) => boolean
  composerRootOf: (path: string) => string | null
}

const MAXIMUM_CACHED_OUTLINES = 600
const MAXIMUM_LINEAGE_CLASSES = 80
const MAXIMUM_SYMBOL_CANDIDATES = 20

const projectFileSetByFileList = new WeakMap<readonly string[], Set<string>>()
const cachedOutlineByPath = new Map<string, PhpFileOutline>()
const cachedNamespacePrefixesByPath = new Map<string, { text: string; namespacePrefixes: ComposerNamespacePrefix[] }>()
const cachedClassMapByPath = new Map<string, { text: string; pathByClassName: Map<string, string> }>()

// The outline parsed last for this path is kept for as long as the file's text stays the same.
export function outlineOfText(path: string, text: string): PhpFileOutline {
  const cachedOutline = cachedOutlineByPath.get(path)
  if (cachedOutline !== undefined && cachedOutline.source.text === text) {
    return cachedOutline
  }
  const outline = parsePhpOutline(path, text)
  cachedOutlineByPath.delete(path)
  cachedOutlineByPath.set(path, outline)
  if (cachedOutlineByPath.size > MAXIMUM_CACHED_OUTLINES) {
    const oldestPath = cachedOutlineByPath.keys().next().value
    if (oldestPath !== undefined) {
      cachedOutlineByPath.delete(oldestPath)
    }
  }

  return outline
}

export function classNamedIn(outline: PhpFileOutline, fullyQualifiedName: string): PhpClassDeclaration | null {
  const lowerCaseName = fullyQualifiedName.toLowerCase()

  return (
    outline.classes.find(classDeclaration => classDeclaration.fullyQualifiedName === fullyQualifiedName) ??
    outline.anonymousClasses.find(classDeclaration => classDeclaration.fullyQualifiedName === fullyQualifiedName) ??
    outline.classes.find(classDeclaration => classDeclaration.fullyQualifiedName.toLowerCase() === lowerCaseName) ??
    null
  )
}

export function createPhpProject(workspace: Workspace): PhpProject {
  const textPromiseByPath = new Map<string, Promise<string | null>>()
  const outlinePromiseByPath = new Map<string, Promise<PhpFileOutline | null>>()
  const locatedClassPromiseByKey = new Map<string, Promise<PhpLocatedClass | null>>()

  const textOfFile = (path: string): Promise<string | null> => {
    let textPromise = textPromiseByPath.get(path)
    if (textPromise === undefined) {
      textPromise = workspace.readFile(path).catch(() => null)
      textPromiseByPath.set(path, textPromise)
    }

    return textPromise
  }

  const outlineOfFile = (path: string): Promise<PhpFileOutline | null> => {
    let outlinePromise = outlinePromiseByPath.get(path)
    if (outlinePromise === undefined) {
      outlinePromise = textOfFile(path).then(text => (text === null ? null : outlineOfText(path, text)))
      outlinePromiseByPath.set(path, outlinePromise)
    }

    return outlinePromise
  }

  const namespacePrefixesOf = async (composerRoot: string): Promise<ComposerNamespacePrefix[]> => {
    const tablePath = composerAutoloadPath(composerRoot, 'autoload_psr4.php')
    const text = await textOfFile(tablePath)
    if (text === null) {
      return []
    }
    const cached = cachedNamespacePrefixesByPath.get(tablePath)
    if (cached !== undefined && cached.text === text) {
      return cached.namespacePrefixes
    }
    const namespacePrefixes = parseComposerNamespacePrefixes(text, composerRoot)
    cachedNamespacePrefixesByPath.set(tablePath, { text, namespacePrefixes })

    return namespacePrefixes
  }

  const classMapOf = async (composerRoot: string): Promise<Map<string, string>> => {
    const tablePath = composerAutoloadPath(composerRoot, 'autoload_classmap.php')
    const text = await textOfFile(tablePath)
    if (text === null) {
      return new Map()
    }
    const cached = cachedClassMapByPath.get(tablePath)
    if (cached !== undefined && cached.text === text) {
      return cached.pathByClassName
    }
    const pathByClassName = parseComposerClassMap(text, composerRoot)
    cachedClassMapByPath.set(tablePath, { text, pathByClassName })

    return pathByClassName
  }

  const namespacePrefixesPromiseByRoot = new Map<string, Promise<ComposerNamespacePrefix[]>>()
  const classMapPromiseByRoot = new Map<string, Promise<Map<string, string>>>()
  const memoized = <Value>(promiseByKey: Map<string, Promise<Value>>, key: string, load: () => Promise<Value>): Promise<Value> => {
    let promise = promiseByKey.get(key)
    if (promise === undefined) {
      promise = load()
      promiseByKey.set(key, promise)
    }

    return promise
  }

  const classInFile = async (path: string, fullyQualifiedName: string): Promise<PhpLocatedClass | null> => {
    const outline = await outlineOfFile(path)
    const classDeclaration = outline === null ? null : classNamedIn(outline, fullyQualifiedName)

    return outline !== null && classDeclaration !== null ? { outline, classDeclaration } : null
  }

  const locateClassUncached = async (fullyQualifiedName: string, fromPath: string, composerRoot: string | null): Promise<PhpLocatedClass | null> => {
    const locatedInSameFile = await classInFile(fromPath, fullyQualifiedName)
    if (locatedInSameFile !== null) {
      return locatedInSameFile
    }
    if (composerRoot !== null) {
      const namespacePrefixes = await memoized(namespacePrefixesPromiseByRoot, composerRoot, () => namespacePrefixesOf(composerRoot))
      for (const candidatePath of candidatePathsOfClass(namespacePrefixes, fullyQualifiedName)) {
        const located = await classInFile(candidatePath, fullyQualifiedName)
        if (located !== null) {
          return located
        }
      }
      const pathByClassName = await memoized(classMapPromiseByRoot, composerRoot, () => classMapOf(composerRoot))
      const mappedPath = pathByClassName.get(fullyQualifiedName)
      const located = mappedPath === undefined ? null : await classInFile(mappedPath, fullyQualifiedName)
      if (located !== null) {
        return located
      }
    }
    const candidates = workspace
      .symbolsNamed(shortNameOf(fullyQualifiedName))
      .filter(symbol => isClassLikeKind(symbol.kind))
      .slice(0, MAXIMUM_SYMBOL_CANDIDATES)
    for (const candidate of candidates) {
      const located = await classInFile(candidate.path, fullyQualifiedName)
      if (located !== null) {
        return located
      }
    }

    return null
  }

  const rootOf = (path: string) => composerRootOf(path, workspace.files())

  return {
    workspace,
    textOfFile,
    outlineOfFile,
    composerRootOf: rootOf,
    locateClass: (fullyQualifiedName, fromPath) => {
      const composerRoot = rootOf(fromPath)

      return memoized(locatedClassPromiseByKey, `${composerRoot ?? fromPath}|${fullyQualifiedName}`, () =>
        locateClassUncached(fullyQualifiedName, fromPath, composerRoot),
      )
    },
    isDependencyPath: path => {
      const projectFiles = workspace.files()
      let projectFileSet = projectFileSetByFileList.get(projectFiles)
      if (projectFileSet === undefined) {
        projectFileSet = new Set(projectFiles)
        projectFileSetByFileList.set(projectFiles, projectFileSet)
      }

      return !projectFileSet.has(path)
    },
  }
}

export function templateNamesOf(classDeclaration: PhpClassDeclaration): string[] {
  return docblockTagsOf(classDeclaration.docblock).templates.map(template => template.name)
}

// How a type written in a file names things: placeholders first, then PHP's own words, then the file's imports.
export function typeNameResolverIn(outline: PhpFileOutline, namespaceName: string, templateNames: readonly string[]): PhpTypeNameResolver {
  return writtenName => {
    if (isReceiverTypeName(writtenName)) {
      return { kind: 'receiver', name: 'static' }
    }
    if (templateNames.includes(writtenName)) {
      return { kind: 'template', name: writtenName }
    }
    if (isBuiltinTypeName(writtenName) || writtenName === 'parent') {
      return { kind: 'builtin', name: writtenName }
    }

    return { kind: 'class', name: resolveClassName(outline, namespaceName, writtenName) }
  }
}

export function parseTypeInClass(located: PhpLocatedClass, typeText: string, additionalTemplateNames: readonly string[] = []): PhpType {
  const templateNames = [...templateNamesOf(located.classDeclaration), ...additionalTemplateNames]

  return parsePhpType(typeText, typeNameResolverIn(located.outline, located.classDeclaration.namespaceName, templateNames))
}

function bindingsOf(located: PhpLocatedClass, typeArguments: readonly PhpType[]): Map<string, PhpType> {
  const bindings = new Map<string, PhpType>()
  for (const [templateIndex, template] of docblockTagsOf(located.classDeclaration.docblock).templates.entries()) {
    const boundType = template.boundTypeText === null ? [] : parseTypeInClass(located, template.boundTypeText)
    bindings.set(template.name, typeArguments[templateIndex] ?? boundType)
  }

  return bindings
}

// What a class says its parents' placeholders stand for: "@extends ServiceEntityRepository<Order>".
function inheritedTypeArgumentsOf(boundClass: PhpBoundClass): Map<string, PhpType[]> {
  const typeArgumentsByParentName = new Map<string, PhpType[]>()
  for (const inheritedTypeText of docblockTagsOf(boundClass.located.classDeclaration.docblock).inheritedTypeTexts) {
    const parentMember = parseTypeInClass(boundClass.located, inheritedTypeText)[0]
    if (parentMember !== undefined && parentMember.kind === 'class') {
      typeArgumentsByParentName.set(
        parentMember.name,
        parentMember.typeArguments.map(argument => substituteTypePlaceholders(argument, boundClass.bindings, null)),
      )
    }
  }

  return typeArgumentsByParentName
}

export async function boundClassOf(project: PhpProject, typeMember: PhpTypeMember, fromPath: string): Promise<PhpBoundClass | null> {
  const located = await project.locateClass(typeMember.name, fromPath)

  return located === null ? null : { located, bindings: bindingsOf(located, typeMember.typeArguments), typeMember }
}

// Visits a class, then its traits, its parents and its interfaces, each once, until the visitor answers true.
// Only the classes on the way to that answer are read.
export async function walkClassLineage(
  project: PhpProject,
  startTypeMember: PhpTypeMember,
  fromPath: string,
  visit: (boundClass: PhpBoundClass) => Promise<boolean> | boolean,
  onUnlocatedClass?: (fullyQualifiedName: string) => void,
): Promise<boolean> {
  const visitedClassNames = new Set<string>()

  const walk = async (typeMember: PhpTypeMember, lookupPath: string): Promise<boolean> => {
    if (visitedClassNames.has(typeMember.name) || visitedClassNames.size >= MAXIMUM_LINEAGE_CLASSES) {
      return false
    }
    visitedClassNames.add(typeMember.name)
    const boundClass = await boundClassOf(project, typeMember, lookupPath)
    if (boundClass === null) {
      onUnlocatedClass?.(typeMember.name)

      return false
    }
    if (await visit(boundClass)) {
      return true
    }
    const { classDeclaration, outline } = boundClass.located
    const inheritedTypeArguments = inheritedTypeArgumentsOf(boundClass)
    const mixinNames = docblockTagsOf(classDeclaration.docblock).mixinTypeTexts.flatMap(mixinTypeText =>
      parseTypeInClass(boundClass.located, mixinTypeText).flatMap(member => (member.kind === 'class' ? [member.name] : [])),
    )
    const parentNames = [...classDeclaration.traitNames, ...classDeclaration.extendsNames, ...classDeclaration.implementsNames, ...mixinNames]
    for (const parentName of parentNames) {
      const parentMember: PhpTypeMember = { kind: 'class', name: parentName, typeArguments: inheritedTypeArguments.get(parentName) ?? [] }
      if (await walk(parentMember, outline.path)) {
        return true
      }
    }

    return false
  }

  return walk(startTypeMember, fromPath)
}

function membersNamedIn(boundClass: PhpBoundClass, memberKind: PhpMemberKind, name: string): PhpFoundMember[] {
  const { classDeclaration } = boundClass.located
  const docblockTags = docblockTagsOf(classDeclaration.docblock)
  switch (memberKind) {
    case 'method': {
      const lowerCaseName = name.toLowerCase()
      const method =
        classDeclaration.methods.find(candidate => candidate.name === name) ??
        classDeclaration.methods.find(candidate => candidate.name?.toLowerCase() === lowerCaseName)
      const docblockMethods = docblockTags.methods.filter(candidate => candidate.name === name)

      return [
        ...(method ? [{ kind: 'method' as const, boundClass, method }] : []),
        ...docblockMethods.map(docblockMember => ({ kind: 'docblockMethod' as const, boundClass, docblockMember })),
      ]
    }
    case 'property': {
      const property = classDeclaration.properties.find(candidate => candidate.name === name)
      const docblockProperties = docblockTags.properties.filter(candidate => candidate.name === name)

      return [
        ...(property ? [{ kind: 'property' as const, boundClass, property }] : []),
        ...docblockProperties.map(docblockMember => ({ kind: 'docblockProperty' as const, boundClass, docblockMember })),
      ]
    }
    case 'constant': {
      const constant = classDeclaration.constants.find(candidate => candidate.name === name)

      return constant ? [{ kind: 'constant', boundClass, constant }] : []
    }
    default: {
      const unhandledKind: never = memberKind

      return unhandledKind
    }
  }
}

// The declarations of a member along the lineage of a type, nearest first, offered one by one until one is accepted.
export async function findMemberInLineage(
  project: PhpProject,
  startTypeMember: PhpTypeMember,
  fromPath: string,
  memberKind: PhpMemberKind,
  name: string,
  accept: (foundMember: PhpFoundMember) => Promise<boolean> | boolean,
  onUnlocatedClass?: (fullyQualifiedName: string) => void,
): Promise<boolean> {
  return walkClassLineage(
    project,
    startTypeMember,
    fromPath,
    async boundClass => {
      for (const foundMember of membersNamedIn(boundClass, memberKind, name)) {
        if (await accept(foundMember)) {
          return true
        }
      }

      return false
    },
    onUnlocatedClass,
  )
}

// The nearest declaration of a member along the lineage of a type, with the classes of that lineage no file was
// found for: PHP's own classes, mostly. A declaration written in code wins over a docblock tag met before it
// ("@method Order|null find($id)" above a repository): the tag only says the type, the code is what there is to read.
export async function firstMemberInLineage(
  project: PhpProject,
  startTypeMember: PhpTypeMember,
  fromPath: string,
  memberKind: PhpMemberKind,
  name: string,
): Promise<{ foundMember: PhpFoundMember | null; unlocatedClassNames: string[] }> {
  const outcome: { foundMember: PhpFoundMember | null; unlocatedClassNames: string[] } = { foundMember: null, unlocatedClassNames: [] }
  await findMemberInLineage(
    project,
    startTypeMember,
    fromPath,
    memberKind,
    name,
    foundMember => {
      const isDocblockTag = foundMember.kind === 'docblockMethod' || foundMember.kind === 'docblockProperty'
      if (isDocblockTag && outcome.foundMember !== null) {
        return false
      }
      outcome.foundMember = foundMember

      return !isDocblockTag
    },
    unlocatedClassName => outcome.unlocatedClassNames.push(unlocatedClassName),
  )

  return outcome
}

// Every class name above a class: its traits, parents and interfaces, however far, the class itself left out.
export async function ancestorNamesOf(project: PhpProject, fullyQualifiedName: string, fromPath: string): Promise<Set<string>> {
  const ancestorNames = new Set<string>()
  const pending: Array<{ name: string; lookupPath: string }> = [{ name: fullyQualifiedName, lookupPath: fromPath }]
  while (pending.length > 0 && ancestorNames.size < MAXIMUM_LINEAGE_CLASSES) {
    const next = pending.pop()
    if (next === undefined) {
      break
    }
    const located = await project.locateClass(next.name, next.lookupPath)
    if (located === null) {
      continue
    }
    const { classDeclaration, outline } = located
    for (const parentName of [...classDeclaration.traitNames, ...classDeclaration.extendsNames, ...classDeclaration.implementsNames]) {
      if (!ancestorNames.has(parentName) && parentName !== fullyQualifiedName) {
        ancestorNames.add(parentName)
        pending.push({ name: parentName, lookupPath: outline.path })
      }
    }
  }

  return ancestorNames
}
