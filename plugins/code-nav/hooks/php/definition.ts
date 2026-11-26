import type { CodePosition, DefinitionAnswer } from '../../types'
import type { Workspace } from '../workspace'
import { createPhpProject } from './project'
import { resolvePhpClick } from './resolution'

// Where the name under a click is declared. A construct the analysis cannot read answers no symbol or candidates;
// a failure of the analysis itself is left to the caller, which tells the person.
export async function resolvePhpDefinition(workspace: Workspace, position: CodePosition): Promise<DefinitionAnswer> {
  const { symbol, targets, isOnDeclaration, note } = await resolvePhpClick(createPhpProject(workspace), position)

  return { symbol, targets, isOnDeclaration, note }
}
