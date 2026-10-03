#!/usr/bin/env bash
# Assembles the public marketplace repository in the given directory: the marketplace manifest and README from this
# folder, the plugin's committed files under plugins/diff-review, then validates both. Nothing is pushed.
set -euo pipefail

target_directory="${1:?usage: build.sh <target directory>}"
plugin_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repository_root="$(git -C "$plugin_directory" rev-parse --show-toplevel)"
plugin_path_in_repository="${plugin_directory#"$repository_root"/}"

mkdir -p "$target_directory/.claude-plugin" "$target_directory/plugins/diff-review"
cp "$plugin_directory/publishing/marketplace.json" "$target_directory/.claude-plugin/marketplace.json"
cp "$plugin_directory/publishing/README.md" "$target_directory/README.md"
cp "$plugin_directory/LICENSE" "$target_directory/LICENSE"

# Only what is committed ships: no local tsconfig, no engine-generated types, no publishing kit.
git -C "$repository_root" ls-files -z -- "$plugin_path_in_repository" |
  while IFS= read -r -d '' tracked_file; do
    relative_path="${tracked_file#"$plugin_path_in_repository"/}"
    case "$relative_path" in publishing/*) continue ;; esac
    mkdir -p "$target_directory/plugins/diff-review/$(dirname "$relative_path")"
    cp "$repository_root/$tracked_file" "$target_directory/plugins/diff-review/$relative_path"
  done

claude plugin validate "$target_directory"
claude plugin validate "$target_directory/plugins/diff-review"
echo "Marketplace assembled in $target_directory"
