import * as vscode from 'vscode';
import { StorageService } from '../services/StorageService';
import { ValidationService } from '../services/ValidationService';
import { ServerTreeProvider } from '../providers/ServerTreeProvider';
import { ExportedConfig } from '../types';

const WARPGATE_VERSION = '0.1.0';

export function registerConfigExportCommands(
  context: vscode.ExtensionContext,
  storage: StorageService,
  validation: ValidationService,
  treeProvider: ServerTreeProvider,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('warpgate.exportConfig', () =>
      exportConfig(storage),
    ),
    vscode.commands.registerCommand('warpgate.importConfig', () =>
      importConfig(storage, validation, treeProvider),
    ),
  );
}

async function exportConfig(storage: StorageService): Promise<void> {
  const servers = storage.getServers();
  const groups = storage.getGroups();

  if (servers.length === 0) {
    vscode.window.showInformationMessage('WarpGate: No servers to export.');
    return;
  }

  // SECURITY: Strip internal-only fields (id, timestamps) from export.
  // Also strip identityFile paths since they're machine-specific.
  const stripIdentity = await vscode.window.showQuickPick(
    [
      {
        label: '$(shield) Exclude identity file paths (Recommended)',
        description: 'Safer for sharing — key paths are machine-specific',
        value: true,
      },
      {
        label: '$(key) Include identity file paths',
        description: 'Include SSH key paths — only share with trusted teammates',
        value: false,
      },
    ],
    {
      title: 'WarpGate: Export Configuration',
      placeHolder: 'Include identity file paths in export?',
    },
  );
  if (stripIdentity === undefined) { return; }

  // Build groupId → groupName map so exported servers use names (portable)
  const groupIdToName = new Map<string, string>();
  for (const g of groups) {
    groupIdToName.set(g.id, g.name);
  }

  const exported: ExportedConfig = {
    warpgateVersion: WARPGATE_VERSION,
    exportedAt: new Date().toISOString(),
    servers: servers.map((s) => ({
      name: s.name,
      host: s.host,
      port: s.port,
      username: s.username,
      identityFile: stripIdentity.value ? undefined : s.identityFile,
      proxyJump: s.proxyJump,
      extraArgs: s.extraArgs,
      // Store group NAME (not ID) for portability across workspaces
      group: s.group ? groupIdToName.get(s.group) : undefined,
    })),
    groups: groups.map((g) => ({
      name: g.name,
      collapsed: g.collapsed,
    })),
  };

  const jsonContent = JSON.stringify(exported, null, 2);

  // Ask where to save
  const uri = await vscode.window.showSaveDialog({
    title: 'WarpGate: Export Configuration',
    defaultUri: vscode.Uri.file('warpgate-servers.json'),
    filters: {
      'WarpGate Config': ['json'],
      'All Files': ['*'],
    },
  });

  if (!uri) { return; }

  await vscode.workspace.fs.writeFile(uri, Buffer.from(jsonContent, 'utf-8'));
  vscode.window.showInformationMessage(
    `WarpGate: Exported ${servers.length} server(s) to ${uri.fsPath}`,
  );
}

async function importConfig(
  storage: StorageService,
  validation: ValidationService,
  treeProvider: ServerTreeProvider,
): Promise<void> {
  const uris = await vscode.window.showOpenDialog({
    title: 'WarpGate: Import Configuration',
    canSelectMany: false,
    filters: {
      'WarpGate Config': ['json'],
      'All Files': ['*'],
    },
  });

  if (!uris || uris.length === 0) { return; }

  let content: string;
  try {
    const raw = await vscode.workspace.fs.readFile(uris[0]);
    content = Buffer.from(raw).toString('utf-8');
  } catch (err) {
    vscode.window.showErrorMessage(`WarpGate: Failed to read file — ${err instanceof Error ? err.message : String(err)}`);
    return;
  }

  let config: ExportedConfig;
  try {
    config = JSON.parse(content);
  } catch {
    vscode.window.showErrorMessage('WarpGate: Invalid JSON file.');
    return;
  }

  // Validate structure
  if (!config.warpgateVersion || !Array.isArray(config.servers)) {
    vscode.window.showErrorMessage('WarpGate: File does not appear to be a valid WarpGate export.');
    return;
  }

  // Import groups first (build name → newId map)
  const groupNameToId = new Map<string, string>();
  const existingGroups = new Set(storage.getGroups().map((g) => g.name));

  if (config.groups) {
    for (const g of config.groups) {
      const nameResult = validation.validateGroupName(g.name);
      if (!nameResult.valid) { continue; }

      if (!existingGroups.has(g.name)) {
        const newGroup = await storage.addGroup(g.name);
        groupNameToId.set(g.name, newGroup.id);
      }
    }
  }

  // Refresh group list after additions
  const allGroups = storage.getGroups();
  for (const g of allGroups) {
    groupNameToId.set(g.name, g.id);
  }

  // Show server selection
  const existingServers = new Set(
    storage.getServers().map((s) => `${s.name}::${s.host}`),
  );

  const serverItems = config.servers.map((s) => {
    const exists = existingServers.has(`${s.name}::${s.host}`);
    return {
      label: s.name,
      description: `${s.username}@${s.host}:${s.port}`,
      detail: exists ? '$(check) Already exists' : undefined,
      picked: !exists,
      server: s,
      alreadyExists: exists,
    };
  });

  const selected = await vscode.window.showQuickPick(serverItems, {
    title: 'WarpGate: Import Servers',
    placeHolder: `Found ${config.servers.length} server(s). Select which to import.`,
    canPickMany: true,
  });

  if (!selected || selected.length === 0) { return; }

  const toImport = selected.filter((s) => !s.alreadyExists);
  if (toImport.length === 0) {
    vscode.window.showInformationMessage('WarpGate: All selected servers already exist.');
    return;
  }

  let imported = 0;
  let skipped = 0;

  for (const item of toImport) {
    const s = item.server;

    // SECURITY: Validate every field from the import file
    const nameResult = validation.validateServerName(s.name);
    const hostResult = validation.validateHostname(s.host);
    const userResult = validation.validateUsername(s.username);
    const portResult = validation.validatePort(s.port);

    if (!nameResult.valid || !hostResult.valid || !userResult.valid || !portResult.valid) {
      skipped++;
      continue;
    }

    if (s.identityFile) {
      const idResult = validation.validateIdentityFile(s.identityFile);
      if (!idResult.valid) {
        skipped++;
        continue;
      }
    }

    if (s.proxyJump) {
      const proxyResult = validation.validateHostname(s.proxyJump);
      if (!proxyResult.valid) {
        skipped++;
        continue;
      }
    }

    if (s.extraArgs && s.extraArgs.length > 0) {
      const argsResult = validation.validateExtraArgs(s.extraArgs);
      if (!argsResult.valid) {
        skipped++;
        continue;
      }
    }

    // Resolve group reference: exported config uses group NAMES, resolve to local IDs
    let groupId: string | undefined;
    if (s.group) {
      groupId = groupNameToId.get(s.group);
    }

    await storage.addServer({
      name: s.name,
      host: s.host,
      port: s.port,
      username: s.username,
      identityFile: s.identityFile,
      proxyJump: s.proxyJump,
      extraArgs: s.extraArgs,
      group: groupId,
    });
    imported++;
  }

  treeProvider.refresh();

  let message = `WarpGate: Imported ${imported} server(s)`;
  if (skipped > 0) {
    message += ` (${skipped} skipped due to validation)`;
  }
  vscode.window.showInformationMessage(message);
}
