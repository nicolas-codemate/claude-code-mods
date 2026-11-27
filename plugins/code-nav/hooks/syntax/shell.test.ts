import { expect, test } from 'claude-code/testing'

import { shellDialectOfPath } from './shell'
import { readTokensOfLines } from './test-support'

test('the dialect of a shell-like file comes from its name', async () => {
  expect(['bin/deploy.sh', 'Dockerfile', 'docker/Dockerfile.dev', 'Makefile', 'build/rules.mk'].map(shellDialectOfPath)).toEqual([
    'shell', 'dockerfile', 'dockerfile', 'makefile', 'makefile',
  ])
})

test('a shell script has comments, strings, variables, options, keywords and navigable words', async () => {
  expect(
    readTokensOfLines('bin/deploy.sh', [
      '#!/bin/sh',
      'TARGET=${1:-staging} # where to',
      "if [ \"$TARGET\" = 'prod' ]; then bin/console cache:clear --no-warmup -v; fi",
      'deploy() { echo "to $TARGET in ${HOME}/app#1"; }',
    ]),
  ).toEqual([
    ['comment #!/bin/sh'],
    ['variable* TARGET', 'punctuation =${', 'number 1', 'punctuation :-', 'name* staging', 'punctuation }', 'comment # where to'],
    [
      'keyword if', 'punctuation [', 'string "', 'variable* $TARGET', 'string "', 'punctuation =', "string 'prod'",
      'punctuation ];', 'keyword then', 'name* bin/console', 'name* cache', 'punctuation :', 'name* clear',
      'attribute --no-warmup', 'attribute -v', 'punctuation ;', 'keyword fi',
    ],
    [
      'callName* deploy', 'punctuation ()', 'punctuation {', 'name* echo', 'string "to', 'variable* $TARGET',
      'string in', 'punctuation ${', 'variable* HOME', 'string }/app#1"', 'punctuation ;', 'punctuation }',
    ],
  ])
})

test('a here-document is text up to its label, a here-string is not one', async () => {
  expect(readTokensOfLines('bin/mail.sh', ['cat <<-EOF > mail.txt', '  Dear $NAME, # not a comment', '  EOF', 'grep paid <<< "$orders"'])).toEqual([
    ['name* cat', 'punctuation <<-', 'string EOF', 'punctuation >', 'name* mail.txt'],
    ['string Dear $NAME, # not a comment'],
    ['string EOF'],
    ['name* grep', 'name* paid', 'punctuation <<<', 'string "', 'variable* $orders', 'string "'],
  ])
})

test('a Dockerfile has its instructions as keywords, at the start of a line only', async () => {
  expect(readTokensOfLines('Dockerfile', ['FROM php:8.3-fpm AS base', 'RUN composer install --no-dev && echo FROM'])).toEqual([
    ['keyword FROM', 'name* php', 'punctuation :', 'number 8.3', 'punctuation -', 'name* fpm', 'name* AS', 'name* base'],
    ['keyword RUN', 'name* composer', 'name* install', 'attribute --no-dev', 'punctuation &&', 'name* echo', 'name* FROM'],
  ])
})

test('a Makefile has targets, variables and directives', async () => {
  expect(readTokensOfLines('Makefile', ['CONSOLE := bin/console', 'include rules.mk', 'test: vendor', '\t$(CONSOLE) lint $@ $(shell ls src)'])).toEqual([
    ['variable* CONSOLE', 'punctuation :=', 'name* bin/console'],
    ['keyword include', 'name* rules.mk'],
    ['callName* test', 'punctuation :', 'name* vendor'],
    [
      'punctuation $(', 'variable* CONSOLE', 'punctuation )', 'name* lint', 'variable $@', 'punctuation $(',
      'name* shell', 'name* ls', 'name* src', 'punctuation )',
    ],
  ])
})
