import type { CodePosition, DefinitionAnswer, ImplementationsAnswer, UsagesAnswer } from '../types'
import { analysisOfPath } from './languages'
import type { Workspace } from './workspace'

export function resolveDefinition(workspace: Workspace, position: CodePosition): Promise<DefinitionAnswer> {
  return analysisOfPath(position.path).definition(workspace, position)
}

export function findUsages(workspace: Workspace, position: CodePosition): Promise<UsagesAnswer> {
  return analysisOfPath(position.path).usages(workspace, position)
}

export function findImplementations(workspace: Workspace, position: CodePosition): Promise<ImplementationsAnswer> {
  return analysisOfPath(position.path).implementations(workspace, position)
}

export function findParents(workspace: Workspace, position: CodePosition): Promise<ImplementationsAnswer> {
  return analysisOfPath(position.path).parents(workspace, position)
}

