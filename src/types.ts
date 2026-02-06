export interface SSHServer {
  readonly id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  identityFile?: string;
  proxyJump?: string;
  extraArgs?: string[];
  group?: string;
  readonly createdAt: number;
  updatedAt: number;
}

export interface SSHGroup {
  readonly id: string;
  name: string;
  collapsed: boolean;
}

export interface WorkspaceConfig {
  servers: SSHServer[];
  groups: SSHGroup[];
  version: number;
}

export interface ParsedSSHHost {
  alias: string;
  hostName?: string;
  user?: string;
  port?: number;
  identityFile?: string;
  proxyJump?: string;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

// ─── Port Forwarding Types ───────────────────────────────────────

export type TunnelType = 'local' | 'remote' | 'dynamic';

export interface PortForward {
  type: TunnelType;
  /** For local/remote: 'localPort:remoteHost:remotePort'. For dynamic: 'localPort'. */
  spec: string;
  label: string;
}

// ─── Export/Import Config Types ──────────────────────────────────

export interface ExportedConfig {
  warpgateVersion: string;
  exportedAt: string;
  servers: Omit<SSHServer, 'id' | 'createdAt' | 'updatedAt'>[];
  groups: Omit<SSHGroup, 'id'>[];
}
