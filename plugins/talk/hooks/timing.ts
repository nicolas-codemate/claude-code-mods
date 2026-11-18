// Character weights of the pauses a voice makes after punctuation, against one per letter spoken.
const SHORT_PAUSE_WEIGHT = 4
const LONG_PAUSE_WEIGHT = 8

export type SpeakableText = { text: string; wordStartOffsets: number[] }

export const speakableTextOf = (speakableWords: readonly string[]): SpeakableText => {
  const wordStartOffsets: number[] = []
  let text = ''
  for (const word of speakableWords) {
    if (text !== '') text += ' '
    wordStartOffsets.push(text.length)
    text += word
  }
  return { text, wordStartOffsets }
}

const spokenWeightOf = (speakableWord: string): number => {
  const letters = speakableWord.replace(/[^\p{L}\p{N}]/gu, '').length
  const pause = /[.!?…:]["»)\]]*$/.test(speakableWord) ? LONG_PAUSE_WEIGHT : /[,;]["»)\]]*$/.test(speakableWord) ? SHORT_PAUSE_WEIGHT : 1
  return letters + pause
}

// Where each word starts when the voice gives no timing of its own: the audio shared out by the length of each word.
export const estimatedWordStartsMs = (speakableWords: readonly string[], durationMs: number): number[] => {
  const weights = speakableWords.map(spokenWeightOf)
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  if (totalWeight === 0) return speakableWords.map(() => 0)
  const starts: number[] = []
  let elapsedWeight = 0
  for (const weight of weights) {
    starts.push((elapsedWeight / totalWeight) * durationMs)
    elapsedWeight += weight
  }
  return starts
}

// Where each word starts from a voice's timing per character of the text it was given.
export const alignedWordStartsMs = (wordStartOffsets: readonly number[], characterStartTimesSeconds: readonly number[]): number[] =>
  wordStartOffsets.map(offset => {
    const seconds = characterStartTimesSeconds[Math.min(offset, characterStartTimesSeconds.length - 1)] ?? 0
    return seconds * 1000
  })

const spokenPartsOf = (speakableWord: string): number => Math.max(1, speakableWord.split(/\s+/).filter(part => /[\p{L}\p{N}]/u.test(part)).length)

// Where each word starts from the start of each word the voice itself heard: a respelled word can be several of those
// (GitHub read as "guite heube"). When the voice split the text otherwise, its words are shared out in proportion.
export const wordStartsFromVoiceWords = (speakableWords: readonly string[], voiceWordStartsMs: readonly number[]): number[] | null => {
  if (voiceWordStartsMs.length === 0) return null
  const partCounts = speakableWords.map(spokenPartsOf)
  const totalParts = partCounts.reduce((sum, count) => sum + count, 0)
  const scale = voiceWordStartsMs.length / totalParts
  const starts: number[] = []
  let partIndex = 0
  for (const count of partCounts) {
    const voiceIndex = Math.min(voiceWordStartsMs.length - 1, Math.floor(partIndex * scale))
    starts.push(voiceWordStartsMs[voiceIndex] ?? 0)
    partIndex += count
  }
  return starts
}

// The word playing at elapsedMs: the last one started.
export const wordAtElapsedMs = (wordStartsMs: readonly number[], elapsedMs: number): number => {
  let current = -1
  for (const [index, startMs] of wordStartsMs.entries()) {
    if (startMs > elapsedMs) break
    current = index
  }
  return current
}
