import { describe, it, expect, beforeEach } from 'vitest';
import { ValidationService } from '../services/ValidationService';

describe('ValidationService', () => {
  let validation: ValidationService;

  beforeEach(() => {
    validation = new ValidationService();
  });

  // ─── Server Name ────────────────────────────────────────────────
  describe('validateServerName', () => {
    it('accepts valid server names', () => {
      expect(validation.validateServerName('Production').valid).toBe(true);
      expect(validation.validateServerName('My Server 1').valid).toBe(true);
      expect(validation.validateServerName('a').valid).toBe(true);
    });

    it('rejects empty names', () => {
      const result = validation.validateServerName('');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('empty');
    });

    it('rejects whitespace-only names', () => {
      const result = validation.validateServerName('   ');
      expect(result.valid).toBe(false);
    });

    it('rejects names exceeding 100 characters', () => {
      const longName = 'a'.repeat(101);
      const result = validation.validateServerName(longName);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('100');
    });

    it('accepts names at exactly 100 characters', () => {
      const maxName = 'a'.repeat(100);
      expect(validation.validateServerName(maxName).valid).toBe(true);
    });
  });

  // ─── Hostname ───────────────────────────────────────────────────
  describe('validateHostname', () => {
    it('accepts valid hostnames', () => {
      expect(validation.validateHostname('example.com').valid).toBe(true);
      expect(validation.validateHostname('server-01.prod.example.com').valid).toBe(true);
      expect(validation.validateHostname('myhost').valid).toBe(true);
      expect(validation.validateHostname('host_name').valid).toBe(true);
    });

    it('accepts valid IPv4 addresses', () => {
      expect(validation.validateHostname('192.168.1.1').valid).toBe(true);
      expect(validation.validateHostname('10.0.0.1').valid).toBe(true);
      expect(validation.validateHostname('0.0.0.0').valid).toBe(true);
      expect(validation.validateHostname('255.255.255.255').valid).toBe(true);
    });

    it('rejects invalid IPv4 addresses', () => {
      expect(validation.validateHostname('256.1.1.1').valid).toBe(false);
      expect(validation.validateHostname('192.168.1.999').valid).toBe(false);
    });

    it('rejects bracketed IPv6 (brackets are shell metacharacters — security-first design)', () => {
      // IPv6 brackets contain [ and ] which are in the shell metacharacter blocklist.
      // This is intentional: SSH handles IPv6 natively, so users should configure
      // the bare address and let the SSH binary handle bracket notation.
      expect(validation.validateHostname('[::1]').valid).toBe(false);
      expect(validation.validateHostname('[fe80::1]').valid).toBe(false);
    });

    it('rejects empty hostnames', () => {
      expect(validation.validateHostname('').valid).toBe(false);
    });

    it('rejects shell metacharacters', () => {
      expect(validation.validateHostname('host;rm -rf /').valid).toBe(false);
      expect(validation.validateHostname('$(whoami)').valid).toBe(false);
      expect(validation.validateHostname('host`cmd`').valid).toBe(false);
      expect(validation.validateHostname('host|cat /etc/passwd').valid).toBe(false);
      expect(validation.validateHostname('host&bg').valid).toBe(false);
      expect(validation.validateHostname("host'quote").valid).toBe(false);
      expect(validation.validateHostname('host"double').valid).toBe(false);
    });

    it('rejects newlines (command injection)', () => {
      expect(validation.validateHostname('host\nmalicious').valid).toBe(false);
      expect(validation.validateHostname('host\rmalicious').valid).toBe(false);
    });
  });

  // ─── Port ───────────────────────────────────────────────────────
  describe('validatePort', () => {
    it('accepts valid ports as numbers', () => {
      expect(validation.validatePort(22).valid).toBe(true);
      expect(validation.validatePort(1).valid).toBe(true);
      expect(validation.validatePort(65535).valid).toBe(true);
      expect(validation.validatePort(8080).valid).toBe(true);
    });

    it('accepts valid ports as strings', () => {
      expect(validation.validatePort('22').valid).toBe(true);
      expect(validation.validatePort('443').valid).toBe(true);
    });

    it('rejects port 0', () => {
      expect(validation.validatePort(0).valid).toBe(false);
    });

    it('rejects ports above 65535', () => {
      expect(validation.validatePort(65536).valid).toBe(false);
      expect(validation.validatePort(99999).valid).toBe(false);
    });

    it('rejects negative ports', () => {
      expect(validation.validatePort(-1).valid).toBe(false);
    });

    it('rejects non-integer values', () => {
      expect(validation.validatePort(22.5).valid).toBe(false);
      expect(validation.validatePort('abc').valid).toBe(false);
      expect(validation.validatePort('').valid).toBe(false);
    });

    it('rejects NaN', () => {
      expect(validation.validatePort(NaN).valid).toBe(false);
    });
  });

  // ─── Username ───────────────────────────────────────────────────
  describe('validateUsername', () => {
    it('accepts valid usernames', () => {
      expect(validation.validateUsername('root').valid).toBe(true);
      expect(validation.validateUsername('ubuntu').valid).toBe(true);
      expect(validation.validateUsername('admin').valid).toBe(true);
      expect(validation.validateUsername('_service').valid).toBe(true);
      expect(validation.validateUsername('user.name').valid).toBe(true);
      expect(validation.validateUsername('user-name').valid).toBe(true);
      expect(validation.validateUsername('user_123').valid).toBe(true);
    });

    it('rejects empty usernames', () => {
      expect(validation.validateUsername('').valid).toBe(false);
    });

    it('rejects usernames starting with numbers', () => {
      expect(validation.validateUsername('1user').valid).toBe(false);
    });

    it('rejects usernames starting with dots', () => {
      expect(validation.validateUsername('.user').valid).toBe(false);
    });

    it('rejects shell metacharacters', () => {
      expect(validation.validateUsername('user;cmd').valid).toBe(false);
      expect(validation.validateUsername('$(id)').valid).toBe(false);
      expect(validation.validateUsername('user`whoami`').valid).toBe(false);
    });

    it('rejects usernames exceeding 64 characters', () => {
      const longUser = 'a'.repeat(65);
      expect(validation.validateUsername(longUser).valid).toBe(false);
    });

    it('accepts usernames at exactly 64 characters', () => {
      const maxUser = 'a'.repeat(64);
      expect(validation.validateUsername(maxUser).valid).toBe(true);
    });
  });

  // ─── Identity File ─────────────────────────────────────────────
  describe('validateIdentityFile', () => {
    it('accepts empty identity file (optional field)', () => {
      expect(validation.validateIdentityFile('').valid).toBe(true);
    });

    it('rejects shell metacharacters in path', () => {
      expect(validation.validateIdentityFile('/home/user/.ssh/id_rsa;malicious').valid).toBe(false);
      expect(validation.validateIdentityFile('$(cat /etc/passwd)').valid).toBe(false);
    });

    it('rejects relative paths', () => {
      const result = validation.validateIdentityFile('relative/path/key');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('absolute');
    });
  });

  // ─── Extra Args ─────────────────────────────────────────────────
  describe('validateExtraArgs', () => {
    it('accepts allowed standalone flags', () => {
      expect(validation.validateExtraArgs(['-v']).valid).toBe(true);
      expect(validation.validateExtraArgs(['-C']).valid).toBe(true);
      expect(validation.validateExtraArgs(['-A']).valid).toBe(true);
      expect(validation.validateExtraArgs(['-4', '-C', '-v']).valid).toBe(true);
    });

    it('accepts allowed value flags with values', () => {
      expect(validation.validateExtraArgs(['-L', '8080:localhost:80']).valid).toBe(true);
      expect(validation.validateExtraArgs(['-R', '9090:localhost:90']).valid).toBe(true);
      expect(validation.validateExtraArgs(['-D', '1080']).valid).toBe(true);
    });

    it('rejects value flags without values', () => {
      const result = validation.validateExtraArgs(['-L']);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('requires a value');
    });

    it('rejects disallowed flags', () => {
      const result = validation.validateExtraArgs(['-Z']);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('not in the allowed list');
    });

    it('rejects shell metacharacters in args', () => {
      expect(validation.validateExtraArgs([';rm -rf /']).valid).toBe(false);
      expect(validation.validateExtraArgs(['-o', 'Proxy$(cmd)']).valid).toBe(false);
    });

    it('rejects shell metacharacters in value args', () => {
      expect(validation.validateExtraArgs(['-L', '8080;cat /etc/shadow']).valid).toBe(false);
    });

    it('accepts empty args array', () => {
      expect(validation.validateExtraArgs([]).valid).toBe(true);
    });

    it('accepts mixed valid flags', () => {
      expect(validation.validateExtraArgs(['-v', '-L', '8080:localhost:80', '-C']).valid).toBe(true);
    });
  });

  // ─── Group Name ────────────────────────────────────────────────
  describe('validateGroupName', () => {
    it('accepts valid group names', () => {
      expect(validation.validateGroupName('Production').valid).toBe(true);
      expect(validation.validateGroupName('Dev Servers').valid).toBe(true);
    });

    it('rejects empty group names', () => {
      expect(validation.validateGroupName('').valid).toBe(false);
    });

    it('rejects group names exceeding 100 characters', () => {
      const longName = 'a'.repeat(101);
      expect(validation.validateGroupName(longName).valid).toBe(false);
    });
  });

  // ─── Home Path Resolution ──────────────────────────────────────
  describe('resolveHomePath', () => {
    it('expands tilde to home directory', () => {
      const result = validation.resolveHomePath('~/.ssh/id_rsa');
      expect(result).toContain('.ssh/id_rsa');
      expect(result).not.toContain('~');
    });

    it('expands standalone tilde', () => {
      const result = validation.resolveHomePath('~');
      expect(result).not.toBe('~');
      expect(result.length).toBeGreaterThan(1);
    });

    it('does not modify absolute paths', () => {
      expect(validation.resolveHomePath('/usr/bin/ssh')).toBe('/usr/bin/ssh');
    });

    it('does not modify relative paths', () => {
      expect(validation.resolveHomePath('relative/path')).toBe('relative/path');
    });
  });
});
