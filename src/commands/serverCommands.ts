import * as vscode from 'vscode';
import * as os from 'os';
import { StorageService } from '../services/StorageService';
import { ValidationService } from '../services/ValidationService';
import { TerminalService } from '../services/TerminalService';
import { ServerTreeProvider, ServerTreeItem, GroupTreeItem } from '../providers/ServerTreeProvider';
import { DEFAULT_PORT } from '../constants';

export function registerServerCommands(
  context: vscode.ExtensionContext,
  storage: StorageService,
  validation: ValidationService,
  terminal: TerminalService,
  treeProvider: ServerTreeProvider,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('warpgate.addServer', () => addServer(storage, validation, treeProvider)),
    vscode.commands.registerCommand('warpgate.editServer', (item?: ServerTreeItem) => editServer(item, storage, validation, treeProvider)),
    vscode.commands.registerCommand('warpgate.deleteServer', (item?: ServerTreeItem) => deleteServer(item, storage, treeProvider)),
    vscode.commands.registerCommand('warpgate.connectServer', (item?: ServerTreeItem) => connectServer(item, storage, terminal, treeProvider)),
    vscode.commands.registerCommand('warpgate.renameServer', (item?: ServerTreeItem) => renameServer(item, storage, validation, treeProvider)),
    vscode.commands.registerCommand('warpgate.duplicateServer', (item?: ServerTreeItem) => duplicateServer(item, storage, validation, treeProvider)),
    vscode.commands.registerCommand('warpgate.createGroup', () => createGroup(storage, validation, treeProvider)),
    vscode.commands.registerCommand('warpgate.deleteGroup', (item?: GroupTreeItem) => deleteGroup(item, storage, treeProvider)),
    vscode.commands.registerCommand('warpgate.moveToGroup', (item?: ServerTreeItem) => moveToGroup(item, storage, treeProvider)),
    vscode.commands.registerCommand('warpgate.copySSHCommand', (item?: ServerTreeItem) => copySSHCommand(item, storage, terminal)),
    vscode.commands.registerCommand('warpgate.bulkDelete', () => bulkDelete(storage, treeProvider)),
    vscode.commands.registerCommand('warpgate.refresh', () => treeProvider.refresh()),
  );
}

async function addServer(
  storage: StorageService,
  validation: ValidationService,
  treeProvider: ServerTreeProvider,
): Promise<void> {
  // Step 1: Server name
  const name = await vscode.window.showInputBox({
    title: 'WarpGate: Add Server (1/5)',
    prompt: 'Enter a display name for this server',
    placeHolder: 'e.g., Production Web Server',
    validateInput: (v) => validation.validateServerName(v).error,
  });
  if (!name) { return; }

  // Step 2: Hostname
  const host = await vscode.window.showInputBox({
    title: 'WarpGate: Add Server (2/5)',
    prompt: 'Enter hostname or IP address',
    placeHolder: 'e.g., 192.168.1.100 or server.example.com',
    validateInput: (v) => validation.validateHostname(v).error,
  });
  if (!host) { return; }

  // Step 3: Port
  const defaultPort = vscode.workspace.getConfiguration('warpgate').get<number>('defaultPort', DEFAULT_PORT);
  const portStr = await vscode.window.showInputBox({
    title: 'WarpGate: Add Server (3/5)',
    prompt: 'Enter SSH port',
    value: String(defaultPort),
    validateInput: (v) => validation.validatePort(v).error,
  });
  if (!portStr) { return; }
  const port = parseInt(portStr, 10);

  // Step 4: Username
  const defaultUser = vscode.workspace.getConfiguration('warpgate').get<string>('defaultUsername', '');
  const username = await vscode.window.showInputBox({
    title: 'WarpGate: Add Server (4/5)',
    prompt: 'Enter SSH username',
    value: defaultUser,
    placeHolder: 'e.g., root, ubuntu, admin',
    validateInput: (v) => validation.validateUsername(v).error,
  });
  if (!username) { return; }

  // Step 5: Identity file (optional)
  const identityFileChoice = await vscode.window.showQuickPick(
    [
      { label: '$(key) Select identity file', description: 'Browse for SSH key', value: 'browse' },
      { label: '$(dash) Skip', description: 'Use default SSH key or agent', value: 'skip' },
    ],
    { title: 'WarpGate: Add Server (5/5)', placeHolder: 'SSH identity file (optional)' },
  );

  let identityFile: string | undefined;
  if (identityFileChoice?.value === 'browse') {
    const fileUri = await vscode.window.showOpenDialog({
      title: 'Select SSH Identity File',
      canSelectMany: false,
      defaultUri: vscode.Uri.file(os.homedir() + '/.ssh/'),
      openLabel: 'Select Key',
    });
    if (fileUri?.[0]) {
      identityFile = fileUri[0].fsPath;
      const identityResult = validation.validateIdentityFile(identityFile);
      if (!identityResult.valid) {
        vscode.window.showErrorMessage(`WarpGate: ${identityResult.error}`);
        return;
      }
    }
  }

  // Optional: assign to group
  const groups = storage.getGroups();
  let group: string | undefined;
  if (groups.length > 0) {
    const groupChoice = await vscode.window.showQuickPick(
      [
        { label: '$(dash) No group', value: '' },
        ...groups.map((g) => ({ label: `$(folder) ${g.name}`, value: g.id })),
      ],
      { title: 'WarpGate: Assign to Group', placeHolder: 'Optional: assign to a group' },
    );
    group = groupChoice?.value || undefined;
  }

  await storage.addServer({
    name: name.trim(),
    host: host.trim(),
    port,
    username: username.trim(),
    identityFile,
    group,
  });

  treeProvider.refresh();
  vscode.window.showInformationMessage(`WarpGate: Server "${name}" added`);
}

async function editServer(
  item: ServerTreeItem | undefined,
  storage: StorageService,
  validation: ValidationService,
  treeProvider: ServerTreeProvider,
): Promise<void> {
  const server = item?.server ?? await pickServer(storage, 'Select server to edit');
  if (!server) { return; }

  const field = await vscode.window.showQuickPick(
    [
      { label: 'Name', description: server.name, value: 'name' },
      { label: 'Host', description: server.host, value: 'host' },
      { label: 'Port', description: String(server.port), value: 'port' },
      { label: 'Username', description: server.username, value: 'username' },
      { label: 'Identity File', description: server.identityFile ?? '(none)', value: 'identityFile' },
      { label: 'ProxyJump', description: server.proxyJump ?? '(none)', value: 'proxyJump' },
    ],
    { title: 'WarpGate: Edit Server', placeHolder: 'Which field to edit?' },
  );
  if (!field) { return; }

  switch (field.value) {
    case 'name': {
      const newName = await vscode.window.showInputBox({
        prompt: 'Enter new name',
        value: server.name,
        validateInput: (v) => validation.validateServerName(v).error,
      });
      if (newName) { await storage.updateServer(server.id, { name: newName.trim() }); }
      break;
    }
    case 'host': {
      const newHost = await vscode.window.showInputBox({
        prompt: 'Enter new hostname',
        value: server.host,
        validateInput: (v) => validation.validateHostname(v).error,
      });
      if (newHost) { await storage.updateServer(server.id, { host: newHost.trim() }); }
      break;
    }
    case 'port': {
      const newPort = await vscode.window.showInputBox({
        prompt: 'Enter new port',
        value: String(server.port),
        validateInput: (v) => validation.validatePort(v).error,
      });
      if (newPort) { await storage.updateServer(server.id, { port: parseInt(newPort, 10) }); }
      break;
    }
    case 'username': {
      const newUser = await vscode.window.showInputBox({
        prompt: 'Enter new username',
        value: server.username,
        validateInput: (v) => validation.validateUsername(v).error,
      });
      if (newUser) { await storage.updateServer(server.id, { username: newUser.trim() }); }
      break;
    }
    case 'identityFile': {
      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(key) Select new file', value: 'browse' },
          { label: '$(close) Remove identity file', value: 'remove' },
        ],
        { placeHolder: 'Identity file action' },
      );
      if (choice?.value === 'browse') {
        const fileUri = await vscode.window.showOpenDialog({
          title: 'Select SSH Identity File',
          canSelectMany: false,
          defaultUri: vscode.Uri.file(os.homedir() + '/.ssh/'),
        });
        if (fileUri?.[0]) {
          const result = validation.validateIdentityFile(fileUri[0].fsPath);
          if (!result.valid) {
            vscode.window.showErrorMessage(`WarpGate: ${result.error}`);
          } else {
            await storage.updateServer(server.id, { identityFile: fileUri[0].fsPath });
          }
        }
      } else if (choice?.value === 'remove') {
        await storage.updateServer(server.id, { identityFile: undefined });
      }
      break;
    }
    case 'proxyJump': {
      const newProxy = await vscode.window.showInputBox({
        prompt: 'Enter ProxyJump host (leave empty to remove)',
        value: server.proxyJump ?? '',
        validateInput: (v) => {
          if (v.trim().length === 0) { return undefined; }
          return validation.validateHostname(v).error;
        },
      });
      if (newProxy !== undefined) {
        await storage.updateServer(server.id, {
          proxyJump: newProxy.trim() || undefined,
        });
      }
      break;
    }
  }

  treeProvider.refresh();
}

async function deleteServer(
  item: ServerTreeItem | undefined,
  storage: StorageService,
  treeProvider: ServerTreeProvider,
): Promise<void> {
  const server = item?.server ?? await pickServer(storage, 'Select server to delete');
  if (!server) { return; }

  const confirm = vscode.workspace.getConfiguration('warpgate').get<boolean>('confirmBeforeDelete', true);
  if (confirm) {
    const answer = await vscode.window.showWarningMessage(
      `Delete server "${server.name}"?`,
      { modal: true },
      'Delete',
    );
    if (answer !== 'Delete') { return; }
  }

  await storage.deleteServer(server.id);
  treeProvider.refresh();
  vscode.window.showInformationMessage(`WarpGate: Server "${server.name}" deleted`);
}

async function connectServer(
  item: ServerTreeItem | undefined,
  storage: StorageService,
  terminalService: TerminalService,
  treeProvider: ServerTreeProvider,
): Promise<void> {
  const server = item?.server ?? await pickServer(storage, 'Select server to connect');
  if (!server) { return; }

  await terminalService.connect(server);
  treeProvider.refresh();
}

async function renameServer(
  item: ServerTreeItem | undefined,
  storage: StorageService,
  validation: ValidationService,
  treeProvider: ServerTreeProvider,
): Promise<void> {
  const server = item?.server ?? await pickServer(storage, 'Select server to rename');
  if (!server) { return; }

  const newName = await vscode.window.showInputBox({
    prompt: 'Enter new name',
    value: server.name,
    validateInput: (v) => validation.validateServerName(v).error,
  });
  if (!newName || newName.trim() === server.name) { return; }

  await storage.updateServer(server.id, { name: newName.trim() });
  treeProvider.refresh();
}

async function duplicateServer(
  item: ServerTreeItem | undefined,
  storage: StorageService,
  validation: ValidationService,
  treeProvider: ServerTreeProvider,
): Promise<void> {
  const server = item?.server ?? await pickServer(storage, 'Select server to duplicate');
  if (!server) { return; }

  // Truncate name if appending "(copy)" would exceed the limit
  const maxBase = 93; // 100 - " (copy)".length
  const baseName = server.name.length > maxBase ? server.name.substring(0, maxBase) : server.name;

  // SECURITY: Re-validate extraArgs on duplicate as defense-in-depth.
  // Data in storage could be stale from a pre-validation era or tampered with.
  let safeExtraArgs: string[] | undefined;
  if (server.extraArgs && server.extraArgs.length > 0) {
    const argsResult = validation.validateExtraArgs(server.extraArgs);
    if (!argsResult.valid) {
      vscode.window.showWarningMessage(
        `WarpGate: Extra SSH args on "${server.name}" failed validation and were dropped from the duplicate.`,
      );
      safeExtraArgs = undefined;
    } else {
      safeExtraArgs = [...server.extraArgs];
    }
  }

  await storage.addServer({
    name: `${baseName} (copy)`,
    host: server.host,
    port: server.port,
    username: server.username,
    identityFile: server.identityFile,
    proxyJump: server.proxyJump,
    extraArgs: safeExtraArgs,
    group: server.group,
  });

  treeProvider.refresh();
  vscode.window.showInformationMessage(`WarpGate: Server duplicated as "${baseName} (copy)"`);
}

async function createGroup(
  storage: StorageService,
  validation: ValidationService,
  treeProvider: ServerTreeProvider,
): Promise<void> {
  const name = await vscode.window.showInputBox({
    prompt: 'Enter group name',
    placeHolder: 'e.g., Production, Staging, Development',
    validateInput: (v) => validation.validateGroupName(v).error,
  });
  if (!name) { return; }

  await storage.addGroup(name.trim());
  treeProvider.refresh();
}

async function deleteGroup(
  item: GroupTreeItem | undefined,
  storage: StorageService,
  treeProvider: ServerTreeProvider,
): Promise<void> {
  if (!item) { return; }

  const confirm = vscode.workspace.getConfiguration('warpgate').get<boolean>('confirmBeforeDelete', true);
  if (confirm) {
    const answer = await vscode.window.showWarningMessage(
      `Delete group "${item.group.name}"? Servers in this group will become ungrouped.`,
      { modal: true },
      'Delete',
    );
    if (answer !== 'Delete') { return; }
  }

  await storage.deleteGroup(item.group.id);
  treeProvider.refresh();
}

async function moveToGroup(
  item: ServerTreeItem | undefined,
  storage: StorageService,
  treeProvider: ServerTreeProvider,
): Promise<void> {
  const server = item?.server ?? await pickServer(storage, 'Select server to move');
  if (!server) { return; }

  const groups = storage.getGroups();
  const options = [
    { label: '$(dash) No group', description: 'Remove from group', value: '' },
    ...groups.map((g) => ({
      label: `$(folder) ${g.name}`,
      description: g.id === server.group ? '(current)' : '',
      value: g.id,
    })),
  ];

  const choice = await vscode.window.showQuickPick(options, {
    title: 'WarpGate: Move to Group',
    placeHolder: 'Select target group',
  });
  if (!choice) { return; }

  await storage.updateServer(server.id, { group: choice.value || undefined });
  treeProvider.refresh();
}

async function copySSHCommand(
  item: ServerTreeItem | undefined,
  storage: StorageService,
  terminalService: TerminalService,
): Promise<void> {
  const server = item?.server ?? await pickServer(storage, 'Select server');
  if (!server) { return; }

  const command = terminalService.buildSSHCommand(server);
  await vscode.env.clipboard.writeText(command);
  vscode.window.showInformationMessage(`WarpGate: SSH command copied to clipboard`);
}

async function bulkDelete(
  storage: StorageService,
  treeProvider: ServerTreeProvider,
): Promise<void> {
  const servers = storage.getServers();
  const groups = storage.getGroups();

  if (servers.length === 0 && groups.length === 0) {
    vscode.window.showInformationMessage('WarpGate: Nothing to delete.');
    return;
  }

  // Build group name lookup
  const groupNames = new Map<string, string>();
  for (const g of groups) {
    groupNames.set(g.id, g.name);
  }

  // Build multi-select items — servers and groups together
  interface DeleteItem extends vscode.QuickPickItem {
    itemKind: 'server' | 'group';
    itemId: string;
  }

  const items: DeleteItem[] = [];

  for (const g of groups) {
    const count = storage.getServersByGroup(g.id).length;
    items.push({
      label: `$(folder) ${g.name}`,
      description: `Group · ${count} server${count !== 1 ? 's' : ''}`,
      detail: 'Deleting a group ungroups its servers (does not delete them)',
      itemKind: 'group',
      itemId: g.id,
    });
  }

  for (const s of servers) {
    const groupName = s.group ? groupNames.get(s.group) : undefined;
    items.push({
      label: `$(server) ${s.name}`,
      description: `${s.username}@${s.host}:${s.port}`,
      detail: groupName ? `Group: ${groupName}` : undefined,
      itemKind: 'server',
      itemId: s.id,
    });
  }

  const selected = await vscode.window.showQuickPick(items, {
    title: 'WarpGate: Bulk Delete',
    placeHolder: `Select items to delete (${servers.length} servers, ${groups.length} groups)`,
    canPickMany: true,
  });

  if (!selected || selected.length === 0) { return; }

  const serverCount = selected.filter((i) => i.itemKind === 'server').length;
  const groupCount = selected.filter((i) => i.itemKind === 'group').length;

  // Confirmation
  const parts: string[] = [];
  if (serverCount > 0) { parts.push(`${serverCount} server${serverCount !== 1 ? 's' : ''}`); }
  if (groupCount > 0) { parts.push(`${groupCount} group${groupCount !== 1 ? 's' : ''}`); }

  const confirm = vscode.workspace.getConfiguration('warpgate').get<boolean>('confirmBeforeDelete', true);
  if (confirm) {
    const answer = await vscode.window.showWarningMessage(
      `Delete ${parts.join(' and ')}?`,
      { modal: true },
      'Delete All',
    );
    if (answer !== 'Delete All') { return; }
  }

  // Delete groups first (they just ungroup servers, don't delete them)
  for (const item of selected) {
    if (item.itemKind === 'group') {
      await storage.deleteGroup(item.itemId);
    }
  }

  // Then delete servers
  for (const item of selected) {
    if (item.itemKind === 'server') {
      await storage.deleteServer(item.itemId);
    }
  }

  treeProvider.refresh();
  vscode.window.showInformationMessage(`WarpGate: Deleted ${parts.join(' and ')}`);
}

async function pickServer(
  storage: StorageService,
  placeholder: string,
): Promise<ReturnType<StorageService['getServer']>> {
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
