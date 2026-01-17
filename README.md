# Ralph TUI

[![npm version](https://img.shields.io/npm/v/ralph-tui.svg)](https://www.npmjs.com/package/ralph-tui)
[![CI](https://github.com/subsy/ralph-tui/actions/workflows/ci.yml/badge.svg)](https://github.com/subsy/ralph-tui/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/subsy/ralph-tui/graph/badge.svg)](https://codecov.io/gh/subsy/ralph-tui)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Built with Bun](https://img.shields.io/badge/Built%20with-Bun-f9f1e1.svg)](https://bun.sh)

**AI Agent Loop Orchestrator** - A terminal UI for orchestrating AI coding agents to work through task lists autonomously.

Ralph TUI connects your AI coding assistant (Claude Code, OpenCode, Factory Droid) to your task tracker and runs them in an autonomous loop, completing tasks one-by-one with intelligent selection, error handling, and full visibility.

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
- **AI Agents**: Claude Code, OpenCode
- **Session Persistence**: Pause anytime, resume later, survive crashes
- **Real-time TUI**: Watch agent output, control execution with keyboard shortcuts
- **Subagent Tracing**: See nested agent calls in real-time
- **Cross-iteration Context**: Automatic progress tracking between tasks
- **Flexible Skills**: Use PRD/task skills directly in your agent or via the TUI

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
| `i` | Toggle iteration history |
| `u` | Toggle subagent tracing |
| `q` | Quit |
| `?` | Show help |

See the [full CLI reference](https://ralph-tui.com/docs/cli/overview) for all options.

### Using Skills Directly in Your Agent

After running `ralph-tui setup`, skills are installed to `~/.claude/skills/` and can be used directly in Claude Code:

```bash
# In Claude Code, use these slash commands:
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

### Project Structure

```
ralph-tui/
├── src/
│   ├── cli.tsx           # CLI entry point
│   ├── commands/         # CLI commands (run, resume, status, logs, etc.)
│   ├── config/           # Configuration loading and validation (Zod schemas)
│   ├── engine/           # Execution engine (iteration loop, events)
│   ├── interruption/     # Signal handling and graceful shutdown
│   ├── logs/             # Iteration log persistence
│   ├── plugins/
│   │   ├── agents/       # Agent plugins (claude, opencode)
│   │   │   └── tracing/  # Subagent tracing parser
│   │   └── trackers/     # Tracker plugins (beads, beads-bv, json)
│   ├── session/          # Session persistence and lock management
│   ├── setup/            # Interactive setup wizard
│   ├── templates/        # Handlebars prompt templates
│   ├── chat/             # AI chat mode for PRD creation
│   ├── prd/              # PRD generation and parsing
│   └── tui/              # Terminal UI components (OpenTUI/React)
│       └── components/   # React components
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
