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
export type SettingName = 'engine' | 'voice' | 'speed' | 'language'

// One voice the band offers: `download` is the path of a Piper voice in the Piper catalog and `sizeBytes` the size of
// its model, both null for a cloud voice.
export type VoiceChoice = { value: string; label: string; download: string | null; sizeBytes: number | null }

// A Piper voice being downloaded: what has come so far, out of its size when the catalog gives it.
export type VoiceDownload = { download: string; label: string; receivedBytes: number; totalBytes: number | null }

// The voices of the engine in use, as the band lists them; `downloaded` holds the Piper voices already on the machine.
export type VoiceCatalog =
  | { engine: TalkEngineName; status: 'loading' }
  | { engine: TalkEngineName; status: 'ready'; choices: VoiceChoice[]; downloaded: string[] }
  | { engine: TalkEngineName; status: 'failed'; error: string }

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
      voiceCatalog: VoiceCatalog | null
      // The voice whose sample is being prepared or heard.
      previewingVoice: string | null
      voiceDownload: VoiceDownload | null
      // From the person's message until Claude's answer comes.
      isAwaitingAnswer: boolean
      // The step of the animation of a wait: for the answer, then for the voice.
      animationFrame: number
      // Claude Code's own theme setting, which the band's colors follow.
      claudeCodeTheme: string | null
    }
  }
}
