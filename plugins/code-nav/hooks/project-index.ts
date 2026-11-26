import type { SymbolEntry, SymbolKind } from '../types'
import { CLASS_LIKE_KINDS } from './symbol-names'
import type { ClassLikeKind } from './symbol-names'


// What one printed keyword declares. A class-like opens a container for the indented declarations below it; any other
// keyword declares a member when it stands indented under a class-like listed in memberKindByClassLike, and a
// declaration of its own otherwise (dropped when standaloneKind is null).
type DeclarationReading =
  | { classLikeKind: ClassLikeKind }
  | { standaloneKind: SymbolKind | null; memberKindByClassLike: Partial<Record<ClassLikeKind, SymbolKind>> }

// A search prints one line per declaration, "<line number>:<indentation><keyword> <name>": the indentation is one
// whitespace character when the declaration does not start its line, nothing otherwise; the keyword is one key of
// readingByKeyword. The pattern's capture groups, pasted together by the replacement, produce that line.
type LanguageDeclarations = {
  globs: readonly string[]
  pattern: string
  replacement: string
  readingByKeyword: Readonly<Record<string, DeclarationReading>>
  // Words the pattern cannot tell apart from a name: a control statement written like a method.
  wordsThatAreNotNames: readonly string[]
}

function memberOfEvery(memberKind: SymbolKind): Partial<Record<ClassLikeKind, SymbolKind>> {
  return Object.fromEntries(CLASS_LIKE_KINDS.map(classLikeKind => [classLikeKind, memberKind]))
}

const PHP_MODIFIERS = String.raw`(?:(?:abstract|final|readonly|public|protected|private|static)\s+)*`

const PHP_DECLARATIONS: LanguageDeclarations = {
  globs: ['*.php'],
  pattern:
    String.raw`^(\s?)\s*${PHP_MODIFIERS}(?:` +
    [
      String.raw`(class|interface|trait|enum)\s+(\w+)`,
      String.raw`(function)\s+&?\s*(\w+)\s*\(`,
      String.raw`(const)\s+(?:[^\s=]+\s+)?(\w+)\s*=`,
      // An enum case ends on "=" or ";", a case of a switch on ":".
      String.raw`(case)\s+(\w+)\s*[=;]`,
    ].join('|') +
    ')',
  replacement: '$1$2$4$6$8 $3$5$7$9',
  readingByKeyword: {
    class: { classLikeKind: 'class' },
    interface: { classLikeKind: 'interface' },
    trait: { classLikeKind: 'trait' },
    enum: { classLikeKind: 'enum' },
    function: { standaloneKind: 'function', memberKindByClassLike: memberOfEvery('method') },
    const: { standaloneKind: 'constant', memberKindByClassLike: memberOfEvery('constant') },
    case: { standaloneKind: null, memberKindByClassLike: { enum: 'constant' } },
  },
  wordsThatAreNotNames: [],
}

const SCRIPT_DECLARATION_MODIFIERS = String.raw`(?:(?:export|default|declare|abstract|async|const)\s+)*`
const SCRIPT_METHOD_MODIFIERS = String.raw`(?:(?:public|private|protected|static|override|abstract|async|get|set)\s+)+\*?`
const SCRIPT_TYPE_PARAMETERS = String.raw`(?:<[^>()=]*>\s*)?`
// A parameter list closed on its own line, one pair of parentheses deep at most inside it.
const SCRIPT_PARAMETERS = String.raw`\((?:[^()]|\([^()]*\))*\)`
// What follows "=" when a variable holds a function: "function", "name =>", "(a, b) =>", or a parameter list left
// open at the end of the line.
const SCRIPT_FUNCTION_VALUE =
  String.raw`(?:async\s+)?(?:function\b|\w+\s*=>|${SCRIPT_TYPE_PARAMETERS}\((?:[^()]|\([^()]*\))*(?:\)\s*(?::[^=]+)?=>|$))`

const SCRIPT_DECLARATIONS: LanguageDeclarations = {
  globs: ['*.ts', '*.tsx', '*.js', '*.jsx', '*.mjs', '*.vue'],
  pattern:
    '^(?:' +
    [
      String.raw`(\s?)\s*${SCRIPT_DECLARATION_MODIFIERS}(?:(class|interface|enum)\s+(\w+)|(type)\s+(\w+)\s*[=<]|(function)\s*\*?\s*(\w+)\s*[(<])`,
      // A variable is listed when it is exported or starts its line: a local of a function body is neither.
      String.raw`(?:(\s)\s*export\s+|(?:export\s+)?)(?:declare\s+)?(const|let|var)\s+(\w+)(?:\s*(?::[^=]+)?(=)\s*${SCRIPT_FUNCTION_VALUE})?`,
      // A method: led by a modifier, or a name whose parameter list is followed by a body opened on the same line.
      String.raw`(\s)\s*(?:${SCRIPT_METHOD_MODIFIERS}(\w+)\s*${SCRIPT_TYPE_PARAMETERS}\(|(\w+)\s*${SCRIPT_TYPE_PARAMETERS}${SCRIPT_PARAMETERS}\s*(?::.+)?\{\s*$)`,
      // A method signature of an interface: no body, a return type.
      String.raw`(\s)\s*(\w+)\s*${SCRIPT_TYPE_PARAMETERS}${SCRIPT_PARAMETERS}\s*(:)\s*[^;{]*[^;{\s];?\s*$`,
    ].join('|') +
    ')',
  replacement: '$1$8$12$15$2$4$6$9$11$17 $3$5$7$10$13$14$16',
  readingByKeyword: {
    class: { classLikeKind: 'class' },
    interface: { classLikeKind: 'interface' },
    enum: { classLikeKind: 'enum' },
    type: { standaloneKind: 'type', memberKindByClassLike: {} },
    function: { standaloneKind: 'function', memberKindByClassLike: {} },
    const: { standaloneKind: 'constant', memberKindByClassLike: {} },
    let: { standaloneKind: 'variable', memberKindByClassLike: {} },
    var: { standaloneKind: 'variable', memberKindByClassLike: {} },
    'const=': { standaloneKind: 'function', memberKindByClassLike: {} },
    'let=': { standaloneKind: 'function', memberKindByClassLike: {} },
    'var=': { standaloneKind: 'function', memberKindByClassLike: {} },
    // No keyword: a method. Outside a class it is dropped, a field of a GraphQL query in a template string being
    // written the same way.
    '': { standaloneKind: null, memberKindByClassLike: { class: 'method', interface: 'method' } },
    ':': { standaloneKind: null, memberKindByClassLike: { interface: 'method' } },
  },
  wordsThatAreNotNames: ['if', 'for', 'while', 'switch', 'catch', 'with', 'function', 'return'],
}

const LANGUAGE_DECLARATIONS = {
  php: PHP_DECLARATIONS,
  script: SCRIPT_DECLARATIONS,
} satisfies Record<string, LanguageDeclarations>

export type IndexedLanguage = keyof typeof LANGUAGE_DECLARATIONS

const SEARCHED_DIRECTORY = './'

// The ripgrep invocations that list every declaration of the project: argv is what follows `rg` on the command line,
// run from the project root. What git ignores is left out, which is what keeps the dependencies out of the index.
export function declarationSearches(): readonly { language: IndexedLanguage; argv: readonly string[] }[] {
  return (Object.keys(LANGUAGE_DECLARATIONS) as IndexedLanguage[]).map(language => {
    const declarations: LanguageDeclarations = LANGUAGE_DECLARATIONS[language]

    return {
      language,
      argv: [
        '--no-config',
        // Names are read as ASCII words, which halves the time of the search.
        '--no-unicode',
        '--color=never',
        '--heading',
        '--line-number',
        '--no-column',
        '--only-matching',
        '--replace',
        declarations.replacement,
        '--regexp',
        declarations.pattern,
        ...declarations.globs.flatMap(glob => ['--glob', glob]),
        // Without a directory, ripgrep reads its standard input whenever that is not a terminal.
        SEARCHED_DIRECTORY,
      ],
    }
  })
}

const CARRIAGE_RETURN = 13
const SPACE = 32
const DIGIT_ZERO = 48

// Reads one invocation's standard output into declarations: a path on its own line, then its declarations, then a
// blank line. Members get their container: the class-like declared above them in the same file, until a declaration
// that starts its line closes it.
export function parseDeclarationSearchOutput(language: IndexedLanguage, output: string): SymbolEntry[] {
  const declarations: LanguageDeclarations = LANGUAGE_DECLARATIONS[language]
  const readingByKeyword = new Map(Object.entries(declarations.readingByKeyword))
  const wordsThatAreNotNames = new Set(declarations.wordsThatAreNotNames)
  const symbols: SymbolEntry[] = []
  let path: string | null = null
  let openClassLike: { name: string; kind: ClassLikeKind } | null = null

  for (let lineStart = 0; lineStart < output.length; ) {
    const nextLineFeed = output.indexOf('\n', lineStart)
    const afterLine = nextLineFeed === -1 ? output.length : nextLineFeed
    const lineEnd = afterLine > lineStart && output.charCodeAt(afterLine - 1) === CARRIAGE_RETURN ? afterLine - 1 : afterLine
    const printedStart = lineStart
    lineStart = afterLine + 1
    if (lineEnd === printedStart) {
      path = null
      continue
    }
    if (path === null) {
      const pathStart = output.startsWith(SEARCHED_DIRECTORY, printedStart) ? printedStart + SEARCHED_DIRECTORY.length : printedStart
      path = output.slice(pathStart, lineEnd)
      openClassLike = null
      continue
    }
    const lineNumberEnd = output.indexOf(':', printedStart)
    const nameStart = output.lastIndexOf(' ', lineEnd - 1) + 1
    if (lineNumberEnd === -1 || lineNumberEnd >= nameStart || nameStart >= lineEnd) {
      continue
    }
    const isIndented = output.charCodeAt(lineNumberEnd + 1) <= SPACE && lineNumberEnd + 2 < nameStart
    const reading = readingByKeyword.get(output.slice(lineNumberEnd + (isIndented ? 2 : 1), nameStart - 1))
    const name = output.slice(nameStart, lineEnd)
    if (!reading || wordsThatAreNotNames.has(name)) {
      continue
    }
    let line = 0
    for (let digitIndex = printedStart; digitIndex < lineNumberEnd; digitIndex++) {
      line = line * 10 + output.charCodeAt(digitIndex) - DIGIT_ZERO
    }
    if ('classLikeKind' in reading) {
      symbols.push({ name, kind: reading.classLikeKind, path, line, container: null })
      openClassLike = { name, kind: reading.classLikeKind }
      continue
    }
    const memberKind = isIndented && openClassLike ? reading.memberKindByClassLike[openClassLike.kind] : undefined
    if (memberKind && openClassLike) {
      symbols.push({ name, kind: memberKind, path, line, container: openClassLike.name })
    } else if (reading.standaloneKind) {
      symbols.push({ name, kind: reading.standaloneKind, path, line, container: null })
      if (!isIndented) {
        openClassLike = null
      }
    }
  }

  return symbols
}
