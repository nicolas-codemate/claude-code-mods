import type { EngineInterface } from 'claude-code'

import type { TalkLanguage } from '../types'
import { languageNameOf } from './engines'

const VOICES_ADDRESS = 'https://huggingface.co/rhasspy/piper-voices/resolve/main'

// One voice per language, the clearest of those the Piper project publishes at medium quality.
const VOICE_PATHS: Readonly<Record<TalkLanguage, string>> = {
  fr: 'fr/fr_FR/siwis/medium/fr_FR-siwis-medium',
  en: 'en/en_US/lessac/medium/en_US-lessac-medium',
  es: 'es/es_ES/davefx/medium/es_ES-davefx-medium',
  de: 'de/de_DE/thorsten/medium/de_DE-thorsten-medium',
  it: 'it/it_IT/paola/medium/it_IT-paola-medium',
}

const VENV_TIMEOUT_MS = 120_000
const PIP_TIMEOUT_MS = 600_000
const DOWNLOAD_TIMEOUT_MS = 600_000

export class InstallError extends Error {}

export type Prerequisite = 'python' | 'venv' | 'curl'

export type SystemFamily = 'macos' | 'debian' | 'fedora' | 'arch' | 'suse' | 'alpine' | 'other'

type PackageManager = { install: string; packages: Readonly<Record<Prerequisite, string>> }

// How each family of systems installs what the local voice needs. On macOS, Homebrew's Python brings its venv module,
// and curl is part of the system.
const PACKAGE_MANAGERS: Readonly<Record<Exclude<SystemFamily, 'other'>, PackageManager>> = {
  macos: { install: 'brew install', packages: { python: 'python', venv: 'python', curl: 'curl' } },
  debian: { install: 'sudo apt install', packages: { python: 'python3', venv: 'python3-venv', curl: 'curl' } },
  fedora: { install: 'sudo dnf install', packages: { python: 'python3', venv: 'python3', curl: 'curl' } },
  arch: { install: 'sudo pacman -S', packages: { python: 'python', venv: 'python', curl: 'curl' } },
  suse: { install: 'sudo zypper install', packages: { python: 'python3', venv: 'python3', curl: 'curl' } },
  alpine: { install: 'sudo apk add', packages: { python: 'python3', venv: 'python3', curl: 'curl' } },
}

const PREREQUISITE_NAMES: Readonly<Record<Prerequisite, string>> = { python: 'python3', venv: 'the venv module of python3', curl: 'curl' }

// The family of a system from its kernel name and the ID and ID_LIKE lines of its /etc/os-release.
export const systemFamilyOf = (kernel: string, osRelease: string): SystemFamily => {
  if (kernel === 'Darwin') return 'macos'
  const ids = [...osRelease.matchAll(/^(?:ID|ID_LIKE)="?([^"\n]*)"?$/gm)].flatMap(match => (match[1] ?? '').split(/\s+/))
  if (ids.some(id => id === 'debian' || id === 'ubuntu')) return 'debian'
  if (ids.some(id => id === 'fedora' || id === 'rhel' || id === 'centos')) return 'fedora'
  if (ids.some(id => id === 'arch')) return 'arch'
  if (ids.some(id => id.startsWith('suse') || id.startsWith('opensuse'))) return 'suse'
  if (ids.some(id => id === 'alpine')) return 'alpine'
  return 'other'
}

// What to tell the person when the machine lacks what the install needs: the command of their own system.
export const prerequisitesMessageOf = (family: SystemFamily, missing: readonly Prerequisite[]): string => {
  const names = missing.map(prerequisite => PREREQUISITE_NAMES[prerequisite]).join(' and ')
  if (family === 'other') return `The local voice needs ${names}: install them with your system's package manager, then run /talk setup.`
  const manager = PACKAGE_MANAGERS[family]
  const packages = [...new Set(missing.map(prerequisite => manager.packages[prerequisite]))].join(' ')
  return `The local voice needs ${names}. Run: ${manager.install} ${packages}  then /talk setup.`
}

async function missingPrerequisitesOf($: EngineInterface, needsPython: boolean, needsCurl: boolean): Promise<Prerequisite[]> {
  const missing: Prerequisite[] = []
  if (needsPython) {
    const { exitCode } = await $.process.run(['python3', '-c', 'import venv, ensurepip']).catch(() => ({ exitCode: 127 }))
    if (exitCode !== 0) {
      const { exitCode: pythonExitCode } = await $.process.run(['python3', '--version']).catch(() => ({ exitCode: 127 }))
      missing.push(pythonExitCode === 0 ? 'venv' : 'python')
    }
  }
  if (needsCurl) {
    const { exitCode } = await $.process.run(['curl', '--version']).catch(() => ({ exitCode: 127 }))
    if (exitCode !== 0) missing.push('curl')
  }
  return missing
}

async function systemFamilyOfMachine($: EngineInterface): Promise<SystemFamily> {
  const { stdout: kernel } = await $.process.run(['uname', '-s'])
  const osRelease = (await $.fs.exists('/etc/os-release')) ? await $.fs.read('/etc/os-release') : ''
  return systemFamilyOf(kernel.trim(), osRelease)
}

export const piperHomeOf = (home: string): string => `${home}/.local/share/piper`

async function runStep($: EngineInterface, argv: readonly string[], timeoutMs: number, what: string): Promise<void> {
  const { exitCode, stdout, stderr } = await $.process.run(argv, { timeoutMs }).catch(error => {
    throw new InstallError(`${what} failed: ${String(error)}`)
  })
  if (exitCode !== 0) throw new InstallError(`${what} failed: ${(stderr.trim() || stdout.trim()).split('\n').slice(-3).join(' ').slice(0, 300)}`)
}

async function hasVoiceOf($: EngineInterface, voicesDirectory: string, language: TalkLanguage): Promise<boolean> {
  if (!(await $.fs.exists(voicesDirectory))) return false
  return (await $.fs.list(voicesDirectory)).some(entry => entry.kind === 'file' && entry.name.startsWith(`${language}_`) && entry.name.endsWith('.onnx'))
}

async function hasWordTimingIn($: EngineInterface, python: string): Promise<boolean> {
  const { exitCode } = await $.process.run([python, '-c', 'import piper, onnx'])
  return exitCode === 0
}

// What the local voice still lacks on this machine, none of it when Piper, its word timing and a voice of the
// language are all there.
export async function missingPiperPartsOf($: EngineInterface, home: string, language: TalkLanguage): Promise<string[]> {
  const piperHome = piperHomeOf(home)
  const python = `${piperHome}/venv/bin/python`
  const missing: string[] = []
  if (!(await $.fs.exists(`${piperHome}/venv/bin/piper`))) missing.push('piper')
  else if (!(await hasWordTimingIn($, python))) missing.push('word timing')
  if (!(await hasVoiceOf($, `${piperHome}/voices`, language))) missing.push('voice')
  return missing
}

// Installs Piper in a Python environment of its own under ~/.local/share/piper, and a voice of the language beside it.
// Each step is said through onStep, as it starts.
export async function installPiper($: EngineInterface, home: string, language: TalkLanguage, onStep: (message: string) => Promise<void>): Promise<void> {
  const piperHome = piperHomeOf(home)
  const pip = `${piperHome}/venv/bin/pip`
  const missing = await missingPiperPartsOf($, home, language)
  const missingPrerequisites = await missingPrerequisitesOf($, missing.includes('piper'), missing.includes('voice'))
  if (missingPrerequisites.length > 0) throw new InstallError(prerequisitesMessageOf(await systemFamilyOfMachine($), missingPrerequisites))
  if (missing.includes('piper')) {
    await onStep('creating its Python environment')
    await runStep($, ['python3', '-m', 'venv', `${piperHome}/venv`], VENV_TIMEOUT_MS, 'Creating the Python environment (python3 and its venv module are needed)')
    await onStep('installing Piper, a few minutes')
    await runStep($, [pip, 'install', '--quiet', 'piper-tts', 'onnx'], PIP_TIMEOUT_MS, 'Installing Piper')
  }
  if (missing.includes('word timing')) {
    await onStep('installing the timing of the words')
    await runStep($, [pip, 'install', '--quiet', 'onnx'], PIP_TIMEOUT_MS, 'Installing onnx')
  }
  if (missing.includes('voice')) {
    await onStep(`downloading the ${languageNameOf(language)} voice, about 60 MB`)
    const voicePath = VOICE_PATHS[language]
    const voiceName = voicePath.slice(voicePath.lastIndexOf('/') + 1)
    const voicesDirectory = `${piperHome}/voices`
    // Downloaded under a temporary name first: a voice cut short is never taken for a whole one.
    const script = 'set -e; mkdir -p "$1"; for suffix in .onnx.json .onnx; do curl -fsSL -o "$1/$2$suffix.part" "$3$suffix"; mv "$1/$2$suffix.part" "$1/$2$suffix"; done'
    await runStep($, ['sh', '-c', script, 'sh', voicesDirectory, voiceName, `${VOICES_ADDRESS}/${voicePath}`], DOWNLOAD_TIMEOUT_MS, 'Downloading the voice')
  }
}
