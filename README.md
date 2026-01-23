# Ralph TUI

[![npm version](https://img.shields.io/npm/v/ralph-tui.svg)](https://www.npmjs.com/package/ralph-tui)
[![CI](https://github.com/subsy/ralph-tui/actions/workflows/ci.yml/badge.svg)](https://github.com/subsy/ralph-tui/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/subsy/ralph-tui/graph/badge.svg)](https://codecov.io/gh/subsy/ralph-tui)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Built with Bun](https://img.shields.io/badge/Built%20with-Bun-f9f1e1.svg)](https://bun.sh)

**AI Agent Loop Orchestrator** - A terminal UI for orchestrating AI coding agents to work through task lists autonomously.

Ralph TUI connects your AI coding assistant (Claude Code, OpenCode, Factory Droid, Gemini CLI, Codex, Kiro CLI) to your task tracker and runs them in an autonomous loop, completing tasks one-by-one with intelligent selection, error handling, and full visibility.

![Ralph TUI Screenshot](docs/images/ralph-tui.png)

## Quick Start

```bash
# Install
bun install -g ralph-tui

# Setup your project
cd your-project
ralph-tui setup

# Create a PRD with AI assistance
ralph-tui create-prd --chat

# Run Ralph!
ralph-tui run --prd ./prd.json
```

That's it! Ralph will work through your tasks autonomously.

## Documentation

**[ralph-tui.com](https://ralph-tui.com)** - Full documentation, guides, and examples.

### Quick Links

- **[Quick Start Guide](https://ralph-tui.com/docs/getting-started/quick-start)** - Get running in 2 minutes
- **[Installation](https://ralph-tui.com/docs/getting-started/installation)** - All installation options
- **[CLI Reference](https://ralph-tui.com/docs/cli/overview)** - Complete command reference
- **[Configuration](https://ralph-tui.com/docs/configuration/overview)** - Customize Ralph for your workflow
- **[Troubleshooting](https://ralph-tui.com/docs/troubleshooting/common-issues)** - Common issues and solutions

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐   │
│   │  1. SELECT   │────▶│  2. BUILD    │────▶│  3. EXECUTE  │   │
│   │    TASK      │     │    PROMPT    │     │    AGENT     │   │
│   └──────────────┘     └──────────────┘     └──────────────┘   │
│          ▲                                         │            │
│          │                                         ▼            │
│   ┌──────────────┐                         ┌──────────────┐    │
│   │  5. NEXT     │◀────────────────────────│  4. DETECT   │    │
│   │    TASK      │                         │  COMPLETION  │    │
│   └──────────────┘                         └──────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

Ralph selects the highest-priority task, builds a prompt, executes your AI agent, detects completion, and repeats until all tasks are done.

## Features

- **Task Trackers**: prd.json (simple), Beads (git-backed with dependencies)
- **AI Agents**: Claude Code, OpenCode, Factory Droid, Gemini CLI, Codex, Kiro CLI
- **Session Persistence**: Pause anytime, resume later, survive crashes
- **Real-time TUI**: Watch agent output, control execution with keyboard shortcuts
- **Subagent Tracing**: See nested agent calls in real-time
- **Cross-iteration Context**: Automatic progress tracking between tasks
- **Flexible Skills**: Use PRD/task skills directly in your agent or via the TUI
- **Remote Instances**: Monitor and control ralph-tui running on multiple machines from a single TUI

## CLI Commands

| Command | Description |
|---------|-------------|
| `ralph-tui` | Launch the interactive TUI |
| `ralph-tui run [options]` | Start Ralph execution |
| `ralph-tui resume` | Resume an interrupted session |
| `ralph-tui status` | Check session status |
| `ralph-tui logs` | View iteration output logs |
| `ralph-tui setup` | Run interactive project setup |
| `ralph-tui create-prd` | Create a new PRD interactively |
| `ralph-tui convert` | Convert PRD to tracker format |
| `ralph-tui config show` | Display merged configuration |
| `ralph-tui template show` | Display current prompt template |
| `ralph-tui plugins agents` | List available agent plugins |
| `ralph-tui plugins trackers` | List available tracker plugins |
| `ralph-tui run --listen` | Run with remote listener enabled |
| `ralph-tui remote <cmd>` | Manage remote server connections |

### Common Options

```bash
# Run with a PRD file
ralph-tui run --prd ./prd.json

# Run with a Beads epic
ralph-tui run --epic my-epic-id

# Override agent or model
ralph-tui run --agent claude --model sonnet
ralph-tui run --agent opencode --model anthropic/claude-3-5-sonnet

# Limit iterations
ralph-tui run --iterations 5

# Run headless (no TUI)
ralph-tui run --headless

# Run agent in isolated sandbox (bwrap on Linux, sandbox-exec on macOS)
# Requires bwrap to be installed and on PATH (Linux) or uses built-in sandbox-exec (macOS)
ralph-tui run --sandbox
```

### Create PRD Options

```bash
# Create a PRD with AI assistance (default chat mode)
ralph-tui create-prd
ralph-tui prime  # Alias

# Use a custom PRD skill from skills_dir
ralph-tui create-prd --prd-skill my-custom-skill

# Override agent
ralph-tui create-prd --agent claude

# Output to custom directory
ralph-tui create-prd --output ./docs
```

### TUI Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `s` | Start execution |
| `p` | Pause/Resume |
| `d` | Toggle dashboard |
| `T` | Toggle subagent tree panel (Shift+T) |
| `t` | Cycle subagent detail level |
| `o` | Cycle right panel views |
| `,` | Open settings (local tab only) |
| `C` | Open read-only config viewer (Shift+C, works on local and remote tabs) |
| `q` | Quit |
| `?` | Show help |
| `1-9` | Switch to tab 1-9 (remote instances) |
| `[` / `]` | Previous/Next tab |
| `a` | Add new remote instance |
| `e` | Edit current remote (when viewing remote tab) |
| `x` | Delete current remote (when viewing remote tab) |

**Dashboard (`d` key):** Toggle a status panel showing:
- Current execution status and active task
- Agent name and model (e.g., `claude-code`, `anthropic/claude-sonnet`)
- Tracker source (e.g., `prd`, `beads`)
- Git branch with dirty indicator (repo:branch*)
- Sandbox status (🔒 enabled, 🔓 disabled) with mode
- Auto-commit setting (✓ auto, ✗ manual)
- Remote connection info (when viewing remote tabs)

See the [full CLI reference](https://ralph-tui.com/docs/cli/overview) for all options.

### Using Skills Directly in Your Agent

Install ralph-tui skills to your agent using [add-skill](https://github.com/vercel-labs/add-skill):

```bash
# Install all skills to all detected agents globally
bunx add-skill subsy/ralph-tui --all

# Install to a specific agent
bunx add-skill subsy/ralph-tui -a claude-code -g -y

# Or use the ralph-tui wrapper (maps agent IDs automatically)
ralph-tui skills install
ralph-tui skills install --agent claude
```

Use these slash commands in your agent:

```bash
/ralph-tui-prd           # Create a PRD interactively
/ralph-tui-create-json   # Convert PRD to prd.json
/ralph-tui-create-beads  # Convert PRD to Beads issues
```

This lets you create PRDs while referencing source files (`@filename`) and using your full conversation context—then use `ralph-tui run` for autonomous execution.

### Custom Skills Directory

You can configure a custom `skills_dir` in your config file to use custom PRD skills:

```bash
# In .ralph-tui/config.toml or ~/.config/ralph-tui/config.toml
skills_dir = "/path/to/my-skills"

# Then use custom skills
ralph-tui create-prd --prd-skill my-custom-skill
```

Skills must be folders inside `skills_dir` containing a `SKILL.md` file.

## Remote Instance Management

Control multiple ralph-tui instances running on different machines (VPS servers, CI/CD environments, development boxes) from a single TUI.

```
┌─────────────────────────────────────────────────────────────────┐
│  LOCAL [1]│ ● prod [2]│ ◐ staging [3]│ ○ dev [4]│      +       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Your local TUI can connect to and control remote instances    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Quick Start: Remote Control

**On the remote machine (server):**
```bash
# Start ralph with remote listener enabled
ralph-tui run --listen --prd ./prd.json

# First run generates a secure token - save it!
# ═══════════════════════════════════════════════════════════════
#                    Remote Listener Enabled
# ═══════════════════════════════════════════════════════════════
#   Port: 7890
#   New server token generated:
#   OGQwNTcxMjM0NTY3ODkwYWJjZGVmMDEyMzQ1Njc4OQ
#   ⚠️  Save this token securely - it won't be shown again!
# ═══════════════════════════════════════════════════════════════
```

**On your local machine (client):**
```bash
# Add the remote server
ralph-tui remote add prod server.example.com:7890 --token OGQwNTcxMjM0NTY3...

# Test the connection
ralph-tui remote test prod

# Launch TUI - you'll see tabs for local + remote instances
ralph-tui
```

### Remote Listener Commands

**Recommended: Use `run --listen`** (runs engine with remote access):
```bash
# Start with remote listener on default port (7890)
ralph-tui run --listen --prd ./prd.json

# Start with custom port
ralph-tui run --listen --listen-port 8080 --epic my-epic
```

**Token management:**
```bash
# Rotate authentication token (invalidates old token immediately)
ralph-tui run --listen --rotate-token --prd ./prd.json

# View remote listener options
ralph-tui run --help
```

### Remote Configuration Commands

```bash
# Add a remote server
ralph-tui remote add <alias> <host:port> --token <token>

# List all remotes with connection status
ralph-tui remote list

# Test connectivity to a specific remote
ralph-tui remote test <alias>

# Remove a remote
ralph-tui remote remove <alias>

# Push config to a remote (propagate your local settings)
ralph-tui remote push-config <alias>
ralph-tui remote push-config --all  # Push to all remotes
```

### Push Configuration to Remotes

When managing multiple ralph-tui instances, you typically want them all to use the same configuration. The `push-config` command lets you propagate your local config to remote instances:

```bash
# Push config to a specific remote
ralph-tui remote push-config prod

# Preview what would be pushed (without applying)
ralph-tui remote push-config prod --preview

# Push to all configured remotes
ralph-tui remote push-config --all

# Force overwrite existing config without confirmation
ralph-tui remote push-config prod --force

# Push specific scope (global or project config)
ralph-tui remote push-config prod --scope global
ralph-tui remote push-config prod --scope project
```

**How it works:**
1. Reads your local config (`~/.config/ralph-tui/config.toml` or `.ralph-tui/config.toml`)
2. Connects to the remote instance
3. Checks what config exists on the remote
4. Creates a backup if overwriting (e.g., `config.toml.backup.2026-01-19T12-30-00-000Z`)
5. Writes the new config
6. Triggers auto-migration to install skills/templates

**Scope selection:**
- `--scope global`: Push to `~/.config/ralph-tui/config.toml` on remote
- `--scope project`: Push to `.ralph-tui/config.toml` in remote's working directory
- Without `--scope`: Auto-detects based on what exists locally and remotely

### Security Model

Ralph uses a two-tier token system for secure remote access:

| Token Type | Lifetime | Purpose |
|------------|----------|---------|
| Server Token | 90 days | Initial authentication, stored on disk |
| Connection Token | 24 hours | Session authentication, auto-refreshed |

**Security features:**
- Without a token configured, the listener binds only to localhost (127.0.0.1)
- With a token configured, the listener binds to all interfaces (0.0.0.0)
- All connections require authentication
- All remote actions are logged to `~/.config/ralph-tui/audit.log`
- Tokens are shown only once at generation time

### Connection Resilience

Remote connections automatically handle network interruptions:

- **Auto-reconnect**: Exponential backoff from 1s to 30s (max 10 retries)
- **Silent retries**: First 3 retries are silent, then toast notifications appear
- **Status indicators**: `●` connected, `◐` connecting, `⟳` reconnecting, `○` disconnected
- **Metrics display**: Latency (ms) and connection duration shown in tab bar

### Tab Navigation

When connected to remote instances, a tab bar appears at the top of the TUI:

| Key | Action |
|-----|--------|
| `1-9` | Jump directly to tab 1-9 |
| `[` | Previous tab |
| `]` | Next tab |
| `Ctrl+Tab` | Next tab |
| `Ctrl+Shift+Tab` | Previous tab |

The first tab is always "Local" (your current machine). Remote tabs show the alias you configured with connection status.

### Managing Remotes from the TUI

You can add, edit, and delete remote servers directly from the TUI without leaving the interface:

**Add Remote (`a` key):**
Opens a form dialog to configure a new remote:
- **Alias**: A short name for the remote (e.g., "prod", "dev-server")
- **Host**: The server address (e.g., "192.168.1.100", "server.example.com")
- **Port**: The listener port (default: 7890)
- **Token**: The server token (displayed on the remote when you start with `--listen`)

Use `Tab`/`Shift+Tab` to move between fields, `Enter` to save, `Esc` to cancel.

**Edit Remote (`e` key):**
When viewing a remote tab, press `e` to edit its configuration. The form pre-fills with current values. You can change any field, including the alias.

**Delete Remote (`x` key):**
When viewing a remote tab, press `x` to delete it. A confirmation dialog shows the remote details before deletion.

### Full Remote Control

When connected to a remote instance, you have full control:

- **View**: Agent output, logs, progress, task list
- **Control**: Pause, resume, cancel execution
- **Modify**: Add/remove iterations, refresh tasks
- **Start**: Begin new task execution

All operations work identically to local control with <100ms perceived latency.

### Configuration Files

| File | Purpose |
|------|---------|
| `~/.config/ralph-tui/remote.json` | Server token storage |
| `~/.config/ralph-tui/remotes.toml` | Remote server configurations |
| `~/.config/ralph-tui/audit.log` | Audit log of all remote actions |
| `~/.config/ralph-tui/listen.pid` | Daemon PID file |

## Contributing

### Development Setup

```bash
git clone https://github.com/subsy/ralph-tui.git
cd ralph-tui
bun install
bun run dev
```

### Build & Test

```bash
bun run build       # Build the project
bun run typecheck   # Type check (no emit)
bun run lint        # Run linter
bun run lint:fix    # Auto-fix lint issues
```

### Testing

```bash
bun test            # Run all tests
bun test --watch    # Run tests in watch mode
bun test --coverage # Run tests with coverage
```

See [CONTRIBUTING.md](CONTRIBUTING.md#testing) for detailed testing documentation including:
- Test file naming conventions
- Using factories and mocks
- Writing new tests
- Coverage requirements

### Pull Request Requirements

PRs must meet these requirements before being merged:
- **>50% test coverage** on new/changed lines (enforced by Codecov)
- **Documentation updates** for any new or changed features
- All CI checks passing (typecheck, lint, tests)

See [CONTRIBUTING.md](CONTRIBUTING.md#pull-request-guidelines) for full PR guidelines.

### Project Structure

```
ralph-tui/
├── src/
│   ├── cli.tsx           # CLI entry point
│   ├── commands/         # CLI commands (run, resume, status, logs, listen, remote, etc.)
│   ├── config/           # Configuration loading and validation (Zod schemas)
│   ├── engine/           # Execution engine (iteration loop, events)
│   ├── interruption/     # Signal handling and graceful shutdown
│   ├── logs/             # Iteration log persistence
│   ├── plugins/
│   │   ├── agents/       # Agent plugins (claude, opencode)
│   │   │   └── tracing/  # Subagent tracing parser
│   │   └── trackers/     # Tracker plugins (beads, beads-bv, json)
│   ├── remote/           # Remote instance management
│   │   ├── server.ts     # WebSocket server for remote control
│   │   ├── client.ts     # WebSocket client with auto-reconnect
│   │   ├── token.ts      # Two-tier token management
│   │   ├── config.ts     # Remote server configuration (TOML)
│   │   ├── audit.ts      # JSONL audit logging
│   │   └── types.ts      # Type definitions
│   ├── session/          # Session persistence and lock management
│   ├── setup/            # Interactive setup wizard
│   ├── templates/        # Handlebars prompt templates
│   ├── chat/             # AI chat mode for PRD creation
│   ├── prd/              # PRD generation and parsing
│   └── tui/              # Terminal UI components (OpenTUI/React)
│       └── components/   # React components (TabBar, Toast, etc.)
├── skills/               # Bundled skills for PRD/task creation
│   ├── ralph-tui-prd/
│   ├── ralph-tui-create-json/
│   └── ralph-tui-create-beads/
├── website/              # Documentation website (Next.js)
└── docs/                 # Images and static assets
```

### Key Technologies

- [Bun](https://bun.sh) - JavaScript runtime
- [OpenTUI](https://github.com/sst/opentui) - Terminal UI framework
- [Handlebars](https://handlebarsjs.com) - Prompt templating

See [CLAUDE.md](CLAUDE.md) for detailed development guidelines.

## Credits

Thanks to Geoffrey Huntley for the [original Ralph Wiggum loop concept](https://ghuntley.com/ralph/).

## License

MIT License - see [LICENSE](LICENSE) for details.
