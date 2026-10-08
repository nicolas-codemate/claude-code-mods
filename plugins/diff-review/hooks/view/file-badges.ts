import { fileNameOf } from '../git-parsing'

const FILE_TYPE_BADGES: ReadonlyArray<{ extensions: string[]; badge: string; color: string }> = [
  { extensions: ['php'], badge: 'php', color: '#8892bf' },
  { extensions: ['ts', 'tsx', 'mts', 'cts'], badge: 'ts', color: '#3d8fd6' },
  { extensions: ['js', 'jsx', 'mjs', 'cjs'], badge: 'js', color: '#e8d44d' },
  { extensions: ['json'], badge: '{}', color: '#cbcb41' },
  { extensions: ['md', 'mdx'], badge: 'md', color: '#5fa8d3' },
  { extensions: ['sh', 'bash', 'zsh'], badge: '$_', color: '#89e051' },
  { extensions: ['yml', 'yaml'], badge: 'yml', color: '#e06c75' },
  { extensions: ['css', 'scss', 'sass'], badge: '#', color: '#c678dd' },
  { extensions: ['html', 'twig', 'vue', 'svelte'], badge: '<>', color: '#e5804f' },
  { extensions: ['py'], badge: 'py', color: '#4b8bbe' },
  { extensions: ['go'], badge: 'go', color: '#00add8' },
  { extensions: ['xml', 'xlf', 'xliff'], badge: '<>', color: '#c0965c' },
  { extensions: ['sql'], badge: 'sql', color: '#d7a65f' },
  { extensions: ['lock'], badge: 'lck', color: '#7f848e' },
]

export function fileTypeBadgeOf(path: string): { badge: string; color: string } {
  const fileName = fileNameOf(path)
  const extension = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase() : ''
  const known = FILE_TYPE_BADGES.find(entry => entry.extensions.includes(extension))

  return known ? { badge: known.badge, color: known.color } : { badge: '··', color: '#7f848e' }
}
