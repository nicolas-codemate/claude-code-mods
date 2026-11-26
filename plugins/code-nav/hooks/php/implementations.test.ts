import { expect, test } from 'claude-code/testing'

import type { ImplementationsAnswer } from '../../types'
import { descendantsOfClass, findPhpImplementations } from './implementations'
import { createPhpProject } from './project'
import { createShopWorkspace, positionIn, shopPosition } from './shop-project'

const SHAPES = {
  'src/Shape/Shape.php': '<?php\nnamespace Shop\\Shape;\ninterface Shape\n{\n    public function area(): float;\n}\n',
  'src/Shape/Polygon.php': '<?php\nnamespace Shop\\Shape;\nabstract class Polygon implements\n    \\Countable,\n    Shape\n{\n    abstract public function area(): float;\n}\n',
  'src/Shape/Square.php': '<?php\nnamespace Shop\\Shape;\nfinal class Square extends Polygon\n{\n    use Named;\n\n    public function area(): float\n    {\n        return 1.0;\n    }\n}\n',
  'src/Shape/Circle.php': '<?php\nnamespace Shop\\Shape;\nclass Circle implements Shape, \\Stringable\n{\n    public function area(): float\n    {\n        return 3.14;\n    }\n}\n',
  'src/Shape/Named.php': '<?php\nnamespace Shop\\Shape;\ntrait Named\n{\n    public function name(): string\n    {\n        return static::class;\n    }\n}\n',
  'src/Other/Shape.php': '<?php\nnamespace Shop\\Other;\ninterface Shape {}\n',
  'src/Other/Blob.php': '<?php\nnamespace Shop\\Other;\nclass Blob implements Shape\n{\n    public function area(): float\n    {\n        return 0.0;\n    }\n}\n',
  'src/Shape/Canvas.php': '<?php\nnamespace Shop\\Shape;\nclass Canvas\n{\n    public function draw(Shape $shape): float\n    {\n        return $shape->area();\n    }\n}\n',
}

function implementationsAt(path: string, snippet: string, name: string): Promise<ImplementationsAnswer> {
  return findPhpImplementations(createShopWorkspace(SHAPES), positionIn(SHAPES, path, snippet, name))
}

function placesOf(answer: ImplementationsAnswer): string[] {
  return answer.targets.map(target => `${target.label} ${target.path}:${target.line}`)
}

test('the implementations of an interface are the classes below it, through an intermediate one too', async () => {
  const answer = await implementationsAt('src/Shape/Shape.php', 'interface Shape', 'Shape')
  expect(answer.title).toBe('Shape')
  expect(placesOf(answer)).toEqual(['Circle src/Shape/Circle.php:3', 'Polygon src/Shape/Polygon.php:3', 'Square src/Shape/Square.php:3'])
  expect(answer.targets.every(target => target.certainty === 'exact' && !target.isDependency)).toBe(true)
})

test('a class of the same short name in another namespace is not an implementation', async () => {
  const names = (await implementationsAt('src/Other/Shape.php', 'interface Shape', 'Shape')).targets.map(target => target.label)
  expect(names).toEqual(['Blob'])
})

test('the implementations of a method are its declarations in the classes below', async () => {
  const answer = await implementationsAt('src/Shape/Shape.php', 'public function area(): float;', 'area')
  expect(answer.title).toBe('Shape::area')
  expect(placesOf(answer)).toEqual(['Circle::area src/Shape/Circle.php:5', 'Polygon::area src/Shape/Polygon.php:7', 'Square::area src/Shape/Square.php:7'])
  expect(answer.targets[0]?.preview).toBe('public function area(): float')
})

test('implementations asked from a call are those of the method the call resolves to', async () => {
  const answer = await implementationsAt('src/Shape/Canvas.php', '$shape->area()', 'area')
  expect(answer.title).toBe('Shape::area')
  expect(answer.targets.map(target => target.label)).toEqual(['Circle::area', 'Polygon::area', 'Square::area'])
})

test('the classes using a trait are its implementations', async () => {
  expect(placesOf(await implementationsAt('src/Shape/Named.php', 'trait Named', 'Named'))).toEqual(['Square src/Shape/Square.php:3'])
})

test('a class nothing extends says so, a variable has no implementation', async () => {
  const ofLeaf = await implementationsAt('src/Shape/Square.php', 'final class Square', 'Square')
  expect(ofLeaf.targets).toEqual([])
  expect(ofLeaf.note).toBe('No class of the project extends or implements Square')
  const ofVariable = await implementationsAt('src/Shape/Canvas.php', 'return $shape->area()', '$shape')
  expect(ofVariable.note).toBe('Implementations are listed for a class, an interface or a method')
})

test('dependencies are left out: only the classes of the project are listed', async () => {
  const answer = await findPhpImplementations(
    createShopWorkspace(),
    shopPosition('src/Entity/Order.php', 'use Doctrine\\Common\\Collections\\Collection;', 'Collection'),
  )
  expect(answer.targets).toEqual([])
  const ofRepository = await findPhpImplementations(
    createShopWorkspace(),
    shopPosition('src/Repository/OrderRepository.php', 'use Doctrine\\Bundle\\ServiceEntityRepository;', 'ServiceEntityRepository'),
  )
  expect(ofRepository.targets.map(target => target.label)).toEqual(['OrderRepository', 'ProductRepository'])
})

test('the classes below a class are found level by level, each once', async () => {
  const project = createPhpProject(createShopWorkspace(SHAPES))
  const descendants = await descendantsOfClass(project, 'Shop\\Entity\\HasTotal')
  expect(descendants.map(located => located.classDeclaration.name)).toEqual(['Invoice', 'Order', 'CreditNote'])
})
