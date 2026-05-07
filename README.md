# Coding Status for Discord

*Your Discord status, now Flibbertigibbeting.*

**Show what you're working on — at a glance, on Discord.**

A VS Code extension that turns your editor activity into Discord Rich Presence: the language you're in, the time you've been at it, and a rotating spinner word borrowed from Claude Code's loading animation — so your status reads `Cogitating...`, `Moonwalking...`, or the occasional `Flibbertigibbeting...` while you code.

---

## Features

- Zero configuration — install and it works
- 187 spinner words from Claude Code, rotating every 15 seconds (configurable)
- Language detection with per-language icons for 43 languages (and growing)
- Session elapsed time shown on your Discord profile
- **Smart state:** changes the status line when you're debugging, reviewing a diff, or focused on the terminal
- **Idle handling:** slows down, pauses, or clears presence when VS Code loses focus for too long
- **Toggle command:** hide presence any time from the command palette
- Auto-reconnects if Discord is restarted
- Silently does nothing if Discord isn't running — no errors, no noise
- No telemetry, no network calls beyond the local Discord IPC socket

---

## How it works

When VS Code is open and Discord is running on the same machine, the extension connects to Discord over its local IPC socket and sets your Rich Presence. Every 15 seconds it rotates to a new spinner word. No accounts, no API keys, no setup.

---

## Commands

| Command | Description |
|---|---|
| `Toggle Coding Status Presence` | Pause or resume the presence. Paused clears the presence from Discord entirely. State does not persist across VS Code restarts. |

---

## Settings

All settings live under the `claudeSpinner.*` namespace (internal ID, kept stable across renames) and live-reload on change.

| Setting | Type | Default | What it does |
|---|---|---|---|
| `claudeSpinner.enabled` | boolean | `true` | Master switch. Off → disconnect from Discord. |
| `claudeSpinner.cycleSpeed` | number (5–120) | `15` | Seconds between word rotations. 5s minimum respects Discord's rate limit. |
| `claudeSpinner.cycleWords` | boolean | `true` | Rotate the word. Off → pick one word on activation and keep it. |
| `claudeSpinner.customWords` | string[] | `[]` | Extra words mixed into the rotation. Each entry 1–125 characters. Case-sensitive — `"working"` and built-in `"Working"` both appear. |
| `claudeSpinner.showLanguage` | boolean | `true` | Show the `Working in X` line beneath the cycling word. |
| `claudeSpinner.showWorkspace` | boolean | `false` | Append the workspace folder name to the status line. Off by default for privacy. |
| `claudeSpinner.showElapsedTime` | boolean | `true` | Show the session elapsed time on your profile. Counts from when VS Code opened, not from when the extension was last enabled — disabling and re-enabling does not reset the timer. |
| `claudeSpinner.showLanguageIcon` | boolean | `true` | Use a per-language icon as the small overlay. Falls back to the Claude logo. |
| `claudeSpinner.smartState` | boolean | `true` | Vary the status line when debugging, reviewing a diff, or focused on the terminal. |
| `claudeSpinner.idleBehavior` | `slow` / `pause` / `clear` / `none` | `slow` | What happens when VS Code loses focus past the idle threshold. |
| `claudeSpinner.idleThresholdMinutes` | number (1–60) | `5` | Minutes of inactivity before idle mode engages. |
| `claudeSpinner.wordRarity` | boolean | `false` | Opt-in weighted pick — common (~70%), uncommon (~25%), rare (~5%). |
| `claudeSpinner.timeBasedPools` | boolean | `false` | Opt-in bias by session length — warming-up, in-the-zone, deep-session word groups. Tier classification uses a monotonic clock that pauses during system sleep on macOS/Linux, so multi-hour sleeps may briefly desynchronize the displayed tier from Discord's wall-clock elapsed time until the session resumes ticking. |

### Smart state priority

When `smartState` is on, the status line follows this priority:

1. Debug session active → `Debugging in {language}`
2. Active tab is a diff editor → `Reviewing in {language}`
3. Terminal is the active panel → `In the terminal`
4. Otherwise → `Working in {language}`

Toggle `showWorkspace` to append ` — {workspace}` to rules 1–4 above. When no language is detected and no smart trigger is active, the entire state line is omitted — there is no standalone workspace-only line.

### Idle behaviors

When VS Code loses focus for `idleThresholdMinutes`:

- `slow` — the cycle interval quadruples (clamped to 120s)
- `pause` — cycling stops, last presence stays visible
- `clear` — cycling stops, presence cleared from Discord
- `none` — no change, keep cycling normally

Re-focusing pushes a fresh presence immediately and restores the normal cycle.

---

## Language icons

Dedicated icons for 43 languages and frameworks — anything else falls back to the Claude logo while keeping its name in the tooltip.

<details>
<summary>Full list</summary>

TypeScript, JavaScript, React *(.tsx / .jsx)*, Vue, Svelte, Astro, Python, Rust, Go, Java, C, C++, C#, HTML, CSS, Ruby, PHP, Swift, Kotlin, Dart, Lua, Elixir, Haskell, Scala, Shell *(+ bash, zsh, fish)*, SQL, JSON, YAML, Markdown, R, MATLAB, Julia, OCaml, F#, Clojure, Erlang, Perl, Groovy, PowerShell, Objective-C *(+ Objective-C++)*, GraphQL, Docker, LaTeX.

</details>

Missing one you use? [Open an issue](https://github.com/Achilleees/discord-presence-display/issues) and I'll add it.

---

## The Word List

<details>
<summary>All 187 words (click to expand)</summary>

```
Accomplishing       Actioning           Actualizing
Architecting        Baking              Beaming
Beboppin'           Befuddling          Billowing
Blanching           Bloviating          Boogieing
Boondoggling        Booping             Bootstrapping
Brewing             Bunning             Burrowing
Calculating         Canoodling          Caramelizing
Cascading           Catapulting         Cerebrating
Channeling          Channelling         Choreographing
Churning            Clauding            Coalescing
Cogitating          Combobulating       Composing
Computing           Concocting          Considering
Contemplating       Cooking             Crafting
Creating            Crunching           Crystallizing
Cultivating         Deciphering         Deliberating
Determining         Dilly-dallying      Discombobulating
Doing               Doodling            Drizzling
Ebbing              Effecting           Elucidating
Embellishing        Enchanting          Envisioning
Evaporating         Fermenting          Fiddle-faddling
Finagling           Flambéing           Flibbertigibbeting
Flowing             Flummoxing          Fluttering
Forging             Forming             Frolicking
Frosting            Gallivanting        Galloping
Garnishing          Generating          Gesticulating
Germinating         Gitifying           Grooving
Gusting             Harmonizing         Hashing
Hatching            Herding             Honking
Hullaballooing      Hyperspacing        Ideating
Imagining           Improvising         Incubating
Inferring           Infusing            Ionizing
Jitterbugging       Julienning          Kneading
Leavening           Levitating          Lollygagging
Manifesting         Marinating          Meandering
Metamorphosing      Misting             Moonwalking
Moseying            Mulling             Mustering
Musing              Nebulizing          Nesting
Newspapering        Noodling            Nucleating
Orbiting            Orchestrating       Osmosing
Perambulating       Percolating         Perusing
Philosophising      Photosynthesizing   Pollinating
Pondering           Pontificating       Pouncing
Precipitating       Prestidigitating    Processing
Proofing            Propagating         Puttering
Puzzling            Quantumizing        Razzle-dazzling
Razzmatazzing       Recombobulating     Reticulating
Roosting            Ruminating          Sautéing
Scampering          Schlepping          Scurrying
Seasoning           Shenaniganing       Shimmying
Simmering           Skedaddling         Sketching
Slithering          Smooshing           Sock-hopping
Spelunking          Spinning            Sprouting
Stewing             Sublimating         Swirling
Swooping            Symbioting          Synthesizing
Tempering           Thinking            Thundering
Tinkering           Tomfoolering        Topsy-turvying
Transfiguring       Transmuting         Twisting
Undulating          Unfurling           Unravelling
Vibing              Waddling            Wandering
Warping             Whatchamacalliting  Whirlpooling
Whirring            Whisking            Wibbling
Working             Wrangling           Zesting
Zigzagging
```

</details>

---

## Requirements

- Discord desktop app running on the same machine as VS Code
- That's it

---

## Privacy

- No telemetry, ever
- No network calls beyond the local Discord IPC socket
- `showWorkspace` is off by default — your folder name never leaves your machine unless you turn it on

---

## Thanks

Thanks for installing! If you enjoy it, [a star on GitHub](https://github.com/Achilleees/discord-presence-display) goes a long way — it's honestly how I decide what to keep polishing. Bugs, feature requests, and new-language suggestions are all welcome in [issues](https://github.com/Achilleees/discord-presence-display/issues).

---

## Credits

The spinner word list comes from [Claude Code](https://claude.ai/claude-code) by Anthropic. Most language icons are from [Devicon](https://devicon.dev/); a few data-format icons (JSON, YAML, SQL) come from the [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme) — both MIT-licensed. The Anthropic logomark is from [Simple Icons](https://simpleicons.org/) (CC0), and the VS Code logo is from Devicon. Rich Presence integration is powered by [@xhayper/discord-rpc](https://github.com/xhayper/discord-rpc).

Huge thanks to every maintainer of those projects.

---

## License

MIT
