import { tokenInvariantBreaches } from './token-invariants'
import { tokenizeSource } from './tokenize'

// The tokens of each line, each written "kind text", a navigable one "kind* text". Throws when the tokens break
// what must hold for any text, so that every test checks it on its own sample.
export function readTokens(path: string, source: string): string[][] {
  const tokensByLine = tokenizeSource(path, source)
  const breaches = tokenInvariantBreaches(source, tokensByLine)
  if (breaches.length > 0) {
    throw new Error(`The tokens of ${path} are not sound:\n${breaches.join('\n')}`)
  }
  const lines = source.split('\n')

  return tokensByLine.map((lineTokens, lineIndex) =>
    lineTokens.map(token => {
      const tokenText = (lines[lineIndex] ?? '').slice(token.startColumn, token.endColumn)

      return `${token.kind}${token.isNavigable ? '*' : ''} ${tokenText}`
    }),
  )
}

export function readTokensOfLines(path: string, sourceLines: string[]): string[][] {
  return readTokens(path, sourceLines.join('\n'))
}

export function readTokensOfOnlyLine(path: string, source: string): string[] {
  return readTokens(path, source)[0] ?? []
}
