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

/**
 * Remote command options
 */
interface RemoteCommandOptions {
  subcommand?: string;
  alias?: string;
  hostPort?: string;
  token?: string;
  help?: boolean;
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
  token: string
): Promise<{ connected: boolean; error?: string; latencyMs?: number }> {
  const startTime = Date.now();

  return new Promise((resolve) => {
    // Set a timeout for the connection attempt
    const timeout = setTimeout(() => {
      resolve({ connected: false, error: 'Connection timed out (5s)' });
    }, 5000);

    try {
      const ws = new WebSocket(`ws://${host}:${port}`);

      ws.onopen = () => {
        // Send auth message
        const authMsg = {
          type: 'auth',
          id: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          token,
        };
        ws.send(JSON.stringify(authMsg));
      };

      ws.onmessage = (event) => {
        const latencyMs = Date.now() - startTime;
        clearTimeout(timeout);

        try {
          const msg = JSON.parse(event.data as string) as { type: string; success?: boolean; error?: string };

          if (msg.type === 'auth_response') {
            if (msg.success) {
              resolve({ connected: true, latencyMs });
            } else {
              resolve({ connected: false, error: msg.error ?? 'Authentication failed' });
            }
          } else {
            resolve({ connected: false, error: `Unexpected response: ${msg.type}` });
          }
        } catch {
          resolve({ connected: false, error: 'Invalid response from server' });
        }

        ws.close();
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        resolve({ connected: false, error: 'Connection failed' });
      };

      ws.onclose = (event) => {
        clearTimeout(timeout);
        if (!event.wasClean && event.code !== 1000) {
          resolve({ connected: false, error: `Connection closed: ${event.reason || 'Unknown error'}` });
        }
      };
    } catch (err) {
      clearTimeout(timeout);
      resolve({ connected: false, error: err instanceof Error ? err.message : 'Connection failed' });
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

  const result = await addRemote(options.alias, parsed.host, parsed.port, options.token);

  if (!result.success) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  console.log('');
  console.log(`✓ Remote '${options.alias}' added successfully`);
  console.log('');
  console.log(`  Host: ${parsed.host}`);
  console.log(`  Port: ${parsed.port}`);
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
    const status = await testRemoteConnection(remote.host, remote.port, remote.token);
    return { alias, remote, status };
  });

  const results = await Promise.all(statusPromises);

  for (const { alias, remote, status } of results) {
    const statusIcon = status.connected ? '✓' : '✗';
    const statusText = status.connected
      ? `connected (${status.latencyMs}ms)`
      : status.error ?? 'disconnected';

    console.log(`  ${statusIcon} ${alias}`);
    console.log(`    URL:    ws://${remote.host}:${remote.port}`);
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
  console.log(`  URL: ws://${remote.host}:${remote.port}`);
  console.log('');

  const status = await testRemoteConnection(remote.host, remote.port, remote.token);

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

Add Options:
  --token <token>       Authentication token (required)

Examples:
  # Add a remote server
  ralph-tui remote add prod server.example.com:7890 --token abc123

  # Add with default port (7890)
  ralph-tui remote add staging staging.local --token xyz789

  # List all remotes with connection status
  ralph-tui remote list

  # Test connectivity
  ralph-tui remote test prod

  # Remove a remote
  ralph-tui remote remove prod

Configuration:
  Remotes are stored in: ${REMOTES_CONFIG_PATHS.file}

  The file can be manually edited (TOML format):
    [remotes.prod]
    host = "server.example.com"
    port = 7890
    token = "your-token-here"
    addedAt = "2026-01-19T00:00:00.000Z"

TUI Integration:
  The TUI settings panel provides equivalent functionality for
  managing remotes with a graphical interface.
`);
}
