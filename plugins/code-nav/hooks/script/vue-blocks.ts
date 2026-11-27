export type TextRange = { start: number; end: number }

export type VueBlocks = {
  // The content of each script block: tokens read from these ranges carry the offsets of the whole file.
  scriptRanges: TextRange[]
  // The content of the template block, between its tags.
  templateRange: TextRange | null
  hasMarkup: boolean
}

const BLOCK_OPENING_TAG = '<(script|template|style)\\b([^>]*)>'

// The end of the content of a template block: its closing tag, past the template tags nested inside.
function templateContentEnd(text: string, contentStart: number): number {
  const tagPattern = /<(\/?)template\b[^>]*?(\/?)>/g
  tagPattern.lastIndex = contentStart
  let depth = 1
  let match: RegExpExecArray | null
  while ((match = tagPattern.exec(text)) !== null) {
    if (match[1] === '/') {
      depth -= 1
      if (depth === 0) {
        return match.index
      }
    } else if (match[2] !== '/') {
      depth += 1
    }
  }

  return text.length
}

export function readVueBlocks(text: string): VueBlocks {
  const scriptRanges: TextRange[] = []
  let templateRange: TextRange | null = null
  let hasMarkup = false
  const openingTagPattern = new RegExp(BLOCK_OPENING_TAG, 'g')
  let match: RegExpExecArray | null
  while ((match = openingTagPattern.exec(text)) !== null) {
    const blockName = match[1] ?? ''
    const attributes = match[2] ?? ''
    const contentStart = match.index + match[0].length
    if (attributes.trimEnd().endsWith('/')) {
      continue
    }
    let contentEnd: number
    if (blockName === 'template') {
      contentEnd = templateContentEnd(text, contentStart)
      templateRange = templateRange ?? { start: contentStart, end: contentEnd }
    } else {
      const closingTagIndex = text.indexOf(`</${blockName}`, contentStart)
      contentEnd = closingTagIndex === -1 ? text.length : closingTagIndex
      if (blockName === 'script') {
        scriptRanges.push({ start: contentStart, end: contentEnd })
        hasMarkup = hasMarkup || /lang\s*=\s*["'](tsx|jsx)["']/.test(attributes)
      }
    }
    openingTagPattern.lastIndex = contentEnd + 1
  }

  return { scriptRanges, templateRange, hasMarkup }
}
