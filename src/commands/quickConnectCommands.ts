import * as vscode from 'vscode';
import { StorageService } from '../services/StorageService';
import { TerminalService } from '../services/TerminalService';
import { ServerTreeProvider } from '../providers/ServerTreeProvider';
import { SSHServer } from '../types';

export function registerQuickConnectCommands(
  context: vscode.ExtensionContext,
  storage: StorageService,
  terminal: TerminalService,
  treeProvider: ServerTreeProvider,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('warpgate.quickConnect', () =>
      quickConnect(storage, terminal, treeProvider),
    ),
  );
}

/**
 * Quick-connect: Opens a fuzzy-searchable picker of all servers.
 * The user types part of the server name, host, or username to filter,
 * then hits Enter to connect instantly.
 */
async function quickConnect(
  storage: StorageService,
  terminal: TerminalService,
  treeProvider: ServerTreeProvider,
): Promise<void> {
  const servers = storage.getServers();
  const groups = storage.getGroups();

  if (servers.length === 0) {
    vscode.window.showInformationMessage('WarpGate: No servers configured. Add one first.');
    return;
  }

  // Build group name lookup
  const groupNames = new Map<string, string>();
  for (const g of groups) {
    groupNames.set(g.id, g.name);
  }

  // Build items with rich detail for fuzzy matching
  const items: Array<vscode.QuickPickItem & { server: SSHServer }> = servers.map((s) => {
    const connected = terminal.isConnected(s.id);
    const groupName = s.group ? groupNames.get(s.group) : undefined;

    return {
      label: `${connected ? '$(terminal) ' : '$(server) '}${s.name}`,
      description: `${s.username}@${s.host}:${s.port}`,
      detail: [
        groupName ? `Group: ${groupName}` : null,
        s.identityFile ? `Key: ${s.identityFile}` : null,
        s.proxyJump ? `ProxyJump: ${s.proxyJump}` : null,
        connected ? '🟢 Connected' : null,
      ].filter(Boolean).join('  •  ') || undefined,
      server: s,
    };
  });

  const picked = await vscode.window.showQuickPick(items, {
    title: 'WarpGate: Quick Connect',
    placeHolder: 'Type to search servers by name, host, username, or group...',
    matchOnDescription: true,
    matchOnDetail: true,
  });

  if (!picked) { return; }

  try {
    await terminal.connect(picked.server);
    treeProvider.refresh();
  } catch (err) {
    // Error already shown by TerminalService
  }
}
