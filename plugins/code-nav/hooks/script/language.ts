import type { LanguageDeclarations, NavigatedLanguageSupport } from '../language-support'
import { findScriptImplementations, findScriptParents, findScriptUsages, resolveScriptDefinition, scriptSymbolsOfFile } from './analysis'

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

// TypeScript, JavaScript and the script blocks of Vue components, read as one language: a Vue component imports
// TypeScript modules and is imported by them.
export const SCRIPT_LANGUAGE: NavigatedLanguageSupport = {
  extensions: ['ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'vue'],
  symbolsOfFile: scriptSymbolsOfFile,
  declarations: SCRIPT_DECLARATIONS,
  analysis: {
    definition: resolveScriptDefinition,
    usages: findScriptUsages,
    implementations: findScriptImplementations,
    parents: findScriptParents,
  },
}

