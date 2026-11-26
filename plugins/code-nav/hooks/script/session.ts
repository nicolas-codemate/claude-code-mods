import type { Workspace } from '../workspace'
import type { AliasConfiguration } from './path-aliases'
import { buildScriptModel, isScriptPath } from './script-model'
import type { ScriptModel } from './script-model'

// What one answer reads, kept for the length of that answer: a file followed through three imports is read and
// tokenized once.
export type AnalysisSession = {
  workspace: Workspace
  projectPaths: ReadonlySet<string>
  texts: Map<string, Promise<string | null>>
  models: Map<string, Promise<ScriptModel | null>>
  aliasConfigurations: Map<string, Promise<AliasConfiguration | null>>
  // Answers already worked out, by a key their module builds: the two hundred files that call one store method
  // each ask where that store is declared.
  knownAnswers: Map<string, unknown>
  // Reads left for files of dependencies, so that following a package's own re-exports stays short.
  remainingDependencyReads: number
}

const MAXIMUM_DEPENDENCY_READS = 24
const MAXIMUM_REMEMBERED_MODELS = 150
// Larger than any hand-written module (a bundle, a generated schema): such a file is not analysed whole, only the
// declaration asked of it is read.
const MAXIMUM_ANALYSED_TEXT_LENGTH = 600_000

const projectPathsOfFileList = new WeakMap<readonly string[], ReadonlySet<string>>()
// A model is rebuilt only when its file's text changed, whichever answer asks for it.
const rememberedModels = new Map<string, ScriptModel>()

function rememberModel(key: string, model: ScriptModel): void {
  rememberedModels.delete(key)
  rememberedModels.set(key, model)
  if (rememberedModels.size > MAXIMUM_REMEMBERED_MODELS) {
    const oldestKey = rememberedModels.keys().next().value
    if (oldestKey !== undefined) {
      rememberedModels.delete(oldestKey)
    }
  }
}

export function createAnalysisSession(workspace: Workspace): AnalysisSession {
  const fileList = workspace.files()
  let projectPaths = projectPathsOfFileList.get(fileList)
  if (projectPaths === undefined) {
    projectPaths = new Set(fileList)
    projectPathsOfFileList.set(fileList, projectPaths)
  }

  return {
    workspace,
    projectPaths,
    texts: new Map(),
    models: new Map(),
    aliasConfigurations: new Map(),
    knownAnswers: new Map(),
    remainingDependencyReads: MAXIMUM_DEPENDENCY_READS,
  }
}

// Runs the work once per key and per session. Only finished answers are kept: a question that comes back to itself
// while it is still being worked out (two constants naming each other) is worked out again and stops at its depth
// limit, where waiting for its own unfinished answer would never end.
export async function answeredOnce<Answer>(
  session: AnalysisSession,
  key: string,
  work: () => Promise<Answer>,
): Promise<Answer> {
  if (session.knownAnswers.has(key)) {
    return session.knownAnswers.get(key) as Answer
  }
  const answer = await work()
  session.knownAnswers.set(key, answer)

  return answer
}

export function readText(session: AnalysisSession, path: string): Promise<string | null> {
  let text = session.texts.get(path)
  if (text === undefined) {
    text = session.workspace.readFile(path).catch(() => null)
    session.texts.set(path, text)
  }

  return text
}

// A file outside the project's own list (a dependency): reading it is how its existence is known, and each answer
// may only try so many.
export async function readDependencyText(session: AnalysisSession, path: string): Promise<string | null> {
  if (session.texts.has(path)) {
    return readText(session, path)
  }
  if (session.remainingDependencyReads <= 0) {
    return null
  }
  session.remainingDependencyReads -= 1

  return readText(session, path)
}

async function buildModelOf(session: AnalysisSession, path: string): Promise<ScriptModel | null> {
  const text = await readText(session, path)
  if (text === null || text.length > MAXIMUM_ANALYSED_TEXT_LENGTH) {
    return null
  }
  const rememberedModel = rememberedModels.get(path)
  if (rememberedModel !== undefined && rememberedModel.text === text) {
    return rememberedModel
  }
  const model = buildScriptModel(path, text)
  rememberModel(path, model)

  return model
}

const WINDOW_LENGTHS_TRIED = [20_000, 400_000]

function exportedDeclarationPattern(exportedName: string): RegExp {
  const escapedName = exportedName.replace(/[$]/g, '\\$')

  return new RegExp(
    `^export\\s+(?:declare\\s+)?(?:abstract\\s+)?(?:async\\s+)?(?:const|let|var|function|class|interface|type|enum|namespace)\\s+${escapedName}\\b`,
    'm',
  )
}

async function buildWindowModelOf(
  session: AnalysisSession,
  path: string,
  exportedName: string,
): Promise<ScriptModel | null> {
  const text = await readText(session, path)
  const declarationMatch =
    text === null || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(exportedName)
      ? null
      : exportedDeclarationPattern(exportedName).exec(text)
  if (text === null || declarationMatch === null) {
    return null
  }
  const rememberedKey = `${path}#${exportedName}`
  const rememberedModel = rememberedModels.get(rememberedKey)
  if (rememberedModel !== undefined && rememberedModel.text === text) {
    return rememberedModel
  }
  let model: ScriptModel | null = null
  for (const windowLength of WINDOW_LENGTHS_TRIED) {
    model = buildScriptModel(path, text, {
      start: declarationMatch.index,
      end: Math.min(text.length, declarationMatch.index + windowLength),
    })
    const declaration = model.structure.fileScope.declarations.find(candidate => candidate.name === exportedName)
    const isReadWhole =
      declaration !== undefined &&
      (declaration.valueTokenIndex === null || model.structure.matchingIndexes[declaration.valueTokenIndex] !== -1)
    if (isReadWhole || declaration?.kind === 'type' || declaration?.kind === 'constant') {
      break
    }
  }
  if (model !== null) {
    rememberModel(rememberedKey, model)
  }

  return model
}

// A model of the part of a file that declares one exported name, for a file too large to analyse whole.
export function windowModelOfExport(
  session: AnalysisSession,
  path: string,
  exportedName: string,
): Promise<ScriptModel | null> {
  const key = `${path}\u0000${exportedName}`
  let model = session.models.get(key)
  if (model === undefined) {
    model = buildWindowModelOf(session, path, exportedName)
    session.models.set(key, model)
  }

  return model
}

// Null for a file that cannot be read, that is no script, or that is too large to analyse whole.
export function modelOf(session: AnalysisSession, path: string): Promise<ScriptModel | null> {
  let model = session.models.get(path)
  if (model === undefined) {
    model = isScriptPath(path) ? buildModelOf(session, path) : Promise.resolve(null)
    session.models.set(path, model)
  }

  return model
}
