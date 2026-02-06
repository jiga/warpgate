# Changelog

All notable changes to the WarpGate extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2024-12-01

### Added

- **Core SSH Management**: Add, edit, delete, rename, and duplicate SSH server configurations.
- **SSH Config Import**: Import hosts from `~/.ssh/config` with full Include directive support.
- **Workspace Isolation**: Server lists are scoped per VS Code workspace — no cross-contamination.
- **Group Management**: Organize servers into collapsible groups with drag-and-drop-style move.
- **Terminal Integration**: One-click SSH connections via VS Code integrated terminal using `shellPath`/`shellArgs` (no shell injection surface).
- **Copy SSH Command**: Copy a shell-escaped SSH command string to clipboard.
- **Quick Connect**: `Ctrl+Shift+P` → type server name → connect instantly from the command palette.
- **Port Forwarding UI**: Create local (`-L`), remote (`-R`), and dynamic SOCKS (`-D`) tunnels through a guided wizard.
- **SSH Key Generation Wizard**: Generate Ed25519 or RSA keys directly from VS Code with optional passphrase.
- **Connection Health Monitor**: Automatic keepalive detection and one-click reconnect for dropped sessions.
- **Export/Import Config**: Share workspace server configurations as JSON files with teammates.

### Security

- **5-layer SSH key protection**: Path confinement, filename rejection, extension rejection, content sniffing, and memory scrubbing prevent private key material from ever entering extension memory.
- **Connect-time re-validation**: All server fields are re-validated at the moment of SSH execution, blocking crafted objects injected via `executeCommand()`.
- **SSH binary confinement**: Only binaries in trusted system directories (`/usr/bin`, `/usr/local/bin`, `/opt/homebrew/bin`) are permitted. Workspace settings cannot override this.
- **Machine-scoped settings**: Security-sensitive configuration (`sshBinaryPath`, `confirmBeforeDelete`) cannot be overridden by workspace-level settings.
- **Shell injection prevention**: Terminal connections use `shellPath`/`shellArgs` exclusively — no string interpolation, no `sendText()`.
- **Allowlist-based validation**: All user inputs validated against strict regex allowlists (OWASP-style). Shell metacharacters blocked globally.
- **Clipboard safety**: Copied SSH commands are shell-escaped to prevent injection when pasted.
- **Markdown injection prevention**: Tree view tooltips use `isTrusted = false` and `appendText()` for user-supplied values.
