import * as vscode from 'vscode';
import { StorageService } from './services/StorageService';
import { ValidationService } from './services/ValidationService';
import { TerminalService } from './services/TerminalService';
import { ConfigParserService } from './services/ConfigParserService';
import { HealthMonitorService } from './services/HealthMonitorService';
import { ServerTreeProvider } from './providers/ServerTreeProvider';
import { registerServerCommands } from './commands/serverCommands';
import { registerImportCommands } from './commands/importCommands';
import { registerTunnelCommands } from './commands/tunnelCommands';
import { registerKeygenCommands } from './commands/keygenCommands';
import { registerConfigExportCommands } from './commands/configExportCommands';
import { registerQuickConnectCommands } from './commands/quickConnectCommands';

let terminalService: TerminalService | undefined;
let treeProvider: ServerTreeProvider | undefined;
let healthMonitor: HealthMonitorService | undefined;

export function activate(context: vscode.ExtensionContext): void {
  // Initialize services
  const validation = new ValidationService();
  const storage = new StorageService(context);
  terminalService = new TerminalService(validation);
  const configParser = new ConfigParserService();

  // Initialize tree provider
  treeProvider = new ServerTreeProvider(storage, terminalService);
  const treeView = vscode.window.createTreeView('warpgateServers', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  // Initialize health monitor
  healthMonitor = new HealthMonitorService(terminalService, storage, treeProvider);

  // Register all command groups
  registerServerCommands(context, storage, validation, terminalService, treeProvider);
  registerImportCommands(context, storage, validation, configParser, treeProvider);
  registerTunnelCommands(context, storage, validation, terminalService, treeProvider);
  registerKeygenCommands(context, validation);
  registerConfigExportCommands(context, storage, validation, treeProvider);
  registerQuickConnectCommands(context, storage, terminalService, treeProvider);

  // Track disposables
  context.subscriptions.push(
    treeView,
    { dispose: () => terminalService?.dispose() },
    { dispose: () => treeProvider?.dispose() },
    { dispose: () => healthMonitor?.dispose() },
  );

  // Refresh tree when terminal state changes
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal(() => {
      treeProvider?.refresh();
    }),
  );
}

export function deactivate(): void {
  healthMonitor?.dispose();
  terminalService?.dispose();
  treeProvider?.dispose();
  healthMonitor = undefined;
  terminalService = undefined;
  treeProvider = undefined;
}
