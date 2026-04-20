#!/usr/bin/env bash
# Convert every SVG in this folder + languages/ to 1024×1024 PNGs under ./png/
# for upload to the Discord Developer Portal.
#
# Requires ImageMagick (magick). On Windows: `scoop install imagemagick` or
# `winget install ImageMagick.ImageMagick`. On macOS: `brew install imagemagick`.

set -e
cd "$(dirname "$0")"

if ! command -v magick >/dev/null 2>&1; then
  echo "error: 'magick' not found in PATH. Install ImageMagick and retry." >&2
  exit 1
fi

mkdir -p png

convert_one() {
  local src="$1"
  local out="png/$(basename "${src%.svg}").png"
  printf "  %-32s -> %s\n" "$src" "$out"
  magick -background none -density 1024 "$src" -resize 1024x1024 "$out"
}

echo "Top-level assets:"
for f in *.svg; do
  [ -f "$f" ] || continue
  convert_one "$f"
done

echo ""
echo "Language icons:"
for f in languages/*.svg; do
  [ -f "$f" ] || continue
  convert_one "$f"
done

count=$(ls png/*.png 2>/dev/null | wc -l)
echo ""
echo "Done — $count PNGs in ./png/"
