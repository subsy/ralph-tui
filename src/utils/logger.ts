/**
 * ABOUTME: Simple logging utility functions.
 * Provides log formatting, level filtering, and common logging helpers.
 */

/**
 * Log levels in order of severity
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Log level priority values
 */
export const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Check if a log level should be shown given a minimum level
 */
export function shouldLog(level: LogLevel, minLevel: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[minLevel];
}

/**
 * Format a timestamp for logging
 */
export function formatTimestamp(
  date: Date,
  format: 'iso' | 'time' | 'datetime' = 'time',
): string {
  switch (format) {
    case 'iso':
      return date.toISOString();
    case 'datetime':
      return `${date.toLocaleDateString()} ${formatTime(date)}`;
    case 'time':
    default:
      return formatTime(date);
  }
}

/**
 * Format time as HH:mm:ss
 */
function formatTime(date: Date): string {
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');
  return `${hours}:${minutes}:${seconds}`;
}

/**
 * Format a log message with level and optional timestamp
 */
export function formatLogMessage(
  level: LogLevel,
  message: string,
  options: {
    timestamp?: Date;
    timestampFormat?: 'iso' | 'time' | 'datetime';
    component?: string;
  } = {},
): string {
  const parts: string[] = [];

  if (options.timestamp) {
    const ts = formatTimestamp(options.timestamp, options.timestampFormat);
    parts.push(`[${ts}]`);
  }

  parts.push(`[${level.toUpperCase()}]`);

  if (options.component) {
    parts.push(`[${options.component}]`);
  }

  parts.push(message);

  return parts.join(' ');
}

/**
 * Format duration in milliseconds to human readable string
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/**
 * Format a byte size to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${units[i]}`;
}

/**
 * Truncate a string to a maximum length with ellipsis
 */
export function truncate(
  str: string,
  maxLength: number,
  ellipsis = '...',
): string {
  if (str.length <= maxLength) {
    return str;
  }

  return str.slice(0, maxLength - ellipsis.length) + ellipsis;
}

/**
 * Indent a multi-line string
 */
export function indent(str: string, spaces: number): string {
  const padding = ' '.repeat(spaces);
  return str
    .split('\n')
    .map((line) => padding + line)
    .join('\n');
}

/**
 * Strip ANSI escape codes from a string
 */
export function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Mask sensitive values in a string (for logging)
 */
export function maskSensitive(str: string, patterns: RegExp[] = []): string {
  let result = str;

  // Default patterns for API keys, tokens, passwords
  const defaultPatterns = [
    // API keys (common formats)
    /(?:api[_-]?key|apikey)[=:]\s*['"]?([a-zA-Z0-9_-]{20,})['"]?/gi,
    // Bearer tokens
    /bearer\s+([a-zA-Z0-9_.-]+)/gi,
    // Generic secret/password patterns
    /(?:password|secret|token)[=:]\s*['"]?([^\s'"]+)['"]?/gi,
  ];

  const allPatterns = [...defaultPatterns, ...patterns];

  for (const pattern of allPatterns) {
    result = result.replace(pattern, (match, group) => {
      return match.replace(group, '***');
    });
  }

  return result;
}

/**
 * Create a simple console logger
 */
export function createConsoleLogger(minLevel: LogLevel = 'info') {
  return {
    debug: (msg: string) => {
      if (shouldLog('debug', minLevel)) {
        console.debug(
          formatLogMessage('debug', msg, { timestamp: new Date() }),
        );
      }
    },
    info: (msg: string) => {
      if (shouldLog('info', minLevel)) {
        console.info(formatLogMessage('info', msg, { timestamp: new Date() }));
      }
    },
    warn: (msg: string) => {
      if (shouldLog('warn', minLevel)) {
        console.warn(formatLogMessage('warn', msg, { timestamp: new Date() }));
      }
    },
    error: (msg: string) => {
      if (shouldLog('error', minLevel)) {
        console.error(
          formatLogMessage('error', msg, { timestamp: new Date() }),
        );
      }
    },
  };
}
