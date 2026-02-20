/**
 * ABOUTME: Manages multiple remote instance connections for the TUI.
 * Coordinates tab state, connection lifecycle, and auto-reconnection with exponential backoff.
 * US-5: Extended with connection resilience (auto-reconnect, metrics tracking, toast events).
 * Provides a unified interface for the TUI to interact with local and remote instances.
 */

import type { RemoteServerConfig } from './config.js';
import { listRemotes, updateLastConnected } from './config.js';
import {
  RemoteClient,
  createLocalTab,
  createRemoteTab,
  type InstanceTab,
  type ConnectionStatus,
  type ConnectionMetrics,
  type RemoteClientEvent,
} from './client.js';

/**
 * Toast notification types for connection events.
 * These are emitted to the UI for display as temporary notifications.
 */
export type ConnectionToast =
  | { type: 'reconnecting'; alias: string; attempt: number; maxRetries: number }
  | { type: 'reconnected'; alias: string; totalAttempts: number }
  | { type: 'reconnect_failed'; alias: string; attempts: number; error: string }
  | { type: 'connection_error'; alias: string; error: string };

/**
 * Callback for toast notifications
 */
export type ToastHandler = (toast: ConnectionToast) => void;

/**
 * Callback for instance state changes
 */
export type InstanceStateChangeHandler = (tabs: InstanceTab[], selectedIndex: number) => void;

/**
 * Callback for remote engine events
 */
export type EngineEventHandler = (event: import('../engine/types.js').EngineEvent) => void;

/**
 * Manages local and remote ralph-tui instances.
 * Handles tab state, connection management, and instance selection.
 * US-5: Tracks connection metrics and emits toast notifications for reconnection events.
 */
export class InstanceManager {
  private tabs: InstanceTab[] = [];
  private selectedIndex = 0;
  private clients: Map<string, RemoteClient> = new Map();
  private stateChangeHandler: InstanceStateChangeHandler | null = null;
  private remoteConfigs: Map<string, RemoteServerConfig> = new Map();
  private toastHandler: ToastHandler | null = null;
  private engineEventHandlers: Set<EngineEventHandler> = new Set();

  /**
   * Initialize the instance manager.
   * Loads remote configurations and sets up the local tab.
   */
  async initialize(): Promise<void> {
    // Always start with the local tab
    this.tabs = [createLocalTab()];

    // Load remote configurations
    const remotes = await listRemotes();
    for (const [alias, config] of remotes) {
      this.remoteConfigs.set(alias, config);
      const tab = createRemoteTab(alias, config.host, config.port);
      this.tabs.push(tab);
    }

    this.notifyStateChange();
  }

  /**
   * Register a handler for state changes
   */
  onStateChange(handler: InstanceStateChangeHandler): void {
    this.stateChangeHandler = handler;
  }

  /**
   * Register a handler for toast notifications (reconnection events, errors).
   * Toasts are temporary notifications shown to the user.
   */
  onToast(handler: ToastHandler): void {
    this.toastHandler = handler;
  }

  /**
   * Emit a toast notification.
   */
  private emitToast(toast: ConnectionToast): void {
    if (this.toastHandler) {
      this.toastHandler(toast);
    }
  }

  /**
   * Get the current tabs
   */
  getTabs(): InstanceTab[] {
    return [...this.tabs];
  }

  /**
   * Get the selected tab index
   */
  getSelectedIndex(): number {
    return this.selectedIndex;
  }

  /**
   * Get the currently selected tab
   */
  getSelectedTab(): InstanceTab | undefined {
    return this.tabs[this.selectedIndex];
  }

  /**
   * Select a tab by index.
   * If the tab is disconnected, initiates a reconnection.
   */
  async selectTab(index: number): Promise<void> {
    if (index < 0 || index >= this.tabs.length) {
      return;
    }

    this.selectedIndex = index;
    const tab = this.tabs[index];

    // Reconnect if disconnected (per acceptance criteria: no auto-reconnect, only on selection)
    if (!tab.isLocal && tab.status === 'disconnected') {
      await this.connectToRemote(tab);
    }

    this.notifyStateChange();
  }

  /**
   * Select the next tab (wraps around)
   */
  async selectNextTab(): Promise<void> {
    const nextIndex = (this.selectedIndex + 1) % this.tabs.length;
    await this.selectTab(nextIndex);
  }

  /**
   * Select the previous tab (wraps around)
   */
  async selectPreviousTab(): Promise<void> {
    const prevIndex = (this.selectedIndex - 1 + this.tabs.length) % this.tabs.length;
    await this.selectTab(prevIndex);
  }

  /**
   * Disconnect from all remotes
   */
  disconnectAll(): void {
    for (const client of this.clients.values()) {
      client.disconnect();
    }
    this.clients.clear();

    // Update all remote tabs to disconnected
    for (const tab of this.tabs) {
      if (!tab.isLocal) {
        tab.status = 'disconnected';
      }
    }

    this.notifyStateChange();
  }

  /**
   * Refresh the remote list from configuration
   */
  async refresh(): Promise<void> {
    // Keep existing connections, but update the tab list
    const remotes = await listRemotes();
    const newAliases = new Set(remotes.map(([alias]) => alias));

    // Remove tabs for deleted remotes
    this.tabs = this.tabs.filter((tab) => {
      if (tab.isLocal) return true;
      if (!tab.alias) return false;
      if (!newAliases.has(tab.alias)) {
        // Disconnect if connected
        const client = this.clients.get(tab.alias);
        if (client) {
          client.disconnect();
          this.clients.delete(tab.alias);
        }
        return false;
      }
      return true;
    });

    // Add tabs for new remotes
    for (const [alias, config] of remotes) {
      this.remoteConfigs.set(alias, config);
      const existingTab = this.tabs.find((t) => t.alias === alias);
      if (!existingTab) {
        const tab = createRemoteTab(alias, config.host, config.port);
        this.tabs.push(tab);
      }
    }

    // Ensure selectedIndex is valid
    if (this.selectedIndex >= this.tabs.length) {
      this.selectedIndex = Math.max(0, this.tabs.length - 1);
    }

    this.notifyStateChange();
  }

  /**
   * Connect to a remote instance
   */
  private async connectToRemote(tab: InstanceTab): Promise<void> {
    if (!tab.alias || !tab.host || !tab.port) {
      return;
    }

    // Get the token from config
    const config = this.remoteConfigs.get(tab.alias);
    if (!config) {
      this.updateTabStatus(tab.id, 'disconnected', 'Remote configuration not found');
      return;
    }

    // Check for existing client
    let client = this.clients.get(tab.alias);
    if (client && client.status === 'connected') {
      return;
    }

    // Create new client if needed
    if (!client) {
      client = new RemoteClient(tab.host, tab.port, config.token, (event) => {
        this.handleClientEvent(tab.alias!, event);
      });
      this.clients.set(tab.alias, client);
    }

    // Update status to connecting
    this.updateTabStatus(tab.id, 'connecting');

    try {
      await client.connect();
      // Update last connected timestamp
      await updateLastConnected(tab.alias);
    } catch {
      // Error handling is done in the event handler
    }
  }

  /**
   * Handle events from a remote client.
   * US-5: Extended to handle reconnection events and metrics updates.
   */
  private handleClientEvent(alias: string, event: RemoteClientEvent): void {
    const tab = this.tabs.find((t) => t.alias === alias);
    if (!tab) return;

    const client = this.clients.get(alias);

    switch (event.type) {
      case 'connecting':
        this.updateTabStatus(tab.id, 'connecting');
        break;

      case 'connected':
        this.updateTabStatus(tab.id, 'connected');
        if (client) {
          this.updateTabMetrics(tab.id, client.metrics);
        }
        break;

      case 'disconnected':
        this.updateTabStatus(tab.id, 'disconnected', event.error);
        if (event.error) {
          this.emitToast({ type: 'connection_error', alias, error: event.error });
        }
        break;

      case 'reconnecting':
        this.updateTabStatus(tab.id, 'reconnecting');
        // Only show toast if past silent retry threshold (client knows this)
        if (client?.shouldAlertOnReconnect()) {
          this.emitToast({
            type: 'reconnecting',
            alias,
            attempt: event.attempt,
            maxRetries: event.maxRetries,
          });
        }
        break;

      case 'reconnected':
        this.updateTabStatus(tab.id, 'connected');
        if (client) {
          this.updateTabMetrics(tab.id, client.metrics);
        }
        // Always show toast for successful reconnection
        this.emitToast({
          type: 'reconnected',
          alias,
          totalAttempts: event.totalAttempts,
        });
        break;

      case 'reconnect_failed':
        this.updateTabStatus(tab.id, 'disconnected', event.error);
        this.emitToast({
          type: 'reconnect_failed',
          alias,
          attempts: event.attempts,
          error: event.error,
        });
        break;

      case 'metrics_updated':
        this.updateTabMetrics(tab.id, event.metrics);
        break;

      case 'engine_event':
        // Forward engine events to subscribers (only if this is the selected tab)
        if (tab.alias === this.tabs[this.selectedIndex]?.alias) {
          this.emitEngineEvent(event.event);
        }
        break;
    }
  }

  /**
   * Update a tab's connection status.
   */
  private updateTabStatus(tabId: string, status: ConnectionStatus, error?: string): void {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (tab) {
      tab.status = status;
      tab.lastError = error;
      this.notifyStateChange();
    }
  }

  /**
   * Update a tab's connection metrics.
   */
  private updateTabMetrics(tabId: string, metrics: ConnectionMetrics): void {
    const tab = this.tabs.find((t) => t.id === tabId);
    if (tab) {
      tab.metrics = metrics;
      this.notifyStateChange();
    }
  }

  /**
   * Notify the state change handler
   */
  private notifyStateChange(): void {
    if (this.stateChangeHandler) {
      this.stateChangeHandler([...this.tabs], this.selectedIndex);
    }
  }

  /**
   * Check if currently viewing a remote instance (not local).
   */
  isViewingRemote(): boolean {
    return this.selectedIndex > 0;
  }

  /**
   * Get the remote client for the selected tab (if remote and connected).
   * Returns null if viewing local or not connected.
   */
  getSelectedClient(): RemoteClient | null {
    const tab = this.tabs[this.selectedIndex];
    if (!tab || tab.isLocal) {
      return null;
    }
    const client = this.clients.get(tab.alias!);
    return client && client.status === 'connected' ? client : null;
  }

  /**
   * Get remote engine state for the selected tab.
   * Returns null if viewing local, not connected, or fetch fails.
   */
  async getRemoteState(): Promise<import('./types.js').RemoteEngineState | null> {
    const client = this.getSelectedClient();
    if (!client) return null;

    try {
      return await client.getState();
    } catch {
      return null;
    }
  }

  /**
   * Get remote tasks for the selected tab.
   * Returns null if viewing local, not connected, or fetch fails.
   */
  async getRemoteTasks(): Promise<import('../plugins/trackers/types.js').TrackerTask[] | null> {
    const client = this.getSelectedClient();
    if (!client) return null;

    try {
      return await client.getTasks();
    } catch {
      return null;
    }
  }

  /**
   * Subscribe to remote engine events.
   * Events are forwarded from the connected remote client.
   * Returns unsubscribe function.
   */
  onEngineEvent(handler: EngineEventHandler): () => void {
    this.engineEventHandlers.add(handler);
    return () => {
      this.engineEventHandlers.delete(handler);
    };
  }

  /**
   * Forward engine event to all subscribers.
   */
  private emitEngineEvent(event: import('../engine/types.js').EngineEvent): void {
    for (const handler of this.engineEventHandlers) {
      handler(event);
    }
  }

  /**
   * Subscribe the currently selected remote to engine events.
   * Call this when switching to a remote tab.
   */
  async subscribeToSelectedRemote(): Promise<boolean> {
    const client = this.getSelectedClient();
    if (!client) return false;

    try {
      await client.subscribe();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Unsubscribe from engine events on the selected remote.
   */
  async unsubscribeFromSelectedRemote(): Promise<void> {
    const client = this.getSelectedClient();
    if (client) {
      try {
        await client.unsubscribe();
      } catch {
        // Ignore errors on unsubscribe
      }
    }
  }

  /**
   * Send a control command to the remote (if viewing remote).
   * Returns true if command was sent, false if viewing local.
   */
  async sendRemoteCommand(
    command: 'pause' | 'resume' | 'interrupt' | 'continue' | 'refreshTasks'
  ): Promise<boolean> {
    const client = this.getSelectedClient();
    if (!client) return false;

    try {
      switch (command) {
        case 'pause':
          await client.pause();
          break;
        case 'resume':
          await client.resume();
          break;
        case 'interrupt':
          await client.interrupt();
          break;
        case 'continue':
          await client.continueExecution();
          break;
        case 'refreshTasks':
          await client.refreshTasks();
          break;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Add iterations to the remote engine.
   */
  async addRemoteIterations(count: number): Promise<boolean> {
    const client = this.getSelectedClient();
    if (!client) return false;

    try {
      await client.addIterations(count);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Remove iterations from the remote engine.
   */
  async removeRemoteIterations(count: number): Promise<boolean> {
    const client = this.getSelectedClient();
    if (!client) return false;

    try {
      await client.removeIterations(count);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get prompt preview for a task on the remote instance.
   * Returns null if viewing local, not connected, or fetch fails.
   */
  async getRemotePromptPreview(
    taskId: string
  ): Promise<{ success: true; prompt: string; source: string } | { success: false; error: string } | null> {
    const client = this.getSelectedClient();
    if (!client) return null;

    try {
      return await client.getPromptPreview(taskId);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get prompt preview',
      };
    }
  }

  /**
   * Get iteration output for a task on the remote instance.
   * Returns null if viewing local, not connected, or fetch fails.
   */
  async getRemoteIterationOutput(taskId: string): Promise<{
    success: boolean;
    taskId: string;
    iteration?: number;
    output?: string;
    startedAt?: string;
    endedAt?: string;
    durationMs?: number;
    usage?: import('../plugins/agents/usage.js').TokenUsageSummary;
    isRunning?: boolean;
    error?: string;
  } | null> {
    const client = this.getSelectedClient();
    if (!client) return null;

    try {
      return await client.getIterationOutput(taskId);
    } catch (error) {
      return {
        success: false,
        taskId,
        error: error instanceof Error ? error.message : 'Failed to get iteration output',
      };
    }
  }

  // ============================================================================
  // Config Push Methods
  // ============================================================================

  /**
   * Check what configuration exists on the currently selected remote.
   * Returns null if viewing local, not connected, or check fails.
   */
  async checkRemoteConfig(): Promise<{
    globalExists: boolean;
    projectExists: boolean;
    globalPath?: string;
    projectPath?: string;
    globalContent?: string;
    projectContent?: string;
    remoteCwd?: string;
  } | null> {
    const client = this.getSelectedClient();
    if (!client) return null;

    try {
      return await client.checkConfig();
    } catch {
      return null;
    }
  }

  /**
   * Push configuration to the currently selected remote.
   * Returns null if viewing local or not connected.
   * @param scope - 'global' or 'project'
   * @param configContent - TOML configuration content
   * @param overwrite - If true, backup and overwrite existing config
   */
  async pushConfigToSelected(
    scope: 'global' | 'project',
    configContent: string,
    overwrite = false
  ): Promise<{
    success: boolean;
    error?: string;
    configPath?: string;
    backupPath?: string;
    migrationTriggered?: boolean;
    requiresRestart?: boolean;
  } | null> {
    const client = this.getSelectedClient();
    if (!client) return null;

    try {
      return await client.pushConfig(scope, configContent, overwrite);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to push config',
      };
    }
  }

  /**
   * Get a client for a specific remote alias.
   * Returns null if not found or not connected.
   */
  getClientByAlias(alias: string): RemoteClient | null {
    const client = this.clients.get(alias);
    return client && client.status === 'connected' ? client : null;
  }

  // ============================================================================
  // Remote Management Methods (for TUI add/edit/delete)
  // ============================================================================

  /**
   * Add a new remote and connect to it.
   * Called from TUI when user adds a new remote via the RemoteManagementOverlay.
   * @param alias The alias for the new remote
   * @param host The host address
   * @param port The port number
   * @param token The authentication token
   */
  async addAndConnectRemote(alias: string, host: string, port: number, token: string): Promise<void> {
    // Store the config in memory
    const config: RemoteServerConfig = {
      host,
      port,
      token,
      addedAt: new Date().toISOString(),
    };
    this.remoteConfigs.set(alias, config);

    // Create and add the tab
    const tab = createRemoteTab(alias, host, port);
    this.tabs.push(tab);

    // Notify listeners of the new tab
    this.notifyStateChange();

    // Connect to the new remote
    await this.connectToRemote(tab);
  }

  /**
   * Disconnect from a remote by alias.
   * Used before editing or deleting a remote.
   * @param alias The alias of the remote to disconnect
   */
  disconnectRemote(alias: string): void {
    const client = this.clients.get(alias);
    if (client) {
      client.disconnect();
      this.clients.delete(alias);
    }

    // Update tab status
    const tab = this.tabs.find((t) => t.alias === alias);
    if (tab) {
      tab.status = 'disconnected';
      this.notifyStateChange();
    }
  }

  /**
   * Remove a tab by alias.
   * Called after deleting a remote from config.
   * @param alias The alias of the remote to remove
   */
  removeTab(alias: string): void {
    // Disconnect first
    this.disconnectRemote(alias);

    // Remove from config cache
    this.remoteConfigs.delete(alias);

    // Remove the tab
    const tabIndex = this.tabs.findIndex((t) => t.alias === alias);
    if (tabIndex !== -1) {
      this.tabs.splice(tabIndex, 1);

      // Adjust selected index if needed
      if (this.selectedIndex >= this.tabs.length) {
        this.selectedIndex = Math.max(0, this.tabs.length - 1);
      } else if (this.selectedIndex > tabIndex) {
        // If we removed a tab before the selected one, adjust the index
        this.selectedIndex--;
      }

      this.notifyStateChange();
    }
  }

  /**
   * Reconnect to a remote after editing its configuration.
   * Updates the tab with new host/port and reconnects.
   * @param alias The alias of the remote
   * @param host The new host address
   * @param port The new port number
   * @param token The new authentication token
   */
  async reconnectRemote(alias: string, host: string, port: number, token: string): Promise<void> {
    // Disconnect existing connection
    this.disconnectRemote(alias);

    // Update config in memory
    const existingConfig = this.remoteConfigs.get(alias);
    const config: RemoteServerConfig = {
      host,
      port,
      token,
      addedAt: existingConfig?.addedAt ?? new Date().toISOString(),
      lastConnected: existingConfig?.lastConnected,
    };
    this.remoteConfigs.set(alias, config);

    // Update tab info
    const tab = this.tabs.find((t) => t.alias === alias);
    if (tab) {
      tab.host = host;
      tab.port = port;
      tab.label = alias; // Keep the label as the alias

      // Reconnect
      await this.connectToRemote(tab);
    }
  }

  /**
   * Get the index of a tab by alias.
   * Used to select a newly added remote.
   * @param alias The alias to find
   * @returns The tab index, or -1 if not found
   */
  getTabIndexByAlias(alias: string): number {
    return this.tabs.findIndex((t) => t.alias === alias);
  }
}

/**
 * Create a singleton instance manager
 */
let instanceManager: InstanceManager | null = null;

export function getInstanceManager(): InstanceManager {
  if (!instanceManager) {
    instanceManager = new InstanceManager();
  }
  return instanceManager;
}

/**
 * Reset the instance manager (for testing)
 */
export function resetInstanceManager(): void {
  if (instanceManager) {
    instanceManager.disconnectAll();
  }
  instanceManager = null;
}
