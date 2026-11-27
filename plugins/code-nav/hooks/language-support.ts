import type { CodePosition, DefinitionAnswer, ImplementationsAnswer, SymbolEntry, SymbolKind, UsagesAnswer } from '../types'
import { CLASS_LIKE_KINDS } from './symbol-names'
import type { ClassLikeKind } from './symbol-names'
import type { Workspace } from './workspace'

// The four questions the pane asks about a name under the pointer. Each reads only the files it needs through the
// workspace, and answers with places, or with candidates when the code does not say which one is meant.
export type Analysis = {
  definition: (workspace: Workspace, position: CodePosition) => Promise<DefinitionAnswer>
  usages: (workspace: Workspace, position: CodePosition) => Promise<UsagesAnswer>
  implementations: (workspace: Workspace, position: CodePosition) => Promise<ImplementationsAnswer>
  // The inverse of implementations: on a method, the declarations it overrides or implements; on a class, the classes
  // and interfaces above it.
  parents: (workspace: Workspace, position: CodePosition) => Promise<ImplementationsAnswer>
}

// What one printed keyword declares. A class-like opens a container for the indented declarations below it; any other
// keyword declares a member when it stands indented under a class-like listed in memberKindByClassLike, and a
// declaration of its own otherwise (dropped when standaloneKind is null).
export type DeclarationReading =
  | { classLikeKind: ClassLikeKind }
  | { standaloneKind: SymbolKind | null; memberKindByClassLike: Partial<Record<ClassLikeKind, SymbolKind>> }

// How the project index finds the declarations of a language with one ripgrep search over its files. The search prints
// one line per declaration, "<line number>:<indentation><keyword> <name>": the indentation is one whitespace character
// when the declaration does not start its line, nothing otherwise; the keyword is one key of readingByKeyword. The
// pattern's capture groups, pasted together by the replacement, produce that line.
export type LanguageDeclarations = {
  pattern: string
  replacement: string
  readingByKeyword: Readonly<Record<string, DeclarationReading>>
  // Words the pattern cannot tell apart from a name: a control statement written like a method.
  wordsThatAreNotNames: readonly string[]
}

// A language the mod navigates by its meaning rather than by its words. Files with one of its extensions get their
// structure from symbolsOfFile, their declarations in the project index from declarations, and their names answered
// by analysis. Colouring, badges and the structure of every other language are declared by extension elsewhere.
export type NavigatedLanguageSupport = {
  // Lowercase, without the dot.
  extensions: readonly string[]
  // The declarations of one file as the structure, the bar under the code and the hover tag read them.
  symbolsOfFile: (path: string, text: string) => SymbolEntry[]
  declarations: LanguageDeclarations
  analysis: Analysis
}

export function memberOfEvery(memberKind: SymbolKind): Partial<Record<ClassLikeKind, SymbolKind>> {
  return Object.fromEntries(CLASS_LIKE_KINDS.map(classLikeKind => [classLikeKind, memberKind]))
}

