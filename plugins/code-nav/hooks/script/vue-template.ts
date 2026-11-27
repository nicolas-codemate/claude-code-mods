import { readParameterList } from './bindings'
import { isIdentifier, isPunctuation, matchBrackets } from './structure'
import { tokenizeScript } from './tokenizer'
import type { TextRange } from './vue-blocks'

// A name a directive declares for the content of its element: the item of a v-for, the props of a slot.
export type TemplateLocalName = { name: string; start: number; end: number }

export type TemplateElement = {
  tagName: string
  nameRange: TextRange
  closingNameRange: TextRange | null
  parentIndex: number | null
  localNames: TemplateLocalName[]
}

// The JavaScript of an interpolation or of a directive's value; elementIndex is the element whose local names it sees.
export type TemplateExpression = TextRange & { elementIndex: number | null }

export type TemplateScan = { elements: TemplateElement[]; expressions: TemplateExpression[] }

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
])

function isWhitespaceCode(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13
}

function isTagNameCode(code: number): boolean {
  return (
    (code >= 97 && code <= 122) ||
    (code >= 65 && code <= 90) ||
    (code >= 48 && code <= 57) ||
    code === 45 ||
    code === 95 ||
    code === 46 ||
    code === 58
  )
}

function localNamesOfParameters(text: string, start: number, end: number): TemplateLocalName[] {
  const tokens = tokenizeScript(text, { start, end })
  const matchingIndexes = matchBrackets(tokens)
  const isParenthesized = isPunctuation(tokens[0], '(') && matchingIndexes[0] === tokens.length - 1
  const parameters = isParenthesized
    ? readParameterList(tokens, matchingIndexes, 1, tokens.length - 1)
    : readParameterList(tokens, matchingIndexes, 0, tokens.length)

  return parameters.flatMap(parameter =>
    parameter.boundNames.flatMap(boundName => {
      const token = tokens[boundName.tokenIndex]
      return token === undefined ? [] : [{ name: token.text, start: token.start, end: token.end }]
    }),
  )
}

// "(order, index) in orders": the names before "in" or "of" are declared, what follows is the list's expression.
function readIteration(
  text: string,
  valueRange: TextRange,
): { localNames: TemplateLocalName[]; listRange: TextRange | null } {
  const tokens = tokenizeScript(text, valueRange)
  const matchingIndexes = matchBrackets(tokens)
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index]
    const closeIndex = matchingIndexes[index] ?? -1
    if (token !== undefined && token.kind === 'punctuation' && closeIndex > index) {
      index = closeIndex + 1
      continue
    }
    if (index > 0 && (isIdentifier(token, 'in') || isIdentifier(token, 'of'))) {
      const listStart = tokens[index + 1]?.start
      return {
        localNames: localNamesOfParameters(text, valueRange.start, token.start),
        listRange: listStart === undefined ? null : { start: listStart, end: valueRange.end },
      }
    }
    index += 1
  }

  return { localNames: [], listRange: valueRange }
}

// The elements of a template block with the names their directives declare, and every piece of JavaScript in it.
export function scanVueTemplate(text: string, templateRange: TextRange): TemplateScan {
  const elements: TemplateElement[] = []
  const expressions: TemplateExpression[] = []
  const openElementIndexes: number[] = []
  const end = templateRange.end
  let position = templateRange.start

  function innermostOpenElementIndex(): number | null {
    return openElementIndexes[openElementIndexes.length - 1] ?? null
  }

  function skipWhitespace(): void {
    while (position < end && isWhitespaceCode(text.charCodeAt(position))) {
      position += 1
    }
  }

  function readDirective(attributeName: string, valueRange: TextRange, elementIndex: number): void {
    const element = elements[elementIndex]
    if (element === undefined || valueRange.end <= valueRange.start) {
      return
    }
    if (attributeName === 'v-for') {
      const iteration = readIteration(text, valueRange)
      element.localNames.push(...iteration.localNames)
      if (iteration.listRange !== null) {
        expressions.push({ ...iteration.listRange, elementIndex: element.parentIndex })
      }
      return
    }
    if (attributeName.startsWith('#') || attributeName.startsWith('v-slot') || attributeName === 'slot-scope') {
      element.localNames.push(...localNamesOfParameters(text, valueRange.start, valueRange.end))
      return
    }
    const firstCharacter = attributeName[0]
    const namesATemplateRef = attributeName === 'ref'
    if (
      firstCharacter === ':' ||
      firstCharacter === '@' ||
      firstCharacter === '.' ||
      attributeName.startsWith('v-') ||
      namesATemplateRef
    ) {
      expressions.push({ ...valueRange, elementIndex })
    }
  }

  function readOpeningTag(tagStart: number): void {
    const nameStart = tagStart + 1
    position = nameStart
    while (position < end && isTagNameCode(text.charCodeAt(position))) {
      position += 1
    }
    const tagName = text.slice(nameStart, position)
    const elementIndex = elements.length
    elements.push({
      tagName,
      nameRange: { start: nameStart, end: position },
      closingNameRange: null,
      parentIndex: innermostOpenElementIndex(),
      localNames: [],
    })
    let isSelfClosing = false
    while (position < end) {
      skipWhitespace()
      const code = text.charCodeAt(position)
      if (code === 62) {
        position += 1
        break
      }
      if (code === 47 && text.charCodeAt(position + 1) === 62) {
        isSelfClosing = true
        position += 2
        break
      }
      const attributeStart = position
      while (position < end) {
        const nameCode = text.charCodeAt(position)
        if (
          isWhitespaceCode(nameCode) ||
          nameCode === 61 ||
          nameCode === 62 ||
          (nameCode === 47 && text.charCodeAt(position + 1) === 62)
        ) {
          break
        }
        position += 1
      }
      const attributeName = text.slice(attributeStart, position)
      if (attributeName === '') {
        position += 1
        continue
      }
      skipWhitespace()
      if (text.charCodeAt(position) !== 61) {
        continue
      }
      position += 1
      skipWhitespace()
      const quoteCode = text.charCodeAt(position)
      let valueRange: TextRange
      if (quoteCode === 34 || quoteCode === 39) {
        const closingQuoteIndex = text.indexOf(text[position] ?? '"', position + 1)
        const valueEnd = closingQuoteIndex === -1 || closingQuoteIndex > end ? end : closingQuoteIndex
        valueRange = { start: position + 1, end: valueEnd }
        position = valueEnd + 1
      } else {
        const valueStart = position
        while (position < end && !isWhitespaceCode(text.charCodeAt(position)) && text.charCodeAt(position) !== 62) {
          position += 1
        }
        valueRange = { start: valueStart, end: position }
      }
      readDirective(attributeName, valueRange, elementIndex)
    }
    if (!isSelfClosing && !VOID_ELEMENTS.has(tagName.toLowerCase())) {
      openElementIndexes.push(elementIndex)
    }
  }

  function readClosingTag(tagStart: number): void {
    const nameStart = tagStart + 2
    position = nameStart
    while (position < end && isTagNameCode(text.charCodeAt(position))) {
      position += 1
    }
    const tagName = text.slice(nameStart, position)
    for (let stackIndex = openElementIndexes.length - 1; stackIndex >= 0; stackIndex -= 1) {
      const element = elements[openElementIndexes[stackIndex] ?? -1]
      if (element !== undefined && element.tagName === tagName) {
        element.closingNameRange = { start: nameStart, end: position }
        openElementIndexes.length = stackIndex
        break
      }
    }
    const tagEnd = text.indexOf('>', position)
    position = tagEnd === -1 ? end : tagEnd + 1
  }

  while (position < end) {
    const tagStart = text.indexOf('<', position)
    const interpolationStart = text.indexOf('{{', position)
    const hasInterpolationFirst =
      interpolationStart !== -1 && interpolationStart < end && (tagStart === -1 || interpolationStart < tagStart)
    if (hasInterpolationFirst) {
      const interpolationEnd = text.indexOf('}}', interpolationStart + 2)
      if (interpolationEnd === -1 || interpolationEnd > end) {
        break
      }
      expressions.push({ start: interpolationStart + 2, end: interpolationEnd, elementIndex: innermostOpenElementIndex() })
      position = interpolationEnd + 2
      continue
    }
    if (tagStart === -1 || tagStart >= end) {
      break
    }
    if (text.startsWith('<!--', tagStart)) {
      const commentEnd = text.indexOf('-->', tagStart + 4)
      position = commentEnd === -1 ? end : commentEnd + 3
    } else if (text.charCodeAt(tagStart + 1) === 47) {
      readClosingTag(tagStart)
    } else if (isTagNameCode(text.charCodeAt(tagStart + 1))) {
      readOpeningTag(tagStart)
    } else {
      position = tagStart + 1
    }
  }

  return { elements, expressions }
}

// The local names visible from an element, the innermost element's first.
export function localNamesVisibleFrom(scan: TemplateScan, elementIndex: number | null): TemplateLocalName[] {
  const localNames: TemplateLocalName[] = []
  let currentIndex = elementIndex
  while (currentIndex !== null) {
    const element: TemplateElement | undefined = scan.elements[currentIndex]
    if (element === undefined) {
      break
    }
    localNames.push(...element.localNames)
    currentIndex = element.parentIndex
  }

  return localNames
}

// "order-table" and "orderTable" both name the component OrderTable.
export function componentNameOfTag(tagName: string): string {
  return tagName
    .split('-')
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

// A single lower-case word is an HTML element ("button", "form"): it names a component only when the script gives
// that very spelling to one.
export function isPlainElementTag(tagName: string): boolean {
  return !tagName.includes('-') && tagName === tagName.toLowerCase()
}

// Whether a tag of a template, in any of its spellings ("OrderTable", "order-table"), is the component of that name.
export function isTagOfComponent(tagName: string, componentName: string): boolean {
  return tagName === componentName || (!isPlainElementTag(tagName) && componentNameOfTag(tagName) === componentName)
}

// What every spelling of a component's tag shares: "order-table", "OrderTable" and "step-1-form", "Step1Form" read
// the same once the dashes are dropped and the case ignored.
export function caseAndDashFreeSpellingOf(name: string): string {
  return name.replaceAll('-', '').toLowerCase()
}

// The kebab-case spelling Vue gives a component's name: "OrderTable" is written "order-table".
export function kebabCaseTagOf(componentName: string): string {
  return componentName.replace(/\B([A-Z])/g, '-$1').toLowerCase()
}
