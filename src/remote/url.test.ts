/**
 * ABOUTME: Tests for remote WebSocket URL construction.
 * Verifies secure protocol and default port formatting behavior.
 */

import { describe, expect, test } from 'bun:test';

import { buildRemoteWebSocketUrl, shouldUseSecureWebSocket } from './url.js';

describe('shouldUseSecureWebSocket', () => {
  test('uses secure WebSockets when secure is true', () => {
    expect(shouldUseSecureWebSocket(7890, true)).toBe(true);
  });

  test('uses secure WebSockets for port 443', () => {
    expect(shouldUseSecureWebSocket(443)).toBe(true);
  });

  test('uses plain WebSockets by default for non-443 ports', () => {
    expect(shouldUseSecureWebSocket(7890)).toBe(false);
  });
});

describe('buildRemoteWebSocketUrl', () => {
  test('builds ws URLs for plain remotes', () => {
    expect(buildRemoteWebSocketUrl('example.com', 7890)).toBe('ws://example.com:7890');
  });

  test('builds wss URLs for secure remotes', () => {
    expect(buildRemoteWebSocketUrl('example.com', 8443, true)).toBe('wss://example.com:8443');
  });

  test('omits port for secure remotes on 443', () => {
    expect(buildRemoteWebSocketUrl('example.com', 443, true)).toBe('wss://example.com');
  });

  test('uses wss and omits port when port is 443 without secure flag', () => {
    expect(buildRemoteWebSocketUrl('example.com', 443)).toBe('wss://example.com');
  });
});
