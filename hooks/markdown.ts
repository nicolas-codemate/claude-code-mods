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

// A paragraph, a list, a fenced code block or a heading each make one block, so a question can point at any of them.
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
    } else {
      currentLines.push(line)
    }
  }
  closeBlock()

  return blocks
}
