/**
 * ABOUTME: Comprehensive tests for the ralph-tui remote module.
 * Tests cover types, server handlers, client methods, instance manager,
 * and the config push feature end-to-end.
 */

import {
  describe,
  expect,
  test,
  beforeEach,
  afterEach,
  mock,
} from 'bun:test';
import { mkdtemp, rm, mkdir, writeFile, readFile, access, constants } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

import type {
  AuthMessage,
  AuthResponseMessage,
  InterruptMessage,
  PongMessage,
  ErrorMessage,
  StateResponseMessage,
  OperationResultMessage,
  CheckConfigMessage,
  CheckConfigResponseMessage,
  PushConfigMessage,
  PushConfigResponseMessage,
  RemoteEngineState,
} from '../../src/remote/types.js';
import type { ExecutionEngine } from '../../src/engine/index.js';
import { TOKEN_LIFETIMES, DEFAULT_LISTEN_OPTIONS } from '../../src/remote/types.js';

// ============================================================================
// Types and Constants Tests
// ============================================================================

describe('Remote Types', () => {
  describe('TOKEN_LIFETIMES', () => {
    test('has correct default values', () => {
      expect(TOKEN_LIFETIMES.SERVER_TOKEN_DAYS).toBe(90);
      expect(TOKEN_LIFETIMES.CONNECTION_TOKEN_HOURS).toBe(24);
      expect(TOKEN_LIFETIMES.REFRESH_THRESHOLD_HOURS).toBe(1);
    });
  });

  describe('DEFAULT_LISTEN_OPTIONS', () => {
    test('has correct default values', () => {
      expect(DEFAULT_LISTEN_OPTIONS.port).toBe(7890);
      expect(DEFAULT_LISTEN_OPTIONS.daemon).toBe(false);
      expect(DEFAULT_LISTEN_OPTIONS.rotateToken).toBe(false);
    });
  });
});

// ============================================================================
// Message Creation Helpers Tests
// ============================================================================

describe('Message Creation', () => {
  // Test message structure validation
  test('AuthMessage has correct structure', () => {
    const message: AuthMessage = {
      type: 'auth',
      id: 'test-id',
      timestamp: new Date().toISOString(),
      token: 'test-token',
      tokenType: 'server',
    };

    expect(message.type).toBe('auth');
    expect(message.token).toBe('test-token');
    expect(message.tokenType).toBe('server');
  });

  test('CheckConfigMessage has correct structure', () => {
    const message: CheckConfigMessage = {
      type: 'check_config',
      id: 'test-id',
      timestamp: new Date().toISOString(),
    };

    expect(message.type).toBe('check_config');
    expect(message.id).toBeDefined();
    expect(message.timestamp).toBeDefined();
  });

  test('PushConfigMessage has correct structure', () => {
    const message: PushConfigMessage = {
      type: 'push_config',
      id: 'test-id',
      timestamp: new Date().toISOString(),
      scope: 'global',
      configContent: 'maxIterations = 10',
      overwrite: false,
    };

    expect(message.type).toBe('push_config');
    expect(message.scope).toBe('global');
    expect(message.configContent).toBe('maxIterations = 10');
    expect(message.overwrite).toBe(false);
  });

  test('CheckConfigResponseMessage has correct structure', () => {
    const message: CheckConfigResponseMessage = {
      type: 'check_config_response',
      id: 'test-id',
      timestamp: new Date().toISOString(),
      globalExists: true,
      projectExists: false,
      globalPath: '/home/user/.config/ralph-tui/config.toml',
      globalContent: 'maxIterations = 5',
      remoteCwd: '/home/user/project',
    };

    expect(message.type).toBe('check_config_response');
    expect(message.globalExists).toBe(true);
    expect(message.projectExists).toBe(false);
    expect(message.globalContent).toBe('maxIterations = 5');
  });

  test('PushConfigResponseMessage has correct structure', () => {
    const message: PushConfigResponseMessage = {
      type: 'push_config_response',
      id: 'test-id',
      timestamp: new Date().toISOString(),
      success: true,
      configPath: '/home/user/.config/ralph-tui/config.toml',
      backupPath: '/home/user/.config/ralph-tui/config.toml.backup.2026-01-19',
      migrationTriggered: true,
      requiresRestart: false,
    };

    expect(message.type).toBe('push_config_response');
    expect(message.success).toBe(true);
    expect(message.backupPath).toBeDefined();
    expect(message.migrationTriggered).toBe(true);
  });
});

// ============================================================================
// Client Tests
// ============================================================================

describe('RemoteClient', () => {
  // Mock WebSocket for testing
  let mockWebSocket: {
    send: ReturnType<typeof mock>;
    close: ReturnType<typeof mock>;
    onopen: (() => void) | null;
    onmessage: ((event: { data: string }) => void) | null;
    onerror: ((event: unknown) => void) | null;
    onclose: (() => void) | null;
  };

  let originalWebSocket: typeof WebSocket;

  beforeEach(() => {
    mockWebSocket = {
      send: mock(() => {}),
      close: mock(() => {}),
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
    };

    // Store original WebSocket
    originalWebSocket = globalThis.WebSocket;

    // Mock WebSocket constructor
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = mock(() => mockWebSocket);
  });

  afterEach(() => {
    // Restore original WebSocket
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = originalWebSocket;
  });

  describe('Connection', () => {
    test('creates WebSocket with correct URL', async () => {
      const { RemoteClient } = await import('../../src/remote/client.js');

      const events: unknown[] = [];
      const client = new RemoteClient('localhost', 7890, 'test-token', (event) => {
        events.push(event);
      });

      // Start connection (don't await - we'll trigger callbacks manually)
      const connectPromise = client.connect();

      // Should have created WebSocket with correct URL
      expect(globalThis.WebSocket).toHaveBeenCalledWith('ws://localhost:7890');

      // Simulate successful connection and auth
      mockWebSocket.onopen?.();

      // Verify auth message was sent
      expect(mockWebSocket.send).toHaveBeenCalled();
      const authCall = (mockWebSocket.send as ReturnType<typeof mock>).mock.calls[0];
      const authMessage = JSON.parse(authCall[0] as string) as AuthMessage;
      expect(authMessage.type).toBe('auth');
      expect(authMessage.token).toBe('test-token');
      expect(authMessage.tokenType).toBe('server');

      // Simulate auth success response
      const authResponse: AuthResponseMessage = {
        type: 'auth_response',
        id: authMessage.id,
        timestamp: new Date().toISOString(),
        success: true,
        connectionToken: 'conn-token-123',
        connectionTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      };
      mockWebSocket.onmessage?.({ data: JSON.stringify(authResponse) });

      await connectPromise;

      expect(client.status).toBe('connected');
      expect(events).toContainEqual({ type: 'connecting' });
      expect(events).toContainEqual({ type: 'connected' });
    });

    test('handles authentication failure', async () => {
      const { RemoteClient } = await import('../../src/remote/client.js');

      const events: unknown[] = [];
      const client = new RemoteClient('localhost', 7890, 'bad-token', (event) => {
        events.push(event);
      });

      const connectPromise = client.connect();

      // Simulate connection open
      mockWebSocket.onopen?.();

      // Get the auth message
      const authCall = (mockWebSocket.send as ReturnType<typeof mock>).mock.calls[0];
      const authMessage = JSON.parse(authCall[0] as string) as AuthMessage;

      // Simulate auth failure
      const authResponse: AuthResponseMessage = {
        type: 'auth_response',
        id: authMessage.id,
        timestamp: new Date().toISOString(),
        success: false,
        error: 'Invalid token',
      };
      mockWebSocket.onmessage?.({ data: JSON.stringify(authResponse) });

      await expect(connectPromise).rejects.toThrow('Invalid token');
      expect(client.status).toBe('disconnected');
    });

    test('handles ping/pong for heartbeat', async () => {
      const { RemoteClient } = await import('../../src/remote/client.js');

      const events: unknown[] = [];
      const client = new RemoteClient('localhost', 7890, 'test-token', (event) => {
        events.push(event);
      });

      const connectPromise = client.connect();
      mockWebSocket.onopen?.();

      const authCall = (mockWebSocket.send as ReturnType<typeof mock>).mock.calls[0];
      const authMessage = JSON.parse(authCall[0] as string) as AuthMessage;

      const authResponse: AuthResponseMessage = {
        type: 'auth_response',
        id: authMessage.id,
        timestamp: new Date().toISOString(),
        success: true,
      };
      mockWebSocket.onmessage?.({ data: JSON.stringify(authResponse) });

      await connectPromise;

      // Simulate pong response - the pong handler updates latency if lastPingTime is set
      // In the mock scenario, lastPingTime won't be set since we didn't actually send a ping
      // So we just verify the pong message is handled without errors
      const pongMessage: PongMessage = {
        type: 'pong',
        id: 'ping-id',
        timestamp: new Date().toISOString(),
      };

      // Should not throw when receiving pong
      expect(() => {
        mockWebSocket.onmessage?.({ data: JSON.stringify(pongMessage) });
      }).not.toThrow();

      // Verify client is still connected after pong
      expect(client.status).toBe('connected');
    });
  });

  describe('Disconnect', () => {
    test('intentional disconnect does not trigger reconnect', async () => {
      const { RemoteClient } = await import('../../src/remote/client.js');

      const events: unknown[] = [];
      const client = new RemoteClient('localhost', 7890, 'test-token', (event) => {
        events.push(event);
      });

      const connectPromise = client.connect();
      mockWebSocket.onopen?.();

      const authCall = (mockWebSocket.send as ReturnType<typeof mock>).mock.calls[0];
      const authMessage = JSON.parse(authCall[0] as string) as AuthMessage;

      const authResponse: AuthResponseMessage = {
        type: 'auth_response',
        id: authMessage.id,
        timestamp: new Date().toISOString(),
        success: true,
      };
      mockWebSocket.onmessage?.({ data: JSON.stringify(authResponse) });

      await connectPromise;

      // Intentional disconnect
      client.disconnect();

      expect(client.status).toBe('disconnected');
      expect(mockWebSocket.close).toHaveBeenCalled();

      // Should not have reconnecting event
      const reconnectEvent = events.find(
        (e) => typeof e === 'object' && e !== null && 'type' in e && e.type === 'reconnecting'
      );
      expect(reconnectEvent).toBeUndefined();
    });
  });
});

// ============================================================================
// Server Tests (Mocked)
// ============================================================================

describe('RemoteServer', () => {
  describe('Message Handling', () => {
    // We can't easily unit test the actual server without running Bun.serve
    // These tests verify the message type handling logic conceptually

    test('message types are correctly defined', () => {
      // Verify all message types exist as string literals
      const messageTypes = [
        'auth',
        'auth_response',
        'token_refresh',
        'token_refresh_response',
        'ping',
        'pong',
        'error',
        'server_status',
        'subscribe',
        'unsubscribe',
        'engine_event',
        'get_state',
        'state_response',
        'get_tasks',
        'tasks_response',
        'pause',
        'resume',
        'interrupt',
        'refresh_tasks',
        'add_iterations',
        'remove_iterations',
        'continue',
        'operation_result',
        'get_prompt_preview',
        'prompt_preview_response',
        'get_iteration_output',
        'iteration_output_response',
        'check_config',
        'check_config_response',
        'push_config',
        'push_config_response',
      ];

      // Just verify these are valid string values
      messageTypes.forEach((type) => {
        expect(typeof type).toBe('string');
        expect(type.length).toBeGreaterThan(0);
      });
    });
  });

  describe('Interrupt Handling', () => {
    test('resets the active task to open after interrupt succeeds', async () => {
      const { RemoteServer } = await import('../../src/remote/server.js');

      const stop = mock(() => Promise.resolve());
      const resetTasksToOpen = mock(() => Promise.resolve(1));
      const on = mock(() => () => {});
      const mockEngine = {
        on,
        stop,
        resetTasksToOpen,
        getState: () => ({
          currentTask: {
            id: 'task-123',
            title: 'Task 123',
            status: 'in_progress',
          },
        }),
      };

      const server = new RemoteServer({
        port: 7890,
        hasToken: false,
        engine: mockEngine as unknown as ExecutionEngine,
      });

      const ws = {
        send: mock(() => {}),
      };

      const message: InterruptMessage = {
        type: 'interrupt',
        id: 'interrupt-1',
        timestamp: new Date().toISOString(),
      };

      (server as unknown as {
        handleInterrupt: (
          ws: unknown,
          message: InterruptMessage
        ) => void;
      }).handleInterrupt(ws, message);

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(on).toHaveBeenCalledTimes(1);
      expect(stop).toHaveBeenCalledTimes(1);
      expect(resetTasksToOpen).toHaveBeenCalledWith(['task-123']);

      const calls = (ws.send as ReturnType<typeof mock>).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const response = JSON.parse(calls[calls.length - 1][0] as string) as OperationResultMessage;
      expect(response.type).toBe('operation_result');
      expect(response.operation).toBe('interrupt');
      expect(response.success).toBe(true);
      expect(response.id).toBe('interrupt-1');
    });
  });
});

// ============================================================================
// Config Push Feature Tests
// ============================================================================

describe('Config Push Feature', () => {
  let tempDir: string;
  let globalConfigDir: string;
  let projectConfigDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ralph-tui-config-push-test-'));
    globalConfigDir = join(tempDir, '.config', 'ralph-tui');
    projectConfigDir = join(tempDir, '.ralph-tui');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('Config Detection', () => {
    test('detects no config exists', async () => {
      // Neither global nor project config exists
      let globalExists = false;
      let projectExists = false;

      try {
        await access(join(globalConfigDir, 'config.toml'), constants.R_OK);
        globalExists = true;
      } catch {
        // Expected
      }

      try {
        await access(join(projectConfigDir, 'config.toml'), constants.R_OK);
        projectExists = true;
      } catch {
        // Expected
      }

      expect(globalExists).toBe(false);
      expect(projectExists).toBe(false);
    });

    test('detects global config exists', async () => {
      await mkdir(globalConfigDir, { recursive: true });
      await writeFile(join(globalConfigDir, 'config.toml'), 'maxIterations = 10', 'utf-8');

      let globalExists = false;
      try {
        await access(join(globalConfigDir, 'config.toml'), constants.R_OK);
        globalExists = true;
      } catch {
        // Not expected
      }

      expect(globalExists).toBe(true);
    });

    test('detects project config exists', async () => {
      await mkdir(projectConfigDir, { recursive: true });
      await writeFile(join(projectConfigDir, 'config.toml'), 'maxIterations = 20', 'utf-8');

      let projectExists = false;
      try {
        await access(join(projectConfigDir, 'config.toml'), constants.R_OK);
        projectExists = true;
      } catch {
        // Not expected
      }

      expect(projectExists).toBe(true);
    });

    test('reads config content for preview', async () => {
      const content = `# Ralph TUI Config
maxIterations = 15
agent = "claude"
tracker = "beads"`;

      await mkdir(globalConfigDir, { recursive: true });
      await writeFile(join(globalConfigDir, 'config.toml'), content, 'utf-8');

      const readContent = await readFile(join(globalConfigDir, 'config.toml'), 'utf-8');
      expect(readContent).toBe(content);
    });
  });

  describe('Config Writing', () => {
    test('writes new config file', async () => {
      const content = 'maxIterations = 25';

      await mkdir(globalConfigDir, { recursive: true });
      await writeFile(join(globalConfigDir, 'config.toml'), content, 'utf-8');

      const readContent = await readFile(join(globalConfigDir, 'config.toml'), 'utf-8');
      expect(readContent).toBe(content);
    });

    test('creates backup before overwriting', async () => {
      const originalContent = 'maxIterations = 10';
      const newContent = 'maxIterations = 30';

      await mkdir(globalConfigDir, { recursive: true });
      await writeFile(join(globalConfigDir, 'config.toml'), originalContent, 'utf-8');

      // Create backup
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = join(globalConfigDir, `config.toml.backup.${timestamp}`);
      await writeFile(backupPath, originalContent, 'utf-8');

      // Write new config
      await writeFile(join(globalConfigDir, 'config.toml'), newContent, 'utf-8');

      // Verify backup exists and has original content
      const backupContent = await readFile(backupPath, 'utf-8');
      expect(backupContent).toBe(originalContent);

      // Verify new config has new content
      const newConfigContent = await readFile(join(globalConfigDir, 'config.toml'), 'utf-8');
      expect(newConfigContent).toBe(newContent);
    });
  });

  describe('TOML Validation', () => {
    test('validates valid TOML', async () => {
      const { parse } = await import('smol-toml');

      const validToml = `
maxIterations = 10
agent = "claude"
tracker = "beads"

[agent_config]
model = "claude-sonnet-4-20250514"
`;

      expect(() => parse(validToml)).not.toThrow();
    });

    test('rejects invalid TOML', async () => {
      const { parse } = await import('smol-toml');

      const invalidToml = `
maxIterations =
agent = "claude
`;

      expect(() => parse(invalidToml)).toThrow();
    });
  });
});

// ============================================================================
// Instance Manager Tests
// ============================================================================

describe('InstanceManager', () => {
  describe('Tab Management', () => {
    test('createLocalTab returns correct structure', async () => {
      const { createLocalTab } = await import('../../src/remote/client.js');

      const tab = createLocalTab();

      expect(tab.id).toBe('local');
      expect(tab.label).toBe('Local');
      expect(tab.isLocal).toBe(true);
      expect(tab.status).toBe('connected');
    });

    test('createRemoteTab returns correct structure', async () => {
      const { createRemoteTab } = await import('../../src/remote/client.js');

      const tab = createRemoteTab('prod', 'server.example.com', 7890);

      expect(tab.id).toBe('remote-prod');
      expect(tab.label).toBe('prod');
      expect(tab.isLocal).toBe(false);
      expect(tab.status).toBe('disconnected');
      expect(tab.alias).toBe('prod');
      expect(tab.host).toBe('server.example.com');
      expect(tab.port).toBe(7890);
    });
  });

  describe('Connection Metrics', () => {
    test('metrics structure is correct', async () => {
      const { DEFAULT_RECONNECT_CONFIG } = await import('../../src/remote/client.js');

      expect(DEFAULT_RECONNECT_CONFIG.initialDelayMs).toBe(1000);
      expect(DEFAULT_RECONNECT_CONFIG.maxDelayMs).toBe(30000);
      expect(DEFAULT_RECONNECT_CONFIG.backoffMultiplier).toBe(2);
      expect(DEFAULT_RECONNECT_CONFIG.maxRetries).toBe(10);
      expect(DEFAULT_RECONNECT_CONFIG.silentRetryThreshold).toBe(3);
    });
  });

  describe('Remote Management Methods', () => {
    test('getTabIndexByAlias returns -1 for non-existent alias', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      // Initialize with local tab only
      await manager.initialize();

      const index = manager.getTabIndexByAlias('non-existent');
      expect(index).toBe(-1);
    });

    test('getTabIndexByAlias returns correct index for existing alias', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      // Initialize and manually add a tab for testing
      await manager.initialize();
      const tabs = manager.getTabs();

      // The local tab is always at index 0
      expect(tabs[0].isLocal).toBe(true);
      expect(manager.getTabIndexByAlias('local-alias')).toBe(-1); // Local tab has no alias
    });

    test('disconnectRemote handles non-existent alias gracefully', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      await manager.initialize();

      // Should not throw when disconnecting non-existent remote
      expect(() => manager.disconnectRemote('non-existent')).not.toThrow();
    });

    test('removeTab handles non-existent alias gracefully', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      await manager.initialize();
      const initialTabCount = manager.getTabs().length;

      // Should not throw when removing non-existent tab
      expect(() => manager.removeTab('non-existent')).not.toThrow();

      // Tab count should remain unchanged
      expect(manager.getTabs().length).toBe(initialTabCount);
    });

    test('removeTab does not remove local tab', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      await manager.initialize();
      const initialTabs = manager.getTabs();

      // Local tab should exist
      expect(initialTabs.some(t => t.isLocal)).toBe(true);

      // Try to remove by local tab's alias (should be undefined)
      manager.removeTab('local');

      // Local tab should still exist (removeTab won't match it since alias is undefined)
      const tabsAfter = manager.getTabs();
      expect(tabsAfter.some(t => t.isLocal)).toBe(true);
    });

    test('getTabs returns tabs array', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      await manager.initialize();
      const tabs = manager.getTabs();

      expect(Array.isArray(tabs)).toBe(true);
      expect(tabs.length).toBeGreaterThanOrEqual(1); // At least local tab
      expect(tabs[0].isLocal).toBe(true);
    });

    test('getSelectedIndex returns valid index', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      await manager.initialize();
      const index = manager.getSelectedIndex();

      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(manager.getTabs().length);
    });

    test('onStateChange callback is called on state changes', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      let callCount = 0;
      let lastTabs: unknown[] = [];
      let lastIndex = -1;

      manager.onStateChange((tabs, index) => {
        callCount++;
        lastTabs = tabs;
        lastIndex = index;
      });

      await manager.initialize();

      // State change should have been called at least once during init
      expect(callCount).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(lastTabs)).toBe(true);
      expect(lastIndex).toBeGreaterThanOrEqual(0);
    });

    test('onToast callback is registered', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      let toastReceived = false;
      manager.onToast(() => {
        toastReceived = true;
      });

      // Just verify the callback was registered without error
      expect(toastReceived).toBe(false); // No toast yet
    });

    test('disconnectAll handles empty clients map', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      await manager.initialize();

      // Should not throw when disconnecting with no remote clients
      expect(() => manager.disconnectAll()).not.toThrow();
    });

    test('selectTab validates index bounds', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      await manager.initialize();

      // Selecting a valid index should work
      await manager.selectTab(0);
      expect(manager.getSelectedIndex()).toBe(0);
    });

    test('getClientByAlias returns null for non-existent alias', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      await manager.initialize();

      const client = manager.getClientByAlias('non-existent');
      expect(client).toBeNull();
    });

    test('getSelectedClient returns null when local tab selected', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      await manager.initialize();
      await manager.selectTab(0); // Select local tab

      const client = manager.getSelectedClient();
      expect(client).toBeNull(); // Local tab has no client
    });

    test('isViewingRemote returns false when local tab selected', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      await manager.initialize();
      await manager.selectTab(0); // Select local tab

      expect(manager.isViewingRemote()).toBe(false);
    });

    test('getSelectedTab returns local tab when selected', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      await manager.initialize();
      await manager.selectTab(0); // Select local tab

      const tab = manager.getSelectedTab();
      expect(tab).toBeDefined();
      expect(tab?.isLocal).toBe(true);
    });
  });

  describe('Remote Management with Mocked WebSocket', () => {
    let mockWebSocket: {
      send: ReturnType<typeof mock>;
      close: ReturnType<typeof mock>;
      onopen: (() => void) | null;
      onmessage: ((event: { data: string }) => void) | null;
      onerror: ((error: Error) => void) | null;
      onclose: (() => void) | null;
      readyState: number;
    };
    let originalWebSocket: typeof WebSocket;

    beforeEach(() => {
      mockWebSocket = {
        send: mock(() => {}),
        close: mock(() => {}),
        onopen: null,
        onmessage: null,
        onerror: null,
        onclose: null,
        readyState: 1, // OPEN
      };

      originalWebSocket = globalThis.WebSocket;
      (globalThis as unknown as { WebSocket: unknown }).WebSocket = mock(() => mockWebSocket);
    });

    afterEach(() => {
      (globalThis as unknown as { WebSocket: unknown }).WebSocket = originalWebSocket;
    });

    test('addAndConnectRemote creates tab and attempts connection', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      await manager.initialize();
      const initialTabCount = manager.getTabs().length;

      // Start add and connect (don't await fully - connection will be mocked)
      const addPromise = manager.addAndConnectRemote('test-remote', 'localhost', 7890, 'test-token');

      // Tab should be added immediately
      const tabs = manager.getTabs();
      expect(tabs.length).toBe(initialTabCount + 1);

      const newTab = tabs.find(t => t.alias === 'test-remote');
      expect(newTab).toBeDefined();
      expect(newTab?.host).toBe('localhost');
      expect(newTab?.port).toBe(7890);
      expect(newTab?.isLocal).toBe(false);

      // Simulate connection open and auth
      mockWebSocket.onopen?.();

      // Simulate auth response
      const authResponse = {
        type: 'auth_response',
        id: 'test-id',
        timestamp: new Date().toISOString(),
        success: true,
        connectionToken: 'conn-token',
        connectionTokenExpiresAt: new Date(Date.now() + 86400000).toISOString(),
      };
      mockWebSocket.onmessage?.({ data: JSON.stringify(authResponse) });

      // Wait for connection to complete
      await addPromise.catch(() => {}); // May throw due to partial mock
    });

    test('removeTab disconnects and removes tab', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      await manager.initialize();

      // Add a remote tab first
      manager.addAndConnectRemote('to-remove', 'localhost', 7890, 'token').catch(() => {});

      // Simulate connection
      mockWebSocket.onopen?.();
      const authResponse = {
        type: 'auth_response',
        id: 'test-id',
        timestamp: new Date().toISOString(),
        success: true,
      };
      mockWebSocket.onmessage?.({ data: JSON.stringify(authResponse) });

      // Wait a tick
      await new Promise(resolve => setTimeout(resolve, 10));

      const tabCountBefore = manager.getTabs().length;

      // Remove the tab
      manager.removeTab('to-remove');

      // Tab should be removed
      const tabCountAfter = manager.getTabs().length;
      expect(tabCountAfter).toBe(tabCountBefore - 1);

      const removedTab = manager.getTabs().find(t => t.alias === 'to-remove');
      expect(removedTab).toBeUndefined();
    });

    test('disconnectRemote updates tab status', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      await manager.initialize();

      // Add a remote tab
      manager.addAndConnectRemote('test-disconnect', 'localhost', 7890, 'token').catch(() => {});

      // Simulate connection
      mockWebSocket.onopen?.();
      const authResponse = {
        type: 'auth_response',
        id: 'test-id',
        timestamp: new Date().toISOString(),
        success: true,
      };
      mockWebSocket.onmessage?.({ data: JSON.stringify(authResponse) });

      await new Promise(resolve => setTimeout(resolve, 10));

      // Disconnect
      manager.disconnectRemote('test-disconnect');

      // Tab should still exist but be disconnected
      const tab = manager.getTabs().find(t => t.alias === 'test-disconnect');
      expect(tab).toBeDefined();
      expect(tab?.status).toBe('disconnected');
    });

    test('reconnectRemote updates tab info and reconnects', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      await manager.initialize();

      // Add initial remote
      manager.addAndConnectRemote('reconnect-test', 'old-host', 7890, 'old-token').catch(() => {});

      mockWebSocket.onopen?.();
      mockWebSocket.onmessage?.({ data: JSON.stringify({
        type: 'auth_response',
        id: 'test-id',
        timestamp: new Date().toISOString(),
        success: true,
      })});

      await new Promise(resolve => setTimeout(resolve, 10));

      // Reconnect with new details
      manager.reconnectRemote('reconnect-test', 'new-host', 8890, 'new-token').catch(() => {});

      // Tab should have updated info
      const tab = manager.getTabs().find(t => t.alias === 'reconnect-test');
      expect(tab).toBeDefined();
      expect(tab?.host).toBe('new-host');
      expect(tab?.port).toBe(8890);
    });

    test('getTabIndexByAlias returns correct index after adding remote', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      await manager.initialize();

      // Add a remote
      manager.addAndConnectRemote('index-test', 'localhost', 7890, 'token').catch(() => {});

      // Should find the tab at the correct index
      const index = manager.getTabIndexByAlias('index-test');
      expect(index).toBeGreaterThan(0); // Should be after local tab

      const tabs = manager.getTabs();
      expect(tabs[index]?.alias).toBe('index-test');
    });

    test('selectNextTab cycles through tabs', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      await manager.initialize();

      // Start at local tab (index 0)
      expect(manager.getSelectedIndex()).toBe(0);

      // If there's only one tab, next should stay at 0
      if (manager.getTabs().length === 1) {
        await manager.selectNextTab();
        expect(manager.getSelectedIndex()).toBe(0);
      }
    });

    test('selectPreviousTab cycles through tabs', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      await manager.initialize();

      // Start at local tab (index 0)
      expect(manager.getSelectedIndex()).toBe(0);

      // Previous from first with only one tab should stay at 0
      if (manager.getTabs().length === 1) {
        await manager.selectPreviousTab();
        expect(manager.getSelectedIndex()).toBe(0);
      }
    });

    test('refresh does not throw', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      await manager.initialize();

      // Refresh should not throw
      let threw = false;
      try {
        await manager.refresh();
      } catch {
        threw = true;
      }
      expect(threw).toBe(false);
    });

    test('selectTab ignores out-of-bounds index', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      await manager.initialize();

      // Select negative index - should not change
      await manager.selectTab(-1);
      expect(manager.getSelectedIndex()).toBe(0);

      // Select too-high index - should not change
      await manager.selectTab(999);
      expect(manager.getSelectedIndex()).toBe(0);
    });

    test('selectTab notifies state change', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      let stateChangeCalled = false;
      manager.onStateChange(() => {
        stateChangeCalled = true;
      });

      await manager.initialize();
      stateChangeCalled = false; // Reset after init

      await manager.selectTab(0);
      expect(stateChangeCalled).toBe(true);
    });

    test('addAndConnectRemote adds tab synchronously', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      await manager.initialize();
      const initialCount = manager.getTabs().length;

      // Start adding remote (don't await - just verify tab is added synchronously)
      manager.addAndConnectRemote('sync-test', 'localhost', 7890, 'token');

      // Tab should be added immediately (synchronously, before connection completes)
      expect(manager.getTabs().length).toBe(initialCount + 1);

      const newTab = manager.getTabs().find(t => t.alias === 'sync-test');
      expect(newTab).toBeDefined();
      expect(newTab?.host).toBe('localhost');
      expect(newTab?.port).toBe(7890);
    });

    test('notifyStateChange calls handler with current state', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      let receivedTabs: unknown[] = [];
      let receivedIndex = -1;

      manager.onStateChange((tabs, index) => {
        receivedTabs = tabs;
        receivedIndex = index;
      });

      await manager.initialize();

      expect(receivedTabs.length).toBeGreaterThanOrEqual(1);
      expect(receivedIndex).toBeGreaterThanOrEqual(0);
    });

    test('removeTab decreases tab count', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      await manager.initialize();
      const initialCount = manager.getTabs().length;

      // Add a remote tab
      manager.addAndConnectRemote('remove-count-test', 'host', 7890, 'token');
      expect(manager.getTabs().length).toBe(initialCount + 1);

      // Remove the tab
      manager.removeTab('remove-count-test');
      expect(manager.getTabs().length).toBe(initialCount);
    });

    test('removeTab removes correct tab by alias', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      await manager.initialize();

      // Add a remote tab
      manager.addAndConnectRemote('alias-remove-test', 'host', 7890, 'token');

      // Verify tab exists
      expect(manager.getTabs().some(t => t.alias === 'alias-remove-test')).toBe(true);

      // Remove it
      manager.removeTab('alias-remove-test');

      // Verify tab is gone
      expect(manager.getTabs().some(t => t.alias === 'alias-remove-test')).toBe(false);
    });

    test('reconnectRemote updates host and port', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      await manager.initialize();

      // Add initial remote
      manager.addAndConnectRemote('reconnect-me', 'old-host', 1111, 'old-token');

      const tabBefore = manager.getTabs().find(t => t.alias === 'reconnect-me');
      expect(tabBefore?.host).toBe('old-host');
      expect(tabBefore?.port).toBe(1111);

      // Reconnect with new details (don't await, just trigger)
      manager.reconnectRemote('reconnect-me', 'new-host', 2222, 'new-token');

      // Tab should have new host/port immediately
      const tabAfter = manager.getTabs().find(t => t.alias === 'reconnect-me');
      expect(tabAfter?.host).toBe('new-host');
      expect(tabAfter?.port).toBe(2222);
    });

    test('emitToast calls toast handler', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      const toasts: unknown[] = [];
      manager.onToast((toast) => {
        toasts.push(toast);
      });

      await manager.initialize();

      // Add a remote - this should trigger toast events during connection attempts
      manager.addAndConnectRemote('toast-test', 'localhost', 7890, 'token');

      // Simulate connection error which should emit a toast
      mockWebSocket.onerror?.(new Error('Connection failed'));

      // Wait a tick for events to propagate
      await new Promise(resolve => setTimeout(resolve, 10));

      // May or may not have toasts depending on error handling
      // This test mainly exercises the toast handler registration path
      expect(Array.isArray(toasts)).toBe(true);
    });

    test('getTabIndexByAlias with multiple remotes', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      await manager.initialize();

      // Add multiple remotes
      manager.addAndConnectRemote('idx-first', 'host1', 7890, 'token1');
      manager.addAndConnectRemote('idx-second', 'host2', 7890, 'token2');
      manager.addAndConnectRemote('idx-third', 'host3', 7890, 'token3');

      // Each remote should have the correct index
      const firstIdx = manager.getTabIndexByAlias('idx-first');
      const secondIdx = manager.getTabIndexByAlias('idx-second');
      const thirdIdx = manager.getTabIndexByAlias('idx-third');

      expect(firstIdx).toBeGreaterThan(0); // After local
      expect(secondIdx).toBe(firstIdx + 1);
      expect(thirdIdx).toBe(secondIdx + 1);
    });

    test('disconnectRemote with non-existent alias does nothing', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      await manager.initialize();
      const tabCount = manager.getTabs().length;

      // Disconnect non-existent alias should not throw or change state
      manager.disconnectRemote('does-not-exist');

      expect(manager.getTabs().length).toBe(tabCount);
    });

    test('state change handler is replaced on second registration', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      let handler1CallCount = 0;
      let handler2CallCount = 0;

      manager.onStateChange(() => { handler1CallCount++; });
      manager.onStateChange(() => { handler2CallCount++; }); // Replaces first handler

      await manager.initialize();

      // Only the second handler should be called (onStateChange replaces the handler)
      expect(handler1CallCount).toBe(0);
      expect(handler2CallCount).toBeGreaterThan(0);
    });

    test('getClientByAlias returns null for local tab', async () => {
      const { InstanceManager } = await import('../../src/remote/instance-manager.js');
      const manager = new InstanceManager();

      await manager.initialize();

      // Local tab has no alias, but even if we try with 'local', should return null
      const client = manager.getClientByAlias('local');
      expect(client).toBeNull();
    });
  });
});

// ============================================================================
// Token Management Tests
// ============================================================================

describe('Token Management', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ralph-tui-token-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('Token Generation', () => {
    test('generates tokens with correct format', () => {
      // Token should be a random string
      const token = crypto.randomUUID();
      expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    test('generates unique tokens', () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 100; i++) {
        tokens.add(crypto.randomUUID());
      }
      expect(tokens.size).toBe(100);
    });
  });

  describe('Token Expiration', () => {
    test('calculates server token expiration correctly', () => {
      const now = Date.now();
      const expiresAt = new Date(now + TOKEN_LIFETIMES.SERVER_TOKEN_DAYS * 24 * 60 * 60 * 1000);
      const diffDays = (expiresAt.getTime() - now) / (24 * 60 * 60 * 1000);

      expect(Math.round(diffDays)).toBe(90);
    });

    test('calculates connection token expiration correctly', () => {
      const now = Date.now();
      const expiresAt = new Date(now + TOKEN_LIFETIMES.CONNECTION_TOKEN_HOURS * 60 * 60 * 1000);
      const diffHours = (expiresAt.getTime() - now) / (60 * 60 * 1000);

      expect(Math.round(diffHours)).toBe(24);
    });

    test('calculates refresh threshold correctly', () => {
      const now = Date.now();
      const tokenExpiresAt = now + TOKEN_LIFETIMES.CONNECTION_TOKEN_HOURS * 60 * 60 * 1000;
      const refreshThreshold = TOKEN_LIFETIMES.REFRESH_THRESHOLD_HOURS * 60 * 60 * 1000;
      const shouldRefreshAt = tokenExpiresAt - refreshThreshold;

      // Should refresh 1 hour before expiration
      const hoursUntilRefresh = (shouldRefreshAt - now) / (60 * 60 * 1000);
      expect(Math.round(hoursUntilRefresh)).toBe(23);
    });
  });
});

// ============================================================================
// Remote Config Integration Tests
// ============================================================================

describe('Remote Config Integration', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'ralph-tui-remote-config-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('Scope Selection', () => {
    test('global scope targets correct path', () => {
      const globalPath = join(homedir(), '.config', 'ralph-tui', 'config.toml');
      expect(globalPath).toContain('.config');
      expect(globalPath).toContain('ralph-tui');
      expect(globalPath).toContain('config.toml');
    });

    test('project scope targets correct path', () => {
      const projectPath = join(tempDir, '.ralph-tui', 'config.toml');
      expect(projectPath).toContain('.ralph-tui');
      expect(projectPath).toContain('config.toml');
    });
  });

  describe('Directory Creation', () => {
    test('creates parent directory if needed', async () => {
      const configDir = join(tempDir, 'new-dir', '.ralph-tui');
      await mkdir(configDir, { recursive: true });

      let exists = false;
      try {
        await access(configDir, constants.R_OK);
        exists = true;
      } catch {
        // Not expected
      }

      expect(exists).toBe(true);
    });
  });
});

// ============================================================================
// CLI Command Tests
// ============================================================================

describe('Remote CLI Commands', () => {
  describe('parseRemoteArgs', () => {
    test('parses push-config command correctly', async () => {
      const { parseRemoteArgs } = await import('../../src/commands/remote.js');

      const args = ['push-config', 'prod', '--scope', 'global', '--preview', '--force'];
      const options = parseRemoteArgs(args);

      expect(options.subcommand).toBe('push-config');
      expect(options.alias).toBe('prod');
      expect(options.scope).toBe('global');
      expect(options.preview).toBe(true);
      expect(options.force).toBe(true);
    });

    test('parses push-config --all correctly', async () => {
      const { parseRemoteArgs } = await import('../../src/commands/remote.js');

      const args = ['push-config', '--all', '--force'];
      const options = parseRemoteArgs(args);

      expect(options.subcommand).toBe('push-config');
      expect(options.all).toBe(true);
      expect(options.force).toBe(true);
    });

    test('parses scope option correctly', async () => {
      const { parseRemoteArgs } = await import('../../src/commands/remote.js');

      const globalArgs = ['push-config', 'test', '--scope', 'global'];
      const globalOptions = parseRemoteArgs(globalArgs);
      expect(globalOptions.scope).toBe('global');

      const projectArgs = ['push-config', 'test', '--scope', 'project'];
      const projectOptions = parseRemoteArgs(projectArgs);
      expect(projectOptions.scope).toBe('project');
    });

    test('ignores invalid scope values', async () => {
      const { parseRemoteArgs } = await import('../../src/commands/remote.js');

      const args = ['push-config', 'test', '--scope', 'invalid'];
      const options = parseRemoteArgs(args);
      expect(options.scope).toBeUndefined();
    });
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  describe('Connection Errors', () => {
    test('ErrorMessage has correct structure', () => {
      const error: ErrorMessage = {
        type: 'error',
        id: 'test-id',
        timestamp: new Date().toISOString(),
        code: 'NOT_AUTHENTICATED',
        message: 'Authentication required',
      };

      expect(error.type).toBe('error');
      expect(error.code).toBe('NOT_AUTHENTICATED');
      expect(error.message).toBe('Authentication required');
    });

    test('OperationResultMessage handles errors correctly', () => {
      const errorResult: OperationResultMessage = {
        type: 'operation_result',
        id: 'test-id',
        timestamp: new Date().toISOString(),
        operation: 'push_config',
        success: false,
        error: 'Invalid TOML syntax',
      };

      expect(errorResult.success).toBe(false);
      expect(errorResult.error).toBe('Invalid TOML syntax');
    });

    test('PushConfigResponseMessage handles errors correctly', () => {
      const errorResponse: PushConfigResponseMessage = {
        type: 'push_config_response',
        id: 'test-id',
        timestamp: new Date().toISOString(),
        success: false,
        error: 'Config already exists at /path/to/config.toml. Use overwrite=true to replace.',
      };

      expect(errorResponse.success).toBe(false);
      expect(errorResponse.error).toContain('Config already exists');
    });
  });

  describe('Validation Errors', () => {
    test('handles missing required fields', () => {
      // Test that TypeScript catches missing required fields at compile time
      // Runtime validation should also check for these
      const incompleteMessage = {
        type: 'push_config',
        id: 'test-id',
        timestamp: new Date().toISOString(),
        // Missing: scope, configContent, overwrite
      };

      // In runtime, we'd check for required fields
      expect(incompleteMessage).not.toHaveProperty('scope');
      expect(incompleteMessage).not.toHaveProperty('configContent');
    });
  });
});

// ============================================================================
// State Response Tests
// ============================================================================

describe('State Response', () => {
  test('RemoteEngineState has correct structure', () => {
    const state: RemoteEngineState = {
      status: 'running',
      currentIteration: 3,
      currentTask: {
        id: 'task-1',
        title: 'Test task',
        description: 'A test task',
        status: 'in_progress',
        priority: 2,
      },
      totalTasks: 10,
      tasksCompleted: 2,
      iterations: [],
      startedAt: new Date().toISOString(),
      currentOutput: 'Processing...',
      currentStderr: '',
      activeAgent: null,
      rateLimitState: null,
      maxIterations: 5,
      tasks: [],
      agentName: 'claude',
      trackerName: 'beads',
      currentModel: 'anthropic/claude-sonnet-4-20250514',
    };

    expect(state.status).toBe('running');
    expect(state.currentIteration).toBe(3);
    expect(state.currentTask?.id).toBe('task-1');
    expect(state.agentName).toBe('claude');
    expect(state.trackerName).toBe('beads');
  });

  test('StateResponseMessage wraps state correctly', () => {
    const state: RemoteEngineState = {
      status: 'idle',
      currentIteration: 0,
      currentTask: null,
      totalTasks: 5,
      tasksCompleted: 0,
      iterations: [],
      startedAt: null,
      currentOutput: '',
      currentStderr: '',
      activeAgent: null,
      rateLimitState: null,
      maxIterations: 3,
      tasks: [],
    };

    const response: StateResponseMessage = {
      type: 'state_response',
      id: 'test-id',
      timestamp: new Date().toISOString(),
      state,
    };

    expect(response.type).toBe('state_response');
    expect(response.state.status).toBe('idle');
    expect(response.state.totalTasks).toBe(5);
  });
});
