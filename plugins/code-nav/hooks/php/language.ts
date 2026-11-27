import { memberOfEvery } from '../language-support'
import type { LanguageDeclarations, NavigatedLanguageSupport } from '../language-support'
import { findPhpImplementations, findPhpParents, findPhpUsages, phpSymbolsOfFile, resolvePhpDefinition } from './analysis'

const PHP_MODIFIERS = String.raw`(?:(?:abstract|final|readonly|public|protected|private|static)\s+)*`

const PHP_DECLARATIONS: LanguageDeclarations = {
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

export const PHP_LANGUAGE: NavigatedLanguageSupport = {
  extensions: ['php'],
  symbolsOfFile: phpSymbolsOfFile,
  declarations: PHP_DECLARATIONS,
  analysis: {
    definition: resolvePhpDefinition,
    usages: findPhpUsages,
    implementations: findPhpImplementations,
    parents: findPhpParents,
  },
}

