#!/usr/bin/env bun
/**
 * ABOUTME: CLI entry point for the Ralph TUI application.
 * Handles subcommands (plugins, run, etc.) and defaults to 'run' when no subcommand given.
 */

import {
  printTrackerPlugins,
  printAgentPlugins,
  printPluginsHelp,
  executeRunCommand,
  executeStatusCommand,
  executeResumeCommand,
  executeConfigCommand,
  executeSetupCommand,
  executeLogsCommand,
  executeTemplateCommand,
  executeCreatePrdCommand,
  executeConvertCommand,
  executeDocsCommand,
  executeDoctorCommand,
  executeInfoCommand,
  executeSkillsCommand,
  executeRemoteCommand,
} from './commands/index.js';
import { checkBunVersion } from './utils/validation.js';
import pkg from '../package.json' with { type: 'json' };

/**
 * Minimum bun version required to run ralph-tui.
 * Derived from the engines.bun field in package.json (single source of truth).
 */
const MIN_BUN_VERSION = pkg.engines.bun.replace(/^[^\d]*/, '');

if (typeof Bun !== 'undefined') {
  const versionError = checkBunVersion(Bun.version, MIN_BUN_VERSION);
  if (versionError) {
    console.error(versionError);
    process.exit(1);
  }
}

/**
 * Show CLI help message.
 */
function showHelp(): void {
  console.log(`
Ralph TUI - AI Agent Loop Orchestrator

Usage: ralph-tui [command] [options]

Commands:
  (none)              Start Ralph execution (same as 'run')
  create-prd [opts]   Create a new PRD interactively (alias: prime)
  convert [options]   Convert PRD markdown to JSON format
  run [options]       Start Ralph execution
  resume [options]    Resume an interrupted session
  status [options]    Check session status (headless, for CI/scripts)
  remote [subcommand] Manage remote server configurations
  logs [options]      View/manage iteration output logs
  setup [options]     Run interactive project setup (alias: init)
  doctor [options]    Diagnose agent configuration issues
  config show         Display merged configuration
  template show       Display current prompt template
  template init       Copy default template for customization
  template install    Alias for template init
  skills list         List bundled skills
  skills install      Install skills to ~/.claude/skills/
  plugins agents      List available agent plugins
  plugins trackers    List available tracker plugins
  docs [section]      Open documentation in browser
  info [options]      Display system information for bug reports
  help, --help, -h    Show this help message
  version, --version, -v  Show version number

Run Options:
  --epic <id>         Epic ID for beads tracker
  --prd <path>        PRD file path (auto-switches to json tracker)
  --agent <name>      Override agent plugin (e.g., claude, opencode)
  --model <name>      Override model (e.g., opus, sonnet)
  --tracker <name>    Override tracker plugin (e.g., beads, beads-bv, json)
  --iterations <n>    Maximum iterations (0 = unlimited)
  --resume            Resume existing session (deprecated, use 'resume' command)
  --headless          Run without TUI (alias: --no-tui)
  --no-tui            Run without TUI, output structured logs to stdout
  --no-setup          Skip interactive setup even if no config exists
  --verify            Run agent preflight check before starting
  --notify            Force enable desktop notifications
  --no-notify         Force disable desktop notifications
  --sandbox           Enable sandboxing (auto mode)
  --sandbox=bwrap     Force Bubblewrap sandboxing (Linux)
  --sandbox=sandbox-exec  Force sandbox-exec (macOS)
  --no-sandbox        Disable sandboxing
  --no-network        Disable network access in sandbox
  --listen            Enable remote listener (WebSocket server)
  --listen-port <n>   Port for remote listener (default: 7890)
  --rotate-token      Rotate server token before starting listener

Resume Options:
  --cwd <path>        Working directory
  --headless          Run without TUI
  --force             Override stale lock

Status Options:
  --json              Output in JSON format for CI/scripts
  --cwd <path>        Working directory

Convert Options:
  --to <format>       Target format: json
  --output, -o <path> Output file path (default: ./prd.json)
  --branch, -b <name> Git branch name (prompts if not provided)
  --force, -f         Overwrite existing files

Examples:
  ralph-tui                              # Start execution (same as 'run')
  ralph-tui create-prd                   # Create a new PRD interactively
  ralph-tui create-prd --chat            # Create PRD with AI chat mode
  ralph-tui convert --to json ./prd.md   # Convert PRD to JSON
  ralph-tui run                          # Start execution with defaults
  ralph-tui run --epic myproject-epic    # Run with specific epic
  ralph-tui run --prd ./prd.json         # Run with PRD file
  ralph-tui resume                       # Resume interrupted session
  ralph-tui status                       # Check session status
  ralph-tui status --json                # JSON output for CI/scripts
  ralph-tui logs                         # List iteration logs
  ralph-tui logs --iteration 5           # View specific iteration
  ralph-tui logs --task US-005           # View logs for a task
  ralph-tui logs --clean --keep 10       # Clean up old logs
  ralph-tui plugins agents               # List agent plugins
  ralph-tui plugins trackers             # List tracker plugins
  ralph-tui template show                # Show current prompt template
  ralph-tui template init                # Create custom template
  ralph-tui doctor                       # Check if agent is properly configured
  ralph-tui doctor --json                # JSON output for scripts
  ralph-tui docs                         # Open documentation in browser
  ralph-tui docs quickstart              # Open quick start guide
  ralph-tui info                         # Display system info for bug reports
  ralph-tui info -c                      # Copyable format for GitHub issues
  ralph-tui skills list                  # List bundled skills
  ralph-tui skills install --force       # Force reinstall all skills
  ralph-tui run --listen                 # Run with remote listener enabled
  ralph-tui run --listen --rotate-token  # Rotate token and start listener
  ralph-tui remote add prod server:7890 --token abc  # Add remote
  ralph-tui remote list                  # List remotes with status
  ralph-tui remote test prod             # Test connectivity
`);
}

/**
 * Handle subcommands before launching TUI.
 * @returns true if a subcommand was handled and we should exit
 */
async function handleSubcommand(args: string[]): Promise<boolean> {
  const command = args[0];

  // Version command
  if (command === 'version' || command === '--version' || command === '-v') {
    console.log(`ralph-tui ${pkg.version}`);
    return true;
  }

  // Help command
  if (command === 'help' || command === '--help' || command === '-h') {
    showHelp();
    return true;
  }

  // Create-PRD command (with alias: prime)
  if (command === 'create-prd' || command === 'prime') {
    await executeCreatePrdCommand(args.slice(1));
    return true;
  }

  // Init command (alias for setup)
  if (command === 'init') {
    await executeSetupCommand(args.slice(1));
    return true;
  }

  // Convert command
  if (command === 'convert') {
    await executeConvertCommand(args.slice(1));
    return true;
  }

  // Run command
  if (command === 'run') {
    await executeRunCommand(args.slice(1));
    return true;
  }

  // Resume command
  if (command === 'resume') {
    await executeResumeCommand(args.slice(1));
    return true;
  }

  // Status command
  if (command === 'status') {
    await executeStatusCommand(args.slice(1));
    return true;
  }

  // Logs command
  if (command === 'logs') {
    await executeLogsCommand(args.slice(1));
    return true;
  }

  // Config command
  if (command === 'config') {
    await executeConfigCommand(args.slice(1));
    return true;
  }

  // Setup command
  if (command === 'setup') {
    await executeSetupCommand(args.slice(1));
    return true;
  }

  // Template command
  if (command === 'template') {
    await executeTemplateCommand(args.slice(1));
    return true;
  }

  // Docs command
  if (command === 'docs') {
    await executeDocsCommand(args.slice(1));
    return true;
  }

  // Doctor command
  if (command === 'doctor') {
    await executeDoctorCommand(args.slice(1));
    return true;
  }

  // Info command
  if (command === 'info') {
    await executeInfoCommand(args.slice(1));
    return true;
  }

  // Skills command
  if (command === 'skills') {
    await executeSkillsCommand(args.slice(1));
    return true;
  }

  // Remote command (manage remote configurations)
  if (command === 'remote') {
    await executeRemoteCommand(args.slice(1));
    return true;
  }

  // Plugins commands
  if (command === 'plugins') {
    const subcommand = args[1];

    if (subcommand === '--help' || subcommand === '-h') {
      printPluginsHelp();
      return true;
    }

    if (subcommand === 'agents') {
      await printAgentPlugins();
      return true;
    }

    if (subcommand === 'trackers') {
      await printTrackerPlugins();
      return true;
    }

    // Unknown or missing plugins subcommand
    if (subcommand) {
      console.error(`Unknown plugins subcommand: ${subcommand}`);
    }
    printPluginsHelp();
    return true;
  }

  // Unknown command
  if (command && !command.startsWith('-')) {
    console.error(`Unknown command: ${command}`);
    showHelp();
    process.exit(1);
  }

  return false;
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  // Get command-line arguments (skip node and script path)
  const args = process.argv.slice(2);

  // Handle subcommands
  const handled = await handleSubcommand(args);
  if (handled) {
    return;
  }

  // No subcommand - default to 'run' command
  await executeRunCommand(args);
}

// Run the main function
main().catch((error: unknown) => {
  console.error('Failed to start Ralph TUI:', error);
  process.exit(1);
});
