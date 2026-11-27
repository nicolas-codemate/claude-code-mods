import { expect, test } from 'claude-code/testing'

import { readTokensOfLines } from './test-support'

test('twig tags and expressions are code inside the markup, a template path is navigable', async () => {
  expect(
    readTokensOfLines('templates/order/show.html.twig', [
      "{% extends 'base.html.twig' %}",
      '{# the order',
      '   page #}',
      "<h1 class=\"title {{ order.paid ? 'paid' }}\">{{ order.number|upper }} {{- include('order/_lines.html.twig', {lines: order.lines}) -}}</h1>",
      '{% for line in order.lines if line.price > 0 %}<li {{ attributes }}>{{ format_price(line.price) }}</li>{% endfor %}',
    ]),
  ).toEqual([
    ['punctuation {%', 'keyword extends', "string* 'base.html.twig'", 'punctuation %}'],
    ['comment {# the order'],
    ['comment page #}'],
    [
      'punctuation <', 'tag h1', 'attribute class', 'punctuation =', 'string "title', 'punctuation {{', 'name* order',
      'punctuation .', 'property* paid', 'punctuation ?', "string 'paid'", 'punctuation }}', 'string "',
      'punctuation >{{', 'name* order', 'punctuation .', 'property* number', 'punctuation |', 'callName* upper',
      'punctuation }}', 'punctuation {{-', 'callName* include', 'punctuation (', "string* 'order/_lines.html.twig'",
      'punctuation ,', 'punctuation {', 'name* lines', 'punctuation :', 'name* order', 'punctuation .',
      'property* lines', 'punctuation })', 'punctuation -}}</', 'tag h1', 'punctuation >',
    ],
    [
      'punctuation {%', 'keyword for', 'name* line', 'keyword in', 'name* order', 'punctuation .', 'property* lines',
      'keyword if', 'name* line', 'punctuation .', 'property* price', 'punctuation >', 'number 0', 'punctuation %}<',
      'tag li', 'punctuation {{', 'name* attributes', 'punctuation }}>{{', 'callName* format_price', 'punctuation (',
      'name* line', 'punctuation .', 'property* price', 'punctuation )', 'punctuation }}</', 'tag li',
      'punctuation >{%', 'keyword endfor', 'punctuation %}',
    ],
  ])
})

test('a twig string may hold the quote of the attribute around it, an open tag runs to the end of the file', async () => {
  expect(readTokensOfLines('templates/order/show.html.twig', ['<a href="{{ path("order_show") }}">', '{% if open', 'text'])).toEqual([
    [
      'punctuation <', 'tag a', 'attribute href', 'punctuation =', 'string "', 'punctuation {{', 'callName* path',
      'punctuation (', 'string "order_show"', 'punctuation )', 'punctuation }}', 'string "', 'punctuation >',
    ],
    ['punctuation {%', 'keyword if', 'name* open'],
    ['name* text'],
  ])
})
