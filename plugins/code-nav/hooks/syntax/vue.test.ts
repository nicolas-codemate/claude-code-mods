import { expect, test } from 'claude-code/testing'

import { readTokensOfLines } from './test-support'

test('the template is markup: component tags are navigable, HTML elements and built-in tags are not', async () => {
  expect(
    readTokensOfLines('src/OrderPage.vue', [
      '<template>',
      '  <div class="page">',
      '    <OrderList /><order-line></order-line><Button>Pay</Button><Transition><button>x</button></Transition>',
      '  </div>',
      '</template>',
    ]),
  ).toEqual([
    ['punctuation <', 'tag template', 'punctuation >'],
    ['punctuation <', 'tag div', 'attribute class', 'punctuation =', 'string "page"', 'punctuation >'],
    [
      'punctuation <', 'tag* OrderList', 'punctuation /><', 'tag* order-line', 'punctuation ></', 'tag* order-line',
      'punctuation ><', 'tag* Button', 'punctuation >', 'text Pay', 'punctuation </', 'tag* Button', 'punctuation ><',
      'tag Transition', 'punctuation ><', 'tag button', 'punctuation >', 'text x', 'punctuation </', 'tag button',
      'punctuation ></', 'tag Transition', 'punctuation >',
    ],
    ['punctuation </', 'tag div', 'punctuation >'],
    ['punctuation </', 'tag template', 'punctuation >'],
  ])
})

test('bound attributes, events, directives and mustaches hold script, a plain attribute a string', async () => {
  expect(
    readTokensOfLines('src/OrderPage.vue', [
      '<template>',
      '  <OrderLine v-for="line in order.lines" :key="line.id" title="line.title" @remove="removeLine(line, $event)" #price="{ amount }">',
      "    {{ formatPrice(amount) }} of {{ order.total > 0 ? 'due' : 'free' }}",
      '  </OrderLine>',
      '</template>',
    ]).slice(1, 3),
  ).toEqual([
    [
      'punctuation <', 'tag* OrderLine', 'attribute v-for', 'punctuation ="', 'name* line', 'keyword in', 'name* order',
      'punctuation .', 'property* lines', 'punctuation "', 'attribute :key', 'punctuation ="', 'name* line',
      'punctuation .', 'property* id', 'punctuation "', 'attribute title', 'punctuation =', 'string "line.title"',
      'attribute @remove', 'punctuation ="', 'callName* removeLine', 'punctuation (', 'name* line', 'punctuation ,',
      'name* $event', 'punctuation )"', 'attribute #price', 'punctuation ="{', 'name* amount', 'punctuation }">',
    ],
    [
      'punctuation {{', 'callName* formatPrice', 'punctuation (', 'name* amount', 'punctuation )', 'punctuation }}',
      'text of', 'punctuation {{', 'name* order', 'punctuation .', 'property* total', 'punctuation >', 'number 0',
      'punctuation ?', "string 'due'", 'punctuation :', "string 'free'", 'punctuation }}',
    ],
  ])
})

test('the script block is script, the style block plain text with its comments and strings', async () => {
  expect(
    readTokensOfLines('src/OrderPage.vue', [
      '<script setup lang="ts">',
      "import OrderLine from './OrderLine.vue'",
      'const props = defineProps<{ order: Order }>()',
      '</script>',
      '<style scoped>',
      '.page { /* wide */',
      '  background: url("https://shop.test/a.png"); // not code',
      '}',
      '</style>',
    ]),
  ).toEqual([
    ['punctuation <', 'tag script', 'attribute setup', 'attribute lang', 'punctuation =', 'string "ts"', 'punctuation >'],
    ['keyword import', 'typeName* OrderLine', 'keyword from', "string* './OrderLine.vue'"],
    [
      'keyword const', 'name* props', 'punctuation =', 'callName* defineProps', 'punctuation <{', 'name* order',
      'punctuation :', 'typeName* Order', 'punctuation }>()',
    ],
    ['punctuation </', 'tag script', 'punctuation >'],
    ['punctuation <', 'tag style', 'attribute scoped', 'punctuation >'],
    ['text .page {', 'comment /* wide */'],
    ['text background: url(', 'string "https://shop.test/a.png"', 'text );', 'comment // not code'],
    ['text }'],
    ['punctuation </', 'tag style', 'punctuation >'],
  ])
})

test('a script left open runs to the end of the file, a mustache left open to the end of its line', async () => {
  expect(readTokensOfLines('src/OrderPage.vue', ['<script>', 'const order = `open', '</script>', '<template>'])).toEqual([
    ['punctuation <', 'tag script', 'punctuation >'],
    ['keyword const', 'name* order', 'punctuation =', 'string `open'],
    ['punctuation </', 'tag script', 'punctuation >'],
    ['punctuation <', 'tag template', 'punctuation >'],
  ])
  expect(readTokensOfLines('src/OrderPage.vue', ['<template>', '  <p>{{ order.total', '  </p>'])).toEqual([
    ['punctuation <', 'tag template', 'punctuation >'],
    ['punctuation <', 'tag p', 'punctuation >{{', 'name* order', 'punctuation .', 'property* total'],
    ['punctuation </', 'tag p', 'punctuation >'],
  ])
})
