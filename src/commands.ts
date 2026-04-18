import * as vscode from 'vscode';

export interface CommandDeps {
  togglePaused: () => void;
}

export function registerCommands(deps: CommandDeps): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('claudeSpinner.toggle', () => {
      deps.togglePaused();
    }),
  ];
}
