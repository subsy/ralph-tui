/**
 * ABOUTME: Remote command for managing remote server configurations.
 * Provides subcommands: add, list, remove, test
 */

import {
  addRemote,
  removeRemote,
  listRemotes,
  getRemote,
  parseHostPort,
  updateLastConnected,
  REMOTES_CONFIG_PATHS,
} from '../remote/config.js';
import { buildRemoteWebSocketUrl } from '../remote/url.js';

/**
 * Remote command options
 */
interface RemoteCommandOptions {
  subcommand?: string;
  alias?: string;
  hostPort?: string;
  token?: string;
  secure?: boolean;
  help?: boolean;
  // push-config options
  scope?: 'global' | 'project';
  preview?: boolean;
  force?: boolean;
  all?: boolean;
}

/**
 * Parse remote command arguments.
 */
export function parseRemoteArgs(args: string[]): RemoteCommandOptions {
  const options: RemoteCommandOptions = {};

  if (args.length === 0) {
    return options;
  }

  // First arg is the subcommand
  const subcommand = args[0];
  if (subcommand === '--help' || subcommand === '-h') {
    options.help = true;
    return options;
  }

  options.subcommand = subcommand;

  // Parse remaining args based on subcommand
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg === '--token' && args[i + 1]) {
      options.token = args[i + 1];
      i++;
    } else if (arg === '--secure') {
      options.secure = true;
    } else if (arg === '--scope' && args[i + 1]) {
      const scopeValue = args[i + 1];
      if (scopeValue === 'global' || scopeValue === 'project') {
        options.scope = scopeValue;
      }
      i++;
    } else if (arg === '--preview') {
      options.preview = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--all') {
      options.all = true;
    } else if (!arg.startsWith('-')) {
      // Positional arguments
      if (!options.alias) {
        options.alias = arg;
      } else if (!options.hostPort) {
        options.hostPort = arg;
      }
    }
  }

  return options;
}

/**
 * Test connectivity to a remote server.
 * Returns connection status information.
 */
async function testRemoteConnection(
  host: string,
  port: number,
  token: string,
  secure = false
): Promise<{ connected: boolean; error?: string; latencyMs?: number }> {
  const startTime = Date.now();

  return new Promise((resolve) => {
    let ws: WebSocket | null = null;
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    // Helper to clean up and resolve only once
    const settleWith = (result: { connected: boolean; error?: string; latencyMs?: number }): void => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (ws) {
        // Clear handlers to prevent further callbacks
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        try {
          ws.close();
        } catch {
          // Ignore close errors
        }
      }
      resolve(result);
    };

    // Set a timeout for the connection attempt
    timeout = setTimeout(() => {
      settleWith({ connected: false, error: 'Connection timed out (5s)' });
    }, 5000);

    try {
      ws = new WebSocket(buildRemoteWebSocketUrl(host, port, secure));

      ws.onopen = () => {
        // Send auth message
        const authMsg = {
          type: 'auth',
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          token,
        };
        ws!.send(JSON.stringify(authMsg));
      };

      ws.onmessage = (event) => {
        const latencyMs = Date.now() - startTime;

        try {
          const msg = JSON.parse(event.data as string) as { type: string; success?: boolean; error?: string };

          if (msg.type === 'auth_response') {
            if (msg.success) {
              settleWith({ connected: true, latencyMs });
            } else {
              settleWith({ connected: false, error: msg.error ?? 'Authentication failed' });
            }
          } else {
            settleWith({ connected: false, error: `Unexpected response: ${msg.type}` });
          }
        } catch {
          settleWith({ connected: false, error: 'Invalid response from server' });
        }
      };

      ws.onerror = () => {
        settleWith({ connected: false, error: 'Connection failed' });
      };

      ws.onclose = (event) => {
        if (!event.wasClean && event.code !== 1000) {
          settleWith({ connected: false, error: `Connection closed: ${event.reason || 'Unknown error'}` });
        }
      };
    } catch (err) {
      settleWith({ connected: false, error: err instanceof Error ? err.message : 'Connection failed' });
    }
  });
}

/**
 * Execute the 'remote add' subcommand.
 */
async function executeRemoteAdd(options: RemoteCommandOptions): Promise<void> {
  if (!options.alias || !options.hostPort) {
    console.error('Usage: ralph-tui remote add <alias> <host:port> --token <token>');
    console.error('');
    console.error('Example: ralph-tui remote add prod server.example.com:7890 --token abc123');
    process.exit(1);
  }

  if (!options.token) {
    console.error('Error: --token is required');
    console.error('');
    console.error('Usage: ralph-tui remote add <alias> <host:port> --token <token>');
    process.exit(1);
  }

  const parsed = parseHostPort(options.hostPort);
  if (!parsed) {
    console.error(`Error: Invalid host:port format: ${options.hostPort}`);
    console.error('');
    console.error('Expected format: hostname:port or hostname (uses default port 7890)');
    process.exit(1);
  }

  const result = await addRemote(options.alias, parsed.host, parsed.port, options.token, options.secure);

  if (!result.success) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  console.log('');
  console.log(`✓ Remote '${options.alias}' added successfully`);
  console.log('');
  console.log(`  Host: ${parsed.host}`);
  console.log(`  Port: ${parsed.port}`);
  console.log(`  URL:  ${buildRemoteWebSocketUrl(parsed.host, parsed.port, options.secure)}`);
  console.log('');
  console.log(`To test: ralph-tui remote test ${options.alias}`);
  console.log('');
}

/**
 * Execute the 'remote list' subcommand.
 */
async function executeRemoteList(): Promise<void> {
  const remotes = await listRemotes();

  if (remotes.length === 0) {
    console.log('');
    console.log('No remotes configured.');
    console.log('');
    console.log('Add a remote with:');
    console.log('  ralph-tui remote add <alias> <host:port> --token <token>');
    console.log('');
    return;
  }

  console.log('');
  console.log('Configured Remotes');
  console.log('══════════════════════════════════════════════════════════════');
  console.log('');

  // Test connections in parallel for status
  const statusPromises = remotes.map(async ([alias, remote]) => {
    const status = await testRemoteConnection(remote.host, remote.port, remote.token, remote.secure);
    return { alias, remote, status };
  });

  const results = await Promise.all(statusPromises);

  for (const { alias, remote, status } of results) {
    const statusIcon = status.connected ? '✓' : '✗';
    const statusText = status.connected
      ? `connected (${status.latencyMs}ms)`
      : status.error ?? 'disconnected';

    console.log(`  ${statusIcon} ${alias}`);
    console.log(`    URL:    ${buildRemoteWebSocketUrl(remote.host, remote.port, remote.secure)}`);
    console.log(`    Status: ${statusText}`);
    console.log(`    Token:  ${remote.token.slice(0, 8)}...`);

    if (remote.lastConnected) {
      console.log(`    Last:   ${new Date(remote.lastConnected).toLocaleString()}`);
    }
    console.log('');
  }

  console.log('──────────────────────────────────────────────────────────────');
  console.log(`Total: ${remotes.length} remote(s)`);
  console.log('');
}

/**
 * Execute the 'remote remove' subcommand.
 */
async function executeRemoteRemove(options: RemoteCommandOptions): Promise<void> {
  if (!options.alias) {
    console.error('Usage: ralph-tui remote remove <alias>');
    process.exit(1);
  }

  const result = await removeRemote(options.alias);

  if (!result.success) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  console.log('');
  console.log(`✓ Remote '${options.alias}' removed`);
  console.log('');
}

/**
 * Execute the 'remote test' subcommand.
 */
async function executeRemoteTest(options: RemoteCommandOptions): Promise<void> {
  if (!options.alias) {
    console.error('Usage: ralph-tui remote test <alias>');
    process.exit(1);
  }

  const remote = await getRemote(options.alias);
  if (!remote) {
    console.error(`Error: Remote '${options.alias}' not found`);
    console.error('');
    console.error('Available remotes:');
    const remotes = await listRemotes();
    if (remotes.length === 0) {
      console.error('  (none configured)');
    } else {
      for (const [alias] of remotes) {
        console.error(`  - ${alias}`);
      }
    }
    process.exit(1);
  }

  console.log('');
  console.log(`Testing connection to '${options.alias}'...`);
  console.log(`  URL: ${buildRemoteWebSocketUrl(remote.host, remote.port, remote.secure)}`);
  console.log('');

  const status = await testRemoteConnection(remote.host, remote.port, remote.token, remote.secure);

  if (status.connected) {
    // Update last connected timestamp
    await updateLastConnected(options.alias);

    console.log('✓ Connection successful');
    console.log(`  Latency: ${status.latencyMs}ms`);
    console.log('');
  } else {
    console.log('✗ Connection failed');
    console.log(`  Error: ${status.error}`);
    console.log('');
    process.exit(1);
  }
}

/**
 * Execute the 'remote push-config' subcommand.
 * Pushes local configuration to a remote instance.
 */
async function executeRemotePushConfig(options: RemoteCommandOptions): Promise<void> {
  const { homedir } = await import('node:os');
  const { join } = await import('node:path');
  const { readFile, access, constants } = await import('node:fs/promises');
  const { RemoteClient } = await import('../remote/client.js');
  const readline = await import('node:readline');

  // Helper to prompt user
  const prompt = (question: string): Promise<string> => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    return new Promise((resolve) => {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  };

  // Get list of remotes to push to
  const remotes = await listRemotes();
  if (remotes.length === 0) {
    console.error('');
    console.error('No remotes configured.');
    console.error('');
    console.error('Add a remote with:');
    console.error('  ralph-tui remote add <alias> <host:port> --token <token>');
    console.error('');
    process.exit(1);
  }

  // Determine which remotes to push to
  let targetRemotes: [string, typeof remotes[0][1]][] = [];
  if (options.all) {
    targetRemotes = remotes;
  } else if (options.alias) {
    const remote = await getRemote(options.alias);
    if (!remote) {
      console.error(`Error: Remote '${options.alias}' not found`);
      console.error('');
      console.error('Available remotes:');
      for (const [alias] of remotes) {
        console.error(`  - ${alias}`);
      }
      process.exit(1);
    }
    targetRemotes = [[options.alias, remote]];
  } else {
    console.error('Usage: ralph-tui remote push-config <alias> [options]');
    console.error('       ralph-tui remote push-config --all [options]');
    console.error('');
    console.error('Specify an alias or use --all to push to all remotes.');
    process.exit(1);
  }

  // Load local config
  const globalConfigPath = join(homedir(), '.config', 'ralph-tui', 'config.toml');
  const projectConfigPath = join(process.cwd(), '.ralph-tui', 'config.toml');

  let globalContent: string | null = null;
  let projectContent: string | null = null;

  try {
    await access(globalConfigPath, constants.R_OK);
    globalContent = await readFile(globalConfigPath, 'utf-8');
  } catch {
    // No global config
  }

  try {
    await access(projectConfigPath, constants.R_OK);
    projectContent = await readFile(projectConfigPath, 'utf-8');
  } catch {
    // No project config
  }

  if (!globalContent && !projectContent) {
    console.error('');
    console.error('No local configuration found to push.');
    console.error('');
    console.error('Expected config at:');
    console.error(`  Global: ${globalConfigPath}`);
    console.error(`  Project: ${projectConfigPath}`);
    console.error('');
    console.error('Run "ralph-tui setup" to create a configuration.');
    process.exit(1);
  }

  console.log('');
  console.log('📤 Push Configuration to Remote');
  console.log('════════════════════════════════════════════════════════════════');

  // Process each remote
  for (const [alias, remote] of targetRemotes) {
    console.log('');
    console.log(`Remote: ${alias} (${buildRemoteWebSocketUrl(remote.host, remote.port, remote.secure)})`);
    console.log('──────────────────────────────────────────────────────────────────');

    // Connect to remote
    let client: InstanceType<typeof RemoteClient>;
    try {
      client = new RemoteClient(remote.host, remote.port, remote.token, () => {}, {}, remote.secure);
      await client.connect();
    } catch (error) {
      console.error(`  ✗ Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      continue;
    }

    // Check what config exists on remote
    let remoteConfig: Awaited<ReturnType<typeof client.checkConfig>>;
    try {
      remoteConfig = await client.checkConfig();
    } catch (error) {
      console.error(`  ✗ Failed to check remote config: ${error instanceof Error ? error.message : 'Unknown error'}`);
      client.disconnect();
      continue;
    }

    console.log('  Remote config status:');
    console.log(`    Global:  ${remoteConfig.globalExists ? '✓ exists' : '○ not found'}`);
    console.log(`    Project: ${remoteConfig.projectExists ? '✓ exists' : '○ not found'}`);
    if (remoteConfig.remoteCwd) {
      console.log(`    Remote CWD: ${remoteConfig.remoteCwd}`);
    }

    // Determine scope
    let scope: 'global' | 'project' = options.scope ?? 'global';
    if (!options.scope) {
      // Auto-detect: prefer project if we have project config and remote doesn't have one
      if (projectContent && !remoteConfig.projectExists) {
        scope = 'project';
      } else if (globalContent) {
        scope = 'global';
      } else if (projectContent) {
        scope = 'project';
      }
      console.log(`  Auto-selected scope: ${scope}`);
    }

    const configContent = scope === 'global' ? globalContent : projectContent;
    if (!configContent) {
      console.error(`  ✗ No local ${scope} config to push`);
      client.disconnect();
      continue;
    }

    // Preview mode: show diff
    if (options.preview) {
      console.log('');
      console.log(`  Preview (${scope} config):`);
      console.log('  ───────────────────────────────────────────────────────────');

      const remoteContent = scope === 'global' ? remoteConfig.globalContent : remoteConfig.projectContent;
      if (remoteContent) {
        console.log('  Remote (existing):');
        for (const line of remoteContent.split('\n').slice(0, 10)) {
          console.log(`    ${line}`);
        }
        if (remoteContent.split('\n').length > 10) {
          console.log('    ... (truncated)');
        }
        console.log('');
      }
      console.log('  Local (to push):');
      for (const line of configContent.split('\n').slice(0, 10)) {
        console.log(`    ${line}`);
      }
      if (configContent.split('\n').length > 10) {
        console.log('    ... (truncated)');
      }
      console.log('');
      client.disconnect();
      continue;
    }

    // Check if overwrite is needed
    const configExists = scope === 'global' ? remoteConfig.globalExists : remoteConfig.projectExists;
    let overwrite = options.force ?? false;

    if (configExists && !overwrite) {
      // Ask for confirmation
      if (process.stdin.isTTY) {
        const answer = await prompt(`  Config exists. Overwrite? (y/N): `);
        overwrite = answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
      }
      if (!overwrite) {
        console.log('  Skipped (config exists, use --force to overwrite)');
        client.disconnect();
        continue;
      }
    }

    // Push config
    console.log(`  Pushing ${scope} config...`);
    try {
      const result = await client.pushConfig(scope, configContent, overwrite);
      if (result.success) {
        console.log(`  ✓ Config pushed successfully`);
        if (result.configPath) {
          console.log(`    Path: ${result.configPath}`);
        }
        if (result.backupPath) {
          console.log(`    Backup: ${result.backupPath}`);
        }
        if (result.migrationTriggered) {
          console.log('    Migration triggered (skills/templates will be installed)');
        }
        if (result.requiresRestart) {
          console.log('    Note: Changes take effect on next run');
        }
        await updateLastConnected(alias);
      } else {
        console.error(`  ✗ Push failed: ${result.error}`);
      }
    } catch (error) {
      console.error(`  ✗ Push error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    client.disconnect();
  }

  console.log('');
  console.log('════════════════════════════════════════════════════════════════');
  console.log('');
}

/**
 * Execute the remote command.
 */
export async function executeRemoteCommand(args: string[]): Promise<void> {
  const options = parseRemoteArgs(args);

  if (options.help || !options.subcommand) {
    printRemoteHelp();
    return;
  }

  switch (options.subcommand) {
    case 'add':
      await executeRemoteAdd(options);
      break;
    case 'list':
    case 'ls':
      await executeRemoteList();
      break;
    case 'remove':
    case 'rm':
      await executeRemoteRemove(options);
      break;
    case 'test':
      await executeRemoteTest(options);
      break;
    case 'push-config':
      await executeRemotePushConfig(options);
      break;
    default:
      console.error(`Unknown subcommand: ${options.subcommand}`);
      console.error('');
      printRemoteHelp();
      process.exit(1);
  }
}

/**
 * Print remote command help.
 */
export function printRemoteHelp(): void {
  console.log(`
ralph-tui remote - Manage remote server configurations

Usage: ralph-tui remote <subcommand> [options]

Subcommands:
  add <alias> <host:port> --token <token>   Add a remote server
  list, ls                                   List configured remotes with status
  remove, rm <alias>                         Remove a remote server
  test <alias>                               Test connectivity to a remote
  push-config <alias>                        Push local config to remote
  push-config --all                          Push config to all remotes

Add Options:
  --token <token>       Authentication token (required)
  --secure              Use wss:// and omit port 443 in display/connect URLs

Push-Config Options:
  --scope global|project  Which config to push (default: auto-detect)
  --preview               Show diff without applying changes
  --force                 Overwrite existing config without confirmation

Examples:
  # Add a remote server
  ralph-tui remote add prod server.example.com:7890 --token abc123

  # Add a secure remote behind a TLS proxy
  ralph-tui remote add prod ralph.example.com:443 --secure --token abc123

  # Add with default port (7890)
  ralph-tui remote add staging staging.local --token xyz789

  # List all remotes with connection status
  ralph-tui remote list

  # Test connectivity
  ralph-tui remote test prod

  # Remove a remote
  ralph-tui remote remove prod

  # Push config to a remote
  ralph-tui remote push-config prod

  # Preview what would be pushed
  ralph-tui remote push-config prod --preview

  # Push global config with force overwrite
  ralph-tui remote push-config prod --scope global --force

  # Push to all remotes
  ralph-tui remote push-config --all --force

Configuration:
  Remotes are stored in: ${REMOTES_CONFIG_PATHS.file}

  The file can be manually edited (TOML format):
    [remotes.prod]
    host = "server.example.com"
    port = 7890
    secure = true
    token = "your-token-here"
    addedAt = "2026-01-19T00:00:00.000Z"

TUI Integration:
  The TUI settings panel provides equivalent functionality for
  managing remotes with a graphical interface.
`);
}
