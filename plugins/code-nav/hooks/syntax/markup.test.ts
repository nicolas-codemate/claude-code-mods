import { expect, test } from 'claude-code/testing'

import { readTokensOfLines } from './test-support'

test('markup is tags, attributes, strings, comments and text', async () => {
  expect(
    readTokensOfLines('public/index.html', [
      '<!DOCTYPE html>',
      '<!-- the <b>shop</b>',
      '     page -->',
      '<a href="/orders" class=link data-count=3 disabled>All orders &amp; invoices</a><br/>',
      '1 < 2',
    ]),
  ).toEqual([
    ['punctuation <!', 'tag DOCTYPE', 'attribute html', 'punctuation >'],
    ['comment <!-- the <b>shop</b>'],
    ['comment page -->'],
    [
      'punctuation <', 'tag a', 'attribute href', 'punctuation =', 'string "/orders"', 'attribute class',
      'punctuation =', 'string link', 'attribute data-count', 'punctuation =', 'string 3', 'attribute disabled',
      'punctuation >', 'text All orders &amp; invoices', 'punctuation </', 'tag a', 'punctuation ><', 'tag br',
      'punctuation />',
    ],
    ['text 1 < 2'],
  ])
})

test('a custom element is navigable, an HTML element written in capitals is not', async () => {
  expect(readTokensOfLines('public/index.html', ['<shop-cart></shop-cart><DIV><OrderList/></DIV>'])).toEqual([
    [
      'punctuation <', 'tag* shop-cart', 'punctuation ></', 'tag* shop-cart', 'punctuation ><', 'tag DIV',
      'punctuation ><', 'tag* OrderList', 'punctuation /></', 'tag DIV', 'punctuation >',
    ],
  ])
})

test('the content of a script element is script, of a style element a style sheet', async () => {
  expect(
    readTokensOfLines('public/index.html', [
      '<script>const total = sum(prices) // </b>',
      '</script><style>a { color: red } /* <b> */</style>',
    ]),
  ).toEqual([
    [
      'punctuation <', 'tag script', 'punctuation >', 'keyword const', 'name* total', 'punctuation =', 'callName* sum',
      'punctuation (', 'name* prices', 'punctuation )', 'comment // </b>',
    ],
    [
      'punctuation </', 'tag script', 'punctuation ><', 'tag style', 'punctuation >', 'text a { color: red }',
      'comment /* <b> */', 'punctuation </', 'tag style', 'punctuation >',
    ],
  ])
})

test('an XML file has declarations, namespaced tags and character data', async () => {
  expect(
    readTokensOfLines('config/services.xml', ['<?xml version="1.0"?>', '<srv:service id="order.mailer"><![CDATA[a < b]]></srv:service>']),
  ).toEqual([
    ['punctuation <?', 'tag xml', 'attribute version', 'punctuation =', 'string "1.0"', 'punctuation ?>'],
    [
      'punctuation <', 'tag srv:service', 'attribute id', 'punctuation =', 'string "order.mailer"',
      'punctuation ><![CDATA[', 'text a < b', 'punctuation ]]></', 'tag srv:service', 'punctuation >',
    ],
  ])
})

test('an attribute value or a comment left open runs to the end of the file', async () => {
  expect(readTokensOfLines('public/index.html', ['<a href="open', 'next>'])).toEqual([
    ['punctuation <', 'tag a', 'attribute href', 'punctuation =', 'string "open'],
    ['string next>'],
  ])
  expect(readTokensOfLines('public/index.html', ['<!-- open', '<a>'])).toEqual([['comment <!-- open'], ['comment <a>']])
})
