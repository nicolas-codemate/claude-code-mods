import { expect, test } from 'claude-code/testing'

import { prerequisitesMessageOf, systemFamilyOf } from './piper-install'

test('the system is told apart by its kernel and its os-release', async () => {
  expect(systemFamilyOf('Darwin', '')).toBe('macos')
  expect(systemFamilyOf('Linux', 'ID=ubuntu\nID_LIKE=debian\n')).toBe('debian')
  expect(systemFamilyOf('Linux', 'ID=linuxmint\nID_LIKE="ubuntu debian"\n')).toBe('debian')
  expect(systemFamilyOf('Linux', 'ID="rocky"\nID_LIKE="rhel centos fedora"\n')).toBe('fedora')
  expect(systemFamilyOf('Linux', 'ID=manjaro\nID_LIKE=arch\n')).toBe('arch')
  expect(systemFamilyOf('Linux', 'ID="opensuse-tumbleweed"\nID_LIKE="opensuse suse"\n')).toBe('suse')
  expect(systemFamilyOf('Linux', 'ID=alpine\n')).toBe('alpine')
  expect(systemFamilyOf('Linux', 'ID=nixos\n')).toBe('other')
})

test('what is missing comes with the command of the system to install it', async () => {
  expect(prerequisitesMessageOf('debian', ['venv', 'curl'])).toBe(
    'The local voice needs the venv module of python3 and curl. Run: sudo apt install python3-venv curl  then /talk setup.',
  )
  expect(prerequisitesMessageOf('fedora', ['python'])).toBe('The local voice needs python3. Run: sudo dnf install python3  then /talk setup.')
  expect(prerequisitesMessageOf('macos', ['python', 'venv'])).toBe(
    'The local voice needs python3 and the venv module of python3. Run: brew install python  then /talk setup.',
  )
  expect(prerequisitesMessageOf('other', ['curl'])).toBe("The local voice needs curl: install them with your system's package manager, then run /talk setup.")
})
