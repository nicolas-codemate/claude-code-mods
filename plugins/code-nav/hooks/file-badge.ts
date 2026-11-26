import { baseNameOf } from './paths'

// A short colored tag naming what a file holds, drawn before its name where tabs are listed. The colors are the ones
// the languages are known by, in mid tones that read on a dark and on a light background alike.
export type FileBadge = { label: string; color: string }

export const BADGE_COLUMNS = 4

const BADGES_BY_EXTENSION: Readonly<Record<string, FileBadge>> = {
  php: { label: 'php', color: '#8892bf' },
  ts: { label: 'ts', color: '#3178c6' },
  tsx: { label: 'tsx', color: '#3178c6' },
  mts: { label: 'ts', color: '#3178c6' },
  cts: { label: 'ts', color: '#3178c6' },
  js: { label: 'js', color: '#c9a400' },
  jsx: { label: 'jsx', color: '#c9a400' },
  mjs: { label: 'js', color: '#c9a400' },
  cjs: { label: 'js', color: '#c9a400' },
  vue: { label: 'vue', color: '#41b883' },
  json: { label: '{}', color: '#cb8a1a' },
  yml: { label: 'yml', color: '#cb4b16' },
  yaml: { label: 'yml', color: '#cb4b16' },
  neon: { label: 'neo', color: '#cb4b16' },
  toml: { label: 'tml', color: '#cb4b16' },
  xml: { label: 'xml', color: '#e37933' },
  xlf: { label: 'xlf', color: '#e37933' },
  html: { label: 'htm', color: '#e44d26' },
  twig: { label: 'twg', color: '#7aa53c' },
  css: { label: 'css', color: '#2965f1' },
  scss: { label: 'scs', color: '#c6538c' },
  md: { label: 'md', color: '#6c8ebf' },
  sql: { label: 'sql', color: '#d97706' },
  sh: { label: 'sh', color: '#4caf50' },
  bash: { label: 'sh', color: '#4caf50' },
  feature: { label: 'bdd', color: '#23d96c' },
  graphql: { label: 'gql', color: '#e535ab' },
  gql: { label: 'gql', color: '#e535ab' },
  lock: { label: 'lck', color: '#8b8b8b' },
  env: { label: 'env', color: '#8b8b8b' },
}

const BADGES_BY_FILE_NAME: Readonly<Record<string, FileBadge>> = {
  Dockerfile: { label: 'dkr', color: '#2496ed' },
  Makefile: { label: 'mk', color: '#6d8086' },
  '.env': { label: 'env', color: '#8b8b8b' },
}

const OTHER_FILE_BADGE: FileBadge = { label: '·', color: '#8b8b8b' }

export function fileBadgeOf(path: string): FileBadge {
  const fileName = baseNameOf(path)
  const namedBadge = BADGES_BY_FILE_NAME[fileName]
  if (namedBadge !== undefined) {
    return namedBadge
  }
  const extensionStart = fileName.lastIndexOf('.')
  const extension = extensionStart <= 0 ? '' : fileName.slice(extensionStart + 1).toLowerCase()

  return BADGES_BY_EXTENSION[extension] ?? (fileName.startsWith('.env') ? (BADGES_BY_FILE_NAME['.env'] ?? OTHER_FILE_BADGE) : OTHER_FILE_BADGE)
}
