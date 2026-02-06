<p align="center">
  <img src="resources/warpgate-icon.png" width="128" height="128" alt="WarpGate icon">
</p>

<h1 align="center">WarpGate</h1>

<p align="center">
  <strong>SSH server management for VS Code</strong><br>
  Workspace-scoped server lists · SSH config import · One-click terminal connections
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=j2p2.warpgate"><img src="https://img.shields.io/visual-studio-marketplace/v/j2p2.warpgate?label=VS%20Code%20Marketplace&color=blue" alt="VS Code Marketplace"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=j2p2.warpgate"><img src="https://img.shields.io/visual-studio-marketplace/i/j2p2.warpgate?color=green" alt="Installs"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://github.com/jignesh/warpgate/actions/workflows/ci.yml"><img src="https://github.com/jignesh/warpgate/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
</p>

---

## Features

### Server Management
- **Add / Edit / Delete** servers with full SSH field support (host, port, user, identity file, ProxyJump, extra args)
- **Rename & Duplicate** servers for quick variations
- **Bulk Delete** — multi-select servers and groups for removal in one action
- **Groups** — organize servers into collapsible folders

### SSH Config Import
- Import hosts directly from `~/.ssh/config`
- Full support for `Include` directives, `ProxyJump`, `IdentityFile`, and more
- Selective import — choose which hosts to bring in

### Connections
- **One-click connect** — click a server to open an SSH terminal
- **Quick Connect** (<kbd>Cmd+Shift+W</kbd> / <kbd>Ctrl+Shift+W</kbd>) — fuzzy-search all servers from the command palette
- **Port Forwarding** — create Local (`-L`), Remote (`-R`), and Dynamic SOCKS (`-D`) tunnels through a guided wizard
- **Connection Health Monitor** — automatic keepalive detection with one-click reconnect on session drop
- **Copy SSH Command** — copy a properly escaped SSH command to clipboard

### Workspace Isolation
Each VS Code workspace gets its own server list. Open different projects → see different servers. No cross-workspace leakage.

### Utilities
- **SSH Key Generation** — generate Ed25519 or RSA-4096 keys directly from VS Code
- **Export / Import Config** — share workspace server lists as JSON files with teammates

---

## Installation

### From the VS Code Marketplace

1. Open VS Code
2. Press <kbd>Cmd+Shift+X</kbd> (macOS) or <kbd>Ctrl+Shift+X</kbd> (Windows/Linux)
3. Search for **"WarpGate"**
4. Click **Install**

### From a .vsix File

```sh
code --install-extension warpgate-0.1.0.vsix
```

---

## Quick Start

1. Click the **WarpGate** icon in the Activity Bar (left sidebar)
2. Click the **+** button to add a server, or click the **import** button to pull from `~/.ssh/config`
3. Click any server to connect via SSH in the integrated terminal
4. Use <kbd>Cmd+Shift+W</kbd> for instant fuzzy-search connection

---

## Commands

All commands are prefixed with `WarpGate:` in the Command Palette (<kbd>Cmd+Shift+P</kbd>).

| Command | Description |
|---------|-------------|
| Add Server | Add a new SSH server configuration |
| Edit Server | Modify an existing server |
| Delete Server | Remove a server |
| Bulk Delete | Multi-select servers and groups to delete |
| Connect | Open an SSH terminal to the server |
| Quick Connect | Fuzzy-search and connect (<kbd>Cmd+Shift+W</kbd>) |
| Rename Server | Change the display name |
| Duplicate Server | Clone a server configuration |
| Move to Group | Organize a server into a group |
| Create Group | Create a new server group |
| Delete Group | Remove a group (servers become ungrouped) |
| Port Forward | Create an SSH tunnel (Local/Remote/Dynamic) |
| Generate SSH Key | Create a new Ed25519 or RSA key pair |
| Import from SSH Config | Import hosts from `~/.ssh/config` |
| Export Server Config | Export workspace servers to JSON |
| Import Server Config | Import servers from a JSON file |
| Copy SSH Command | Copy the SSH command to clipboard |
| Refresh | Refresh the server tree |

---

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `warpgate.sshBinaryPath` | Auto-detect | Path to SSH binary (machine-scoped) |
| `warpgate.defaultPort` | `22` | Default SSH port for new servers |
| `warpgate.defaultUsername` | System user | Default username for new servers |
| `warpgate.confirmBeforeDelete` | `true` | Confirm before deleting (machine-scoped) |
| `warpgate.showConnectionNotifications` | `true` | Show notification on connect |

---

## Security

WarpGate is designed with security as a first-class concern:

- **No password storage** — uses SSH key-based auth only; identity files referenced by path
- **No shell injection** — terminal connections use VS Code's `shellPath`/`shellArgs` API exclusively; never `sendText()` or string interpolation
- **Allowlist input validation** — all user inputs validated against strict regex allowlists; shell metacharacters rejected globally
- **SSH binary confinement** — only binaries in trusted system directories (`/usr/bin`, `/usr/local/bin`, `/opt/homebrew/bin`) are permitted; workspace settings cannot override
- **5-layer key protection** — the SSH config parser uses path confinement, filename rejection, extension rejection, content sniffing, and memory scrubbing to prevent private key material from entering extension memory
- **Connect-time re-validation** — all server fields are re-validated at execution time, blocking crafted objects injected via `executeCommand()`
- **Machine-scoped settings** — security-critical settings (`sshBinaryPath`, `confirmBeforeDelete`) cannot be overridden by workspace-level settings
- **Markdown injection prevention** — tooltips use `isTrusted = false` and `appendText()` for user-supplied values
- **Zero telemetry** — no data collection, no analytics, no phone-home

---

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [VS Code](https://code.visualstudio.com/) 1.85+

### Setup

```sh
git clone https://github.com/jignesh/warpgate.git
cd warpgate
npm install
```

### Build & Run

```sh
# Compile (type-check only)
npm run compile

# Build for production (esbuild bundle)
npm run build

# Watch mode for development
npm run watch

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Package as .vsix
npm run package
```

### Debugging

Press <kbd>F5</kbd> in VS Code to launch the Extension Development Host with WarpGate loaded.

---

## Project Structure

```
warpgate/
├── src/
│   ├── extension.ts                  # Entry point
│   ├── types.ts                      # TypeScript interfaces
│   ├── constants.ts                  # Patterns & defaults
│   ├── providers/
│   │   └── ServerTreeProvider.ts     # Tree view data provider
│   ├── services/
│   │   ├── ConfigParserService.ts    # ~/.ssh/config parser
│   │   ├── StorageService.ts         # Workspace-scoped persistence
│   │   ├── TerminalService.ts        # SSH terminal creation
│   │   ├── ValidationService.ts      # Input sanitization
│   │   └── HealthMonitorService.ts   # Connection health monitoring
│   ├── commands/
│   │   ├── serverCommands.ts         # CRUD + bulk delete
│   │   ├── importCommands.ts         # SSH config import
│   │   ├── tunnelCommands.ts         # Port forwarding wizard
│   │   ├── keygenCommands.ts         # SSH key generation
│   │   ├── configExportCommands.ts   # Export/import JSON config
│   │   └── quickConnectCommands.ts   # Fuzzy quick connect
│   └── test/
│       ├── ValidationService.test.ts # 44 validation tests
│       └── ConfigParserService.test.ts # 28 parser tests
├── resources/                        # Icons
├── package.json                      # Extension manifest
├── tsconfig.json
├── esbuild.js                        # Production bundler
├── vitest.config.ts                  # Test configuration
├── CHANGELOG.md
└── LICENSE                           # MIT
```

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run `npm run compile && npm test` to verify
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

Please ensure:
- TypeScript compiles with zero errors
- All tests pass
- New features include tests where applicable
- Code follows the existing style (ESLint enforced)

---

## Publishing

### Manual (Recommended for first-time)

1. Package the extension:
   ```sh
   npm run package
   ```
2. Go to the [VS Code Marketplace Publisher Portal](https://marketplace.visualstudio.com/manage)
3. Sign in with your Microsoft/Azure account
4. Click **+ New Extension** → **VS Code** → Upload the `.vsix` file

### Automated (GitHub Actions)

Releases are automatically published to the marketplace when you push a version tag:

```sh
git tag v0.1.0
git push origin v0.1.0
```

This requires a `VSCE_PAT` secret configured in your GitHub repository settings. See [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) for details on creating a Personal Access Token.

---

## License

[MIT](LICENSE) — built by [Jignesh](https://github.com/jignesh)
