import { expect, test } from 'claude-code/testing'

import { createMemoryWorkspace } from './test-workspace'
import { resolveTextDefinition } from './text-analysis'

const BILLING = 'shop/billing.py'
const CHECKOUT = 'shop/checkout.py'
const PYTHON_FILES: Record<string, string> = {
  [BILLING]: ['def compute_total(order):', '    return sum(line.price for line in order.lines)', ''].join('\n'),
  [CHECKOUT]: ['from shop.billing import compute_total', '', 'def checkout(order):', '    return compute_total(order)', ''].join('\n'),
}

test('a name clicked where its own file declares it is on its declaration, a use of it elsewhere is not', async () => {
  const workspace = createMemoryWorkspace(PYTHON_FILES)

  const onDeclaration = await resolveTextDefinition(workspace, { path: BILLING, line: 1, column: 6 })
  expect(onDeclaration.symbol?.name).toBe('compute_total')
  expect(onDeclaration.isOnDeclaration).toBe(true)
  expect(onDeclaration.note).toBeNull()

  const onCall = await resolveTextDefinition(workspace, { path: CHECKOUT, line: 4, column: 13 })
  expect(onCall.symbol?.name).toBe('compute_total')
  expect(onCall.isOnDeclaration).toBe(false)
})
