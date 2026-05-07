# Conventions — `discord-presence-display`

Per-repo overlay seeded from `~/.claude/conventions/REPO-STRUCTURE.md` and `~/.claude/conventions/LANGUAGES.md`. The global spec is the source of truth; this file records project-specific exceptions and reinforcements.

## Inheritance

- **Repo structure:** follows `~/.claude/conventions/REPO-STRUCTURE.md` (no overrides).
- **Language conventions:** follows the JavaScript / TypeScript section of `~/.claude/conventions/LANGUAGES.md`.

## Project-Specific Overrides / Reinforcements

### Commit conventions

- Conventional commits required (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`).
- Subject line under 72 characters.
- **No `Co-Authored-By` lines.** This is a hard rule — they're stripped from history (see commit `69be519` "fix: stop injecting Co-Authored-By in release commits"). Tooling, scripts, and human commits all comply.

### Release flow

- `release.sh` handles patch/minor/major bumps. Aborts on dirty tree or missing CHANGELOG entry.
- VSIX distribution lives on **GitHub Releases**, not in git. `*.vsix` is gitignored; `release.sh` builds → uploads → deletes the local file.
- Marketplace publish is automated via `.github/workflows/publish.yml` on release tag push.

### Test framework

- Vitest 3.2.4 (CommonJS-aware, no Jest, no Mocha).
- Test command: `npm test` (alias for `vitest run`).
- Hand-rolled VS Code API mock at `test/mocks/vscode.ts` — aliased via `vitest.config.ts`.

### Audit registry

- `.docs/audit/NON-ISSUES.md`, `DECISIONS.md`, `KNOWN-BUGS.md` are uppercase per the canonical spec.
- Entries should use **symbol-anchored locations** (`src/extension.ts — applyIdleBehavior 'clear' branch`) rather than line ranges. Line numbers drift; symbol names don't.

### VSIX hygiene

- `.vscodeignore` is the source of truth for what ships to the marketplace.
- `CLAUDE.md`, `.docs/`, `.archive/`, `.ideation/`, `.github/`, `submission/`, `assets/archive/` are all excluded from the VSIX.
- Goal: 8-file VSIX containing `extension.js`, the manifest, README, CHANGELOG, LICENSE, icon, and language icons only.
