#!/usr/bin/env bash
set -euo pipefail

BUMP="${1:-patch}"

case "$BUMP" in
  patch|minor|major) ;;
  *)
    echo "Usage: ./release.sh [patch|minor|major]"
    echo "  Default: patch"
    exit 1
    ;;
esac

CURRENT=$(node -p "require('./package.json').version")
IFS='.' read -r MAJ MIN PAT <<< "$CURRENT"

case "$BUMP" in
  patch) NEXT="$MAJ.$MIN.$((PAT + 1))" ;;
  minor) NEXT="$MAJ.$((MIN + 1)).0" ;;
  major) NEXT="$((MAJ + 1)).0.0" ;;
esac

echo "==> $CURRENT -> $NEXT ($BUMP)"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: working tree is dirty — commit or stash first."
  exit 1
fi

echo "==> typecheck"
npm run typecheck

echo "==> test"
npm test

npm version "$BUMP" --no-git-tag-version > /dev/null
echo "==> bumped package.json to $NEXT"

echo "==> build"
npm run build

echo "==> package vsix"
npx vsce package --no-update-package-json
VSIX="coding-status-for-discord-${NEXT}.vsix"

git add package.json
git commit -m "$(cat <<EOF
chore: release v${NEXT}

Co-Authored-By: Bef <entity@achilles-pc>
EOF
)"

git tag "v${NEXT}"

echo ""
echo "Done. v${NEXT} tagged."
echo "  VSIX:  $VSIX"
echo ""
echo "Next:"
echo "  1. Update CHANGELOG.md"
echo "  2. git push && git push --tags"
