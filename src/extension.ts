import * as vscode from 'vscode';
import { Client } from '@xhayper/discord-rpc';
import { getRandomWord } from './words';

const CLIENT_ID = 'REPLACE_WITH_YOUR_CLIENT_ID';

let client: Client | null = null;
let cycleInterval: ReturnType<typeof setInterval> | undefined;
let reconnectTimeout: ReturnType<typeof setTimeout> | undefined;
let currentLanguage: string | undefined;
let startTimestamp!: Date;

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
    if (cycleInterval) clearInterval(cycleInterval);
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
  client?.destroy().catch(() => {});
  client = null;
}
