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

// A path is shown, not read: one from the root (`/tmp/x/cards.json`), from home or the current folder (`~/.claude`,
// `./build.sh`) or from a Windows drive, a relative one to a file (`src/view/band.tsx`, `.github/ci.yml`) or to a
// folder written with its final slash (`plugins/talk/`), and a file named with its line (`band.tsx:42`); the voice says
// "this file" or "this folder" in its place. Words joined by slashes (`et/ou/non`, `feature/x`), a one-part path
// (`/talk`, a command) and a path of digits alone (a date, `12/05/2026`) are read.
const CHARACTER = '[\\p{L}\\p{N}_@+-]'
const SEGMENT = `\\.?${CHARACTER}(?:[\\p{L}\\p{N}_.@+-]*${CHARACTER})?`
const EXTENSION = '\\.[A-Za-z]\\w{0,5}'
const FILE_NAME = `${CHARACTER}[\\p{L}\\p{N}_.@+-]*${EXTENSION}`
const LINE_NUMBER = ':\\d+(?:[-:]\\d+)?'
const PATH_PATTERN = [
  `(?:~|\\.{1,2})(?:\\/${SEGMENT})+\\/?`,
  `(?:\\/${SEGMENT}){2,}\\/?`,
  `(?:${SEGMENT}\\/)+${FILE_NAME}`,
  `(?:${SEGMENT}\\/){2,}`,
  `[A-Za-z]:[\\\\/](?:${SEGMENT}[\\\\/])*(?:${FILE_NAME}|${SEGMENT})?`,
].join('|')
const PATH_WORD = new RegExp(
  `^([^\\p{L}\\p{N}_~./]*)((?:${PATH_PATTERN})(?:${LINE_NUMBER})?|${FILE_NAME}${LINE_NUMBER})([^\\p{L}\\p{N}_/\\\\]*)$`,
  'u',
)
// An extension follows a name: `.claude` alone is a hidden folder.
const NAMES_A_FILE = new RegExp(`[^\\\\/.][^\\\\/]*${EXTENSION}$|${LINE_NUMBER}$`)

const TICKET_REFERENCE = /^([A-Z][A-Z0-9]{0,9})-(\d{2,})$/

const PATH_WORDS: Readonly<Record<TalkLanguage, { file: string; folder: string }>> = {
  fr: { file: 'ce fichier', folder: 'ce dossier' },
  en: { file: 'this file', folder: 'this folder' },
  es: { file: 'este archivo', folder: 'esta carpeta' },
  de: { file: 'diese Datei', folder: 'dieser Ordner' },
  it: { file: 'questo file', folder: 'questa cartella' },
}

// What the voice is given for one word of the pane: the same word, unless it is a path, an identifier or, for a local
// French voice, an English word it would otherwise read as French.
export const speakableWordOf = (word: string, language: TalkLanguage, isRespellingEnglish: boolean): string => {
  // Only a word with a slash, a backslash or a colon can be a path: the others skip the pattern, slow on a long word.
  const path = /[/\\:]/.test(word) ? PATH_WORD.exec(word) : null
  if (path !== null && /\p{L}/u.test(path[2] ?? '')) {
    const [, pathLeading = '', pathCore = '', pathTrailing = ''] = path
    return `${pathLeading}${NAMES_A_FILE.test(pathCore) ? PATH_WORDS[language].file : PATH_WORDS[language].folder}${pathTrailing}`
  }
  const [, leading = '', core = '', trailing = ''] = WORD_CORE.exec(word) ?? []
  // A ticket's reference (`YT-7703`): its dash read as a minus, its number as thousands; its letters, then its digits
  // two by two, are heard as a reference.
  const ticket = TICKET_REFERENCE.exec(core)
  if (ticket !== null) return `${leading}${ticket[1]} ${(ticket[2] ?? '').match(/\d{1,2}/g)?.join(' ') ?? ''}${trailing}`
  if (core === '' || /^\p{N}/u.test(core)) return word
  const respell = isRespellingEnglish ? RESPELLING_BY_LANGUAGE[language] : null
  const spoken = respell === null ? splitIdentifier(core) : respellWord(core, respell)
  return `${leading}${spoken}${trailing}`
}
