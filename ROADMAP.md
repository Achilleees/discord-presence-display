# Roadmap

- [ ] Publish to Open VSX Registry — `publish.yml` already supports it; needs an `OVSX_PAT` secret and a one-time namespace claim. Adds reach to Cursor, VSCodium, and Theia-based editors.
- [ ] Terminal focus icon — swap the small image to a terminal glyph when `focusContext === 'terminal'` (state line is already wired; asset and icon-override logic still pending)
- [ ] Hero screenshot/GIF at the top of the README
- [ ] Keybinding for `claudeSpinner.toggle`
- [ ] PR-validation CI — `npm test && npm run typecheck && npm run build` on every pull request
- [ ] Issue templates for bug reports and language requests
- [ ] Per-context cycle speeds (slower while reviewing a diff, faster while coding)
- [ ] Framework detection beyond `languageId` (Next.js, Nuxt, Rails via workspace heuristics)
