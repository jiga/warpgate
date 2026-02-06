import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ValidationService } from '../services/ValidationService';

// SECURITY: Only allow these key types — all considered safe as of 2024
const ALLOWED_KEY_TYPES = ['ed25519', 'rsa'] as const;
type KeyType = typeof ALLOWED_KEY_TYPES[number];

const KEY_TYPE_OPTIONS: Array<{ label: string; description: string; value: KeyType }> = [
  {
    label: '$(key) Ed25519 (Recommended)',
    description: 'Modern, fast, small keys — best security/performance',
    value: 'ed25519',
  },
  {
    label: '$(key) RSA 4096-bit',
    description: 'Widely compatible, larger keys',
    value: 'rsa',
  },
];

export function registerKeygenCommands(
  context: vscode.ExtensionContext,
  validation: ValidationService,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('warpgate.generateSSHKey', () => generateSSHKey(validation)),
  );
}

async function generateSSHKey(_validation: ValidationService): Promise<void> {
  // Step 1: Key type
  const typeChoice = await vscode.window.showQuickPick(KEY_TYPE_OPTIONS, {
    title: 'WarpGate: Generate SSH Key (1/3)',
    placeHolder: 'Select key type',
  });
  if (!typeChoice) { return; }

  // Step 2: Key filename
  const sshDir = path.join(os.homedir(), '.ssh');
  const defaultName = typeChoice.value === 'ed25519' ? 'id_ed25519' : 'id_rsa';

  const keyName = await vscode.window.showInputBox({
    title: 'WarpGate: Generate SSH Key (2/3)',
    prompt: 'Enter key filename (will be created in ~/.ssh/)',
    value: defaultName,
    validateInput: (v) => {
      const trimmed = v.trim();
      if (trimmed.length === 0) {
        return 'Filename cannot be empty';
      }
      if (/[/\\:*?"<>|]/.test(trimmed)) {
        return 'Filename contains invalid characters';
      }
      if (trimmed.startsWith('.') || trimmed.startsWith('-')) {
        return 'Filename must not start with . or -';
      }
      const fullPath = path.join(sshDir, trimmed);
      if (fs.existsSync(fullPath)) {
        return `File already exists: ${fullPath}. Choose a different name.`;
      }
      return undefined;
    },
  });
  if (!keyName) { return; }

  // Step 3: Passphrase (optional)
  const passphrase = await vscode.window.showInputBox({
    title: 'WarpGate: Generate SSH Key (3/3)',
    prompt: 'Enter passphrase (leave empty for no passphrase)',
    password: true,
    placeHolder: 'Optional passphrase to encrypt the key',
  });
  if (passphrase === undefined) { return; } // Cancelled, not empty

  // Confirm passphrase if non-empty
  if (passphrase.length > 0) {
    const confirm = await vscode.window.showInputBox({
      title: 'WarpGate: Confirm Passphrase',
      prompt: 'Re-enter passphrase to confirm',
      password: true,
    });
    if (confirm === undefined) { return; }
    if (confirm !== passphrase) {
      vscode.window.showErrorMessage('WarpGate: Passphrases do not match.');
      return;
    }
  }

  // Ensure ~/.ssh exists
  if (!fs.existsSync(sshDir)) {
    fs.mkdirSync(sshDir, { mode: 0o700 });
  }

  const keyPath = path.join(sshDir, keyName.trim());

  // SECURITY: Find ssh-keygen in trusted directories only
  const sshKeygenPath = findSSHKeygen();
  if (!sshKeygenPath) {
    vscode.window.showErrorMessage('WarpGate: ssh-keygen not found in trusted system directories.');
    return;
  }

  // Build ssh-keygen arguments
  const args: string[] = [
    '-t', typeChoice.value,
    '-f', keyPath,
    '-N', passphrase, // -N sets the passphrase (empty string = no passphrase)
    '-C', `warpgate-${new Date().toISOString().split('T')[0]}`,
  ];

  if (typeChoice.value === 'rsa') {
    args.push('-b', '4096');
  }

  // Run ssh-keygen
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: 'WarpGate: Generating SSH key...',
      cancellable: false,
    },
    async () => {
      return new Promise<void>((resolve, reject) => {
        // SECURITY: Use execFile (no shell) to prevent injection
        cp.execFile(sshKeygenPath, args, { timeout: 30000 }, (error, _stdout, _stderr) => {
          if (error) {
            vscode.window.showErrorMessage(`WarpGate: Key generation failed — ${error.message}`);
            reject(error);
            return;
          }

          // Set correct permissions
          try {
            fs.chmodSync(keyPath, 0o600);
            fs.chmodSync(keyPath + '.pub', 0o644);
          } catch {
            // Best-effort — Windows doesn't support chmod
          }

          resolve();
        });
      });
    },
  );

  // Read the public key for display
  const publicKeyPath = keyPath + '.pub';
  let publicKey = '';
  try {
    publicKey = fs.readFileSync(publicKeyPath, 'utf-8').trim();
  } catch {
    // Non-fatal
  }

  // Show success with actions
  const action = await vscode.window.showInformationMessage(
    `WarpGate: SSH key generated successfully!\n${keyPath}`,
    'Copy Public Key',
    'Open in Editor',
  );

  if (action === 'Copy Public Key' && publicKey) {
    await vscode.env.clipboard.writeText(publicKey);
    vscode.window.showInformationMessage('WarpGate: Public key copied to clipboard');
  } else if (action === 'Open in Editor') {
    const doc = await vscode.workspace.openTextDocument(publicKeyPath);
    await vscode.window.showTextDocument(doc);
  }
}

/**
 * SECURITY: Find ssh-keygen only in trusted system directories.
 * Never execute ssh-keygen from an untrusted location.
 */
function findSSHKeygen(): string | null {
  const trustedDirs = [
    '/usr/bin',
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/sbin',
    '/bin',
    'C:\\Windows\\System32\\OpenSSH',
    'C:\\Program Files\\OpenSSH',
  ];

  for (const dir of trustedDirs) {
    const candidate = path.join(dir, 'ssh-keygen');
    try {
      if (fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Not found in this dir
    }
  }

  return null;
}
