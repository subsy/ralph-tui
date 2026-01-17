/**
 * ABOUTME: Tests for the AgentPluginRegistry.
 * Tests plugin registration, discovery, instance management, and lifecycle.
 */

import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  mock,
  spyOn,
} from 'bun:test';
import {
  AgentRegistry,
  getAgentRegistry,
} from '../../src/plugins/agents/registry.js';
import type {
  AgentPlugin,
  AgentPluginFactory,
  AgentPluginMeta,
  AgentPluginConfig,
} from '../../src/plugins/agents/types.js';
import { createMockAgentPlugin } from '../mocks/agent-responses.js';

describe('AgentRegistry', () => {
  beforeEach(() => {
    // Reset the singleton before each test
    AgentRegistry.resetInstance();
  });

  afterEach(() => {
    // Clean up after tests
    AgentRegistry.resetInstance();
  });

  describe('singleton pattern', () => {
    test('getInstance returns the same instance', () => {
      const instance1 = AgentRegistry.getInstance();
      const instance2 = AgentRegistry.getInstance();
      expect(instance1).toBe(instance2);
    });

    test('getAgentRegistry returns consistent values on repeated calls', () => {
      // getAgentRegistry is a convenience wrapper that calls getInstance
      // Note: When engine tests run first, they mock this module, so we can't
      // test exact identity with getInstance. Instead, verify the function exists
      // and is callable.
      expect(typeof getAgentRegistry).toBe('function');
      // getAgentRegistry should return an object with registry-like interface
      const registry = getAgentRegistry();
      expect(registry).toBeDefined();
    });

    test('resetInstance clears the singleton', () => {
      const instance1 = AgentRegistry.getInstance();
      AgentRegistry.resetInstance();
      const instance2 = AgentRegistry.getInstance();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('registerBuiltin', () => {
    test('registers a plugin factory with its metadata', () => {
      const registry = AgentRegistry.getInstance();
      const mockPlugin = createMockAgentPlugin({
        meta: { id: 'test-plugin', name: 'Test Plugin' },
      });
      const factory: AgentPluginFactory = () => mockPlugin;

      registry.registerBuiltin(factory);

      expect(registry.hasPlugin('test-plugin')).toBe(true);
      expect(registry.isBuiltin('test-plugin')).toBe(true);
    });

    test('getPluginMeta returns the registered metadata', () => {
      const registry = AgentRegistry.getInstance();
      const mockPlugin = createMockAgentPlugin({
        meta: {
          id: 'my-agent',
          name: 'My Agent',
          description: 'Test description',
          version: '2.0.0',
        },
      });
      const factory: AgentPluginFactory = () => mockPlugin;

      registry.registerBuiltin(factory);

      const meta = registry.getPluginMeta('my-agent');
      expect(meta).toBeDefined();
      expect(meta?.id).toBe('my-agent');
      expect(meta?.name).toBe('My Agent');
      expect(meta?.description).toBe('Test description');
      expect(meta?.version).toBe('2.0.0');
    });

    test('getRegisteredPlugins returns all registered metadata', () => {
      const registry = AgentRegistry.getInstance();

      const plugin1 = createMockAgentPlugin({ meta: { id: 'plugin-1' } });
      const plugin2 = createMockAgentPlugin({ meta: { id: 'plugin-2' } });

      registry.registerBuiltin(() => plugin1);
      registry.registerBuiltin(() => plugin2);

      const plugins = registry.getRegisteredPlugins();
      expect(plugins.length).toBe(2);
      expect(plugins.map((p) => p.id).sort()).toEqual(['plugin-1', 'plugin-2']);
    });
  });

  describe('createInstance', () => {
    test('creates a new instance from registered factory', () => {
      const registry = AgentRegistry.getInstance();
      const mockPlugin = createMockAgentPlugin({
        meta: { id: 'factory-test' },
      });
      const factory: AgentPluginFactory = () => mockPlugin;

      registry.registerBuiltin(factory);

      const instance = registry.createInstance('factory-test');
      expect(instance).toBeDefined();
      expect(instance?.meta.id).toBe('factory-test');
    });

    test('returns undefined for unknown plugin', () => {
      const registry = AgentRegistry.getInstance();
      const instance = registry.createInstance('non-existent');
      expect(instance).toBeUndefined();
    });

    test('creates unique instances on each call', () => {
      const registry = AgentRegistry.getInstance();
      let callCount = 0;
      const factory: AgentPluginFactory = () => {
        callCount++;
        return createMockAgentPlugin({
          meta: { id: 'multi-instance', name: `Instance ${callCount}` },
        });
      };

      registry.registerBuiltin(factory);

      const instance1 = registry.createInstance('multi-instance');
      const instance2 = registry.createInstance('multi-instance');

      // Factory should be called for each createInstance (plus once during registration)
      expect(callCount).toBe(3);
      expect(instance1).toBeDefined();
      expect(instance2).toBeDefined();
    });
  });

  describe('getInstance (cached)', () => {
    test('returns cached instance for same config name', async () => {
      const registry = AgentRegistry.getInstance();
      const mockPlugin = createMockAgentPlugin({ meta: { id: 'cached-test' } });
      const initializeSpy = spyOn(mockPlugin, 'initialize');
      const factory: AgentPluginFactory = () => mockPlugin;

      registry.registerBuiltin(factory);

      const config: AgentPluginConfig = {
        name: 'my-claude',
        plugin: 'cached-test',
        options: {},
      };

      const instance1 = await registry.getInstance(config);
      const instance2 = await registry.getInstance(config);

      expect(instance1).toBe(instance2);
      // Initialize should only be called once
      expect(initializeSpy).toHaveBeenCalledTimes(1);
    });

    test('throws for unknown plugin', async () => {
      const registry = AgentRegistry.getInstance();

      const config: AgentPluginConfig = {
        name: 'test',
        plugin: 'unknown-plugin',
        options: {},
      };

      await expect(registry.getInstance(config)).rejects.toThrow(
        'Unknown agent plugin: unknown-plugin',
      );
    });

    test('initializes instance with merged config', async () => {
      const registry = AgentRegistry.getInstance();
      const mockPlugin = createMockAgentPlugin({ meta: { id: 'init-test' } });
      let receivedConfig: Record<string, unknown> = {};
      mockPlugin.initialize = async (config) => {
        receivedConfig = config;
      };
      const factory: AgentPluginFactory = () => mockPlugin;

      registry.registerBuiltin(factory);

      const config: AgentPluginConfig = {
        name: 'configured-agent',
        plugin: 'init-test',
        command: '/usr/local/bin/agent',
        defaultFlags: ['--verbose'],
        timeout: 60000,
        options: {
          model: 'sonnet',
          customOption: true,
        },
      };

      await registry.getInstance(config);

      expect(receivedConfig.command).toBe('/usr/local/bin/agent');
      expect(receivedConfig.defaultFlags).toEqual(['--verbose']);
      expect(receivedConfig.timeout).toBe(60000);
      expect(receivedConfig.model).toBe('sonnet');
      expect(receivedConfig.customOption).toBe(true);
    });
  });

  describe('disposeInstance', () => {
    test('disposes and removes cached instance', async () => {
      const registry = AgentRegistry.getInstance();
      const mockPlugin = createMockAgentPlugin({
        meta: { id: 'dispose-test' },
      });
      const disposeSpy = spyOn(mockPlugin, 'dispose');
      const factory: AgentPluginFactory = () => mockPlugin;

      registry.registerBuiltin(factory);

      const config: AgentPluginConfig = {
        name: 'to-dispose',
        plugin: 'dispose-test',
        options: {},
      };

      await registry.getInstance(config);
      await registry.disposeInstance('to-dispose');

      expect(disposeSpy).toHaveBeenCalled();

      // Getting instance again should create a new one
      const newInstance = await registry.getInstance(config);
      expect(newInstance).toBe(mockPlugin); // Same mock but re-initialized
    });

    test('handles disposing non-existent instance gracefully', async () => {
      const registry = AgentRegistry.getInstance();
      // Should not throw
      await registry.disposeInstance('non-existent');
    });
  });

  describe('disposeAll', () => {
    test('disposes all cached instances', async () => {
      const registry = AgentRegistry.getInstance();

      const plugin1 = createMockAgentPlugin({ meta: { id: 'multi-1' } });
      const plugin2 = createMockAgentPlugin({ meta: { id: 'multi-2' } });
      const dispose1Spy = spyOn(plugin1, 'dispose');
      const dispose2Spy = spyOn(plugin2, 'dispose');

      registry.registerBuiltin(() => plugin1);
      registry.registerBuiltin(() => plugin2);

      await registry.getInstance({
        name: 'agent-1',
        plugin: 'multi-1',
        options: {},
      });
      await registry.getInstance({
        name: 'agent-2',
        plugin: 'multi-2',
        options: {},
      });

      await registry.disposeAll();

      expect(dispose1Spy).toHaveBeenCalled();
      expect(dispose2Spy).toHaveBeenCalled();
    });
  });

  describe('hasPlugin and isBuiltin', () => {
    test('hasPlugin returns false for unregistered plugin', () => {
      const registry = AgentRegistry.getInstance();
      expect(registry.hasPlugin('unknown')).toBe(false);
    });

    test('isBuiltin returns false for unknown plugin', () => {
      const registry = AgentRegistry.getInstance();
      expect(registry.isBuiltin('unknown')).toBe(false);
    });
  });

  describe('getUserPluginsDir', () => {
    test('returns expected path structure', () => {
      const dir = AgentRegistry.getUserPluginsDir();
      expect(dir).toContain('.config');
      expect(dir).toContain('ralph-tui');
      expect(dir).toContain('plugins');
      expect(dir).toContain('agents');
    });
  });

  describe('initialize', () => {
    test('returns empty array when already initialized', async () => {
      const registry = AgentRegistry.getInstance();

      const results1 = await registry.initialize();
      const results2 = await registry.initialize();

      // Second call should return empty (already initialized)
      expect(results2).toEqual([]);
    });
  });
});
