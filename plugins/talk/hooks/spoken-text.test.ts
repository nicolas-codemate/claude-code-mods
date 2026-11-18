import { expect, test } from 'claude-code/testing'

import { chunksOf, sentenceStartOf, spokenTextOf, tokensOf, wordsOf } from './spoken-text'

test('the voice reads the prose of an answer and leaves code, tables and Markdown marks to the screen', async () => {
  const answer = [
    '## Two options',
    '',
    'We can **cache** the `findByUserId` result, see [the docs](https://example.com/cache).',
    '',
    '```php',
    '$cache->get($id);',
    '```',
    '',
    '| Option | Cost |',
    '| --- | --- |',
    '| A | low |',
    '',
    '- First, measure.',
    '- Then *decide*.',
  ].join('\n')

  expect(spokenTextOf(answer)).toBe('Two options\n\nWe can cache the findByUserId result, see the docs.\n\nFirst, measure.\nThen decide.')
})

test('an answer cut inside a code block reads up to the block', async () => {
  expect(spokenTextOf('Here it is:\n\n```ts\nconst unfinished =')).toBe('Here it is:')
})

test('the tokens number the words and keep the spaces between them', async () => {
  const tokens = tokensOf('Hello  world,\nagain')

  expect(tokens).toEqual([
    { text: 'Hello', wordIndex: 0 },
    { text: '  ', wordIndex: null },
    { text: 'world,', wordIndex: 1 },
    { text: '\n', wordIndex: null },
    { text: 'again', wordIndex: 2 },
  ])
  expect(wordsOf(tokens)).toEqual(['Hello', 'world,', 'again'])
})

test('the first sentence goes to the voice alone, the next ones together', async () => {
  const words = 'One. Two words here. Three words there. Four.'.split(' ')

  expect(chunksOf(words, 30)).toEqual([['One.'], ['Two', 'words', 'here.'], ['Three', 'words', 'there.'], ['Four.']])
  expect(chunksOf(words, 80)).toEqual([['One.'], ['Two', 'words', 'here.', 'Three', 'words', 'there.', 'Four.']])
})

test('a reading taken up again starts from the sentence it was in', async () => {
  const words = 'One. Two words here. Three.'.split(' ')

  expect(sentenceStartOf(words, 2)).toBe(1)
  expect(sentenceStartOf(words, 1)).toBe(1)
  expect(sentenceStartOf(words, 0)).toBe(0)
  expect(sentenceStartOf(words, 4)).toBe(4)
})

test('sources and links listed after an answer are shown, not read', async () => {
  const answer = [
    'OpenAI costs about a cent and a half a minute.',
    '',
    'Sources :',
    '- [OpenAI, the speech model](https://developers.openai.com/api/docs/models/gpt-4o-mini-tts)',
    '- Pricing in 2026: https://example.com/pricing',
  ].join('\n')

  expect(spokenTextOf(answer)).toBe('OpenAI costs about a cent and a half a minute.')
  expect(spokenTextOf('- Measure first.\n- Then [decide](https://example.com) together.')).toBe('Measure first.')
})

test('a voice that reads the answer whole gets it in one piece, its first sentence not apart', async () => {
  const words = 'One. Two words here. Three words there. Four.'.split(' ')

  expect(chunksOf(words, 2_400, false)).toEqual([words])
})
