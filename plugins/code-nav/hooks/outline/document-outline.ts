import type { SymbolEntry, SymbolKind } from '../../types'
import { forEachOutlineLine, indentationOfLine, MAXIMUM_OUTLINE_ENTRIES } from './outline-lines'

type OpenHeading = { level: number; name: string }

// Each heading is held by the closest heading above it of a lower level: a "###" under a "##".
function pushHeading(symbols: SymbolEntry[], openHeadings: OpenHeading[], path: string, heading: OpenHeading, line: number): void {
  while (openHeadings.length > 0 && (openHeadings.at(-1)?.level ?? 0) >= heading.level) {
    openHeadings.pop()
  }
  symbols.push({ name: heading.name, kind: 'section', path, line, container: openHeadings.at(-1)?.name ?? null })
  openHeadings.push(heading)
}

const MARKDOWN_FENCE = /^ {0,3}(`{3,}|~{3,})/
const MARKDOWN_ATX_HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/
const MARKDOWN_SETEXT_UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/
const MARKDOWN_BLOCK_START = /^ {0,3}(?:[-*+>]|\d+[.)]|#|\||<)/

export function markdownSymbols(path: string, text: string): SymbolEntry[] {
  const symbols: SymbolEntry[] = []
  const openHeadings: OpenHeading[] = []
  let openFence: string | null = null
  let isInsideFrontMatter = false
  let previousParagraphLine: { text: string; line: number } | null = null

  forEachOutlineLine(text, (lineText, line) => {
    if (line === 1 && lineText.trim() === '---') {
      isInsideFrontMatter = true
      return true
    }
    if (isInsideFrontMatter) {
      isInsideFrontMatter = !['---', '...'].includes(lineText.trim())
      return true
    }
    if (openFence !== null) {
      const trimmedLine = lineText.trim()
      if (trimmedLine.startsWith(openFence) && /^([`~])\1*$/.test(trimmedLine)) {
        openFence = null
      }
      return true
    }
    const fence = MARKDOWN_FENCE.exec(lineText)
    if (fence) {
      openFence = fence[1] ?? null
      previousParagraphLine = null
      return true
    }
    const atxHeading = MARKDOWN_ATX_HEADING.exec(lineText)
    if (atxHeading && atxHeading[2]) {
      pushHeading(symbols, openHeadings, path, { level: atxHeading[1]?.length ?? 1, name: atxHeading[2] }, line)
      previousParagraphLine = null
      return symbols.length < MAXIMUM_OUTLINE_ENTRIES
    }
    const setextUnderline = MARKDOWN_SETEXT_UNDERLINE.exec(lineText)
    if (setextUnderline && previousParagraphLine) {
      const level = setextUnderline[1]?.startsWith('=') ? 1 : 2
      pushHeading(symbols, openHeadings, path, { level, name: previousParagraphLine.text }, previousParagraphLine.line)
      previousParagraphLine = null
      return symbols.length < MAXIMUM_OUTLINE_ENTRIES
    }
    const startsParagraph = lineText.trim() !== '' && indentationOfLine(lineText) < 4 && !MARKDOWN_BLOCK_START.test(lineText)
    previousParagraphLine = startsParagraph ? { text: lineText.trim(), line } : null
    return true
  })

  return symbols
}

const ASCIIDOC_HEADING = /^(={1,6})\s+(\S.*?)\s*$/
const ASCIIDOC_DELIMITED_BLOCK = /^(?:-{4,}|\.{4,}|`{3,}|\+{4,}|\/{4,})\s*$/

export function asciidocSymbols(path: string, text: string): SymbolEntry[] {
  const symbols: SymbolEntry[] = []
  const openHeadings: OpenHeading[] = []
  let openDelimiter: string | null = null

  forEachOutlineLine(text, (lineText, line) => {
    const trimmedLine = lineText.trimEnd()
    if (ASCIIDOC_DELIMITED_BLOCK.test(trimmedLine)) {
      openDelimiter = openDelimiter === null ? trimmedLine : openDelimiter === trimmedLine ? null : openDelimiter
      return true
    }
    const heading = openDelimiter === null ? ASCIIDOC_HEADING.exec(trimmedLine) : null
    if (heading && heading[2]) {
      pushHeading(symbols, openHeadings, path, { level: heading[1]?.length ?? 1, name: heading[2] }, line)
    }
    return symbols.length < MAXIMUM_OUTLINE_ENTRIES
  })

  return symbols
}

const YAML_KEY = /^(?<indentation> *)(?!-(?:\s|$))(?<key>"[^"]*"|'[^']*'|[^\s#"'][^#]*?)\s*:(?=\s|$)(?<value>.*)$/
const YAML_BLOCK_SCALAR_VALUE = /^\s*[|>][-+0-9]*\s*(?:#.*)?$/

function unquoted(key: string): string {
  return /^(["']).*\1$/.test(key) ? key.slice(1, -1) : key
}

// The keys at the root of the document, and the keys one level under each. The level under a key is the indentation
// of the first line below it; a key further in, a list item and the text of a multi-line string are left out.
export function yamlSymbols(path: string, text: string): SymbolEntry[] {
  const symbols: SymbolEntry[] = []
  let rootKey: string | null = null
  let childIndentation: number | null = null
  let blockScalarIndentation: number | null = null

  forEachOutlineLine(text, (lineText, line) => {
    const trimmedLine = lineText.trim()
    if (trimmedLine === '') {
      return true
    }
    const indentation = indentationOfLine(lineText)
    if (blockScalarIndentation !== null) {
      if (indentation > blockScalarIndentation) {
        return true
      }
      blockScalarIndentation = null
    }
    if (trimmedLine.startsWith('#') || trimmedLine === '---' || trimmedLine === '...' || lineText.startsWith('%')) {
      return true
    }
    if (indentation > 0 && rootKey !== null && childIndentation === null) {
      childIndentation = indentation
    }
    const key = YAML_KEY.exec(lineText)?.groups
    if (key?.key === undefined) {
      return true
    }
    if (YAML_BLOCK_SCALAR_VALUE.test(key.value ?? '')) {
      blockScalarIndentation = indentation
    }
    if (indentation === 0) {
      rootKey = unquoted(key.key)
      childIndentation = null
      symbols.push({ name: rootKey, kind: 'section', path, line, container: null })
    } else if (indentation === childIndentation && rootKey !== null) {
      symbols.push({ name: unquoted(key.key), kind: 'section', path, line, container: rootKey })
    }
    return symbols.length < MAXIMUM_OUTLINE_ENTRIES
  })

  return symbols
}

const INI_SECTION = /^\s*\[\[?\s*(?<name>[\w.\- "'$:/]+?)\s*\]\]?\s*(?:[#;].*)?$/

// A dotted table "[shop.payment]" is held by the table "[shop]" when the file declares it.
export function iniSymbols(path: string, text: string): SymbolEntry[] {
  const symbols: SymbolEntry[] = []
  const declaredSections = new Set<string>()
  let tripleQuoteDelimiter: string | null = null

  forEachOutlineLine(text, (lineText, line) => {
    if (tripleQuoteDelimiter !== null) {
      if (lineText.includes(tripleQuoteDelimiter)) {
        tripleQuoteDelimiter = null
      }
      return true
    }
    const openedDelimiter = ['"""', "'''"].find(delimiter => lineText.split(delimiter).length === 2)
    if (openedDelimiter) {
      tripleQuoteDelimiter = openedDelimiter
      return true
    }
    const name = INI_SECTION.exec(lineText)?.groups?.name
    if (name === undefined) {
      return true
    }
    let container: string | null = null
    for (let dotIndex = name.lastIndexOf('.'); dotIndex > 0; dotIndex = name.lastIndexOf('.', dotIndex - 1)) {
      const prefix = name.slice(0, dotIndex)
      if (declaredSections.has(prefix)) {
        container = prefix
        break
      }
    }
    declaredSections.add(name)
    symbols.push({ name, kind: 'section', path, line, container })
    return symbols.length < MAXIMUM_OUTLINE_ENTRIES
  })

  return symbols
}

const ENVIRONMENT_KEY = /^\s*(?:export\s+)?(?<name>[A-Za-z_][\w.-]*)\s*[=:]/

// A .env or .properties file: one key per line, a value ended by a backslash going on to the next line.
export function environmentSymbols(path: string, text: string): SymbolEntry[] {
  const symbols: SymbolEntry[] = []
  let continuesPreviousLine = false

  forEachOutlineLine(text, (lineText, line) => {
    const isContinued = continuesPreviousLine
    continuesPreviousLine = lineText.endsWith('\\')
    const trimmedLine = lineText.trim()
    if (isContinued || trimmedLine.startsWith('#') || trimmedLine.startsWith('!')) {
      return true
    }
    const name = ENVIRONMENT_KEY.exec(lineText)?.groups?.name
    if (name !== undefined) {
      symbols.push({ name, kind: 'section', path, line, container: null })
    }
    return symbols.length < MAXIMUM_OUTLINE_ENTRIES
  })

  return symbols
}

// "build test: deps" declares the targets build and test; "NAME := value", "NAME ::= value" and "NAME = a:b" are
// variables, caught by the "=" that follows the colon or comes before it.
const MAKE_RULE = /^(?<targets>[^\s:#=][^:#=]*?)\s*:(?::)?(?![:=])/
const MAKE_SPECIAL_TARGET = /^\.[A-Z_]+$/

export function makefileSymbols(path: string, text: string): SymbolEntry[] {
  const symbols: SymbolEntry[] = []
  let isInsideDefine = false

  forEachOutlineLine(text, (lineText, line) => {
    if (isInsideDefine) {
      isInsideDefine = !/^\s*endef\b/.test(lineText)
      return true
    }
    if (/^\s*define\b/.test(lineText)) {
      isInsideDefine = true
      return true
    }
    if (lineText.startsWith('\t') || lineText.trimStart().startsWith('#')) {
      return true
    }
    const targets = MAKE_RULE.exec(lineText)?.groups?.targets
    if (targets === undefined || /^(?:export|override|ifeq|ifneq|ifdef|ifndef|include|-include|vpath)\b/.test(targets)) {
      return true
    }
    for (const target of targets.split(/\s+/)) {
      if (target !== '' && !MAKE_SPECIAL_TARGET.test(target)) {
        symbols.push({ name: target, kind: 'section', path, line, container: null })
      }
    }
    return symbols.length < MAXIMUM_OUTLINE_ENTRIES
  })

  return symbols
}

const DOCKERFILE_FROM = /^\s*FROM\s+(?:--\S+\s+)*(?<image>\S+)(?:\s+AS\s+(?<stage>\S+))?/i

// Each build stage, named after its "AS" alias, else after its image.
export function dockerfileSymbols(path: string, text: string): SymbolEntry[] {
  const symbols: SymbolEntry[] = []

  forEachOutlineLine(text, (lineText, line) => {
    const from = DOCKERFILE_FROM.exec(lineText)?.groups
    const name = from?.stage ?? from?.image
    if (name !== undefined) {
      symbols.push({ name, kind: 'section', path, line, container: null })
    }
    return symbols.length < MAXIMUM_OUTLINE_ENTRIES
  })

  return symbols
}

const SQL_KIND_BY_OBJECT = {
  TABLE: 'class',
  VIEW: 'class',
  FUNCTION: 'function',
  PROCEDURE: 'function',
  PROC: 'function',
  TRIGGER: 'section',
  INDEX: 'section',
  SEQUENCE: 'section',
  SCHEMA: 'section',
  DATABASE: 'section',
  EXTENSION: 'section',
  TYPE: 'type',
  DOMAIN: 'type',
} satisfies Record<string, SymbolKind>

type SqlObject = keyof typeof SQL_KIND_BY_OBJECT

function isSqlObject(word: string): word is SqlObject {
  return Object.hasOwn(SQL_KIND_BY_OBJECT, word)
}

const SQL_OPTIONS = String.raw`(?:(?:TEMP|TEMPORARY|UNIQUE|MATERIALIZED|RECURSIVE|GLOBAL|LOCAL|UNLOGGED|EXTERNAL|CLUSTERED|NONCLUSTERED|DEFINER\s*=\s*\S+|ALGORITHM\s*=\s*\w+|SQL\s+SECURITY\s+\w+)\s+)*`
const SQL_CREATE = new RegExp(
  String.raw`^\s*CREATE\s+(?:OR\s+(?:REPLACE|ALTER)\s+)?${SQL_OPTIONS}(?<object>${Object.keys(SQL_KIND_BY_OBJECT).join('|')})\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?<name>[^\s(;]+)`,
  'i',
)

export function sqlSymbols(path: string, text: string): SymbolEntry[] {
  const symbols: SymbolEntry[] = []
  let isInsideBlockComment = false

  forEachOutlineLine(text, (lineText, line) => {
    const trimmedLine = lineText.trim()
    if (isInsideBlockComment) {
      isInsideBlockComment = !trimmedLine.includes('*/')
      return true
    }
    if (trimmedLine.startsWith('/*')) {
      isInsideBlockComment = !trimmedLine.includes('*/', 2)
      return true
    }
    const create = SQL_CREATE.exec(lineText)?.groups
    const object = create?.object?.toUpperCase()
    if (create?.name !== undefined && object !== undefined && isSqlObject(object)) {
      symbols.push({ name: create.name.replace(/["`[\]]/g, ''), kind: SQL_KIND_BY_OBJECT[object], path, line, container: null })
    }
    return symbols.length < MAXIMUM_OUTLINE_ENTRIES
  })

  return symbols
}

const TEMPLATE_TAG = /\{%-?\s*(?<tag>block|endblock|macro|endmacro)\b(?:\s+(?<name>\w+))?(?<rest>.*?)-?%\}/g

// Twig and Jinja blocks and macros, a block nested in another held by it. "{% block title 'Orders' %}" is a block
// written whole on its tag, with no end tag to wait for.
export function templateSymbols(path: string, text: string): SymbolEntry[] {
  const symbols: SymbolEntry[] = []
  const openTags: string[] = []

  forEachOutlineLine(text, (lineText, line) => {
    if (!lineText.includes('{%')) {
      return true
    }
    for (const match of lineText.matchAll(TEMPLATE_TAG)) {
      const tag = match.groups?.tag
      const name = match.groups?.name
      if (tag === 'endblock' || tag === 'endmacro') {
        openTags.pop()
        continue
      }
      if (name === undefined) {
        continue
      }
      const isMacro = tag === 'macro'
      symbols.push({ name, kind: isMacro ? 'function' : 'section', path, line, container: openTags.at(-1) ?? null })
      if (isMacro || (match.groups?.rest ?? '').trim() === '') {
        openTags.push(name)
      }
    }
    return symbols.length < MAXIMUM_OUTLINE_ENTRIES
  })

  return symbols
}

const ELEMENT_WITH_IDENTIFIER = /<(?<tag>[A-Za-z][\w:.-]*)\b[^>]*?\sid\s*=\s*(?:"(?<doubleQuoted>[^"]*)"|'(?<singleQuoted>[^']*)')/g

// Elements carrying an id attribute, named "form#checkout" as a CSS selector would.
export function markupSymbols(path: string, text: string): SymbolEntry[] {
  const symbols: SymbolEntry[] = []
  let isInsideComment = false

  forEachOutlineLine(text, (lineText, line) => {
    if (isInsideComment || lineText.trimStart().startsWith('<!--')) {
      isInsideComment = !lineText.includes('-->')
      return true
    }
    for (const match of lineText.matchAll(ELEMENT_WITH_IDENTIFIER)) {
      const identifier = match.groups?.doubleQuoted ?? match.groups?.singleQuoted ?? ''
      if (identifier !== '' && !/[{}<>]/.test(identifier)) {
        symbols.push({ name: `${match.groups?.tag ?? ''}#${identifier}`, kind: 'section', path, line, container: null })
      }
    }
    return symbols.length < MAXIMUM_OUTLINE_ENTRIES
  })

  return symbols
}
