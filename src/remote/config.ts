/**
 * ABOUTME: Remote configuration management for ralph-tui.
 * Handles storage and retrieval of remote server configurations in TOML format.
 * Configuration stored in ~/.config/ralph-tui/remotes.toml
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile, writeFile, mkdir, access, constants } from 'node:fs/promises';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';

/**
 * Configuration for a single remote server
 */
export interface RemoteServerConfig {
  /** Server hostname or IP address */
  host: string;

  /** Server port */
  port: number;

  /** Authentication token for the remote server */
  token: string;

  /** When the remote was added (ISO 8601) */
  addedAt: string;

  /** Last successful connection time (ISO 8601) */
  lastConnected?: string;
}

/**
 * Remotes configuration file structure (~/.config/ralph-tui/remotes.toml)
 */
export interface RemotesConfig {
  /** Configuration version for future migrations */
  version: number;

  /** Map of alias to remote server configuration */
  remotes: Record<string, RemoteServerConfig>;
}

/**
 * Path to the remotes configuration file
 */
const REMOTES_CONFIG_DIR = join(homedir(), '.config', 'ralph-tui');
const REMOTES_CONFIG_PATH = join(REMOTES_CONFIG_DIR, 'remotes.toml');

/**
 * Default empty configuration
 */
const DEFAULT_REMOTES_CONFIG: RemotesConfig = {
  version: 1,
  remotes: {},
};

/**
 * Load the remotes configuration from disk.
 * Returns default config if file doesn't exist.
 */
export async function loadRemotesConfig(): Promise<RemotesConfig> {
  try {
    await access(REMOTES_CONFIG_PATH, constants.R_OK);
    const content = await readFile(REMOTES_CONFIG_PATH, 'utf-8');

    // Handle empty file
    if (!content.trim()) {
      return { ...DEFAULT_REMOTES_CONFIG };
    }

    const parsed = parseToml(content) as unknown as {
      version?: number;
      remotes?: Record<string, RemoteServerConfig>;
    };
    return {
      version: parsed.version ?? 1,
      remotes: parsed.remotes ?? {},
    };
  } catch {
    return { ...DEFAULT_REMOTES_CONFIG };
  }
}

/**
 * Save the remotes configuration to disk.
 * Creates the directory if it doesn't exist.
 */
export async function saveRemotesConfig(config: RemotesConfig): Promise<void> {
  await mkdir(REMOTES_CONFIG_DIR, { recursive: true });
  const toml = stringifyToml(config as unknown as Record<string, unknown>);
  await writeFile(REMOTES_CONFIG_PATH, toml, 'utf-8');
}

/**
 * Add a new remote server configuration.
 * @param alias Unique alias for the remote
 * @param host Server hostname or IP
 * @param port Server port
 * @param token Authentication token
 * @returns true if added, false if alias already exists
 */
export async function addRemote(
  alias: string,
  host: string,
  port: number,
  token: string
): Promise<{ success: boolean; error?: string }> {
  const config = await loadRemotesConfig();

  // Check for existing alias
  if (config.remotes[alias]) {
    return { success: false, error: `Remote '${alias}' already exists` };
  }

  // Validate alias format (alphanumeric, dash, underscore)
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(alias)) {
    return {
      success: false,
      error: 'Alias must start with a letter and contain only letters, numbers, dashes, and underscores',
    };
  }

  // Add the remote
  config.remotes[alias] = {
    host,
    port,
    token,
    addedAt: new Date().toISOString(),
  };

  await saveRemotesConfig(config);
  return { success: true };
}

/**
 * Remove a remote server configuration.
 * @param alias Alias of the remote to remove
 * @returns true if removed, false if not found
 */
export async function removeRemote(alias: string): Promise<{ success: boolean; error?: string }> {
  const config = await loadRemotesConfig();

  if (!config.remotes[alias]) {
    return { success: false, error: `Remote '${alias}' not found` };
  }

  delete config.remotes[alias];
  await saveRemotesConfig(config);
  return { success: true };
}

/**
 * Get a remote server configuration by alias.
 * @param alias Alias of the remote
 * @returns Remote configuration or undefined if not found
 */
export async function getRemote(alias: string): Promise<RemoteServerConfig | undefined> {
  const config = await loadRemotesConfig();
  return config.remotes[alias];
}

/**
 * List all configured remotes.
 * @returns Array of [alias, config] tuples
 */
export async function listRemotes(): Promise<Array<[string, RemoteServerConfig]>> {
  const config = await loadRemotesConfig();
  return Object.entries(config.remotes);
}

/**
 * Update the last connected timestamp for a remote.
 * @param alias Alias of the remote
 */
export async function updateLastConnected(alias: string): Promise<void> {
  const config = await loadRemotesConfig();

  if (config.remotes[alias]) {
    config.remotes[alias].lastConnected = new Date().toISOString();
    await saveRemotesConfig(config);
  }
}

/**
 * Parse a host:port string into components.
 * @param hostPort String in format "host:port" or "host" (uses default port 7890)
 * @returns Parsed host and port
 */
export function parseHostPort(hostPort: string): { host: string; port: number } | null {
  const parts = hostPort.split(':');

  if (parts.length === 1) {
    // Just host, use default port
    return { host: parts[0], port: 7890 };
  }

  if (parts.length === 2) {
    const port = parseInt(parts[1], 10);
    if (isNaN(port) || port <= 0 || port > 65535) {
      return null;
    }
    return { host: parts[0], port };
  }

  return null;
}

// Export paths for testing
export const REMOTES_CONFIG_PATHS = {
  dir: REMOTES_CONFIG_DIR,
  file: REMOTES_CONFIG_PATH,
} as const;
