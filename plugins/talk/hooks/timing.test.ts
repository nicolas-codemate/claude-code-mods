import { expect, test } from 'claude-code/testing'

import { alignedWordStartsMs, estimatedWordStartsMs, wordStartsFromVoiceWords, speakableTextOf, wordAtElapsedMs } from './timing'

test('without timing from the voice, the audio is shared out by word length and pauses', async () => {
  const starts = estimatedWordStartsMs(['Hi,', 'there'], 1000)

  // "Hi," weighs 2 letters + a short pause of 4, "there" 5 letters + 1: 6 against 6.
  expect(starts).toEqual([0, 500])
})

test('with timing per character, each word starts at its first character', async () => {
  const { text, wordStartOffsets } = speakableTextOf(['ab', 'cd'])

  expect(text).toBe('ab cd')
  expect(wordStartOffsets).toEqual([0, 3])
  expect(alignedWordStartsMs(wordStartOffsets, [0, 0.1, 0.2, 0.3, 0.4])).toEqual([0, 300])
})

test('the word playing is the last one started', async () => {
  expect(wordAtElapsedMs([0, 300, 700], 0)).toBe(0)
  expect(wordAtElapsedMs([0, 300, 700], 450)).toBe(1)
  expect(wordAtElapsedMs([0, 300, 700], 5000)).toBe(2)
  expect(wordAtElapsedMs([100, 300], 50)).toBe(-1)
})

test('the words a local voice timed are matched to the words of the pane, a respelled word being several of them', async () => {
  expect(wordStartsFromVoiceWords(['Le', 'guite heube,', 'marche.'], [100, 300, 450, 700])).toEqual([100, 300, 700])
  // The voice split the text into more words than given: they are shared out in proportion.
  expect(wordStartsFromVoiceWords(['vingt', 'ans'], [0, 200, 400, 600])).toEqual([0, 400])
  expect(wordStartsFromVoiceWords(['seul'], [])).toBe(null)
})
