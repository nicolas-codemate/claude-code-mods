import { expect, test } from 'claude-code/testing'

import { lineAndColumnOfOffset, offsetOfLineAndColumn } from '../text-position'
import { commentAtOffset, tokenIndexAtOffset, tokenizePhp } from './tokens'

function tokenTextsOf(code: string): string[] {
  return tokenizePhp(`<?php ${code}`).tokens.map(token => token.text)
}

test('names keep their namespace, variables their dollar, operators of several characters stay whole', async () => {
  expect(tokenTextsOf('$order?->lines->add(new \\Shop\\Line(), Shop\\Kind::Gift) ?? $a <=> $b;')).toEqual([
    '$order', '?->', 'lines', '->', 'add', '(', 'new', '\\Shop\\Line', '(', ')', ',', 'Shop\\Kind', '::', 'Gift', ')', '??', '$a', '<=>', '$b', ';',
  ])
  expect(tokenizePhp('<?php $total = 12.5;').tokens.map(token => token.kind)).toEqual(['variable', 'punctuation', 'number', 'punctuation'])
})

test('a grouped use keeps its prefix as one name ending on the separator', async () => {
  expect(tokenTextsOf('use Shop\\Entity\\{Order, Product};')).toEqual(['use', 'Shop\\Entity\\', '{', 'Order', ',', 'Product', '}', ';'])
})

test('a string is one token whatever it holds: quotes, braces, a heredoc, an interpolated call', async () => {
  expect(tokenTextsOf(`$a = 'it\\'s -> $x'; $b = "total {$order->lines['first']} }"; $c;`)).toEqual([
    '$a', '=', `'it\\'s -> $x'`, ';', '$b', '=', `"total {$order->lines['first']} }"`, ';', '$c', ';',
  ])
  const heredoc = tokenizePhp('<?php\n$sql = <<<SQL\n  SELECT $this->x FROM orders;\n  SQL;\n$next = 1;\n')
  expect(heredoc.tokens.map(token => token.kind)).toEqual(['variable', 'punctuation', 'string', 'punctuation', 'variable', 'punctuation', 'number', 'punctuation'])
  expect(tokenTextsOf("$n = <<<'RAW'\n$not->code\nRAW;\n$after;").slice(-2)).toEqual(['$after', ';'])
})

test('comments are kept apart from the tokens, an attribute is not a comment', async () => {
  const source = tokenizePhp('<?php\n// $hidden->call()\n# also hidden\n/* block */\n#[Route("/orders")]\nfunction list() {}\n')
  expect(source.tokens[0]?.text).toBe('#[')
  expect(source.comments.map(comment => comment.text)).toEqual(['// $hidden->call()', '# also hidden', '/* block */'])
  expect(source.comments.every(comment => !comment.isDocblock)).toBe(true)
})

test('a docblock is attached to the token that follows it', async () => {
  const source = tokenizePhp('<?php\n/** @var Order $order */\n$order = load();\n/** Lists. */\n// a remark in between\npublic function list() {}\n')
  expect(source.tokens[0]?.leadingDocblock?.text).toBe('/** @var Order $order */')
  expect(source.tokens[1]?.leadingDocblock).toBe(null)
  expect(source.tokens.find(token => token.text === 'public')?.leadingDocblock?.text).toBe('/** Lists. */')
  expect(commentAtOffset(source.comments, source.text.indexOf('@var'))?.isDocblock).toBe(true)
  expect(commentAtOffset(source.comments, source.text.indexOf('load'))).toBe(null)
})

test('each bracket knows the one closing it, an attribute included', async () => {
  const source = tokenizePhp('<?php #[Tag(["a"])] function f(array $a) { return $a[0]; }')
  const texts = source.tokens.map(token => token.text)
  const partnerOf = (text: string, occurrence = 0) => {
    const index = texts.flatMap((candidate, candidateIndex) => (candidate === text ? [candidateIndex] : []))[occurrence] ?? -1

    return texts[source.matchingBracketIndexes[index] ?? -1]
  }
  expect(partnerOf('#[')).toBe(']')
  expect(partnerOf('{')).toBe('}')
  expect(source.matchingBracketIndexes[texts.indexOf('{')]).toBe(texts.lastIndexOf('}'))
  expect(source.matchingBracketIndexes[texts.indexOf('function')]).toBe(-1)
})

test('code outside the php tags is not tokenized', async () => {
  const source = tokenizePhp('<h1>$title->x</h1>\n<?php echo $a; ?>\n<p>$b->y</p>\n<?= $c ?>')
  expect(source.tokens.map(token => token.text)).toEqual(['echo', '$a', ';', '$c'])
  expect(tokenizePhp('no php here $a->b').tokens).toEqual([])
})

test('positions and offsets convert both ways, a token is found by any offset inside it', async () => {
  const source = tokenizePhp('<?php\n$order->save();\n')
  const offset = offsetOfLineAndColumn(source.lineStartOffsets, 2, 8) ?? -1
  expect(source.text.slice(offset, offset + 4)).toBe('save')
  expect(source.tokens[tokenIndexAtOffset(source.tokens, offset + 3)]?.text).toBe('save')
  expect(tokenIndexAtOffset(source.tokens, 5)).toBe(-1)
  expect(lineAndColumnOfOffset(source.lineStartOffsets, offset).line).toBe(2)
  expect(offsetOfLineAndColumn(source.lineStartOffsets, 99, 0)).toBe(null)
})

test('an unterminated string or comment ends with the file instead of throwing', async () => {
  expect(tokenizePhp("<?php $a = 'never closed").tokens.map(token => token.kind)).toEqual(['variable', 'punctuation', 'string'])
  expect(tokenizePhp('<?php $a; /* never closed').comments.length).toBe(1)
  expect(tokenizePhp('<?php $a = <<<EOT\nnever closed').tokens.at(-1)?.kind).toBe('string')
})
