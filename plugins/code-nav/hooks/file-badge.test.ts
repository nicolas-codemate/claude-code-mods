import { expect, test } from 'claude-code/testing'

import { BADGE_COLUMNS, fileBadgeOf } from './file-badge'

test('a file is tagged by what its extension or its name says it holds', async () => {
  expect(fileBadgeOf('src/Entity/Order.php').label).toBe('php')
  expect(fileBadgeOf('front/components/OrderTable.vue').label).toBe('vue')
  expect(fileBadgeOf('front/api/orders.TS').label).toBe('ts')
  expect(fileBadgeOf('config/services.yaml').label).toBe('yml')
  expect(fileBadgeOf('docker/Dockerfile').label).toBe('dkr')
  expect(fileBadgeOf('.env.local').label).toBe('env')
  expect(fileBadgeOf('README').label).toBe('·')
  expect(fileBadgeOf('.gitignore').label).toBe('·')
})

test('every tag fits the columns left for it, a space after it', async () => {
  const paths = ['a.php', 'a.ts', 'a.tsx', 'a.jsx', 'a.vue', 'a.json', 'a.yml', 'a.neon', 'a.xml', 'a.html', 'a.twig', 'a.scss', 'a.feature', 'a.graphql', 'a.lock', 'Makefile']
  expect(paths.every(path => fileBadgeOf(path).label.length < BADGE_COLUMNS)).toBe(true)
})
