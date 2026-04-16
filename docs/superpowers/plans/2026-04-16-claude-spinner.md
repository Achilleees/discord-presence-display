# Claude Spinner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a VS Code extension that displays rotating Claude Code spinner words as Discord Rich Presence.

**Architecture:** Two source files — `words.ts` (data + pure helper) and `extension.ts` (VS Code lifecycle + Discord RPC). On activation, the extension connects to Discord's local IPC, starts a 15-second interval that picks a random word and pushes it as Rich Presence details, and tracks the active editor language for the state line.

**Tech Stack:** TypeScript, VS Code Extension API, `@xhayper/discord-rpc` v1.3.x, vitest

**Prerequisite (manual, one-time):** Create a Discord Application at https://discord.com/developers/applications named "Claude", copy the Client ID, and upload a Claude logo as a Rich Presence asset with key `claude-logo`.

---

### File Structure

```
discord-presence-display/
  src/
    words.ts            # Word list array + getRandomWord()
    extension.ts        # activate/deactivate, Discord RPC, word cycling, language detection
  test/
    words.test.ts       # Unit tests for word list integrity and getRandomWord
  package.json          # Extension manifest + dependencies
  tsconfig.json         # TypeScript config targeting CommonJS for VS Code
  vitest.config.ts      # Test runner config
  .vscodeignore         # Exclude source/test from packaged extension
  .gitignore
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.vscodeignore`
- Create: `.gitignore`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "discord-presence-display",
  "displayName": "Claude Spinner",
  "description": "Displays rotating Claude Code spinner words as your Discord Rich Presence",
  "version": "0.1.0",
  "engines": {
    "vscode": "^1.85.0"
  },
  "categories": [
    "Other"
  ],
  "activationEvents": [
    "onStartupFinished"
  ],
  "main": "./dist/extension.js",
  "scripts": {
    "build": "tsc",
    "watch": "tsc --watch",
    "test": "vitest run",
    "package": "vsce package"
  },
  "dependencies": {
    "@xhayper/discord-rpc": "^1.3.0"
  },
  "devDependencies": {
    "@types/vscode": "^1.85.0",
    "@vscode/vsce": "^3.0.0",
    "typescript": "^5.5.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2021",
    "module": "commonjs",
    "lib": ["ES2021"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create `.vscodeignore`**

```
.vscode/**
node_modules/**
src/**
test/**
docs/**
dist/**/*.map
tsconfig.json
vitest.config.ts
.gitignore
```

- [ ] **Step 5: Create `.gitignore`**

```
node_modules/
dist/
*.vsix
```

- [ ] **Step 6: Install dependencies**

Run: `npm install`
Expected: `added X packages` with no errors. `node_modules/` created, `package-lock.json` generated.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .vscodeignore .gitignore
git commit -m "scaffold: project setup with dependencies"
```

---

### Task 2: Word List and Helper (TDD)

**Files:**
- Create: `test/words.test.ts`
- Create: `src/words.ts`

- [ ] **Step 1: Write failing tests**

Create `test/words.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { WORDS, getRandomWord } from '../src/words';

describe('WORDS', () => {
  it('contains exactly 187 words', () => {
    expect(WORDS).toHaveLength(187);
  });

  it('has no duplicates', () => {
    expect(new Set(WORDS).size).toBe(WORDS.length);
  });

  it('contains only non-empty strings', () => {
    for (const word of WORDS) {
      expect(word.length).toBeGreaterThan(0);
    }
  });
});

describe('getRandomWord', () => {
  it('returns a word from the list', () => {
    const word = getRandomWord();
    expect(WORDS as readonly string[]).toContain(word);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run`
Expected: FAIL — `Cannot find module '../src/words'`

- [ ] **Step 3: Implement `src/words.ts`**

```typescript
export const WORDS = [
  'Accomplishing',
  'Actioning',
  'Actualizing',
  'Architecting',
  'Baking',
  'Beaming',
  "Beboppin'",
  'Befuddling',
  'Billowing',
  'Blanching',
  'Bloviating',
  'Boogieing',
  'Boondoggling',
  'Booping',
  'Bootstrapping',
  'Brewing',
  'Bunning',
  'Burrowing',
  'Calculating',
  'Canoodling',
  'Caramelizing',
  'Cascading',
  'Catapulting',
  'Cerebrating',
  'Channeling',
  'Channelling',
  'Choreographing',
  'Churning',
  'Clauding',
  'Coalescing',
  'Cogitating',
  'Combobulating',
  'Composing',
  'Computing',
  'Concocting',
  'Considering',
  'Contemplating',
  'Cooking',
  'Crafting',
  'Creating',
  'Crunching',
  'Crystallizing',
  'Cultivating',
  'Deciphering',
  'Deliberating',
  'Determining',
  'Dilly-dallying',
  'Discombobulating',
  'Doing',
  'Doodling',
  'Drizzling',
  'Ebbing',
  'Effecting',
  'Elucidating',
  'Embellishing',
  'Enchanting',
  'Envisioning',
  'Evaporating',
  'Fermenting',
  'Fiddle-faddling',
  'Finagling',
  'Flambéing',
  'Flibbertigibbeting',
  'Flowing',
  'Flummoxing',
  'Fluttering',
  'Forging',
  'Forming',
  'Frolicking',
  'Frosting',
  'Gallivanting',
  'Galloping',
  'Garnishing',
  'Generating',
  'Gesticulating',
  'Germinating',
  'Gitifying',
  'Grooving',
  'Gusting',
  'Harmonizing',
  'Hashing',
  'Hatching',
  'Herding',
  'Honking',
  'Hullaballooing',
  'Hyperspacing',
  'Ideating',
  'Imagining',
  'Improvising',
  'Incubating',
  'Inferring',
  'Infusing',
  'Ionizing',
  'Jitterbugging',
  'Julienning',
  'Kneading',
  'Leavening',
  'Levitating',
  'Lollygagging',
  'Manifesting',
  'Marinating',
  'Meandering',
  'Metamorphosing',
  'Misting',
  'Moonwalking',
  'Moseying',
  'Mulling',
  'Mustering',
  'Musing',
  'Nebulizing',
  'Nesting',
  'Newspapering',
  'Noodling',
  'Nucleating',
  'Orbiting',
  'Orchestrating',
  'Osmosing',
  'Perambulating',
  'Percolating',
  'Perusing',
  'Philosophising',
  'Photosynthesizing',
  'Pollinating',
  'Pondering',
  'Pontificating',
  'Pouncing',
  'Precipitating',
  'Prestidigitating',
  'Processing',
  'Proofing',
  'Propagating',
  'Puttering',
  'Puzzling',
  'Quantumizing',
  'Razzle-dazzling',
  'Razzmatazzing',
  'Recombobulating',
  'Reticulating',
  'Roosting',
  'Ruminating',
  'Sautéing',
  'Scampering',
  'Schlepping',
  'Scurrying',
  'Seasoning',
  'Shenaniganing',
  'Shimmying',
  'Simmering',
  'Skedaddling',
  'Sketching',
  'Slithering',
  'Smooshing',
  'Sock-hopping',
  'Spelunking',
  'Spinning',
  'Sprouting',
  'Stewing',
  'Sublimating',
  'Swirling',
  'Swooping',
  'Symbioting',
  'Synthesizing',
  'Tempering',
  'Thinking',
  'Thundering',
  'Tinkering',
  'Tomfoolering',
  'Topsy-turvying',
  'Transfiguring',
  'Transmuting',
  'Twisting',
  'Undulating',
  'Unfurling',
  'Unravelling',
  'Vibing',
  'Waddling',
  'Wandering',
  'Warping',
  'Whatchamacalliting',
  'Whirlpooling',
  'Whirring',
  'Whisking',
  'Wibbling',
  'Working',
  'Wrangling',
  'Zesting',
  'Zigzagging',
] as const;

export function getRandomWord(): string {
  return WORDS[Math.floor(Math.random() * WORDS.length)];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run`
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/words.ts test/words.test.ts
git commit -m "feat: add spinner word list with 187 words"
```

---

### Task 3: Extension Core — Discord RPC + Cycling + Language Detection

**Files:**
- Create: `src/extension.ts`

- [ ] **Step 1: Implement `src/extension.ts`**

```typescript
import * as vscode from 'vscode';
import { Client } from '@xhayper/discord-rpc';
import { getRandomWord } from './words';

const CLIENT_ID = 'REPLACE_WITH_YOUR_CLIENT_ID';

let client: Client | null = null;
let cycleInterval: ReturnType<typeof setInterval> | undefined;
let reconnectTimeout: ReturnType<typeof setTimeout> | undefined;
let currentLanguage: string | undefined;
let startTimestamp: Date;

function setPresence(): void {
  if (!client?.isConnected) return;
  client.user?.setActivity({
    details: `${getRandomWord()}...`,
    state: currentLanguage ? `Working in ${currentLanguage}` : undefined,
    largeImageKey: 'claude-logo',
    largeImageText: 'Claude',
    startTimestamp,
  });
}

async function connectToDiscord(): Promise<void> {
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = undefined;
  }

  client = new Client({ clientId: CLIENT_ID });

  client.on('ready', () => {
    setPresence();
    cycleInterval = setInterval(setPresence, 15_000);
  });

  client.on('disconnected', () => {
    if (cycleInterval) {
      clearInterval(cycleInterval);
      cycleInterval = undefined;
    }
    scheduleReconnect();
  });

  try {
    await client.login();
  } catch {
    client = null;
    scheduleReconnect();
  }
}

function scheduleReconnect(): void {
  if (reconnectTimeout) return;
  reconnectTimeout = setTimeout(() => {
    reconnectTimeout = undefined;
    connectToDiscord();
  }, 30_000);
}

export function activate(context: vscode.ExtensionContext): void {
  startTimestamp = new Date();
  currentLanguage = vscode.window.activeTextEditor?.document.languageId;

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      currentLanguage = editor?.document.languageId;
    }),
  );

  connectToDiscord();
}

export function deactivate(): void {
  if (cycleInterval) clearInterval(cycleInterval);
  if (reconnectTimeout) clearTimeout(reconnectTimeout);
  client?.destroy();
  client = null;
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: Compiles with no errors. `dist/extension.js` and `dist/words.js` created.

- [ ] **Step 3: Commit**

```bash
git add src/extension.ts
git commit -m "feat: extension core with Discord RPC, word cycling, and language detection"
```

---

### Task 4: Build Verification and Manual Test

**Files:**
- No new files

- [ ] **Step 1: Run tests**

Run: `npm test`
Expected: All 4 tests PASS.

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: Clean compile, no errors.

- [ ] **Step 3: Manual test in Extension Development Host**

1. Open the `discord-presence-display` folder in VS Code
2. Press `F5` (or Run > Start Debugging) — this launches a new VS Code window with the extension loaded
3. Make sure Discord desktop is running on the same machine
4. **Verify in Discord:**
   - Your status shows `Playing Claude` in the member list of any server
   - Below it, a word like `Cogitating...` appears and changes every ~15 seconds
   - Click your profile — the State line shows `Working in {language}` matching the file you have open
   - Elapsed time counts up from when you launched the dev host
5. Switch to a different file type — State line updates
6. Close all editors — State line disappears, word keeps cycling

Note: This step requires a Discord Application Client ID. Replace `REPLACE_WITH_YOUR_CLIENT_ID` in `src/extension.ts` with the actual ID from https://discord.com/developers/applications before testing.

- [ ] **Step 4: Add launch config for easier debugging (if not auto-generated)**

If VS Code didn't auto-generate `.vscode/launch.json`, create it:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      "preLaunchTask": "${defaultBuildTask}"
    }
  ]
}
```

And `.vscode/tasks.json`:

```json
{
  "version": "2.0.0",
  "tasks": [
    {
      "type": "npm",
      "script": "watch",
      "problemMatcher": "$tsc-watch",
      "isBackground": true,
      "label": "npm: watch",
      "group": {
        "kind": "build",
        "isDefault": true
      }
    }
  ]
}
```

- [ ] **Step 5: Commit any adjustments**

```bash
git add -A
git commit -m "chore: add VS Code debug launch config"
```
