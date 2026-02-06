import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { SSHServer } from '../types';
import { ValidationService } from './ValidationService';

// Known safe SSH binary names
const ALLOWED_SSH_BINARY_NAMES: ReadonlySet<string> = new Set([
  'ssh', 'ssh.exe', 'openssh', 'openssh.exe',
]);

// Known safe directories where SSH binaries reside
const TRUSTED_SSH_DIRECTORIES: readonly string[] = [
  '/usr/bin',
  '/usr/local/bin',
  '/opt/homebrew/bin',
  '/usr/sbin',
  '/bin',
  'C:\\Windows\\System32\\OpenSSH',
  'C:\\Program Files\\OpenSSH',
];

export class TerminalService {
  private readonly activeTerminals = new Map<string, vscode.Terminal>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly validation: ValidationService;
  private sshBinaryPath: string | undefined;

  constructor(validation: ValidationService) {
    this.validation = validation;

    // Track terminal closures
    this.disposables.push(
      vscode.window.onDidCloseTerminal((terminal) => {
        for (const [serverId, t] of this.activeTerminals) {
          if (t === terminal) {
            this.activeTerminals.delete(serverId);
            break;
          }
        }
      }),
    );
  }

  async connect(server: SSHServer): Promise<vscode.Terminal> {
    // Check if there's already an active terminal for this server
    const existing = this.activeTerminals.get(server.id);
    if (existing) {
      existing.show();
      return existing;
    }

    // SECURITY: Re-validate ALL server fields at connect time.
    // This prevents crafted objects passed via executeCommand() from bypassing
    // the validation that normally occurs during add/import/edit flows.
    const validationError = this.validateServerAtConnectTime(server);
    if (validationError) {
      vscode.window.showErrorMessage(`WarpGate: Connection refused — ${validationError}`);
      throw new Error(`WarpGate: Connection refused — ${validationError}`);
    }

    const sshPath = await this.resolveSSHBinary();
    const args = this.buildArgs(server);

    // SECURITY: Use shellPath/shellArgs to avoid any shell interpretation.
    // The SSH binary is invoked directly with an argument array.
    // No user-supplied values are ever interpolated into a shell string.

    // UX: Temporarily disable Python extension's auto-activation so it doesn't
    // inject `source .venv/bin/activate` into our SSH terminal. The Python
    // extension uses VS Code's EnvironmentVariableCollection which applies
    // globally to ALL terminals — there's no per-terminal opt-out. The only
    // reliable workaround is to flip the setting off, create the terminal,
    // then restore it.
    const terminal = await this.createTerminalWithoutPythonActivation(sshPath, args, server);

    this.activeTerminals.set(server.id, terminal);
    terminal.show();

    const showNotifications = vscode.workspace
      .getConfiguration('warpgate')
      .get<boolean>('showConnectionNotifications', true);

    if (showNotifications) {
      vscode.window.showInformationMessage(`WarpGate: Connecting to ${server.name} (${server.host})`);
    }

    return terminal;
  }

  isConnected(serverId: string): boolean {
    return this.activeTerminals.has(serverId);
  }

  disconnectAll(): void {
    for (const terminal of this.activeTerminals.values()) {
      terminal.dispose();
    }
    this.activeTerminals.clear();
  }

  buildSSHCommand(server: SSHServer): string {
    // Build a display-only SSH command string for copy-to-clipboard.
    // SECURITY: All values are shell-escaped to prevent injection when pasted.
    const parts: string[] = ['ssh'];

    if (server.port && server.port !== 22) {
      parts.push('-p', String(server.port));
    }
    if (server.identityFile) {
      parts.push('-i', shellEscape(server.identityFile));
    }
    if (server.proxyJump) {
      parts.push('-J', shellEscape(server.proxyJump));
    }
    if (server.extraArgs) {
      parts.push(...server.extraArgs.map(shellEscape));
    }
    parts.push(shellEscape(`${server.username}@${server.host}`));

    return parts.join(' ');
  }

  dispose(): void {
    this.disconnectAll();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }

  /**
   * Create a terminal with Python extension auto-activation suppressed.
   *
   * The Python extension uses VS Code's EnvironmentVariableCollection API
   * which applies globally to ALL terminals. There is no per-terminal
   * opt-out. The only reliable workaround is:
   *   1. Read the current `python.terminal.activateEnvironment` value
   *   2. Temporarily set it to `false`
   *   3. Create the terminal
   *   4. Restore the original value
   *
   * This races against other terminal creation, but since we await the
   * config update before creating and restore immediately after, the
   * window is sub-millisecond.
   */
  private async createTerminalWithoutPythonActivation(
    sshPath: string,
    args: string[],
    server: SSHServer,
  ): Promise<vscode.Terminal> {
    const pyConfig = vscode.workspace.getConfiguration('python');
    const originalValue = pyConfig.get<boolean>('terminal.activateEnvironment');
    const needsOverride = originalValue !== false;

    if (needsOverride) {
      // Temporarily disable — use global scope so it takes effect immediately
      await pyConfig.update('terminal.activateEnvironment', false, vscode.ConfigurationTarget.Global);
    }

    const terminal = vscode.window.createTerminal({
      name: `WarpGate: ${server.name}`,
      shellPath: sshPath,
      shellArgs: args,
      iconPath: new vscode.ThemeIcon('remote'),
      strictEnv: true,
      env: {
        HOME: process.env.HOME ?? process.env.USERPROFILE ?? '',
        PATH: process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin',
        TERM: 'xterm-256color',
        USER: process.env.USER ?? process.env.USERNAME ?? '',
        LANG: process.env.LANG ?? 'en_US.UTF-8',
        // Preserve SSH_AUTH_SOCK so ssh-agent forwarding works
        ...(process.env.SSH_AUTH_SOCK ? { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK } : {}),
      },
    });

    if (needsOverride) {
      // Restore original value. If it was undefined (default), remove the override.
      await pyConfig.update(
        'terminal.activateEnvironment',
        originalValue ?? undefined,
        vscode.ConfigurationTarget.Global,
      );
    }

    return terminal;
  }

  /**
   * SECURITY: Validate every field of a server object before connecting.
   * This is the last line of defense against crafted objects injected via
   * vscode.commands.executeCommand('warpgate.connectServer', craftedObject).
   * Returns an error message string, or undefined if valid.
   */
  private validateServerAtConnectTime(server: SSHServer): string | undefined {
    if (!server || typeof server !== 'object') {
      return 'Invalid server object';
    }
    const hostResult = this.validation.validateHostname(server.host);
    if (!hostResult.valid) {
      return hostResult.error;
    }
    const userResult = this.validation.validateUsername(server.username);
    if (!userResult.valid) {
      return userResult.error;
    }
    const portResult = this.validation.validatePort(server.port);
    if (!portResult.valid) {
      return portResult.error;
    }
    if (server.identityFile) {
      const idResult = this.validation.validateIdentityFile(server.identityFile);
      if (!idResult.valid) {
        return idResult.error;
      }
    }
    if (server.proxyJump) {
      const proxyResult = this.validation.validateHostname(server.proxyJump);
      if (!proxyResult.valid) {
        return `ProxyJump: ${proxyResult.error}`;
      }
    }
    if (server.extraArgs && server.extraArgs.length > 0) {
      const argsResult = this.validation.validateExtraArgs(server.extraArgs);
      if (!argsResult.valid) {
        return argsResult.error;
      }
    }
    return undefined;
  }

  private buildArgs(server: SSHServer): string[] {
    const args: string[] = [];

    if (server.port && server.port !== 22) {
      args.push('-p', String(server.port));
    }

    if (server.identityFile) {
      const resolved = this.validation.resolveHomePath(server.identityFile);
      args.push('-i', resolved);

      // Check permissions and warn
      const warning = this.validation.checkIdentityFilePermissions(resolved);
      if (warning) {
        vscode.window.showWarningMessage(`WarpGate: ${warning}`);
      }
    }

    if (server.proxyJump) {
      args.push('-J', server.proxyJump);
    }

    if (server.extraArgs) {
      args.push(...server.extraArgs);
    }

    // user@host must be the last argument
    args.push(`${server.username}@${server.host}`);

    return args;
  }

  private async resolveSSHBinary(): Promise<string> {
    // SECURITY: Check user-configured path first, but validate it.
    const configured = vscode.workspace
      .getConfiguration('warpgate')
      .get<string>('sshBinaryPath', '');

    if (configured) {
      const validated = this.validateSSHBinaryPath(configured);
      if (validated) {
        return validated;
      }
      vscode.window.showWarningMessage(
        `WarpGate: Configured SSH binary path "${configured}" is not a recognized SSH binary. Using auto-detected path instead.`,
      );
    }

    // Cache the resolved path
    if (this.sshBinaryPath) {
      return this.sshBinaryPath;
    }

    // SECURITY: Use execFileSync instead of execSync to avoid shell invocation
    try {
      const result = cp.execFileSync('/usr/bin/which', ['ssh'], {
        encoding: 'utf-8',
        timeout: 5000,
      }).trim();

      if (result && this.validateSSHBinaryPath(result)) {
        this.sshBinaryPath = result;
        return result;
      }
    } catch {
      // which failed
    }

    // Fallback to common locations
    for (const dir of TRUSTED_SSH_DIRECTORIES) {
      const candidate = path.join(dir, 'ssh');
      try {
        const stats = fs.statSync(candidate);
        if (stats.isFile()) {
          this.sshBinaryPath = candidate;
          return candidate;
        }
      } catch {
        continue;
      }
    }

    // Last resort - let the terminal try to resolve it
    return 'ssh';
  }

  /**
   * SECURITY: Validates that a configured SSH binary path is safe.
   * - Must be an absolute path
   * - Must exist as a file
   * - Binary name must be in the allowlist
   * - MUST be in a trusted system directory (rejects untrusted paths entirely)
   */
  private validateSSHBinaryPath(binaryPath: string): string | null {
    if (!path.isAbsolute(binaryPath)) {
      return null;
    }

    const binaryName = path.basename(binaryPath).toLowerCase();
    if (!ALLOWED_SSH_BINARY_NAMES.has(binaryName)) {
      return null;
    }

    const binaryDir = path.dirname(binaryPath);
    const isTrustedDir = TRUSTED_SSH_DIRECTORIES.some(
      (dir) => binaryDir === dir || binaryDir.startsWith(dir + path.sep),
    );

    // SECURITY: BLOCK execution from untrusted directories entirely.
    // A malicious .vscode/settings.json could point to /tmp/ssh or similar.
    if (!isTrustedDir) {
      return null;
    }

    try {
      const stats = fs.statSync(binaryPath);
      if (!stats.isFile()) {
        return null;
      }
    } catch {
      return null;
    }

    return binaryPath;
  }
}

/**
 * SECURITY: Shell-escape a string for safe pasting into a terminal.
 * Wraps in single quotes and escapes embedded single quotes.
 * Only used for the copy-to-clipboard display string, never for execution.
 */
function shellEscape(arg: string): string {
  if (/^[a-zA-Z0-9@._:\/~-]+$/.test(arg)) {
    return arg;
  }
  return `'${arg.replace(/'/g, "'\\''")}'`;
}
