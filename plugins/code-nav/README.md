# code-nav

A read-only code navigation pane inside [Claude Code](https://code.claude.com): find a file, a class or a method by a
few letters, click a name to go to its declaration, list its usages and its implementations. Nothing is indexed ahead
of time, so it is ready the moment it opens, on a project of ten thousand files too.

It is there for the moment Claude says "this method does that" and you want to see it with your own eyes, without
starting an IDE: ask Claude to show it, or open it yourself.

**A personal tool.** code-nav was built for my own reading and is mostly tested on my own machine, under Linux.
Another system, terminal or language may well bring out bugs I have never met. If you hit one, an
[issue](https://github.com/nicolas-codemate/claude-code-mods/issues) is welcome, a pull request even more: see
[how to contribute](../../CONTRIBUTING.md).

## Install

```
/plugin marketplace add nicolas-codemate/claude-code-mods
/plugin install code-nav@codemate-mods
```

Then run `/code-nav`, alone or followed by a file (`/code-nav src/Order.php:42`) or a name
(`/code-nav OrderRepository::save`). It needs [ripgrep](https://github.com/BurntSushi/ripgrep) (`rg`) on the `PATH`.

## Claude shows you code

Ask in your own words: "show me that file", "show me where the total is computed", "open OrderRepository::save". Claude
calls the mod's `show` tool with a path and a line, or with a class or method name, and the pane opens on it beside the
conversation, the keyboard left in the prompt. The files Claude read or wrote in the session are listed with your
recent files when the search opens.

## Show Claude some lines

Select lines of the code with the mouse, as you would to copy them: the bar under the header says `◆ Claude sees
lines 43-45 with your next message`, and the next message you send carries those lines, with the file and their
numbers, for Claude to read; as you type it, the prompt ends with a dim `◆ Order.php:43-45 → Claude`. Ask "why is this null here?" and Claude knows which lines "this" is. The conversation
shows your message alone. `×` beside the notice keeps that selection out of your messages.

## Find anything by a few letters

`f` opens the search over the files, classes, interfaces, functions and methods of the project, ranked as you type:

- `OrRe` or `ordrepo` finds `OrderRepository`, camel-case humps and word starts counting most;
- `Order::save` (or `Order.save`) finds the method in the classes that match;
- `src/Order` matches against whole paths;
- `Order:42` opens the file on line 42, `:42` goes to that line of the file shown (`g`, or `↧ Line` in the bar under
  the header, asks for the line number alone, saying how many lines the file has);
- with nothing typed, the files you last opened and the ones Claude touched.

`↑` and `↓` pick a row while you keep typing, Enter opens it.

`r`, or `☰ Structure` in the bar under the header, shows the structure of the file shown in a frame in the middle of
the code, the code dimmed behind it: its declarations top to bottom, each indented under the one holding it, the one
you are reading already picked. A few letters filter them, Enter or a click goes to one. PHP, TypeScript, JavaScript
and Vue are read by the mod's own analysis; Python, Go, Rust, Java, Kotlin, C#, Scala, Swift, Dart, C and C++, Ruby,
Elixir, Lua, Perl and shell scripts by the shape of their declarations; and files that are not code by their own
structure: the headings of Markdown and AsciiDoc, the keys of YAML, JSON, TOML, INI and `.env` files, the rules of
CSS, SCSS and LESS, the targets of a Makefile, the stages of a Dockerfile, the tables and functions of SQL, the blocks
of Twig and Jinja, the elements with an `id` in XML and HTML.

`l` searches a text in the file shown, `o` in the whole project: `↑` and `↓` in the field, or a click, switch between
the two.
In the file shown the matches are listed and lit as you type, the code scrolling to the first, and Enter goes to it;
in the whole project Enter lists every line holding the text. A text typed in lower case matches any case, one with a
capital letter that case only. The lines found are walked as any list under the code.

The bar under the header holds them within a click, by what they act on: `FILE ☰ Structure · ↧ Line · ⌕ Search`, then
`PROJECT ⌕ Find · ⌕ Search`, then `◆ Bookmarks`.
Once a text is searched it shows the text and where you stand among its matches (`3 / 18`), with `◀ previous` and
`next ▶` to go from one to the other and `×` to clear the search. In the file shown the code itself goes to the match;
a match in another file is previewed above the list.

## Click a name

Every name in the code is a button. As the pointer rests on one, a small tag appears right above it and says where a
click on it goes:

- `↪ go to definition` on a method call, a property, a class, a function, a variable;
- `↪ list usages` on a declaration, the usages then listed under the code.

A click on the tag goes there. A click on the name itself only points at it, the reading staying where it is: `u` and
`i` then ask about it, and text can still be selected with the mouse as anywhere else.

When there is nowhere to go (no declaration, no usage, a function of PHP itself), a small frame says so right above
the name clicked. It goes after three seconds, at the next move, with its `×` or with Escape.

Then `u` lists the usages of the name the pane points at, and `i` its implementations: the classes implementing an
interface or extending a class, or their versions of a method. The key left of the home row (`q` on an AZERTY keyboard,
`a` on a QWERTY one) goes back to where you were, `d` forward again, as an editor's history does.

Over a declaration, `↑ parents`, beside `↪ list usages`, goes up the hierarchy: the classes and interfaces a class
extends or implements, or the methods a method overrides or implements, nearest first, dependencies included (PHP,
TypeScript, JavaScript, Vue). The only one there is opens at once.

## Reading a file

The header tells where the reading stands after the path: `› OrderRepository › save()`, the declarations holding the
line pointed at, or the first line shown; a click on them opens the structure of the file.

A line wider than the pane ends with `…`: a click on it scrolls the code to the right, half its width at a time, and
the lines then start with `‹`, a click on which scrolls back; the header says from which column the code is shown.

A click on the number of a line sets a bookmark, `◆` in the margin; a second click takes it off. `◆ Bookmarks`, in the
bar under the header, lists them all, across files, to walk and open as any list; `× remove` on a row takes that
bookmark off, even one whose line has left its file. They are kept for the project.

When the list under the code is open, a click on a row, or the keys above and below (`z` or `w`, and `s`) walking it
row by row, previews its place between the code and the list: half the height of the pane, up to thirty lines, the
occurrence lit a third of the way down, in a frame, while the file you read stays where it is, dimmed behind it. The wheel over the preview scrolls
it through the rest of its file. `↗ open`, right of the place on every row, goes straight into the file, in a tab, as
do `Open file ⏎` on the preview, a second click on the row or Enter; Escape closes the preview. The occurrences listed are lit in the file shown. `x` closes the list.

## Tabs on the left, files on the right

The tabs take a column left of the code, one under the other with the directory of each file under its name. `unpin`
in their title, or `0`, folds them behind the `≡ Tabs` button at the left of the header, a compact strip of tabs
taking their place above the code; the button or `0` then slides them open over the left of the code, and picking a
tab, a click in the code or Escape folds them back. `pin` keeps them in their column again. The files of the project fold behind the `≡ Files` button at the
right of the header: a click on it, or `v`, slides them open over the right of the code. Opening a file from them, a click in the code
or Escape folds them back. `pin`, in their title, keeps them in a column of their own right of the code instead,
`unpin` folds them again. Drag the edge of a column to widen it. When the pane is too narrow, the tabs go into the
strip and pinned files back into the drawer.

**Tabs.** Every file opened, from the search, a click on a name, a row of a list, the explorer or Claude, opens in a
tab of its own, or goes back to its tab when it is already open; each tab keeps where it was scrolled.  `n` and `p` go to the next and previous tab, `1` to `9` to the tab of that number.
`c` closes the tab shown (or `×` on any tab); the row under the title of the tabs closes the tabs above it or below
it, the others or all of them: `close above · below · others · all`. The tabs opened for good come back the next time the pane opens on the project.

**Files.** Every directory of the project, what git ignores included: `vendor/` and `node_modules/` are listed as
any other, drawn dim, and read only when opened, so nothing is indexed ahead. A directory is drawn in gold with a
slash after its name, a file with a dot in the color of its kind. A click opens a directory or a file. The field above the tree searches the files alone by a few
letters of their path, as `f` does (`ordrepo`, `entity/order`); the files found take the place of the tree, `↑` and `↓`
pick one, Enter opens it, Escape empties the field. Opened with `v`, the files hand that field the keyboard at once.
The search covers the project's own files; a dependency is reached through the tree.
The file shown has its directories opened and its row lit; `⊟ fold all` folds everything back.

## How names are resolved, with no index

A language server answers these questions from an index of the whole project, dependencies included, which is what
takes minutes to build and gigabytes to hold. code-nav reads only the files a question goes through:

- **PHP.** A class name is resolved through the file's `namespace` and `use` statements, then located by Composer's
  own autoload tables, which cover the project and every dependency: `vendor/` is never scanned, yet a click on a
  Doctrine or Symfony method opens it, marked as a dependency. A member is resolved by inferring the type of what it
  is called on, hop by hop: `$this`, typed properties and promoted constructor parameters, typed parameters, local
  variables from their assignments, return types, `foreach` over typed collections, docblocks and their generics
  (`@extends ServiceEntityRepository<Order>`, `@return Collection<int, Order>`).
- **TypeScript, JavaScript, Vue.** A name is followed through the file's imports, path aliases of `tsconfig.json`
  and re-exports included, to the file that declares it. In a Vue component, a name or a component tag clicked in the
  template resolves against the script block.
- **Any other language.** A name is looked up as a word among the project's declarations.

When the type cannot be inferred, the pane says so instead of guessing: it lists every declaration of that name, the
most plausible first, marked `○` (not verified) where an inferred answer is marked `●`. Usages are marked the same
way: `●` when the analysis proved the call is made on that class, `○` when the name matches and the type could not be
read.

The project's file and declaration lists come from two or three `rg` runs that take a few tens of milliseconds and are
made again when the search opens, so there is nothing to keep up to date. What git ignores is left out of them.

## Limits

- The wheel scrolls up and down only: a long line is scrolled sideways from its `…` and `‹` marks.
- PHP types are inferred from what the code declares: an untyped closure parameter, a value coming out of `__call`
  or of a service container, a variable assigned in one branch only are listed as candidates rather than resolved.
  TypeScript is followed through imports and declared types, not inferred: an untyped callback parameter or a `v-for`
  item falls back to candidates.
- Usages of a very common method name are analysed up to a thousand matches; the title then shows a `+`, and when none
  of those matches is a usage the note says the search stopped there rather than that there is none.
- A file over about 1.5 MB is shown without colors and without clickable names.
- A Ctrl+click is a click: the terminal does not tell the pane which one it was, hence the tag over a name to go to
  its declaration.

## Keyboard

Everything works with the mouse. Every action also has a key while the pane holds the keyboard (click in it, or use
Claude Code's focus chord); `h` lists them all. A key the pane does not use goes to the prompt, as in any pane.
Escape closes the search or the help, then the pane; the search, the structure and the line to go to also close from
the `×` of their frame, or by a click on any other button of the pane, which then does what it does; the wheel and Page Up / Page Down scroll the code, `j` and `k`
a few lines at a time. The mouse selects text in the code as anywhere else in Claude Code.

## Settings

In `/config`, under code-nav:

- **Theme**: `auto` follows the theme of Claude Code (`/theme`), `dark` or `light` force one.

## Requirements

- Claude Code with mods support (tested with 2.1.328), in the terminal. The Desktop app, VS Code and mobile show a
  notice instead of the pane.
- `rg` (ripgrep) for the file list, the declarations and the text search.

## Development

```
claude plugin validate .
claude plugin test .
```

The hooks module is `hooks/register.tsx`; pure logic sits beside it, one folder per analysed language (`hooks/php/`,
`hooks/script/`), the coloring under `hooks/syntax/` and the drawing under `hooks/view/`.

## License

MIT
