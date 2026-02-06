import * as vscode from 'vscode';
import * as os from 'os';
import { ConfigParserService } from '../services/ConfigParserService';
import { StorageService } from '../services/StorageService';
import { ValidationService } from '../services/ValidationService';
import { ServerTreeProvider } from '../providers/ServerTreeProvider';
import { ParsedSSHHost } from '../types';
import { DEFAULT_PORT } from '../constants';

export function registerImportCommands(
  context: vscode.ExtensionContext,
  storage: StorageService,
  validation: ValidationService,
  configParser: ConfigParserService,
  treeProvider: ServerTreeProvider,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('warpgate.importFromConfig', () =>
      importFromConfig(storage, validation, configParser, treeProvider),
    ),
  );
}

async function importFromConfig(
  storage: StorageService,
  validation: ValidationService,
  configParser: ConfigParserService,
  treeProvider: ServerTreeProvider,
): Promise<void> {
  // Parse the SSH config
  let hosts: ParsedSSHHost[];
  try {
    hosts = configParser.parseDefaultConfig();
  } catch (err) {
    vscode.window.showErrorMessage(
      `WarpGate: Failed to parse SSH config: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  if (hosts.length === 0) {
    vscode.window.showInformationMessage(
      'WarpGate: No hosts found in ~/.ssh/config',
    );
    return;
  }

  // Filter out hosts that already exist (by matching alias to name and host)
  const existingServers = storage.getServers();
  const existingHosts = new Set(
    existingServers.map((s) => `${s.name}::${s.host}`),
  );

  const allItems = hosts.map((h) => {
    const hostName = h.hostName ?? h.alias;
    const isExisting = existingHosts.has(`${h.alias}::${hostName}`);
    return {
      label: h.alias,
      description: `${h.user ?? os.userInfo().username}@${hostName}${h.port ? ':' + h.port : ''}`,
      detail: isExisting ? '$(check) Already imported' : undefined,
      picked: !isExisting,
      host: h,
      alreadyExists: isExisting,
    };
  });

  const selected = await vscode.window.showQuickPick(allItems, {
    title: 'WarpGate: Import from SSH Config',
    placeHolder: `Found ${hosts.length} host(s). Select which to import.`,
    canPickMany: true,
  });

  if (!selected || selected.length === 0) {
    return;
  }

  // Filter out already existing
  const toImport = selected.filter((s) => !s.alreadyExists);
  if (toImport.length === 0) {
    vscode.window.showInformationMessage('WarpGate: All selected hosts are already imported');
    return;
  }

  let imported = 0;
  let skipped = 0;

  for (const item of toImport) {
    const h = item.host;
    const hostName = h.hostName ?? h.alias;
    const username = h.user ?? os.userInfo().username;
    const port = h.port ?? DEFAULT_PORT;

    // SECURITY: Validate ALL fields before importing, including those from SSH config.
    // A malicious SSH config could contain shell metacharacters in any field.
    const nameResult = validation.validateServerName(h.alias);
    const hostResult = validation.validateHostname(hostName);
    const userResult = validation.validateUsername(username);
    const portResult = validation.validatePort(port);

    if (!nameResult.valid || !hostResult.valid || !userResult.valid || !portResult.valid) {
      skipped++;
      continue;
    }

    // Validate optional fields
    if (h.identityFile) {
      const idResult = validation.validateIdentityFile(h.identityFile);
      if (!idResult.valid) {
        skipped++;
        continue;
      }
    }

    if (h.proxyJump) {
      const proxyResult = validation.validateHostname(h.proxyJump);
      if (!proxyResult.valid) {
        skipped++;
        continue;
      }
    }

    await storage.addServerFromImport(
      h.alias,
      hostName,
      username,
      port,
      h.identityFile,
      h.proxyJump,
    );
    imported++;
  }

  treeProvider.refresh();

  let message = `WarpGate: Imported ${imported} server(s)`;
  if (skipped > 0) {
    message += ` (${skipped} skipped due to validation)`;
  }
  vscode.window.showInformationMessage(message);
}
