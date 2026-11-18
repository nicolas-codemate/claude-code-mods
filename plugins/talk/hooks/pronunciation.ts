import type { TalkLanguage } from '../types'

// English words of a developer's French as a French voice must read them: a local voice reads every word as French.
const FRENCH_RESPELLINGS: Readonly<Record<string, string>> = {
  api: 'a pé i',
  backend: 'baque ènnde',
  branch: 'brannche',
  build: 'bilde',
  builder: 'bildeur',
  by: 'baï',
  claude: 'clôde',
  commit: 'comite',
  commits: 'comites',
  controller: 'contrôleur',
  create: 'kriéte',
  delete: 'dilite',
  deploy: 'diploï',
  design: 'dizaïne',
  docker: 'dockeur',
  event: 'ivènnte',
  feature: 'fitcheur',
  features: 'fitcheurs',
  find: 'faïnde',
  flag: 'flague',
  framework: 'frèmeworke',
  frontend: 'fronnte ènnde',
  get: 'guette',
  git: 'guite',
  github: 'guite heube',
  gitlab: 'guite labe',
  handler: 'hanndleur',
  hook: 'houke',
  hooks: 'houkes',
  id: 'aïdi',
  javascript: 'djavascripte',
  json: 'djésonne',
  listener: 'lissneur',
  markdown: 'markdaonne',
  merge: 'meurdje',
  pane: 'péne',
  pattern: 'patteurne',
  patterns: 'patteurnes',
  plugin: 'pleuguine',
  plugins: 'pleuguines',
  prompt: 'prommpte',
  pull: 'poule',
  push: 'pouche',
  query: 'kouiri',
  react: 'riacte',
  repo: 'ripo',
  repository: 'ripozitori',
  request: 'riquouesste',
  review: 'rivyou',
  script: 'scripte',
  set: 'sète',
  skill: 'skile',
  skills: 'skiles',
  strategy: 'stratédji',
  token: 'tokeune',
  tokens: 'tokeunes',
  typescript: 'taïpscripte',
  update: 'eupdéte',
  user: 'youzeur',
  users: 'youzeurs',
  workflow: 'worke flo',
  worktree: 'worke tri',
  yaml: 'yamel',
}

const FRENCH_LETTER_NAMES: Readonly<Record<string, string>> = {
  a: 'a', b: 'bé', c: 'cé', d: 'dé', e: 'e', f: 'èfe', g: 'jé', h: 'ache', i: 'i', j: 'ji', k: 'ka', l: 'èle', m: 'ème',
  n: 'ène', o: 'o', p: 'pé', q: 'ku', r: 'ère', s: 'èsse', t: 'té', u: 'u', v: 'vé', w: 'double vé', x: 'ixe',
  y: 'i grec', z: 'zède',
}

const WORD_CORE = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u

// findByUserId, user_subscriptions and feature-flag are read as the words they are made of.
export const isCodeIdentifier = (word: string): boolean => /[_]/.test(word) || /^\p{Ll}+\p{Lu}/u.test(word)

export const identifierPartsOf = (identifier: string): string[] =>
  identifier
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2')
    .split(/[\s_\-]+/)
    .filter(part => part.length > 0)

const frenchRespellingOf = (part: string): string => {
  const respelled = FRENCH_RESPELLINGS[part.toLowerCase()]
  if (respelled !== undefined) return respelled
  if (/^\p{Lu}{2,5}$/u.test(part)) return [...part.toLowerCase()].map(letter => FRENCH_LETTER_NAMES[letter] ?? letter).join(' ')
  return part
}

const RESPELLING_BY_LANGUAGE: Readonly<Record<TalkLanguage, ((part: string) => string) | null>> = {
  fr: frenchRespellingOf,
  en: null,
  es: null,
  de: null,
  it: null,
}

const splitIdentifier = (word: string): string => (isCodeIdentifier(word) ? identifierPartsOf(word).join(' ') : word)

// A word the lexicon knows whole (GitHub) is respelled whole, any other one part by part (UserRepository).
const respellWord = (word: string, respell: (part: string) => string): string => {
  const whole = respell(word)
  if (whole !== word) return whole
  return identifierPartsOf(word).map(respell).join(' ')
}

// What the voice is given for one word of the pane: the same word, unless it is an identifier or, for a local French
// voice, an English word it would otherwise read as French.
export const speakableWordOf = (word: string, language: TalkLanguage, isRespellingEnglish: boolean): string => {
  const [, leading = '', core = '', trailing = ''] = WORD_CORE.exec(word) ?? []
  if (core === '' || /^\p{N}/u.test(core)) return word
  const respell = isRespellingEnglish ? RESPELLING_BY_LANGUAGE[language] : null
  const spoken = respell === null ? splitIdentifier(core) : respellWord(core, respell)
  return `${leading}${spoken}${trailing}`
}
