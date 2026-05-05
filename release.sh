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

TAG="v${NEXT}"
VSIX="coding-status-for-discord-${NEXT}.vsix"

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

git add package.json package-lock.json
git commit -m "chore: release ${TAG}"

git tag "$TAG"

echo "==> push"
git push
git push --tags

echo "==> create github release"
gh release create "$TAG" "$VSIX" \
  --title "$TAG" \
  --generate-notes

rm -f "$VSIX"

echo ""
echo "Done. ${TAG} released."
echo "  https://github.com/Achilleees/discord-presence-display/releases/tag/${TAG}"
echo ""
echo "Next: update CHANGELOG.md"
