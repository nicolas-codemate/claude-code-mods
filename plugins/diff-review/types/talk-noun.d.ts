// The talk mod's noun, as its own contract declares it: diff-review reads the PR overview aloud through it when talk is
// loaded. Not a dependency, which would keep diff-review from loading without talk: the noun is declared here, and
// looked for in `$.command.list()` before it is called.
export type TalkNoun = {
  read: (args: { text: string }) => Promise<void>
}

declare module 'claude-code' {
  interface EngineInterface {
    talk: TalkNoun
  }
}
