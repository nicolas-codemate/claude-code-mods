import type { ClickedSymbol, CodePosition } from '../../types'
import { bindingVisibleAt, DECLARATION_KIND_WORDS } from './declarations'
import type { ReadingContext } from './reference-resolution'
import type { ScriptModel } from './script-model'
import { isPunctuation } from './structure'
import { lineAndColumnOfOffset, offsetOfLineAndColumn } from '../text-position'
import { tokenIndexAtOffset } from './tokenizer'
import type { TextRange } from './vue-blocks'
import { componentNameOfTag, localNamesVisibleFrom } from './vue-template'
import type { TemplateLocalName } from './vue-template'

// What stands under a click. name: an identifier of the script or of a template expression. specifier: the string
// of an import. componentTag: a tag of a Vue template. templateLocal: a name a v-for or a slot declares, clicked
// where it is declared.
export type Click =
  | { kind: 'none' }
  | { kind: 'name'; context: ReadingContext; tokenIndex: number }
  | { kind: 'specifier'; specifier: string; range: TextRange }
  | { kind: 'componentTag'; tagName: string; range: TextRange }
  | { kind: 'templateLocal'; localName: TemplateLocalName }

const NO_CLICK: Click = { kind: 'none' }

const WORDS_NAMING_NOTHING = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break',
  'continue', 'new', 'delete', 'typeof', 'instanceof', 'void', 'in', 'class', 'extends', 'import', 'export', 'default',
  'try', 'catch', 'finally', 'throw', 'await', 'yield', 'true', 'false', 'null', 'undefined', 'this', 'super', 'with',
  'debugger', 'enum',
])
// Words the language reads as keywords in one position and as plain names elsewhere: a symbol only when the file
// declares such a name.
const WORDS_NAMING_SOMETHING_ONLY_WHEN_DECLARED = new Set([
  'type', 'from', 'as', 'of', 'get', 'set', 'async', 'static', 'declare', 'readonly', 'abstract', 'namespace', 'module',
  'is', 'keyof', 'infer', 'satisfies', 'override', 'accessor', 'public', 'private', 'protected', 'implements',
  'interface', 'string', 'number', 'boolean', 'any', 'unknown', 'never', 'object', 'symbol', 'bigint', 'constructor',
  'global', 'asserts', 'unique', 'out',
])

function isWithin(range: TextRange, offset: number): boolean {
  return offset >= range.start && offset < range.end
}

function nameClickAt(context: ReadingContext, tokenIndex: number): Click {
  const { structure } = context
  const token = structure.tokens[tokenIndex]
  if (token === undefined || token.kind !== 'identifier') {
    return NO_CLICK
  }
  const previousToken = structure.tokens[tokenIndex - 1]
  if (isPunctuation(previousToken, '.') || isPunctuation(previousToken, '?.')) {
    return { kind: 'name', context, tokenIndex }
  }
  if (WORDS_NAMING_NOTHING.has(token.text)) {
    return NO_CLICK
  }
  const isDeclaredName =
    structure.declarationAtToken.has(tokenIndex) ||
    structure.importedNameAtToken.has(tokenIndex) ||
    bindingVisibleAt(structure, token.text, tokenIndex) !== null
  if (WORDS_NAMING_SOMETHING_ONLY_WHEN_DECLARED.has(token.text) && !isDeclaredName) {
    return NO_CLICK
  }

  return { kind: 'name', context, tokenIndex }
}

function readTemplateClick(model: ScriptModel, offset: number): Click {
  const scan = model.templateScan()
  if (scan === null) {
    return NO_CLICK
  }
  for (const element of scan.elements) {
    if (isWithin(element.nameRange, offset)) {
      return { kind: 'componentTag', tagName: element.tagName, range: element.nameRange }
    }
    if (element.closingNameRange !== null && isWithin(element.closingNameRange, offset)) {
      return { kind: 'componentTag', tagName: element.tagName, range: element.closingNameRange }
    }
    const localName = element.localNames.find(candidate => isWithin(candidate, offset))
    if (localName !== undefined) {
      return { kind: 'templateLocal', localName }
    }
  }
  const expression = scan.expressions.find(candidate => isWithin(candidate, offset))
  if (expression === undefined) {
    return NO_CLICK
  }
  const structure = model.structureOfTemplateExpression(expression)
  const context: ReadingContext = {
    model,
    structure,
    templateLocalNames: localNamesVisibleFrom(scan, expression.elementIndex),
  }

  return nameClickAt(context, tokenIndexAtOffset(structure.tokens, offset))
}

// A click in a comment, in blank space or in a string that names no module is no click on a symbol.
export function readClickAtOffset(model: ScriptModel, offset: number): Click {
  if (model.templateRange !== null && isWithin(model.templateRange, offset)) {
    return readTemplateClick(model, offset)
  }
  const { structure } = model
  const tokenIndex = tokenIndexAtOffset(structure.tokens, offset)
  const token = structure.tokens[tokenIndex]
  if (token === undefined) {
    return NO_CLICK
  }
  if (token.kind === 'string') {
    const specifier = structure.specifierAtToken.get(tokenIndex)

    return specifier === undefined
      ? NO_CLICK
      : { kind: 'specifier', specifier, range: { start: token.start, end: token.end } }
  }

  return nameClickAt({ model, structure, templateLocalNames: null }, tokenIndex)
}

export function readClickAtPosition(model: ScriptModel, position: CodePosition): Click {
  const offset = offsetOfLineAndColumn(model.lineStartOffsets, position.line, position.column)

  return offset === null ? NO_CLICK : readClickAtOffset(model, offset)
}

function describedRange(model: ScriptModel, name: string, range: TextRange, description: string): ClickedSymbol {
  const start = lineAndColumnOfOffset(model.lineStartOffsets, range.start)

  return {
    name,
    line: start.line,
    startColumn: start.column,
    endColumn: start.column + (range.end - range.start),
    description,
  }
}

function descriptionOfName(context: ReadingContext, tokenIndex: number): string {
  const { structure } = context
  const token = structure.tokens[tokenIndex]
  const name = token?.text ?? ''
  const previousToken = structure.tokens[tokenIndex - 1]
  if (isPunctuation(previousToken, '.') || isPunctuation(previousToken, '?.')) {
    const receiverToken = structure.tokens[tokenIndex - 2]
    const receiver = receiverToken !== undefined && receiverToken.kind === 'identifier' ? receiverToken.text : 'a value'

    return `member ${name} of ${receiver}`
  }
  if (structure.importedNameAtToken.has(tokenIndex) || structure.reexportedNameAtToken.has(tokenIndex)) {
    return `${DECLARATION_KIND_WORDS.import} ${name}`
  }
  const declaration = structure.declarationAtToken.get(tokenIndex) ?? bindingVisibleAt(structure, name, tokenIndex)
  if (declaration !== null && !declaration.isShorthand) {
    return `${DECLARATION_KIND_WORDS[declaration.kind]} ${name}`
  }

  return context.templateLocalNames === null ? `name ${name}` : `name ${name} of the template`
}

export function symbolOfClick(model: ScriptModel, click: Click): ClickedSymbol | null {
  switch (click.kind) {
    case 'none':
      return null
    case 'name': {
      const token = click.context.structure.tokens[click.tokenIndex]
      return token === undefined
        ? null
        : describedRange(model, token.text, token, descriptionOfName(click.context, click.tokenIndex))
    }
    case 'specifier':
      return describedRange(model, click.specifier, click.range, `module ${click.specifier}`)
    case 'componentTag':
      return describedRange(model, click.tagName, click.range, `component ${componentNameOfTag(click.tagName)}`)
    case 'templateLocal':
      return describedRange(model, click.localName.name, click.localName, `template variable ${click.localName.name}`)
  }
}
