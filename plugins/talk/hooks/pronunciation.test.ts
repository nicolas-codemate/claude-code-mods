import { expect, test } from 'claude-code/testing'

import { identifierPartsOf, speakableWordOf } from './pronunciation'

test('an identifier is read as the words it is made of', async () => {
  expect(identifierPartsOf('findByUserId')).toEqual(['find', 'By', 'User', 'Id'])
  expect(identifierPartsOf('user_subscriptions')).toEqual(['user', 'subscriptions'])
  expect(identifierPartsOf('HTTPClient')).toEqual(['HTTP', 'Client'])
})

test('a local French voice is given the English words respelled, punctuation kept', async () => {
  expect(speakableWordOf('GitHub,', 'fr', true)).toBe('guite heube,')
  expect(speakableWordOf('findByUserId', 'fr', true)).toBe('faïnde baï youzeur aïdi')
  expect(speakableWordOf('PR.', 'fr', true)).toBe('pé ère.')
  expect(speakableWordOf('maison', 'fr', true)).toBe('maison')
})

test('a cloud voice, or another language, gets the words as written', async () => {
  expect(speakableWordOf('GitHub,', 'fr', false)).toBe('GitHub,')
  expect(speakableWordOf('findByUserId', 'fr', false)).toBe('find By User Id')
  expect(speakableWordOf('GitHub', 'en', true)).toBe('GitHub')
  expect(speakableWordOf('2026', 'fr', true)).toBe('2026')
})
