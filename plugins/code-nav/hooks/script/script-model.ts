import type { ScriptStructure } from './declarations'
import { readScriptStructure } from './structure-reading'
import { lineStartOffsetsOf } from '../text-position'
import { tokenizeScript } from './tokenizer'
import { readVueBlocks } from './vue-blocks'
import type { TextRange } from './vue-blocks'
import { scanVueTemplate } from './vue-template'
import type { TemplateExpression, TemplateScan } from './vue-template'

export const SCRIPT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue'] as const
export const SCRIPT_FILE_GLOBS = SCRIPT_EXTENSIONS.map(extension => `*${extension}`)

// One file read once: its text, its tokens and scopes and, for a Vue component, its template.
export type ScriptModel = {
  path: string
  text: string
  lineStartOffsets: number[]
  structure: ScriptStructure
  isVueComponent: boolean
  templateRange: TextRange | null
  // Read on first use: a definition inside the script block never needs the template.
  templateScan: () => TemplateScan | null
  structureOfTemplateExpression: (expression: TemplateExpression) => ScriptStructure
}

export function isScriptPath(path: string): boolean {
  return (
    SCRIPT_EXTENSIONS.some(extension => path.endsWith(extension)) || /\.d\.[mc]?ts$/.test(path) || /\.[mc]ts$/.test(path)
  )
}

// With a window, only that part of the text is tokenized: the one declaration wanted from a generated file of
// several megabytes, whose lines and offsets stay those of the whole file.
export function buildScriptModel(path: string, text: string, window: TextRange | null = null): ScriptModel {
  const isVueComponent = path.endsWith('.vue')
  const vueBlocks = isVueComponent ? readVueBlocks(text) : null
  const hasMarkup = vueBlocks === null ? path.endsWith('.tsx') || path.endsWith('.jsx') : vueBlocks.hasMarkup
  let tokens = vueBlocks === null ? tokenizeScript(text, { hasMarkup, ...(window ?? {}) }) : []
  for (const scriptRange of vueBlocks?.scriptRanges ?? []) {
    tokens = tokenizeScript(text, { hasMarkup, start: scriptRange.start, end: scriptRange.end, tokensBefore: tokens })
  }
  const templateRange = vueBlocks?.templateRange ?? null
  let templateScan: TemplateScan | null = null
  const expressionStructures = new Map<number, ScriptStructure>()

  return {
    path,
    text,
    lineStartOffsets: lineStartOffsetsOf(text),
    structure: readScriptStructure(tokens),
    isVueComponent,
    templateRange,
    templateScan: () => {
      if (templateScan === null && templateRange !== null) {
        templateScan = scanVueTemplate(text, templateRange)
      }

      return templateScan
    },
    structureOfTemplateExpression: expression => {
      const knownStructure = expressionStructures.get(expression.start)
      if (knownStructure !== undefined) {
        return knownStructure
      }
      const structure = readScriptStructure(tokenizeScript(text, { start: expression.start, end: expression.end }), {
        isExpression: true,
      })
      expressionStructures.set(expression.start, structure)

      return structure
    },
  }
}
