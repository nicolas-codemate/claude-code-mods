import type { ClickedSymbol, CodePosition, DefinitionAnswer, NavigationTarget, SymbolEntry } from '../../types'
import type { Workspace } from '../workspace'
import { readClickAtPosition, symbolOfClick } from './click'
import type { Click } from './click'
import { bindingVisibleAt } from './declarations'
import { locatedFile, locatedOffset } from './located'
import type { Located } from './located'
import { resolveModuleSpecifier, resolveProjectModule } from './module-resolution'
import { directoryOf } from './paths'
import { resolveNameAt, resolveTopLevelName } from './reference-resolution'
import type { ReadingContext, Resolution } from './reference-resolution'
import type { ScriptModel } from './script-model'
import { createAnalysisSession, modelOf } from './session'
import type { AnalysisSession } from './session'
import { isPunctuation } from './structure'
import { targetOfLocated, targetOfSymbol, withoutDuplicateTargets } from './targets'
import { componentNameOfTag } from './vue-template'

const MAXIMUM_CANDIDATES = 25
const VUE_BUILT_IN_COMPONENTS = new Set(['Teleport', 'Transition', 'TransitionGroup', 'KeepAlive', 'Suspense', 'Component'])
const NO_SYMBOL: DefinitionAnswer = { symbol: null, targets: [], isOnDeclaration: false, note: null }

// What a click refers to, for the three answers alike. declaredHere: the click stands on the declaration's own name.
export type ClickResolution = {
  model: ScriptModel
  click: Click
  symbol: ClickedSymbol | null
  declaredHere: Located | null
  resolution: Resolution
  // The component files a tag may name when the script imports no such component.
  componentFiles: string[]
}

function tierOfCandidate(symbol: SymbolEntry, fromPath: string, importedPaths: ReadonlySet<string>): number {
  if (symbol.path === fromPath || importedPaths.has(symbol.path)) {
    return 0
  }

  return directoryOf(symbol.path) === directoryOf(fromPath) ? 1 : 2
}

async function pathsImportedBy(session: AnalysisSession, model: ScriptModel): Promise<Set<string>> {
  const specifiers = new Set(model.structure.specifierAtToken.values())
  const paths = await Promise.all([...specifiers].map(specifier => resolveProjectModule(session, model.path, specifier)))

  return new Set(paths.filter((path): path is string => path !== null))
}

// Every declaration of the name the project index knows: those of files this file imports first, then those of its
// own directory, then the rest. A member access prefers the declarations reached through a holder.
async function candidatesNamed(
  session: AnalysisSession,
  model: ScriptModel,
  name: string,
  isMemberAccess: boolean,
): Promise<{ targets: NavigationTarget[]; total: number }> {
  const symbols = session.workspace.symbolsNamed(name)
  const preferredSymbols = symbols.filter(symbol => (symbol.container !== null) === isMemberAccess)
  const consideredSymbols = preferredSymbols.length > 0 ? preferredSymbols : [...symbols]
  if (consideredSymbols.length === 0) {
    return { targets: [], total: 0 }
  }
  const importedPaths = await pathsImportedBy(session, model)
  const rankedSymbols = consideredSymbols
    .map((symbol, index) => ({ symbol, index, tier: tierOfCandidate(symbol, model.path, importedPaths) }))
    .sort((first, second) => first.tier - second.tier || first.index - second.index)
    .slice(0, MAXIMUM_CANDIDATES)
  const targets = await Promise.all(rankedSymbols.map(ranked => targetOfSymbol(session, ranked.symbol, 'candidate')))

  return { targets: withoutDuplicateTargets(targets), total: consideredSymbols.length }
}

async function answerOfResolution(
  session: AnalysisSession,
  model: ScriptModel,
  symbol: ClickedSymbol,
  resolution: Resolution,
  isMemberAccess: boolean,
): Promise<DefinitionAnswer> {
  switch (resolution.kind) {
    case 'located': {
      const targets = await Promise.all(resolution.locations.map(located => targetOfLocated(session, located, 'exact')))
      return { symbol, targets: withoutDuplicateTargets(targets), isOnDeclaration: false, note: null }
    }
    case 'package':
      return {
        symbol,
        targets: [],
        isOnDeclaration: false,
        note: `${symbol.name} comes from the package ${resolution.packageName}`,
      }
    case 'explained':
      return { symbol, targets: [], isOnDeclaration: false, note: resolution.note }
    case 'unknown': {
      const candidates = await candidatesNamed(session, model, symbol.name, isMemberAccess)
      let note: string | null = null
      if (candidates.total === 0) {
        note = `No declaration of ${symbol.name} was found in the project`
      } else if (candidates.total > candidates.targets.length) {
        note = `${candidates.total} declarations are named ${symbol.name}: the ${candidates.targets.length} nearest are listed`
      }
      return { symbol, targets: candidates.targets, isOnDeclaration: false, note }
    }
  }
}

async function resolveSpecifierClick(session: AnalysisSession, model: ScriptModel, specifier: string): Promise<Resolution> {
  const resolvedModule = await resolveModuleSpecifier(session, model.path, specifier)
  switch (resolvedModule.kind) {
    case 'project':
      return { kind: 'located', locations: [locatedFile(resolvedModule.path)] }
    case 'dependency':
      return resolvedModule.path === null
        ? { kind: 'package', packageName: resolvedModule.packageName }
        : { kind: 'located', locations: [locatedFile(resolvedModule.path)] }
    case 'unresolved':
      return { kind: 'explained', note: `No file was found for ${specifier}` }
  }
}

// A tag names a component the script imports or declares; failing that, a component file of that name anywhere in
// the project, which Vue may have been told to register globally.
async function resolveComponentTag(
  session: AnalysisSession,
  model: ScriptModel,
  tagName: string,
): Promise<{ resolution: Resolution; candidateFiles: string[] }> {
  const componentName = componentNameOfTag(tagName)
  const camelCaseName = componentName.charAt(0).toLowerCase() + componentName.slice(1)
  const isPlainElement = !tagName.includes('-') && tagName === tagName.toLowerCase()
  if (isPlainElement && bindingVisibleAt(model.structure, tagName, -1)?.importBinding == null) {
    return { resolution: { kind: 'unknown' }, candidateFiles: [] }
  }
  for (const name of new Set([tagName, componentName, camelCaseName])) {
    const resolution = await resolveTopLevelName(session, model, name)
    if (resolution.kind === 'located' || resolution.kind === 'package') {
      return { resolution, candidateFiles: [] }
    }
  }
  if (VUE_BUILT_IN_COMPONENTS.has(componentName)) {
    return { resolution: { kind: 'explained', note: `${tagName} is a Vue built-in component` }, candidateFiles: [] }
  }
  const fileSuffixes = [`/${componentName}.vue`, `/${componentName}/index.vue`, `/${tagName}.vue`]
  const candidateFiles = isPlainElement
    ? []
    : session.workspace.files().filter(path => fileSuffixes.some(suffix => path.endsWith(suffix)))

  return { resolution: { kind: 'unknown' }, candidateFiles }
}

// A name followed by a colon where a key stands (after a brace, a comma, a parenthesis, at the start of a line) is
// the key of a literal, the label of a tuple or the parameter of a signature: a declaration, whatever construct
// holds it, and never a reference to a name in scope.
function isUnreadKeyAt(context: ReadingContext, tokenIndex: number): boolean {
  const { structure } = context
  const { tokens } = structure
  const token = tokens[tokenIndex]
  const previousToken = tokens[tokenIndex - 1]
  const isFollowedByColon =
    isPunctuation(tokens[tokenIndex + 1], ':') ||
    (isPunctuation(tokens[tokenIndex + 1], '?') && isPunctuation(tokens[tokenIndex + 2], ':'))
  const isMapped =
    structure.destructuredKeyAtToken.has(tokenIndex) ||
    structure.importedNameAtToken.has(tokenIndex) ||
    structure.reexportedNameAtToken.has(tokenIndex)
  if (token === undefined || !isFollowedByColon || isMapped) {
    return false
  }
  const standsWhereAKeyDoes =
    previousToken === undefined ||
    (previousToken.kind === 'punctuation' && ['{', ',', ';', '(', '['].includes(previousToken.text)) ||
    token.followsLineBreak

  return standsWhereAKeyDoes && !isPunctuation(previousToken, '?') && !isPunctuation(previousToken, ':')
}

function isMemberAccessAt(context: ReadingContext, tokenIndex: number): boolean {
  const previousToken = context.structure.tokens[tokenIndex - 1]

  return isPunctuation(previousToken, '.') || isPunctuation(previousToken, '?.')
}

async function answerOfComponentTag(
  session: AnalysisSession,
  model: ScriptModel,
  symbol: ClickedSymbol,
  tagName: string,
  resolution: Resolution,
  candidateFiles: readonly string[],
): Promise<DefinitionAnswer> {
  if (resolution.kind !== 'unknown') {
    return answerOfResolution(session, model, symbol, resolution, false)
  }
  if (candidateFiles.length === 0) {
    const isPlainElement = !tagName.includes('-') && tagName === tagName.toLowerCase()

    const note = `No component named ${componentNameOfTag(tagName)} was found: a plugin may register it`

    return isPlainElement ? NO_SYMBOL : { symbol, targets: [], isOnDeclaration: false, note }
  }
  const nearestFirst = [...candidateFiles].sort(
    (first, second) =>
      Number(directoryOf(second) === directoryOf(model.path)) - Number(directoryOf(first) === directoryOf(model.path)),
  )
  const targets = await Promise.all(
    nearestFirst.slice(0, MAXIMUM_CANDIDATES).map(path => targetOfLocated(session, locatedFile(path), 'candidate')),
  )

  return { symbol, targets, isOnDeclaration: false, note: null }
}

// The click read and resolved once, for the definition, the usages and the implementations alike. Null when the
// file cannot be read.
export async function resolveClick(session: AnalysisSession, position: CodePosition): Promise<ClickResolution | null> {
  const model = await modelOf(session, position.path)
  if (model === null) {
    return null
  }
  const click = readClickAtPosition(model, position)
  const symbol = symbolOfClick(model, click)
  const unresolved: ClickResolution = {
    model,
    click,
    symbol,
    declaredHere: null,
    resolution: { kind: 'unknown' },
    componentFiles: [],
  }
  switch (click.kind) {
    case 'none':
      return unresolved
    case 'specifier':
      return { ...unresolved, resolution: await resolveSpecifierClick(session, model, click.specifier) }
    case 'componentTag': {
      const { resolution, candidateFiles } = await resolveComponentTag(session, model, click.tagName)
      return { ...unresolved, resolution, componentFiles: candidateFiles }
    }
    case 'templateLocal': {
      const declaredHere: Located = {
        path: model.path,
        model,
        structure: null,
        declaration: null,
        offset: click.localName.start,
      }
      return { ...unresolved, declaredHere, resolution: { kind: 'located', locations: [declaredHere] } }
    }
    case 'name': {
      const declaration = click.context.structure.declarationAtToken.get(click.tokenIndex)
      if (declaration !== undefined && !declaration.isShorthand && declaration.kind !== 'import') {
        const declaredHere: Located = {
          path: model.path,
          model,
          structure: click.context.structure,
          declaration,
          offset: null,
        }
        return { ...unresolved, declaredHere, resolution: { kind: 'located', locations: [declaredHere] } }
      }
      if (isUnreadKeyAt(click.context, click.tokenIndex)) {
        const declaredHere = locatedOffset(model, click.context.structure.tokens[click.tokenIndex]?.start ?? 0)
        return { ...unresolved, declaredHere, resolution: { kind: 'located', locations: [declaredHere] } }
      }
      return { ...unresolved, resolution: await resolveNameAt(session, click.context, click.tokenIndex) }
    }
  }
}

export async function resolveScriptDefinition(workspace: Workspace, position: CodePosition): Promise<DefinitionAnswer> {
  const session = createAnalysisSession(workspace)
  const clickResolution = await resolveClick(session, position)
  if (clickResolution === null || clickResolution.symbol === null) {
    return NO_SYMBOL
  }
  const { model, click, symbol, declaredHere, resolution } = clickResolution
  if (declaredHere !== null) {
    return { symbol, targets: [], isOnDeclaration: true, note: null }
  }
  if (click.kind === 'componentTag') {
    return answerOfComponentTag(session, model, symbol, click.tagName, resolution, clickResolution.componentFiles)
  }

  return answerOfResolution(
    session,
    model,
    symbol,
    resolution,
    click.kind === 'name' && isMemberAccessAt(click.context, click.tokenIndex),
  )
}
