import type { SourceToken } from '../../types'
import { dataDialectOfPath, scanData } from './data'
import { scanClike, scanPlain } from './generic'
import { extensionOfPath, languageOfPath } from './language'
import type { SourceLanguage } from './language'
import { NO_TEMPLATING, scanMarkup } from './markup'
import { scanPhp } from './php'
import { createTokenCollector, isWhitespaceCode } from './scanning'
import type { TokenCollector } from './scanning'
import { scanScript } from './script'
import { scanShell, shellDialectOfPath } from './shell'
import { TWIG_TEMPLATING } from './twig'
import { scanVue } from './vue'

export { languageOfPath } from './language'
export type { SourceLanguage } from './language'

// A longer line is machine-made (a minified bundle, embedded data): it is drawn as plain text and read as empty
// by the scanner, which keeps the lines around it cheap and correctly read.
export const LONGEST_TOKENIZED_LINE = 2000

const EXTENSIONS_ALLOWING_JSX = new Set(['tsx', 'jsx', 'js'])

type LanguageScanner = (path: string, text: string, collector: TokenCollector) => void

const SCANNER_OF_LANGUAGE: Readonly<Record<SourceLanguage, LanguageScanner>> = {
  php: (_path, text, collector) => scanPhp(text, 0, text.length, collector),
  script: (path, text, collector) =>
    scanScript(text, 0, text.length, collector, EXTENSIONS_ALLOWING_JSX.has(extensionOfPath(path))),
  vue: (_path, text, collector) => scanVue(text, 0, text.length, collector),
  markup: (path, text, collector) =>
    scanMarkup(text, 0, text.length, collector, extensionOfPath(path) === 'twig' ? TWIG_TEMPLATING : NO_TEMPLATING),
  data: (path, text, collector) => scanData(text, 0, text.length, collector, dataDialectOfPath(path)),
  shell: (path, text, collector) => scanShell(text, 0, text.length, collector, shellDialectOfPath(path)),
  clike: (_path, text, collector) => scanClike(text, 0, text.length, collector),
  plain: (_path, text, collector) => scanPlain(text, 0, text.length, collector),
}

function wholeLineAsText(line: string): SourceToken[] {
  let startColumn = 0
  let endColumn = line.length
  while (startColumn < endColumn && isWhitespaceCode(line.charCodeAt(startColumn))) {
    startColumn++
  }
  while (endColumn > startColumn && isWhitespaceCode(line.charCodeAt(endColumn - 1))) {
    endColumn--
  }

  return startColumn < endColumn ? [{ startColumn, endColumn, kind: 'text', isNavigable: false }] : []
}

// One array per line of the text (split on "\n"; a trailing "\r" belongs to no token), tokens in column order, never
// overlapping. Whitespace belongs to no token; every other character belongs to one. Columns index the line's own
// text, a tab counted as one character.
export function tokenizeSource(path: string, text: string): SourceToken[][] {
  const lines = text.split('\n')
  const hasLongLine = lines.some(line => line.length > LONGEST_TOKENIZED_LINE)
  const scannedText = hasLongLine
    ? lines.map(line => (line.length > LONGEST_TOKENIZED_LINE ? '' : line)).join('\n')
    : text
  const collector = createTokenCollector(scannedText)
  SCANNER_OF_LANGUAGE[languageOfPath(path)](path, scannedText, collector)
  if (hasLongLine) {
    lines.forEach((line, lineIndex) => {
      if (line.length > LONGEST_TOKENIZED_LINE) {
        collector.tokensByLine[lineIndex] = wholeLineAsText(line)
      }
    })
  }

  return collector.tokensByLine
}
