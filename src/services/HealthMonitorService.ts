import * as vscode from 'vscode';
import { TerminalService } from './TerminalService';
import { StorageService } from './StorageService';
import { ServerTreeProvider } from '../providers/ServerTreeProvider';

/**
 * Connection health monitor.
 *
 * VS Code terminals don't expose a readiness or exit-code API, so we
 * track liveness by watching the onDidCloseTerminal event.  When a
 * terminal that WarpGate created disappears we surface a notification
 * with a one-click Reconnect button.
 *
 * The monitor also sets up ServerAliveInterval / ServerAliveCountMax
 * to make the SSH keepalive aggressive, so we detect drops sooner.
 */
export class HealthMonitorService {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly terminalService: TerminalService;
  private readonly storage: StorageService;
  private readonly treeProvider: ServerTreeProvider;

  /** Maps terminal → serverId for reconnect */
  private readonly trackedTerminals = new Map<vscode.Terminal, string>();

  constructor(
    terminalService: TerminalService,
    storage: StorageService,
    treeProvider: ServerTreeProvider,
  ) {
    this.terminalService = terminalService;
    this.storage = storage;
    this.treeProvider = treeProvider;

    // Watch for terminals closing
    this.disposables.push(
      vscode.window.onDidCloseTerminal((terminal) => this.onTerminalClosed(terminal)),
    );
  }

  /**
   * Track a terminal for health monitoring.
   * Call this right after TerminalService.connect() returns a terminal.
   */
  track(terminal: vscode.Terminal, serverId: string): void {
    this.trackedTerminals.set(terminal, serverId);
  }

  /**
   * Get keepalive SSH args that should be added to all connections.
   * These make SSH detect dead connections faster.
   */
  getKeepaliveArgs(): string[] {
    return [
      '-o', 'ServerAliveInterval=15',
      '-o', 'ServerAliveCountMax=3',
    ];
  }

  private async onTerminalClosed(terminal: vscode.Terminal): Promise<void> {
    const serverId = this.trackedTerminals.get(terminal);
    if (!serverId) {
      return; // Not one of ours
    }

    this.trackedTerminals.delete(terminal);
    this.treeProvider.refresh();

    const server = this.storage.getServer(serverId);
    if (!server) {
      return; // Server was deleted
    }

    // Show reconnect notification
    const action = await vscode.window.showWarningMessage(
      `WarpGate: Connection to "${server.name}" was closed.`,
      'Reconnect',
      'Dismiss',
    );

    if (action === 'Reconnect') {
      try {
        const newTerminal = await this.terminalService.connect(server);
        this.track(newTerminal, serverId);
      } catch (err) {
        vscode.window.showErrorMessage(
          `WarpGate: Reconnect failed — ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  dispose(): void {
    this.trackedTerminals.clear();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }
}
