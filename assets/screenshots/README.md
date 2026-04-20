# README screenshots

Home for hero GIFs and supporting stills referenced by the top-level `README.md`. **Excluded from the VSIX** — the marketplace renders the README's image references directly from this GitHub repo, so these files stay out of the shipped extension.

## Suggested captures

| Filename | What to show | Duration |
|---|---|---|
| `hero.gif` | The activity card on Discord cycling through a handful of spinner words, ideally with a language icon visible | 10–15s |
| `smart-state.gif` *(optional)* | State line transitioning through `Working in X` → `Debugging in X` → `In the terminal` | 15s |
| `settings.png` *(optional)* | A still of the VS Code settings panel showing `claudeSpinner.*` keys | n/a |

## Capture tips

- Record at 1280×720 or larger — the marketplace page scales down cleanly.
- Keep the GIF under ~3 MB so GitHub and the marketplace don't choke when rendering. A palette of ≤128 colours at 15–20 fps usually lands there.
- Tools: ShareX (Windows, free), ScreenToGif (Windows, free), Gifox or Kap (macOS).
- Crop tight around the Discord activity card — full-screen recordings dilute the focal point.

## Referencing from the top-level README

Link captures via relative paths so GitHub and the marketplace both render them inline:

```markdown
![Coding Status for Discord cycling words](assets/screenshots/hero.gif)
```
