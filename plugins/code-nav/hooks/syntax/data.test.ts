import { expect, test } from 'claude-code/testing'

import { dataDialectOfPath } from './data'
import { readTokensOfLines } from './test-support'

test('the dialect of a data file comes from its extension', async () => {
  expect(['composer.json', 'composer.lock', 'config/services.yaml', 'phpstan.neon', '.env.test', 'php.ini', 'app.toml'].map(dataDialectOfPath)).toEqual([
    'json', 'json', 'yaml', 'yaml', 'keyValue', 'keyValue', 'keyValue',
  ])
})

test('the keys of a JSON file are navigable properties, its values strings, numbers and keywords', async () => {
  expect(
    readTokensOfLines('composer.json', ['{', '  "name": "shop/orders", // the package', '  "require": {"php": ">=8.3"}, "stable": true, "retries": -2.5e3', '}']),
  ).toEqual([
    ['punctuation {'],
    ['property* "name"', 'punctuation :', 'string "shop/orders"', 'punctuation ,', 'comment // the package'],
    [
      'property* "require"', 'punctuation :', 'punctuation {', 'property* "php"', 'punctuation :', 'string ">=8.3"',
      'punctuation },', 'property* "stable"', 'punctuation :', 'keyword true', 'punctuation ,', 'property* "retries"',
      'punctuation :', 'number -2.5e3',
    ],
    ['punctuation }'],
  ])
})

test('the keys of a YAML file are properties, a class name in a value one navigable name', async () => {
  expect(
    readTokensOfLines('config/services.yaml', [
      'services:',
      '  App\\Shop\\OrderMailer:',
      "    arguments: ['@order.clock', 42, true] # wired by hand",
      '    class: App\\Shop\\SmtpOrderMailer',
      '  - { name: kernel.event_listener, event: order.paid }',
      '  url: http://shop.test/orders',
      '  "quoted key": &defaults value',
    ]),
  ).toEqual([
    ['property* services', 'punctuation :'],
    ['property* App\\Shop\\OrderMailer', 'punctuation :'],
    [
      'property* arguments', 'punctuation :', 'punctuation [', "string '@order.clock'", 'punctuation ,', 'number 42',
      'punctuation ,', 'keyword true', 'punctuation ]', 'comment # wired by hand',
    ],
    ['property* class', 'punctuation :', 'name* App\\Shop\\SmtpOrderMailer'],
    [
      'punctuation -', 'punctuation {', 'property* name', 'punctuation :', 'name* kernel.event_listener',
      'punctuation ,', 'property* event', 'punctuation :', 'name* order.paid', 'punctuation }',
    ],
    ['property* url', 'punctuation :', 'name* http', 'punctuation ://', 'name* shop.test', 'punctuation /', 'name* orders'],
    ['property* "quoted key"', 'punctuation :', 'variable* &defaults', 'name* value'],
  ])
})

test('the lines under a YAML block marker are text until the indentation comes back', async () => {
  expect(
    readTokensOfLines('config/mail.yaml', ['mail:', '  body: |-', '    Dear customer: your order', '', '      # is paid', '  subject: Paid']),
  ).toEqual([
    ['property* mail', 'punctuation :'],
    ['property* body', 'punctuation :', 'punctuation |-'],
    ['string Dear customer: your order'],
    [],
    ['string # is paid'],
    ['property* subject', 'punctuation :', 'name* Paid'],
  ])
})

test('key and value lines have sections, commented lines and exported keys', async () => {
  expect(
    readTokensOfLines('.env', ['# local settings', '[database]', 'DATABASE_URL="mysql://shop@db/orders" # main', 'export APP_DEBUG=on', 'retries = 3 ; three times']),
  ).toEqual([
    ['comment # local settings'],
    ['punctuation [', 'tag database', 'punctuation ]'],
    ['property* DATABASE_URL', 'punctuation =', 'string "mysql://shop@db/orders"', 'comment # main'],
    ['keyword export', 'property* APP_DEBUG', 'punctuation =', 'keyword on'],
    ['property* retries', 'punctuation =', 'number 3', 'comment ; three times'],
  ])
})
