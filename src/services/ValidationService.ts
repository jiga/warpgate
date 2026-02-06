import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  HOSTNAME_REGEX,
  USERNAME_REGEX,
  SERVER_NAME_MAX_LENGTH,
  PORT_MIN,
  PORT_MAX,
  ALLOWED_SSH_FLAGS,
  ALLOWED_SSH_VALUE_FLAGS,
  SHELL_METACHARACTERS,
} from '../constants';
import { ValidationResult } from '../types';

export class ValidationService {
  validateServerName(name: string): ValidationResult {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return { valid: false, error: 'Server name cannot be empty' };
    }
    if (trimmed.length > SERVER_NAME_MAX_LENGTH) {
      return { valid: false, error: `Server name must be ${SERVER_NAME_MAX_LENGTH} characters or fewer` };
    }
    return { valid: true };
  }

  validateHostname(host: string): ValidationResult {
    const trimmed = host.trim();
    if (trimmed.length === 0) {
      return { valid: false, error: 'Hostname cannot be empty' };
    }
    if (SHELL_METACHARACTERS.test(trimmed)) {
      return { valid: false, error: 'Hostname contains invalid characters' };
    }
    // Allow IP addresses (IPv4)
    const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(trimmed);
    if (ipv4) {
      const octets = trimmed.split('.').map(Number);
      const validOctets = octets.every((o) => o >= 0 && o <= 255);
      if (!validOctets) {
        return { valid: false, error: 'Invalid IPv4 address' };
      }
      return { valid: true };
    }
    // Allow IPv6 in brackets
    if (/^\[[\da-fA-F:]+\]$/.test(trimmed)) {
      return { valid: true };
    }
    if (!HOSTNAME_REGEX.test(trimmed)) {
      return { valid: false, error: 'Hostname must contain only letters, numbers, dots, hyphens, and underscores' };
    }
    return { valid: true };
  }

  validatePort(port: number | string): ValidationResult {
    const num = typeof port === 'string' ? parseInt(port, 10) : port;
    if (isNaN(num) || !Number.isInteger(num)) {
      return { valid: false, error: 'Port must be an integer' };
    }
    if (num < PORT_MIN || num > PORT_MAX) {
      return { valid: false, error: `Port must be between ${PORT_MIN} and ${PORT_MAX}` };
    }
    return { valid: true };
  }

  validateUsername(username: string): ValidationResult {
    const trimmed = username.trim();
    if (trimmed.length === 0) {
      return { valid: false, error: 'Username cannot be empty' };
    }
    if (SHELL_METACHARACTERS.test(trimmed)) {
      return { valid: false, error: 'Username contains invalid characters' };
    }
    if (!USERNAME_REGEX.test(trimmed)) {
      return { valid: false, error: 'Username must start with a letter or underscore and contain only letters, numbers, dots, hyphens, and underscores' };
    }
    return { valid: true };
  }

  validateIdentityFile(filePath: string): ValidationResult {
    const trimmed = filePath.trim();
    if (trimmed.length === 0) {
      return { valid: true }; // identity file is optional
    }
    if (SHELL_METACHARACTERS.test(trimmed)) {
      return { valid: false, error: 'Identity file path contains invalid characters' };
    }
    const resolved = this.resolveHomePath(trimmed);
    if (!path.isAbsolute(resolved)) {
      return { valid: false, error: 'Identity file must be an absolute path' };
    }
    if (!fs.existsSync(resolved)) {
      return { valid: false, error: `Identity file not found: ${resolved}` };
    }
    return { valid: true };
  }

  checkIdentityFilePermissions(filePath: string): string | undefined {
    const resolved = this.resolveHomePath(filePath.trim());
    try {
      const stats = fs.statSync(resolved);
      const mode = stats.mode & 0o777;
      if (mode & 0o077) {
        return `Identity file ${resolved} has permissions ${mode.toString(8)}. SSH may refuse keys with permissions more open than 0600.`;
      }
    } catch {
      // File doesn't exist or can't be read - already validated elsewhere
    }
    return undefined;
  }

  validateExtraArgs(args: string[]): ValidationResult {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (SHELL_METACHARACTERS.test(arg)) {
        return { valid: false, error: `Argument "${arg}" contains invalid characters` };
      }
      if (ALLOWED_SSH_FLAGS.has(arg)) {
        continue;
      }
      if (ALLOWED_SSH_VALUE_FLAGS.has(arg)) {
        // Value flags consume the next argument
        if (i + 1 >= args.length) {
          return { valid: false, error: `Flag "${arg}" requires a value` };
        }
        const value = args[i + 1];
        if (SHELL_METACHARACTERS.test(value)) {
          return { valid: false, error: `Value for "${arg}" contains invalid characters` };
        }
        i++; // skip the value
        continue;
      }
      return { valid: false, error: `SSH flag "${arg}" is not in the allowed list` };
    }
    return { valid: true };
  }

  validateGroupName(name: string): ValidationResult {
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      return { valid: false, error: 'Group name cannot be empty' };
    }
    if (trimmed.length > SERVER_NAME_MAX_LENGTH) {
      return { valid: false, error: `Group name must be ${SERVER_NAME_MAX_LENGTH} characters or fewer` };
    }
    return { valid: true };
  }

  resolveHomePath(filePath: string): string {
    if (filePath.startsWith('~/') || filePath === '~') {
      return path.join(os.homedir(), filePath.slice(1));
    }
    return filePath;
  }
}
