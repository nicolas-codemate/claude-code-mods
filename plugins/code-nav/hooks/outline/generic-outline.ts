import type { SymbolEntry } from '../../types'
import {
  ANY_LANGUAGE,
  C_FAMILY,
  CSHARP,
  DART,
  ELIXIR,
  GO,
  JAVA,
  KOTLIN,
  LUA,
  PERL,
  PYTHON,
  RUBY,
  RUST,
  SCALA,
  SHELL,
  SWIFT,
} from './code-languages'
import { codeSymbolsOfText } from './code-outline'
import {
  asciidocSymbols,
  dockerfileSymbols,
  environmentSymbols,
  iniSymbols,
  makefileSymbols,
  markdownSymbols,
  markupSymbols,
  sqlSymbols,
  templateSymbols,
  yamlSymbols,
} from './document-outline'
import { MAXIMUM_OUTLINE_ENTRIES } from './outline-lines'
import { jsonSymbols, stylesheetSymbols } from './structured-outline'

type OutlineFormat =
  | 'python'
  | 'go'
  | 'rust'
  | 'java'
  | 'csharp'
  | 'kotlin'
  | 'scala'
  | 'swift'
  | 'dart'
  | 'cFamily'
  | 'ruby'
  | 'elixir'
  | 'lua'
  | 'shell'
  | 'perl'
  | 'markdown'
  | 'asciidoc'
  | 'yaml'
  | 'ini'
  | 'json'
  | 'css'
  | 'scss'
  | 'sql'
  | 'makefile'
  | 'dockerfile'
  | 'template'
  | 'markup'
  | 'html'
  | 'environment'
  | 'plainText'
  | 'unknown'

const SYMBOLS_BY_FORMAT: Record<OutlineFormat, (path: string, text: string) => SymbolEntry[]> = {
  python: (path, text) => codeSymbolsOfText(path, text, PYTHON),
  go: (path, text) => codeSymbolsOfText(path, text, GO),
  rust: (path, text) => codeSymbolsOfText(path, text, RUST),
  java: (path, text) => codeSymbolsOfText(path, text, JAVA),
  csharp: (path, text) => codeSymbolsOfText(path, text, CSHARP),
  kotlin: (path, text) => codeSymbolsOfText(path, text, KOTLIN),
  scala: (path, text) => codeSymbolsOfText(path, text, SCALA),
  swift: (path, text) => codeSymbolsOfText(path, text, SWIFT),
  dart: (path, text) => codeSymbolsOfText(path, text, DART),
  cFamily: (path, text) => codeSymbolsOfText(path, text, C_FAMILY),
  ruby: (path, text) => codeSymbolsOfText(path, text, RUBY),
  elixir: (path, text) => codeSymbolsOfText(path, text, ELIXIR),
  lua: (path, text) => codeSymbolsOfText(path, text, LUA),
  shell: (path, text) => codeSymbolsOfText(path, text, SHELL),
  perl: (path, text) => codeSymbolsOfText(path, text, PERL),
  markdown: markdownSymbols,
  asciidoc: asciidocSymbols,
  yaml: yamlSymbols,
  ini: iniSymbols,
  json: jsonSymbols,
  css: (path, text) => stylesheetSymbols(path, text, false),
  scss: (path, text) => stylesheetSymbols(path, text, true),
  sql: sqlSymbols,
  makefile: makefileSymbols,
  dockerfile: dockerfileSymbols,
  template: templateSymbols,
  markup: markupSymbols,
  // A page of a Django or Jinja project carries its blocks in the .html file itself.
  html: (path, text) => [...templateSymbols(path, text), ...markupSymbols(path, text)],
  environment: environmentSymbols,
  plainText: () => [],
  unknown: (path, text) => codeSymbolsOfText(path, text, ANY_LANGUAGE),
}

const FORMAT_BY_EXTENSION: Readonly<Record<string, OutlineFormat>> = {
  py: 'python',
  pyi: 'python',
  pyw: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  groovy: 'java',
  gradle: 'java',
  cs: 'csharp',
  kt: 'kotlin',
  kts: 'kotlin',
  scala: 'scala',
  sc: 'scala',
  swift: 'swift',
  dart: 'dart',
  c: 'cFamily',
  h: 'cFamily',
  cc: 'cFamily',
  cpp: 'cFamily',
  cxx: 'cFamily',
  'c++': 'cFamily',
  hh: 'cFamily',
  hpp: 'cFamily',
  hxx: 'cFamily',
  ino: 'cFamily',
  m: 'cFamily',
  mm: 'cFamily',
  rb: 'ruby',
  rake: 'ruby',
  gemspec: 'ruby',
  ru: 'ruby',
  ex: 'elixir',
  exs: 'elixir',
  lua: 'lua',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  ksh: 'shell',
  fish: 'shell',
  pl: 'perl',
  pm: 'perl',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  adoc: 'asciidoc',
  asciidoc: 'asciidoc',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  editorconfig: 'ini',
  gitconfig: 'ini',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  geojson: 'json',
  webmanifest: 'json',
  lock: 'json',
  css: 'css',
  pcss: 'css',
  scss: 'scss',
  less: 'scss',
  sql: 'sql',
  mk: 'makefile',
  make: 'makefile',
  dockerfile: 'dockerfile',
  containerfile: 'dockerfile',
  twig: 'template',
  jinja: 'template',
  jinja2: 'template',
  j2: 'template',
  njk: 'template',
  html: 'html',
  htm: 'html',
  xhtml: 'markup',
  xml: 'markup',
  svg: 'markup',
  xsd: 'markup',
  xsl: 'markup',
  xslt: 'markup',
  plist: 'markup',
  xaml: 'markup',
  env: 'environment',
  properties: 'environment',
  txt: 'plainText',
  text: 'plainText',
  log: 'plainText',
  csv: 'plainText',
  tsv: 'plainText',
}

const FORMAT_BY_FILE_NAME: Readonly<Record<string, OutlineFormat>> = {
  makefile: 'makefile',
  gnumakefile: 'makefile',
  dockerfile: 'dockerfile',
  containerfile: 'dockerfile',
  rakefile: 'ruby',
  gemfile: 'ruby',
  guardfile: 'ruby',
  podfile: 'ruby',
  vagrantfile: 'ruby',
  '.bashrc': 'shell',
  '.bash_profile': 'shell',
  '.zshrc': 'shell',
  '.zprofile': 'shell',
  '.profile': 'shell',
  '.env': 'environment',
  '.gitconfig': 'ini',
  '.editorconfig': 'ini',
  '.babelrc': 'json',
  '.eslintrc': 'json',
  license: 'plainText',
  'cargo.lock': 'ini',
  'poetry.lock': 'ini',
}

function formatOfPath(path: string): OutlineFormat {
  const fileName = (path.split('/').at(-1) ?? path).toLowerCase()
  const formatOfFileName = FORMAT_BY_FILE_NAME[fileName]
  if (formatOfFileName !== undefined) {
    return formatOfFileName
  }
  if (fileName.startsWith('.env.')) {
    return 'environment'
  }
  const dotIndex = fileName.lastIndexOf('.')
  const formatOfExtension = dotIndex === -1 ? undefined : FORMAT_BY_EXTENSION[fileName.slice(dotIndex + 1)]
  if (formatOfExtension !== undefined) {
    return formatOfExtension
  }

  // "Dockerfile.prod", "Makefile.common": the name before the first dot says what the file is.
  return FORMAT_BY_FILE_NAME[fileName.split('.')[0] ?? ''] ?? 'unknown'
}

// The declarations of a file in any language, found line by line by the shapes its format
// declares them with, ranked by line.
export function genericSymbolsOfFile(path: string, text: string): SymbolEntry[] {
  const symbols = SYMBOLS_BY_FORMAT[formatOfPath(path)](path, text)

  return symbols.sort((first, second) => first.line - second.line).slice(0, MAXIMUM_OUTLINE_ENTRIES)
}
