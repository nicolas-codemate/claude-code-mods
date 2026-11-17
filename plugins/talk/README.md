# talk

A voice conversation mode for [Claude Code](https://code.claude.com), for the moments you think a problem through
together rather than hand over work: you dictate, Claude answers as a colleague would out loud, short and in plain
sentences, and its answer is read aloud while a band above the prompt highlights each word as it is spoken.

![Claude's answer read aloud, the word being spoken highlighted in the band above the prompt](docs/media/answer-read.png)

**A personal tool.** talk was built for my own brainstorming and is mostly tested on my own machine, under Linux.
Another system, terminal or way of working may well bring out bugs I have never met. If you hit one, an
[issue](https://github.com/nicolas-codemate/claude-code-mods/issues) is welcome, a pull request even more: see
[how to contribute](../../CONTRIBUTING.md).

## Install

```
/plugin marketplace add nicolas-codemate/claude-code-mods
/plugin install talk@codemate-mods
```

## Use

| Command | What it does |
| --- | --- |
| `/talk` | Turns the mode on and shows its band above the prompt |
| `/talk off` | Turns it off: answers go back to normal |
| `/talk stop` | Silences the answer being read |
| `/talk replay` | Reads the last answer again |
| `/talk test` | Reads a test sentence, to hear the voice |
| `/talk status` | Lists the voices this machine can use, and why the others cannot |
| `/talk setup` | Installs the local voice, Piper, and a voice of the language |

**Starting and leaving.** While the mode is off, a line above the prompt holds a button that starts a voice
conversation, in the language of the mode; the `Start button above the prompt` option in `/config` hides it. While
it is on, the band's top line ends with the button that leaves it.

![The button above the prompt that starts a voice conversation](docs/media/start-line.png)

**Speaking.** Claude Code has no microphone that stays open: you talk with its own dictation, `/voice`, holding the
space bar while you speak. With `"voice": { "enabled": true, "mode": "tap" }` in your settings, one tap starts it and a
second one sends the message; in hold mode, `"autoSubmit": true` sends it as you release the key. Starting to type or
dictate cuts the voice short, as in a conversation.

**The band.** Above the prompt, the whole answer being read, its word highlighted, with `stop` and `replay`; an answer
too long for the band shows from the sentence being read on. Once you send your next message, it stays there greyed as
the previous answer, replay still at hand. Below it, a line pulses with the word of Claude Code's own spinner while
Claude is thinking, then, once the answer is in, while its voice is made ready. The band's frame tells the state:
Claude's color while the voice reads, blue while Claude works, grey at rest. Its top line ends with the button that
ends the conversation, in the conversation's language.

![The previous answer greyed while Claude thinks, its spinner's word pulsing below](docs/media/previous-answer.png)

**Settings.** The line at the bottom right of the band names the engine, its model when it has several (ElevenLabs),
the voice, the speed and the language. Each
one opens its choices above it; a choice is only selected until **Apply** saves it as `/config` does (the mod then
reloads, and an answer being read goes on from its current sentence), and **Cancel** leaves the setting as it was.
While one is open, the others wait. The voices are those of the engine in use: every Piper voice of the language in
medium quality (each speaker of a voice of a few), the OpenAI voices, the voices of your ElevenLabs account. `▶` beside
one reads the same sentence with it, to compare; a Piper voice marked `↓` is downloaded the first time it is heard or
applied, its progress on the band's top line. An engine the machine cannot use is dimmed. The language chosen is the
one Claude answers in, whatever Claude Code's own language setting says. **All · Female · Male** on the voice list's
title line keeps the voices of one gender, where it is known: ElevenLabs tells it, OpenAI's voices and the usual Piper
ones are labelled by the mod. Beside the engine, in color, what the Claude Code session has cost so far: the
ElevenLabs credits it used and those left on the account, or for OpenAI an estimate in dollars from the minutes of
voice made.

![The speeds open above the settings line, 1.25x selected until Apply](docs/media/speed-settings.png)

![The English voices in columns, one of them downloading with its progress on the band's top line](docs/media/voice-download.png)

**What is read.** While the mode is on, Claude is asked to answer for the ear: a few sentences, one idea at a time, no
tables or lists. Code, commands and paths go in code blocks, which stay on screen and are never read. Only the final
answer of a turn is read; the work in between goes on as usual.

## Voices

The mod picks the best voice the machine has, in this order, unless you choose one in the band or `/config`:

| Voice | Quality | English words in French | Cost | Where the text goes |
| --- | --- | --- | --- | --- |
| **ElevenLabs** | The most natural | Read as a developer says them | A free plan, then a subscription | ElevenLabs |
| **OpenAI** | Natural | Read as a developer says them | A few cents per hour of talk | OpenAI |
| **Piper** | A little robotic | Respelled for the French voice (`GitHub` becomes « guite heube ») | Free | Stays on the machine |
| **System voice** | Robotic (`say` on macOS is better) | Respelled | Free | Stays on the machine |

The words of the band follow the voice exactly with ElevenLabs, which times each character, and with Piper installed
with `onnx` as below, which times each sound it makes. With the other voices their timing is estimated from the length
of each word, close enough to follow along.

**The API key of ElevenLabs or OpenAI.** Give it when `/plugin install` asks for the mod's options (it is kept in
the system's secure storage; `/config` does not show it), or set `ELEVENLABS_API_KEY` or `OPENAI_API_KEY` in the
environment Claude Code starts in, `~/.zshrc` say:

```
export ELEVENLABS_API_KEY=...
```

Claude Code reads its environment when it starts: open a new terminal and start it again (`claude --resume` takes the
conversation back). With a key set, `Auto` picks that engine.

**ElevenLabs, step by step.**

1. Create an account on elevenlabs.io. Of the two platforms it offers, ElevenCreative holds the speech the mod uses;
   ElevenAgents, for agents that answer phone calls, is not needed, nor is connecting ElevenLabs to Claude or ChatGPT.
2. Under **Developers**, **API Keys**, create a key. Where it asks for permissions, the mod needs **Text to Speech**
   and, to list the voices in the band, **Voices** read access. A limit of credits keeps the costs in hand. Copy the
   key: it shows once.
3. Set it as above, then `/talk test` reads the sample sentence with it.

ElevenLabs counts characters read, not minutes. Answers in talk mode are short: an hour of conversation reads about
10,000 characters. The free plan gives 10,000 a month; the paid plans start around $6 for 30,000 and $22 for 100,000
(check their pricing page). Its model is chosen in the band: Multilingual v2, the most natural, or Flash v2.5, which
counts half a credit per character instead of one and answers sooner; any voice speaks with either.

**Its voices.** The free plan reads, through its API, only the voices every account has, Sarah (the default) among
them: they are English voices, which speak French with their English accent. A native voice of another language comes
from the **Voice Library** (under **Voices**, filtered by language: the conversational ones suit talk mode best), and
needs a paid plan: **Add to my voices** on its page, and it shows in the band's list of voices, to choose and apply.
ElevenLabs reads between 0.7 and 1.2 times the normal speed: the band offers no other speed while it is the engine, and
a faster speed set for another engine is read at 1.2.

**Its pronunciation.** A word it says wrong, `CI` read the French way for one, is fixed by a pronunciation dictionary:
under **Pronunciation dictionaries** on elevenlabs.io, create one and add an **Alias** rule, the word and how to write
it to be said right (`CI` → `si aïe`). Phoneme rules (IPA, CMU) are left aside: ElevenLabs applies them with a few
English models only. Then set the `ElevenLabs pronunciation dictionaries` option to the dictionary's id (up to three,
separated by commas): every answer is read with it, in its latest version, so a rule added later applies at once. The
highlight still follows the words as written.

**OpenAI.** A key from platform.openai.com, set the same way; it is paid as used, with no plan, about a cent and a
half per minute of voice. Its thirteen voices are listed in the band.

**Piper.** A local voice, free, about 60 MB per voice. With no cloud key set, `/talk` installs it by itself the first
time, under `~/.local/share/piper`: a Python environment of its own with Piper and `onnx`, and a voice of the language,
the band following each step. A change of language downloads that language's voice the same way. It needs `python3`
with its `venv` module and `curl`: when one is missing, the band gives the command that installs it on your system
(Homebrew, apt, dnf, pacman, zypper or apk). `/talk setup` runs the install on demand, and the `Install the local
voice` option in `/config` turns the automatic one off. By hand, it comes to:

```
python3 -m venv ~/.local/share/piper/venv
~/.local/share/piper/venv/bin/pip install piper-tts onnx
mkdir -p ~/.local/share/piper/voices && cd ~/.local/share/piper/voices
curl -LO https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx
curl -LO https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx.json
```

The mod finds `piper` there or on the `PATH`, and takes the first voice of the language in that folder; the
`Piper command` and `Piper voice` options name others.

**Playing the sound** needs one of `pw-play`, `paplay`, `aplay` or `ffplay` on Linux; macOS has `afplay`.

## Options

In `/config`: the voice engine, the language (French, English, Spanish, German, Italian: the language Claude answers in
and the voice speaks), the speaking speed, whether the local voice installs itself, whether the start button shows
above the prompt, and per engine its key, model and voice.

## Adding a voice service

Each voice service is a provider: one file under `hooks/providers/` exporting an object that implements the
`VoiceProvider` interface of `hooks/providers/provider.ts`. The rest of the mod (the band, the reading, the settings)
knows no service by name and asks the provider for everything:

- what it is: its label, cloud or local, the speeds it takes, how an answer is cut into pieces for it, and whether the
  English words of a French answer must be respelled for it;
- its options, read from the plugin's options and the environment;
- what it looks for on the machine, and why the machine cannot use it;
- its voices, the one in force, and the option the band saves a chosen voice in;
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

TypeScript holds the rest: a service named in `TalkEngineName` but missing from the list, or an option of one service
handed to another, does not compile. Then run the checks:

```bash
claude plugin validate plugins/talk
npx -p typescript@5.9.3 tsc -p plugins/talk/tsconfig.json
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test plugins/talk
```
