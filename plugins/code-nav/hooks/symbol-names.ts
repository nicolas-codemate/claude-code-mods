import type { SymbolEntry, SymbolKind } from '../types'

export type ClassLikeKind = Extract<SymbolKind, 'class' | 'interface' | 'trait' | 'enum'>

const IS_CLASS_LIKE_KIND: Record<SymbolKind, boolean> = {
  class: true,
  interface: true,
  trait: true,
  enum: true,
  function: false,
  method: false,
  constant: false,
  property: false,
  type: false,
  variable: false,
  section: false,
}

export const CLASS_LIKE_KINDS: readonly ClassLikeKind[] = ['class', 'interface', 'trait', 'enum']

export function isClassLikeKind(kind: SymbolKind): kind is ClassLikeKind {
  return IS_CLASS_LIKE_KIND[kind]
}

// How a declaration is named in a list: a member with what holds it.
export function labelOfSymbol(symbol: Pick<SymbolEntry, 'name' | 'container'>): string {
  return symbol.container === null ? symbol.name : `${symbol.container}::${symbol.name}`
}

export function escapedForRegularExpression(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// A pattern for the name written as a whole word. A word boundary is asked only on the side where the name itself
// has a word character: "$order" starts with none, and a boundary there would never match.
export function wholeNamePattern(name: string): string {
  const startBoundary = /^[A-Za-z0-9_]/.test(name) ? '\\b' : ''
  const endBoundary = /[A-Za-z0-9_]$/.test(name) ? '\\b' : ''

  return `${startBoundary}${escapedForRegularExpression(name)}${endBoundary}`
}
