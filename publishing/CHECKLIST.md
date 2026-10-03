# Publishing diff-review

The plugin is developed here, in `mods/diff-review`; the public repository `nicolas-codemate/claude-code-mods` is a
marketplace assembled from it by `build.sh`.

## Decisions to confirm before the first release

- Repository: `nicolas-codemate/claude-code-mods` (named in `plugin.json`, `marketplace.json`, both READMEs).
- Marketplace name: `codemate-mods` (users install with `/plugin install diff-review@codemate-mods`).
- License: MIT, copyright "Nicolas".
- Author shown: "Nicolas", https://github.com/nicolas-codemate, no email.

## Release

1. In this repository: `claude plugin validate mods/diff-review` and `claude plugin test mods/diff-review` pass, the
   change is committed, `version` in `.claude-plugin/plugin.json` is raised.
2. `mods/diff-review/publishing/build.sh <clone of claude-code-mods>`: it copies the committed files and validates the
   marketplace and the plugin.
3. In the clone: review the diff (no client name, path or address), commit, tag `diff-review-v<version>`, push.
4. Try it from scratch in a throwaway session:
   `/plugin marketplace add nicolas-codemate/claude-code-mods`, `/plugin install diff-review@codemate-mods`,
   `/diff-review` in a repository with changes and in one with a pull request.

## First release only

- Create the empty public repository `nicolas-codemate/claude-code-mods` on GitHub.
- Remove `mods/diff-review` from `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` once installed from the
  marketplace, or the two copies load side by side.
