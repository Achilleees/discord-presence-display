# Claude Spinner for Discord

**Your Discord status, now Flibbertigibbeting.**

A VS Code extension that cycles through the 187 words from Claude Code's loading spinner as your Discord Rich Presence status — rotating every 15 seconds while you work.

<!-- TODO: Add screenshot/GIF -->

---

## Features

- Zero configuration — install and it works immediately
- 187 words sourced directly from Claude Code's spinner (Cogitating, Moonwalking, Razzle-dazzling, and more)
- Shows the current programming language you have open
- Shows elapsed coding time on your Discord profile
- Auto-reconnects if Discord is restarted
- Silently does nothing if Discord is not running

---

## Install

Search for **Claude Spinner** in the VS Code Extensions panel (`Ctrl+Shift+X`), or install from the Marketplace.

<!-- TODO: Add marketplace badge -->

---

## How it works

When VS Code is open and Discord is running on the same machine, the extension connects to Discord over its local IPC socket and sets your Rich Presence status. Every 15 seconds it picks the next word from the list, so your member list status reads something like `Beboppin'...` and your full profile shows the word, the language you're in, and how long you've been coding. No accounts, no API keys, no setup.

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

## Credits

Word list sourced from [Claude Code](https://claude.ai/claude-code) by Anthropic.

---

## License

MIT
