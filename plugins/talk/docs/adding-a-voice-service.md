# Adding a voice service to talk

Each voice service is a provider: one file under `hooks/providers/` exporting an object that implements the
`VoiceProvider` interface of `hooks/providers/provider.ts`. The rest of the mod (the band, the reading, the settings)
knows no service by name and asks the provider for everything (paths below are from the mod's folder,
`plugins/talk`):

- what it is: its label, cloud or local, the speeds it takes, how an answer is cut into pieces for it, and whether the
  English words of a French answer must be respelled for it;
- its options, read from the plugin's options and the environment;
- what it looks for on the machine, and why the machine cannot use it;
- its voices, the one in force, its name before the list is read, and the option the band saves a chosen voice in;
- its models, when it has several, and the option the band saves the chosen one in;
- for voices fetched the first time they are used, their download and the file that tells its progress;
- the synthesis of a piece of text: the sound to play, its length and when each word starts, which the band highlights;
- what the session cost, and the account's credits for a service that counts them.

A provider never receives Claude Code's engine interface: Claude Code refuses it handed to an object's method. It
receives a `VoiceToolkit` (`hooks/providers/toolkit.ts`) instead, to fetch, run a command, read and write files and
read an environment variable. A provider is thus tested without Claude Code, on a toolkit of its own:
`hooks/providers/elevenlabs.test.ts` shows how.

To add a service, say `acme`:

1. Write `hooks/providers/acme.ts`, exporting `acme: VoiceProvider<AcmeOptions, AcmeFound>`. `openai.ts` is the
   shortest example of a cloud service, `piper.ts` of a local one. `synthesis.ts` holds what they share: the API key
   handed to curl on its standard input, the WAV length, the error a service answered with.
2. List it in `hooks/providers/index.ts`, where the order is the one auto tries the services in.
3. Add `'acme'` to `TalkEngineName` in `types/index.d.ts`, and to the `engine` option's list in
   `.claude-plugin/plugin.json`, beside its own options (`acmeApiKey`, `acmeVoice`...).
4. If it reads an environment variable, name it in `providerEnvironmentOf` of `hooks/providers/toolkit.ts`: Claude
   Code lists the variables a mod reads, and takes them by their written name alone.
5. Test it in `hooks/providers/acme.test.ts` on a toolkit stand-in, as the other providers' tests do: the request it
   sends, where its key goes, the errors it tells.

TypeScript holds the rest: a service named in `TalkEngineName` but missing from the list, or an option of one service
handed to another, does not compile. Then run the checks, from the repository's root:

```bash
claude plugin validate plugins/talk
npx -p typescript@5.9.3 tsc -p plugins/talk/tsconfig.json
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test plugins/talk
```
