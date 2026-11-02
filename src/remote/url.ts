/**
 * ABOUTME: WebSocket URL helpers for remote client connections.
 * Centralizes secure WebSocket protocol and port formatting rules.
 */

/**
 * Determine whether a remote should use a secure WebSocket connection.
 */
export function shouldUseSecureWebSocket(port: number, secure?: boolean): boolean {
  return secure === true || port === 443;
}

/**
 * Build the WebSocket URL for a remote connection.
 * Secure remotes on port 443 omit the default port from the URL.
 */
export function buildRemoteWebSocketUrl(host: string, port: number, secure?: boolean): string {
  const useSecureWebSocket = shouldUseSecureWebSocket(port, secure);
  const protocol = useSecureWebSocket ? 'wss' : 'ws';
  const portSuffix = useSecureWebSocket && port === 443 ? '' : `:${port}`;

  return `${protocol}://${host}${portSuffix}`;
}
