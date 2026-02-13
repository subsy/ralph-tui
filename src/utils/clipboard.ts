/**
 * ABOUTME: Cross-platform clipboard read/write utility for terminal applications.
 * Uses OS-specific commands (pbcopy/pbpaste, wl-copy/wl-paste, xclip/xsel, clip/PowerShell)
 * for reliable clipboard access across different terminal and display server configurations.
 */

import * as childProcess from 'node:child_process';
import * as os from 'node:os';

/**
 * Result of a clipboard write operation
 */
export interface ClipboardResult {
  /** Whether the clipboard write succeeded */
  success: boolean;
  /** Error message if the operation failed */
  error?: string;
  /** Number of characters written */
  charCount?: number;
}

/**
 * Result of a clipboard read operation.
 */
export interface ClipboardReadResult {
  /** Whether the clipboard read succeeded */
  success: boolean;
  /** Clipboard text content (if successful) */
  text?: string;
  /** Error message if the operation failed */
  error?: string;
}

/**
 * Write text to the system clipboard.
 *
 * Platform support:
 * - macOS: Uses `pbcopy` (built-in)
 * - Linux: Uses `wl-copy` (Wayland), `xclip`, or `xsel` (X11)
 * - Windows: Uses `clip.exe` (built-in)
 *
 * @param text The text to write to the clipboard
 * @returns Promise resolving to the result of the operation
 */
export async function writeToClipboard(text: string): Promise<ClipboardResult> {
  if (!text) {
    return { success: false, error: 'No text provided' };
  }

  const platformName = os.platform();
  let command: string;
  let args: string[];

  switch (platformName) {
    case 'darwin':
      command = 'pbcopy';
      args = [];
      break;

    case 'linux':
    case 'freebsd':
    case 'openbsd':
      return tryLinuxClipboard(text);

    case 'win32':
      command = 'clip';
      args = [];
      break;

    default:
      return { success: false, error: `Unsupported platform: ${platformName}` };
  }

  return runClipboardCommand(command, args, text);
}

/**
 * Read text from the system clipboard.
 *
 * Platform support:
 * - macOS: Uses `pbpaste` (built-in)
 * - Linux: Uses `wl-paste`, `xclip`, or `xsel`
 * - Windows: Uses PowerShell `Get-Clipboard -Raw`
 *
 * @returns Promise resolving to clipboard read result
 */
export async function readFromClipboard(): Promise<ClipboardReadResult> {
  const platformName = os.platform();

  switch (platformName) {
    case 'darwin':
      return runClipboardReadCommand('pbpaste', []);

    case 'linux':
    case 'freebsd':
    case 'openbsd':
      return tryLinuxClipboardRead();

    case 'win32':
      return runClipboardReadCommand('powershell', [
        '-NoProfile',
        '-Command',
        'Get-Clipboard -Raw',
      ]);

    default:
      return { success: false, error: `Unsupported platform: ${platformName}` };
  }
}

/**
 * Try Linux clipboard commands in order of preference:
 * 1. wl-copy (Wayland)
 * 2. xclip (X11)
 * 3. xsel (X11 fallback)
 */
async function tryLinuxClipboard(text: string): Promise<ClipboardResult> {
  // Try wl-copy first (Wayland - increasingly common on modern Linux)
  const wlResult = await runClipboardCommand('wl-copy', [], text);
  if (wlResult.success) {
    return wlResult;
  }

  // Try xclip (X11 - most common)
  const xclipResult = await runClipboardCommand('xclip', ['-selection', 'clipboard'], text);
  if (xclipResult.success) {
    return xclipResult;
  }

  // Fall back to xsel (X11)
  const xselResult = await runClipboardCommand('xsel', ['--clipboard', '--input'], text);
  if (xselResult.success) {
    return xselResult;
  }

  // Neither worked - provide helpful error
  return {
    success: false,
    error: 'No clipboard tool available. Install: wl-clipboard (Wayland) or xclip (X11)',
  };
}

/**
 * Run a clipboard command with the given text as stdin.
 */
function runClipboardCommand(
  command: string,
  args: string[],
  text: string
): Promise<ClipboardResult> {
  return new Promise((resolve) => {
    try {
      const proc = childProcess.spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stderr = '';

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') {
          resolve({ success: false, error: `Command not found: ${command}` });
        } else {
          resolve({ success: false, error: err.message });
        }
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, charCount: text.length });
        } else {
          resolve({
            success: false,
            error: stderr.trim() || `Command exited with code ${code}`,
          });
        }
      });

      // Write text to stdin and close
      proc.stdin?.write(text);
      proc.stdin?.end();
    } catch (err) {
      resolve({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });
}

/**
 * Try Linux clipboard read commands in order of preference.
 */
async function tryLinuxClipboardRead(): Promise<ClipboardReadResult> {
  const wlResult = await runClipboardReadCommand('wl-paste', [
    '--no-newline',
    '--type',
    'text',
  ]);
  if (wlResult.success) {
    return wlResult;
  }

  const xclipResult = await runClipboardReadCommand('xclip', [
    '-selection',
    'clipboard',
    '-t',
    'text/plain',
    '-o',
  ]);
  if (xclipResult.success) {
    return xclipResult;
  }

  const xselResult = await runClipboardReadCommand('xsel', [
    '--clipboard',
    '--output',
  ]);
  if (xselResult.success) {
    return xselResult;
  }

  return {
    success: false,
    error: 'No clipboard tool available. Install: wl-clipboard (Wayland) or xclip (X11)',
  };
}

/**
 * Run a clipboard read command and capture stdout as text.
 */
function runClipboardReadCommand(
  command: string,
  args: string[],
): Promise<ClipboardReadResult> {
  return new Promise((resolve) => {
    try {
      const proc = childProcess.spawn(command, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') {
          resolve({ success: false, error: `Command not found: ${command}` });
        } else {
          resolve({ success: false, error: err.message });
        }
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true, text: stdout });
        } else {
          resolve({
            success: false,
            error: stderr.trim() || `Command exited with code ${code}`,
          });
        }
      });
    } catch (err) {
      resolve({
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }
  });
}
