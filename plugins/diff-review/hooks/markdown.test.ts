import { expect, test } from 'claude-code/testing'

import { imagesAsLinks, readingSectionsOf, splitMarkdownBlocks } from './markdown'

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

test('a description is read aloud a section at a time, from a heading or a bold line to the next, its lists with it', async () => {
  const blocks = splitMarkdownBlocks(
    ['Intro line.', '', '## Goal', '', 'On the orders page:', '', '- one', '- two', '', '**To decide**', '', '- three'].join('\n'),
  )

  expect(readingSectionsOf(blocks)).toEqual([
    { startBlockIndex: 0, text: 'Intro line.' },
    { startBlockIndex: 1, text: '## Goal\n\nOn the orders page:\n\n- one\n\n- two' },
    { startBlockIndex: 5, text: '**To decide**\n\n- three' },
  ])
})
