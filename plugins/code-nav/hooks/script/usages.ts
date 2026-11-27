import { wholeNamePattern } from '../symbol-names'
import type { CodePosition, Usage, UsageCertainty, UsagesAnswer } from '../../types'
import type { Workspace } from '../workspace'
import type { ScriptDeclaration } from './declarations'
import { resolveClick } from './definition'
import type { ClickResolution } from './definition'
import { isSamePlace, locatedDeclaration } from './located'
import type { Located } from './located'
import { resolveProjectModule } from './module-resolution'
import { defaultImportPattern, isDefaultExportOfItsFile, moduleWordOf, namesGivenByReexportsIn, namesOfDefaultImportsIn } from './other-names'
import { resolveNameAt, resolveTopLevelName, sourcesOfDestructuredName } from './reference-resolution'
import type { ReadingContext, Resolution } from './reference-resolution'
import { SCRIPT_FILE_GLOBS } from './script-model'
import type { ScriptModel } from './script-model'
import { createAnalysisSession, modelOf } from './session'
import type { AnalysisSession } from './session'
import { isPunctuation } from './structure'
import { holderNameOf, topLevelDeclarationAround } from './symbols'
import { targetOfLocated } from './targets'
import { lineAndColumnOfOffset, lineTextAt } from '../text-position'
import { caseAndDashFreeSpellingOf, componentNameOfTag, isTagOfComponent, kebabCaseTagOf, localNamesVisibleFrom } from './vue-template'

const MAXIMUM_MATCHES_SEARCHED = 3000
const MAXIMUM_FILES_ANALYSED = 200
const NO_SYMBOL: UsagesAnswer = { symbol: null, title: '', usages: [], isTruncated: false, note: null }

// What the usages are compared with: the declarations the click resolved to, or the package the name comes from, or
// nothing known, in which case every occurrence of the name is listed as unverified.
type Subject = {
  locations: Located[]
  packageName: string | null
  // The click stood after a dot ("order.total"): when nothing tells what it is, only such accesses are listed.
  isMemberAccess: boolean
  // A name reached through a holder ("OrderStore.load"): a bare name of the same spelling is another thing.
  isReachedThroughHolder: boolean
  isPropertyOfType: boolean
  // The files whose default export is the subject: a file importing it may give it any name.
  defaultExportedPaths: string[]
}

function patternOfNames(names: readonly string[]): string {
  const alternatives = names.map(wholeNamePattern)

  return alternatives.length === 1 ? (alternatives[0] ?? '') : `(?:${alternatives.join('|')})`
}

function usageAt(model: ScriptModel, offset: number, certainty: UsageCertainty): Usage {
  const place = lineAndColumnOfOffset(model.lineStartOffsets, offset)

  return {
    path: model.path,
    line: place.line,
    column: place.column,
    preview: lineTextAt(model.text, model.lineStartOffsets, place.line).trim(),
    certainty,
  }
}

function isExportedFromItsFile(model: ScriptModel, declaration: ScriptDeclaration): boolean {
  const { structure } = model
  const defaultReference =
    structure.defaultExport === null ? undefined : structure.tokens[structure.defaultExport.referenceTokenIndex ?? -1]

  return (
    declaration.isExported ||
    model.path.endsWith('.d.ts') ||
    defaultReference?.text === declaration.name ||
    structure.exportLinks.some(
      link => link.kind === 'named' && link.specifier === null && link.localName === declaration.name,
    )
  )
}

// Whether other files can refer to what was clicked: a parameter, a name local to a function, a name of a Vue
// component's script or a name its file does not export are used in their own file only.
function isKnownOutsideItsFile(located: Located): boolean {
  const { model, structure, declaration } = located
  if (model === null || structure === null || declaration === null) {
    return located.offset === null
  }
  if (
    structure !== model.structure ||
    model.isVueComponent ||
    declaration.kind === 'parameter' ||
    declaration.kind === 'typeParameter'
  ) {
    return false
  }
  if (declaration.scope.kind === 'file') {
    return isExportedFromItsFile(model, declaration)
  }
  if (declaration.role === 'binding' && holderNameOf(structure, declaration) === null) {
    return false
  }
  const topLevelHolder = topLevelDeclarationAround(structure, declaration.nameTokenIndex)

  return topLevelHolder === null || isExportedFromItsFile(model, topLevelHolder)
}

async function certaintyOfResolution(
  session: AnalysisSession,
  subject: Subject,
  resolution: Resolution,
  isMemberAccess: boolean,
): Promise<UsageCertainty | null> {
  switch (resolution.kind) {
    case 'located': {
      if (
        resolution.locations.some(located =>
          subject.locations.some(subjectLocation => isSamePlace(located, subjectLocation)),
        )
      ) {
        return 'confirmed'
      }
      for (const located of resolution.locations) {
        if (
          located.model === null ||
          located.structure === null ||
          located.declaration === null ||
          located.declaration.sourceProperty === null
        ) {
          continue
        }
        const context: ReadingContext = { model: located.model, structure: located.structure, templateLocalNames: null }
        const sources = await sourcesOfDestructuredName(session, context, located.declaration)
        if (sources.some(source => subject.locations.some(subjectLocation => isSamePlace(source, subjectLocation)))) {
          return 'confirmed'
        }
      }
      return null
    }
    case 'package':
      return subject.packageName !== null && resolution.packageName === subject.packageName ? 'confirmed' : null
    case 'explained':
      return null
    case 'unknown': {
      const isKnownSubject = subject.locations.length > 0 || subject.packageName !== null
      const mayBeTheSubject = isKnownSubject
        ? isMemberAccess || !subject.isReachedThroughHolder
        : isMemberAccess === subject.isMemberAccess
      return mayBeTheSubject ? 'unverified' : null
    }
  }
}

// Null when the occurrence is no usage: an import line, a declaration, or a name proven to be something else.
async function certaintyOfOccurrence(
  session: AnalysisSession,
  subject: Subject,
  context: ReadingContext,
  tokenIndex: number,
): Promise<UsageCertainty | null> {
  const { structure, model } = context
  if (structure.importedNameAtToken.has(tokenIndex) || structure.reexportedNameAtToken.has(tokenIndex)) {
    return null
  }
  const previousToken = structure.tokens[tokenIndex - 1]
  const isMemberAccess = isPunctuation(previousToken, '.') || isPunctuation(previousToken, '?.')
  const declaration = structure.declarationAtToken.get(tokenIndex)
  if (declaration !== undefined && !declaration.isShorthand) {
    if (
      declaration.kind === 'import' ||
      subject.locations.some(located => isSamePlace(located, locatedDeclaration(model, structure, declaration)))
    ) {
      return null
    }
    if (declaration.sourceProperty !== null && declaration.sourceProperty === declaration.name) {
      const sources = await sourcesOfDestructuredName(session, context, declaration)
      const isReadFromSubject = sources.some(source => subject.locations.some(located => isSamePlace(source, located)))

      return isReadFromSubject ? 'confirmed' : null
    }

    return subject.isPropertyOfType && declaration.role === 'member' && declaration.scope.kind === 'object'
      ? 'unverified'
      : null
  }

  return certaintyOfResolution(session, subject, await resolveNameAt(session, context, tokenIndex), isMemberAccess)
}

// The names the subject goes by in a file: its own, and the ones an import or a destructuring renames it to
// ("fetchOrder as loadOrder", "{ load: loadOrders }").
function namesSearchedIn(model: ScriptModel, names: readonly string[]): Set<string> {
  const searchedNames = new Set(names)
  for (const declaration of model.structure.fileScope.declarations) {
    if (declaration.importBinding !== null && names.includes(declaration.importBinding.importedName)) {
      searchedNames.add(declaration.name)
    }
  }
  for (const declaration of model.structure.destructuredKeyAtToken.values()) {
    if (declaration.sourceProperty !== null && names.includes(declaration.sourceProperty)) {
      searchedNames.add(declaration.name)
    }
  }

  return searchedNames
}

async function usagesInTemplate(
  session: AnalysisSession,
  subject: Subject,
  model: ScriptModel,
  names: ReadonlySet<string>,
): Promise<Usage[]> {
  const usages: Usage[] = []
  const templateRange = model.templateRange
  if (templateRange === null) {
    return usages
  }
  const templateSpelling = caseAndDashFreeSpellingOf(model.text.slice(templateRange.start, templateRange.end))
  if (![...names].some(name => templateSpelling.includes(caseAndDashFreeSpellingOf(name)))) {
    return usages
  }
  const scan = model.templateScan()
  if (scan === null) {
    return usages
  }
  for (const element of scan.elements) {
    if (![...names].some(name => isTagOfComponent(element.tagName, name))) {
      continue
    }
    const certainties: Array<UsageCertainty | null> = []
    for (const name of new Set([element.tagName, componentNameOfTag(element.tagName)])) {
      certainties.push(await certaintyOfResolution(session, subject, await resolveTopLevelName(session, model, name), false))
    }
    const certainty = certainties.includes('confirmed')
      ? 'confirmed'
      : certainties.includes('unverified')
        ? 'unverified'
        : null
    if (certainty !== null) {
      usages.push(usageAt(model, element.nameRange.start, certainty))
    }
  }
  for (const expression of scan.expressions) {
    const structure = model.structureOfTemplateExpression(expression)
    const context: ReadingContext = {
      model,
      structure,
      templateLocalNames: localNamesVisibleFrom(scan, expression.elementIndex),
    }
    for (const [tokenIndex, token] of structure.tokens.entries()) {
      if (token.kind !== 'identifier' || !names.has(token.text)) {
        continue
      }
      const certainty = await certaintyOfOccurrence(session, subject, context, tokenIndex)
      if (certainty !== null) {
        usages.push(usageAt(model, token.start, certainty))
      }
    }
  }

  return usages
}

async function usagesInFile(
  session: AnalysisSession,
  subject: Subject,
  path: string,
  names: readonly string[],
): Promise<Usage[]> {
  const model = await modelOf(session, path)
  if (model === null) {
    return []
  }
  const searchedNames = namesSearchedIn(model, names)
  for (const modulePath of subject.defaultExportedPaths) {
    for (const name of await namesOfDefaultImportsIn(session, model, modulePath)) {
      searchedNames.add(name)
    }
  }
  const context: ReadingContext = { model, structure: model.structure, templateLocalNames: null }
  const usages: Usage[] = []
  for (const [tokenIndex, token] of model.structure.tokens.entries()) {
    if (token.kind !== 'identifier' || !searchedNames.has(token.text)) {
      continue
    }
    const certainty = await certaintyOfOccurrence(session, subject, context, tokenIndex)
    if (certainty !== null) {
      usages.push(usageAt(model, token.start, certainty))
    }
  }
  usages.push(...(await usagesInTemplate(session, subject, model, searchedNames)))

  return usages.sort((first, second) => first.line - second.line || first.column - second.column)
}

// The files that import a module, each at the line of its import.
async function usagesOfModule(
  session: AnalysisSession,
  modulePath: string,
): Promise<{ usages: Usage[]; isTruncated: boolean; note: string | null }> {
  const searchedWord = moduleWordOf(modulePath)
  const matches = await session.workspace.search(patternOfNames([searchedWord]), {
    globs: SCRIPT_FILE_GLOBS,
    maxMatches: MAXIMUM_MATCHES_SEARCHED + 1,
  })
  const paths = [...new Set(matches.map(match => match.path))]
  const usages: Usage[] = []
  for (const path of paths.slice(0, MAXIMUM_FILES_ANALYSED)) {
    const model = await modelOf(session, path)
    if (model === null) {
      continue
    }
    for (const [tokenIndex, specifier] of model.structure.specifierAtToken) {
      const token = model.structure.tokens[tokenIndex]
      if (
        token !== undefined &&
        specifier.includes(searchedWord) &&
        (await resolveProjectModule(session, path, specifier)) === modulePath
      ) {
        usages.push(usageAt(model, token.start, 'confirmed'))
      }
    }
  }

  const isCutAtMatchLimit = matches.length > MAXIMUM_MATCHES_SEARCHED
  const isTruncated = isCutAtMatchLimit || paths.length > MAXIMUM_FILES_ANALYSED
  const note = isTruncated && usages.length === 0 ? noteOfSearchCutBeforeAnyUsage(modulePath, [searchedWord], isCutAtMatchLimit) : null

  return { usages, isTruncated, note }
}

function subjectOf(clickResolution: ClickResolution): Subject {
  const { resolution } = clickResolution
  const locations = resolution.kind === 'located' ? resolution.locations : []
  const firstDeclaration = locations[0]?.declaration ?? null
  const firstStructure = locations[0]?.structure ?? null
  const holderName =
    firstDeclaration === null || firstStructure === null ? null : holderNameOf(firstStructure, firstDeclaration)

  const { click } = clickResolution
  const previousToken = click.kind === 'name' ? click.context.structure.tokens[click.tokenIndex - 1] : undefined

  return {
    locations,
    packageName: resolution.kind === 'package' ? resolution.packageName : null,
    isMemberAccess: isPunctuation(previousToken, '.') || isPunctuation(previousToken, '?.'),
    isReachedThroughHolder: firstDeclaration !== null && (firstDeclaration.role === 'member' || holderName !== null),
    isPropertyOfType:
      firstDeclaration !== null && firstDeclaration.role === 'member' && firstDeclaration.kind === 'property',
    defaultExportedPaths: [...new Set(locations.filter(isDefaultExportOfItsFile).map(located => located.path))],
  }
}

// The names to look for in each file, and the words to search the project for: a component is written in a template
// in kebab-case too, a file using it under that spelling alone (registered globally) holding no other.
function searchedNamesOf(clickResolution: ClickResolution): { names: string[]; searchedWords: string[] } {
  const { click, symbol } = clickResolution
  if (click.kind === 'componentTag') {
    const componentName = componentNameOfTag(click.tagName)
    const names = [...new Set([componentName, click.tagName])]

    return { names, searchedWords: [...new Set([...names, kebabCaseTagOf(componentName)])] }
  }
  const name = symbol?.name ?? ''
  const namesAComponent =
    clickResolution.resolution.kind === 'located' &&
    clickResolution.resolution.locations.some(
      located => located.path.endsWith('.vue') && located.declaration === null && located.offset === null,
    )

  return { names: [name], searchedWords: namesAComponent ? [...new Set([name, kebabCaseTagOf(name)])] : [name] }
}

// The places of a name are read in path order: those past the limit may hold every usage there is.
function noteOfSearchCutBeforeAnyUsage(title: string, searchedNames: readonly string[], isCutAtMatchLimit: boolean): string {
  const writtenName = searchedNames.join(' or ')
  const placesRead = isCutAtMatchLimit
    ? `among the first ${MAXIMUM_MATCHES_SEARCHED} places ${writtenName} is written`
    : `in the first ${MAXIMUM_FILES_ANALYSED} files where ${writtenName} is written`

  return `No usage of ${title} ${placesRead}: the search stopped there.`
}

function confirmedFirst(usages: readonly Usage[]): Usage[] {
  return [
    ...usages.filter(usage => usage.certainty === 'confirmed'),
    ...usages.filter(usage => usage.certainty === 'unverified'),
  ]
}

export async function findScriptUsages(workspace: Workspace, position: CodePosition): Promise<UsagesAnswer> {
  const session = createAnalysisSession(workspace)
  const clickResolution = await resolveClick(session, position)
  if (clickResolution === null || clickResolution.symbol === null) {
    return NO_SYMBOL
  }
  const { model, click, symbol, resolution } = clickResolution
  const subject = subjectOf(clickResolution)
  const firstLocation = subject.locations[0]
  const title = firstLocation === undefined ? symbol.name : (await targetOfLocated(session, firstLocation, 'exact')).label
  if (resolution.kind === 'explained') {
    return { symbol, title, usages: [], isTruncated: false, note: resolution.note }
  }
  if (click.kind === 'specifier') {
    const moduleUsages =
      firstLocation === undefined ? { usages: [], isTruncated: false, note: null } : await usagesOfModule(session, firstLocation.path)

    return { symbol, title, ...moduleUsages }
  }
  const { names, searchedWords } = searchedNamesOf(clickResolution)
  const isSearchedInProject = subject.locations.length === 0 || subject.locations.some(isKnownOutsideItsFile)
  if (!isSearchedInProject) {
    const filePaths = [...new Set([model.path, ...subject.locations.map(located => located.path)])]
    const usagesByFile = await Promise.all(filePaths.map(path => usagesInFile(session, subject, path, names)))

    const confirmedUsages = usagesByFile.flat().filter(usage => usage.certainty === 'confirmed')

    return { symbol, title, usages: confirmedUsages, isTruncated: false, note: null }
  }
  const matches = await workspace.search(patternOfNames(searchedWords), {
    globs: SCRIPT_FILE_GLOBS,
    maxMatches: MAXIMUM_MATCHES_SEARCHED + 1,
  })
  const defaultImportMatches = await Promise.all(
    subject.defaultExportedPaths.map(modulePath =>
      workspace.search(defaultImportPattern(modulePath), { globs: SCRIPT_FILE_GLOBS, maxMatches: MAXIMUM_MATCHES_SEARCHED + 1 }),
    ),
  )
  const declaringPaths = subject.locations.map(located => located.path)
  const matchedPaths = [...new Set([...matches, ...defaultImportMatches.flat()].map(match => match.path))]
  const orderedPaths = [
    ...declaringPaths.filter(path => matchedPaths.includes(path)),
    ...matchedPaths.filter(path => !declaringPaths.includes(path)),
  ]
  const analysedPaths = [...new Set(orderedPaths)].slice(0, MAXIMUM_FILES_ANALYSED)
  await Promise.all(analysedPaths.map(path => modelOf(session, path)))
  const usagesByFile: Usage[][] = []
  for (const path of analysedPaths) {
    usagesByFile.push(await usagesInFile(session, subject, path, names))
  }
  const namesGivenByReexports = await namesGivenByReexportsIn(session, analysedPaths, names)
  let hasMoreUnderOtherNames = false
  if (namesGivenByReexports.length > 0) {
    const otherMatches = await workspace.search(patternOfNames(namesGivenByReexports), {
      globs: SCRIPT_FILE_GLOBS,
      maxMatches: MAXIMUM_MATCHES_SEARCHED + 1,
    })
    const otherPaths = [...new Set(otherMatches.map(match => match.path))]
    hasMoreUnderOtherNames = otherMatches.length > MAXIMUM_MATCHES_SEARCHED || otherPaths.length > MAXIMUM_FILES_ANALYSED
    for (const path of otherPaths.slice(0, MAXIMUM_FILES_ANALYSED)) {
      usagesByFile.push(await usagesInFile(session, subject, path, namesGivenByReexports))
    }
  }
  const usages = confirmedFirst(usagesByFile.flat())
  const isTruncated =
    matches.length > MAXIMUM_MATCHES_SEARCHED || orderedPaths.length > analysedPaths.length || hasMoreUnderOtherNames
  const note =
    isTruncated && usages.length === 0
      ? noteOfSearchCutBeforeAnyUsage(title, searchedWords, matches.length > MAXIMUM_MATCHES_SEARCHED)
      : subject.locations.length === 0 && subject.packageName === null
        ? `The declaration of ${symbol.name} is not known: every use of that name is listed`
        : null

  return { symbol, title, usages, isTruncated, note }
}
