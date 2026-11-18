# ElevenLabs with talk

The most natural of the mod's voices: it reads English words as a developer says them, and times each character, so
the band's highlight follows the voice exactly.

## Setting it up

1. Create an account on elevenlabs.io. Of the two platforms it offers, ElevenCreative holds the speech the mod uses;
   ElevenAgents, for agents that answer phone calls, is not needed, nor is connecting ElevenLabs to Claude or ChatGPT.
2. Under **Developers**, **API Keys**, create a key. Where it asks for permissions, the mod needs **Text to Speech**
   and, to list the voices in the band, **Voices** read access. A limit of credits keeps the costs in hand. Copy the
   key: it shows once.
3. Give it to the mod as the [README](../README.md#voices) says, then `/talk test` reads the sample sentence with it.

## What it costs

ElevenLabs counts characters read, not minutes. Answers in talk mode are short: an hour of conversation reads about
10,000 characters. The free plan gives 10,000 a month; the paid plans start around $6 for 30,000 and $22 for 100,000
(check their pricing page). Beside the engine, the band shows the credits the session used and those left.

Its model is chosen in the band:

- **Multilingual v2**, the most natural, one credit per character;
- **Flash v2.5**, which answers sooner, half a credit per character.

Any voice speaks with either.

## Its voices

- The free plan reads, through its API, only the voices every account has, Sarah (the default) among them: they are
  English voices, which speak French with their English accent.
- A native voice of another language comes from the **Voice Library** (under **Voices**, filtered by language: the
  conversational ones suit talk mode best), and needs a paid plan: **Add to my voices** on its page, and it shows in
  the band's list of voices, to choose and apply.
- ElevenLabs reads between 0.7 and 1.2 times the normal speed: the band offers no other speed while it is the engine,
  and a faster speed set for another engine is read at 1.2.

## Its pronunciation

A word it says wrong, `CI` read the French way for one, is fixed by a pronunciation dictionary:

1. Under **Pronunciation dictionaries** on elevenlabs.io, create one and add an **Alias** rule: the word, and how to
   write it to be said right (`CI` → `si aïe`). Phoneme rules (IPA, CMU) are left aside: ElevenLabs applies them with
   a few English models only.
2. Set the `ElevenLabs pronunciation dictionaries` option to the dictionary's id (up to three, separated by commas).

Every answer is then read with it, in its latest version, so a rule added later applies at once. The highlight still
follows the words as written.
