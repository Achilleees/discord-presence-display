# Claude Spinner — VS Code Extension Design

## Overview

A VS Code extension that sets Discord Rich Presence to a randomly cycling word from Claude Code's 187 spinner words. Minimal, zero-config, publishable on the VS Code Marketplace.

## Requirements

- Cycle through 187 spinner words as Discord Rich Presence details
- Show current programming language on profile click
- Show elapsed coding time
- Auto-connect/disconnect with VS Code lifecycle
- Silently handle Discord not running
- Clean, efficient, single-file implementation

## Discord Application

- **App name:** "Claude"
- **Client ID:** Baked into extension source (created once on Discord Developer Portal)
- **Rich Presence asset:** Claude logo uploaded as large image

## Presence Display

### Member list (at a glance)

```
Playing Claude
Ruminating...
```

### Profile popup (click to expand)

```
Playing Claude
Ruminating...
Working in TypeScript
03:12 elapsed
```

### Field mapping

| Presence field | Content | Updates |
|---------------|---------|---------|
| Details | Random word + `...` | Every ~15s |
| State | `Working in {languageId}` | On editor switch |
| Large image | Claude logo | Static |
| Timestamps.start | Set on activate | Static per session |

### Edge cases

- No file open: State line hidden, word still cycles
- Unsupported language: Falls back to raw `languageId` string
- Multiple VS Code windows: First window owns the presence (Discord RPC is per-user, not per-app instance)

## Architecture

Single source file (`src/extension.ts`), three concerns wired in `activate()`:

### 1. Discord RPC connection

- Connect on `activate()` using `@xhayper/discord-rpc`
- Disconnect on `deactivate()`
- On disconnect: silently retry every ~30s
- On reconnect: immediately push current word + language state

### 2. Word cycling

- `setInterval` at 15,000ms
- Pick random word from const array (uniform random, no sequential dedup needed)
- Call `client.user.setActivity()` with current word + current language state
- Clear interval on `deactivate()`

### 3. Language detection

- Listen to `vscode.window.onDidChangeActiveTextEditor`
- Read `editor.document.languageId`
- Store as module-level variable, include in next `setActivity` call
- Null when no active editor (omit State line)

## File structure

```
discord-presence-display/
  src/
    extension.ts        # Entire extension
  assets/
    icon.png            # Marketplace icon
  package.json          # Extension manifest
  tsconfig.json
  .vscodeignore
  README.md
```

## Dependencies

| Package | Purpose |
|---------|---------|
| `@xhayper/discord-rpc` | Discord IPC connection |
| `@types/vscode` | VS Code API types (dev) |
| `typescript` | Compilation (dev) |
| `@vscode/vsce` | Packaging/publishing (dev) |

## Reconnection strategy

```
Discord disconnects or not found
  → wait 30s
  → attempt connect
  → if fail, wait 30s, retry
  → if success, resume cycling immediately
```

No exponential backoff needed — this is a local IPC socket, not a rate-limited API.

## Constraints

- No user configuration in v1 (word list, speed, display format are hardcoded)
- No status bar items or commands — extension is invisible in VS Code UI
- No telemetry or network calls beyond local Discord IPC
- Client ID is public (this is standard for Discord Rich Presence apps)

## Prerequisites (manual, one-time)

1. Create a Discord Application at https://discord.com/developers/applications
2. Name it "Claude"
3. Copy the Application/Client ID — this gets hardcoded in `extension.ts`
4. Upload a Claude logo as a Rich Presence asset (key: `claude-logo`)

## Future (v1.1, only if requested)

- VS Code settings: custom word list, cycle speed, toggle language display
- Marketplace publication
- Small image for language icon
