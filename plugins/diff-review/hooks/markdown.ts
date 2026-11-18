// GitHub names each emoji image after its code points (`unicode/1f68b.png`, `unicode/1f1eb-1f1f7.png`): that file
// name gives the character. Emoji GitHub draws as an image of its own (`:octocat:`) have none and keep their code.
export function parseEmojiCharacters(emojisOutput: string): Record<string, string> {
  const emojiCharacterByShortcode: Record<string, string> = {}
  let emojis: unknown
  try {
    emojis = JSON.parse(emojisOutput)
  } catch {
    return emojiCharacterByShortcode
  }
  for (const [shortcode, imageUrl] of Object.entries(typeof emojis === 'object' && emojis !== null ? emojis : {})) {
    const codePoints = typeof imageUrl === 'string' ? imageUrl.match(/\/unicode\/([0-9a-f-]+)\.png/)?.[1] : undefined
    if (codePoints) {
      emojiCharacterByShortcode[shortcode] = String.fromCodePoint(...codePoints.split('-').map(codePoint => parseInt(codePoint, 16)))
    }
  }

  return emojiCharacterByShortcode
}

export function replaceEmojiShortcodes(text: string, emojiCharacterByShortcode: Record<string, string>): string {
  return text.replace(/:([a-z0-9_+-]+):/g, (shortcode, name: string) => emojiCharacterByShortcode[name] ?? shortcode)
}

const IMAGE_MARK = '\u{1F5BC}'
// The alt may hold brackets of its own, one level deep.
const MARKDOWN_IMAGE = /!\[((?:[^[\]]|\[[^[\]]*\])*)\]\(\s*<?([^\s)>]+)>?(?:\s+["'][^"']*["'])?\s*\)/g

// GitHub keeps a pasted screenshot as an <img> tag and a written one as ![alt](url); the terminal draws neither, so
// each becomes a link to the picture.
export function imagesAsLinks(markdown: string): { markdown: string; imageUrls: string[] } {
  const imageUrls: string[] = []
  const linkTo = (url: string, description: string) => {
    imageUrls.push(url)
    return `[${IMAGE_MARK} ${description.replace(/[[\]]/g, '')} ↗](${url})`
  }
  const withHtmlImages = markdown.replace(/<img\b[^>]*>/gi, tag => {
    const url = htmlAttributeOf(tag, 'src')
    if (url === null) {
      return tag
    }
    const width = htmlAttributeOf(tag, 'width')
    const height = htmlAttributeOf(tag, 'height')
    return linkTo(url, `${imageDescriptionOf(htmlAttributeOf(tag, 'alt'))}${width && height ? ` ${width}×${height}` : ''}`)
  })

  return {
    markdown: withHtmlImages.replace(MARKDOWN_IMAGE, (_image, alt: string, url: string) => linkTo(url, imageDescriptionOf(alt))),
    imageUrls,
  }
}

function htmlAttributeOf(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  return match ? (match[1] ?? match[2] ?? match[3] ?? null) : null
}

// GitHub names every pasted picture "image": only an alt someone wrote says more.
function imageDescriptionOf(alt: string | null): string {
  const trimmedAlt = alt?.trim() ?? ''
  return trimmedAlt === '' || trimmedAlt.toLowerCase() === 'image' ? 'image' : trimmedAlt
}

const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s/

export function isListItemBlock(block: string): boolean {
  return LIST_ITEM.test(block)
}

// A nested item drawn alone would read as a top-level one: its indentation is kept apart, to be drawn as a margin.
export function splitListItemIndentation(block: string): { indentation: number; text: string } {
  const indentation = block.match(LIST_ITEM)?.[1]?.length ?? 0

  return { indentation, text: block.split('\n').map(line => line.slice(Math.min(indentation, line.search(/\S|$/)))).join('\n') }
}

// A paragraph, a list item, a fenced code block or a heading each make one block, so a question can point at any of them.
export function splitMarkdownBlocks(markdown: string): string[] {
  const blocks: string[] = []
  let currentLines: string[] = []
  let isInsideFence = false
  const closeBlock = () => {
    if (currentLines.some(line => line.trim() !== '')) {
      blocks.push(currentLines.join('\n'))
    }
    currentLines = []
  }
  for (const line of markdown.split('\n')) {
    if (line.trimStart().startsWith('```')) {
      isInsideFence = !isInsideFence
      currentLines.push(line)
      if (!isInsideFence) {
        closeBlock()
      }
      continue
    }
    if (isInsideFence) {
      currentLines.push(line)
    } else if (line.trim() === '') {
      closeBlock()
    } else if (/^#{1,6} /.test(line)) {
      closeBlock()
      blocks.push(line)
    } else if (LIST_ITEM.test(line)) {
      closeBlock()
      currentLines.push(line)
    } else {
      currentLines.push(line)
    }
  }
  closeBlock()

  return blocks
}

// The lines the PR overview is built with around the description: `**@author** · open · …` above it, `## Description`,
// then `## Conversation (N)` and a `**@author** · date` line above each comment.
const OVERVIEW_DESCRIPTION_HEADING = '## Description'
const OVERVIEW_CONVERSATION_HEADING = /^## Conversation \(\d+\)$/
const OVERVIEW_AUTHOR_LINE = /^\*\*@[^*\n]+\*\* · /

// A heading, a first line all in bold that stands for one (`**À trancher** :`), or a comment's author line starts a
// section.
function isSectionStart(block: string): boolean {
  const firstLine = block.split('\n')[0]?.trim() ?? ''
  return /^#{1,6} /.test(firstLine) || /^\*\*[^*\n]+\*\*\s*:?$/.test(firstLine) || OVERVIEW_AUTHOR_LINE.test(firstLine)
}

// The parts of a PR overview read aloud one at a time: from a heading to the next, so that a list is heard with the
// paragraph that leads to it rather than item by item, and each comment of the conversation alone. The line of the PR's
// state and the conversation's own heading say nothing worth hearing.
export function readingSectionsOf(blocks: readonly string[]): { startBlockIndex: number; text: string }[] {
  const sections: { startBlockIndex: number; text: string }[] = []
  blocks.forEach((block, blockIndex) => {
    const current = sections[sections.length - 1]
    if (current === undefined || isSectionStart(block)) {
      sections.push({ startBlockIndex: blockIndex, text: block })
    } else {
      current.text = `${current.text}\n\n${block}`
    }
  })

  return sections.filter(section => section.startBlockIndex > 0 && !OVERVIEW_CONVERSATION_HEADING.test(section.text.split('\n')[0] ?? ''))
}

// The PR's description alone, without the line of its state or the conversation: what `▶ read aloud` reads after the
// title.
export function descriptionBlocksOf(blocks: readonly string[]): readonly string[] {
  const start = blocks.indexOf(OVERVIEW_DESCRIPTION_HEADING)
  if (start === -1) return []
  const end = blocks.findIndex((block, blockIndex) => blockIndex > start && OVERVIEW_CONVERSATION_HEADING.test(block))
  return blocks.slice(start + 1, end === -1 ? blocks.length : end)
}
