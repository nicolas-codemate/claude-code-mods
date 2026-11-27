import type { SymbolKind } from '../../types'
import type { CodeDeclarationRule, CodeLanguage, RulePlacement, ScopeOpening } from './code-outline'

function declaration(
  pattern: RegExp,
  kind: SymbolKind | null,
  opens: ScopeOpening,
  placement: RulePlacement = 'anywhere',
): CodeDeclarationRule {
  return { pattern, kind, opens, placement }
}

function callable(pattern: RegExp, placement: RulePlacement = 'anywhere'): CodeDeclarationRule {
  return { pattern, kind: 'function', kindInsideMembersHolder: 'method', opens: 'plainScope', placement }
}

function member(pattern: RegExp, kind: SymbolKind, opens: ScopeOpening = 'plainScope'): CodeDeclarationRule {
  return { pattern, kind, opens, placement: 'membersHolderBody' }
}

// A bracket closing a signature or a literal written over several lines, or a brace opened on its own line.
const BRACKET_LINES = /^(?:[)\]]|\{\s*$)/

const CONTROL_WORDS = ['if', 'else', 'for', 'foreach', 'while', 'do', 'switch', 'case', 'catch', 'try', 'return', 'new', 'throw', 'yield', 'await', 'when', 'using', 'lock', 'synchronized', 'sizeof', 'defined', 'match']

const C_LIKE_COMMENTS = { lineCommentPrefixes: ['//', '*'], blockComment: { open: '/*', close: '*/' }, hasTripleQuotedStrings: false }

// A method of a class body: modifiers and a return type, then the name and its parameter list.
const TYPED_MEMBER_METHOD = /^\s+(?:@\w+(?:\([^)]*\))?\s+)*(?:[\w$]+(?:<[^()]*?>)?(?:\[\])*[?*&]*\s+)+(?<name>[\w$]+)\s*(?:<[^()]*>\s*)?\(/
// A constructor written without modifiers: a capitalized name, its parameters and a body.
const CONSTRUCTOR_WITHOUT_MODIFIERS = /^\s+(?<name>[A-Z]\w*)\s*\([^;]*\)\s*(?:throws[^{]*)?\{/

export const PYTHON: CodeLanguage = {
  rules: [
    declaration(/^\s*class\s+(?<name>\w+)/, 'class', 'membersHolder'),
    callable(/^\s*(?:async\s+)?def\s+(?<name>\w+)/),
    declaration(/^type\s+(?<name>\w+)\s*(?:\[[^\]]*\])?\s*=/, 'type', 'none', 'topLevel'),
    declaration(/^(?<name>[A-Z][A-Z0-9_]*)\s*(?::[^=]*)?=(?!=)/, 'constant', 'none', 'topLevel'),
  ],
  lineCommentPrefixes: ['#'],
  blockComment: null,
  hasTripleQuotedStrings: true,
  linesKeepingScopes: BRACKET_LINES,
  wordsThatAreNotNames: [],
}

const GO_TYPE_PARAMETERS = String.raw`(?:\[[^\]]*\])?`

export const GO: CodeLanguage = {
  rules: [
    declaration(new RegExp(String.raw`^func\s*\(\s*(?:\w+\s+)?\*?\s*(?<container>\w+)${GO_TYPE_PARAMETERS}\s*\)\s*(?<name>\w+)`), 'method', 'plainScope'),
    callable(/^func\s+(?<name>\w+)/),
    declaration(new RegExp(String.raw`^type\s+(?<name>\w+)${GO_TYPE_PARAMETERS}\s+struct\b`), 'class', 'membersHolder'),
    declaration(new RegExp(String.raw`^type\s+(?<name>\w+)${GO_TYPE_PARAMETERS}\s+interface\b`), 'interface', 'membersHolder'),
    declaration(/^type\s+(?<name>\w+)/, 'type', 'none'),
    declaration(/^const\s+(?<name>\w+)/, 'constant', 'none'),
    declaration(/^var\s+(?<name>\w+)/, 'variable', 'none'),
    member(/^\s+(?<name>[A-Za-z_]\w*)\s*\(/, 'method', 'none'),
  ],
  ...C_LIKE_COMMENTS,
  linesKeepingScopes: BRACKET_LINES,
  wordsThatAreNotNames: [],
}

const RUST_VISIBILITY = String.raw`(?:pub(?:\([^)]*\))?\s+)?`

export const RUST: CodeLanguage = {
  rules: [
    declaration(/^\s*(?:unsafe\s+)?impl\b(?:\s*<[^{]*?>)?\s+(?:[^{]*?\s+for\s+)?&?\s*(?:\w+::)*(?<name>\w+)/, null, 'membersHolder'),
    callable(new RegExp(String.raw`^\s*${RUST_VISIBILITY}(?:(?:default|const|async|unsafe|extern(?:\s+"[^"]*")?)\s+)*fn\s+(?<name>\w+)`)),
    declaration(new RegExp(String.raw`^\s*${RUST_VISIBILITY}(?:struct|union)\s+(?<name>\w+)`), 'class', 'none'),
    declaration(new RegExp(String.raw`^\s*${RUST_VISIBILITY}enum\s+(?<name>\w+)`), 'enum', 'none'),
    declaration(new RegExp(String.raw`^\s*${RUST_VISIBILITY}(?:unsafe\s+)?trait\s+(?<name>\w+)`), 'trait', 'membersHolder'),
    declaration(new RegExp(String.raw`^\s*${RUST_VISIBILITY}mod\s+(?<name>\w+)`), 'class', 'plainScope'),
    declaration(new RegExp(String.raw`^\s*${RUST_VISIBILITY}type\s+(?<name>\w+)`), 'type', 'none'),
    declaration(new RegExp(String.raw`^\s*${RUST_VISIBILITY}(?:const|static)\s+(?:mut\s+)?(?<name>\w+)\s*:`), 'constant', 'none'),
    declaration(/^\s*macro_rules!\s*(?<name>\w+)/, 'function', 'plainScope'),
  ],
  ...C_LIKE_COMMENTS,
  linesKeepingScopes: BRACKET_LINES,
  wordsThatAreNotNames: [],
}

const JAVA_MODIFIERS = String.raw`(?:(?:public|protected|private|abstract|static|final|sealed|non-sealed|strictfp)\s+)*`

export const JAVA: CodeLanguage = {
  rules: [
    declaration(new RegExp(String.raw`^\s*${JAVA_MODIFIERS}@interface\s+(?<name>\w+)`), 'interface', 'membersHolder'),
    declaration(new RegExp(String.raw`^\s*${JAVA_MODIFIERS}class\s+(?<name>\w+)`), 'class', 'membersHolder'),
    declaration(new RegExp(String.raw`^\s*${JAVA_MODIFIERS}interface\s+(?<name>\w+)`), 'interface', 'membersHolder'),
    declaration(new RegExp(String.raw`^\s*${JAVA_MODIFIERS}enum\s+(?<name>\w+)`), 'enum', 'membersHolder'),
    declaration(new RegExp(String.raw`^\s*${JAVA_MODIFIERS}record\s+(?<name>\w+)`), 'class', 'membersHolder'),
    member(/^\s+(?:(?:public|protected|private)\s+)?(?:static\s+final|final\s+static)\s+[\w<>[\], ?]+?\s+(?<name>[A-Z][A-Z0-9_]*)\s*=/, 'constant', 'none'),
    member(TYPED_MEMBER_METHOD, 'method'),
    member(CONSTRUCTOR_WITHOUT_MODIFIERS, 'method'),
  ],
  ...C_LIKE_COMMENTS,
  linesKeepingScopes: BRACKET_LINES,
  wordsThatAreNotNames: CONTROL_WORDS,
}

const CSHARP_MODIFIERS = String.raw`(?:(?:public|private|protected|internal|static|abstract|sealed|partial|readonly|unsafe|new|file|ref|virtual|override|async|extern)\s+)*`

export const CSHARP: CodeLanguage = {
  rules: [
    declaration(/^\s*namespace\s+(?<name>[\w.]+)/, 'class', 'plainScope'),
    declaration(new RegExp(String.raw`^\s*${CSHARP_MODIFIERS}(?:class|struct|record(?:\s+(?:struct|class))?)\s+(?<name>\w+)`), 'class', 'membersHolder'),
    declaration(new RegExp(String.raw`^\s*${CSHARP_MODIFIERS}interface\s+(?<name>\w+)`), 'interface', 'membersHolder'),
    declaration(new RegExp(String.raw`^\s*${CSHARP_MODIFIERS}enum\s+(?<name>\w+)`), 'enum', 'membersHolder'),
    member(new RegExp(String.raw`^\s+${CSHARP_MODIFIERS}const\s+\S+\s+(?<name>\w+)\s*=`), 'constant', 'none'),
    member(TYPED_MEMBER_METHOD, 'method'),
    member(CONSTRUCTOR_WITHOUT_MODIFIERS, 'method'),
    member(new RegExp(String.raw`^\s+${CSHARP_MODIFIERS}[\w<>[\],.?]+\s+(?<name>\w+)\s*(?:\{\s*(?:get|set|init)\b|=>)`), 'property', 'none'),
  ],
  ...C_LIKE_COMMENTS,
  linesKeepingScopes: BRACKET_LINES,
  wordsThatAreNotNames: CONTROL_WORDS,
}

const KOTLIN_MODIFIERS = String.raw`(?:(?:public|private|internal|protected|open|abstract|sealed|data|inner|value|final|override|expect|actual|annotation|companion|inline|suspend|tailrec|operator|infix|external|lateinit)\s+)*`

export const KOTLIN: CodeLanguage = {
  rules: [
    declaration(new RegExp(String.raw`^\s*${KOTLIN_MODIFIERS}enum\s+class\s+(?<name>\w+)`), 'enum', 'membersHolder'),
    declaration(new RegExp(String.raw`^\s*${KOTLIN_MODIFIERS}(?:fun\s+)?interface\s+(?<name>\w+)`), 'interface', 'membersHolder'),
    declaration(new RegExp(String.raw`^\s*${KOTLIN_MODIFIERS}(?:class|object)\s+(?<name>\w+)`), 'class', 'membersHolder'),
    callable(new RegExp(String.raw`^\s*${KOTLIN_MODIFIERS}fun\s+(?:<[^>]*>\s*)?(?:[\w.<>?]+\.)?(?<name>\w+)\s*\(`)),
    declaration(/^\s*(?:(?:public|private|internal)\s+)?typealias\s+(?<name>\w+)/, 'type', 'none'),
    declaration(/^\s*(?:(?:public|private|internal)\s+)?const\s+val\s+(?<name>\w+)/, 'constant', 'none'),
  ],
  ...C_LIKE_COMMENTS,
  linesKeepingScopes: BRACKET_LINES,
  wordsThatAreNotNames: [],
}

const SCALA_MODIFIERS = String.raw`(?:(?:private|protected|abstract|final|sealed|case|implicit|lazy|override|inline|open|transparent)(?:\[[^\]]*\])?\s+)*`

export const SCALA: CodeLanguage = {
  rules: [
    declaration(new RegExp(String.raw`^\s*${SCALA_MODIFIERS}(?:class|object)\s+(?<name>\w+)`), 'class', 'membersHolder'),
    declaration(new RegExp(String.raw`^\s*${SCALA_MODIFIERS}trait\s+(?<name>\w+)`), 'trait', 'membersHolder'),
    declaration(new RegExp(String.raw`^\s*${SCALA_MODIFIERS}enum\s+(?<name>\w+)`), 'enum', 'membersHolder'),
    callable(new RegExp(String.raw`^\s*${SCALA_MODIFIERS}def\s+(?<name>[\w$]+)`)),
    declaration(new RegExp(String.raw`^\s*${SCALA_MODIFIERS}type\s+(?<name>\w+)`), 'type', 'none'),
  ],
  ...C_LIKE_COMMENTS,
  linesKeepingScopes: BRACKET_LINES,
  wordsThatAreNotNames: [],
}

const SWIFT_MODIFIERS = String.raw`(?:(?:public|private|fileprivate|internal|open|final|static|class|override|mutating|nonmutating|convenience|required|indirect|nonisolated|@\w+(?:\([^)]*\))?)\s+)*`

export const SWIFT: CodeLanguage = {
  rules: [
    declaration(new RegExp(String.raw`^\s*${SWIFT_MODIFIERS}(?:class|struct|actor)\s+(?<name>\w+)`), 'class', 'membersHolder'),
    declaration(new RegExp(String.raw`^\s*${SWIFT_MODIFIERS}protocol\s+(?<name>\w+)`), 'interface', 'membersHolder'),
    declaration(new RegExp(String.raw`^\s*${SWIFT_MODIFIERS}enum\s+(?<name>\w+)`), 'enum', 'membersHolder'),
    declaration(new RegExp(String.raw`^\s*${SWIFT_MODIFIERS}extension\s+(?<name>[\w.]+)`), 'class', 'membersHolder'),
    callable(new RegExp(String.raw`^\s*${SWIFT_MODIFIERS}func\s+(?<name>\w+)`)),
    member(new RegExp(String.raw`^\s+${SWIFT_MODIFIERS}(?<name>init|deinit)\b[?!]?\s*[({<]`), 'method'),
    declaration(new RegExp(String.raw`^\s*${SWIFT_MODIFIERS}typealias\s+(?<name>\w+)`), 'type', 'none'),
  ],
  ...C_LIKE_COMMENTS,
  linesKeepingScopes: BRACKET_LINES,
  wordsThatAreNotNames: ['func', 'var', 'let'],
}

export const DART: CodeLanguage = {
  rules: [
    declaration(/^\s*(?:(?:abstract|base|final|interface|sealed|mixin)\s+)*class\s+(?<name>\w+)/, 'class', 'membersHolder'),
    declaration(/^\s*(?:base\s+)?mixin\s+(?<name>\w+)/, 'trait', 'membersHolder'),
    declaration(/^\s*enum\s+(?<name>\w+)/, 'enum', 'membersHolder'),
    declaration(/^\s*extension\s+(?<name>\w+)(?:<[^>]*>)?\s+on\b/, 'class', 'membersHolder'),
    declaration(/^\s*typedef\s+(?<name>\w+)/, 'type', 'none'),
    declaration(/^(?:const|final)\s+(?:[\w<>?]+\s+)?(?<name>\w+)\s*=/, 'constant', 'none', 'topLevel'),
    callable(/^(?:[\w<>?,[\]]+\s+)*?(?<name>\w+)\s*(?:<[^>]*>)?\([^;]*$/, 'topLevel'),
    member(/^\s+(?:static\s+)?(?:[\w<>?,]+\s+)?(?:get|set)\s+(?<name>\w+)/, 'method'),
    member(TYPED_MEMBER_METHOD, 'method'),
    member(CONSTRUCTOR_WITHOUT_MODIFIERS, 'method'),
  ],
  ...C_LIKE_COMMENTS,
  linesKeepingScopes: BRACKET_LINES,
  wordsThatAreNotNames: CONTROL_WORDS,
}

export const C_FAMILY: CodeLanguage = {
  rules: [
    declaration(/^\s*(?:inline\s+)?namespace\s+(?<name>[\w:]+)\s*\{?\s*$/, 'class', 'plainScope'),
    declaration(/^\s*(?:typedef\s+)?(?:template\s*<.*>\s*)?(?:class|struct|union)\s+(?:\w+\s+)*?(?<name>\w+)\s*(?:final\s*)?(?::(?!:)[^;]*)?(?:\{.*)?$/, 'class', 'membersHolder'),
    declaration(/^\s*(?:typedef\s+)?enum\s+(?:class\s+|struct\s+)?(?<name>\w+)\s*(?::\s*[\w:]+\s*)?(?:\{.*)?$/, 'enum', 'none'),
    declaration(/^\s*typedef\s+.*?\b(?<name>\w+)\s*;\s*$/, 'type', 'none'),
    declaration(/^\s*using\s+(?<name>\w+)\s*=/, 'type', 'none'),
    declaration(/^(?<container>\w+)::(?<name>~?\w+)\s*\([^;]*$/, 'method', 'plainScope'),
    callable(/^(?:template\s*<.*>\s*)?(?:[\w:<>,*&~]+[\s*&]+)+?(?:(?<container>\w+)::)?(?<name>~?\w+)\s*\([^;]*$/),
    member(/^\s+(?:(?:virtual|static|inline|explicit|constexpr|friend)\s+)*(?:[\w:<>,]+[\s*&]+)+(?<name>~?\w+)\s*\(/, 'method'),
    member(/^\s+(?:explicit\s+)?(?<name>~?[A-Z]\w*)\s*\(/, 'method'),
  ],
  lineCommentPrefixes: ['//', '*', '#'],
  blockComment: { open: '/*', close: '*/' },
  hasTripleQuotedStrings: false,
  linesKeepingScopes: /^(?:[)\]]|\{\s*$|(?:public|private|protected|signals|slots|public\s+slots|private\s+slots|protected\s+slots)\s*:\s*$)/,
  wordsThatAreNotNames: CONTROL_WORDS,
}

export const RUBY: CodeLanguage = {
  rules: [
    declaration(/^\s*(?:class|module)\s+(?<name>[A-Z][\w:]*)/, 'class', 'membersHolder'),
    callable(/^\s*(?:(?:private|protected|public|module_function)\s+)?def\s+(?:self\.)?(?<name>\w+[?!=]?)/),
    declaration(/^\s*(?<name>[A-Z][A-Z0-9_]*)\s*=(?!=)/, 'constant', 'none'),
  ],
  lineCommentPrefixes: ['#'],
  blockComment: { open: '=begin', close: '=end' },
  hasTripleQuotedStrings: false,
  linesKeepingScopes: BRACKET_LINES,
  wordsThatAreNotNames: [],
}

export const ELIXIR: CodeLanguage = {
  rules: [
    declaration(/^\s*defmodule\s+(?<name>[\w.]+)/, 'class', 'membersHolder'),
    declaration(/^\s*defprotocol\s+(?<name>[\w.]+)/, 'interface', 'membersHolder'),
    declaration(/^\s*(?:def|defp|defmacro|defmacrop|defguard|defguardp|defdelegate)\s+(?<name>\w+[?!]?)/, 'function', 'plainScope'),
    declaration(/^\s*@(?:type|typep|opaque)\s+(?<name>\w+)/, 'type', 'none'),
  ],
  lineCommentPrefixes: ['#'],
  blockComment: null,
  hasTripleQuotedStrings: true,
  linesKeepingScopes: BRACKET_LINES,
  wordsThatAreNotNames: [],
}

export const LUA: CodeLanguage = {
  rules: [
    callable(/^\s*(?:local\s+)?function\s+(?:(?<container>[\w.]+)[.:])?(?<name>\w+)\s*\(/),
    declaration(/^\s*(?:local\s+)?(?<container>[\w.]+)[.:](?<name>\w+)\s*=\s*function\b/, 'method', 'plainScope'),
    declaration(/^\s*(?:local\s+)?(?<name>\w+)\s*=\s*function\b/, 'function', 'plainScope'),
  ],
  lineCommentPrefixes: ['--'],
  blockComment: { open: '--[[', close: ']]' },
  hasTripleQuotedStrings: false,
  linesKeepingScopes: BRACKET_LINES,
  wordsThatAreNotNames: [],
}

export const SHELL: CodeLanguage = {
  rules: [
    declaration(/^\s*(?:function\s+)?(?<name>[\w.:-]+)\s*\(\)/, 'function', 'plainScope'),
    declaration(/^\s*function\s+(?<name>[\w.:-]+)\s*(?:\{\s*)?$/, 'function', 'plainScope'),
  ],
  lineCommentPrefixes: ['#'],
  blockComment: null,
  hasTripleQuotedStrings: false,
  linesKeepingScopes: BRACKET_LINES,
  wordsThatAreNotNames: [],
}

export const PERL: CodeLanguage = {
  rules: [
    declaration(/^\s*package\s+(?<name>[\w:]+)/, 'class', 'plainScope'),
    declaration(/^\s*sub\s+(?<name>\w+)/, 'function', 'plainScope'),
  ],
  lineCommentPrefixes: ['#'],
  blockComment: { open: '=', close: '=cut' },
  hasTripleQuotedStrings: false,
  linesKeepingScopes: BRACKET_LINES,
  wordsThatAreNotNames: [],
}

const COMMON_MODIFIERS = String.raw`(?:(?:public|private|protected|internal|export|default|static|abstract|final|sealed|async|pub|open|data|case|inline|extern|virtual|override|local|global)\s+)*`

// The declaration shapes most languages share, for a file whose language is not known.
export const ANY_LANGUAGE: CodeLanguage = {
  rules: [
    declaration(new RegExp(String.raw`^\s*${COMMON_MODIFIERS}(?:class|struct|object|record|module|namespace|package)\s+(?<name>[\w.:]+)`), 'class', 'membersHolder'),
    declaration(new RegExp(String.raw`^\s*${COMMON_MODIFIERS}(?:interface|protocol)\s+(?<name>\w+)`), 'interface', 'membersHolder'),
    declaration(new RegExp(String.raw`^\s*${COMMON_MODIFIERS}trait\s+(?<name>\w+)`), 'trait', 'membersHolder'),
    declaration(new RegExp(String.raw`^\s*${COMMON_MODIFIERS}enum\s+(?<name>\w+)`), 'enum', 'membersHolder'),
    callable(new RegExp(String.raw`^\s*${COMMON_MODIFIERS}(?:function|def|fn|func|fun|sub|proc|procedure)\s+(?<name>[\w$-]+)`)),
    callable(/^\s*\((?:defun|defn-?|defmacro|define)\s+\(?(?<name>[^\s()]+)/),
  ],
  lineCommentPrefixes: ['#', '//', '--', ';', '%'],
  blockComment: { open: '/*', close: '*/' },
  hasTripleQuotedStrings: false,
  linesKeepingScopes: BRACKET_LINES,
  wordsThatAreNotNames: [],
}
