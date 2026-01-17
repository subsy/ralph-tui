/**
 * ABOUTME: Configuration management commands for Ralph TUI.
 * Provides 'config show' to display merged configuration with source info.
 */

import {
  loadStoredConfigWithSource,
  serializeConfig,
  CONFIG_PATHS,
  type ConfigSource,
  type StoredConfig,
} from '../config/index.js';

/**
 * Format a section header with box-drawing characters.
 */
function sectionHeader(title: string): string {
  return `\n┌─ ${title} ${'─'.repeat(Math.max(0, 50 - title.length))}\n`;
}

/**
 * Format config source information for display.
 */
function formatSourceInfo(source: ConfigSource): string {
  const lines: string[] = [];

  lines.push(sectionHeader('Configuration Sources'));

  lines.push('│ Global config:');
  if (source.globalPath) {
    lines.push(`│   ✓ ${source.globalPath}`);
  } else {
    lines.push(`│   ○ ${CONFIG_PATHS.global} (not found)`);
  }

  lines.push('│ Project config:');
  if (source.projectPath) {
    lines.push(`│   ✓ ${source.projectPath}`);
  } else {
    lines.push(`│   ○ .ralph-tui/config.toml (not found in project tree)`);
  }

  lines.push('└' + '─'.repeat(55));

  return lines.join('\n');
}

/**
 * Format the merged configuration as YAML with annotations.
 */
function formatMergedConfig(config: StoredConfig): string {
  const lines: string[] = [];

  lines.push(sectionHeader('Merged Configuration'));

  // Check if config is empty
  if (Object.keys(config).length === 0) {
    lines.push('│ (no configuration set - using defaults)');
    lines.push('│');
    lines.push('│ Defaults:');
    lines.push('│   defaultAgent = "claude"');
    lines.push('│   defaultTracker = "beads-bv"');
    lines.push('│   maxIterations = 10');
    lines.push('│   iterationDelay = 1000');
    lines.push('│   outputDir = ".ralph-output"');
  } else {
    // Serialize to TOML and add pipe prefix for box alignment
    const toml = serializeConfig(config);
    const tomlLines = toml.split('\n');
    for (const line of tomlLines) {
      if (line.trim()) {
        lines.push(`│ ${line}`);
      }
    }
  }

  lines.push('└' + '─'.repeat(55));

  return lines.join('\n');
}

/**
 * Execute the 'config show' command.
 * Displays merged configuration from global and project sources.
 */
export async function executeConfigShowCommand(args: string[]): Promise<void> {
  // Parse options
  const showSources = args.includes('--sources') || args.includes('-s');
  const showToml = args.includes('--toml') || args.includes('-t');
  const cwdIndex = args.indexOf('--cwd');
  const cwd =
    cwdIndex !== -1 && args[cwdIndex + 1] ? args[cwdIndex + 1] : process.cwd();

  // Load config with source info
  const { config, source } = await loadStoredConfigWithSource(cwd);

  // Display
  console.log('Ralph TUI Configuration');
  console.log('═'.repeat(56));

  // Source information
  if (showSources || !showToml) {
    console.log(formatSourceInfo(source));
  }

  // Merged config
  if (showToml) {
    // Raw TOML output (machine-readable)
    console.log(serializeConfig(config));
  } else {
    console.log(formatMergedConfig(config));
  }

  // Help text
  if (!showToml) {
    console.log('\nHint: Use --toml for raw TOML output');
    console.log(`      Use --sources to see config file locations`);
  }
}

/**
 * Print help for config commands.
 */
export function printConfigHelp(): void {
  console.log(`
Ralph TUI Configuration Commands

Usage: ralph-tui config <command> [options]

Commands:
  show              Display merged configuration
  help              Show this help message

Show Options:
  --sources, -s     Show configuration source files
  --toml, -t        Output raw TOML (machine-readable)
  --cwd <path>      Use specified directory for project config lookup

Configuration Files:
  Global:   ${CONFIG_PATHS.global}
  Project:  .ralph-tui/config.toml (in project root or any parent directory)

Project config overrides global config. CLI flags override both.

Example config.toml:
  defaultAgent = "claude"
  defaultTracker = "beads-bv"
  maxIterations = 20
  iterationDelay = 2000
  autoCommit = true

  [[agents]]
  name = "claude"
  plugin = "claude"
  default = true
  options = { model = "opus" }

  [[trackers]]
  name = "beads"
  plugin = "beads-bv"
  default = true

  [errorHandling]
  strategy = "skip"
  maxRetries = 3
`);
}

/**
 * Execute a config subcommand.
 * @returns true if command was handled
 */
export async function executeConfigCommand(args: string[]): Promise<boolean> {
  const subcommand = args[0];

  if (!subcommand || subcommand === 'help' || subcommand === '--help') {
    printConfigHelp();
    return true;
  }

  if (subcommand === 'show') {
    await executeConfigShowCommand(args.slice(1));
    return true;
  }

  console.error(`Unknown config command: ${subcommand}`);
  console.log('Run "ralph-tui config help" for available commands');
  return true;
}
