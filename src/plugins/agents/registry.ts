/**
 * ABOUTME: Plugin registry for agent plugins.
 * Handles discovery, registration, and lifecycle management of agent plugins.
 * Supports both built-in plugins and user-installed plugins from the config directory.
 */

import { homedir } from 'node:os';
import { join, basename, extname } from 'node:path';
import { readdir, stat, access, constants } from 'node:fs/promises';
import type {
  AgentPlugin,
  AgentPluginFactory,
  AgentPluginMeta,
  AgentPluginConfig,
} from './types.js';

/**
 * Default path for user-installed agent plugins
 */
const USER_PLUGINS_DIR = join(
  homedir(),
  '.config',
  'ralph-tui',
  'plugins',
  'agents'
);

/**
 * Registered plugin entry with its factory and metadata
 */
interface RegisteredPlugin {
  /** Plugin factory function */
  factory: AgentPluginFactory;

  /** Plugin metadata */
  meta: AgentPluginMeta;

  /** Path to the plugin (for user plugins) */
  path?: string;

  /** Whether this is a built-in plugin */
  builtin: boolean;
}

/**
 * Result of loading a plugin
 */
interface PluginLoadResult {
  success: boolean;
  pluginId?: string;
  error?: string;
}

/**
 * Registry for agent plugins.
 * Singleton pattern - use AgentRegistry.getInstance() to access.
 */
export class AgentRegistry {
  private static instance: AgentRegistry | null = null;

  private plugins: Map<string, RegisteredPlugin> = new Map();
  private loadedInstances: Map<string, AgentPlugin> = new Map();
  private initialized = false;

  private constructor() {
    // Private constructor for singleton
  }

  /**
   * Get the singleton registry instance.
   */
  static getInstance(): AgentRegistry {
    if (!AgentRegistry.instance) {
      AgentRegistry.instance = new AgentRegistry();
    }
    return AgentRegistry.instance;
  }

  /**
   * Reset the singleton instance (useful for testing).
   */
  static resetInstance(): void {
    if (AgentRegistry.instance) {
      // Dispose all loaded instances
      for (const instance of AgentRegistry.instance.loadedInstances.values()) {
        instance.dispose().catch(() => {
          // Ignore disposal errors during reset
        });
      }
      AgentRegistry.instance.plugins.clear();
      AgentRegistry.instance.loadedInstances.clear();
      AgentRegistry.instance.initialized = false;
    }
    AgentRegistry.instance = null;
  }

  /**
   * Register a built-in plugin with the registry.
   * @param factory Factory function that creates the plugin
   */
  registerBuiltin(factory: AgentPluginFactory): void {
    const instance = factory();
    const { meta } = instance;

    this.plugins.set(meta.id, {
      factory,
      meta,
      builtin: true,
    });

    // Dispose the temporary instance we created for metadata
    instance.dispose().catch(() => {
      // Ignore disposal errors
    });
  }

  /**
   * Discover and register plugins from the user plugins directory.
   * @returns Array of load results for each discovered plugin
   */
  async discoverUserPlugins(): Promise<PluginLoadResult[]> {
    const results: PluginLoadResult[] = [];

    // Check if user plugins directory exists
    const dirExists = await this.directoryExists(USER_PLUGINS_DIR);
    if (!dirExists) {
      return results;
    }

    // List all .ts and .js files in the plugins directory
    let entries: string[];
    try {
      entries = await readdir(USER_PLUGINS_DIR);
    } catch {
      return results;
    }

    for (const entry of entries) {
      const ext = extname(entry);
      if (ext !== '.ts' && ext !== '.js') {
        continue;
      }

      const pluginPath = join(USER_PLUGINS_DIR, entry);
      const result = await this.loadUserPlugin(pluginPath);
      results.push(result);
    }

    return results;
  }

  /**
   * Load a single user plugin from a file path.
   * @param pluginPath Absolute path to the plugin file
   * @returns Load result
   */
  private async loadUserPlugin(pluginPath: string): Promise<PluginLoadResult> {
    const filename = basename(pluginPath);

    try {
      // Dynamically import the plugin module
      const module = (await import(pluginPath)) as {
        default?: AgentPluginFactory;
      };

      if (!module.default || typeof module.default !== 'function') {
        return {
          success: false,
          error: `Plugin ${filename} must export a default factory function`,
        };
      }

      const factory = module.default;
      const instance = factory();
      const { meta } = instance;

      // Check for ID conflicts
      if (this.plugins.has(meta.id)) {
        const existing = this.plugins.get(meta.id)!;
        if (existing.builtin) {
          return {
            success: false,
            error: `Plugin ${filename} conflicts with built-in plugin '${meta.id}'`,
          };
        }
      }

      this.plugins.set(meta.id, {
        factory,
        meta,
        path: pluginPath,
        builtin: false,
      });

      // Dispose the temporary instance
      await instance.dispose();

      return {
        success: true,
        pluginId: meta.id,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: `Failed to load plugin ${filename}: ${message}`,
      };
    }
  }

  /**
   * Check if a directory exists and is accessible.
   */
  private async directoryExists(path: string): Promise<boolean> {
    try {
      await access(path, constants.R_OK);
      const stats = await stat(path);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Get all registered plugin metadata.
   * @returns Array of plugin metadata
   */
  getRegisteredPlugins(): AgentPluginMeta[] {
    return Array.from(this.plugins.values()).map((p) => p.meta);
  }

  /**
   * Get metadata for a specific plugin.
   * @param pluginId Plugin identifier
   * @returns Plugin metadata or undefined if not found
   */
  getPluginMeta(pluginId: string): AgentPluginMeta | undefined {
    return this.plugins.get(pluginId)?.meta;
  }

  /**
   * Check if a plugin is registered.
   * @param pluginId Plugin identifier
   * @returns true if the plugin is registered
   */
  hasPlugin(pluginId: string): boolean {
    return this.plugins.has(pluginId);
  }

  /**
   * Check if a plugin is built-in.
   * @param pluginId Plugin identifier
   * @returns true if the plugin is built-in
   */
  isBuiltin(pluginId: string): boolean {
    return this.plugins.get(pluginId)?.builtin ?? false;
  }

  /**
   * Create a new instance of a plugin.
   * @param pluginId Plugin identifier
   * @returns New plugin instance or undefined if plugin not found
   */
  createInstance(pluginId: string): AgentPlugin | undefined {
    const registered = this.plugins.get(pluginId);
    if (!registered) {
      return undefined;
    }
    return registered.factory();
  }

  /**
   * Get or create a shared instance of a plugin for a given config.
   * The instance is cached by config name for reuse.
   * @param config Plugin configuration
   * @returns Initialized plugin instance
   */
  async getInstance(config: AgentPluginConfig): Promise<AgentPlugin> {
    const cacheKey = config.name;

    // Return cached instance if available
    const cached = this.loadedInstances.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Create and initialize new instance
    const instance = this.createInstance(config.plugin);
    if (!instance) {
      throw new Error(`Unknown agent plugin: ${config.plugin}`);
    }

    // Merge config options with top-level config
    const initConfig: Record<string, unknown> = {
      ...config.options,
      command: config.command,
      defaultFlags: config.defaultFlags,
      timeout: config.timeout,
      envExclude: config.envExclude,
      envPassthrough: config.envPassthrough,
    };

    await instance.initialize(initConfig);
    this.loadedInstances.set(cacheKey, instance);

    return instance;
  }

  /**
   * Dispose a cached instance.
   * @param configName Configuration name used when getting the instance
   */
  async disposeInstance(configName: string): Promise<void> {
    const instance = this.loadedInstances.get(configName);
    if (instance) {
      await instance.dispose();
      this.loadedInstances.delete(configName);
    }
  }

  /**
   * Dispose all cached instances.
   */
  async disposeAll(): Promise<void> {
    const disposals = Array.from(this.loadedInstances.values()).map(
      (instance) => instance.dispose()
    );
    await Promise.all(disposals);
    this.loadedInstances.clear();
  }

  /**
   * Initialize the registry by registering built-in plugins and discovering user plugins.
   * @returns Array of load results from user plugin discovery
   */
  async initialize(): Promise<PluginLoadResult[]> {
    if (this.initialized) {
      return [];
    }

    // Register built-in plugins (imported separately)
    // Built-in plugins are registered via registerBuiltinAgents()

    // Discover user plugins
    const results = await this.discoverUserPlugins();

    this.initialized = true;
    return results;
  }

  /**
   * Get the user plugins directory path.
   */
  static getUserPluginsDir(): string {
    return USER_PLUGINS_DIR;
  }
}

/**
 * Convenience function to get the registry instance.
 */
export function getAgentRegistry(): AgentRegistry {
  return AgentRegistry.getInstance();
}
