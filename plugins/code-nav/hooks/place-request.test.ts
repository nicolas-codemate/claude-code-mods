import { expect, test } from 'claude-code/testing'

import { pathFromRoot, writtenPlaceOf, writtenSymbolOf } from './place-request'

test('a place is read with its line however the line is written', async () => {
  expect(writtenPlaceOf('src/Order.php')).toEqual({ path: 'src/Order.php', line: null })
  expect(writtenPlaceOf('src/Order.php:42')).toEqual({ path: 'src/Order.php', line: 42 })
  expect(writtenPlaceOf('src/Order.php:42:7')).toEqual({ path: 'src/Order.php', line: 42 })
  expect(writtenPlaceOf('src/Order.php#L42-L50')).toEqual({ path: 'src/Order.php', line: 42 })
  expect(writtenPlaceOf(' src/Order.php line 42 ')).toEqual({ path: 'src/Order.php', line: 42 })
})

test('a path is brought back to the project root, and one outside the project is refused', async () => {
  expect(pathFromRoot('/work/shop', '/work/shop/src/Order.php')).toBe('src/Order.php')
  expect(pathFromRoot('/work/shop', './src/../src/Order.php')).toBe('src/Order.php')
  expect(pathFromRoot('/work/shop', '/work/other/Order.php')).toBeNull()
  expect(pathFromRoot('/work/shop', '../other/Order.php')).toBeNull()
})

test('a member is read with what holds it, whichever separator names it', async () => {
  expect(writtenSymbolOf('OrderRepository::save')).toEqual({ containerName: 'OrderRepository', name: 'save' })
  expect(writtenSymbolOf('OrderRepository.save()')).toEqual({ containerName: 'OrderRepository', name: 'save' })
  expect(writtenSymbolOf('OrderRepository#save')).toEqual({ containerName: 'OrderRepository', name: 'save' })
  expect(writtenSymbolOf('App\\Shop\\OrderRepository::save')).toEqual({ containerName: 'OrderRepository', name: 'save' })
  expect(writtenSymbolOf('App\\Shop\\OrderRepository')).toEqual({ containerName: null, name: 'OrderRepository' })
  expect(writtenSymbolOf('save')).toEqual({ containerName: null, name: 'save' })
})
