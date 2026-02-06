import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { SSHServer, SSHGroup, WorkspaceConfig } from '../types';
import { STORAGE_KEY, CONFIG_VERSION, DEFAULT_PORT } from '../constants';

export class StorageService {
  private readonly context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  getConfig(): WorkspaceConfig {
    const raw = this.context.workspaceState.get<WorkspaceConfig>(STORAGE_KEY);
    if (!raw) {
      return this.defaultConfig();
    }
    return this.migrateIfNeeded(raw);
  }

  async saveConfig(config: WorkspaceConfig): Promise<void> {
    await this.context.workspaceState.update(STORAGE_KEY, config);
  }

  async addServer(serverData: Omit<SSHServer, 'id' | 'createdAt' | 'updatedAt'>): Promise<SSHServer> {
    const config = this.getConfig();
    const now = Date.now();
    const server: SSHServer = {
      ...serverData,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    config.servers.push(server);
    await this.saveConfig(config);
    return server;
  }

  async updateServer(id: string, updates: Partial<Omit<SSHServer, 'id' | 'createdAt'>>): Promise<SSHServer | undefined> {
    const config = this.getConfig();
    const index = config.servers.findIndex((s) => s.id === id);
    if (index === -1) {
      return undefined;
    }
    config.servers[index] = {
      ...config.servers[index],
      ...updates,
      updatedAt: Date.now(),
    };
    await this.saveConfig(config);
    return config.servers[index];
  }

  async deleteServer(id: string): Promise<boolean> {
    const config = this.getConfig();
    const index = config.servers.findIndex((s) => s.id === id);
    if (index === -1) {
      return false;
    }
    config.servers.splice(index, 1);
    await this.saveConfig(config);
    return true;
  }

  getServer(id: string): SSHServer | undefined {
    return this.getConfig().servers.find((s) => s.id === id);
  }

  getServers(): SSHServer[] {
    return this.getConfig().servers;
  }

  getServersByGroup(groupId?: string): SSHServer[] {
    return this.getConfig().servers.filter((s) => s.group === groupId);
  }

  async addGroup(name: string): Promise<SSHGroup> {
    const config = this.getConfig();
    const group: SSHGroup = {
      id: crypto.randomUUID(),
      name,
      collapsed: false,
    };
    config.groups.push(group);
    await this.saveConfig(config);
    return group;
  }

  async deleteGroup(id: string): Promise<boolean> {
    const config = this.getConfig();
    const groupIndex = config.groups.findIndex((g) => g.id === id);
    if (groupIndex === -1) {
      return false;
    }
    // Ungroup all servers in this group
    for (const server of config.servers) {
      if (server.group === id) {
        server.group = undefined;
        server.updatedAt = Date.now();
      }
    }
    config.groups.splice(groupIndex, 1);
    await this.saveConfig(config);
    return true;
  }

  async updateGroup(id: string, updates: Partial<Omit<SSHGroup, 'id'>>): Promise<SSHGroup | undefined> {
    const config = this.getConfig();
    const index = config.groups.findIndex((g) => g.id === id);
    if (index === -1) {
      return undefined;
    }
    config.groups[index] = { ...config.groups[index], ...updates };
    await this.saveConfig(config);
    return config.groups[index];
  }

  getGroups(): SSHGroup[] {
    return this.getConfig().groups;
  }

  async addServerFromImport(
    alias: string,
    host: string,
    username: string,
    port: number = DEFAULT_PORT,
    identityFile?: string,
    proxyJump?: string,
  ): Promise<SSHServer> {
    return this.addServer({
      name: alias,
      host,
      username,
      port,
      identityFile,
      proxyJump,
    });
  }

  private defaultConfig(): WorkspaceConfig {
    return {
      servers: [],
      groups: [],
      version: CONFIG_VERSION,
    };
  }

  private migrateIfNeeded(config: WorkspaceConfig): WorkspaceConfig {
    // Future schema migrations go here
    if (!config.version) {
      config.version = CONFIG_VERSION;
      config.groups = config.groups ?? [];
    }
    return config;
  }
}
