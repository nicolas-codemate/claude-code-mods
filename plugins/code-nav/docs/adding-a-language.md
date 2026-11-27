# Adding a language

A file goes through five levels in code-nav. Each one has its own contract, and each one can be added alone: a
language with a badge and colours only is already better than none. Take them in this order, from an hour of work to
several days.

| Level | What the person sees | Where | Effort |
|---|---|---|---|
| 1. Badge | the coloured tag before the file name, in tabs and files | `hooks/file-badge.ts` | minutes |
| 2. Colours | the code coloured | `hooks/syntax/` | an hour, a day for a new family |
| 3. Structure | `☰ Structure`, the bar under the code, `↪ list usages` on a declaration | `hooks/outline/` | an hour |
| 4. Project index | its classes and functions in `⌕ Find` | the language module | a day |
| 5. Navigation | go to definition, usages, implementations, parents, by meaning | the language module | days |

Without levels 4 and 5, a file is navigated by its words: a name is looked up as a whole word across the project, and
offered as candidates. That fallback is `hooks/text-analysis.ts`; it is often enough for a language read now and then.

## 1. Badge

Add the extension to `BADGES_BY_EXTENSION` in `hooks/file-badge.ts` (or the file name to `BADGES_BY_FILE_NAME`): at
most three characters, the colour the language is known by, in a mid tone that reads on dark and light backgrounds.

## 2. Colours

`hooks/syntax/language.ts` sorts extensions into families (`SourceLanguage`). Each family has one scanner, in
`SCANNER_OF_LANGUAGE` (`hooks/syntax/tokenize.ts`):

```ts
type LanguageScanner = (path: string, text: string, collector: TokenCollector) => void
```

A scanner walks the text once and calls `collector.add(startOffset, endOffset, kind, isNavigable)` for every
comment, string, keyword, name, number. `isNavigable` marks the names the pointer can follow.

- **Most languages fit a family that exists**: a language with `//` and `/* */` comments goes to `clike`. Add the
  extension to `EXTENSIONS_BY_LANGUAGE` and stop there.
- **A new family** (Python's indentation and `#` comments, say) is a new `SourceLanguage` value. The compiler then asks
  for its scanner in `SCANNER_OF_LANGUAGE`. Build it from the helpers in `hooks/syntax/scanning.ts`, after
  `hooks/syntax/generic.ts`, the shortest one.

Tests: `hooks/syntax/<family>.test.ts`, one test per construct (a string spanning lines, a comment in a string…), each
also checking `tokenInvariantBreaches` (`hooks/syntax/token-invariants.ts`) is empty: no token overlaps another, none
cuts a word.

## 3. Structure

`hooks/outline/generic-outline.ts` maps extensions and file names to a format, and each format to a reader:

```ts
(path: string, text: string) => SymbolEntry[]
```

For a programming language, the reader is a `CodeLanguage` in `hooks/outline/code-languages.ts`: one rule per kind of
declaration, a regular expression capturing `name`, the kind it declares, and whether it opens a scope holding
members. `PYTHON` and `GO` are short examples. Add the value to `OutlineFormat`, its reader to `SYMBOLS_BY_FORMAT`
and its extensions to `FORMAT_BY_EXTENSION`.

Tests: `hooks/outline/generic-outline.test.ts`, a short made-up file of the language and the declarations expected,
with their lines and containers.

## 4 and 5. A navigated language

A language navigated by its meaning is a folder, `hooks/<language>/`, that exports one `NavigatedLanguageSupport`
(contract in `hooks/language-support.ts`) from `hooks/<language>/language.ts`:

```ts
export const PYTHON_LANGUAGE: NavigatedLanguageSupport = {
  extensions: ['py', 'pyi'],
  symbolsOfFile: pythonSymbolsOfFile,
  declarations: PYTHON_DECLARATIONS,
  analysis: {
    definition: resolvePythonDefinition,
    usages: findPythonUsages,
    implementations: findPythonImplementations,
    parents: findPythonParents,
  },
}
```

Then register it in `hooks/languages.ts`: a value of `NavigatedLanguage` and an entry of `NAVIGATED_LANGUAGES`. That
is the only place that decides which files are navigated by meaning; the project index, the structure and the four
questions all ask it. `hooks/php/` and `hooks/script/` are the two complete examples.

- **`extensions`**: the project index searches files with these extensions, and the pane analyses them. The test in
  `hooks/languages.test.ts` fails when one of them has no colours or no badge.
- **`symbolsOfFile`**: the declarations of one file, read from its text. It replaces the generic structure of level 3
  for these extensions, so it must find at least what that one found.
- **`declarations`**: one ripgrep search that lists every declaration of the project, run each time the pane opens and
  a search opens. It must stay a single regular expression: see `LanguageDeclarations` for how a printed line is read
  back, and `hooks/project-index.test.ts`, which runs the search on files held in memory.
- **`analysis`**: the four questions, each `(workspace, position) => Promise<answer>`.
  - The `Workspace` (`hooks/workspace.ts`) gives the file list, the indexed declarations, a file's text and a ripgrep
    search. Read only the files a question goes through, never the whole project: that is what keeps the pane
    instant on a project of ten thousand files.
  - What the code does not say for sure is returned as candidates (`certainty: 'candidate'`, drawn `○`), never
    guessed.
  - A question the language has no sense for answers with nothing and a `note` that says why. Go's interfaces have no
    declared implementations, for instance.

Tests: a made-up project of a few files in `hooks/<language>/test-project.ts`, read through `createMemoryWorkspace`
(`hooks/test-workspace.ts`), and one test file per question. Start from the cases the person meets every day: a
method of the class itself, a method of an imported class, a name defined twice.

## Before the pull request

```
claude plugin validate .
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test .
```

Then try it in a real session, on a real project of the language: open a file, hover names, list usages, search. Add
the language to the README's navigation paragraph when it reaches level 5. Pictures and test projects use made-up code
only.

