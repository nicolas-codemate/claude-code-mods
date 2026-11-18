# talk

A voice conversation mode for [Claude Code](https://code.claude.com): you dictate, Claude answers in a few plain
sentences, and its answer is read aloud while a band above the prompt highlights each word.

![Claude's answer read aloud, the word being spoken highlighted in the band above the prompt](docs/media/answer-read.png)

Built for my own use and mostly tested on Linux: [issues and pull requests](../../CONTRIBUTING.md) are welcome.

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

Speak with Claude Code's dictation, `/voice` (hold the space bar); typing or dictating cuts the voice short. Code and
commands stay on screen, never read. The band's bottom line opens the engine, voice, speed and language.

![The speeds open above the settings line, 1.25x selected until Apply](docs/media/speed-settings.png)

## Voices

The mod picks the best voice available, in this order, unless you choose one:

| Voice | Quality | English words in French | Cost | Where the text goes |
| --- | --- | --- | --- | --- |
| **ElevenLabs** | The most natural | Read as a developer says them | A free plan, then a subscription | ElevenLabs |
| **OpenAI** | Natural | Read as a developer says them | A few cents per hour of talk | OpenAI |
| **Piper** | A little robotic | Respelled (`GitHub` becomes « guite heube ») | Free | Stays on the machine |
| **System voice** | Robotic (`say` on macOS is better) | Respelled | Free | Stays on the machine |

The highlight follows the voice exactly with ElevenLabs and Piper; with the others it is estimated from word lengths.

**ElevenLabs or OpenAI.** Give the API key when `/plugin install` asks for the mod's options (kept in the system's
secure storage), or set `ELEVENLABS_API_KEY` or `OPENAI_API_KEY` in your shell's startup file (`~/.bashrc`,
`~/.zshrc`...) and restart Claude Code (`claude --resume` takes the conversation back):

```
export ELEVENLABS_API_KEY=...
```

Setup, costs and voices of each: [ElevenLabs](docs/elevenlabs.md), [OpenAI](docs/openai.md).

**Piper.** A free local voice, about 60 MB per voice. With no cloud key, `/talk` installs it the first time under
`~/.local/share/piper`, the band following each step. It needs `python3` with its `venv` module and `curl`; when one is
missing, the band gives the command for your system. `/talk setup` runs the install on demand; the `Install the local
voice` option turns the automatic one off.

**Playing the sound** needs `pw-play`, `paplay`, `aplay` or `ffplay` on Linux; macOS has `afplay`.

## Adding a voice service

See [adding a voice service](docs/adding-a-voice-service.md).
