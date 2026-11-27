import { expect, test } from 'claude-code/testing'

import { extensionOfPath, fileNameOfPath, languageOfPath } from './language'

test('the language of a file comes from its extension or its name', async () => {
  const paths = [
    'src/Order.php', 'src/order.ts', 'src/OrderCard.tsx', 'webpack.config.cjs', 'src/OrderPage.vue',
    'templates/order.html.twig', 'phpunit.xml.dist', 'composer.json', 'composer.lock', 'config/services.yaml',
    '.env.local', 'bin/deploy.sh', 'docker/Dockerfile', 'docker/Dockerfile.dev', 'Makefile', 'src/Order.java',
    'assets/shop.scss', 'README.md', 'LICENSE', 'yarn.lock',
  ]

  expect(paths.map(languageOfPath)).toEqual([
    'php', 'script', 'script', 'script', 'vue', 'markup', 'markup', 'data', 'data', 'data', 'data', 'shell', 'shell',
    'shell', 'shell', 'clike', 'clike', 'plain', 'plain', 'plain',
  ])
})

test('a file named like a property of every object is a plain file', async () => {
  expect(['src/constructor', 'src/order.constructor', 'toString'].map(languageOfPath)).toEqual(['plain', 'plain', 'plain'])
})

test('the extension ignores the case, the folders and the suffix of a copy kept aside', async () => {
  expect(['src/Order.PHP', 'phpunit.xml.dist', 'config.v2/README', '.gitignore', 'a.b/c.d.yaml.example'].map(extensionOfPath)).toEqual([
    'php', 'xml', '', '', 'yaml',
  ])
  expect(fileNameOfPath('docker/php/Dockerfile')).toBe('dockerfile')
})
