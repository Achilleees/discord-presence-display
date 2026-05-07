# Claude Code — Project Instructions

Project-specific context for Claude Code working in this repo. Pairs with the user's global `~/.claude/CLAUDE.md` (which has personal preferences) and `~/.claude/conventions/` (which has cross-project specs).

## What this is

A VS Code extension that shows your coding activity as Discord Rich Presence. Single-purpose, single-maintainer, marketplace-published.

- **Stack:** TypeScript + esbuild + Vitest, single runtime dep on `@xhayper/discord-rpc`.
- **Entry point:** `src/extension.ts` (the largest, most imperative module — by design).
- **Pure modules:** `words.ts`, `presence.ts`, `transitions.ts`, `state.ts`.
- **Adapters:** `discord-client.ts`, `instance-lock.ts`, `config.ts`.

For the high-level structure map and conceptual layers see `.docs/OVERVIEW.md`. For project-specific conventions see `.docs/CONVENTIONS.md`.

## Hard rules

- **Discord stays silent.** Never surface Discord errors to the user. All IPC operations are fire-and-forget with silent fallbacks. This is a load-bearing project invariant — see `NON-ISSUES.md`.
- **`state.startTimestamp` = VS Code session, not extension enable.** README documents this; don't "fix" it.
- **Case-sensitive custom-word dedup is intentional.** README and `NON-ISSUES.md` both document it.
- **No `Co-Authored-By` in commits.** Project convention. Hard rule.

## Workflow expectations

- Run `npm test` after any code change. Baseline: 214 tests passing across 8 files (vitest 3.2.4).
- Use conventional commits, subject under 72 chars.
- Use `release.sh` for version bumps — never edit `package.json` version manually.
- Keep findings symbol-anchored (`src/extension.ts — applyIdleBehavior 'clear' branch`), not line-anchored.

## Things to skip

- Don't read `.archive/` or `.ideation/` — they're intentionally invisible to skills (per canonical spec).
- Don't read ephemeral pipeline reports unless explicitly asked: `audit-*.md`, `verified-*.md`, `janitor-*.md`, `architecture-*.md`, `regression-*.md`, `test-audit-*.md`, `generation-log-*.md`, `test-verified-*.md`.
- Don't add issue templates / CONTRIBUTING.md — tracked in ROADMAP.md and intentionally deferred.

## VSIX bundle hygiene

The marketplace VSIX must stay lean (~8 files). `.vscodeignore` is the source of truth. Verify with `npx vsce package --no-update-package-json` and inspect the file list before committing changes that affect bundling.

## Skill entry points

- `/audit` for code-logic findings; reads `NON-ISSUES.md` and `DECISIONS.md` to skip sanctioned patterns.
- `/janitor` for repo hygiene; reads `~/.claude/conventions/REPO-STRUCTURE.md`.
- `/test` for test coverage gaps; reads `.docs/test/inventory.md`.
- `/setup-repo` if scaffolding ever falls out of sync with the global spec.
