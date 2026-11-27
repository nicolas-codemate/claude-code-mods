import type { SymbolEntry, SymbolKind } from '../../types'
import { parsePhpOutline, positionOfToken } from './outline'

// The declarations of one PHP file: its classes with their methods, properties and constants, its functions.
export function phpSymbolsOfFile(path: string, text: string): SymbolEntry[] {
  const outline = parsePhpOutline(path, text)
  const symbols: SymbolEntry[] = []
  const addSymbol = (name: string, kind: SymbolKind, tokenIndex: number, container: string | null) => {
    symbols.push({ name, kind, path, line: positionOfToken(outline, tokenIndex).line, container })
  }
  for (const classDeclaration of outline.classes) {
    addSymbol(classDeclaration.name, classDeclaration.kind, classDeclaration.nameTokenIndex, null)
    for (const constant of classDeclaration.constants) {
      addSymbol(constant.name, 'constant', constant.tokenIndex, classDeclaration.name)
    }
    for (const property of classDeclaration.properties) {
      addSymbol(property.name, 'property', property.tokenIndex, classDeclaration.name)
    }
    for (const method of classDeclaration.methods) {
      addSymbol(method.name ?? '', 'method', method.nameTokenIndex ?? method.keywordTokenIndex, classDeclaration.name)
    }
  }
  for (const functionScope of outline.functions) {
    addSymbol(functionScope.name ?? '', 'function', functionScope.nameTokenIndex ?? functionScope.keywordTokenIndex, null)
  }
  for (const constant of outline.constants) {
    addSymbol(constant.name, 'constant', constant.tokenIndex, null)
  }

  return symbols.sort((first, second) => first.line - second.line)
}
