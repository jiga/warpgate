import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ConfigParserService } from '../services/ConfigParserService';

/**
 * Tests for ConfigParserService.
 *
 * These tests create a temporary ~/.ssh-warpgate-test/ directory to avoid
 * touching the real ~/.ssh/ directory. We subclass ConfigParserService to
 * override the sshDir for testing purposes.
 */

// Helper: create a testable subclass that uses a custom SSH dir
class TestableConfigParser extends ConfigParserService {
  constructor(sshDir: string) {
    super();
    // Override the private sshDir and sshDirReal via Object.defineProperty
    Object.defineProperty(this, 'sshDir', { value: sshDir, writable: false });
    try {
      const realDir = fs.realpathSync(sshDir);
      Object.defineProperty(this, 'sshDirReal', { value: realDir, writable: false });
    } catch {
      Object.defineProperty(this, 'sshDirReal', { value: sshDir, writable: false });
    }
  }
}

describe('ConfigParserService', () => {
  let testDir: string;
  let parser: TestableConfigParser;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warpgate-test-ssh-'));
    parser = new TestableConfigParser(testDir);
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  function writeConfig(content: string, filename: string = 'config'): string {
    const filePath = path.join(testDir, filename);
    fs.writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  // ─── Basic Parsing ──────────────────────────────────────────────
  describe('basic SSH config parsing', () => {
    it('parses a simple Host block', () => {
      writeConfig(`
Host myserver
  HostName 192.168.1.100
  User admin
  Port 2222
`);
      const hosts = parser.parseDefaultConfig();
      expect(hosts).toHaveLength(1);
      expect(hosts[0].alias).toBe('myserver');
      expect(hosts[0].hostName).toBe('192.168.1.100');
      expect(hosts[0].user).toBe('admin');
      expect(hosts[0].port).toBe(2222);
    });

    it('parses multiple Host blocks', () => {
      writeConfig(`
Host prod
  HostName prod.example.com
  User deploy

Host staging
  HostName staging.example.com
  User admin
`);
      const hosts = parser.parseDefaultConfig();
      expect(hosts).toHaveLength(2);
      expect(hosts[0].alias).toBe('prod');
      expect(hosts[1].alias).toBe('staging');
    });

    it('returns empty array when no config file exists', () => {
      // Don't write any config file
      const hosts = parser.parseDefaultConfig();
      expect(hosts).toEqual([]);
    });

    it('skips comments and empty lines', () => {
      writeConfig(`
# This is a comment
Host myserver
  # Another comment
  HostName 10.0.0.1
  User root

`);
      const hosts = parser.parseDefaultConfig();
      expect(hosts).toHaveLength(1);
      expect(hosts[0].hostName).toBe('10.0.0.1');
    });

    it('parses IdentityFile with tilde expansion', () => {
      writeConfig(`
Host keyserver
  HostName key.example.com
  User admin
  IdentityFile ~/.ssh/id_ed25519
`);
      const hosts = parser.parseDefaultConfig();
      expect(hosts).toHaveLength(1);
      expect(hosts[0].identityFile).toBeDefined();
      expect(hosts[0].identityFile).not.toContain('~');
      expect(hosts[0].identityFile).toContain('.ssh/id_ed25519');
    });

    it('parses ProxyJump directive', () => {
      writeConfig(`
Host internal
  HostName 10.0.0.5
  User admin
  ProxyJump bastion.example.com
`);
      const hosts = parser.parseDefaultConfig();
      expect(hosts).toHaveLength(1);
      expect(hosts[0].proxyJump).toBe('bastion.example.com');
    });

    it('handles = separator syntax', () => {
      writeConfig(`
Host equalsyntax
  HostName=10.0.0.1
  User=root
  Port=3022
`);
      const hosts = parser.parseDefaultConfig();
      expect(hosts).toHaveLength(1);
      expect(hosts[0].hostName).toBe('10.0.0.1');
      expect(hosts[0].user).toBe('root');
      expect(hosts[0].port).toBe(3022);
    });

    it('handles quoted values', () => {
      writeConfig(`
Host quotedhost
  HostName "10.0.0.1"
  User 'admin'
`);
      const hosts = parser.parseDefaultConfig();
      expect(hosts).toHaveLength(1);
      expect(hosts[0].hostName).toBe('10.0.0.1');
      expect(hosts[0].user).toBe('admin');
    });
  });

  // ─── Wildcard Handling ──────────────────────────────────────────
  describe('wildcard handling', () => {
    it('skips wildcard-only Host patterns', () => {
      writeConfig(`
Host *
  ServerAliveInterval 60

Host myserver
  HostName 10.0.0.1
  User admin
`);
      const hosts = parser.parseDefaultConfig();
      expect(hosts).toHaveLength(1);
      expect(hosts[0].alias).toBe('myserver');
    });

    it('skips ? wildcard-only patterns', () => {
      writeConfig(`
Host ???
  User root

Host real
  HostName 10.0.0.1
`);
      const hosts = parser.parseDefaultConfig();
      expect(hosts).toHaveLength(1);
      expect(hosts[0].alias).toBe('real');
    });
  });

  // ─── Match Block Handling ───────────────────────────────────────
  describe('Match block handling', () => {
    it('skips Match blocks', () => {
      writeConfig(`
Host myserver
  HostName 10.0.0.1
  User admin

Match host *.internal
  User internal
`);
      const hosts = parser.parseDefaultConfig();
      expect(hosts).toHaveLength(1);
      expect(hosts[0].alias).toBe('myserver');
    });
  });

  // ─── Include Directives ─────────────────────────────────────────
  describe('Include directives', () => {
    it('follows Include directives within the SSH dir', () => {
      writeConfig(`
Host main
  HostName 10.0.0.1
  User admin

Include extra_config
`);
      writeConfig(`
Host extra
  HostName 10.0.0.2
  User deploy
`, 'extra_config');

      const hosts = parser.parseDefaultConfig();
      expect(hosts).toHaveLength(2);
      expect(hosts.map(h => h.alias).sort()).toEqual(['extra', 'main']);
    });

    it('supports glob patterns in Include', () => {
      writeConfig(`
Include conf.d/*
`);
      // Create conf.d subdirectory
      const confDir = path.join(testDir, 'conf.d');
      fs.mkdirSync(confDir);
      fs.writeFileSync(path.join(confDir, 'prod'), `
Host prod1
  HostName 10.0.1.1
  User admin
`);
      fs.writeFileSync(path.join(confDir, 'staging'), `
Host staging1
  HostName 10.0.2.1
  User deploy
`);

      const hosts = parser.parseDefaultConfig();
      expect(hosts).toHaveLength(2);
    });

    it('handles nested Includes with depth limit', () => {
      // Create a chain that would recurse more than 10 levels
      // but depth limiting should stop it
      writeConfig(`Include level1`, 'config');
      for (let i = 1; i <= 15; i++) {
        writeConfig(`Include level${i + 1}`, `level${i}`);
      }
      writeConfig(`
Host deep
  HostName 10.0.0.1
`, 'level16');

      // Should not crash, should return empty (too deep)
      const hosts = parser.parseDefaultConfig();
      // The host at level 16 should not be found (depth limit is 10)
      const deepHost = hosts.find(h => h.alias === 'deep');
      expect(deepHost).toBeUndefined();
    });

    it('handles Include cycle detection', () => {
      writeConfig(`Include cycle_a`, 'config');
      writeConfig(`Include cycle_b`, 'cycle_a');
      writeConfig(`Include cycle_a`, 'cycle_b'); // Cycle back!

      // Should not infinite loop
      const hosts = parser.parseDefaultConfig();
      expect(Array.isArray(hosts)).toBe(true);
    });
  });

  // ─── SECURITY: Key File Protection ──────────────────────────────
  describe('security: key file protection', () => {
    it('refuses to read files named id_rsa', () => {
      writeConfig(`Include id_rsa`);
      fs.writeFileSync(path.join(testDir, 'id_rsa'), '-----BEGIN RSA PRIVATE KEY-----\nfake key');

      const hosts = parser.parseDefaultConfig();
      expect(hosts).toEqual([]);
    });

    it('refuses to read files named id_ed25519', () => {
      writeConfig(`Include id_ed25519`);
      fs.writeFileSync(path.join(testDir, 'id_ed25519'), '-----BEGIN OPENSSH PRIVATE KEY-----\nfake key');

      const hosts = parser.parseDefaultConfig();
      expect(hosts).toEqual([]);
    });

    it('refuses to read .pem files', () => {
      writeConfig(`Include server.pem`);
      fs.writeFileSync(path.join(testDir, 'server.pem'), '-----BEGIN PRIVATE KEY-----\nfake key');

      const hosts = parser.parseDefaultConfig();
      expect(hosts).toEqual([]);
    });

    it('refuses to read .key files', () => {
      writeConfig(`Include mykey.key`);
      fs.writeFileSync(path.join(testDir, 'mykey.key'), '-----BEGIN EC PRIVATE KEY-----\nfake');

      const hosts = parser.parseDefaultConfig();
      expect(hosts).toEqual([]);
    });

    it('refuses to read .pub files', () => {
      writeConfig(`Include id_rsa.pub`);
      fs.writeFileSync(path.join(testDir, 'id_rsa.pub'), 'ssh-rsa AAAA...');

      const hosts = parser.parseDefaultConfig();
      expect(hosts).toEqual([]);
    });

    it('refuses to read authorized_keys', () => {
      writeConfig(`Include authorized_keys`);
      fs.writeFileSync(path.join(testDir, 'authorized_keys'), 'ssh-rsa AAAA...');

      const hosts = parser.parseDefaultConfig();
      expect(hosts).toEqual([]);
    });

    it('refuses to read files that look like private keys (content sniffing)', () => {
      writeConfig(`Include sneaky_config`);
      // File doesn't have a key-like name, but content starts with key markers
      fs.writeFileSync(path.join(testDir, 'sneaky_config'), '-----BEGIN ENCRYPTED PRIVATE KEY-----\nfake');

      const hosts = parser.parseDefaultConfig();
      expect(hosts).toEqual([]);
    });

    it('does NOT block legitimate config files', () => {
      writeConfig(`Include extra_hosts`);
      fs.writeFileSync(path.join(testDir, 'extra_hosts'), `
Host legitimate
  HostName 10.0.0.1
  User admin
`);

      const hosts = parser.parseDefaultConfig();
      expect(hosts).toHaveLength(1);
      expect(hosts[0].alias).toBe('legitimate');
    });
  });

  // ─── SECURITY: Path Confinement ─────────────────────────────────
  describe('security: path confinement', () => {
    it('refuses to read files outside ~/.ssh/', () => {
      // Create a file outside the SSH dir
      const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'warpgate-outside-'));
      const outsideFile = path.join(outsideDir, 'evil_config');
      fs.writeFileSync(outsideFile, `
Host evil
  HostName evil.example.com
  User hacker
`);

      // Try to include the outside file
      writeConfig(`Include ${outsideFile}`);

      const hosts = parser.parseDefaultConfig();
      // Should NOT have read the outside file
      const evilHost = hosts.find(h => h.alias === 'evil');
      expect(evilHost).toBeUndefined();

      // Cleanup
      fs.rmSync(outsideDir, { recursive: true, force: true });
    });

    it('refuses directory traversal via ../', () => {
      writeConfig(`Include ../../../etc/passwd`);

      const hosts = parser.parseDefaultConfig();
      expect(hosts).toEqual([]);
    });
  });

  // ─── Multi-Host Lines ──────────────────────────────────────────
  describe('multi-host lines', () => {
    it('handles multi-alias Host lines', () => {
      writeConfig(`
Host server1 server2
  HostName 10.0.0.1
  User admin
`);
      const hosts = parser.parseDefaultConfig();
      // Should create entries for both aliases
      expect(hosts.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ─── Port Validation ───────────────────────────────────────────
  describe('port validation in parsed config', () => {
    it('rejects invalid port numbers', () => {
      writeConfig(`
Host badport
  HostName 10.0.0.1
  Port 99999
`);
      const hosts = parser.parseDefaultConfig();
      expect(hosts).toHaveLength(1);
      // Port should be undefined since it's out of range
      expect(hosts[0].port).toBeUndefined();
    });

    it('rejects non-numeric port values', () => {
      writeConfig(`
Host badport2
  HostName 10.0.0.1
  Port abc
`);
      const hosts = parser.parseDefaultConfig();
      expect(hosts).toHaveLength(1);
      expect(hosts[0].port).toBeUndefined();
    });
  });
});
