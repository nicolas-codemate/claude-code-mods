import { expect, test } from 'claude-code/testing'

import { createMemoryWorkspace } from '../test-workspace'
import type { Workspace } from '../workspace'
import { answeredOnce, createAnalysisSession, modelOf, readDependencyText, readText, windowModelOfExport } from './session'

function countingWorkspace(files: Record<string, string>): { workspace: Workspace; readPaths: string[] } {
  const memoryWorkspace = createMemoryWorkspace(files)
  const readPaths: string[] = []

  return {
    readPaths,
    workspace: {
      ...memoryWorkspace,
      readFile: async path => {
        readPaths.push(path)
        return memoryWorkspace.readFile(path)
      },
    },
  }
}

test('a file asked for several times in one answer is read once', async () => {
  const { workspace, readPaths } = countingWorkspace({ 'src/orders.ts': 'export const orders = []' })
  const session = createAnalysisSession(workspace)
  await Promise.all([
    modelOf(session, 'src/orders.ts'),
    modelOf(session, 'src/orders.ts'),
    readText(session, 'src/orders.ts'),
  ])
  expect(readPaths).toEqual(['src/orders.ts'])
})

test('a file that is no script, or that does not exist, has no model', async () => {
  const session = createAnalysisSession(createMemoryWorkspace({ 'src/theme.css': '.a {}' }))
  expect(await modelOf(session, 'src/theme.css')).toBe(null)
  expect(await modelOf(session, 'src/missing.ts')).toBe(null)
})

test('a model is built again when the text of its file changed', async () => {
  const firstSession = createAnalysisSession(createMemoryWorkspace({ 'src/orders.ts': 'export const orders = []' }))
  const secondSession = createAnalysisSession(createMemoryWorkspace({ 'src/orders.ts': 'export const invoices = []' }))
  const firstModel = await modelOf(firstSession, 'src/orders.ts')
  const secondModel = await modelOf(secondSession, 'src/orders.ts')
  expect(firstModel?.structure.fileScope.declarations[0]?.name).toBe('orders')
  expect(secondModel?.structure.fileScope.declarations[0]?.name).toBe('invoices')
})

test('only so many files of dependencies are tried in one answer', async () => {
  const { workspace, readPaths } = countingWorkspace({})
  const session = createAnalysisSession(workspace)
  session.remainingDependencyReads = 2
  for (const name of ['a', 'b', 'c', 'a']) {
    await readDependencyText(session, `node_modules/${name}/package.json`)
  }
  expect(readPaths).toEqual(['node_modules/a/package.json', 'node_modules/b/package.json'])
})

test('a file too large to analyse has no model, yet the declaration of one of its exports is read', async () => {
  const generatedText = [
    '// generated',
    'export enum OrderStatus {',
    "  Draft = 'DRAFT',",
    "  Paid = 'PAID',",
    '}',
    `${'// filler line of a generated schema\n'.repeat(20_000)}`,
  ].join('\n')
  const session = createAnalysisSession(createMemoryWorkspace({ 'src/generated/graphql.ts': generatedText }))
  expect(await modelOf(session, 'src/generated/graphql.ts')).toBe(null)
  const windowModel = await windowModelOfExport(session, 'src/generated/graphql.ts', 'OrderStatus')
  expect(
    windowModel?.structure.fileScope.declarations.map(declaration => `${declaration.kind} ${declaration.name}`),
  ).toEqual(['enum OrderStatus'])
  expect(windowModel?.structure.fileScope.children[0]?.declarations.map(member => member.name)).toEqual(['Draft', 'Paid'])
  expect(await windowModelOfExport(session, 'src/generated/graphql.ts', 'Missing')).toBe(null)
})

test('an answer is worked out once per key', async () => {
  const session = createAnalysisSession(createMemoryWorkspace({}))
  let workCount = 0
  const work = async () => {
    workCount += 1
    return 'answer'
  }
  expect(await answeredOnce(session, 'key', work)).toBe('answer')
  expect(await answeredOnce(session, 'key', work)).toBe('answer')
  expect(workCount).toBe(1)
})
