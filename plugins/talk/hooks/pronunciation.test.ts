import { expect, test } from 'claude-code/testing'

import { identifierPartsOf, isSpelledAcronym, speakableWordOf } from './pronunciation'

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

test('a path is said as this file or this folder in the voice\'s language', async () => {
  const spoken = (word: string, language: 'fr' | 'en' | 'es' | 'de' | 'it' = 'fr') => speakableWordOf(word, language, false)

  expect(spoken('/tmp/claude-1000/-home-nicolas/scratchpad/cards-YT-7703.json')).toBe('ce fichier')
  expect(spoken('src/hooks/spoken-text.test.ts,')).toBe('ce fichier,')
  expect(spoken('(register.tsx:118).')).toBe('(ce fichier).')
  expect(spoken('«src/données/x.ts»')).toBe('«ce fichier»')
  expect(spoken('.github/workflows/ci.yml')).toBe('ce fichier')
  expect(spoken('plugins/talk/')).toBe('ce dossier')
  expect(spoken('~/.claude', 'en')).toBe('this folder')
  expect(spoken('./scripts/build.sh', 'en')).toBe('this file')
  expect(spoken('C:\\Users\\nico\\file.txt', 'es')).toBe('este archivo')
  expect(spoken('/usr/bin/', 'de')).toBe('dieser Ordner')
  expect(spoken('/etc/nginx/nginx.conf', 'it')).toBe('questo file')
})

test('words joined by slashes, a command, a date, a time, an e-mail and a package name are read', async () => {
  const spoken = (word: string) => speakableWordOf(word, 'fr', false)

  for (const word of ['/talk', 'et/ou', 'et/ou/non', 'input/output/error', 'feature/x', 'Node.js', '12/05/2026,', '1/2', '10:30', '3:2', 'nico@codemate.consulting', '@scope/package', 'user:password']) {
    expect(spoken(word)).toBe(word)
  }
})

test('a very long word with slashes is told apart from a path at once', async () => {
  const startedAt = Date.now()
  speakableWordOf(`${'a.'.repeat(20_000)}/b`, 'fr', false)
  expect(Date.now() - startedAt).toBeLessThan(500)
})

test('a ticket\'s reference is read as its letters, then its digits two by two', async () => {
  expect(speakableWordOf('YT-7703.', 'fr', false)).toBe('i grec té 77 03.')
  expect(speakableWordOf('YT-7703', 'en', false)).toBe('Y T 77 03')
  expect(speakableWordOf('(JIRA-12345)', 'en', false)).toBe('(JIRA 12 34 5)')
  expect(speakableWordOf('COVID-19', 'fr', false)).toBe('COVID 19')
  expect(speakableWordOf('UTF-8', 'fr', false)).toBe('UTF-8')
})

test('a word in capitals is spelled when people spell it, read when they read it', async () => {
  expect(['API', 'URL', 'YT', 'HTML', 'SQL', 'HTTP'].filter(isSpelledAcronym)).toEqual(['API', 'URL', 'YT', 'HTML', 'SQL', 'HTTP'])
  expect(['COVID', 'NASA', 'JSON', 'SEPA', 'Api', 'A'].filter(isSpelledAcronym)).toEqual([])
  // A cloud voice keeps the word itself, for the account's pronunciation dictionary to find; a local French voice is
  // given the letters' names.
  expect(speakableWordOf('CI', 'fr', false)).toBe('CI')
  expect(speakableWordOf('HTML', 'fr', true)).toBe('ache té ème èle')
  expect(speakableWordOf('COVID', 'fr', true)).toBe('COVID')
})
