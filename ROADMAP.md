# Roadmap

Where this extension is headed, and what I've deliberately chosen not to build. If you want something that isn't here, [open an issue](https://github.com/Achilleees/discord-presence-display/issues) — happy to discuss.

Current state: **v1.0.0 shipped**. See [CHANGELOG.md](./CHANGELOG.md) for the full feature list.

---

## Near-term (1.0.x)

Small polish items for the first few patch releases.

- **Terminal icon** — when `focusContext === 'terminal'`, show a terminal glyph as the small image instead of the last-focused language icon. Keeps the tooltip consistent with the state line ("In the terminal"). About 10 lines of wiring in `presence.ts` plus one asset upload.
- **Hero screenshot/GIF in the README** — big marketplace conversion lever; nothing technical, just needs the capture.
- **More languages, as requested** — the language list is easy to expand. If something you use isn't there, drop an issue with the VS Code `languageId` and I'll add it.

---

## Maybe later (no commitment)

Ideas I've considered but haven't committed to. Reach out if you'd actually use any of these.

- **Per-context cycle speeds** — faster while coding, slower while reviewing a diff. Unclear if the complexity is worth it.
- **Framework detection beyond `languageId`** — Next.js, Nuxt, Rails, Django via workspace-file heuristics (`next.config.js`, `Gemfile`, etc.). Significantly more surface area than languageId-based detection.
- **Theme / colour variations of the marketplace icon** — for users with strong preferences about how the tile looks in their extensions sidebar.
- **Additional idle behaviours** — e.g. "show 'Away' explicitly" rather than pausing silently.

---

## Not doing (permanent)

Design choices, not gaps. Listing them so feature requests can skip these.

- **No telemetry, analytics, or crash reporting.** Ever.
- **No network calls** beyond the local Discord IPC socket.
- **No external integrations** — GitHub, Slack, Linear, etc. are out of scope.
- **No AI-assistant features** inside the extension. It *displays* coding activity; it doesn't augment it.
- **No multi-user or team features.**
- **No remote word packs** (packs fetched over the network). The `customWords` setting handles user-provided words locally.

---

## Intentionally skipped (for now)

Might revisit if there's demand; not rejected.

- **User-loaded word pack JSON files** — `customWords` covers the main use case without adding I/O surface. Full-file packs only make sense if sharing packs becomes a thing.
- **Built-in config profiles** — VS Code's native Profiles already handles per-workspace / per-context settings switching.

---

## Contributing

Small, focused PRs land fastest. For anything structural (architectural changes, new settings, new idle behaviours, non-trivial refactors), open an issue first so we can agree on the shape before you sink time into code.

- [Bugs and feature requests](https://github.com/Achilleees/discord-presence-display/issues)
- [Pull requests](https://github.com/Achilleees/discord-presence-display/pulls) — please run `npm test` and `npm run typecheck` locally before opening

Thanks for being here.
