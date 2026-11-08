#!/usr/bin/env bash
# Publish web/ to the gh-pages branch (GitHub Pages serves it at
# https://<user>.github.io/<repo>/). No bundler: the site is plain ES modules.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BRANCH=gh-pages
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

if ! git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  echo "not a git repository: $ROOT" >&2
  exit 1
fi

cp -r "$ROOT/web/." "$WORK/"
# Pages serves index.html at the directory root; the site is self-contained.
printf '/* off */\nUser-agent: *\nDisallow:\n' > "$WORK/robots.txt"

cd "$WORK"
git init -q
git checkout -q -b "$BRANCH"
git add -A
git -c user.name="oolite-browser deploy" -c user.email="deploy@localhost" commit -qm "Deploy web/ to GitHub Pages

Discord: https://discord.com/channels/1485133645105598678/1568205457808429207"

REMOTE="$(git -C "$ROOT" remote get-url origin)"
git push -q --force "$REMOTE" "$BRANCH"

echo "pushed $BRANCH to $REMOTE"
echo "enable Pages once:"
echo "  gh api repos/\$(gh repo view --json owner -q .owner.login)/\$(gh repo view --json name -q .name)/pages -X POST -f 'source[branch]=gh-pages' -f 'source[path]=/'"
