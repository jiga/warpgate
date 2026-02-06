import * as vscode from 'vscode';
import { SSHServer, SSHGroup } from '../types';
import { StorageService } from '../services/StorageService';
import { TerminalService } from '../services/TerminalService';
import { TREE_ITEM_CONTEXT } from '../constants';

export type TreeElement = ServerTreeItem | GroupTreeItem;

export class ServerTreeItem extends vscode.TreeItem {
  constructor(
    public readonly server: SSHServer,
    public readonly isConnected: boolean,
  ) {
    super(server.name, vscode.TreeItemCollapsibleState.None);

    // Show connection details as description (dimmed text after name)
    const portSuffix = server.port !== 22 ? `:${server.port}` : '';
    this.description = `${server.username}@${server.host}${portSuffix}`;

    this.tooltip = this.buildTooltip();
    this.contextValue = TREE_ITEM_CONTEXT.SERVER;

    // Connected = green plug icon, disconnected = subtle circle
    if (isConnected) {
      this.iconPath = new vscode.ThemeIcon('vm-running', new vscode.ThemeColor('testing.iconPassed'));
    } else {
      this.iconPath = new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('descriptionForeground'));
    }

    this.command = {
      command: 'warpgate.connectServer',
      title: 'Connect',
      arguments: [this],
    };
  }

  private buildTooltip(): vscode.MarkdownString {
    const md = new vscode.MarkdownString();
    // SECURITY: Explicitly mark as untrusted to prevent command URI injection
    md.isTrusted = false;

    // Header
    md.appendMarkdown(`**${this.isConnected ? '🟢' : '⚪'} `);
    // SECURITY: Use appendText for all user-supplied values to prevent markdown injection
    md.appendText(this.server.name);
    md.appendMarkdown('**\n\n');

    md.appendMarkdown('---\n\n');

    md.appendMarkdown('$(globe) Host: `');
    md.appendText(this.server.host);
    md.appendMarkdown('`\n\n');

    md.appendMarkdown('$(person) User: `');
    md.appendText(this.server.username);
    md.appendMarkdown('`\n\n');

    md.appendMarkdown(`$(symbol-number) Port: \`${this.server.port}\`\n\n`);

    if (this.server.identityFile) {
      md.appendMarkdown('$(key) Key: `');
      md.appendText(this.server.identityFile);
      md.appendMarkdown('`\n\n');
    }
    if (this.server.proxyJump) {
      md.appendMarkdown('$(arrow-swap) ProxyJump: `');
      md.appendText(this.server.proxyJump);
      md.appendMarkdown('`\n\n');
    }
    if (this.isConnected) {
      md.appendMarkdown('---\n\n');
      md.appendMarkdown('$(terminal) **Connected**');
    }
    return md;
  }
}

export class GroupTreeItem extends vscode.TreeItem {
  constructor(
    public readonly group: SSHGroup,
    public readonly serverCount: number,
    public readonly connectedCount: number,
  ) {
    super(
      group.name,
      group.collapsed
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.Expanded,
    );

    // Show count as dimmed description
    const connInfo = connectedCount > 0 ? ` · ${connectedCount} active` : '';
    this.description = `${serverCount}${connInfo}`;

    this.contextValue = TREE_ITEM_CONTEXT.GROUP;

    // Use a colored folder icon when there are active connections
    if (connectedCount > 0) {
      this.iconPath = new vscode.ThemeIcon('folder-opened', new vscode.ThemeColor('testing.iconPassed'));
    } else {
      this.iconPath = new vscode.ThemeIcon('folder');
    }
  }
}

export class ServerTreeProvider implements vscode.TreeDataProvider<TreeElement> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<TreeElement | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly storage: StorageService;
  private readonly terminal: TerminalService;

  constructor(storage: StorageService, terminal: TerminalService) {
    this.storage = storage;
    this.terminal = terminal;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TreeElement): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeElement): TreeElement[] {
    if (!element) {
      return this.getRootElements();
    }

    if (element instanceof GroupTreeItem) {
      return this.getGroupChildren(element.group.id);
    }

    return [];
  }

  getParent(element: TreeElement): TreeElement | undefined {
    if (element instanceof ServerTreeItem && element.server.group) {
      const group = this.storage.getGroups().find((g) => g.id === element.server.group);
      if (group) {
        const servers = this.storage.getServersByGroup(group.id);
        const connectedCount = servers.filter((s) => this.terminal.isConnected(s.id)).length;
        return new GroupTreeItem(group, servers.length, connectedCount);
      }
    }
    return undefined;
  }

  private getRootElements(): TreeElement[] {
    const elements: TreeElement[] = [];
    const groups = this.storage.getGroups();

    // Add groups
    for (const group of groups) {
      const servers = this.storage.getServersByGroup(group.id);
      const connectedCount = servers.filter((s) => this.terminal.isConnected(s.id)).length;
      elements.push(new GroupTreeItem(group, servers.length, connectedCount));
    }

    // Add ungrouped servers
    const ungrouped = this.storage.getServers().filter((s) => !s.group);
    for (const server of ungrouped) {
      elements.push(new ServerTreeItem(server, this.terminal.isConnected(server.id)));
    }

    return elements;
  }

  private getGroupChildren(groupId: string): TreeElement[] {
    const servers = this.storage.getServersByGroup(groupId);
    return servers.map((s) => new ServerTreeItem(s, this.terminal.isConnected(s.id)));
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
