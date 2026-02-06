export const STORAGE_KEY = 'warpgate.config';
export const CONFIG_VERSION = 1;

export const HOSTNAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,252}$/;
export const USERNAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9._-]{0,63}$/;
export const SERVER_NAME_MAX_LENGTH = 100;
export const PORT_MIN = 1;
export const PORT_MAX = 65535;
export const DEFAULT_PORT = 22;

// Only these SSH flags are permitted in extraArgs.
// Each entry is a flag that is safe to pass to the ssh binary.
export const ALLOWED_SSH_FLAGS: ReadonlySet<string> = new Set([
  '-4',       // Force IPv4
  '-6',       // Force IPv6
  '-A',       // Enable agent forwarding
  '-a',       // Disable agent forwarding
  '-C',       // Request compression
  '-N',       // Do not execute remote command
  '-T',       // Disable pseudo-terminal allocation
  '-t',       // Force pseudo-terminal allocation
  '-v',       // Verbose mode
  '-X',       // Enable X11 forwarding
  '-x',       // Disable X11 forwarding
  '-Y',       // Enable trusted X11 forwarding
  '-q',       // Quiet mode
]);

// SSH flags that take a value argument (flag + next arg)
export const ALLOWED_SSH_VALUE_FLAGS: ReadonlySet<string> = new Set([
  '-o',       // SSH option (further validated)
  '-L',       // Local port forwarding
  '-R',       // Remote port forwarding
  '-D',       // Dynamic port forwarding
  '-W',       // Stdio forwarding
]);

// Characters that must never appear in any user-supplied value
// that could reach a shell context (defense in depth)
export const SHELL_METACHARACTERS = /[;&|`$(){}[\]!#~<>*?\n\r\\'"]/;

export const TREE_ITEM_CONTEXT = {
  SERVER: 'sshServer',
  GROUP: 'sshGroup',
} as const;
