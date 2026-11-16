export type TalkEngineName = 'elevenlabs' | 'openai' | 'piper' | 'system'

export type TalkLanguage = 'fr' | 'en' | 'es' | 'de' | 'it'

// A piece of the spoken text as the pane draws it: a word the voice reads, or the spaces and punctuation between words.
export type SpokenToken = { text: string; wordIndex: number | null }

export type ReadingPhase = 'idle' | 'synthesizing' | 'speaking' | 'done' | 'stopped' | 'failed'

export type Reading = {
  tokens: SpokenToken[]
  // The word the voice is on; -1 before the first word.
  currentWordIndex: number
  phase: ReadingPhase
  engine: TalkEngineName | null
  error: string | null
}

// The settings the band opens one at a time, from its settings line.
export type SettingName = 'engine' | 'speed' | 'language'

// The local voice being installed: the step under way, or why it failed.
export type Installation = { status: 'running' | 'failed'; message: string }

// Per engine, why this machine cannot use it; null for an engine it can use.
export type EngineAvailability = Record<TalkEngineName, string | null>

declare module 'claude-code' {
  interface PluginState {
    talk: {
      isActive: boolean
      reading: Reading
      engineAvailability: EngineAvailability | null
      openSetting: SettingName | null
      installation: Installation | null
      // Claude Code's own theme setting, which the band's colors follow.
      claudeCodeTheme: string | null
    }
  }
}
