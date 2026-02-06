import * as vscode from 'vscode';
import { StorageService } from '../services/StorageService';
import { ValidationService } from '../services/ValidationService';
import { TerminalService } from '../services/TerminalService';
import { ServerTreeProvider, ServerTreeItem } from '../providers/ServerTreeProvider';
import { SSHServer, TunnelType } from '../types';

export function registerTunnelCommands(
  context: vscode.ExtensionContext,
  storage: StorageService,
  validation: ValidationService,
  terminal: TerminalService,
  treeProvider: ServerTreeProvider,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('warpgate.portForward', (item?: ServerTreeItem) =>
      portForwardWizard(item, storage, validation, terminal, treeProvider),
    ),
  );
}

async function portForwardWizard(
  item: ServerTreeItem | undefined,
  storage: StorageService,
  validation: ValidationService,
  terminal: TerminalService,
  treeProvider: ServerTreeProvider,
): Promise<void> {
  const server = item?.server ?? await pickServer(storage, 'Select server for port forwarding');
  if (!server) { return; }

  // Step 1: Select tunnel type
  const tunnelType = await vscode.window.showQuickPick(
    [
      {
        label: '$(arrow-right) Local Forward (-L)',
        description: 'Forward a local port to a remote destination',
        detail: 'Access remote services through a local port. E.g., access remote DB on localhost:5432',
        value: 'local' as TunnelType,
      },
      {
        label: '$(arrow-left) Remote Forward (-R)',
        description: 'Forward a remote port to a local destination',
        detail: 'Expose a local service to the remote server. E.g., let remote access your localhost:3000',
        value: 'remote' as TunnelType,
      },
      {
        label: '$(globe) Dynamic SOCKS Proxy (-D)',
        description: 'Create a SOCKS5 proxy through the SSH tunnel',
        detail: 'Route all traffic through the SSH server. Configure browser to use localhost:1080 as SOCKS proxy',
        value: 'dynamic' as TunnelType,
      },
    ],
    { title: 'WarpGate: Port Forwarding', placeHolder: 'Select tunnel type' },
  );
  if (!tunnelType) { return; }

  let sshFlag: string;
  let spec: string;
  let label: string;

  if (tunnelType.value === 'dynamic') {
    // Dynamic: only needs a local port
    const localPort = await vscode.window.showInputBox({
      title: 'WarpGate: Dynamic SOCKS Proxy (-D)',
      prompt: 'Enter local port for SOCKS proxy',
      value: '1080',
      validateInput: (v) => validation.validatePort(v).error,
    });
    if (!localPort) { return; }

    sshFlag = '-D';
    spec = localPort;
    label = `SOCKS proxy on localhost:${localPort}`;
  } else {
    // Local or Remote: needs localPort:remoteHost:remotePort
    const direction = tunnelType.value === 'local' ? 'Local' : 'Remote';

    const localPort = await vscode.window.showInputBox({
      title: `WarpGate: ${direction} Forward — Step 1/3`,
      prompt: `Enter ${direction === 'Local' ? 'local' : 'remote'} bind port`,
      placeHolder: 'e.g., 8080',
      validateInput: (v) => validation.validatePort(v).error,
    });
    if (!localPort) { return; }

    const remoteHost = await vscode.window.showInputBox({
      title: `WarpGate: ${direction} Forward — Step 2/3`,
      prompt: `Enter ${direction === 'Local' ? 'remote' : 'local'} target host`,
      value: 'localhost',
      validateInput: (v) => validation.validateHostname(v).error,
    });
    if (!remoteHost) { return; }

    const remotePort = await vscode.window.showInputBox({
      title: `WarpGate: ${direction} Forward — Step 3/3`,
      prompt: `Enter ${direction === 'Local' ? 'remote' : 'local'} target port`,
      placeHolder: 'e.g., 5432',
      validateInput: (v) => validation.validatePort(v).error,
    });
    if (!remotePort) { return; }

    sshFlag = tunnelType.value === 'local' ? '-L' : '-R';
    spec = `${localPort}:${remoteHost}:${remotePort}`;
    label = `${direction}: ${localPort} → ${remoteHost}:${remotePort}`;
  }

  // Build the SSH command with the tunnel and -N (no remote command)
  const extraArgs = [sshFlag, spec, '-N'];

  // Create a temporary server object with the tunnel args
  const tunnelServer: SSHServer = {
    ...server,
    id: `${server.id}-tunnel-${Date.now()}`,
    name: `${server.name} (${label})`,
    extraArgs: [...(server.extraArgs ?? []), ...extraArgs],
  };

  // SECURITY: Terminal service re-validates all fields at connect time
  await terminal.connect(tunnelServer);
  treeProvider.refresh();

  vscode.window.showInformationMessage(
    `WarpGate: Tunnel active — ${label} via ${server.name}`,
  );
}

async function pickServer(
  storage: StorageService,
  placeholder: string,
): Promise<SSHServer | undefined> {
  const servers = storage.getServers();
  if (servers.length === 0) {
    vscode.window.showInformationMessage('WarpGate: No servers configured. Add one first.');
    return undefined;
  }

  const items = servers.map((s) => ({
    label: s.name,
    description: `${s.username}@${s.host}:${s.port}`,
    server: s,
  }));

  const picked = await vscode.window.showQuickPick(items, { placeHolder: placeholder });
  return picked?.server;
}
