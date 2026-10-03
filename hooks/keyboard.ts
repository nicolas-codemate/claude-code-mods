import type { KeyboardLayout } from '../types'

const AZERTY_LAYOUT_CODES = ['fr', 'be']

// Where the desktop says which keyboard layout is in use: GNOME's input sources first, then X11's.
export const KEYBOARD_LAYOUT_SOURCES: ReadonlyArray<{ argv: string[]; layoutPattern: RegExp }> = [
  { argv: ['gsettings', 'get', 'org.gnome.desktop.input-sources', 'sources'], layoutPattern: /\('xkb', '([a-z]+)/ },
  { argv: ['setxkbmap', '-query'], layoutPattern: /layout:\s*([a-z]+)/ },
]

export function keyboardLayoutOf(layoutSourceOutput: string, layoutPattern: RegExp): KeyboardLayout | null {
  const layoutCode = layoutSourceOutput.match(layoutPattern)?.[1]
  if (!layoutCode) {
    return null
  }

  return AZERTY_LAYOUT_CODES.includes(layoutCode) ? 'azerty' : 'qwerty'
}
