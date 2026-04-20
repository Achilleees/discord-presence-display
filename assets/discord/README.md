# Discord Dev Portal assets

Source-of-truth for every asset uploaded to the Discord Developer Portal application that backs this extension's Rich Presence. **Excluded from the VSIX** — these files exist so the uploads are reproducible and version-controlled.

## Files in this folder

| File | Discord asset key | Purpose |
|---|---|---|
| `vscode-spinner.svg` | `vscode-spinner` | Large image — the big square on the activity card |
| `claude-logo.svg` | `claude-logo` | Small-image fallback when language is unknown |
| `languages/lang-*.svg` | `lang-*` | Small images for the 43 supported languages (e.g. `lang-typescript.svg` → key `lang-typescript`) |

Filenames match the Discord asset keys consumed in `src/presence.ts`. **Do not rename them** without updating the corresponding constants (`LANG_SUPPORTED`, `FALLBACK_SMALL_IMAGE`, `LARGE_IMAGE_KEY`).

## Upload process

1. **Convert SVGs to PNG.** Discord's Dev Portal only accepts PNG/JPG, so a rasterisation pass is required:

   ```bash
   cd assets/discord
   bash convert.sh          # writes ./png/ with all 45 PNGs at 1024×1024
   ```

   Requires ImageMagick on `PATH`. Install via `scoop install imagemagick` / `winget install ImageMagick.ImageMagick` (Windows), or `brew install imagemagick` (macOS).

2. **Upload to Discord.** Go to https://discord.com/developers/applications → the app → **Rich Presence → Art Assets**. Click **Add Image(s)** and bulk-upload everything under `png/`. Discord uses the filename (minus `.png`) as the asset key by default. Verify the keys match exactly:
   - `vscode-spinner`, `claude-logo`
   - `lang-typescript`, `lang-javascript`, `lang-react`, …

3. Allow a few minutes for Discord's CDN to propagate the new assets. If a small image still shows the fallback after upload, wait 5 min and force-refresh Discord (`Ctrl+R`).

## Sources

- **VS Code logo** — [Devicon](https://devicon.dev/) (MIT)
- **Claude mark** — [Simple Icons](https://simpleicons.org/) (CC0)
- **40 language icons** — Devicon (MIT)
- **json, yaml, sql** — [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme) (MIT)

## Adding a new language

1. Drop `lang-<key>.svg` into `languages/`. Prefer Devicon's `original` variant for consistency; fall back to Material Icon Theme for data-format languageIds not covered there.
2. Add the key to `LANG_SUPPORTED` in `src/presence.ts`.
3. Add the pretty-printed display name to `LANG_DISPLAY` in the same file.
4. If VS Code uses a dialect languageId (e.g. `dockerfile` → `docker`, `typescriptreact` → `react`), add the override to `LANG_ID_OVERRIDES`.
5. Add a test case in `test/presence.test.ts` covering the new key.
6. Re-run `bash convert.sh` and upload the new PNG to the Discord Dev Portal.
