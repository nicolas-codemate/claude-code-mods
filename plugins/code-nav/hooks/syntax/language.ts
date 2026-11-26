// The family a file is read as: php, script (TypeScript and JavaScript), vue, markup (HTML, XML, Twig), data (JSON,
// YAML, TOML, INI), shell (shell scripts, Dockerfile, Makefile), clike (any language with "//" and "/* */" comments),
// plain (everything else: names and numbers only).
export type SourceLanguage = 'php' | 'script' | 'vue' | 'markup' | 'data' | 'shell' | 'clike' | 'plain'

type KeysByLanguage = Readonly<Record<SourceLanguage, readonly string[]>>

const EXTENSIONS_BY_LANGUAGE: KeysByLanguage = {
  php: ['php', 'phtml', 'inc'],
  script: ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs'],
  vue: ['vue'],
  markup: ['html', 'htm', 'xhtml', 'xml', 'xsd', 'xsl', 'xlf', 'xliff', 'svg', 'twig'],
  data: [
    'json', 'jsonc', 'json5', 'webmanifest', 'yaml', 'yml', 'neon', 'toml', 'ini', 'conf', 'cfg', 'properties', 'env',
  ],
  shell: ['sh', 'bash', 'zsh', 'mk', 'dockerfile'],
  clike: [
    'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'java', 'kt', 'kts', 'go', 'rs', 'swift', 'scala', 'dart', 'groovy', 'gradle',
    'proto', 'css', 'scss', 'less',
  ],
  plain: [],
}

const FILE_NAMES_BY_LANGUAGE: KeysByLanguage = {
  php: [],
  script: [],
  vue: [],
  markup: [],
  data: ['composer.lock', 'symfony.lock', '.editorconfig', '.gitconfig', '.npmrc'],
  shell: ['dockerfile', 'makefile', 'gnumakefile', '.bashrc', '.zshrc', '.profile'],
  clike: ['jenkinsfile'],
  plain: [],
}

function languageByKey(keysByLanguage: KeysByLanguage): Map<string, SourceLanguage> {
  const languageOfKey = new Map<string, SourceLanguage>()
  for (const [language, keys] of Object.entries(keysByLanguage) as [SourceLanguage, readonly string[]][]) {
    for (const key of keys) {
      languageOfKey.set(key, language)
    }
  }

  return languageOfKey
}

const LANGUAGE_BY_EXTENSION = languageByKey(EXTENSIONS_BY_LANGUAGE)
const LANGUAGE_BY_FILE_NAME = languageByKey(FILE_NAMES_BY_LANGUAGE)

const SUFFIX_OF_A_COPY_KEPT_ASIDE = /\.(dist|example|sample|local|bak)$/

// The name of the file in lowercase, without its folders.
export function fileNameOfPath(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).toLowerCase()
}

// The lowercase extension, the suffix of a copy kept aside left out: "phpunit.xml.dist" has the extension "xml".
export function extensionOfPath(path: string): string {
  const fileName = fileNameOfPath(path).replace(SUFFIX_OF_A_COPY_KEPT_ASIDE, '')
  const dotOffset = fileName.lastIndexOf('.')

  return dotOffset <= 0 ? '' : fileName.slice(dotOffset + 1)
}

export function languageOfPath(path: string): SourceLanguage {
  const fileName = fileNameOfPath(path)
  if (fileName.startsWith('.env')) {
    return 'data'
  }
  if (fileName.startsWith('dockerfile.')) {
    return 'shell'
  }

  return LANGUAGE_BY_FILE_NAME.get(fileName) ?? LANGUAGE_BY_EXTENSION.get(extensionOfPath(path)) ?? 'plain'
}
