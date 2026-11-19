import type { SpokenToken } from '../types'
import type { Chunking } from './providers/synthesis'

const FENCED_BLOCK = /^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm
const UNCLOSED_FENCED_BLOCK = /^(```|~~~)[\s\S]*$/m
const TABLE_LINE = /^[ \t]*\|.*$/gm
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/g
// Pull request templates leave their guidance in comments.
const HTML_COMMENT = /<!--[\s\S]*?-->/g
const HEADING_MARK = /^[ \t]{0,3}#{1,6}[ \t]+/gm
const BLOCKQUOTE_MARK = /^[ \t]*>[ \t]?/gm
const LIST_MARK = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm
const HORIZONTAL_RULE = /^[ \t]*(?:[-*_][ \t]*){3,}$/gm
// A list of sources or links is for the eye: its heading and every list line holding a link are left out.
const SOURCES_HEADING = /^[ \t]*(?:#{1,6}[ \t]+)?(?:\*\*)?(?:sources?|références?|references?|liens?|links?)(?:\*\*)?[ \t]*:?[ \t]*$/gim
const LINKED_LIST_ITEM = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+.*(?:\]\([^)]*\)|https?:\/\/).*$/gm
const IMAGE = /!\[([^\]]*)\]\([^)]*\)/g
const LINK = /\[([^\]]+)\]\([^)]*\)/g
const BARE_URL = /\bhttps?:\/\/\S+/g
const INLINE_CODE = /`([^`]+)`/g
// JSON shown outside a code block, a line of it at a time: a brace or bracket alone, or a quoted key and its value.
const JSON_LINE = /^[ \t]*(?:[{}[\]][ \t,{}[\]]*|"[^"\n]*"[ \t]*:.*|[{[].*[}\]],?)[ \t]*$/gm
const looksLikeJson = (code: string): boolean => /^[\s]*[{[]/.test(code) && /[:,"]/.test(code)
const STRONG_EMPHASIS = /(\*\*|__)(.+?)\1/g
const EMPHASIS = /(^|[\s(])[*_](\S(?:.*?\S)?)[*_](?=[\s).,;:!?]|$)/gm
const SENTENCE_END = /[.!?…:]["»)\]]*$/

// What the voice reads of an answer written in Markdown: the prose alone, code blocks and tables left to the screen.
export const spokenTextOf = (markdown: string): string =>
  markdown
    .replace(FENCED_BLOCK, '')
    .replace(UNCLOSED_FENCED_BLOCK, '')
    .replace(TABLE_LINE, '')
    .replace(JSON_LINE, '')
    .replace(SOURCES_HEADING, '')
    .replace(LINKED_LIST_ITEM, '')
    .replace(HTML_COMMENT, '')
    .replace(HTML_TAG, '')
    .replace(HORIZONTAL_RULE, '')
    .replace(HEADING_MARK, '')
    .replace(BLOCKQUOTE_MARK, '')
    .replace(LIST_MARK, '')
    .replace(IMAGE, '$1')
    .replace(LINK, '$1')
    .replace(BARE_URL, '')
    .replace(INLINE_CODE, (_code, content: string) => (looksLikeJson(content) ? '' : content))
    .replace(STRONG_EMPHASIS, '$2')
    .replace(EMPHASIS, '$1$2')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

export const tokensOf = (text: string): SpokenToken[] => {
  const tokens: SpokenToken[] = []
  let wordCount = 0
  for (const match of text.matchAll(/\S+|\s+/g)) {
    const isWord = !/^\s/.test(match[0])
    tokens.push({ text: match[0], wordIndex: isWord ? wordCount++ : null })
  }
  return tokens
}

export const textOfTokens = (tokens: readonly SpokenToken[]): string => tokens.map(token => token.text).join('')

export const wordsOf = (tokens: readonly SpokenToken[]): string[] =>
  tokens.filter(token => token.wordIndex !== null).map(token => token.text)

// The words that end a paragraph, by their index: those a blank line follows, and the last one.
export const paragraphEndsOf = (tokens: readonly SpokenToken[]): Set<number> => {
  const ends = new Set<number>()
  let lastWordIndex: number | null = null
  for (const token of tokens) {
    if (token.wordIndex !== null) lastWordIndex = token.wordIndex
    else if (lastWordIndex !== null && token.text.includes('\n\n')) ends.add(lastWordIndex)
  }
  if (lastWordIndex !== null) ends.add(lastWordIndex)
  return ends
}

// Groups the words into the pieces sent one by one to the voice, as Chunking says: a piece ends on a paragraph's end,
// or else on a sentence's end once it holds half maxCharacters (the first sentence alone when asked); a piece past
// maxCharacters ends on its next sentence, and one with no sentence end past one and a half times it.
export const chunksOf = (
  words: readonly string[],
  chunking: Chunking,
  paragraphEnds: ReadonlySet<number> = new Set(),
): string[][] => {
  const { maxCharacters, isFirstSentenceAlone, isCutAtParagraphs } = chunking
  const chunks: string[][] = []
  let current: string[] = []
  let currentLength = 0
  for (const [wordIndex, word] of words.entries()) {
    current.push(word)
    currentLength += word.length + 1
    const isSentenceEnd = SENTENCE_END.test(word)
    const isFirstPiece = chunks.length === 0
    const isPieceEnd = isCutAtParagraphs
      ? paragraphEnds.has(wordIndex) || (isFirstPiece && isFirstSentenceAlone && isSentenceEnd) || (isSentenceEnd && currentLength >= maxCharacters)
      : isSentenceEnd && currentLength >= (isFirstPiece && isFirstSentenceAlone ? 0 : maxCharacters / 2)
    if (isPieceEnd || currentLength >= maxCharacters * 1.5) {
      chunks.push(current)
      current = []
      currentLength = 0
    }
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

// The first word of the sentence holding the word at wordIndex.
export const sentenceStartOf = (words: readonly string[], wordIndex: number): number => {
  for (let index = Math.min(wordIndex, words.length) - 1; index >= 0; index--) {
    if (SENTENCE_END.test(words[index] ?? '')) return index + 1
  }
  return 0
}
