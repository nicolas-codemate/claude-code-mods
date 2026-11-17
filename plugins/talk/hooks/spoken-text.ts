import type { SpokenToken } from '../types'

const FENCED_BLOCK = /^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm
const UNCLOSED_FENCED_BLOCK = /^(```|~~~)[\s\S]*$/m
const TABLE_LINE = /^[ \t]*\|.*$/gm
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/g
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
const STRONG_EMPHASIS = /(\*\*|__)(.+?)\1/g
const EMPHASIS = /(^|[\s(])[*_](\S(?:.*?\S)?)[*_](?=[\s).,;:!?]|$)/gm
const SENTENCE_END = /[.!?…:]["»)\]]*$/

// What the voice reads of an answer written in Markdown: the prose alone, code blocks and tables left to the screen.
export const spokenTextOf = (markdown: string): string =>
  markdown
    .replace(FENCED_BLOCK, '')
    .replace(UNCLOSED_FENCED_BLOCK, '')
    .replace(TABLE_LINE, '')
    .replace(SOURCES_HEADING, '')
    .replace(LINKED_LIST_ITEM, '')
    .replace(HTML_TAG, '')
    .replace(HORIZONTAL_RULE, '')
    .replace(HEADING_MARK, '')
    .replace(BLOCKQUOTE_MARK, '')
    .replace(LIST_MARK, '')
    .replace(IMAGE, '$1')
    .replace(LINK, '$1')
    .replace(BARE_URL, '')
    .replace(INLINE_CODE, '$1')
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

export const wordsOf = (tokens: readonly SpokenToken[]): string[] =>
  tokens.filter(token => token.wordIndex !== null).map(token => token.text)

// Groups the words into the pieces sent one by one to the voice: the first sentence alone so the voice starts soon (unless
// isFirstSentenceAlone is false), then whole sentences of at least half maxCharacters each, synthesized while the
// previous piece plays.
export const chunksOf = (words: readonly string[], maxCharacters: number, isFirstSentenceAlone = true): string[][] => {
  const chunks: string[][] = []
  let current: string[] = []
  let currentLength = 0
  for (const word of words) {
    current.push(word)
    currentLength += word.length + 1
    const isSentenceEnd = SENTENCE_END.test(word)
    const limit = chunks.length === 0 && isFirstSentenceAlone ? 0 : maxCharacters / 2
    if ((isSentenceEnd && currentLength >= limit) || currentLength >= maxCharacters * 1.5) {
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
