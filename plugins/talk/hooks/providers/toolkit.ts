import type { EngineInterface } from 'claude-code'

// What a voice service may do on the machine, handed to its provider. Claude Code refuses its engine interface passed
// on to an object's method, so a provider is given this instead, made of calls on it.
export interface VoiceToolkit {
  fetch: EngineInterface['http']['fetch']
  run: EngineInterface['process']['run']
  readText(path: string): Promise<string>
  readBase64(path: string): Promise<string>
  write(path: string, text: string): Promise<void>
  exists(path: string): Promise<boolean>
  // The names of the files of a directory.
  fileNamesOf(directory: string): Promise<string[]>
  environmentVariable(name: ProviderVariable): Promise<string | undefined>
}

// Claude Code lists the environment variables a mod reads, and takes them by their written name alone: each one a
// provider reads is named here.
async function providerEnvironmentOf($: EngineInterface) {
  return {
    HOME: (await $.env.get('HOME')) ?? undefined,
    ELEVENLABS_API_KEY: (await $.env.get('ELEVENLABS_API_KEY')) ?? undefined,
    OPENAI_API_KEY: (await $.env.get('OPENAI_API_KEY')) ?? undefined,
  }
}

export type ProviderVariable = keyof Awaited<ReturnType<typeof providerEnvironmentOf>>

export function voiceToolkitOf($: EngineInterface): VoiceToolkit {
  return {
    fetch: (url, init) => $.http.fetch(url, init),
    run: (argv, init) => $.process.run(argv, init),
    readText: async path => $.fs.read(path),
    readBase64: async path => (await $.fs.read(path, { as: 'bytes' })).base64,
    write: async (path, text) => {
      await $.fs.write(path, text)
    },
    exists: async path => $.fs.exists(path),
    fileNamesOf: async directory => (await $.fs.list(directory)).filter(entry => entry.kind === 'file').map(entry => entry.name),
    environmentVariable: async name => (await providerEnvironmentOf($))[name],
  }
}
