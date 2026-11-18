import { expect, test } from 'claude-code/testing'

import { descriptionBlocksOf, imagesAsLinks, readingSectionsOf, splitMarkdownBlocks } from './markdown'

test('a picture, pasted as an img tag or written in markdown, becomes a link to it with what it shows', async () => {
  const pasted = '<img width="903" height="343" alt="image" src="https://github.com/user-attachments/assets/b8d6" />'
  expect(imagesAsLinks(`See:\n${pasted}\nthen`)).toEqual({
    markdown: 'See:\n[\u{1F5BC} image 903×343 ↗](https://github.com/user-attachments/assets/b8d6)\nthen',
    imageUrls: ['https://github.com/user-attachments/assets/b8d6'],
  })
  expect(imagesAsLinks('![the [new] page](https://example.com/page.png "Title")').markdown).toBe(
    '[\u{1F5BC} the new page ↗](https://example.com/page.png)',
  )
  expect(imagesAsLinks('<img alt="no source">  and [a link](https://example.com)')).toEqual({
    markdown: '<img alt="no source">  and [a link](https://example.com)',
    imageUrls: [],
  })
})

const OVERVIEW = [
  '**@nicolas** · open · `develop` ← `feat/orders`',
  '',
  '## Description',
  '',
  'Intro line.',
  '',
  '### Goal',
  '',
  'On the orders page:',
  '',
  '- one',
  '- two',
  '',
  '**À trancher** :',
  '',
  '- three',
  '',
  '## Conversation (1)',
  '',
  '**@bot** · 2026-11-18 10:00',
  '',
  'Coverage is fine.',
  '',
  '---',
].join('\n')

test('a PR overview is read aloud a section at a time, from a heading or a bold line to the next, and a comment at a time', async () => {
  const blocks = splitMarkdownBlocks(OVERVIEW)

  expect(readingSectionsOf(blocks).map(section => section.text)).toEqual([
    '## Description\n\nIntro line.',
    '### Goal\n\nOn the orders page:\n\n- one\n\n- two',
    '**À trancher** :\n\n- three',
    '**@bot** · 2026-11-18 10:00\n\nCoverage is fine.\n\n---',
  ])
})

test('the whole overview read aloud is its description, without the state line or the conversation', async () => {
  expect(descriptionBlocksOf(splitMarkdownBlocks(OVERVIEW))).toEqual([
    'Intro line.',
    '### Goal',
    'On the orders page:',
    '- one',
    '- two',
    '**À trancher** :',
    '- three',
  ])
})
