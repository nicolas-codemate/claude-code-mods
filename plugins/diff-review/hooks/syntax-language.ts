import type { DiffRow } from '../types'

const LANGUAGE_BY_EXTENSION: Record<string, string> = { feature: 'gherkin' }

export function languageOfPath(path: string): string | undefined {
  const extension = path.includes('.') ? path.slice(path.lastIndexOf('.') + 1).toLowerCase() : ''

  return LANGUAGE_BY_EXTENSION[extension]
}

export function isVueFile(path: string): boolean {
  return path.toLowerCase().endsWith('.vue')
}

function languageOfVueBlock(openingTag: string): string {
  const lang = openingTag.match(/\blang=["']?([\w-]+)/)?.[1]?.toLowerCase()
  if (openingTag.startsWith('<script')) {
    return lang === 'ts' || lang === 'tsx' ? 'typescript' : 'javascript'
  }
  if (openingTag.startsWith('<style')) {
    return lang === 'scss' || lang === 'less' ? lang : 'css'
  }

  return 'xml'
}

// A single-file component puts its <template>, <script> and <style> blocks at the start of a line; a <template> nested
// inside the template is indented, so only the blocks opened at column 0 switch the language.
export function vueLanguagesByLineNumber(content: string): string[] {
  const languages = ['xml']
  let blockLanguage: string | null = null
  for (const line of content.split('\n')) {
    const opening = line.match(/^<(template|script|style)\b[^>]*>?/)
    const closing = line.match(/^<\/(template|script|style)>/)
    if (blockLanguage === null && opening) {
      languages.push('xml')
      const isClosedOnSameLine = line.includes(`</${opening[1]}>`)
      blockLanguage = isClosedOnSameLine ? null : languageOfVueBlock(opening[0])
    } else if (blockLanguage !== null && closing) {
      languages.push('xml')
      blockLanguage = null
    } else {
      languages.push(blockLanguage ?? 'xml')
    }
  }

  return languages
}

export function withVueLanguages(rows: DiffRow[], oldContent: string, newContent: string): DiffRow[] {
  const oldLanguages = vueLanguagesByLineNumber(oldContent)
  const newLanguages = vueLanguagesByLineNumber(newContent)

  return rows.map(row => {
    if (row.kind === 'hunk') {
      return row
    }
    const language = row.kind === 'removed' ? oldLanguages[row.oldNumber ?? 0] : newLanguages[row.newNumber ?? 0]

    return { ...row, language: language ?? 'xml' }
  })
}
