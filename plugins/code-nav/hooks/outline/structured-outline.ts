import type { SymbolEntry } from '../../types'
import { MAXIMUM_OUTLINE_ENTRIES } from './outline-lines'

// The keys of the root object, and the keys of each object a root key holds. Comments are skipped, which also reads
// the JSON with comments that editors and compilers accept.
export function jsonSymbols(path: string, text: string): SymbolEntry[] {
  const symbols: SymbolEntry[] = []
  // One character per open bracket, "{" or "[", from the outermost.
  const openBrackets: string[] = []
  let line = 1
  let rootKey: string | null = null
  let lastString: { text: string; line: number } | null = null

  for (let index = 0; index < text.length && symbols.length < MAXIMUM_OUTLINE_ENTRIES; index++) {
    const character = text[index]
    if (character === '\n') {
      line++
      continue
    }
    if (character === ' ' || character === '\t' || character === '\r') {
      continue
    }
    if (character === '/' && text[index + 1] === '/') {
      const lineFeedIndex = text.indexOf('\n', index)
      index = (lineFeedIndex === -1 ? text.length : lineFeedIndex) - 1
      continue
    }
    if (character === '/' && text[index + 1] === '*') {
      const closeIndex = text.indexOf('*/', index + 2)
      const commentEnd = closeIndex === -1 ? text.length : closeIndex + 2
      for (let commentIndex = index; commentIndex < commentEnd; commentIndex++) {
        if (text[commentIndex] === '\n') {
          line++
        }
      }
      index = commentEnd - 1
      continue
    }
    if (character === '"') {
      const stringStart = index + 1
      let stringEnd = stringStart
      while (stringEnd < text.length && text[stringEnd] !== '"' && text[stringEnd] !== '\n') {
        stringEnd += text[stringEnd] === '\\' ? 2 : 1
      }
      const isKeyPosition = openBrackets.at(-1) === '{' && openBrackets.length <= 2
      lastString = isKeyPosition ? { text: text.slice(stringStart, stringEnd), line } : null
      index = stringEnd
      continue
    }
    if (character === ':' && lastString !== null) {
      if (openBrackets.length === 1) {
        rootKey = lastString.text
        symbols.push({ name: rootKey, kind: 'section', path, line: lastString.line, container: null })
      } else if (openBrackets[0] === '{' && rootKey !== null) {
        symbols.push({ name: lastString.text, kind: 'section', path, line: lastString.line, container: rootKey })
      }
    }
    lastString = null
    if (character === '{' || character === '[') {
      openBrackets.push(character)
    } else if (character === '}' || character === ']') {
      openBrackets.pop()
    }
  }

  return symbols
}

const MAXIMUM_SELECTOR_LENGTH = 120

function selectorName(selectorText: string): string {
  const collapsedSelector = selectorText.replace(/\s+/g, ' ').trim()

  return collapsedSelector.length > MAXIMUM_SELECTOR_LENGTH ? `${collapsedSelector.slice(0, MAXIMUM_SELECTOR_LENGTH)}...` : collapsedSelector
}

// The rules and at-rules of the stylesheet, and the rules nested one level in them (a rule of a @media, a nested rule
// of SCSS or LESS), held by the one around them. The steps of a @keyframes are not rules worth listing.
export function stylesheetSymbols(path: string, text: string, hasLineComments: boolean): SymbolEntry[] {
  const symbols: SymbolEntry[] = []
  const openBlocks: { name: string; isListed: boolean }[] = []
  let line = 1
  let parenthesisDepth = 0
  let selectorStart: number | null = null
  let selectorLine = 1

  for (let index = 0; index < text.length && symbols.length < MAXIMUM_OUTLINE_ENTRIES; index++) {
    const character = text[index]
    if (character === '\n') {
      line++
      continue
    }
    if (character === '/' && text[index + 1] === '*') {
      const closeIndex = text.indexOf('*/', index + 2)
      const commentEnd = closeIndex === -1 ? text.length : closeIndex + 2
      for (let commentIndex = index; commentIndex < commentEnd; commentIndex++) {
        if (text[commentIndex] === '\n') {
          line++
        }
      }
      index = commentEnd - 1
      continue
    }
    if (hasLineComments && parenthesisDepth === 0 && character === '/' && text[index + 1] === '/') {
      const lineFeedIndex = text.indexOf('\n', index)
      index = (lineFeedIndex === -1 ? text.length : lineFeedIndex) - 1
      continue
    }
    if (selectorStart === null && character !== ' ' && character !== '\t' && character !== '\r') {
      selectorStart = index
      selectorLine = line
    }
    if (character === '"' || character === "'") {
      let stringEnd = index + 1
      while (stringEnd < text.length && text[stringEnd] !== character && text[stringEnd] !== '\n') {
        stringEnd += text[stringEnd] === '\\' ? 2 : 1
      }
      index = stringEnd
      continue
    }
    if (character === '#' && text[index + 1] === '{') {
      const interpolationEnd = text.indexOf('}', index)
      index = interpolationEnd === -1 ? text.length : interpolationEnd
      continue
    }
    if (character === '(') {
      parenthesisDepth++
    } else if (character === ')') {
      parenthesisDepth = Math.max(0, parenthesisDepth - 1)
    } else if (character === ';') {
      selectorStart = null
    } else if (character === '{') {
      const name = selectorName(text.slice(selectorStart ?? index, index))
      const parentBlock = openBlocks.at(-1)
      const isInsideKeyframes = parentBlock !== undefined && /^@(?:-\w+-)?keyframes\b/.test(parentBlock.name)
      const isListed = openBlocks.length === 0 || (openBlocks.length === 1 && parentBlock?.isListed === true && !isInsideKeyframes)
      if (isListed && name !== '') {
        symbols.push({ name, kind: 'section', path, line: selectorLine, container: parentBlock?.name ?? null })
      }
      openBlocks.push({ name, isListed })
      selectorStart = null
      parenthesisDepth = 0
    } else if (character === '}') {
      openBlocks.pop()
      selectorStart = null
      parenthesisDepth = 0
    }
  }

  return symbols
}
