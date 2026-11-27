import type { ScriptDeclaration, ScriptStructure } from './declarations'
import type { ScriptModel } from './script-model'

// A place the analysis arrived at. With a declaration: its name. Without one: the offset given (a name a template
// directive declares, an "export default" expression), or the file itself when the offset is null too.
export type Located = {
  path: string
  model: ScriptModel | null
  // The structure the declaration belongs to: the file's, or that of one template expression.
  structure: ScriptStructure | null
  declaration: ScriptDeclaration | null
  offset: number | null
}

export function locatedDeclaration(model: ScriptModel, structure: ScriptStructure, declaration: ScriptDeclaration): Located {
  return { path: model.path, model, structure, declaration, offset: null }
}

export function locatedOffset(model: ScriptModel, offset: number): Located {
  return { path: model.path, model, structure: null, declaration: null, offset }
}

export function locatedFile(path: string): Located {
  return { path, model: null, structure: null, declaration: null, offset: null }
}

export function offsetOfLocated(located: Located): number | null {
  if (located.declaration !== null && located.structure !== null) {
    return located.structure.tokens[located.declaration.nameTokenIndex]?.start ?? null
  }

  return located.offset
}

export function keyOfLocated(located: Located): string {
  return `${located.path}:${offsetOfLocated(located) ?? 'file'}`
}

export function isSamePlace(first: Located, second: Located): boolean {
  return first.path === second.path && offsetOfLocated(first) === offsetOfLocated(second)
}

export function withoutDuplicates(locations: readonly Located[]): Located[] {
  const seenKeys = new Set<string>()

  return locations.filter(located => {
    const key = keyOfLocated(located)
    if (seenKeys.has(key)) {
      return false
    }
    seenKeys.add(key)

    return true
  })
}

export function isDependencyPath(path: string): boolean {
  return path.startsWith('node_modules/') || path.includes('/node_modules/')
}
