import { expect, test } from 'claude-code/testing'

import { chunksOf, paragraphEndsOf, sentenceStartOf, spokenTextOf, tokensOf, wordsOf } from './spoken-text'

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

  expect(chunksOf(words, { maxCharacters: 30, isFirstSentenceAlone: true, isCutAtParagraphs: false })).toEqual([['One.'], ['Two', 'words', 'here.'], ['Three', 'words', 'there.'], ['Four.']])
  expect(chunksOf(words, { maxCharacters: 80, isFirstSentenceAlone: true, isCutAtParagraphs: false })).toEqual([['One.'], ['Two', 'words', 'here.', 'Three', 'words', 'there.', 'Four.']])
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

  expect(chunksOf(words, { maxCharacters: 2_400, isFirstSentenceAlone: false, isCutAtParagraphs: false })).toEqual([words])
})

test('the guidance a pull request template leaves in HTML comments is not read', async () => {
  expect(spokenTextOf('<!-- Describe the change -->\nAdds the tax.\n<!--\nChecklist\n-->')).toBe('Adds the tax.')
})

test('a voice told the text around a piece gets a paragraph at a time, a long one cut at the end of a sentence', async () => {
  const tokens = tokensOf('First idea here. Still the first.\n\nSecond paragraph, short.\n\nA third one that runs long. It goes on and on.')
  const pieces = chunksOf(wordsOf(tokens), { maxCharacters: 20, isFirstSentenceAlone: false, isCutAtParagraphs: true }, paragraphEndsOf(tokens))

  expect(pieces.map(piece => piece.join(' '))).toEqual([
    'First idea here. Still the first.',
    'Second paragraph, short.',
    'A third one that runs long.',
    'It goes on and on.',
  ])
})

test('JSON shown outside a code block is not read, a line or an inline span of it', async () => {
  const answer = ['Here is the payload:', '{', '  "id": 3,', '  "tags": ["a", "b"]', '}', 'and the short one `{"ok": true}` too.'].join('\n')

  expect(spokenTextOf(answer)).toBe('Here is the payload:\n\nand the short one  too.')
  expect(spokenTextOf('Use `findAll` here.')).toBe('Use findAll here.')
})
