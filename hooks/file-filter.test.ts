import { expect, test } from 'claude-code/testing'

import { isNoiseFile, matchesFileFilter, visibleFilesOf } from './file-filter'

test('lockfiles, minified, generated and vendored files are noise, source files are not', async () => {
  for (const noisePath of ['package-lock.json', 'app/composer.lock', 'web/yarn.lock', 'dist/app.js', 'assets/app.min.js', 'src/__snapshots__/a.snap']) {
    expect(isNoiseFile(noisePath)).toBe(true)
  }
  for (const sourcePath of ['src/Controller/UserController.php', 'webapp/src/locales/fr-FR.json', 'README.md']) {
    expect(isNoiseFile(sourcePath)).toBe(false)
  }
})

test('every word of the filter must appear in the path, whatever the case and order', async () => {
  expect(matchesFileFilter('src/Controller/UserController.php', 'user ctrl')).toBe(false)
  expect(matchesFileFilter('src/Controller/UserController.php', 'user controller')).toBe(true)
  expect(matchesFileFilter('src/Controller/UserController.php', '')).toBe(true)
})

test('the shown files leave the noise out unless asked, and count it', async () => {
  const file = (path: string) => ({ path, addedLines: 1, removedLines: 0, isUntracked: false })
  const files = [file('src/a.php'), file('composer.lock'), file('src/b.php')]
  expect(visibleFilesOf(files, { filter: '', isNoiseShown: false })).toEqual({ files: [files[0], files[2]], hiddenNoiseCount: 1 })
  expect(visibleFilesOf(files, { filter: 'b.php', isNoiseShown: true }).files).toEqual([files[2]])
})
