# Contributing

Thanks for taking the time. Bug reports and ideas are welcome as issues; pull requests too, after a word in an issue
first, so that the change and its place in the mod are agreed before the work.

## Branches and releases

- `main` holds released versions only: it is what Claude Code installs.
- Work goes to `develop`, through pull requests whose checks pass.
- A release merges `develop` into `main`, raises `version` in the mod's `.claude-plugin/plugin.json` and tags the
  commit `<mod>--v<version>` (for example `diff-review--v0.3.0`). Installed copies update when that version changes.

## Running a mod from your clone

```
claude --plugin-dir plugins/diff-review
```

Edits reload while the session runs.

## Checks

The same as the CI runs on every pull request:

```
claude plugin validate .
claude plugin validate plugins/diff-review
npx -p typescript@5.9.3 tsc -p tsconfig.json
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test plugins/diff-review
```

A change in behaviour comes with a test that fails without it. `types/claude-code.d.ts` is the plugin API the mods are
typed against; refresh it from a recent Claude Code when the API moves.

## Writing

Code, comments, commit messages and documentation are in English. Pictures and examples use made-up projects and
names, never code from a real company.
