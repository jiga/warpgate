import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ParsedSSHHost } from '../types';

/** Maximum recursion depth for Include directives (matches OpenSSH behavior) */
const MAX_INCLUDE_DEPTH = 10;

/** File signatures that indicate private key material — NEVER parse these */
const PRIVATE_KEY_MARKERS: readonly string[] = [
  '-----BEGIN',
  '-----BEGIN OPENSSH PRIVATE KEY',
  '-----BEGIN RSA PRIVATE KEY',
  '-----BEGIN EC PRIVATE KEY',
  '-----BEGIN DSA PRIVATE KEY',
  '-----BEGIN PRIVATE KEY',
  '-----BEGIN ENCRYPTED PRIVATE KEY',
];

/** File extensions that are known SSH key files — NEVER read these */
const KEY_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.pem', '.key', '.pub',
]);

/** Filenames that are known SSH key files — NEVER read these */
const KEY_FILE_NAMES: ReadonlySet<string> = new Set([
  'id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa', 'id_xmss',
  'id_rsa.pub', 'id_ed25519.pub', 'id_ecdsa.pub', 'id_dsa.pub', 'id_xmss.pub',
  'authorized_keys', 'known_hosts',
]);

export class ConfigParserService {
  private readonly sshDir: string;
  private readonly sshDirReal: string | null;

  constructor() {
    this.sshDir = path.join(os.homedir(), '.ssh');
    // Resolve symlinks once at construction for consistent path confinement checks
    try {
      this.sshDirReal = fs.realpathSync(this.sshDir);
    } catch {
      this.sshDirReal = this.sshDir;
    }
  }

  parseDefaultConfig(): ParsedSSHHost[] {
    const configPath = path.join(this.sshDir, 'config');
    if (!fs.existsSync(configPath)) {
      return [];
    }
    return this.parseFileConfined(configPath, 0, new Set());
  }

  /**
   * SECURITY: All file reading is confined to this single private method.
   * - Files must be within ~/.ssh/ (path confinement)
   * - Files must not be private key files (content sniffing + name/extension check)
   * - Recursion is depth-limited and cycle-detected
   * - Content is scrubbed from memory after parsing
   */
  private parseFileConfined(filePath: string, depth: number, visitedFiles: Set<string>): ParsedSSHHost[] {
    const resolved = this.resolveHomePath(filePath);

    // SECURITY: Prevent infinite recursion
    if (depth > MAX_INCLUDE_DEPTH) {
      return [];
    }

    // SECURITY: Prevent Include cycles
    const realPath = this.safeRealPath(resolved);
    if (!realPath) {
      return [];
    }
    if (visitedFiles.has(realPath)) {
      return [];
    }

    // SECURITY: Path confinement — only read files within ~/.ssh/
    if (!this.isWithinSSHDir(realPath)) {
      return [];
    }

    // SECURITY: Reject known key file names and extensions
    if (this.isKeyFile(realPath)) {
      return [];
    }

    visitedFiles.add(realPath);

    if (!fs.existsSync(resolved)) {
      return [];
    }

    let content: string;
    try {
      content = fs.readFileSync(resolved, 'utf-8');
    } catch {
      return [];
    }

    // SECURITY: Reject files that look like private keys (content sniffing)
    if (this.looksLikePrivateKey(content)) {
      content = ''; // Scrub immediately
      return [];
    }

    try {
      return this.parseContent(content, path.dirname(resolved), depth, visitedFiles);
    } finally {
      // SECURITY: Scrub file content from local variable after parsing.
      // V8 does not guarantee memory zeroing, but overwriting reduces the
      // window during which sensitive content exists in heap.
      content = '';
    }
  }

  /**
   * Parse SSH config content. This method is private to prevent external callers
   * from bypassing the path confinement and key-file rejection in parseFileConfined().
   */
  private parseContent(content: string, baseDir: string, depth: number = 0, visitedFiles: Set<string> = new Set()): ParsedSSHHost[] {
    const hosts: ParsedSSHHost[] = [];
    let current: ParsedSSHHost | null = null;

    const lines = content.split(/\r?\n/);

    for (const rawLine of lines) {
      const line = rawLine.trim();

      // Skip empty lines and comments
      if (line.length === 0 || line.startsWith('#')) {
        continue;
      }

      const { key, value } = this.parseLine(line);
      if (!key || !value) {
        continue;
      }

      const keyLower = key.toLowerCase();

      // Handle Include directive
      if (keyLower === 'include') {
        const includedHosts = this.handleInclude(value, baseDir, depth, visitedFiles);
        hosts.push(...includedHosts);
        continue;
      }

      // Handle Host directive
      if (keyLower === 'host') {
        // Save previous host if valid
        if (current && !this.isWildcardOnly(current.alias)) {
          hosts.push(current);
        }

        // Skip wildcard-only patterns
        if (this.isWildcardOnly(value)) {
          current = null;
          continue;
        }

        // Handle multi-host lines: take the first non-wildcard alias
        const aliases = value.split(/\s+/).filter((a) => !this.isWildcardOnly(a));
        if (aliases.length === 0) {
          current = null;
          continue;
        }

        // Create a host entry for each alias
        for (const alias of aliases) {
          current = { alias };
          if (alias !== aliases[aliases.length - 1]) {
            hosts.push(current);
          }
        }
        current = { alias: aliases[aliases.length - 1] };
        continue;
      }

      // Handle Match blocks - skip them entirely
      if (keyLower === 'match') {
        if (current && !this.isWildcardOnly(current.alias)) {
          hosts.push(current);
        }
        current = null;
        continue;
      }

      // Apply directives to current host
      if (!current) {
        continue;
      }

      switch (keyLower) {
        case 'hostname':
          current.hostName = value;
          break;
        case 'user':
          current.user = value;
          break;
        case 'port': {
          const port = parseInt(value, 10);
          if (!isNaN(port) && port >= 1 && port <= 65535) {
            current.port = port;
          }
          break;
        }
        case 'identityfile':
          current.identityFile = this.resolveHomePath(value);
          break;
        case 'proxyjump':
          current.proxyJump = value;
          break;
      }
    }

    // Don't forget the last host
    if (current && !this.isWildcardOnly(current.alias)) {
      hosts.push(current);
    }

    return hosts;
  }

  private handleInclude(pattern: string, baseDir: string, depth: number, visitedFiles: Set<string>): ParsedSSHHost[] {
    if (depth >= MAX_INCLUDE_DEPTH) {
      return [];
    }

    const resolved = this.resolveIncludePath(pattern, baseDir);
    const hosts: ParsedSSHHost[] = [];

    const files = this.expandGlob(resolved);
    for (const file of files) {
      hosts.push(...this.parseFileConfined(file, depth + 1, visitedFiles));
    }

    return hosts;
  }

  private resolveIncludePath(pattern: string, baseDir: string): string {
    const expanded = this.resolveHomePath(pattern);
    if (path.isAbsolute(expanded)) {
      return expanded;
    }
    return path.join(baseDir, expanded);
  }

  private expandGlob(pattern: string): string[] {
    const dir = path.dirname(pattern);
    const base = path.basename(pattern);

    if (!base.includes('*') && !base.includes('?')) {
      return fs.existsSync(pattern) ? [pattern] : [];
    }

    if (!fs.existsSync(dir)) {
      return [];
    }

    try {
      const entries = fs.readdirSync(dir);
      const regex = this.globToRegex(base);
      return entries
        .filter((entry) => regex.test(entry))
        .map((entry) => path.join(dir, entry))
        .filter((p) => {
          try {
            return fs.statSync(p).isFile();
          } catch {
            return false;
          }
        })
        .sort();
    } catch {
      return [];
    }
  }

  private globToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]');
    return new RegExp(`^${escaped}$`);
  }

  /**
   * SECURITY: Check if a resolved real path is within ~/.ssh/ directory.
   * Prevents Include directives from reading files outside the SSH config directory.
   */
  private isWithinSSHDir(realPath: string): boolean {
    if (!this.sshDirReal) {
      return false;
    }
    return realPath === this.sshDirReal || realPath.startsWith(this.sshDirReal + path.sep);
  }

  /**
   * SECURITY: Check if a file is a known SSH key file by name or extension.
   * These files must NEVER be read by the config parser.
   */
  private isKeyFile(filePath: string): boolean {
    const basename = path.basename(filePath).toLowerCase();
    const ext = path.extname(filePath).toLowerCase();

    if (KEY_FILE_NAMES.has(basename)) {
      return true;
    }
    if (KEY_FILE_EXTENSIONS.has(ext)) {
      return true;
    }
    return false;
  }

  /**
   * SECURITY: Content-sniff the first line to detect private key material.
   * Defense-in-depth: even if name/extension checks miss a key file,
   * this catches it by looking at the actual content.
   */
  private looksLikePrivateKey(content: string): boolean {
    // Check only the first 50 chars of the first line for performance
    const firstLine = content.substring(0, 50).trimStart();
    return PRIVATE_KEY_MARKERS.some((marker) => firstLine.startsWith(marker));
  }

  private parseLine(line: string): { key: string | null; value: string | null } {
    const eqIndex = line.indexOf('=');
    const spaceIndex = line.indexOf(' ');
    const tabIndex = line.indexOf('\t');

    let separatorIndex: number;
    if (eqIndex !== -1 && (spaceIndex === -1 || eqIndex < spaceIndex) && (tabIndex === -1 || eqIndex < tabIndex)) {
      separatorIndex = eqIndex;
    } else {
      separatorIndex = Math.min(
        spaceIndex === -1 ? Infinity : spaceIndex,
        tabIndex === -1 ? Infinity : tabIndex,
      );
    }

    if (separatorIndex === Infinity) {
      return { key: null, value: null };
    }

    const key = line.substring(0, separatorIndex).trim();
    let value = line.substring(separatorIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    return { key, value };
  }

  private isWildcardOnly(alias: string): boolean {
    return /^[*?]+$/.test(alias.trim());
  }

  private resolveHomePath(filePath: string): string {
    if (filePath.startsWith('~/') || filePath === '~') {
      return path.join(os.homedir(), filePath.slice(1));
    }
    return filePath;
  }

  private safeRealPath(filePath: string): string | null {
    try {
      return fs.realpathSync(filePath);
    } catch {
      return null;
    }
  }
}
